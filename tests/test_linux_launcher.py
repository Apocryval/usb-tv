import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


SHELL = shutil.which('sh') or ('C:/Program Files/Git/usr/bin/sh.exe'
                              if Path('C:/Program Files/Git/usr/bin/sh.exe').exists() else None)


@unittest.skipUnless(SHELL, 'POSIX shell unavailable')
class LinuxLauncherTests(unittest.TestCase):
    def run_launcher(self, desktop=True, terminal_guard=False):
        with tempfile.TemporaryDirectory(prefix='USB tv launcher ') as directory:
            root = Path(directory)
            launcher = root / 'start-usbtv.sh'
            shutil.copyfile(Path(__file__).resolve().parents[1] / 'start-usbtv.sh', launcher)
            commands = root / 'commands'
            commands.mkdir()
            for name, body in {
                'uname': 'if [ "$1" = "-m" ]; then echo x86_64; else echo Linux; fi',
                'konsole': 'printf "terminal:<%s>\\n" "$@"',
                'python3': 'printf "source:<%s>\\n" "$@"',
            }.items():
                script = commands / name
                script.write_text('#!/bin/sh\n' + body + '\n', encoding='utf-8')
                script.chmod(0o755)
            env = dict(os.environ, PATH=str(commands) + os.pathsep + str(Path(SHELL).parent))
            env.pop('DISPLAY', None)
            env.pop('WAYLAND_DISPLAY', None)
            if desktop:
                env['WAYLAND_DISPLAY'] = 'wayland-test'
            args = [SHELL, str(launcher)]
            if terminal_guard:
                args.append('--usbtv-in-terminal')
            args += ['--library-root', 'folder with spaces', '--no-browser']
            return subprocess.run(args, env=env, text=True, capture_output=True, timeout=10)

    def test_desktop_opens_konsole_and_preserves_argument_boundaries(self):
        result = self.run_launcher()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('terminal:<--hold>', result.stdout)
        self.assertIn('terminal:<--usbtv-in-terminal>', result.stdout)
        self.assertIn('terminal:<folder with spaces>', result.stdout)
        self.assertNotIn('source:', result.stdout)

    def test_terminal_child_does_not_open_another_terminal(self):
        result = self.run_launcher(terminal_guard=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('source:<folder with spaces>', result.stdout)
        self.assertNotIn('terminal:', result.stdout)
        self.assertNotIn('source:<--usbtv-in-terminal>', result.stdout)

    def test_headless_launch_does_not_require_a_desktop_terminal(self):
        result = self.run_launcher(desktop=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('source:', result.stdout)
        self.assertNotIn('terminal:', result.stdout)
