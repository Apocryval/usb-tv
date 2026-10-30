import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
import json
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch
from media_health import CHECK_VERSION, check_current, check_playback
from catalogue import Catalogue

META = {'duration':10,'technical':{'video_codec':'h264','audio_codec':'aac'}}


class MediaHealthTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.path = self.root / 'sample.mkv'
        self.path.write_bytes(b'header' + b'x' * 500000)

    def test_cache_tracks_content_version_and_decoder_availability(self):
        check = {'version':CHECK_VERSION,'fingerprint':'abc','decode_available':True}
        self.assertTrue(check_current(check,'abc',True))
        self.assertFalse(check_current(check,'replacement',True))
        self.assertFalse(check_current(check,'abc',False))
        self.assertFalse(check_current(dict(check,version=0),'abc',True))
        self.assertFalse(check_current(dict(check,retryable=True,checked_at=0),'abc',True))

    def test_zero_filled_regions_are_flagged_even_without_decode_tools(self):
        with self.path.open('wb') as handle:
            handle.write(b'MKV header');handle.truncate(4*1024*1024)
        with patch('media_health.tool_path',return_value=None):
            result = check_playback(self.path,self.root,META,'abc')
        codes = {i['code'] for i in result['issues']}
        self.assertIn('zero_filled_regions',codes)
        self.assertIn('decoder_unavailable',codes)
        self.assertEqual(result['status'],'warning')

    def test_sparse_allocation_alone_does_not_assert_damage(self):
        with patch('media_health.tool_path',return_value=None):
            result = check_playback(self.path,self.root,META,'abc')
        self.assertNotIn('zero_filled_regions',{i['code'] for i in result['issues']})
        self.assertEqual(result['status'],'unchecked')

    def test_browser_codec_warnings_do_not_claim_the_file_is_broken(self):
        meta = {'duration':10,'technical':{'video_codec':'hevc','audio_codec':'eac3'}}
        with patch('media_health.tool_path',return_value=None):
            result = check_playback(self.path,self.root,meta,'abc')
        self.assertEqual(result['status'],'warning')
        codes = {i['code'] for i in result['issues']}
        self.assertTrue({'browser_video','browser_audio'} <= codes)
        self.assertFalse(any(i['severity']=='error' for i in result['issues']))

    def test_timeout_cancels_the_process_and_reports_unverified_instead_of_corrupt(self):
        process = Mock()
        process.communicate.side_effect = [TimeoutError(), (b'',b'')]
        process.poll.return_value = None
        with patch('media_health.tool_path',return_value='ffmpeg'),patch('media_health.subprocess.Popen',return_value=process):
            result = check_playback(self.path,self.root,META,'abc')
        process.terminate.assert_called_once()
        self.assertEqual(result['status'],'unchecked')
        self.assertTrue(result['retryable'])
        self.assertEqual(result['issues'][0]['code'],'check_timeout')

    def test_cancellation_stops_active_decode_and_propagates_for_checkpointing(self):
        process = Mock();process.poll.return_value=None;process.communicate.return_value=(b'',b'')
        started = {'value':False}
        def spawn(*args,**kwargs): started['value']=True; return process
        with patch('media_health.tool_path',return_value='ffmpeg'),patch('media_health.subprocess.Popen',side_effect=spawn):
            with self.assertRaises(InterruptedError):
                check_playback(self.path,self.root,META,'abc',cancelled=lambda:started['value'])
        process.terminate.assert_called_once()

    def test_pre_start_cancellation_never_launches_ffmpeg(self):
        with patch('media_health.subprocess.Popen') as spawn:
            with self.assertRaises(InterruptedError):
                check_playback(self.path,self.root,META,'abc',cancelled=lambda:True)
            spawn.assert_not_called()

    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg tools unavailable')
    def test_real_good_file_and_sparse_incomplete_file_with_readable_duration(self):
        self.path = self.root / 'sample.mp4'
        subprocess.run(['ffmpeg','-v','error','-nostdin','-y','-f','lavfi','-i','testsrc2=size=96x64:rate=8',
            '-f','lavfi','-i','sine=frequency=400','-t','10','-c:v','libx264','-c:a','aac','-movflags','+faststart',str(self.path)],check=True)
        original = self.path.read_bytes()
        result = check_playback(self.path,self.root,META,'good')
        self.assertEqual(result['status'],'checked',result)
        self.assertEqual([s['position'] for s in result['samples']],[0,5,8])
        self.assertTrue(all(s['decoded'] for s in result['samples']))
        self.assertEqual(self.path.read_bytes(),original)
        # The MP4 header still advertises 10s, but most packet data is gone.
        data = bytearray(original)
        payload = data.index(b'mdat') + 4
        data[payload+500:]=b'\0'*(len(data)-payload-500)
        self.path.write_bytes(data)
        from media import inspect_media
        self.assertAlmostEqual(inspect_media(self.path,self.root)['duration'],10,delta=.1)
        result = check_playback(self.path,self.root,META,'broken')
        self.assertEqual(result['status'],'error',result)
        self.assertIn('decode_failed',{i['code'] for i in result['issues']})


class ScannerHealthTests(unittest.TestCase):
    def test_backfill_and_cache_preserve_labels_without_rehashing_unchanged_content(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);catalogue=Catalogue(root,organise_new=False)
            (root/'Videos'/'clip.mkv').write_bytes(b'unchanged content')
            def assess(path,root,metadata,fingerprint,cancelled):
                return {'version':CHECK_VERSION,'fingerprint':fingerprint,'decode_available':True,
                        'status':'warning','issues':[{'code':'browser_audio','message':'Dolby audio may be silent.'}], 'samples':[]}
            with patch('catalogue.inspect_media',return_value=META),patch('catalogue.check_playback',side_effect=assess) as checker:
                first=catalogue.scan()
                self.assertEqual(checker.call_count,1)
            first['videos'][0].update(title='My title',tags=['mine'],channels=['My channel'],enabled=False)
            catalogue.save_edits(first)
            with patch('catalogue.check_playback',side_effect=AssertionError('Rechecked unchanged file')),patch('catalogue.inspect_media',side_effect=AssertionError('Reprobed unchanged file')),patch('catalogue.hashlib.sha256',side_effect=AssertionError('Rehashed unchanged file')):
                again=catalogue.scan()
            item=again['videos'][0]
            self.assertEqual(item['title'],'My title');self.assertEqual(item['tags'],['mine']);self.assertFalse(item['enabled'])
            # An old catalogue/cache without the new check gets backfilled once.
            item.pop('playback_check');catalogue.write(again)
            cache=root/'scan-cache.jsonl'
            records=[json.loads(line) for line in cache.read_text().splitlines() if line.strip()]
            for row in records: row.pop('playback_check',None)
            cache.write_text('\n'.join(json.dumps(row) for row in records)+'\n')
            with patch('catalogue.check_playback',side_effect=assess) as checker,patch('catalogue.inspect_media',side_effect=AssertionError('Reprobed during backfill')),patch('catalogue.hashlib.sha256',side_effect=AssertionError('Rehashed during backfill')):
                backfilled=catalogue.scan()
            self.assertEqual(checker.call_count,1)
            self.assertEqual(backfilled['videos'][0]['playback_check']['status'],'warning')


if __name__=='__main__': unittest.main()
