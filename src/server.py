#!/usr/bin/env python3
"""Local UI/API and seekable USB media server. No runtime dependencies."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse
import argparse
import errno
import json
import logging
from logging.handlers import RotatingFileHandler
import mimetypes
import re
import secrets
import hmac
import sys
import threading
import time
import uuid
import webbrowser
import zipfile
from catalogue import Catalogue, CatalogueConflict
from media import analyse_breaks
from distribution import ASSETS
from library_paths import data_directory
from updater import install_update
import broadcasts
from session import LibrarySession
from imports import RESERVED_FOLDERS

APP_ROOT = Path(__file__).resolve().parent.parent
if getattr(sys, "frozen", False):
    executable = Path(sys.executable).resolve()
    APP_ROOT = executable.parent.parent.parent if executable.parent.parent.name == "Apps" else executable.parent
WEB_ROOT = Path(getattr(sys, "_MEIPASS", APP_ROOT)) / "web"
LIBRARY = None
SESSION = None
SCANS = None
ERROR_LOGGER = None
WRITE_TOKEN = secrets.token_hex(32)


def client_disconnected(error):
    """Video seeks and channel changes routinely cancel in-flight HTTP responses."""
    return isinstance(error, (BrokenPipeError, ConnectionResetError, ConnectionAbortedError)) or (
        isinstance(error, OSError) and (error.errno in (errno.EPIPE, errno.ECONNRESET, errno.ECONNABORTED)
                                      or getattr(error, "winerror", None) in (10053, 10054, 10058)))


def configure_error_log(root):
    global ERROR_LOGGER
    logger = logging.getLogger("USB.tv.server")
    logger.setLevel(logging.ERROR)
    logger.propagate = False
    for handler in logger.handlers[:]:
        handler.close()
        logger.removeHandler(handler)
    try:
        handler = RotatingFileHandler(data_directory(root) / "server-errors.log", maxBytes=1024*1024,
                                      backupCount=3, encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        logger.addHandler(handler)
        ERROR_LOGGER = logger
    except OSError as error:
        ERROR_LOGGER = None
        print(f"Could not create server diagnostic log: {error}", file=sys.stderr, flush=True)


class ScanJobs:
    """One background scanner; durable catalogue checkpoints and progress on USB."""
    def __init__(self, library):
        self.library = library
        self.path = library.data_root / "scan-job.json"
        self.lock = threading.RLock()
        self.stop_event = threading.Event()
        self.thread = None
        self.last_progress_save = 0
        self.state = {"status":"idle", "completed":0, "total":0, "errors":[], "changed":False}
        if self.path.exists():
            try:
                saved = json.loads(self.path.read_text(encoding="utf-8"))
                if isinstance(saved, dict):
                    self.state.update(saved)
                if self.state["status"] in ("running", "queued"):
                    self.state["status"] = "interrupted"
            except (OSError, ValueError):
                pass

    def status(self):
        with self.lock:
            return dict(self.state)

    def persist(self):
        temporary = self.path.with_suffix(".json.tmp")
        # Windows readers/security scanners can briefly deny atomic replacement.
        # This is a progress checkpoint, not the catalogue: retain live progress
        # and continue scanning if its file remains locked.
        for attempt in range(5):
            try:
                checkpoint = {key:value for key,value in self.state.items() if key != "checkpoint_warning"}
                temporary.write_text(json.dumps(checkpoint,ensure_ascii=False),encoding="utf-8")
                temporary.replace(self.path)
                self.state.pop("checkpoint_warning", None)
                return
            except PermissionError as error:
                if attempt < 4:
                    time.sleep(.025 * (2 ** attempt))
                    continue
                warning = f"Scan progress checkpoint is locked; scanning continues: {error}"
                if "checkpoint_warning" not in self.state:
                    if ERROR_LOGGER:
                        ERROR_LOGGER.warning(warning)
                    print(warning, file=sys.stderr, flush=True)
                self.state["checkpoint_warning"] = warning

    def start(self):
        with self.lock:
            if self.thread and self.thread.is_alive():
                return dict(self.state)
            self.stop_event.clear()
            self.state = {"id":uuid.uuid4().hex, "status":"running", "stage":"queued", "completed":0,
                          "total":0, "current":"", "errors":[], "error_count":0, "changed":False}
            self.persist()
            self.thread = threading.Thread(target=self.run, name="USB.tv scanner")
            self.thread.start()
            return dict(self.state)

    def progress(self, **values):
        with self.lock:
            if "errors" in values:
                values["error_count"] = len(values["errors"])
                values["errors"] = values["errors"][:50]
            previous_stage = self.state.get("stage")
            self.state.update(values)
            now = time.monotonic()
            if previous_stage != self.state.get("stage") or now - self.last_progress_save >= 1:
                self.persist()
                self.last_progress_save = now

    def run(self):
        before = None
        try:
            with self.library.lock:
                before = self.library.read()
            after = self.library.scan(progress=self.progress, cancelled=self.stop_event.is_set)
            self.progress(changed=before != after)
            scan_errors = list(self.state.get("errors", []))
            def audio_progress(**values):
                if "errors" in values:
                    values["errors"] = scan_errors + values["errors"]
                self.progress(**values)
            after = self.library.analyse_audio(progress=audio_progress, cancelled=self.stop_event.is_set)
            with self.lock:
                self.state.update(status="complete", stage="complete", current="", changed=before != after)
        except InterruptedError as error:
            with self.lock:
                self.state.update(status="interrupted", error=str(error), changed=True)
        except Exception as error:
            if ERROR_LOGGER:
                ERROR_LOGGER.exception("Background scan failed")
            with self.lock:
                self.state.update(status="failed", error=str(error), changed=True)
        finally:
            with self.lock:
                try:
                    self.persist()
                except OSError as error:
                    self.state.update(status="failed", error=f"Could not save scan status: {error}", changed=True)
                    if ERROR_LOGGER:
                        ERROR_LOGGER.exception("Could not save background scan status")
                    print(self.state["error"], file=sys.stderr, flush=True)

    def close(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join()


class SessionServer(ThreadingHTTPServer):
    # Finish pending metadata writes before releasing the library's session lock.
    daemon_threads = False

    def __init__(self, *args):
        self.stopping = threading.Event()
        super().__init__(*args)

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(30)
        return connection, address

    def handle_error(self, request, client_address):
        error = sys.exc_info()[1]
        if client_disconnected(error):
            return
        if ERROR_LOGGER:
            ERROR_LOGGER.error("Unhandled HTTP request error from %s", client_address, exc_info=True)
        super().handle_error(request, client_address)


class Handler(SimpleHTTPRequestHandler):
    def trusted_request(self):
        host = self.headers.get("Host", "")
        allowed = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
        origin = self.headers.get("Origin")
        return host in allowed and (origin is None or origin == f"http://{host}")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_ROOT), **kwargs)

    def handle(self):
        try:
            super().handle()
        except OSError as error:
            if not client_disconnected(error):
                raise

    def finish(self):
        try:
            super().finish()
        except OSError as error:
            if not client_disconnected(error):
                raise

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def send_json(self, data, status=200):
        payload = json.dumps(data, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def media_response(self, route, head=False):
        relative = Path(unquote(route.lstrip("/")))
        if not relative.parts or relative.parts[0] not in ("Videos", "Adverts"):
            return self.send_error(404)
        if any(part in RESERVED_FOLDERS for part in relative.parts):
            return self.send_error(404)
        try:
            target = LIBRARY.media_path(relative)
        except ValueError:
            return self.send_error(404)
        if not target.is_file():
            return self.send_error(404)
        try:
            with target.open("rb") as media:
                size = target.stat().st_size
                start, end, status = 0, size - 1, 200
                requested = self.headers.get("Range")
                if requested:
                    match = re.fullmatch(r"bytes=(\d*)-(\d*)", requested.strip())
                    if match and any(match.groups()) and size:
                        first, last = match.groups()
                        if first:
                            start = int(first)
                            end = min(int(last), size - 1) if last else size - 1
                        else:
                            start = max(0, size - int(last))
                        if start > end or start >= size:
                            match = None
                        status = 206
                    else:
                        match = None
                    if match is None:
                        self.send_response(416)
                        self.send_header("Content-Range", f"bytes */{size}")
                        self.send_header("Content-Length", "0")
                        self.end_headers()
                        return
                self.send_response(status)
                self.send_header("Content-Type", mimetypes.guess_type(str(target))[0] or "application/octet-stream")
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Content-Length", str(max(0, end - start + 1)))
                if status == 206:
                    self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
                self.end_headers()
                if head:
                    return
                media.seek(start)
                remaining = end - start + 1
                while remaining > 0:
                    chunk = media.read(min(1024 * 1024, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except OSError as error:
            if client_disconnected(error):
                return
            if isinstance(error, FileNotFoundError):
                return self.send_error(404)
            raise

    def do_HEAD(self):
        if not self.trusted_request():
            return self.send_error(403)
        route = urlparse(self.path).path
        if route.startswith(("/Videos/", "/Adverts/")):
            return self.media_response(route, head=True)
        if route != "/" and route.lstrip("/") not in ASSETS:
            return self.send_error(404)
        return super().do_HEAD()

    def do_GET(self):
        if not self.trusted_request():
            return self.send_error(403)
        if getattr(self.server, 'stopping', None) and self.server.stopping.is_set():
            return self.send_error(503, "USB.tv is restarting")
        route = urlparse(self.path).path
        try:
            if route == "/api/write-token":
                return self.send_json({"token": WRITE_TOKEN})
            if route == "/api/video-folder":
                return self.send_json(LIBRARY.folder_status())
            if route == "/api/audio":
                return self.send_json(LIBRARY.audio_status())
            if route == "/api/catalog":
                with LIBRARY.lock:
                    return self.send_json(LIBRARY.read())
            if route == "/api/broadcasts":
                with LIBRARY.lock:
                    return self.send_json(broadcasts.read(LIBRARY.root))
            if route == "/api/scan":
                return self.send_json(SCANS.status())
            if route.startswith(("/Videos/", "/Adverts/")):
                return self.media_response(route)
            if route != "/" and route.lstrip("/") not in ASSETS:
                return self.send_error(404)
            return super().do_GET()
        except (OSError, ValueError) as error:
            if client_disconnected(error):
                return
            if ERROR_LOGGER:
                ERROR_LOGGER.exception("GET %s failed", route)
            return self.send_json({"error": str(error)}, 500)

    def do_POST(self):
        if not self.trusted_request():
            return self.send_error(403)
        route = urlparse(self.path).path
        if route == "/api/session/stop":
            if not SESSION or not SESSION.authorized(self.headers.get("X-USBtv-Session")):
                return self.send_error(403)
            self.send_json({"stopping":True})
            if not self.server.stopping.is_set():
                self.server.stopping.set()
                print("A new USB.tv session is replacing this one. Closing…", flush=True)
                threading.Thread(target=self.server.shutdown, daemon=True).start()
            return
        if getattr(self.server, 'stopping', None) and self.server.stopping.is_set():
            return self.send_error(503, "USB.tv is restarting")
        if route not in ("/api/catalog", "/api/analyse", "/api/broadcasts", "/api/scan", "/api/video-folder"):
            return self.send_error(404)
        if (self.headers.get_content_type() != "application/json"
                or not hmac.compare_digest(self.headers.get("X-USBtv-Write", "").encode(), WRITE_TOKEN.encode())):
            return self.send_error(403)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 8_000_000:
                return self.send_error(413)
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError("Expected an object")
            if route == "/api/video-folder":
                if SCANS and SCANS.thread and SCANS.thread.is_alive():
                    raise ValueError("Wait for the scan to finish, or pause it before changing folders.")
                return self.send_json(LIBRARY.set_video_folder(data.get("path", "")))
            if route == "/api/scan":
                if data.get("action") == "pause":
                    SCANS.stop_event.set()
                    return self.send_json(SCANS.status(), 202)
                return self.send_json(SCANS.start(), 202)
            if route == "/api/broadcasts":
                with LIBRARY.lock:
                    updated = broadcasts.save(LIBRARY.root, data)
                    return self.send_json(updated or {"error":"Another window changed the schedule. Refresh before reshuffling."}, 200 if updated else 409)
            if route == "/api/catalog":
                if "revision" not in data:
                    raise CatalogueConflict("Refresh this page before saving with the updated server.")
                return self.send_json(LIBRARY.save_edits(data))
            with LIBRARY.lock:
                catalog = LIBRARY.read()
                item = next((item for item in catalog["videos"] if item["id"] == data.get("id") and not item.get("missing")), None)
                if not item:
                    raise ValueError("Unknown video")
                snapshot = dict(item)
            points, source = analyse_breaks(LIBRARY.media_path(snapshot["file"]), LIBRARY.root, snapshot["duration"])
            with LIBRARY.lock:
                catalog = LIBRARY.read()
                item = next((item for item in catalog["videos"] if item["id"] == snapshot["id"] and item["fingerprint"] == snapshot["fingerprint"]), None)
                if not item:
                    raise ValueError("The file changed during analysis; rescan and try again")
                item["suggested_break_points"], item["break_suggestion_source"] = points, source
                base_revision = catalog["revision"]
                LIBRARY.write(catalog)
            return self.send_json({"points": points, "source": source, "base_revision":base_revision, "revision":catalog["revision"]})
        except CatalogueConflict as error:
            return self.send_json({"error": str(error)}, 409)
        except (ValueError, OSError, RuntimeError) as error:
            if client_disconnected(error):
                return
            if ERROR_LOGGER and isinstance(error, OSError):
                ERROR_LOGGER.exception("POST %s failed", route)
            return self.send_json({"error": str(error)}, 400)

    def log_message(self, fmt, *args):
        if len(args) > 1 and str(args[1])[:1] in {"4", "5"}:
            super().log_message(fmt, *args)


def startup_message(url):
    return (f"USB.tv is running at {url}\n"
            "Keep this terminal open while watching. Closing the browser does not stop the server.\n\n"
            "BEFORE DISCONNECTING THE USB DRIVE:\n"
            "  1. Finish any copies, imports or scans.\n"
            "  2. Press Ctrl+C here and wait for 'USB.tv server stopped'.\n"
            "  3. Eject / Safely Remove the drive in your operating system, then unplug it.\n")


def main():
    global LIBRARY, WEB_ROOT, SESSION, SCANS
    parser = argparse.ArgumentParser(description="USB.tv local library")
    parser.add_argument("--library-root", type=Path, default=APP_ROOT)
    parser.add_argument("--no-browser", action="store_true", help="Start without opening a browser")
    parser.add_argument("--update-from", type=Path, help="Install a local all-platform update ZIP, then exit")
    options = parser.parse_args()
    if options.update_from:
        try:
            install_update(options.update_from, options.library_root)
        except (OSError, ValueError, zipfile.BadZipFile, RuntimeError) as error:
            parser.exit(1, f"Update failed: {error}\nClose USB.tv before updating and check the ZIP and free disk space.\n")
        return
    # Shared UI files on the USB can be updated once for every packaged platform.
    if all((options.library_root / "web" / name).is_file() for name in ASSETS):
        WEB_ROOT = options.library_root.resolve() / "web"
    elif all((options.library_root / name).is_file() for name in ASSETS):
        WEB_ROOT = options.library_root.resolve()
    try:
        with LibrarySession(options.library_root) as SESSION:
            LIBRARY = Catalogue(options.library_root)
            configure_error_log(LIBRARY.root)
            SCANS = ScanJobs(LIBRARY)
            server = SessionServer(("127.0.0.1", 0), Handler)
            try:
                SESSION.publish(server.server_port)
                SCANS.start()
                url = f"http://127.0.0.1:{server.server_port}/"
                print(startup_message(url), flush=True)
                if not options.no_browser:
                    browser_timer = threading.Timer(0.8, lambda: webbrowser.open(url))
                    browser_timer.daemon = True
                    browser_timer.start()
                server.serve_forever()
            finally:
                server.stopping.set()
                SCANS.close()
                server.server_close()
                print("USB.tv server stopped. Eject the drive safely before unplugging it.", flush=True)
    except KeyboardInterrupt:
        pass
    except (OSError, RuntimeError) as error:
        parser.exit(1, f"USB.tv could not start: {error}\n")


if __name__ == "__main__":
    main()
