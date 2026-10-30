#!/usr/bin/env python3
"""USB.tv Tape Exchange: compare and share two video folders. Python 3.10+."""
from pathlib import Path
import argparse
import json
import os
import shutil
import sys
import time
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from video_sync import compare, apply


def clean(value):
    return ''.join(char if char.isprintable() else '?' for char in str(value))


def size(value):
    for unit in ('B', 'KiB', 'MiB', 'GiB', 'TiB'):
        if value < 1024 or unit == 'TiB':
            return f'{value:.1f} {unit}'
        value /= 1024


class Progress:
    """Throttle byte updates on a terminal; retain useful milestones in logs."""
    def __init__(self, stream=None):
        self.stream = stream or sys.stderr
        self.terminal = self.stream.isatty()
        self.last_time = 0
        self.last_key = None
        self.active = False

    def __call__(self, **event):
        key = (event['stage'], event.get('file'))
        changed = key != self.last_key
        now = time.monotonic()
        finished = 'total' in event and event['done'] == event['total']
        if not changed and (not self.terminal or (now - self.last_time < .12 and not finished)):
            return
        self.last_time, self.last_key = now, key
        stage = event['stage'].capitalize()
        count = f" [{event['index']}/{event['count']}]" if 'index' in event else ''
        meter = ''
        if 'total' in event:
            total, done = event['total'], event['done']
            fraction = done / total if total else 1
            filled = min(20, int(20 * fraction))
            meter = f" [{'#' * filled}{'-' * (20-filled)}] {fraction:5.0%}  {size(done)}/{size(total)}"
        label = clean(event.get('file', ''))
        prefix = f'  {stage}{count}: '
        width = max(40, shutil.get_terminal_size((100, 20)).columns - 1)
        available = max(8, width - len(prefix) - len(meter))
        if len(label) > available:
            label = '...' + label[-(available - 3):]
        line = f'{prefix}{label}{meter}'
        if self.terminal:
            if changed and self.active:
                print(file=self.stream)
            print('\r' + line.ljust(width), end='', file=self.stream, flush=True)
            self.active = True
        elif changed:
            print(line, file=self.stream, flush=True)

    def finish(self):
        if self.active:
            print(file=self.stream, flush=True)
            self.active = False
        self.last_key = None


def ask_folder(label, default=None):
    while True:
        hint = f' [{default}]' if default else ''
        value = input(f'  {label}{hint}: ').strip().strip('"').strip("'")
        value = value or (str(default) if default else '')
        path = Path(value).expanduser() if value else None
        if path and path.is_dir():
            return str(path.resolve())
        print('  That folder is unavailable. Check the path and try again.')


def report(plan, details=False):
    print('\n  THE EXCHANGE MANIFEST')
    print(f"  USB:      {clean(plan['usb'])}")
    print(f"  Personal: {clean(plan['external'])}\n")
    groups = (('copy_to_usb', 'Copy to USB'),
              ('copy_to_external', 'Copy to your personal folder'),
              ('restore_usb', 'Restore to USB from recovery'),
              ('quarantine_usb', 'Move off USB into recovery'),
              ('excluded', 'Staying in your personal collection'),
              ('conflicts', 'Needs your attention'))
    for key, title in groups:
        names = plan[key]
        amount = ''
        if key in ('copy_to_usb', 'copy_to_external', 'restore_usb'):
            root = Path(plan['external' if key == 'copy_to_usb' else 'usb'])
            amount = f"  ({size(sum(Path(plan.get('_recovery_sources', {}).get(name, root / name)).stat().st_size if key != 'copy_to_usb' else (root / name).stat().st_size for name in names))})"
        print(f'  {title:.<42} {len(names):>4}{amount}')
        if details or key in ('conflicts', 'quarantine_usb', 'restore_usb'):
            for name in names:
                print(f'    - {clean(name)}')
    if plan['conflicts']:
        print('\n  Resolve these conflicts and compare again. No files have been changed.')
    elif not any(plan[key] for key in ('copy_to_usb', 'copy_to_external', 'restore_usb', 'quarantine_usb')):
        print('\n  The tapes are in tune. No video transfers needed.')
    print('\n  USB removals go into recovery and still occupy USB space. Personal copies stay put.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--usb', help='USB app directory or its Videos directory')
    parser.add_argument('--external', help='Personal video directory')
    parser.add_argument('--apply', action='store_true', help='Sync immediately, without the interactive menu')
    parser.add_argument('--preview', action='store_true', help='Show the manifest and exit')
    parser.add_argument('--json', action='store_true', help='Emit a machine-readable report without progress')
    args = parser.parse_args()
    if args.apply and args.preview:
        parser.error('--apply and --preview cannot be combined')
    if args.json and not (args.usb and args.external):
        parser.error('--json requires --usb and --external')
    interactive = sys.stdin.isatty() and not (args.apply or args.preview or args.json)
    progress = Progress()
    callback = None if args.json else progress
    try:
        if not args.json:
            title = f"{'USB.tv  /  TAPE EXCHANGE':<36}"
            if sys.stdout.isatty() and os.environ.get('TERM') != 'dumb' and 'NO_COLOR' not in os.environ:
                title = '\033[1;36m' + title + '\033[0m'
            print(f'\n  +--------------------------------------+\n  | {title} |\n  +--------------------------------------+')
            print('  Two collections. One travelling USB. Roll tape.\n', flush=True)
        usb = args.usb or ask_folder('USB app directory or Videos folder')
        external = args.external or ask_folder('Your personal video folder')
        usb, external = str(Path(usb).expanduser()), str(Path(external).expanduser())
        if not args.json:
            print('  Checking every video. Large collections can take a while.\n', flush=True)
        plan = (apply if args.apply else compare)(usb, external, progress=callback)
        progress.finish()
        if args.json:
            print(json.dumps({key: value for key, value in plan.items() if not key.startswith('_')}, indent=2))
        else:
            report(plan)
        if args.apply:
            if not args.json:
                print('\n  Exchange complete. Reopen USB.tv and scan to refresh the library.\n')
            return 0
        if not interactive:
            if not args.json:
                print('\n  Preview only. Add --apply to carry out this exchange.\n')
            return 1 if plan['conflicts'] else 0
        while True:
            choice = input('\n  [S] Sync  [D] File details  [R] Recheck  [F] Change folders  [Q] Quit\n  Your move: ').strip().lower()
            if choice in ('q', 'quit', ''):
                print('  Tape ejected. No sync performed. See you at the next handover.\n')
                return 0
            if choice in ('d', 'details'):
                report(plan, details=True)
            elif choice in ('r', 'recheck', 'f', 'folders'):
                if choice in ('f', 'folders'):
                    usb = ask_folder('USB video folder', usb)
                    external = ask_folder('Your personal video folder', external)
                plan = compare(usb, external, progress=callback)
                progress.finish()
                report(plan)
            elif choice in ('s', 'sync'):
                if plan['conflicts']:
                    print('  Resolve the listed conflicts, then choose Recheck.')
                    continue
                print('\n  Rechecking the manifest, then starting the exchange...\n', flush=True)
                try:
                    apply(usb, external, progress=callback, expected_plan=plan)
                except ValueError as error:
                    progress.finish()
                    print(f'\n  Exchange paused: {clean(error)}\n  Choose Recheck to review a fresh manifest.')
                    continue
                progress.finish()
                print('\n  Exchange complete. Your next double feature awaits.\n  Reopen USB.tv and scan to refresh the library.\n')
                return 0
            else:
                print('  Choose S, D, R, F or Q.')
    except KeyboardInterrupt:
        progress.finish()
        print('\n  Tape stopped. Completed transfers remain; preview again before retrying.', file=sys.stderr)
        return 130
    except (OSError, ValueError, EOFError) as error:
        progress.finish()
        print(f'\n  Exchange stopped: {clean(error)}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
