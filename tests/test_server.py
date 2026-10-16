import json
import tempfile
import threading
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
        server.LIBRARY = Catalogue(cls.temp.name)
        cls.media = bytes(range(256)) * 16
        (Path(cls.temp.name) / 'Videos' / 'sample.mp4').write_bytes(cls.media)
        (Path(cls.temp.name) / 'Adverts' / 'ad.mp4').write_bytes(cls.media)
        server.LIBRARY.scan()
        cls.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.base = f'http://127.0.0.1:{cls.http.server_port}'
        threading.Thread(target=cls.http.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
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

    def test_catalogue_roundtrip_and_assets(self):
        with urlopen(self.base + '/api/catalog') as response:
            data = json.load(response)
        item = data['videos'][0]
        item.update(title='A real title', genres=['Comedy'], channels=['Bin TV'], duration=1200, tags=['goblins'], break_points=[900], breaks_approved=True)
        data['settings'].update(theme='goblin', crt=True)
        with urlopen(Request(self.base + '/api/catalog', data=json.dumps(data).encode(), headers={'Content-Type':'application/json'}, method='POST')) as response:
            self.assertEqual(response.status, 200)
        with urlopen(self.base + '/api/rescan') as response:
            saved = json.load(response)
        self.assertEqual(saved['videos'][0]['title'], 'A real title')
        self.assertEqual(saved['videos'][0]['break_points'], [900])
        self.assertTrue(saved['settings']['crt'])
        self.assertEqual(saved['settings']['theme'], 'goblin')
        for asset in server.ASSETS:
            with urlopen(self.base + '/' + asset) as response:
                self.assertEqual(response.status, 200)


if __name__ == '__main__':
    unittest.main()
