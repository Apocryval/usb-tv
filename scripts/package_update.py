#!/usr/bin/env python3
"""Collect three native builds into one data-free, offline update ZIP."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile
import zipfile
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from distribution import UPDATE_FILES, TARGET_APPS, LEGACY_UPDATE_FILES, legacy_source

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--legacy-bridge", action="store_true", help="Make the one-time format-1 bridge for the pre-audio/CRT/import updater; install the full ZIP immediately afterwards")
    options = parser.parse_args()
    options.output = options.output or ROOT / ("dist/USBtv-legacy-bridge.zip" if options.legacy_bridge else "dist/USBtv-all-platforms.zip")
    files = LEGACY_UPDATE_FILES if options.legacy_bridge else UPDATE_FILES
    missing = [name for name in sorted(UPDATE_FILES) if not (ROOT / name).is_file()]
    if missing:
        parser.error("Missing files; build each platform and collect its Apps folder first:\n" + "\n".join(missing))
    # Verify that the three files really are executables for their labelled platforms.
    signatures = {"darwin-arm64": b"\xcf\xfa\xed\xfe", "linux-x64": b"\x7fELF", "windows-x64": b"MZ"}
    for target, name in TARGET_APPS.items():
        with (ROOT / name).open("rb") as app:
            if not app.read(4).startswith(signatures[target]):
                parser.error(f"{name} is not a {target} executable")
        stamp = ROOT / "Apps" / target / "source-sha256.txt"
        from build import source_digest
        if not stamp.is_file() or stamp.read_text().strip() != source_digest():
            parser.error(f"{target} was built from different sources (or has no build stamp). Rebuild it from this same project snapshot.")
    options.output.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(dir=options.output.parent, suffix=".zip")
    os.close(handle)
    try:
        manifest = {"format": 1 if options.legacy_bridge else 2, "files": {}}
        with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED) as archive:
            for name in sorted(files):
                data = (ROOT / (legacy_source(name) if options.legacy_bridge else name)).read_bytes()
                if name.endswith((".sh", ".command")): data = data.replace(b"\r\n", b"\n")
                manifest["files"][name] = hashlib.sha256(data).hexdigest()
                archive.writestr(name, data)
            archive.writestr("update-manifest.json", json.dumps(manifest, indent=2) + "\n")
        os.replace(temporary, options.output)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print(f"Created {options.output}\nIncludes all three apps. No catalogue, videos, adverts or tools included.")
    if options.legacy_bridge:
        print("Bridge only: install USBtv-all-platforms.zip immediately afterwards, before launching the player or running source mode.")


if __name__ == "__main__":
    main()
