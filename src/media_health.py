"""Bounded playback spot checks, cached separately from editable media labels."""
from pathlib import Path
import os
import subprocess
import time

from media import number, tool_path

CHECK_VERSION = 1


def check_current(check, fingerprint, decode_available):
    return (isinstance(check, dict) and check.get('version') == CHECK_VERSION
            and check.get('fingerprint') == fingerprint
            and check.get('decode_available') == decode_available
            and not (check.get('retryable') and time.time() - check.get('checked_at', 0) >= 3600))


def check_playback(path, root, metadata, fingerprint, cancelled=lambda: False, budget=12):
    """Read <= 512 KiB of gap samples and request up to three one-second decodes.

    This deliberately cannot certify an entire file or a particular browser.
    Sparse allocation alone never counts as evidence of a damaged file.
    """
    path = Path(path)
    issues, samples = [], []
    ffmpeg = tool_path('ffmpeg', root)
    decode_available = bool(ffmpeg)
    retryable = False
    def issue(code, message, severity='warning'):
        if not any(item['code'] == code for item in issues):
            issues.append({'code':code, 'message':message, 'severity':severity})
    def check_cancelled():
        if cancelled():
            raise InterruptedError('Playback checking paused; completed checks are saved.')
    check_cancelled()
    stat = path.stat()
    if not stat.st_size:
        issue('empty_file', 'Empty file; finish copying or downloading it.', 'error')
    else:
        length = 65536
        offsets = sorted({0, min(1024*1024, max(0,stat.st_size-length)),
                          *[max(0,int(stat.st_size*f)-length//2) for f in (.25,.5,.75)],
                          max(0,stat.st_size-length)})
        zero_samples = 0
        with path.open('rb') as handle:
            for offset in offsets:
                check_cancelled(); handle.seek(offset); block = handle.read(length)
                if len(block) == length and block.count(0) == length:
                    zero_samples += 1
        if zero_samples >= 2:
            issue('zero_filled_regions', 'Possible incomplete download: multiple sampled regions contain only zero bytes.')
    if metadata.get('probe_error'):
        issue('container_errors', 'The container reader reported errors; the file may be damaged or incomplete.')
    technical = metadata.get('technical', {})
    video, audio = str(technical.get('video_codec','')).lower(), str(technical.get('audio_codec','')).lower()
    if video in {'hevc','h265','hev1','hvc1'}:
        issue('browser_video', 'HEVC video needs a compatible browser and system decoder.')
    elif video and video not in {'h264','avc1','avc3','vp8','vp9','av1','av01'}:
        issue('browser_video', 'This video codec may need conversion for browser playback.')
    if audio in {'ac3','eac3','ac-3','ec-3'}:
        issue('browser_audio', 'Dolby audio may be silent in this browser; use Prepare audio.')
    elif audio and audio not in {'aac','mp4a','opus','mp3','vorbis','flac'}:
        issue('browser_audio', 'This audio codec may need conversion for browser playback.')
    if path.suffix.lower() in {'.avi','.wmv','.flv','.vob','.ts','.mts','.m2ts'}:
        issue('browser_container', 'This container may need conversion for browser playback.')
    duration = number(metadata.get('duration'))
    if not ffmpeg:
        issue('decoder_unavailable', 'Playback was not decoded: install FFmpeg to run the sample checks.', 'info')
    elif stat.st_size:
        positions = [0.0]
        if duration >= 8:
            positions += [duration/2, max(0,duration-2)]
        deadline = time.monotonic() + budget
        for position in positions:
            check_cancelled()
            if time.monotonic() >= deadline:
                retryable = True
                issue('check_timeout', 'Playback checks reached their time limit; this file needs review.', 'info')
                break
            command = [ffmpeg, '-nostdin', '-hide_banner', '-v', 'error', '-nostats',
                       '-ss', str(position), '-threads', '1', '-i', str(path), '-t', '1',
                       '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', '-threads', '1',
                       '-progress', 'pipe:1', '-f', 'null', '-']
            options = {'creationflags':subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}
            process = None
            try:
                process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **options)
                while True:
                    check_cancelled()
                    if time.monotonic() >= deadline:
                        raise TimeoutError()
                    try:
                        output, errors = process.communicate(timeout=.2)
                        break
                    except subprocess.TimeoutExpired:
                        continue
                progress = output.decode('utf-8','replace')
                frames = max([int(line.partition('=')[2]) for line in progress.splitlines()
                              if line.startswith('frame=') and line.partition('=')[2].strip().isdigit()] or [0])
                passed = process.returncode == 0 and frames > 0
                samples.append({'position':round(position,3), 'decoded':passed})
                if not passed:
                    issue('decode_failed', 'A playback sample could not be decoded; the file may be incomplete or damaged.', 'error')
                elif errors.strip():
                    issue('decode_errors', 'The decoder reported errors while reading a playback sample.')
            except TimeoutError:
                retryable = True
                issue('check_timeout', 'Playback checks reached their time limit; this file needs review.', 'info')
                break
            except InterruptedError:
                raise
            except OSError:
                retryable = True
                issue('decoder_unavailable', 'FFmpeg could not start; playback samples were not checked.', 'info')
                break
            finally:
                if process and process.poll() is None:
                    process.terminate()
                    try: process.communicate(timeout=2)
                    except subprocess.TimeoutExpired:
                        process.kill(); process.communicate()
    if not duration:
        issue('unknown_duration', 'Duration could not be read; browser playback is unverified.')
    status = 'error' if any(i['severity']=='error' for i in issues) else 'warning' if any(i['severity']=='warning' for i in issues) else 'unchecked' if issues or not samples else 'checked'
    return {'version':CHECK_VERSION, 'fingerprint':fingerprint, 'checked_at':time.time(),
            'decode_available':decode_available, 'retryable':retryable,
            'status':status, 'issues':issues, 'samples':samples}
