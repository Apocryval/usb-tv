"""Exercise the terminal workflow without touching personal media."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
spec = importlib.util.spec_from_file_location('sync_terminal', ROOT / 'scripts/sync_videos.py')
terminal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(terminal)
from video_sync import apply, compare


class TerminalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.usb = Path(self.temp.name) / 'USB'
        self.local = Path(self.temp.name) / 'Personal'
        self.usb.mkdir()
        self.local.mkdir()
        (self.local / 'feature.mp4').write_bytes(b'feature' * 100)

    def run_terminal(self, options=(), answers=(), interactive=False):
        output, errors = io.StringIO(), io.StringIO()
        argv = ['sync_videos.py', '--usb', str(self.usb), '--external', str(self.local), *options]
        with patch.object(sys, 'argv', argv), patch.object(sys.stdin, 'isatty', return_value=interactive), \
                patch('builtins.input', side_effect=answers), contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            code = terminal.main()
        return code, output.getvalue(), errors.getvalue()

    def test_menu_details_and_quit_do_not_copy(self):
        code, output, _ = self.run_terminal(answers=['d', 'q'], interactive=True)
        self.assertEqual(code, 0)
        self.assertIn('feature.mp4', output)
        self.assertIn('Tape ejected', output)
        self.assertFalse((self.usb / 'feature.mp4').exists())
        self.assertFalse((self.usb / '.usbtv-sync').exists())

    def test_menu_sync_and_progress(self):
        code, output, errors = self.run_terminal(answers=['s'], interactive=True)
        self.assertEqual(code, 0)
        self.assertIn('Exchange complete', output)
        for phase in ('Checking', 'Copying', 'Verifying', 'Publishing'):
            self.assertIn(phase, errors)
        self.assertEqual((self.usb / 'feature.mp4').read_bytes(), (self.local / 'feature.mp4').read_bytes())

    def test_json_remains_parseable_and_preview_only(self):
        code, output, errors = self.run_terminal(['--json'])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(output)['copy_to_usb'], ['feature.mp4'])
        self.assertEqual(errors, '')
        self.assertFalse((self.usb / 'feature.mp4').exists())

    def test_changed_manifest_stops_before_writes(self):
        plan = compare(self.usb, self.local)
        (self.local / 'new.mp4').write_bytes(b'new')
        with self.assertRaisesRegex(ValueError, 'changed since preview'):
            apply(self.usb, self.local, expected_plan=plan)
        self.assertFalse((self.usb / 'feature.mp4').exists())
        self.assertFalse((self.usb / '.usbtv-sync').exists())

    def test_byte_events_finish_all_copy_phases(self):
        events = []
        apply(self.usb, self.local, progress=lambda **event: events.append(event))
        for phase in ('copying', 'verifying', 'publishing'):
            matching = [event for event in events if event['stage'] == phase]
            self.assertTrue(matching)
            self.assertEqual(matching[-1]['done'], matching[-1]['total'])

    def test_noninteractive_preview_and_interrupt(self):
        code, output, _ = self.run_terminal()
        self.assertEqual(code, 0)
        self.assertIn('Preview only', output)
        with patch.object(terminal, 'compare', side_effect=KeyboardInterrupt):
            code, _, errors = self.run_terminal()
        self.assertEqual(code, 130)
        self.assertIn('Tape stopped', errors)


if __name__ == '__main__':
    unittest.main()
