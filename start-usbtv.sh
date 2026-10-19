#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

# Desktop file managers may start scripts without a visible terminal. Keep the
# server attached to one so Ctrl+C and the final safe-eject message are reachable.
IN_TERMINAL=0
if [ "${1:-}" = "--usbtv-in-terminal" ]; then
    IN_TERMINAL=1
    shift
fi
if [ "$(uname -s)" = "Linux" ] && [ "$IN_TERMINAL" = 0 ] \
        && { [ ! -t 0 ] || [ ! -t 1 ]; } \
        && { [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; }; then
    if command -v konsole >/dev/null 2>&1; then
        exec konsole --separate --hold -e sh "$ROOT/start-usbtv.sh" --usbtv-in-terminal "$@"
    elif command -v gnome-terminal >/dev/null 2>&1; then
        exec gnome-terminal --wait -- sh "$ROOT/start-usbtv.sh" --usbtv-in-terminal "$@"
    elif command -v x-terminal-emulator >/dev/null 2>&1; then
        exec x-terminal-emulator -e sh "$ROOT/start-usbtv.sh" --usbtv-in-terminal "$@"
    elif command -v xterm >/dev/null 2>&1; then
        exec xterm -hold -e sh "$ROOT/start-usbtv.sh" --usbtv-in-terminal "$@"
    fi
    echo "USB.tv needs a visible terminal. Open one in the USB drive and run: sh ./start-usbtv.sh" >&2
    exit 1
fi

run_source() {
    if command -v python3 >/dev/null 2>&1; then
        exec python3 "$ROOT/src/server.py" --library-root "$ROOT" "$@"
    fi
    echo "USB.tv has not been packaged for this computer yet. Build it on this OS and CPU first." >&2
    exit 1
}

case "$(uname -s):$(uname -m)" in
    Linux:x86_64)
        APP="$ROOT/Apps/linux-x64/USBtv"
        if [ ! -f "$APP" ]; then run_source "$@"; fi
        CACHE_ROOT=${XDG_CACHE_HOME:-"$HOME/.cache"}
        CACHE_DIR="$CACHE_ROOT/usb-tv/linux-x64"
        mkdir -p "$CACHE_DIR"
        if [ ! -f "$CACHE_DIR/USBtv" ] || ! cmp -s "$APP" "$CACHE_DIR/USBtv"; then
            cp "$APP" "$CACHE_DIR/USBtv.new"
            mv "$CACHE_DIR/USBtv.new" "$CACHE_DIR/USBtv"
        fi
        chmod u+x "$CACHE_DIR/USBtv"
        exec "$CACHE_DIR/USBtv" --library-root "$ROOT" "$@"
        ;;
    Darwin:arm64)
        APP="$ROOT/Apps/darwin-arm64/USBtv"
        if [ ! -f "$APP" ]; then run_source "$@"; fi
        CACHE_DIR="$HOME/Library/Caches/USB.tv/darwin-arm64"
        mkdir -p "$CACHE_DIR"
        if [ ! -f "$CACHE_DIR/USBtv" ] || ! cmp -s "$APP" "$CACHE_DIR/USBtv"; then
            cp "$APP" "$CACHE_DIR/USBtv.new"
            mv "$CACHE_DIR/USBtv.new" "$CACHE_DIR/USBtv"
        fi
        chmod u+x "$CACHE_DIR/USBtv"
        exec "$CACHE_DIR/USBtv" --library-root "$ROOT" "$@"
        ;;
    *)
        echo "No USB.tv build is available for $(uname -s) / $(uname -m)." >&2
        exit 1
        ;;
esac
