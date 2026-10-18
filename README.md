# USB.tv

A local, portable TV-style player for your own video collection. Your browser
plays the media; USB.tv serves it locally and saves channel assignments.

## Start the development app

- Windows: double-click **Start USB.tv.bat** in this folder.
- Linux x64 / Apple silicon Mac: run `sh ./start-usbtv.sh` in this folder.
- Keep the server terminal open while watching. Stop it before moving the library.

The launchers use `Apps/<platform>/USBtv` (USBtv.exe on Windows). If a native
build is absent, they fall back to `src/server.py` with a local Python install.
The development library still reads the external video folder saved in its
settings; moving code does not move or rename your media.

## Folder map

| Folder | Contents |
| --- | --- |
| `web/` | Browser interface, player logic, scheduling, styles and effects |
| `src/` | Python server, catalogue, scanner, imports and updater |
| `scripts/` | Build and update-package commands; build requirements |
| `data/` | **Personal** catalogue, saved broadcasts, folder choices, caches and logs |
| `docs/` | User guide, build/update guide, development handoff and classification notes |
| `tests/` | Python and JavaScript regression tests |
| `metadata-studio/` | Separate metadata authoring tool; its cache/output are preserved |
| `Apps/` | Built executables for each supported platform |
| `Tools/` | Optional platform-specific FFmpeg/FFprobe |
| `Videos/`, `Adverts/` | Default media locations; an external Videos folder is also supported |
| `.local/` | Ignored build environment, temporary builds, archived experiments and backups |
| `build/` | Residual protected session cache from older smoke tests; not used by current builds |

Application folders and tests belong in Git. `data/`, media, built apps, tools,
Studio caches/output and `.local/` are ignored. Do not delete `data/` as clutter:
its catalogue and broadcasts contain your assignments and saved station clocks.

## Existing libraries

Libraries with saved JSON files at the root still work. When a `data/` folder
is present, the server acquires its library session lock and moves saved state
there on startup. The filenames and contents are preserved. If both locations
contain different copies of a file, startup stops rather than overwriting one.
A partial move can resume on the next launch. Media folders stay at the root.

The old development state is backed up locally under
`.local/backups/pre-layout-library/`. Historical test/build folders are under
`.local/archive/pre-layout/`; they are reference material, not launch targets.
The Desktop and USB production copies are independent and are not changed by
work in this repository.

## Develop and test

On Windows, using the existing local environment:

```powershell
.\.local\venv\Scripts\python.exe -B -m unittest discover -s tests -p 'test_*.py'
node --test tests/*.test.js
.\.local\venv\Scripts\python.exe scripts/build.py
```

On Linux/Mac, create `.local/venv`, install `scripts/requirements-build.txt`,
and run `.local/venv/bin/python scripts/build.py`. Build each native executable
on its own OS. Build output goes into `Apps/`; intermediate files go into
`.local/build/`. The all-platform ZIP is made with `scripts/package_update.py`
only after all three builds are present and their source stamps match.

## Further instructions

- [Using the player](docs/USER-GUIDE.md)
- [Building and updating Windows, Linux and Mac](docs/BUILD-AND-UPDATE.md)
- [Metadata Studio](metadata-studio/README.md)
- [Classification workflow](docs/workflow/README.md)
- [Development handoff and history](docs/PROJECT-HANDOFF.md)
