import sys
from pathlib import Path as _TestPath
sys.path.insert(0, str(_TestPath(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(_TestPath(__file__).resolve().parents[1] / "scripts"))
import json
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from catalogue import Catalogue, CatalogueConflict
from media import inspect_mp4, suggest_breaks


def box(kind, payload):
    return struct.pack('>I4s', 8 + len(payload), kind) + payload


def mp4(duration=1800, title='A proper display title'):
    mvhd = box(b'mvhd', b'\0' * 12 + struct.pack('>II', 1000, duration * 1000) + b'\0' * 80)
    name = box(b'\xa9nam', box(b'data', b'\0' * 8 + title.encode()))
    meta = box(b'meta', b'\0' * 4 + box(b'ilst', name))
    return box(b'ftyp', b'isom\0\0\0\0isom') + box(b'moov', mvhd + box(b'udta', meta))


class CatalogueTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.catalog = Catalogue(self.root, organise_new=False)

    def test_mp4_title_preferred_and_filename_title_used_when_missing(self):
        path = self.root / 'Videos' / 'messy_892_xxx.mp4'
        path.write_bytes(mp4())
        with patch('media.tool_path', return_value=None):
            item = self.catalog.scan()['videos'][0]
        self.assertEqual(item['title'], 'A proper display title')
        self.assertEqual(item['duration'], 1800)
        path = self.root / 'Adverts' / 'ugly_name.mp4'
        path.write_bytes(mp4(30, ''))
        item = next(v for v in self.catalog.scan()['videos'] if v['file'].startswith('Adverts/'))
        self.assertEqual(item['title'], 'ugly name')
        self.assertEqual(item['title_source'], 'filename')
        self.assertEqual(item['type'], 'advert')
        self.assertEqual(item['channels'], [])

    def test_bumper_role_survives_save_and_rescan(self):
        (self.root / 'Videos' / 'bumper.mp4').write_bytes(mp4(duration=5))
        data = self.catalog.scan()
        data['videos'][0].update(type='bumper', bumper_role='from_ads', channels=[])
        saved = self.catalog.save_edits(data)
        self.assertEqual(saved['videos'][0]['type'], 'bumper')
        self.assertEqual(saved['videos'][0]['bumper_role'], 'from_ads')
        rescanned = self.catalog.scan()['videos'][0]
        self.assertEqual(rescanned['type'], 'bumper')
        self.assertEqual(rescanned['bumper_role'], 'from_ads')
        data = self.catalog.read()
        data['videos'][0]['bumper_role'] = 'both'
        self.assertEqual(self.catalog.save_edits(data)['videos'][0]['bumper_role'], 'both')

    def test_identity_rename_duplicate_missing_and_edits(self):
        path = self.root / 'Videos' / 'one.mp4'
        path.write_bytes(mp4())
        data = self.catalog.scan()
        original = data['videos'][0]['id']
        data['videos'][0].update(title='My chosen title', genres=['Comedy', 'Strange'], channels=['Bin TV', 'Oddities'], tags=['goblins'], break_points=[900], breaks_approved=True)
        self.catalog.save_edits(data)
        path.rename(self.root / 'Videos' / 'renamed.mp4')
        data = self.catalog.scan()
        item = data['videos'][0]
        self.assertEqual(item['id'], original)
        self.assertEqual(item['title'], 'My chosen title')
        self.assertEqual(item['break_points'], [900])
        (self.root / 'Videos' / 'copy.mp4').write_bytes(mp4())
        data = self.catalog.scan()
        self.assertEqual(len({v['id'] for v in data['videos']}), 2)
        self.assertTrue(any(v.get('duplicate_of') for v in data['videos']))
        (self.root / 'Videos' / 'renamed.mp4').unlink()
        data = self.catalog.scan()
        self.assertTrue(next(v for v in data['videos'] if v['id'] == original)['missing'])
        (self.root / 'Videos' / 'renamed.mp4').write_bytes(mp4())
        data = self.catalog.scan()
        self.assertEqual(next(v for v in data['videos'] if v['id'] == original)['title'], 'My chosen title')

    def test_v1_migration_backup_and_changed_file_reprobe(self):
        path = self.root / 'Videos' / 'one.mp4'
        path.write_bytes(mp4())
        legacy = {'version':1, 'settings':{'theme':'goblin','crt':True},'videos':[{'file':'Videos/one.mp4','title':'Hand edited','genre':'Comedy','channels':['Bin TV'],'duration':1800}]}
        self.catalog.path.write_text(json.dumps(legacy))
        data = self.catalog.scan()
        self.assertEqual(data['version'], 2)
        self.assertEqual(data['videos'][0]['genres'], ['Comedy'])
        self.assertEqual(json.loads((self.root / 'catalog.v1.backup.json').read_text()), legacy)
        data['videos'][0].update(break_points=[900], breaks_approved=True)
        self.catalog.save_edits(data)
        path.write_bytes(mp4(1200, 'Other embedded title'))
        item = self.catalog.scan()['videos'][0]
        self.assertEqual(item['title'], 'Hand edited')
        self.assertEqual(item['duration'], 1200)
        self.assertFalse(item['breaks_approved'])
        self.assertEqual(item['break_points'], [])
        self.assertEqual(self.catalog.read()['settings']['theme'], 'goblin')

    def test_read_only_identity_browser_probe_and_validation(self):
        (self.root / 'Videos' / 'unknown.webm').write_bytes(b'not actual media')
        data = self.catalog.scan()
        data['videos'][0].update(duration=1900, file='Videos/evil.mp4')
        saved = self.catalog.save_edits(data)['videos'][0]
        self.assertEqual(saved['file'], 'Videos/unknown.webm')
        self.assertNotEqual(saved['fingerprint'], 'forged')
        self.assertEqual(saved['suggested_break_points'], [900])
        self.assertFalse(saved['breaks_approved'])
        data['videos'][0]['id'] = '999999'
        with self.assertRaises(ValueError):
            self.catalog.save_edits(data)

    def test_stale_snapshots_and_changed_content_are_rejected(self):
        path = self.root / 'Videos/one.mp4'
        path.write_bytes(mp4())
        old = self.catalog.scan()
        fresh = self.catalog.save_edits({'videos':[{'id':old['videos'][0]['id'], 'title':'New title'}]})
        with self.assertRaises(CatalogueConflict):
            self.catalog.save_edits(old)
        self.assertEqual(self.catalog.read(), fresh)
        with self.assertRaises(CatalogueConflict):
            self.catalog.save_edits({'videos':[{'id':old['videos'][0]['id'], 'fingerprint':'forged', 'title':'Wrong file'}]})
        self.assertEqual(self.catalog.read(), fresh)

    def test_corrupt_catalogue_not_overwritten(self):
        self.catalog.path.write_text('broken')
        with self.assertRaises(ValueError):
            self.catalog.scan()
        self.assertEqual(self.catalog.path.read_text(), 'broken')

    def test_suggestions_not_near_edges(self):
        points, source = suggest_breaks(2000, [0, 850, 1820])
        self.assertEqual(points, [850, 1820])
        self.assertEqual(source, 'chapters')
        points, source = suggest_breaks(180, candidates=[90])
        self.assertEqual(points, [])

    def test_missing_legacy_item_has_editable_metadata(self):
        self.catalog.path.write_text(json.dumps({'version':1,'videos':[{'file':'Videos/missing.mp4','genre':'Comedy','title':'Old title'}]}))
        item=self.catalog.scan()['videos'][0]
        self.assertTrue(item['missing'])
        self.assertEqual(item['genres'], ['Comedy'])
        self.assertEqual(item['channels'], [])
        self.assertEqual(item['type'], 'programme')
        self.assertEqual(item['break_points'], [])

    def test_bulk_labels_new_channels_and_rules_survive_rescan(self):
        for name in ('a.mp4', 'b.mp4'):
            (self.root / 'Videos' / name).write_bytes(mp4())
        data=self.catalog.scan()
        for item in data['videos']:
            item.update(genres=['Science','Animation'],channels=['Explore'])
        data['label_rules']=[{'keyword':'kurzgesagt','genres':['Science','Animation'],'channels':['Explore']}]
        self.catalog.save_edits(data)
        saved=self.catalog.scan()
        self.assertEqual(saved['label_rules'], data['label_rules'])
        self.assertIn('Explore', [channel['name'] for channel in saved['channels']])
        self.assertTrue(all(item['genres']==['Science','Animation'] for item in saved['videos']))


if __name__ == '__main__':
    unittest.main()
