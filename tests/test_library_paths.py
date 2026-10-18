import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
import json
import tempfile
import unittest
from unittest.mock import patch
from library_paths import migrate_library_data, library_file
from catalogue import Catalogue
import broadcasts


class LibraryLayoutTests(unittest.TestCase):
    def test_flat_libraries_are_not_moved(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'catalog.json').write_text('{"videos":[]}')
            self.assertEqual(migrate_library_data(root),root)
            self.assertTrue((root/'catalog.json').exists())
            self.assertFalse((root/'data').exists())

    def test_new_layout_moves_saved_data_byte_for_byte_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'data').mkdir()
            payloads={'catalog.json':b'{"videos":[]}', 'broadcasts.json':b'{"channels":{},"revision":2}',
                      'video-folders.json':b'{}','scan-cache.jsonl':b'cached\n','server-errors.log':b'previous error'}
            for name,data in payloads.items():(root/name).write_bytes(data)
            migrate_library_data(root);migrate_library_data(root)
            for name,data in payloads.items():
                self.assertEqual((root/'data'/name).read_bytes(),data)
                self.assertFalse((root/name).exists())
            self.assertEqual(broadcasts.read(root)['revision'],2)

    def test_conflicting_data_is_preserved_and_migration_stops_before_any_move(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'data').mkdir()
            (root/'catalog.json').write_bytes(b'original');(root/'data/catalog.json').write_bytes(b'other')
            (root/'broadcasts.json').write_bytes(b'schedule')
            with self.assertRaisesRegex(ValueError,'different saved data'):migrate_library_data(root)
            self.assertEqual((root/'catalog.json').read_bytes(),b'original')
            self.assertEqual((root/'data/catalog.json').read_bytes(),b'other')
            self.assertTrue((root/'broadcasts.json').exists())

    def test_interrupted_migration_can_be_read_and_resumed(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'data').mkdir()
            for name in ['catalog.json','broadcasts.json']:(root/name).write_text(name)
            original=Path.replace
            def interrupted(source,target):
                if source.name=='broadcasts.json':raise OSError('interrupted')
                return original(source,target)
            with patch.object(Path,'replace',interrupted),self.assertRaises(OSError):migrate_library_data(root)
            self.assertEqual(library_file(root,'catalog.json').read_text(),'catalog.json')
            self.assertEqual(library_file(root,'broadcasts.json').read_text(),'broadcasts.json')
            migrate_library_data(root)
            self.assertTrue((root/'data/broadcasts.json').exists())

    def test_catalogue_state_moves_but_media_folders_stay_at_library_root(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'data').mkdir()
            (root/'catalog.json').write_text('{"version":2,"videos":[],"settings":{},"channels":[],"genres":[]}')
            library=Catalogue(root)
            self.assertEqual(library.path,root/'data/catalog.json')
            self.assertEqual(library.video_root,root/'Videos')
            self.assertEqual(library.media_path('Adverts/example.mp4'),root/'Adverts/example.mp4')
            library.write(library.read())
            self.assertEqual(json.loads((root/'data/catalog.json').read_text())['revision'],1)
