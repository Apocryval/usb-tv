"""Saved-state paths, with conservative migration from the original flat layout."""
from pathlib import Path

STATE_FILES = ('catalog.json', 'broadcasts.json', 'video-folders.json', 'scan-cache.jsonl',
               'loudness-cache.jsonl', 'scan-job.json', 'imports.json', 'catalog.v1.backup.json')


def data_directory(root):
    root = Path(root)
    return root / 'data' if (root / 'data').is_dir() else root


def library_file(root, name):
    root = Path(root)
    destination = data_directory(root) / name
    # A partially completed migration remains readable after a power loss.
    return destination if destination.exists() or not (root / name).exists() else root / name


def migrate_library_data(root):
    """Called under the server's library session lock, before opening saved state.

    Flat installations without a data directory continue to work unchanged.
    Each rename is atomic; conflicting copies are never overwritten.
    """
    root = Path(root)
    destination = data_directory(root)
    if destination == root:
        return destination
    names = list(STATE_FILES) + [p.name for p in root.glob('server-errors.log*')]
    # Validate every conflict before moving anything.
    for name in names:
        source, target = root / name, destination / name
        if source.exists() and target.exists() and source.read_bytes() != target.read_bytes():
            raise ValueError(f'Both {source} and {target} contain different saved data. Keep both and resolve the conflict before launching.')
    for name in names:
        source, target = root / name, destination / name
        if source.exists():
            if target.exists():
                source.unlink()  # Byte-identical recovery copy, already preserved.
            else:
                source.replace(target)
    return destination
