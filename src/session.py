"""One local server per library, with authenticated, graceful replacement."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import sys
import time
from urllib.request import Request, build_opener, ProxyHandler


class LibrarySession:
    def __init__(self, root):
        if sys.platform == "darwin":
            cache = Path.home() / "Library/Caches/USB.tv"
        elif sys.platform == "win32":
            cache = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData/Local")) / "USB.tv"
        else:
            cache = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "usb-tv"
        directory = cache / "sessions"
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        identity = hashlib.sha256(os.path.normcase(str(Path(root).resolve())).encode()).hexdigest()
        self.path = directory / (identity + ".json")
        self.lock_path = directory / (identity + ".lock")
        self.handle = None
        self.owned = False
        self.token = secrets.token_hex(32)

    def _lock(self):
        try:
            if sys.platform == "win32":
                import msvcrt
                self.handle.seek(0)
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.owned = True
            return True
        except (BlockingIOError, OSError):
            return False

    def acquire(self):
        self.handle = self.lock_path.open("a+b")
        if self.lock_path.stat().st_size == 0:
            self.handle.write(b"0"); self.handle.flush()
        opener = build_opener(ProxyHandler({}))  # Loopback control never uses a proxy.
        deadline = time.monotonic() + 20
        announced = False
        try:
            while not self._lock():
                if not announced:
                    print("Closing the previous USB.tv session for this library…", flush=True)
                    announced = True
                if time.monotonic() >= deadline:
                    raise RuntimeError("The previous USB.tv session is still busy. Close its terminal, or wait for its current scan/analysis to finish, then launch again.")
                try:
                    previous = json.loads(self.path.read_text(encoding="utf-8"))
                    port, token = previous.get("port"), previous.get("token")
                    if isinstance(port, int) and 0 < port < 65536 and isinstance(token, str):
                        request = Request(f"http://127.0.0.1:{port}/api/session/stop", data=b"{}",
                                          headers={"X-USBtv-Session": token, "Content-Type":"application/json"})
                        with opener.open(request, timeout=1) as response:
                            response.read(1024)
                except (OSError, ValueError, AttributeError):
                    pass  # A launching or exiting process may not have published yet.
                time.sleep(.15)
        except BaseException:
            self.close()
            raise

    def publish(self, port):
        temporary = self.path.with_suffix(".json.tmp")
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump({"port":port, "token":self.token}, output)
        temporary.replace(self.path)

    def authorized(self, token):
        return isinstance(token, str) and hmac.compare_digest(token.encode("utf-8"), self.token.encode("ascii"))

    def close(self):
        if self.handle is None:
            return
        if self.owned:
            try:
                self.path.unlink(missing_ok=True)
            finally:
                # Closing releases the OS lock, including after a crash.
                self.handle.close(); self.handle = None; self.owned = False
        else:
            self.handle.close(); self.handle = None

    def __enter__(self):
        self.acquire()
        return self

    def __exit__(self, *args):
        self.close()
