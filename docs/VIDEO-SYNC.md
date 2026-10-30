# Sharing videos with the USB

Each person keeps a personal video folder. Tape Exchange compares that folder
with the shared USB and copies missing videos both ways. It also carries USB
removal and undo decisions between you and James. Close USB.tv and other copy
or sync tools before syncing; keep both drives connected until it finishes.

## Browse and manage the collection

The main app's **Library** tab has searchable video cards, genre and availability
filters, sorting and pagination. **Watch** plays that video from the start;
**Edit labels** opens its existing metadata editor. **Organise & labels** keeps
folder settings, metadata tools, bulk review and channel management together.

To remove a video from the shared collection, choose **Keep off USB** on its
card. The mark saves immediately, independently of the metadata editor's Save
or Cancel buttons. No file moves until you sync. The card and **USB handover &
removals** list show the mark, with an **Undo** button. The list remains accessible
when the video itself is missing. It identifies the selected video folder so you
can check which collection you are changing.

On the next sync, the USB copy moves into `Videos/.usbtv-sync/removed/`.
Personal copies stay intact. If the video exists only on the USB, Tape Exchange
first makes a verified personal copy, then moves the USB copy to recovery.
A checksum identifies its contents, so renaming it does not copy it back onto
the USB. A different edit/encoding is a different video and needs its own mark.

**Undo removal** allows the video back on the USB at the next sync. Undo works
before or after removal. Tape Exchange normally restores from a personal copy;
if neither active folder has the video, it can recover it from USB recovery.
The preview lists these restorations. Recovery backups are retained.

Marks and undo changes travel in the removal register. An old mark in James's
folder cannot override a newer undo that arrives on the USB. If both people
independently change the same decision before a handover, a removal wins ties;
review the list and undo again after syncing if needed. Do not delete the register
or edit it to undo marks: use the buttons. There is no automatic expiry.

Recovery copies still occupy USB space. Once satisfied, back them up elsewhere
before manually clearing recovery to free space. Tape Exchange never permanently
deletes a video or deletes a personal copy.

## Start Tape Exchange

Tape Exchange currently requires **Python 3.10 or later**, even if the player
uses a packaged executable.

- Windows: double-click **Sync Videos.bat**.
- macOS: open **sync-videos.command**.
- Linux: run `sh ./sync-videos.sh` from the app folder.

Or run this on any platform (`py` instead of `python3` on Windows):

```sh
python3 scripts/sync_videos.py
```

Choose the USB app directory or its **Videos** folder, then your personal video
folder. Recognised app directories resolve to their Videos subfolder; the preview
shows the exact resolved paths. No path is assumed to be your USB on first use.
Relative paths are interpreted from the terminal's current directory. Both folders
must already exist and must be separate, non-nested directories.

The manifest shows transfer counts, sizes, conflicts and every planned removal
or recovery restoration. Choose **D** for all filenames, **S** to sync, **R** to
recheck, **F** to change folders, or **Q** to exit. File counts and byte progress
appear while checksumming, copying, verifying and publishing. Large collections
can take a while because checksums read entire videos.

Sync rechecks the manifest before applying. Changes since review require a new
preview. Existing files are never overwritten; same-path files with different
contents and case-only filename/folder collisions stop the sync for resolution.
Missing files alone never count as deletion requests. Simultaneous syncs or
removal edits are rejected. Free space is checked before transfers, including
temporary copy space; removals into recovery do not free space.

Identical contents under different names are already considered present. Relative
subfolders are preserved. Hidden folders, import originals and non-video files
are skipped. Catalogue metadata, channel assignments, Adverts and app data are
not synced by this script. The selected video folder's contents determine scope;
choosing an unrelated folder does not make it a USB.tv library.

## Commands for scripts

```sh
python3 scripts/sync_videos.py --usb "/media/USB/Videos" --external "/home/me/Videos" --preview
python3 scripts/sync_videos.py --usb "/media/USB/Videos" --external "/home/me/Videos" --apply
```

`--preview` prints the manifest and exits. Redirected input previews by default.
`--apply` performs the exchange without the menu. `--json` emits a machine-readable
report without progress and requires both paths. It can be combined with `--apply`.

The register is `.usbtv-sync/excluded.json` inside each video folder. Keep it with
that folder when cloning a collection. The current app reads older registers and
upgrades them when saving/syncing. Update all copies of Tape Exchange and USB.tv
together: earlier scripts do not understand undo history and stop on this format.

## Interruption and recovery

Ctrl+C stops the exchange; completed transfers remain. Ordinary cancellation or
a copy error cleans up the incomplete destination and staging file. Rerun the
preview before retrying. A power failure can leave an incomplete destination;
that becomes a conflict rather than being silently overwritten. Compare it with
the intact source and remove only the incomplete copy before retrying. A failed
sync may have completed earlier operations; it does not roll them back. Keep
normal backups of your personal collection.
