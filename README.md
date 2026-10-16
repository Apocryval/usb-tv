# USB.tv

USB.tv turns a folder of local videos into a small TV-style channel guide. It is designed so the video library and catalogue can stay on a single exFAT USB drive while the app has separate builds for each operating system.

## USB layout

Keep one exFAT partition for now. It is readable and writable from Windows, macOS, Linux Mint, and SteamOS, and supports large video files. There is no need for a second Linux partition.

```text
USB.tv/
├── Videos/                 # Add, remove, and organize videos here
├── Adverts/                # Optional ads, excluded from programme listings
├── catalog.json            # Editable title, duration, genre, and channel data
├── Apps/
│   ├── windows-x64/        # Built on 64-bit Windows
│   ├── linux-x64/          # Built on Linux Mint; also targets Steam Deck
│   └── darwin-arm64/       # Built on Apple silicon macOS
├── Start USB.tv.bat        # Windows launcher
├── start-usbtv.sh          # Linux launcher
└── start-usbtv.command     # macOS launcher
```

exFAT does not preserve Unix execute permissions. The Linux launcher copies its bundled app into the user's cache and runs that copy. This is a per-user cache, not a system install. The app and all of its Python runtime files remain bundled in the USB build.

## Build the portable app

See [BUILD-AND-UPDATE.md](BUILD-AND-UPDATE.md) for copy-and-paste Windows, Linux, and Mac build commands, plus the single-ZIP offline updater for all three platforms.

The files in `Apps/` are generated separately on each target operating system. PyInstaller is needed on the **build computer only**; it is not needed on computers that use a packaged USB.tv build.

1. Install Python 3 on a build computer.
2. Install the build-only packager with `python3 -m pip install -r requirements-build.txt` (use `py -3 -m pip ...` on Windows).
3. Run `python3 build.py` on Linux or macOS, or `py -3 build.py` on Windows.
4. Copy the generated `Apps/<platform-architecture>/` folder with the project to the USB drive.

Build each app natively: 64-bit Windows creates `windows-x64`, Apple silicon macOS creates `darwin-arm64`, and Linux creates `linux-x64`. The `.github/workflows/build-apps.yml` workflow can build all three on GitHub Actions and provide a downloadable artifact for each target when this project is hosted in a GitHub repository. Its Linux build uses Ubuntu 22.04 as a compatibility baseline for Mint and SteamOS. These targets cover the computers identified for the project: a Windows PC, an M-series MacBook, a Linux Mint laptop, and an x86-64 Steam Deck.

The Apple silicon build is available locally in `Apps/darwin-arm64/`. Windows and Linux builds need to be produced on their respective platforms or with the GitHub workflow. In source mode, use Python 3 to run the server. Packaged mode bundles Python and opens the system's default browser for the interface. The browser is the only required extra user-facing app dependency; packaged builds still use standard operating-system libraries.

## Use the library

- **Windows:** double-click `Start USB.tv.bat`.
- **Linux Mint / Steam Deck:** open a terminal in the drive and run `sh ./start-usbtv.sh`. On Steam Deck, switch to Desktop Mode first.
- **Apple silicon Mac:** open `start-usbtv.command`. The current Mac build is not notarized, so Gatekeeper may require you to allow USB.tv in Privacy & Security on first launch.

Keep the terminal open while using the guide; close it or press Ctrl+C to stop the local server. USB.tv binds only to the local computer and does not need internet access.

Launching USB.tv again gracefully stops the previous server for that same library on this computer before opening the replacement. Existing writes finish first; if the old server is busy for more than 20 seconds, startup asks you to wait or close it rather than forcibly killing it. Different library folders can run independently. Session control uses a private local token and an OS lock in the user's cache; stale locks are released automatically when a process exits. Old browser tabs are not closed automatically—use the newly opened page. Builds made before this session feature need to be closed manually once.

A packaged executable launched directly from `Apps/<platform>/` also finds the library above `Apps/`. The normal launcher remains recommended, especially for Linux drives without executable permissions.

Each page load opens with a six-second CRT static and retro USB.tv logo ident and attempts to play an original synthesized broadcast chime automatically. If the browser blocks sound autoplay, choose **Enable intro sound** to replay with audio. **Skip intro** / Escape enters immediately. Reduced-motion preferences use a still logo reveal, shortened when sound is blocked. The sequence is self-contained in `intro.js` and `intro.css`, with no downloaded media or additional dependencies.

The intro reads the saved catalogue theme before starting: Satellite uses a chrome logo and synth swell; Teletext uses block lettering, colour bars, and terminal bleeps; Goblin Cable uses a goblin emblem, mossy lettering, and a dungeon hum with bell-like plucks. Change the theme in appearance settings and wait for **Saved to USB**; the next launch uses that ident on any device. Opening `index.html` directly uses the default Satellite intro because it cannot read the saved catalogue. If the server takes more than four seconds to load the catalogue, the intro falls back to Satellite so startup cannot get stuck.

Use the browser page opened by the launcher (`http://127.0.0.1:…`), rather than opening `index.html` directly. A `file://` page cannot connect to the catalogue API or save channels; it shows a launcher reminder and disables library changes.

Copy programmes into `Videos/` and adverts into `Adverts/`, then choose **Rescan Videos**. The app also rescans when launched. The library's **Edit** button opens a metadata editor with a display title, programme/advert type, multiple genres, channel checkboxes, tags, description, enabled flag, and editable internal break points. Create channels in the library's **Channels & advert breaks** section before assigning programmes. Adverts with no channel restrictions may play on every channel. The source path is shown separately inside the editor, never used as a new file's display title. An embedded title is used when available; otherwise the file is marked **Needs title** and displayed as an untitled item with its ID. Existing version 1 titles are preserved during migration.

The guide includes a muted live preview and details for the selected channel, with a matching frame for each theme. Hover over or keyboard-focus a channel/programme to select it; click it or **Watch channel** to open full playback. The first available channel is selected initially. Previews use the same live schedule and advert breaks as full playback, and pause while the library, full player, or another browser tab is active. If autoplay is blocked, **Play preview** starts it. On touch devices, use the channel buttons to watch directly. Only the selected channel gets a preview video stream.

### Channel order and live additions

**Library & Labels → Channels & advert breaks → Reshuffle now** gives that channel a new shuffle seed, restarts it immediately, and includes all pending assignments. A one-video channel naturally still has the same order. The button is kept off the guide.

Ordinary additions preserve the active channel timeline. A new lineup takes over at the first complete loop boundary at least **one hour after the change**. A short loop may repeat several times first; a long loop finishes its current rotation. Further changes update the pending lineup and can push its start later. The guide and player both switch at that saved boundary. Each channel shows its pending start time in Library & Labels. Advert allocations, timing changes, and approved break-point edits use the same delayed transition. Display-title and description edits appear immediately. Missing, disabled, or replaced media are removed immediately because their old broadcast cannot safely continue; that exception may shift the current schedule.

The browser checks for files about every two minutes while visible, deferring while an editor is open or you are typing in a form. New files appear in the library for labelling; they still need channel assignments. **Rescan Videos** remains available manually. Background scans preserve existing channel order. Large file hashing can take longer than the polling interval.

Active/pending snapshots, shuffle seeds, and broadcast start times are saved separately in `broadcasts.json` beside the catalogue and survive page reloads, server restarts, and drive moves. Keep this file with the USB library and include it in personal backups; app update ZIPs leave it alone. Do not edit the same library from multiple windows at once: revision checks reject conflicting schedule saves rather than silently overwriting another window's ordering.

The scanner assigns sequential, stable IDs such as `000001`, records file size, modification time, date added, and a SHA-256 content fingerprint, and preserves labels when files are renamed or moved within the library. Files with identical contents have separate IDs and a duplicate warning. Missing files are retained in the catalogue for recovery and excluded from playback; the **Missing files** filter reveals them. Unchanged files skip expensive hashing and media inspection. Initial hashing reads each new file in full and can take time for a large collection. The **Needs review** filter highlights missing titles, genres, channels, unreadable durations, and duplicates.

### Bulk labels and suggestions

Choose **Bulk review & suggestions** in the library after scanning a batch. It starts with the current library filters; choose **Unassigned programmes**, **Media needing review**, or **All present media** to change the queue. Each row has an editable title, genres, and channel list, plus an explanation of the suggestion. Tick rows to approve suggestions; manually editing a row automatically selects it. Choose **Save N selected files** to save them together. The button is disabled when no rows are selected. Closing or cancelling discards the previews. Imported and generated rows are initially unselected. Genres remain descriptive labels; the Channels column controls broadcast allocation.

Offline suggestions use whole words and phrases in folder names, filenames, existing display titles, and tags, with known genre/channel names and a small set of common genre keywords. They can also reuse matching assignments when at least two labelled files in the same subfolder agree. A genre routes to a channel automatically in the suggestion only when that channel already exists with the same name. Existing genre/channel assignments are preserved in generated suggestions. These are editable naming clues, not analysis of the video's content, and filenames are never promoted to display titles.

Select multiple rows and use **Assign to selected rows** to add or replace genres/channels in their previews. Comma-separated labels are supported; a blank group field leaves that field unchanged. Individual row fields can be cleared explicitly. New genres and channels are created when selected rows are saved. Saving also applies any pending values still typed in the group assignment fields to the selected rows.

Reusable rules match a keyword or phrase, e.g. `kurzgesagt => Science, Animation | Explore`. Put one rule per line in **Reusable labelling rules**, then choose **Generate suggestions**. Rules are saved with selected file labels, or separately using **Save rules only**. Regenerating replaces the current preview; it never saves it.

**Export CSV template** exports the current review rows. Edit it in a spreadsheet or another tool, then use **Import CSV / JSON** to load suggestions for approval. Imports accept `id` or `file` as a key, plus optional `title`, `genres`, and `channels`. IDs are the safest key across renames; numeric spreadsheet IDs are accepted. Filenames without a folder must uniquely identify a present file. Missing, ambiguous, unknown, and repeated keys are skipped with an explanation. Columns absent from an import preserve existing labels. Empty provided fields clear that label in the preview. Use semicolons between multiple labels in CSV cells, or quote comma-separated lists. JSON accepts arrays for genre/channel lists, for example:

```json
[
  {"id": "000001", "genres": ["Science", "Animation"], "channels": ["Explore"]},
  {"file": "Videos/Comedy/clip.mp4", "title": "Goblin comedy hour", "genres": ["Comedy"], "channels": ["Bin TV"]}
]
```

Imported files are read locally and never uploaded. Neither import nor suggestion generation changes `catalog.json` until you apply selected rows.

MP4/M4V/MOV duration, embedded title, codecs, and dimensions are read with the built-in metadata reader. Other formats use optional FFprobe for more complete inspection. If lengths are still missing, **Read missing lengths on this page** tries browser detection for at most the current page, rather than probing the entire collection. A duration does not guarantee the browser supports that file's codecs. Labels and settings are stored in `catalog.json`. The first scan of an older catalogue creates `catalog.v1.backup.json` before migrating to version 2. Back up the catalogue regularly; a corrupt existing catalogue is reported rather than overwritten.

Each channel gets a deterministic shuffled rotation anchored to a fixed clock, continuing across midnight. A stable collection and channel settings produce the same schedule on each device when their clocks agree. Library and break-setting changes can change the schedule. Only enabled, present programmes with measured durations and assigned channels are scheduled. Genre labels and channel eligibility are separate selections.

Click a channel or any programme bar to **tune into the channel live**. If the programme is five minutes in, playback starts five minutes in; upcoming bars also tune into the channel's current broadcast. Playback continues into the next programme automatically. Pausing and resuming rejoins the current channel time, and the **Live** button resynchronises playback. Use **Preview from start** in the editor for independent playback with ordinary pausing and seeking. The media server supports byte ranges for seeking directly into files, including files outside a packaged app's embedded UI resources.

## Advertisement breaks

Channels default to an approximate 15-minute interval and a 90-second target break. Adjust these for each channel in the library; a break length of zero disables adverts. Intervals count programme time. Breaks wait for a programme ending or an approved internal point, so they can be later than the target interval. Short collections accumulate time across rotations. Full adverts play to completion, so break length may exceed the target; a small advert pool may produce shorter breaks. Selection uses a reproducible shuffled pool, without repeats within a break and avoiding consecutive repeats when multiple eligible adverts exist. The scheduled selection repeats with the channel rotation.

The timeline reserves advert duration inside programme bars without listing adverts as shows. Tuning during a break joins the advert at its current offset, then returns to the appropriate programme position. No advert playback means no advert time is reserved. Scheduling and the player use the same pure timeline in `schedule.js`.

Internal break points use timestamps such as `15:00, 30:00` and require the **Approve** checkbox. Scanner suggestions use embedded chapter boundaries when available through FFprobe, otherwise roughly 15-minute intervals while leaving room before the ending. Interval suggestions are timing proposals, not detected scene changes. **Analyse silence / black frames** can produce scene-based suggestions when optional FFmpeg is available; review and approve these before use. Analysing a full video may take several minutes. Approved internal breaks run only once the channel's approximate interval has elapsed.

Optional tools can live alongside the library, without installing them on every device:

```text
Tools/darwin-arm64/ffprobe
Tools/darwin-arm64/ffmpeg
Tools/linux-x64/ffprobe
Tools/linux-x64/ffmpeg
Tools/windows-x64/ffprobe.exe
Tools/windows-x64/ffmpeg.exe
```

Use binaries built for that platform, with any libraries those binaries require. The app also recognises tools on the computer's PATH. Optional tools are not included in the current builds. Linux copies tools from the drive to the user's executable cache to handle exFAT/noexec mounts. The core scanner, editor, channel playback, and advert scheduling work without these tools.

## Development checks

Run `python3 -m unittest discover -s tests -v` for scanner migration, metadata, bulk labels, identity, and HTTP media-range checks. Run `node --test tests/schedule.test.js tests/suggestions.test.js` for channel timing, adverts, suggestion matching, and CSV/JSON imports. HTTP checks require permission to bind a temporary localhost port. Tests use temporary catalogues and do not modify the USB library.

Use **Full Screen** or press `F` to expand the guide. The video player has its own fullscreen control. Use the **CRT** button to add scanlines and a screen vignette over the interface and player; this preference is saved in the USB catalogue and follows the drive. Press `Esc` to leave fullscreen.

Open the **⚙ Appearance** settings to switch between Satellite nostalgia, Teletext after dark, and Goblin Cable. Themes apply to the guide, library, settings, and player frame. The theme is saved in `catalog.json` and follows the USB drive; the CRT toggle works with every theme. Add future themes in `themes.css` and register their names in the appearance picker and server validation.

## Video formats and compatibility

Video decoding comes from the browser already installed on the computer. MP4 with H.264 video and AAC audio is the safest shared format across Safari, Edge, Chrome, Firefox, and Steam Deck browsers. MKV and some AVI/codec combinations may not play in every browser even if USB.tv can scan them. Internet streams and online metadata services are not used.

Stop USB.tv before ejecting the drive. exFAT is convenient for sharing files across systems, but it does not provide journaling if the drive is unplugged while a write is in progress.

The build folders are deliberately separate from `Videos/` and `catalog.json`. This keeps library data stable if the UI, packaging method, or runtime changes later. Back up `Videos/` and `catalog.json` before repartitioning or reformatting a drive; formatting erases its data.

## Starter channels

New and existing libraries receive four starter channels once: **Cartoons**,
**Documentaries**, **Interdimensional Cable**, and **Sunday Morning Prerecorded**
(for skits). Existing channels and video assignments are preserved. Assign videos
under **Library & Labels → Allowed channels**, individually or in bulk. A channel
appears in the guide once it has playable programmes. Genres remain separate.

## Guide controls

The small sliders icon beside the guide date toggles **Advanced mode**, off by
default. Its state is saved on the USB. Advanced controls can be hidden again
without resetting their values. The TV guide's **Guide time span** slider covers 30 minutes to 4 hours in
30-minute increments and is saved on the drive. Its window starts at the current
half-hour boundary. Programme bars follow that scale; long titles show an
ellipsis until hovered or focused, then scroll. The details strip shows the full
selected programme title, including when reduced motion disables scrolling.

Use **arrow keys** in the guide: up/down changes channel while keeping the same
point in time; left/right selects adjacent programmes and continues beyond the
visible time window. Press **Enter** to watch that channel live, or **Home** to
return to now. Earlier/Later buttons browse in 30-minute steps. Future browsing
stays at the selected time until you return to Now or the live clock catches up.
The live preview always shows the current broadcast, even when a future listing
is selected. Controls and text editors keep their normal keyboard behaviour.

For a future remote adapter, `window.USBTvGuideInput.dispatch(action)` accepts
`up`, `down`, `left`, `right`, `select`, and `live`. No remote-device pairing or
gamepad support is included yet. Browsing time is temporary and resets on reload.

## Optional offline metadata authoring

The separate [Metadata Studio](metadata-studio/README.md) generates reviewable
metadata from local speech transcription and sampled frames using Ollama. It
runs on your authoring computer and exports JSON into Bulk Review & Suggestions.
It is not required on the USB or included in player update packages.


## Large imports and moving between operating systems

The entire library is portable. Keep `catalog.json`, `broadcasts.json`, `scan-cache.jsonl`, and `scan-job.json` beside the app's `Videos/` and `Adverts/` folders. Titles, genres, channel allocations, IDs, technical metadata, settings and schedules then follow the same drive between macOS, Windows and Linux. Media paths are relative to this folder, so drive letters and mount points can change. Each OS still needs its own executable in `Apps/`. Close USB.tv and safely eject before moving the drive. This does not synchronise separate copies of the library.

Scans run in a background worker and show progress in Library & Labels. **Pause scan** saves completed work; **Rescan Videos** continues using the catalogue and journal, including after a restart or changing OS. Results are checkpointed every 25 files and on a graceful pause. Each completed new hash/metadata result is journalled immediately, so an interrupted scan can reuse it. A file being copied or otherwise changing is skipped with an error and retried on the next scan. The interrupted file may need to be reread. A different OS's timestamp precision may trigger a content rehash, but identical content retains saved metadata and labels.

Search titles, IDs, paths and tags, filter by channel or genre, and choose 50 or 100 rows per page. **Unassigned programmes** is the queue for channel allocation; genres remain independent. Bulk review keeps selections and draft edits across pages. **Approve page** selects the current page, **Select all matching** selects every matching row across pages, and **Clear all selections** clears the whole review. Only selected rows are saved.

Labels remain editable during scans. Completed results refresh the library once changes exist and any open editor is closed. An unchanged scan does not rewrite the catalogue or rebuild the library view. The guide's normal clock refresh remains active. Optional AI Studio evidence caches remain separate from these portable scan files.

## Changing channels during playback

Use **CH − / CH +** in the player to move through playable channels; the lineup wraps at either end. During channel playback, **Up / Right** goes to the next channel and **Down / Left** to the previous channel. **Page Up / Page Down** also change channels. These replace native video seek/volume arrow shortcuts in channel mode only; guide arrows keep their existing navigation behaviour. **F** opens player fullscreen while watching, or guide fullscreen otherwise. Use the app fullscreen button rather than the video's native fullscreen button to retain the channel overlay and keyboard controls.

While watching a channel (windowed, browser fullscreen or app fullscreen), type a channel number (up to three digits). You can also type numbers on the guide in app fullscreen. A TV-style number appears on screen, and tunes 1.2 seconds after the last digit. **Enter** tunes immediately; **Backspace** corrects the entry. Numbers match the guide's current numbered lineup, including leading zeros; channels without playable programmes are excluded. Channel numbers follow alphabetical guide ordering and can change when channels are added or removed. Invalid numbers show **NO CHANNEL** and leave playback unchanged. Tuning joins the live broadcast position and preserves fullscreen. The controls and number display are shared by all three themes and all platform builds.

## Quick labels and Interdimensional Customs

Choose **LABELS** in the player to open a compact title, genre, tag and channel editor without stopping live TV. It stays available in app fullscreen. During an advert break it edits the programme containing the break. The panel stays attached to the original programme if the broadcast advances while you are editing. Save writes labels to the portable catalogue; Cancel discards the panel's draft. Channel changing closes an unsaved draft. Use the full library editor for break points and other detailed fields.

**Interdimensional Customs** is an automatic channel containing enabled, present programmes with readable durations and no channel assignments. It is excluded from assignment checkboxes: you assign programmes to their destination channels, and Customs picks up anything remaining. Genres do not affect eligibility. Customs has no adverts so you can review programmes continuously. After assignments change, its current programme finishes, then the revised queue takes effect; assigned programmes cannot recur in that revised queue. If none remain, the player shows a cleared-queue message and you can change channel. The transition is saved in `broadcasts.json`, including across restarts. Ordinary channels retain their usual delayed lineup updates.

## Fullscreen preference

Appearance settings now include **Fullscreen while watching**. **Video fills the screen** (default) expands the video to the full viewport with its original aspect ratio, and requests browser fullscreen where supported. Black bars remain when the video and screen proportions differ. The player uses USB.tv's own play/pause, mute and volume controls, so it stays inside the webpage and retains channel arrows, number tuning, CRT effects and quick labels. Controls fade after 2.5 seconds; move the pointer or use a key to reveal them. **Esc** or the fullscreen button exits the video view. Preview files also have a position slider; channels retain live timing.

**Whole app** expands the full interface and retains the windowed player. The preference applies to the player fullscreen button and **F**, and is saved in `catalog.json` for all operating systems. While on the guide, fullscreen expands the app. Browsers that deny the Fullscreen API still get a video view filling the available webpage viewport; use the browser/window fullscreen command to hide browser chrome. USB.tv does not open the browser's native video fullscreen player.
