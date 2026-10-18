#!/usr/bin/env python3
"""Build a self-contained USB.tv launcher for the current OS/architecture.

Run this on each target platform with PyInstaller installed in the build
environment. Target computers do not need Python or PyInstaller installed.
"""
from pathlib import Path
import platform
import os
import subprocess
import sys
import hashlib
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from distribution import ASSETS, SOURCE_FILES

ROOT = Path(__file__).resolve().parent.parent


def source_digest():
    digest = hashlib.sha256()
    for name in sorted(SOURCE_FILES):
        digest.update(name.encode("utf-8") + b"\0")
        # Normalise Git's possible Windows line-ending conversion.
        data = (ROOT / name).read_bytes()
        if Path(name).suffix != ".ico":
            data = data.replace(b"\r\n", b"\n")
        digest.update(data + b"\0")
    return digest.hexdigest()


def current_target():
    system = platform.system().lower()
    arch = platform.machine().lower()
    if arch in {"aarch64", "arm64"}:
        arch = "arm64"
    elif arch in {"x86_64", "amd64", "x64"}:
        arch = "x64"
    else:
        raise SystemExit(f"Unsupported CPU architecture: {platform.machine()}")
    if system == "darwin" and arch != "arm64":
        raise SystemExit("This project currently targets Apple silicon Macs (arm64).")
    if system == "windows" and arch != "x64":
        raise SystemExit("This project currently targets 64-bit Windows (x64).")
    if system == "linux" and arch != "x64":
        raise SystemExit("This project currently targets x86-64 Linux, including Steam Deck.")
    if system not in {"darwin", "windows", "linux"}:
        raise SystemExit(f"Unsupported operating system: {platform.system()}")
    return f"{system}-{arch}"


def main():
    target = current_target()
    output = ROOT / "Apps" / target
    work = ROOT / ".local" / "build" / target
    output.mkdir(parents=True, exist_ok=True)
    work.mkdir(parents=True, exist_ok=True)
    command = [
        sys.executable, "-m", "PyInstaller", "--clean", "--noconfirm", "--onefile",
        "--name", "USBtv", "--distpath", str(output), "--workpath", str(work),
        "--specpath", str(work),
    ]
    for asset in sorted(ASSETS):
        command.extend(["--add-data", f"{ROOT / 'web' / asset}{';' if target.startswith('windows-') else ':'}web"])
    command.append(str(ROOT / "src" / "server.py"))
    print(f"Building {target} into {output}")
    environment = os.environ.copy()
    environment["PYINSTALLER_CONFIG_DIR"] = str(work / "config")
    subprocess.run(command, cwd=ROOT, env=environment, check=True)
    (output / "source-sha256.txt").write_text(source_digest() + "\n")
    print("Build complete. The OS-specific launcher will find this app automatically.")


if __name__ == "__main__":
    main()
