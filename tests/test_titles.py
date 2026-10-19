import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
import tempfile
import unittest
from unittest.mock import patch
from titles import title_from_path
from catalogue import Catalogue


class TitleTests(unittest.TestCase):
    def test_filename_cleanup_preserves_case_dates_and_episode_markers(self):
        self.assertEqual(title_from_path('Videos/0042 - Planet_Earth_s01e02_1080p_x264_AAC.mp4'), 'Planet Earth — S01E02')
        self.assertEqual(title_from_path('Videos/NASA - Launch_2024-06-12_720p.mp4'), 'NASA - Launch 2024-06-12')
        self.assertEqual(title_from_path('Videos/Show.S01E02.WEB-DL.H.264.mkv'), 'Show — S01E02')

    def test_folder_context_is_used_only_for_identifiable_episode_numbers(self):
        self.assertEqual(title_from_path('Videos/Planet Earth/Season 1/02.mp4'), 'Planet Earth — S01E02')
        self.assertEqual(title_from_path('Videos/Planet Earth/E03.mp4'), 'Planet Earth — Episode 03')
        for path in ['Videos/0042.mp4','Videos/02.mp4','Videos/video_123.mp4','Videos/untitled.mp4','Videos/Season 1/02.mp4','Videos/ab1234cd5678ef90.mp4']:
            self.assertEqual(title_from_path(path), '', path)

    def test_original_filename_is_preferred_to_import_renaming(self):
        self.assertEqual(title_from_path('Videos/0003 - damaged_name.mp4', 'NASA_Documentary_1080p.mkv'), 'NASA Documentary')

    def test_scan_backfills_titles_without_overwriting_existing_or_reviewed_titles(self):
        with tempfile.TemporaryDirectory() as root:
            catalog=Catalogue(root, organise_new=False)
            folder=Path(root)/'Videos'
            (folder/'Great_Documentary_1080p.mp4').write_bytes(b'video bytes')
            with patch('catalogue.inspect_media', return_value={'duration':60,'title':''}):
                data=catalog.scan()
                self.assertEqual(data['videos'][0]['title'], 'Great Documentary')
                self.assertEqual(data['videos'][0]['title_source'], 'filename')
                data=catalog.save_edits(data)
                self.assertEqual(data['videos'][0]['title_source'], 'filename')
                data['videos'][0]['title_source']='manual'
                data=catalog.save_edits(data)
                self.assertEqual(data['videos'][0]['title_source'], 'manual')
                data['videos'][0]['title']='My own title'
                catalog.save_edits(data)
                self.assertEqual(catalog.scan()['videos'][0]['title'], 'My own title')
                data=catalog.read();data['videos'][0]['title']='';catalog.save_edits(data)
                self.assertEqual(catalog.scan()['videos'][0]['title'], '')

    def test_embedded_title_wins(self):
        with tempfile.TemporaryDirectory() as root:
            catalog=Catalogue(root, organise_new=False)
            (Path(root)/'Videos'/'filename.mp4').write_bytes(b'video bytes')
            with patch('catalogue.inspect_media', return_value={'duration':60,'title':'Official title'}):
                item=catalog.scan()['videos'][0]
                self.assertEqual(item['title'],'Official title')
                self.assertEqual(item['title_source'],'embedded')
