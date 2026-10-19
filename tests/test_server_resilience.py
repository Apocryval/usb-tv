import sys
from pathlib import Path as _TestPath
sys.path.insert(0, str(_TestPath(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(_TestPath(__file__).resolve().parents[1] / "scripts"))
import contextlib
import io
import json
import socket
import struct
import sys
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.request import urlopen

import server
from catalogue import Catalogue


class ServerResilienceTests(unittest.TestCase):
    def test_startup_reminder_explains_server_shutdown_and_disk_ejection(self):
        message = server.startup_message('http://127.0.0.1:12345/')
        self.assertIn('http://127.0.0.1:12345/', message)
        self.assertIn('Closing the browser does not stop the server', message)
        self.assertIn('Ctrl+C', message)
        self.assertIn('Eject / Safely Remove', message)

    def test_stop_message_is_printed_after_scan_and_server_shutdown(self):
        with tempfile.TemporaryDirectory() as directory:
            output = io.StringIO()
            scans = Mock()
            scans.close.side_effect = lambda: print('SCAN_CLOSED')
            http = Mock()
            http.server_port = 12345
            http.serve_forever.side_effect = KeyboardInterrupt
            http.server_close.side_effect = lambda: print('HTTP_CLOSED')
            with patch.object(server, 'LibrarySession'), patch.object(server, 'Catalogue'), \
                    patch.object(server, 'configure_error_log'), patch.object(server, 'ScanJobs', return_value=scans), \
                    patch.object(server, 'SessionServer', return_value=http), \
                    patch('sys.argv', ['server.py', '--library-root', directory, '--no-browser']), \
                    contextlib.redirect_stdout(output):
                server.main()
            text = output.getvalue()
            self.assertLess(text.index('SCAN_CLOSED'), text.index('USB.tv server stopped.'))
            self.assertLess(text.index('HTTP_CLOSED'), text.index('USB.tv server stopped.'))

    def test_disconnects_are_recognised_without_hiding_storage_errors(self):
        for error in (BrokenPipeError(), ConnectionResetError(), ConnectionAbortedError()):
            self.assertTrue(server.client_disconnected(error))
        windows_error = OSError('An established connection was aborted')
        windows_error.winerror = 10053
        self.assertTrue(server.client_disconnected(windows_error))
        self.assertFalse(server.client_disconnected(PermissionError('Read-only drive')))
        self.assertFalse(server.client_disconnected(OSError(28, 'Disk full')))

    def test_api_disconnect_does_not_attempt_another_response(self):
        handler = server.Handler.__new__(server.Handler)
        handler.path = '/api/catalog'
        handler.server = Mock(stopping=threading.Event())
        handler.trusted_request = Mock(return_value=True)
        handler.send_json = Mock(side_effect=ConnectionAbortedError('client cancelled'))
        library = Mock(lock=threading.RLock())
        library.read.return_value = {'videos': []}
        with patch.object(server, 'LIBRARY', library):
            handler.do_GET()
        self.assertEqual(handler.send_json.call_count, 1)

    def test_response_flush_disconnect_is_quiet_but_other_io_errors_propagate(self):
        handler = server.Handler.__new__(server.Handler)
        for method in ('handle', 'finish'):
            with patch.object(server.SimpleHTTPRequestHandler, method, side_effect=ConnectionAbortedError()):
                getattr(handler, method)()
            with patch.object(server.SimpleHTTPRequestHandler, method, side_effect=PermissionError()):
                with self.assertRaises(PermissionError):
                    getattr(handler, method)()

    def test_repeated_aborted_streams_do_not_break_api_or_leak_request_threads(self):
        with tempfile.TemporaryDirectory() as directory:
            library = Catalogue(directory, organise_new=False)
            media = Path(directory) / 'Videos' / 'large.mp4'
            with media.open('wb') as output:
                output.truncate(8 * 1024 * 1024)
            errors = io.StringIO()
            previous = server.LIBRARY
            server.LIBRARY = library
            http = server.SessionServer(('127.0.0.1', 0), server.Handler)
            thread = threading.Thread(target=http.serve_forever)
            thread.start()
            try:
                def abort_stream(index):
                    connection = socket.create_connection(http.server_address, timeout=10)
                    linger = struct.pack('hh' if sys.platform == 'win32' else 'ii', 1, 0)
                    connection.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, linger)
                    connection.sendall(f'GET /Videos/large.mp4 HTTP/1.0\r\nHost: 127.0.0.1:{http.server_port}\r\nRange: bytes=0-\r\n\r\n'.encode())
                    self.assertIn(b'206', connection.recv(200))
                    connection.close()
                with contextlib.redirect_stderr(errors):
                    with ThreadPoolExecutor(max_workers=8) as pool:
                        list(pool.map(abort_stream, range(120)))
                    with urlopen(f'http://127.0.0.1:{http.server_port}/api/catalog', timeout=10) as response:
                        self.assertIn('videos', json.load(response))
                    http.shutdown()
                    http.server_close()
                    thread.join(10)
                self.assertNotIn('Traceback', errors.getvalue())
                self.assertNotIn('Exception occurred', errors.getvalue())
                self.assertFalse(thread.is_alive())
                self.assertFalse(any(t.is_alive() for t in getattr(http, '_threads', [])))
            finally:
                http.shutdown()
                http.server_close()
                server.LIBRARY = previous

    def test_unexpected_request_errors_are_logged_and_connections_have_timeouts(self):
        with tempfile.TemporaryDirectory() as directory:
            previous = server.ERROR_LOGGER
            server.configure_error_log(directory)
            http = server.SessionServer(('127.0.0.1', 0), server.Handler)
            try:
                connection = socket.create_connection(http.server_address, timeout=5)
                accepted, address = http.get_request()
                self.assertEqual(accepted.gettimeout(), 30)
                accepted.close()
                connection.close()
                with contextlib.redirect_stderr(io.StringIO()):
                    try:
                        raise RuntimeError('diagnostic-test-marker')
                    except RuntimeError:
                        http.handle_error(None, ('127.0.0.1', 1))
                self.assertIn('diagnostic-test-marker', (Path(directory) / 'server-errors.log').read_text(encoding='utf-8'))
            finally:
                http.server_close()
                for handler in server.ERROR_LOGGER.handlers[:]:
                    handler.close()
                    server.ERROR_LOGGER.removeHandler(handler)
                server.ERROR_LOGGER = previous

    def test_scan_checkpoint_retries_a_temporary_windows_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            job = server.ScanJobs(Catalogue(directory, organise_new=False))
            original = Path.replace
            attempts = []
            def replace(path, target):
                attempts.append(path)
                if len(attempts) < 3:
                    raise PermissionError('sharing violation')
                return original(path, target)
            with patch.object(Path, 'replace', replace), patch.object(server.time, 'sleep'):
                job.persist()
            self.assertEqual(len(attempts), 3)
            self.assertEqual(json.loads(job.path.read_text())['status'], 'idle')
            self.assertNotIn('checkpoint_warning', job.status())

    def test_locked_progress_file_does_not_abort_scan_and_recovers(self):
        with tempfile.TemporaryDirectory() as directory:
            library = Catalogue(directory, organise_new=False)
            job = server.ScanJobs(library)
            data = library.read()
            with patch.object(library, 'scan', side_effect=lambda **kw: (kw['progress'](completed=25), data)[1]), \
                    patch.object(library, 'analyse_audio', return_value=data), \
                    patch.object(Path, 'replace', side_effect=PermissionError('sharing violation')), \
                    patch.object(server.time, 'sleep'), contextlib.redirect_stderr(io.StringIO()):
                job.run()
            self.assertEqual(job.status()['status'], 'complete')
            self.assertIn('checkpoint_warning', job.status())
            job.persist()
            self.assertNotIn('checkpoint_warning', job.status())
            self.assertEqual(json.loads(job.path.read_text())['status'], 'complete')

    def test_scan_status_write_failure_is_reported_without_crashing_worker(self):
        with tempfile.TemporaryDirectory() as directory:
            library = Catalogue(directory, organise_new=False)
            job = server.ScanJobs(library)
            data = library.read()
            with patch.object(library, 'scan', return_value=data), patch.object(library, 'analyse_audio', return_value=data), \
                    patch.object(job, 'persist', side_effect=OSError('disk full')), contextlib.redirect_stderr(io.StringIO()):
                job.run()
            self.assertEqual(job.status()['status'], 'failed')
            self.assertIn('disk full', job.status()['error'])


if __name__ == '__main__':
    unittest.main()
