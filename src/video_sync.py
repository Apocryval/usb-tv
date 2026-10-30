"""Conservative video union sync and content-addressed USB exclusions."""
from pathlib import Path
import hashlib
import json
import os
import shutil
from contextlib import contextmanager
import tempfile
import uuid

EXTENSIONS = {'.mp4', '.m4v', '.webm', '.ogv', '.mov', '.mkv', '.avi', '.mpg',
              '.mpeg', '.wmv', '.flv', '.ts', '.m2ts', '.mts', '.3gp', '.vob'}
STATE = '.usbtv-sync'


def digest(path, progress=None):
    result = hashlib.sha256()
    total, completed = path.stat().st_size, 0
    if progress:
        progress(0, total)
    with path.open('rb') as source:
        while chunk := source.read(4 * 1024 * 1024):
            result.update(chunk)
            completed += len(chunk)
            if progress:
                progress(completed, total)
    return result.hexdigest()


def registry(root):
    if not Path(root).is_dir():
        raise ValueError('Video folder unavailable. Reconnect the drive and refresh.')
    if (Path(root) / STATE).is_symlink():
        raise ValueError('Sync state must not be a symlink')
    path = Path(root) / STATE / 'excluded.json'
    if not path.exists():
        return {'version': 2, 'videos': {}}
    data = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(data, dict) or data.get('version') not in (1, 2) or not isinstance(data.get('videos'), dict):
        raise ValueError(f'Invalid or newer removal register: {path}. Update Tape Exchange before syncing.')
    for key, value in data['videos'].items():
        if (len(key) != 64 or any(c not in '0123456789abcdef' for c in key)
                or not isinstance(value, dict) or not isinstance(value.get('file'), str)
                or not isinstance(value.get('size'), int) or value['size'] < 0):
            raise ValueError(f'Invalid removal entry: {path}')
        relative = Path(value['file'])
        if relative.is_absolute() or '..' in relative.parts or not relative.parts or relative.parts[0] in (STATE, '.usbtv-originals', '.usbtv-imports') or relative.suffix.lower() not in EXTENSIONS:
            raise ValueError(f'Unsafe removal entry: {path}')
        value.setdefault('excluded', True)
        value.setdefault('revision', 1)
        value.setdefault('change', '')
        if (not isinstance(value['excluded'], bool) or type(value['revision']) is not int
                or value['revision'] < 1 or not isinstance(value['change'], str)):
            raise ValueError(f'Invalid removal history: {path}')
    data['version'] = 2
    return data


def merge_registries(*registers):
    result = {'version': 2, 'videos': {}}
    for data in registers:
        for key, entry in data['videos'].items():
            previous = result['videos'].get(key)
            # A later deliberate action wins. Concurrent equal-revision actions
            # favour removal; the user can undo again after the next handover.
            def order(value):
                return (value['revision'], value['excluded'], value['change'], value['file'])
            if previous is None or order(entry) > order(previous):
                result['videos'][key] = dict(entry)
    return result


@contextmanager
def writing(*roots):
    """OS locks prevent simultaneous syncs or app edits from losing marks."""
    handles = []
    try:
        for root in sorted(set(Path(root).resolve() for root in roots)):
            folder = root / STATE
            if folder.is_symlink():
                raise ValueError('Sync state must not be a symlink')
            folder.mkdir(exist_ok=True)
            lock = folder / 'write.lock'
            if lock.is_symlink():
                raise ValueError('Sync lock must not be a symlink')
            handle = lock.open('a+b')
            handles.append(handle)
            if lock.stat().st_size == 0:
                handle.write(b'0')
                handle.flush()
            try:
                if os.name == 'nt':
                    import msvcrt
                    handle.seek(0)
                    msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as error:
                raise ValueError('This folder is busy with another sync or removal change. Wait and retry.') from error
        yield
    finally:
        for handle in reversed(handles):
            handle.close()


def save_registry(root, data):
    folder = Path(root) / STATE
    if folder.is_symlink():
        raise ValueError('Sync state must not be a symlink')
    folder.mkdir(exist_ok=True)
    fd, name = tempfile.mkstemp(dir=folder, suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as output:
            json.dump(data, output, indent=2)
            output.write('\n')
        os.replace(name, folder / 'excluded.json')
    finally:
        Path(name).unlink(missing_ok=True)


def exclude(root, relative):
    root = Path(root).resolve()
    path = root / relative
    if path.is_symlink() or not path.resolve().is_relative_to(root) or not path.is_file() or path.suffix.lower() not in EXTENSIONS:
        raise ValueError('Choose an existing video inside the video folder')
    with writing(root):
        data = registry(root)
        before = path.stat()
        key = digest(path)
        after = path.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise ValueError('The video changed while checking it. Wait for copying to finish, then retry.')
        previous = data['videos'].get(key, {})
        data['videos'][key] = {'file': path.relative_to(root).as_posix(), 'size': path.stat().st_size,
                               'excluded': True, 'revision': previous.get('revision', 0) + 1,
                               'change': uuid.uuid4().hex}
        save_registry(root, data)
        return key


def undo_exclusion(root, key, expected_revision=None):
    root = Path(root).resolve()
    if not root.is_dir():
        raise ValueError('Reconnect the video folder before undoing a removal')
    if not isinstance(key, str):
        raise ValueError('Refresh the removal list before undoing.')
    with writing(root):
        data = registry(root)
        if key not in data['videos']:
            raise ValueError('This removal no longer exists. Refresh the list.')
        entry = data['videos'][key]
        if expected_revision is not None and entry['revision'] != expected_revision:
            raise ValueError('This removal changed in another window. Refresh the list before undoing.')
        if entry['excluded']:
            entry.update(excluded=False, revision=entry['revision'] + 1, change=uuid.uuid4().hex)
            save_registry(root, data)
        return data


def inventory(root, progress=None):
    progress = progress or (lambda **event: None)
    progress(stage='discovering', file=str(root))
    result, candidates = {}, []
    def walk_error(error):
        raise error
    for directory, folders, files in os.walk(root, followlinks=False, onerror=walk_error):
        folders[:] = [name for name in folders if not name.startswith('.') and not (Path(directory) / name).is_symlink()]
        for name in files:
            path = Path(directory) / name
            if path.suffix.lower() in EXTENSIONS:
                if path.is_symlink() or not path.is_file():
                    raise ValueError(f'Unsupported video link: {path}')
                candidates.append(path)
    for index, path in enumerate(sorted(candidates), 1):
        relative = path.relative_to(root).as_posix()
        def update(done, total):
            progress(stage='checking', file=str(path), index=index, count=len(candidates),
                     done=done, total=total)
        result[relative] = digest(path, update)
    return result


def video_directory(value):
    """Accept either an app directory or its Videos directory, and report it."""
    root = Path(value).expanduser().resolve()
    if (root / 'Videos').is_dir() and any((root / marker).exists() for marker in ('data', 'catalog.json', 'Apps', 'src/server.py')):
        root = root / 'Videos'
    return root


def compare(usb, external, progress=None):
    usb, external = video_directory(usb), video_directory(external)
    if not usb.is_dir() or not external.is_dir():
        raise ValueError('Both video directories must already exist')
    if usb == external or usb.is_relative_to(external) or external.is_relative_to(usb):
        raise ValueError('Choose separate, non-nested video directories')
    for root in (usb, external):
        if (root / STATE).is_symlink():
            raise ValueError('Sync state must not be a symlink')
    merged = merge_registries(registry(external), registry(usb))
    excluded = {key for key, entry in merged['videos'].items() if entry['excluded']}
    left, right = inventory(usb, progress), inventory(external, progress)
    recovery_sources = {}
    # If neither active folder has a video whose removal was undone, recover
    # it from the USB backup. Otherwise the ordinary union copy restores it.
    wanted = {key for key, entry in merged['videos'].items()
              if not entry['excluded'] and key not in left.values() and key not in right.values()}
    recovery_root = usb / STATE / 'removed'
    if wanted and recovery_root.exists():
        if recovery_root.is_symlink():
            raise ValueError('Recovery folder must not be a symlink')
        recovered = inventory(recovery_root, progress)
        for relative, key in recovered.items():
            if key in wanted:
                name = merged['videos'][key]['file']
                if name in left and left[name] != key:
                    raise ValueError(f'Cannot restore {name}: another video uses that filename')
                recovery_sources.setdefault(name, str(recovery_root / relative))
                left[name] = key
    plan = {'usb': str(usb), 'external': str(external), 'copy_to_usb': [], 'copy_to_external': [],
            'quarantine_usb': [], 'restore_usb': sorted(recovery_sources), 'conflicts': [], 'excluded': [], 'register': merged}
    # Case-insensitive collisions are unsafe on Windows and many USB filesystems.
    paths = {}
    left_contents, right_contents = set(left.values()), set(right.values())
    for name in sorted(left.keys() | right.keys()):
        components = Path(name).parts
        for index in range(1, len(components) + 1):
            part = '/'.join(components[:index])
            folded = part.casefold()
            if folded in paths and paths[folded] != part:
                plan['conflicts'].append(name)
            paths[folded] = part
        a, b = left.get(name), right.get(name)
        if a in excluded:
            plan['quarantine_usb'].append(name)
        if b in excluded:
            plan['excluded'].append(name)
        if a and b and a != b:
            plan['conflicts'].append(name)
        elif a and not b and a not in right_contents:
            plan['copy_to_external'].append(name)
        elif b and not a and b not in excluded and b not in left_contents:
            plan['copy_to_usb'].append(name)
    for key, destination in (('copy_to_usb', usb), ('copy_to_external', external), ('restore_usb', usb)):
        for name in plan[key]:
            target = destination / name
            if target.exists() or target.is_symlink() or any(
                    ancestor.is_symlink() or (ancestor.exists() and not ancestor.is_dir())
                    for ancestor in target.parents if ancestor != destination and ancestor.is_relative_to(destination)):
                plan['conflicts'].append(name)
    plan['conflicts'] = sorted(set(plan['conflicts']))
    plan['_usb_hashes'], plan['_external_hashes'] = left, right
    plan['_recovery_sources'] = recovery_sources
    return plan


def copy_verified(source, target, expected, progress=None):
    progress = progress or (lambda **event: None)
    total, completed = source.stat().st_size, 0
    progress(phase="copying", done=0, total=total)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=target.parent, prefix='.usbtv-copy-')
    temporary = Path(name)
    try:
        with os.fdopen(fd, 'wb') as output, source.open('rb') as input_file:
            while chunk := input_file.read(4 * 1024 * 1024):
                output.write(chunk)
                completed += len(chunk)
                progress(phase="copying", done=completed, total=total)
            output.flush()
            os.fsync(output.fileno())
        if digest(temporary, lambda done, total: progress(phase="verifying", done=done, total=total)) != expected:
            raise ValueError(f'Source changed during copy: {source}')
        # Exclusive creation never replaces an existing destination, even after a race.
        with target.open('xb') as output, temporary.open('rb') as input_file:
            completed = 0
            try:
                progress(phase='publishing', done=0, total=total)
                while chunk := input_file.read(4 * 1024 * 1024):
                    output.write(chunk)
                    completed += len(chunk)
                    progress(phase="publishing", done=completed, total=total)
                output.flush()
                os.fsync(output.fileno())
            except BaseException:
                target.unlink(missing_ok=True)
                raise
    finally:
        temporary.unlink(missing_ok=True)


def apply(usb, external, progress=None, expected_plan=None):
    progress = progress or (lambda **event: None)
    plan = compare(usb, external, progress)
    if expected_plan is not None and plan != expected_plan:
        raise ValueError('Folders or removal register changed since preview. Compare again before syncing.')
    if plan['conflicts']:
        raise ValueError('Resolve conflicts before syncing: ' + ', '.join(plan['conflicts']))
    usb, external = Path(plan['usb']), Path(plan['external'])
    # Lock after conflict/preview validation, before any media or register writes.
    with writing(usb, external):
        if merge_registries(registry(external), registry(usb)) != plan['register']:
            raise ValueError('Removal register changed. Compare again before syncing.')
        _apply_plan(plan, progress)
    return plan


def _apply_plan(plan, progress):
    usb, external = Path(plan['usb']), Path(plan['external'])
    # Stage + publish needs room for the union plus one extra temporary file.
    by_device = {}
    for direction, source, destination in (('copy_to_usb', external, usb), ('copy_to_external', usb, external),
                                           ('restore_usb', usb, usb)):
        for name in plan[direction]:
            original = Path(plan['_recovery_sources'].get(name, source / name)) if source == usb else source / name
            amount = original.stat().st_size
            device = destination.stat().st_dev
            entry = by_device.setdefault(device, {'root': destination, 'total': 0, 'largest': 0})
            entry['total'] += amount
            entry['largest'] = max(entry['largest'], amount)
    for entry in by_device.values():
        needed = entry['total'] + entry['largest']
        if shutil.disk_usage(entry['root']).free < needed:
            raise ValueError(f"Not enough free space on {entry['root']}. Need {needed:,} bytes including temporary copies; no videos were changed.")
    # Persist exclusions on both sides before moving any videos.
    save_registry(usb, plan['register'])
    save_registry(external, plan['register'])
    total_operations = sum(len(plan[key]) for key in ('copy_to_usb', 'copy_to_external', 'restore_usb', 'quarantine_usb'))
    completed_operations = 0
    for direction, source, destination, hashes in (
            ('copy_to_usb', external, usb, plan['_external_hashes']),
            ('copy_to_external', usb, external, plan['_usb_hashes']),
            ('restore_usb', usb, usb, plan['_usb_hashes'])):
        for name in plan[direction]:
            target = destination / name
            if not target.resolve().is_relative_to(destination):
                raise ValueError(f'Destination escapes video folder: {target}')
            def update(**event):
                progress(stage=event.pop('phase'), file=name, direction=direction,
                         index=completed_operations + 1, count=total_operations, **event)
            original = Path(plan['_recovery_sources'].get(name, source / name)) if source == usb else source / name
            copy_verified(original, target, hashes[name], update)
            completed_operations += 1
    for name in plan['quarantine_usb']:
        source = usb / name
        progress(stage='recovering', file=name, index=completed_operations + 1, count=total_operations)
        if digest(source, lambda done, total: progress(stage='checking removal', file=name, done=done, total=total)) != plan['_usb_hashes'][name]:
            raise ValueError(f'Video changed before removal: {source}')
        if (usb / STATE / 'removed').is_symlink():
            raise ValueError('Recovery folder must not be a symlink')
        target = usb / STATE / 'removed' / uuid.uuid4().hex / name
        target.parent.mkdir(parents=True, exist_ok=True)
        source.rename(target)
        completed_operations += 1
    return plan
