import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from video_sync import apply, compare, exclude, registry, undo_exclusion, writing, copy_verified, STATE
from unittest.mock import patch
from collections import namedtuple


class VideoSyncTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.usb = Path(self.temp.name) / 'usb'
        self.local = Path(self.temp.name) / 'local'
        self.usb.mkdir()
        self.local.mkdir()

    def put(self, root, name, content):
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return path

    def test_union_preview_and_repeat(self):
        self.put(self.usb, 'series/a.mp4', b'a')
        self.put(self.local, 'b.MKV', b'b')
        self.put(self.local, 'notes.txt', b'notes')
        plan = compare(self.usb, self.local)
        self.assertEqual(plan['copy_to_usb'], ['b.MKV'])
        self.assertFalse((self.usb / STATE).exists())
        apply(self.usb, self.local)
        self.assertEqual((self.local / 'series/a.mp4').read_bytes(), b'a')
        self.assertEqual((self.usb / 'b.MKV').read_bytes(), b'b')
        self.assertFalse((self.usb / 'notes.txt').exists())
        plan = apply(self.usb, self.local)
        self.assertEqual(plan['copy_to_usb'] + plan['copy_to_external'], [])

    def test_conflict_stops_entire_sync(self):
        self.put(self.usb, 'a.mp4', b'a')
        self.put(self.local, 'a.mp4', b'changed')
        self.put(self.local, 'b.mp4', b'b')
        with self.assertRaises(ValueError):
            apply(self.usb, self.local)
        self.assertEqual((self.usb / 'a.mp4').read_bytes(), b'a')
        self.assertFalse((self.usb / 'b.mp4').exists())

    def test_excluded_content_stays_local_after_rename_and_other_person_sync(self):
        self.put(self.usb, 'a.mp4', b'video')
        self.put(self.local, 'renamed.mp4', b'video')
        exclude(self.usb, 'a.mp4')
        apply(self.usb, self.local)
        self.assertFalse((self.usb / 'a.mp4').exists())
        self.assertEqual((self.local / 'renamed.mp4').read_bytes(), b'video')
        self.assertEqual(len(list((self.usb / STATE / 'removed').rglob('a.mp4'))), 1)
        self.assertEqual(registry(self.usb), registry(self.local))
        apply(self.usb, self.local)
        self.assertFalse((self.usb / 'renamed.mp4').exists())
        other = Path(self.temp.name) / 'james'
        other.mkdir()
        self.put(other, 'another-name.mp4', b'video')
        apply(self.usb, other)
        self.assertTrue((other / 'another-name.mp4').exists())
        self.assertFalse((self.usb / 'another-name.mp4').exists())
        self.assertEqual(registry(other), registry(self.usb))

    def test_identical_renamed_content_is_not_duplicated(self):
        self.put(self.usb, 'a.mp4', b'video')
        self.put(self.local, 'b.mp4', b'video')
        plan = compare(self.usb, self.local)
        self.assertEqual(plan['copy_to_usb'] + plan['copy_to_external'], [])

    def test_nested_missing_and_case_collision(self):
        with self.assertRaises(ValueError):
            compare(self.usb, self.usb)
        nested = self.usb / 'nested'
        nested.mkdir()
        with self.assertRaises(ValueError):
            compare(self.usb, nested)
        self.put(self.usb, 'A.mp4', b'a')
        self.put(self.local, 'a.mp4', b'b')
        with self.assertRaises(ValueError):
            apply(self.usb, self.local)

    def test_personal_exclusion_reaches_usb_and_hidden_files_are_ignored(self):
        self.put(self.usb, 'a.mp4', b'a')
        self.put(self.local, 'a.mp4', b'a')
        self.put(self.local, '.usbtv-originals/original.mp4', b'original')
        exclude(self.local, 'a.mp4')
        plan = apply(self.usb, self.local)
        self.assertEqual(plan['copy_to_usb'], [])
        self.assertFalse((self.usb / 'a.mp4').exists())
        self.assertTrue((self.local / 'a.mp4').exists())

    def test_directory_case_collisions_and_nonvideo_obstacles(self):
        self.put(self.usb, 'Series/a.mp4', b'a')
        self.put(self.local, 'series/b.mp4', b'b')
        with self.assertRaises(ValueError):
            apply(self.usb, self.local)
        (self.local / 'series/b.mp4').unlink()
        (self.local / 'series').rmdir()
        self.put(self.local, 'Series', b'not a folder')
        with self.assertRaises(ValueError):
            apply(self.usb, self.local)

    def test_usb_only_marked_video_is_saved_personally_before_removal(self):
        self.put(self.usb, 'only-copy.mp4', b'precious')
        exclude(self.usb, 'only-copy.mp4')
        plan = apply(self.usb, self.local)
        self.assertEqual(plan['copy_to_external'], ['only-copy.mp4'])
        self.assertEqual((self.local / 'only-copy.mp4').read_bytes(), b'precious')
        self.assertFalse((self.usb / 'only-copy.mp4').exists())

    def test_undo_propagates_past_a_stale_personal_register(self):
        self.put(self.usb, 'one.mp4', b'video')
        key = exclude(self.usb, 'one.mp4')
        apply(self.usb, self.local)
        other = Path(self.temp.name) / 'james'
        other.mkdir()
        self.put(other, 'one.mp4', b'video')
        apply(self.usb, other)
        stale = registry(other)
        undo_exclusion(self.local, key)
        apply(self.usb, self.local)
        self.assertEqual((self.usb / 'one.mp4').read_bytes(), b'video')
        self.assertTrue(stale['videos'][key]['excluded'])
        apply(self.usb, other)
        self.assertFalse(registry(other)['videos'][key]['excluded'])
        self.assertTrue((self.usb / 'one.mp4').exists())
        # A fresh intentional mark must still work after undo has travelled.
        exclude(other, 'one.mp4')
        apply(self.usb, other)
        self.assertFalse((self.usb / 'one.mp4').exists())

    def test_undo_can_restore_from_recovery_when_personal_copy_is_missing(self):
        self.put(self.usb, 'one.mp4', b'video')
        key = exclude(self.usb, 'one.mp4')
        apply(self.usb, self.local)
        (self.local / 'one.mp4').unlink()  # Simulate an earlier library without its personal copy.
        undo_exclusion(self.usb, key)
        plan = compare(self.usb, self.local)
        self.assertEqual(plan['restore_usb'], ['one.mp4'])
        apply(self.usb, self.local, expected_plan=plan)
        self.assertEqual((self.usb / 'one.mp4').read_bytes(), b'video')
        self.assertEqual((self.local / 'one.mp4').read_bytes(), b'video')

    def test_lack_of_space_never_removes_the_only_video(self):
        self.put(self.usb, 'one.mp4', b'video')
        exclude(self.usb, 'one.mp4')
        Usage = namedtuple('Usage', 'total used free')
        with patch('video_sync.shutil.disk_usage', return_value=Usage(100, 100, 0)):
            with self.assertRaisesRegex(ValueError, 'Not enough free space'):
                apply(self.usb, self.local)
        self.assertTrue((self.usb / 'one.mp4').exists())
        self.assertFalse((self.local / 'one.mp4').exists())

    def test_interrupted_publish_leaves_source_and_no_partial_destination(self):
        self.put(self.local, 'one.mp4', b'video')
        plan = compare(self.usb, self.local)
        def interrupt(**event):
            if event['stage'] == 'publishing' and event['done'] > 0:
                raise KeyboardInterrupt
        with self.assertRaises(KeyboardInterrupt):
            apply(self.usb, self.local, progress=interrupt, expected_plan=plan)
        self.assertTrue((self.local / 'one.mp4').exists())
        self.assertFalse((self.usb / 'one.mp4').exists())
        self.assertFalse(list(self.usb.glob('.usbtv-copy-*')))

    def test_busy_writer_blocks_mark_and_sync(self):
        self.put(self.usb, 'one.mp4', b'video')
        with writing(self.usb):
            with self.assertRaisesRegex(ValueError, 'busy'):
                exclude(self.usb, 'one.mp4')
            with self.assertRaisesRegex(ValueError, 'busy'):
                apply(self.usb, self.local)
        self.assertTrue((self.usb / 'one.mp4').exists())

    def test_legacy_register_is_upgraded_and_stale_undo_is_rejected(self):
        path = self.put(self.usb, 'one.mp4', b'video')
        from video_sync import digest
        key = digest(path)
        self.put(self.usb, STATE + '/excluded.json', json.dumps({'version':1, 'videos':{key:{'file':'one.mp4','size':5}}}).encode())
        self.assertTrue(registry(self.usb)['videos'][key]['excluded'])
        undo_exclusion(self.usb, key, 1)
        exclude(self.usb, 'one.mp4')
        with self.assertRaisesRegex(ValueError, 'changed in another window'):
            undo_exclusion(self.usb, key, 1)
        self.assertTrue(registry(self.usb)['videos'][key]['excluded'])

    def test_app_root_is_resolved_to_videos(self):
        (self.usb / 'data').mkdir()
        (self.usb / 'Videos').mkdir()
        self.put(self.usb / 'Videos', 'one.mp4', b'video')
        self.put(self.usb, 'Adverts/ad.mp4', b'not a programme')
        plan = compare(self.usb, self.local)
        self.assertEqual(plan['usb'], str(self.usb / 'Videos'))
        self.assertEqual(plan['copy_to_external'], ['one.mp4'])

    def test_bad_registry_and_escape_fail_closed(self):
        self.put(self.local, 'a.mp4', b'a')
        with self.assertRaises(ValueError):
            exclude(self.usb, '../local/a.mp4')
        folder = self.usb / STATE
        folder.mkdir()
        (folder / 'excluded.json').write_text('{broken')
        with self.assertRaises(ValueError):
            apply(self.usb, self.local)
        self.assertFalse((self.usb / 'a.mp4').exists())


if __name__ == '__main__':
    unittest.main()
