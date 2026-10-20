import sys
from pathlib import Path as _TestPath
sys.path.insert(0, str(_TestPath(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(_TestPath(__file__).resolve().parents[1] / "scripts"))
import json
from pathlib import Path
import tempfile
import threading
import os
import time
import unittest
from unittest.mock import patch
from urllib.request import Request, urlopen
from urllib.error import HTTPError

from catalogue import Catalogue
import server


class VideoFolderTests(unittest.TestCase):
    def test_switching_external_folder_does_not_reuse_same_size_and_timestamp(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            library = Catalogue(root / 'app', organise_new=False)
            first, second = root / 'first', root / 'second'
            first.mkdir(); second.mkdir()
            (first / 'one.mp4').write_bytes(b'first')
            (second / 'one.mp4').write_bytes(b'other')
            stamp = (first / 'one.mp4').stat()
            os.utime(second / 'one.mp4', ns=(stamp.st_atime_ns, stamp.st_mtime_ns))
            with patch('catalogue.inspect_media', return_value={'duration': 30}):
                library.set_video_folder(str(first))
                original = library.scan()['videos'][0]['fingerprint']
                library.set_video_folder(str(second))
                changed = library.scan()['videos'][0]['fingerprint']
            self.assertNotEqual(original, changed)

    def test_external_files_are_untouched_until_preparation_is_enabled(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            library = Catalogue(root / 'app')
            external = root / 'external'
            external.mkdir()
            library.set_video_folder(str(external))
            first = external / 'Original name.mkv'
            first.write_bytes(b'original')
            os.utime(first, (time.time()-60, time.time()-60))
            with patch('catalogue.inspect_media', return_value={'duration':30}), patch('imports.convert_mp4') as convert:
                library.scan()
                convert.assert_not_called()
            self.assertEqual(first.read_bytes(), b'original')
            self.assertEqual(list(external.iterdir()), [first])
            library.save_edits({'videos':[], 'settings':{'prepare_external_imports':True}})
            second = external / 'Another file.mp4'
            second.write_bytes(b'another')
            os.utime(second, (time.time()-60, time.time()-60))
            with patch('catalogue.inspect_media', return_value={'duration':30}):
                library.scan()
            self.assertFalse(second.exists())
            self.assertTrue(first.exists())
            self.assertTrue(any(p.name.endswith(' - Another_file.mp4') for p in external.iterdir()))

    def test_external_scan_persistence_labels_and_default(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            library = Catalogue(root / 'app', organise_new=False)
            external = root / 'My videos'
            (external / 'Series').mkdir(parents=True)
            media = external / 'Series/episode.mp4'
            media.write_bytes(b'video content')
            with patch('catalogue.inspect_media', return_value={'duration': 120}):
                library.set_video_folder(str(external))
                data = library.scan()
                item = data['videos'][0]
                self.assertEqual(item['file'], 'Videos/Series/episode.mp4')
                item['title'] = 'Chosen title'
                library.save_edits(data)
                reopened = Catalogue(root / 'app', organise_new=False)
                self.assertEqual(reopened.media_path(item['file']), media)
                self.assertEqual(reopened.scan()['videos'][0]['title'], 'Chosen title')
                reopened.set_video_folder('')
                self.assertTrue(reopened.scan()['videos'][0]['missing'])
                reopened.set_video_folder(str(external))
                self.assertFalse(reopened.scan()['videos'][0]['missing'])
                media.unlink()
                media.parent.rmdir()
                external.rmdir()
                with self.assertRaisesRegex(ValueError, 'unavailable'):
                    reopened.scan()
                self.assertEqual(reopened.read()['videos'][0]['title'], 'Chosen title')

    def test_validation_and_active_scan(self):
        with tempfile.TemporaryDirectory() as directory:
            library = Catalogue(directory, organise_new=False)
            for value in ['relative/path', str(Path(directory) / 'nonexistent'), directory]:
                with self.assertRaises(ValueError):
                    library.set_video_folder(value)
            library.scan_lock.acquire()
            try:
                with self.assertRaisesRegex(ValueError, 'scan'):
                    library.set_video_folder('')
            finally:
                library.scan_lock.release()

    def test_external_http_ranges_and_traversal(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            library = Catalogue(root / 'app', organise_new=False)
            external = root / 'external'
            external.mkdir()
            (external / 'sample.mp4').write_bytes(b'0123456789')
            (root / 'private.txt').write_text('private')
            library.set_video_folder(str(external))
            with patch.object(server, 'LIBRARY', library):
                http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
                thread = threading.Thread(target=http.serve_forever, daemon=True)
                thread.start()
                base = f'http://127.0.0.1:{http.server_port}'
                try:
                    with urlopen(base + '/api/video-folder') as response:
                        self.assertEqual(json.load(response)['path'], str(external))
                    with urlopen(Request(base + '/Videos/sample.mp4', headers={'Range': 'bytes=2-4'})) as response:
                        self.assertEqual(response.status, 206)
                        self.assertEqual(response.read(), b'234')
                    for route in ['/Videos/%2e%2e/private.txt', '/Videos/%2e%2e%5cprivate.txt']:
                        with self.assertRaises(HTTPError) as error:
                            urlopen(base + route)
                        self.assertEqual(error.exception.code, 404)
                        error.exception.close()
                finally:
                    http.shutdown()
                    http.server_close()
                    thread.join()
