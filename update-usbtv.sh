#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ARCHIVE=${1:-}
echo 'Close USB.tv on this computer before updating.'
if [ -z "$ARCHIVE" ]; then
    printf 'Paste the full path to USBtv-all-platforms.zip, then press Enter: '
    IFS= read -r ARCHIVE
fi
# Accept paths copied with wrapping quotes, without evaluating any shell input.
ARCHIVE=${ARCHIVE#\"}
ARCHIVE=${ARCHIVE%\"}
ARCHIVE=${ARCHIVE#\'}
ARCHIVE=${ARCHIVE%\'}
if [ ! -f "$ARCHIVE" ]; then
    echo 'Update ZIP not found. Use its full path.' >&2
    exit 1
fi
exec /bin/sh "$ROOT/start-usbtv.sh" --update-from "$ARCHIVE"
