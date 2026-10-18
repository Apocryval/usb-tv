import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from distribution import UPDATE_FILES, LEGACY_UPDATE_FILES, TARGET_APPS
from updater import install_update
import package_update


class UpdaterTests(unittest.TestCase):
    def archive(self, root, extra=None, corrupt=None, format=2, files=None):
        payload = {name:('new '+name).encode() for name in (files or UPDATE_FILES)}
        payload.update(extra or {})
        manifest = {'format':format, 'files':{name:hashlib.sha256(data).hexdigest() for name,data in payload.items()}}
        if corrupt:
            payload[corrupt] = b'damaged'
        archive = root / 'update.zip'
        with zipfile.ZipFile(archive, 'w') as output:
            for name,data in payload.items():
                output.writestr(name, data)
            output.writestr('update-manifest.json', json.dumps(manifest))
        return archive

    def test_new_app_files_are_installed_and_personal_data_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            personal = ['catalog.json', 'broadcasts.json', 'imports.json', 'Videos/movie.mp4', 'Adverts/ad.mp4', 'Tools/ffmpeg']
            for name in personal:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b'personal')
            archive = self.archive(root, {'new-feature.js':b'new module'})
            install_update(archive, root)
            self.assertEqual((root/'new-feature.js').read_bytes(), b'new module')
            for name in personal:
                self.assertEqual((root/name).read_bytes(), b'personal')

    def test_unsafe_paths_and_corrupt_files_do_not_modify_the_installation(self):
        for name in ['catalog.json', 'Videos/movie.mp4', 'Tools/ffmpeg', '../escape.js', 'Apps/windows-x64/../../catalog.json', 'APP.JS']:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root/'app.js').write_bytes(b'old')
                with self.assertRaises(ValueError):
                    install_update(self.archive(root, {name:b'bad'}), root)
                self.assertEqual((root/'app.js').read_bytes(), b'old')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root/'app.js').write_bytes(b'old')
            with self.assertRaisesRegex(ValueError, 'Damaged'):
                install_update(self.archive(root, corrupt='server.py'), root)
            self.assertEqual((root/'app.js').read_bytes(), b'old')

    def test_write_failure_rolls_back_new_and_existing_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root/'app.js').write_bytes(b'old')
            archive = self.archive(root)
            import updater
            original = updater.os.replace
            def fail(source, destination):
                if Path(source).parent.name == 'new' and Path(destination).name == 'server.py':
                    raise OSError('simulated locked file')
                return original(source, destination)
            with patch('updater.os.replace', side_effect=fail), self.assertRaises(RuntimeError):
                install_update(archive, root)
            self.assertEqual((root/'app.js').read_bytes(), b'old')
            self.assertFalse((root/'catalogue.py').exists())

    def test_bridge_packager_uses_the_frozen_legacy_contract(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in UPDATE_FILES:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b'source')
            signatures = {'darwin-arm64':b'\xcf\xfa\xed\xfe', 'linux-x64':b'\x7fELF', 'windows-x64':b'MZxx'}
            for target, name in TARGET_APPS.items():
                (root/name).write_bytes(signatures[target])
                (root/'Apps'/target/'source-sha256.txt').write_text('digest')
            with patch.object(package_update, 'ROOT', root), patch('build.source_digest', return_value='digest'), patch('sys.argv', ['package_update.py', '--legacy-bridge']):
                package_update.main()
            with zipfile.ZipFile(root/'dist/USBtv-legacy-bridge.zip') as archive:
                manifest = json.loads(archive.read('update-manifest.json'))
                self.assertEqual(manifest['format'], 1)
                self.assertEqual(set(manifest['files']), LEGACY_UPDATE_FILES)
                self.assertEqual(set(archive.namelist()), LEGACY_UPDATE_FILES | {'update-manifest.json'})
