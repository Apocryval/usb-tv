#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

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
