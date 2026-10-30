#!/bin/sh
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec sh "$ROOT/sync-videos.sh" "$@"
