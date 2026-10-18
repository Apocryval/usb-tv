import sys
from pathlib import Path as _TestPath
sys.path.insert(0, str(_TestPath(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(_TestPath(__file__).resolve().parents[1] / "scripts"))
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from catalogue import Catalogue, normalise_settings
from media import loudness_result, measure_loudness


class LoudnessTests(unittest.TestCase):
    def test_gain_uses_loudness_with_peak_headroom_and_boost_cap(self):
        self.assertEqual(loudness_result({'input_i': '-27', 'input_tp': '-12'})['gain_db'], 9)
        self.assertEqual(loudness_result({'input_i': '-9', 'input_tp': '-.5'})['gain_db'], -9)
        self.assertEqual(loudness_result({'input_i': '-40', 'input_tp': '-30'})['gain_db'], 12)
        self.assertEqual(loudness_result({'input_i': '-30', 'input_tp': '-2'})['gain_db'], .5)
        self.assertEqual(loudness_result({'input_i': '-inf', 'input_tp': '-inf'})['status'], 'silent')

    def test_default_on_and_off_persist(self):
        self.assertTrue(normalise_settings({})['volume_levelling'])
        self.assertFalse(normalise_settings({'volume_levelling': False})['volume_levelling'])

    def test_balanced_profile_persists_without_changing_measurements(self):
        self.assertEqual(normalise_settings({})['volume_profile'], 'standard')
        self.assertEqual(normalise_settings({'volume_profile':'invalid'})['volume_profile'], 'standard')
        with tempfile.TemporaryDirectory() as root:
            library=Catalogue(root, organise_new=False)
            data=library.save_edits({'videos':[], 'settings':{'volume_profile':'balanced'}})
            self.assertEqual(data['settings']['volume_profile'], 'balanced')
            self.assertEqual(Catalogue(root).read()['settings']['volume_profile'], 'balanced')

    def test_measurement_cache_survives_restart_and_keeps_concurrent_labels(self):
        with tempfile.TemporaryDirectory() as root:
            library = Catalogue(root, organise_new=False)
            (Path(root) / 'Videos/sample.mp4').write_bytes(b'fake video')
            with patch('catalogue.inspect_media', return_value={'duration': 5}):
                library.scan()
            def measure(*args):
                data = library.read()
                data['videos'][0]['title'] = 'Edited during analysis'
                library.save_edits(data)
                return {'status': 'ready', 'gain_db': 6, 'integrated_lufs': -24, 'true_peak_db': -12}
            with patch('catalogue.tool_path', return_value='ffmpeg'), patch('catalogue.measure_loudness', side_effect=measure) as mocked:
                data = library.analyse_audio()
                self.assertEqual(mocked.call_count, 1)
                self.assertEqual(data['videos'][0]['title'], 'Edited during analysis')
                self.assertEqual(data['videos'][0]['audio_analysis']['gain_db'], 6)
                Catalogue(root, organise_new=False).analyse_audio()
                self.assertEqual(mocked.call_count, 1)
                # Recover a result journalled before a catalogue checkpoint.
                data['videos'][0].pop('audio_analysis')
                library.write(data)
                library.analyse_audio()
                self.assertEqual(mocked.call_count, 1)
                # A changed content fingerprint must invalidate the old measurement.
                data = library.read()
                data['videos'][0]['fingerprint'] = 'new-content'
                library.write(data)
                library.analyse_audio()
                self.assertEqual(mocked.call_count, 2)

    def test_pausing_commits_completed_results_and_turning_off_skips_work(self):
        with tempfile.TemporaryDirectory() as root:
            library = Catalogue(root, organise_new=False)
            for name in ['one', 'two']:
                (Path(root) / f'Videos/{name}.mp4').write_bytes(name.encode())
            with patch('catalogue.inspect_media', return_value={'duration': 5}):
                library.scan()
            calls = []
            def measure(*args):
                calls.append(True)
                return {'status': 'ready', 'gain_db': 3}
            with patch('catalogue.tool_path', return_value='ffmpeg'), patch('catalogue.measure_loudness', side_effect=measure):
                with self.assertRaises(InterruptedError):
                    library.analyse_audio(cancelled=lambda: bool(calls))
                self.assertEqual(sum(library.audio_current(v) for v in library.read()['videos']), 1)
                data=library.read();data['settings']['volume_levelling']=False;library.save_edits(data)
                library.analyse_audio()
                self.assertEqual(len(calls),1)

    def test_cancelled_ffmpeg_is_reaped(self):
        process = unittest.mock.Mock()
        process.poll.return_value = None
        with patch('media.subprocess.Popen', return_value=process):
            with self.assertRaises(InterruptedError):
                measure_loudness(Path('sample.mp4'), 'ffmpeg', cancelled=lambda: True)
        process.terminate.assert_called_once()
        process.communicate.assert_called_once()
