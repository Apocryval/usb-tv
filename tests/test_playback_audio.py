import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
import json
import shutil
import subprocess
import tempfile
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from playback_audio import PlaybackAudio, cache_path


class PlaybackAudioTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'data').mkdir()
        self.source = self.root / 'movie.mkv'
        self.source.write_bytes(b'original')
        self.item = {'id':'one', 'file':'Videos/movie.mkv', 'technical':{'audio_codec':'eac3'}}
        self.library = SimpleNamespace(root=self.root, lock=threading.RLock(),
            read=lambda:{'videos':[self.item]}, media_path=lambda name:self.source)
        self.jobs = PlaybackAudio(self.library)
        self.addCleanup(self.jobs.close)

    def test_cache_is_private_and_changes_when_source_is_replaced(self):
        first = cache_path(self.root, self.source)
        self.assertEqual(first.parent, self.root / 'data' / 'playback-audio')
        self.source.write_bytes(b'replacement content')
        self.assertNotEqual(first, cache_path(self.root, self.source))
        with self.assertRaises(ValueError): self.jobs.status('../../private')
        self.item['technical']['audio_codec'] = 'aac'
        with self.assertRaises(ValueError): self.jobs.prepare('one')

    def test_missing_tools_and_disk_space_never_change_original(self):
        with patch('playback_audio.tool_path', return_value=None):
            with self.assertRaisesRegex(ValueError, 'FFmpeg'): self.jobs.prepare('one')
        with patch('playback_audio.tool_path', return_value='ffmpeg'), patch('playback_audio.shutil.disk_usage', return_value=SimpleNamespace(free=0)):
            with self.assertRaisesRegex(ValueError, 'free space'): self.jobs.prepare('one')
        self.assertEqual(self.source.read_bytes(), b'original')

    def test_failures_never_publish_partial_playback_copies(self):
        target = cache_path(self.root, self.source)
        target.parent.mkdir()
        with patch('playback_audio.inspect_media', return_value={'technical':{'audio_codec':'eac3','video_codec':'vp9'}}):
            self.jobs.convert(self.source, target, 'ffmpeg')
        self.assertEqual(self.jobs.status('one')['state'], 'error')
        self.assertFalse(target.exists())
        self.assertEqual(list(target.parent.iterdir()), [])
        self.assertEqual(self.source.read_bytes(), b'original')

    def test_reuses_completed_copy_without_new_work(self):
        target = cache_path(self.root, self.source)
        target.parent.mkdir(); target.write_bytes(b'verified copy')
        with patch('playback_audio.subprocess.Popen', side_effect=AssertionError('must reuse copy')):
            self.assertEqual(self.jobs.prepare('one')['state'], 'ready')

    def test_only_one_preparation_runs_and_close_cancels_it(self):
        started, finish = threading.Event(), threading.Event()
        def convert(*args):
            started.set(); finish.wait(5)
        with patch('playback_audio.tool_path', return_value='ffmpeg'), patch.object(self.jobs, 'convert', side_effect=convert):
            self.assertEqual(self.jobs.prepare('one')['state'], 'preparing')
            self.assertTrue(started.wait(2))
            self.assertEqual(self.jobs.prepare('one')['state'], 'preparing')
            self.source.write_bytes(b'new source')
            with self.assertRaisesRegex(ValueError, 'Another video'): self.jobs.prepare('one')
            finish.set(); self.jobs.close()
            self.assertTrue(self.jobs.stop.is_set())

    def test_deleted_completed_cache_is_offered_for_preparation_again(self):
        target = cache_path(self.root, self.source)
        self.jobs.jobs[str(target)] = {'state':'ready'}
        self.assertEqual(self.jobs.status('one')['state'], 'idle')

    def test_worker_failure_removes_unfinished_output_and_keeps_original(self):
        target = cache_path(self.root, self.source)
        target.parent.mkdir()
        process = SimpleNamespace(returncode=1, communicate=lambda **kwargs:(None,b'bad stream'), poll=lambda:1)
        def spawn(command, **kwargs):
            Path(command[-1]).write_bytes(b'partial')
            return process
        with patch('playback_audio.inspect_media', return_value={'technical':{'audio_codec':'eac3','video_codec':'h264'}}), patch('playback_audio.subprocess.Popen', side_effect=spawn):
            self.jobs.convert(self.source, target, 'ffmpeg')
        self.assertEqual(self.jobs.status('one')['state'], 'error')
        self.assertFalse(target.exists())
        self.assertEqual(list(target.parent.iterdir()), [])
        self.assertEqual(self.source.read_bytes(), b'original')

    def test_shutdown_terminates_encoder_and_removes_unfinished_output(self):
        target = cache_path(self.root, self.source)
        target.parent.mkdir()
        class Encoder:
            returncode = None
            terminated = False
            def poll(self): return self.returncode
            def terminate(self): self.terminated = True; self.returncode = -15
            def communicate(self, **kwargs): return None, b''
        process = Encoder()
        def spawn(command, **kwargs):
            Path(command[-1]).write_bytes(b'partial'); return process
        self.jobs.stop.set()
        with patch('playback_audio.inspect_media', return_value={'technical':{'audio_codec':'eac3','video_codec':'h264'}}), patch('playback_audio.subprocess.Popen', side_effect=spawn):
            self.jobs.convert(self.source, target, 'ffmpeg')
        self.assertTrue(process.terminated)
        self.assertEqual(self.jobs.status('one')['state'], 'error')
        self.assertFalse(target.exists())
        self.assertEqual(list(target.parent.iterdir()), [])

    def test_source_changed_during_conversion_never_publishes_stale_copy(self):
        target = cache_path(self.root, self.source)
        target.parent.mkdir()
        process = SimpleNamespace(returncode=0, communicate=lambda **kwargs:(None,b''), poll=lambda:0)
        def spawn(command, **kwargs):
            Path(command[-1]).write_bytes(b'prepared'); return process
        def inspect(path, root):
            if Path(path) == self.source:
                return {'technical':{'audio_codec':'eac3','video_codec':'h264'}}
            self.source.write_bytes(b'replaced original')
            return {'duration':10,'technical':{'audio_codec':'aac'}}
        with patch('playback_audio.inspect_media', side_effect=inspect), patch('playback_audio.subprocess.Popen', side_effect=spawn):
            self.jobs.convert(self.source, target, 'ffmpeg')
        self.assertEqual(self.jobs.jobs[str(target)]['state'], 'error')
        self.assertFalse(target.exists())
        self.assertEqual(list(target.parent.iterdir()), [])
        self.assertEqual(self.source.read_bytes(), b'replaced original')

    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg integration tools unavailable')
    def test_real_hevc_dolby_file_keeps_hevc_and_uses_browser_mp4_tag(self):
        encoders = subprocess.check_output(['ffmpeg','-v','quiet','-encoders'],text=True)
        if 'libx265' not in encoders: self.skipTest('HEVC encoder unavailable for test fixture')
        subprocess.run(['ffmpeg','-nostdin','-v','error','-y','-f','lavfi','-i','testsrc2=size=96x64:rate=8',
            '-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1','-c:v','libx265',
            '-preset','ultrafast','-x265-params','pools=1:frame-threads=1:log-level=error',
            '-c:a','ac3','-ac','6',str(self.source)],check=True,stderr=subprocess.DEVNULL)
        original = self.source.read_bytes()
        self.jobs.prepare('one'); self.jobs.thread.join(15)
        status = self.jobs.status('one'); self.assertEqual(status['state'], 'ready', status)
        target = cache_path(self.root, self.source)
        probe = json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(target)]))
        video = next(stream for stream in probe['streams'] if stream['codec_type']=='video')
        audio = next(stream for stream in probe['streams'] if stream['codec_type']=='audio')
        self.assertEqual(video['codec_name'],'hevc'); self.assertEqual(video['codec_tag_string'],'hvc1')
        self.assertEqual(audio['codec_name'],'aac'); self.assertEqual(audio['channels'],2)
        self.assertEqual(self.source.read_bytes(),original)

    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg integration tools unavailable')
    def test_real_dolby_conversion_preserves_video_and_original_and_makes_aac_stereo(self):
        subprocess.run(['ffmpeg','-nostdin','-v','error','-y','-f','lavfi','-i','testsrc2=size=96x64:rate=8',
            '-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1','-c:v','libx264','-c:a','eac3','-ac','6',str(self.source)],check=True)
        original = self.source.read_bytes()
        self.jobs.prepare('one'); self.jobs.thread.join(15)
        self.assertFalse(self.jobs.thread.is_alive())
        status = self.jobs.status('one')
        self.assertEqual(status['state'], 'ready', status)
        target = cache_path(self.root, self.source)
        probe = json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(target)]))
        audio = next(s for s in probe['streams'] if s['codec_type']=='audio')
        self.assertEqual(audio['codec_name'], 'aac'); self.assertEqual(audio['channels'], 2)
        def frames(path):
            return subprocess.check_output(['ffmpeg','-v','error','-i',str(path),'-map','0:v:0','-f','framemd5','-'])
        self.assertEqual(frames(self.source), frames(target))
        sound = subprocess.run(['ffmpeg','-v','info','-i',str(target),'-vn','-af','volumedetect','-f','null','-'],capture_output=True,text=True,check=True)
        self.assertIn('max_volume:', sound.stderr)
        self.assertNotIn('max_volume: -inf', sound.stderr)
        self.assertEqual(self.source.read_bytes(), original)


if __name__ == '__main__': unittest.main()
