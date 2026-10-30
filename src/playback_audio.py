"""On-demand audio-compatible playback copies. Originals and catalogue stay untouched."""
from pathlib import Path
import hashlib
import os
import shutil
import subprocess
import threading
import time
import uuid

from library_paths import data_directory
from media import inspect_media, tool_path

DOLBY_CODECS = {'ac3', 'eac3', 'ac-3', 'ec-3'}


def cache_path(root, source):
    source = Path(source).resolve()
    stat = source.stat()
    identity = f'aac-stereo-v1:{source}:{stat.st_size}:{stat.st_mtime_ns}'
    key = hashlib.sha256(identity.encode('utf-8')).hexdigest()
    return data_directory(root) / 'playback-audio' / (key + '.mp4')


class PlaybackAudio:
    def __init__(self, library):
        self.library = library
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.thread = None
        self.jobs = {}

    def item(self, media_id):
        with self.library.lock:
            item = next((v for v in self.library.read()['videos'] if v['id'] == media_id), None)
            if not item or item.get('missing'):
                raise ValueError('This video is no longer available.')
            source = self.library.media_path(item['file'])
        if not source.is_file():
            raise ValueError('This video file is missing.')
        if item.get('technical', {}).get('audio_codec') not in DOLBY_CODECS:
            raise ValueError('Audio preparation is available for Dolby AC-3/E-AC-3 videos.')
        return item, source, cache_path(self.library.root, source)

    def status(self, media_id):
        item, source, target = self.item(media_id)
        with self.lock:
            state = {'state': 'ready'} if target.is_file() else dict(self.jobs.get(str(target), {'state': 'idle'}))
        if state.get('state') == 'ready' and not target.is_file():
            state = {'state': 'idle'}
        return {**state, 'file': item['file'], 'available': bool(tool_path('ffmpeg', self.library.root) and tool_path('ffprobe', self.library.root)),
                'required_bytes': source.stat().st_size}

    def prepare(self, media_id):
        item, source, target = self.item(media_id)
        with self.lock:
            if target.is_file() or self.jobs.get(str(target), {}).get('state') == 'preparing':
                return self.status(media_id)
            if self.thread and self.thread.is_alive():
                raise ValueError('Another video is preparing audio. Try again when it finishes.')
            if self.stop.is_set():
                raise ValueError('USB.tv is stopping. Restart it before preparing audio.')
            ffmpeg = tool_path('ffmpeg', self.library.root)
            if not ffmpeg or not tool_path('ffprobe', self.library.root):
                raise ValueError('Audio preparation needs FFmpeg and FFprobe on this computer.')
            target.parent.mkdir(parents=True, exist_ok=True)
            if shutil.disk_usage(target.parent).free < source.stat().st_size * 1.1 + 64 * 1024 * 1024:
                raise ValueError('Not enough free space for a playback copy. Allow at least the size of the original video plus 10%.')
            self.jobs[str(target)] = {'state': 'preparing'}
            self.thread = threading.Thread(target=self.convert, args=(source, target, ffmpeg), daemon=True)
            self.thread.start()
            return self.status(media_id)

    def convert(self, source, target, ffmpeg):
        temporary = target.with_name(target.stem + '.' + uuid.uuid4().hex + '.tmp.mp4')
        process = None
        try:
            technical = inspect_media(source, self.library.root).get('technical', {})
            if technical.get('audio_codec') not in DOLBY_CODECS or technical.get('video_codec') not in {'h264', 'hevc'}:
                raise ValueError('This file cannot use audio-only preparation; it needs a full format conversion.')
            command = [ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error', '-xerror', '-y', '-i', str(source),
                       '-map', '0:v:0', '-map', '0:a:0', '-map_metadata', '0', '-map_chapters', '0',
                       '-c:v', 'copy', '-c:a', 'aac', '-ac', '2', '-b:a', '192k']
            if technical['video_codec'] == 'hevc':
                command += ['-tag:v', 'hvc1']
            command += ['-movflags', '+faststart', str(temporary)]
            options = {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}
            process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, **options)
            deadline = time.monotonic() + 86400
            while True:
                if self.stop.is_set():
                    raise InterruptedError('Audio preparation stopped. The original video is unchanged.')
                if time.monotonic() >= deadline:
                    raise ValueError('Audio preparation timed out. The original video is unchanged.')
                try:
                    _, errors = process.communicate(timeout=.25)
                    break
                except subprocess.TimeoutExpired:
                    continue
            if process.returncode:
                raise ValueError('FFmpeg could not prepare this file. The original video is unchanged. ' + errors.decode('utf-8', 'replace')[-400:])
            result = inspect_media(temporary, self.library.root)
            if result.get('technical', {}).get('audio_codec') != 'aac' or not result.get('duration'):
                raise ValueError('The playback copy could not be verified. The original video is unchanged.')
            if cache_path(self.library.root, source) != target:
                raise ValueError('The source changed during preparation. Try again after it finishes copying.')
            temporary.replace(target)
            with self.lock:
                self.jobs[str(target)] = {'state': 'ready'}
        except (OSError, ValueError, InterruptedError) as error:
            with self.lock:
                self.jobs[str(target)] = {'state': 'error', 'error': str(error)}
        finally:
            if process and process.poll() is None:
                process.terminate()
                try:
                    process.communicate(timeout=2)
                except subprocess.TimeoutExpired:
                    process.kill(); process.communicate()
            temporary.unlink(missing_ok=True)

    def close(self):
        self.stop.set()
        if self.thread:
            self.thread.join()
