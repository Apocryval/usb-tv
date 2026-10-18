import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

from catalogue import Catalogue
from imports import ImportManager, fingerprint
from test_catalogue import mp4


class ImportTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.library = Catalogue(self.root)

    def add(self, name, content=None):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(mp4(30, 'Embedded title') if content is None else content)
        os.utime(path, (time.time()-60, time.time()-60))
        return path

    @staticmethod
    def converted(source, destination, root, cancelled):
        Path(destination).write_bytes(mp4(30, 'Converted title'))

    def test_existing_labels_and_filenames_stay_unchanged_and_numbering_uses_filename_maximum(self):
        old = self.add('Videos/1676 - Existing.mp4')
        data = self.library.scan()
        data['videos'][0].update(title='Hand labelled', channels=['My channel'], genres=['Comedy'])
        self.library.save_edits(data)
        legacy = self.add('Videos/legacy unnumbered.mp4')
        self.library.organise_new = False
        self.library.scan()
        self.library.organise_new = True
        incoming = self.add('Videos/New clip [HD].mp4')
        result = self.library.scan()
        self.assertTrue(old.exists())
        self.assertTrue(legacy.exists())
        self.assertFalse(incoming.exists())
        target = self.root/'Videos/1677 - New_clip_HD.mp4'
        self.assertTrue(target.exists())
        self.assertEqual(next(v for v in result['videos'] if v['file'].endswith('Existing.mp4'))['title'], 'Hand labelled')
        self.assertEqual(next(v for v in result['videos'] if v.get('reference_number') == 1677)['id'], '000003')

    def test_numbering_is_shared_by_subfolders_and_adverts_and_new_mp4s_are_not_reencoded(self):
        self.add('Videos/0042 - Existing.mp4')
        self.library.scan()
        for path in ['Videos/One clip.mp4','Videos/Series/Two clip.mp4','Adverts/New advert.mp4']:
            self.add(path)
        with patch('imports.convert_mp4') as convert:
            result = self.library.scan()
        convert.assert_not_called()
        self.assertEqual({v.get('reference_number') for v in result['videos']}, {42,43,44,45})
        self.assertEqual(len(self.library.discover()),4)

    def test_conversion_archives_the_original_and_does_not_scan_it_again(self):
        original = self.add('Videos/New movie.webm',b'original-container')
        digest=fingerprint(original)
        with patch('imports.convert_mp4',side_effect=self.converted):
            result=self.library.scan()
        item=result['videos'][0]
        self.assertEqual(item['file'],'Videos/0001 - New_movie.mp4')
        self.assertFalse(original.exists())
        self.assertEqual(fingerprint(self.library.media_path(item['original_backup'])),digest)
        self.assertEqual(len(self.library.discover()),1)
        again=self.library.scan()
        self.assertEqual(again['videos'][0]['id'],item['id'])
        self.assertEqual(again['videos'][0]['original_fingerprint'],digest)

    def test_interrupted_conversion_keeps_original_and_reuses_reserved_reference(self):
        original=self.add('Videos/First.mkv',b'original')
        with patch('imports.convert_mp4',side_effect=InterruptedError('paused')):
            with self.assertRaises(InterruptedError):self.library.scan()
        self.assertTrue(original.exists())
        self.assertEqual(self.library.read()['videos'],[])
        self.add('Videos/Second.mp4')
        with patch('imports.convert_mp4',side_effect=self.converted):
            result=Catalogue(self.root).scan()
        self.assertEqual({v['reference_number'] for v in result['videos']},{1,2})
        self.assertTrue((self.root/'Videos/0001 - First.mp4').exists())

    def test_recovery_after_publication_finishes_without_duplicate_entries(self):
        original=self.add('Videos/One.mp4')
        with patch.object(ImportManager,'finish',side_effect=InterruptedError('stopped after publish')):
            with self.assertRaises(InterruptedError):self.library.scan()
        self.assertFalse(original.exists())
        self.assertTrue((self.root/'Videos/0001 - One.mp4').exists())
        result=Catalogue(self.root).scan()
        self.assertEqual(len(result['videos']),1)
        self.assertEqual(result['videos'][0]['reference_number'],1)

    def test_recently_added_files_are_left_alone_until_they_settle(self):
        path=self.add('Videos/Copying.mp4')
        os.utime(path,None)
        result=self.library.scan()
        self.assertEqual(result['videos'],[])
        self.assertTrue(path.exists())
        os.utime(path,(time.time()-60,time.time()-60))
        self.assertEqual(self.library.scan()['videos'][0]['file'],'Videos/0001 - Copying.mp4')

    def test_a_concurrent_filename_collision_never_overwrites_the_other_file(self):
        source=self.add('Videos/New.mp4')
        other_content=mp4(45,'Another file')
        real_move=ImportManager.move
        hit=[]
        def racing_move(manager,original,target,cancelled,claimed=None):
            if not hit and target.parent==self.root/'Videos':
                target.write_bytes(other_content);hit.append(target)
            return real_move(manager,original,target,cancelled,claimed)
        with patch.object(ImportManager,'move',racing_move):self.library.scan()
        self.assertTrue(source.exists())
        self.assertEqual(hit[0].read_bytes(),other_content)
        self.library.scan()
        self.assertEqual(hit[0].read_bytes(),other_content)
        self.assertTrue((self.root/'Videos/0002 - New.mp4').exists())

    def test_imports_can_be_disabled_and_staged_or_original_files_are_never_discovered(self):
        path=self.add('Videos/Leave name.mp4')
        self.add('Videos/.usbtv-imports/partial.mp4')
        self.add('Videos/.usbtv-originals/old.mp4')
        data=self.library.read();data['settings']['auto_imports']=False;self.library.write(data)
        result=self.library.scan()
        self.assertTrue(path.exists())
        self.assertEqual([v['file'] for v in result['videos']],['Videos/Leave name.mp4'])

    def test_duplicate_user_reference_keeps_one_and_assigns_next_number_to_the_other(self):
        self.add('Videos/0007 - A.mp4')
        self.add('Videos/0007 - B.mp4',mp4(31,'Other'))
        result=self.library.scan()
        self.assertEqual({v['reference_number'] for v in result['videos']},{7,8})

    def test_interrupted_exfat_publication_recovers_the_staged_output_without_reconverting(self):
        source=self.add('Videos/One.mkv',b'original')
        real_move=ImportManager.move
        interrupted=[]
        def partial_copy(manager,original,target,cancelled,claimed=None):
            if not interrupted and target.parent==self.root/'Videos':
                target.write_bytes(b'incomplete output')
                claimed();interrupted.append(True)
                raise InterruptedError('paused while copying')
            return real_move(manager,original,target,cancelled,claimed)
        with patch('imports.convert_mp4',side_effect=self.converted) as convert:
            with patch.object(ImportManager,'move',partial_copy):
                with self.assertRaises(InterruptedError):self.library.scan()
            self.assertTrue(source.exists())
            result=Catalogue(self.root).scan()
            self.assertEqual(convert.call_count,1)
        self.assertEqual(len(result['videos']),1)
        self.assertEqual(result['videos'][0]['reference_number'],1)
        self.assertEqual(self.library.media_path(result['videos'][0]['original_backup']).read_bytes(),b'original')

    def test_interrupted_original_archive_retains_and_recovers_original_contents(self):
        source=self.add('Videos/One.mkv',b'original')
        real_move=ImportManager.move
        def partial_archive(manager,original,target,cancelled,claimed=None):
            if '.usbtv-originals' in target.parts:
                target.parent.mkdir(parents=True,exist_ok=True)
                target.write_bytes(b'partial');claimed()
                raise InterruptedError('paused while archiving')
            return real_move(manager,original,target,cancelled,claimed)
        with patch('imports.convert_mp4',side_effect=self.converted):
            with patch.object(ImportManager,'move',partial_archive):
                with self.assertRaises(InterruptedError):self.library.scan()
        self.assertTrue(source.exists())
        result=Catalogue(self.root).scan()
        self.assertEqual(len(result['videos']),1)
        self.assertEqual(self.library.media_path(result['videos'][0]['original_backup']).read_bytes(),b'original')

    def test_an_input_changed_after_conversion_does_not_publish_a_stale_partial_video_later(self):
        source=self.add('Videos/One.mkv',b'initial content')
        real_finish=ImportManager.finish
        def source_changed(manager,job,cancelled):
            source.write_bytes(b'copy has now finished')
            return real_finish(manager,job,cancelled)
        with patch('imports.convert_mp4',side_effect=self.converted):
            with patch.object(ImportManager,'finish',source_changed):
                self.assertEqual(self.library.scan()['videos'],[])
            self.assertTrue(source.exists())
            os.utime(source,(time.time()-60,time.time()-60))
            result=self.library.scan()
        self.assertEqual(len(result['videos']),1)
        self.assertEqual(self.library.media_path(result['videos'][0]['original_backup']).read_bytes(),b'copy has now finished')
        self.assertEqual(len(self.library.scan()['videos']),1)
