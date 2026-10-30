#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# A visible terminal is needed for prompts when launched from a file manager.
if [ "${1:-}" = "--in-terminal" ]; then
    shift
elif [ "$(uname -s)" = Linux ] && { [ ! -t 0 ] || [ ! -t 1 ]; } && { [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; }; then
    if command -v konsole >/dev/null 2>&1; then
        exec konsole --separate --hold -e sh "$ROOT/sync-videos.sh" --in-terminal "$@"
    elif command -v gnome-terminal >/dev/null 2>&1; then
        exec gnome-terminal --wait -- sh "$ROOT/sync-videos.sh" --in-terminal "$@"
    elif command -v x-terminal-emulator >/dev/null 2>&1; then
        exec x-terminal-emulator -e sh "$ROOT/sync-videos.sh" --in-terminal "$@"
    fi
    echo "Open a terminal and run: sh '$ROOT/sync-videos.sh'" >&2
    exit 1
fi
if [ -x "$ROOT/.local/venv/bin/python" ]; then
    exec "$ROOT/.local/venv/bin/python" -B "$ROOT/scripts/sync_videos.py" "$@"
elif command -v python3 >/dev/null 2>&1; then
    exec python3 -B "$ROOT/scripts/sync_videos.py" "$@"
fi
echo 'Tape Exchange needs Python 3.10 or later. Install Python, then reopen this launcher.' >&2
exit 1
