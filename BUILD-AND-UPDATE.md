# Build and update USB.tv

The supported targets are Apple silicon Mac, Windows x64, and Linux x64 (Mint / Steam Deck). Build each executable on its own operating system. Python and PyInstaller are only needed on the build computers; the finished apps bundle their runtime.

## First Windows build

1. Install 64-bit Python 3.13 from https://www.python.org/downloads/windows/ (including the Python launcher).
2. Copy this whole project folder to the Windows PC. Use the **same source snapshot** on every build computer. Your videos and catalogue are not needed for building.
3. Open PowerShell in that folder and run:

```powershell
py -3.13 -m venv .build-venv
.\.build-venv\Scripts\python.exe -m pip install -r requirements-build.txt
.\.build-venv\Scripts\python.exe build.py
```

The result is `Apps\windows-x64\USBtv.exe` and `source-sha256.txt`. Copy the entire `Apps\windows-x64` folder back to the main project. Launch with `Start USB.tv.bat`. Keep its window open during playback.

## First Linux build

Use the Linux Mint laptop, preferably Mint 21 or another system with glibc 2.35 or older. Builds made on a newer Linux can require newer system libraries than another computer has. The GitHub workflow uses Ubuntu 22.04 as a baseline. Steam Deck compatibility still needs checking on the actual device.

Copy this same project snapshot to the laptop. In a terminal in that folder:

```sh
sudo apt update
sudo apt install python3 python3-venv
python3 -m venv .build-venv
.build-venv/bin/python -m pip install -r requirements-build.txt
.build-venv/bin/python build.py
```

Copy the entire `Apps/linux-x64` folder, including `source-sha256.txt`, back to the main project. Run `sh ./start-usbtv.sh` on Mint or in Steam Deck Desktop Mode. The launcher copies the executable into a user cache so it can run from an exFAT/noexec USB drive.

## Rebuild the Mac

On the Apple silicon Mac, in the same project snapshot:

```sh
python3 -m venv .build-venv
.build-venv/bin/python -m pip install -r requirements-build.txt
.build-venv/bin/python build.py
```

Keep `Apps/darwin-arm64` with the other two folders. The Mac build is unsigned by an Apple developer identity; macOS may ask you to allow it through Privacy & Security.

## Make one update for all three

After any application changes, rebuild all three targets from the same source snapshot and collect their whole `Apps/<target>` folders in one project. Then run on any build computer (Windows: substitute `.build-venv\Scripts\python.exe`):

```sh
.build-venv/bin/python package_update.py
```

This creates `dist/USBtv-all-platforms.zip`. Packaging refuses missing builds or mismatched source stamps. It includes all three executables, shared UI files, source and launchers. It does **not** include `catalog.json`, `Videos/`, `Adverts/`, or `Tools/`.

To install this ZIP onto an existing USB.tv drive:

1. Close USB.tv and its server terminal on that computer. Keep the USB connected throughout the update.
2. On Mac open `update-usbtv.command`; on Windows open `Update USB.tv.bat`; on Linux run `sh ./update-usbtv.sh`.
3. Paste the full path to the ZIP when prompted. On Mac, Finder's **Option + right-click → Copy … as Pathname** supplies a usable path. Spaces in paths are supported.
4. Wait for the success message, then use the normal launcher.

Alternatively, on Mac/Linux: `sh ./update-usbtv.sh "/full/path/USBtv-all-platforms.zip"`.

All three executables update in one operation, regardless of which device applies the update. The updater leaves `broadcasts.json` (saved channel ordering and pending transitions) alone, as well as your catalogue and media. It checks the package's allowlist and SHA-256 checksums before modifying app files. Checksums detect damage, not publisher identity: use ZIPs you built or obtained from your own build workflow. If a write fails it attempts to restore changed files and retains recovery copies under the printed `.usbtv-update-…/old` folder. An unexpected power loss is not transactional; back up your drive before major updates.

For a fresh drive, extract the ZIP into an empty USB.tv folder (the updater is for an already installed copy). Ignore `update-manifest.json` when launching. `Videos/`, `Adverts/`, and the catalogue are created on first launch.

## Faster changes to appearance

The packaged server now prefers the complete set of shared HTML/CSS/JavaScript files next to the launchers, falling back to its embedded UI if they are absent. Copying an updated complete UI set updates the interface for every platform without rebuilding executables. Backend/scanner changes require native rebuilds. This shared-UI behaviour starts with the builds made after this update; older Mac binaries need one rebuild first.

## Optional: one build action later

If you put the source in a GitHub repository, choose **Actions → Build USB.tv apps → Run workflow**. It builds all three on native runners and produces the **USBtv-all-platforms** artifact containing the single update ZIP. Download the artifact, extract its outer GitHub ZIP, then use the contained `USBtv-all-platforms.zip` with the updater. Tags starting with `v` also trigger a build. Nothing is published automatically.
