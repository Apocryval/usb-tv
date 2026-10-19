# Build and update USB.tv

The development source is in `src/` and `web/`, build tools in `scripts/`, saved state in `data/`, and local build tooling in `.local/`. Run commands below from the project root.

The supported targets are Apple silicon Mac, Windows x64, and Linux x64 (Mint / Steam Deck). Build each executable on its own operating system. Python and PyInstaller are only needed on the build computers; the finished apps bundle their runtime.

## First Windows build

1. Install 64-bit Python 3.13 from https://www.python.org/downloads/windows/ (including the Python launcher).
2. Copy this whole project folder to the Windows PC. Use the **same source snapshot** on every build computer. Your videos and catalogue are not needed for building.
3. Open PowerShell in that folder and run:

```powershell
py -3.13 -m venv .local/venv
.\.local\venv\Scripts\python.exe -m pip install -r scripts/requirements-build.txt
.\.local\venv\Scripts\python.exe scripts/build.py
```

The result is `Apps\windows-x64\USBtv.exe` and `source-sha256.txt`. Copy the entire `Apps\windows-x64` folder back to the main project. Launch with `Start USB.tv.bat`. Keep its window open during playback.

## First Linux build

Use the Linux Mint laptop, preferably Mint 21 or another system with glibc 2.35 or older. Builds made on a newer Linux can require newer system libraries than another computer has. The GitHub workflow uses Ubuntu 22.04 as a baseline. Steam Deck compatibility still needs checking on the actual device.

Copy this same project snapshot to the laptop. In a terminal in that folder:

```sh
sudo apt update
sudo apt install python3 python3-venv
python3 -m venv .local/venv
.local/venv/bin/python -m pip install -r scripts/requirements-build.txt
.local/venv/bin/python scripts/build.py
```

Copy the entire `Apps/linux-x64` folder, including `source-sha256.txt`, back to the main project. Run `sh ./start-usbtv.sh` on Mint or in Steam Deck Desktop Mode. The launcher copies the executable into a user cache so it can run from an exFAT/noexec USB drive.

## Rebuild the Mac

On the Apple silicon Mac, in the same project snapshot:

```sh
python3 -m venv .local/venv
.local/venv/bin/python -m pip install -r scripts/requirements-build.txt
.local/venv/bin/python scripts/build.py
```

Keep `Apps/darwin-arm64` with the other two folders. The Mac build is unsigned by an Apple developer identity; macOS may ask you to allow it through Privacy & Security.

## Make one update for all three

After any application changes, rebuild all three targets from the same source snapshot and collect their whole `Apps/<target>` folders in one project. Then run on any build computer (Windows: substitute `.local/venv\Scripts\python.exe`):

```sh
.local/venv/bin/python scripts/package_update.py
```

This creates `dist/USBtv-all-platforms.zip`. Packaging refuses missing builds or mismatched source stamps. It includes all three executables, shared UI files, source and launchers. It does **not** include `catalog.json`, `Videos/`, `Adverts/`, or `Tools/`.

### One-time migration for older updaters

The pre-audio/CRT/import updater accepts only its original exact file list. It cannot install a ZIP containing newly added application files. After collecting all three **newly rebuilt** native apps, also run:

```sh
.local/venv/bin/python scripts/package_update.py --legacy-bridge
```

On Windows, use `.local/venv\Scripts\python.exe` instead. This creates `dist/USBtv-legacy-bridge.zip` with the frozen file list understood by that older updater. Install the bridge using the existing update launcher, then run the newly installed update launcher again and install `USBtv-all-platforms.zip`. Finish both updates before opening the player or running source mode: the bridge updates the bundled updater but deliberately omits files that the older installer cannot accept. Keep both ZIPs available until the full update succeeds. The bridge is for the known pre-audio/CRT/import layout; if another historical version rejects it, use the complete fresh application files while preserving personal library data.

Fresh installations use the full ZIP directly. Updated installations accept format-2 packages, which can add new application modules while rejecting media, tools, runtime JSON data, unsafe paths, duplicate names and invalid checksums. The GitHub build artifact contains both ZIPs.

To install this ZIP onto an existing USB.tv drive:

1. Close USB.tv and its server terminal on that computer. Keep the USB connected throughout the update.
2. On Mac open `update-usbtv.command`; on Windows open `Update USB.tv.bat`; on Linux run `sh ./update-usbtv.sh`.
3. Paste the full path to the ZIP when prompted. On Mac, Finder's **Option + right-click → Copy … as Pathname** supplies a usable path. Spaces in paths are supported.
4. Wait for the success message, then use the normal launcher.

Alternatively, on Mac/Linux: `sh ./update-usbtv.sh "/full/path/USBtv-all-platforms.zip"`.

All three executables update in one operation, regardless of which device applies the update. The updater leaves `broadcasts.json` (saved channel ordering and pending transitions) alone, as well as your catalogue and media. It checks the package's allowed application paths and SHA-256 checksums before modifying app files. Checksums detect damage, not publisher identity: use ZIPs you built or obtained from your own build workflow. If a write fails it attempts to restore changed files and retains recovery copies under the printed `.usbtv-update-…/old` folder. An unexpected power loss is not transactional; back up your drive before major updates.

For a fresh drive, extract the ZIP into an empty USB.tv folder (the updater is for an already installed copy). Ignore `update-manifest.json` when launching. `Videos/`, `Adverts/`, and the catalogue are created on first launch.

## Faster changes to appearance

The packaged server now prefers the complete set of shared HTML/CSS/JavaScript files next to the launchers, falling back to its embedded UI if they are absent. Copying an updated complete UI set updates the interface for every platform without rebuilding executables. Backend/scanner changes require native rebuilds. This shared-UI behaviour starts with the builds made after this update; older Mac binaries need one rebuild first.

## Optional: one build action later

If you put the source in a GitHub repository, choose **Actions → Build USB.tv apps → Run workflow**. It builds all three on native runners and produces the **USBtv-all-platforms** artifact containing the single update ZIP. Download the artifact, extract its outer GitHub ZIP, then use the contained `USBtv-all-platforms.zip` with the updater. Tags starting with `v` also trigger a build. Nothing is published automatically.

## Reorganised layout and older installations

The format-2 installer now accepts application files under `src/`, `web/`, `scripts/` and `docs/`. Personal `data/*.json` files are never update payloads; only the empty `data/.gitkeep` marker is shipped. Startup migrates old root-level saved state after acquiring the library session lock. An older updater may reject these new application paths: install the legacy bridge first, then the complete ZIP, before launching. The bridge contract stays frozen; its old names are mapped onto the new source layout when packaging. No update has been applied to the existing production USB.


### Windows development launcher

Use `Start USB.tv Development.bat` in the development checkout. It explicitly runs `src/server.py` with `.local/venv/Scripts/python.exe`, falling back to installed Python 3 if that environment is absent. It uses the same library root, catalogue and launch reminders as the native app. It does not execute the bundled EXE or change Windows security settings. Keep its terminal open and use Ctrl+C before ejecting a drive. This development-only launcher is not part of the portable update bundle. For distributing the native EXE on Smart App Control devices, use a code-signing certificate from a trusted provider; self-signing does not satisfy Smart App Control public trust.

### Refreshing development assets

Edits to existing CSS and JavaScript can be loaded with Ctrl+F5. Adding new artwork, fonts or other entries to `src/distribution.py` requires restarting **Start USB.tv Development.bat**, because the server loads its asset allowlist at startup. Use the new browser URL opened by the launcher; its local port may differ from the previous session. A browser refresh alone cannot update a running Python server's allowlist. The native executable remains separate and is not updated by source edits.
