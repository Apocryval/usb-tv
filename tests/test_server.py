import sys
from pathlib import Path as _TestPath
sys.path.insert(0, str(_TestPath(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(_TestPath(__file__).resolve().parents[1] / "scripts"))
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from catalogue import Catalogue
import server


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        server.LIBRARY = Catalogue(cls.temp.name, organise_new=False)
        cls.media = bytes(range(256)) * 16
        (Path(cls.temp.name) / 'Videos' / 'sample.mp4').write_bytes(cls.media)
        (Path(cls.temp.name) / 'Adverts' / 'ad.mp4').write_bytes(cls.media)
        server.LIBRARY.scan()
        server.SCANS = server.ScanJobs(server.LIBRARY)
        cls.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.base = f'http://127.0.0.1:{cls.http.server_port}'
        threading.Thread(target=cls.http.serve_forever, daemon=True).start()
        with urlopen(cls.base + '/api/write-token') as response:
            cls.write_headers = {'Content-Type':'application/json', 'X-USBtv-Write':json.load(response)['token']}

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        server.SCANS.close()
        cls.http.server_close()
        cls.temp.cleanup()

    def test_seek_ranges_both_folders(self):
        for path in ('Videos/sample.mp4', 'Adverts/ad.mp4'):
            for value, expected in [('bytes=100-199', self.media[100:200]), ('bytes=4000-', self.media[4000:]), ('bytes=-10', self.media[-10:])]:
                with urlopen(Request(self.base + '/' + path, headers={'Range': value})) as response:
                    self.assertEqual(response.status, 206)
                    self.assertEqual(response.read(), expected)
                    self.assertEqual(response.headers['Accept-Ranges'], 'bytes')
            with urlopen(Request(self.base + '/' + path, method='HEAD')) as response:
                self.assertEqual(int(response.headers['Content-Length']), len(self.media))
                self.assertEqual(response.read(), b'')

    def test_invalid_range_and_private_paths(self):
        for path, headers, status in [('/Videos/sample.mp4', {'Range':'bytes=9999-'}, 416), ('/Videos/%2e%2e/catalog.json', {}, 404), ('/catalog.json', {}, 404), ('/server.py', {}, 404)]:
            with self.assertRaises(HTTPError) as caught:
                urlopen(Request(self.base + path, headers=headers))
            self.assertEqual(caught.exception.code, status)
            caught.exception.close()

    def test_reorganised_web_assets_are_served_without_exposing_source_or_state(self):
        with urlopen(self.base + '/app.js') as response:
            self.assertIn(b'openQuickLabels', response.read())
        for path in ['/data/catalog.json', '/src/server.py', '/scripts/build.py', '/docs/PROJECT-HANDOFF.md', '/.local/backups/pre-layout-library/catalog.json']:
            with self.subTest(path=path), self.assertRaises(HTTPError) as caught:
                urlopen(self.base + path)
            self.assertEqual(caught.exception.code, 404)
            caught.exception.close()

    def test_catalogue_roundtrip_and_assets(self):
        with urlopen(self.base + '/api/catalog') as response:
            data = json.load(response)
        item = data['videos'][0]
        item.update(title='A real title', genres=['Comedy'], channels=['Bin TV'], duration=1200, tags=['goblins'], break_points=[900], breaks_approved=True)
        data['settings'].update(theme='goblin', crt=True)
        with urlopen(Request(self.base + '/api/catalog', data=json.dumps(data).encode(), headers=self.write_headers, method='POST')) as response:
            self.assertEqual(response.status, 200)
        with urlopen(Request(self.base + '/api/scan', data=b'{}', headers=self.write_headers)) as response:
            self.assertEqual(response.status, 202)
        deadline = time.monotonic() + 10
        while True:
            with urlopen(self.base + '/api/scan') as response:
                job = json.load(response)
            if job['status'] != 'running':
                break
            self.assertLess(time.monotonic(), deadline)
            time.sleep(.02)
        self.assertEqual(job['status'], 'complete')
        with urlopen(self.base + '/api/catalog') as response:
            saved = json.load(response)
        self.assertEqual(saved['videos'][0]['title'], 'A real title')
        self.assertEqual(saved['videos'][0]['break_points'], [900])
        self.assertTrue(saved['settings']['crt'])
        self.assertEqual(saved['settings']['theme'], 'goblin')
        for asset in server.ASSETS:
            with urlopen(self.base + '/' + asset) as response:
                self.assertEqual(response.status, 200)

    def test_writes_require_trusted_origin_token_and_json(self):
        for extra in ({'Origin':'https://unrelated.example'}, {'Host':'unrelated.example'},
                      {'X-USBtv-Write':''}, {'Content-Type':'text/plain'}):
            with self.assertRaises(HTTPError) as caught:
                urlopen(Request(self.base + '/api/scan', data=b'{}', headers={**self.write_headers, **extra}))
            self.assertEqual(caught.exception.code, 403)
            caught.exception.close()
        with self.assertRaises(HTTPError) as caught:
            urlopen(self.base + '/api/rescan')
        self.assertEqual(caught.exception.code, 404)
        caught.exception.close()

    def test_stale_catalogue_save_returns_conflict(self):
        with urlopen(self.base + '/api/catalog') as response:
            old = json.load(response)
        fresh = server.LIBRARY.save_edits({'videos':[], 'settings':{**old['settings'], 'theme':'teletext'}})
        with self.assertRaises(HTTPError) as caught:
            urlopen(Request(self.base + '/api/catalog', data=json.dumps(old).encode(), headers=self.write_headers))
        self.assertEqual(caught.exception.code, 409)
        caught.exception.close()
        self.assertEqual(server.LIBRARY.read(), fresh)

    def test_import_backups_and_staged_files_are_not_served(self):
        for directory in ['.usbtv-imports','.usbtv-originals']:
            folder=Path(self.temp.name)/'Videos'/directory
            folder.mkdir(exist_ok=True)
            (folder/'private.mp4').write_bytes(self.media)
            with self.assertRaises(HTTPError) as caught:
                urlopen(self.base+'/Videos/'+directory+'/private.mp4')
            self.assertEqual(caught.exception.code,404)
            caught.exception.close()


if __name__ == '__main__':
    unittest.main()
