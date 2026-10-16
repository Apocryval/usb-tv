"""Validate and apply a local all-platform ZIP, preserving personal library data."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
import zipfile
from contextlib import contextmanager
from distribution import UPDATE_FILES


@contextmanager
def staging_directory(root):
    temporary = Path(tempfile.mkdtemp(prefix=".usbtv-update-", dir=root))
    try:
        yield temporary
    except Exception as error:
        if (temporary / "old").exists():
            # Keep recovery copies even if rollback itself was interrupted.
            raise RuntimeError(f"{error}. Recovery copies retained in {temporary / 'old'}") from error
        shutil.rmtree(temporary)
        raise
    else:
        shutil.rmtree(temporary)


def install_update(archive_path, library_root):
    root = Path(library_root).resolve()
    archive_path = Path(archive_path).expanduser().resolve()
    if not root.is_dir():
        raise ValueError("The USB.tv folder does not exist")
    # Stage and verify the entire package before replacing any app files.
    with staging_directory(root) as temporary:
        staging = Path(temporary) / "new"
        backup = Path(temporary) / "old"
        with zipfile.ZipFile(archive_path) as archive:
            entries = archive.infolist()
            names = [entry.filename for entry in entries]
            expected = UPDATE_FILES | {"update-manifest.json"}
            if len(names) != len(set(names)) or set(names) != expected:
                raise ValueError("This is not a complete USB.tv all-platform update ZIP")
            if sum(entry.file_size for entry in entries) > 500_000_000:
                raise ValueError("Update package is too large")
            manifest_entry = archive.getinfo("update-manifest.json")
            if manifest_entry.file_size > 64_000:
                raise ValueError("Invalid update manifest")
            manifest = json.loads(archive.read(manifest_entry))
            if not isinstance(manifest, dict) or manifest.get("format") != 1 or not isinstance(manifest.get("files"), dict) or set(manifest["files"]) != UPDATE_FILES:
                raise ValueError("Unsupported update manifest")
            for name in sorted(UPDATE_FILES):
                destination = root / name
                # Do not follow pre-existing symlinks out of the USB library.
                if any(part.is_symlink() for part in [destination, *destination.parents] if part != root and part.is_relative_to(root)):
                    raise ValueError(f"Cannot update a symbolic link: {name}")
                if destination.exists() and not destination.is_file():
                    raise ValueError(f"Expected a file: {name}")
                entry = archive.getinfo(name)
                if entry.is_dir():
                    raise ValueError(f"Expected a file in update: {name}")
                target = staging / name
                target.parent.mkdir(parents=True, exist_ok=True)
                digest = hashlib.sha256()
                with archive.open(entry) as source, target.open("wb") as output:
                    while chunk := source.read(1024 * 1024):
                        digest.update(chunk)
                        output.write(chunk)
                if digest.hexdigest() != manifest["files"][name]:
                    raise ValueError(f"Damaged update file: {name}")
                if name.endswith((".sh", ".command")) or name.endswith("/USBtv"):
                    target.chmod(0o755)
        installed = []
        try:
            for name in sorted(UPDATE_FILES):
                destination = root / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                previous = backup / name
                existed = destination.exists()
                if existed:
                    previous.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(destination, previous)
                os.replace(staging / name, destination)
                installed.append((name, existed))
        except OSError:
            # Restore files already changed if a later write fails (e.g. a locked exe).
            for name, existed in reversed(installed):
                if existed:
                    os.replace(backup / name, root / name)
                else:
                    (root / name).unlink()
            raise
    print("Updated Mac, Windows and Linux apps. Your catalogue and media were preserved.\nStart USB.tv again using its normal launcher.", flush=True)
