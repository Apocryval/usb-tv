# USB.tv development handoff

This is a source-only development copy prepared from the Mac project. The original playable library remains in the parent USB.tv folder. Continue development in this repository after opening it as a Codex project on either computer.

## Library data

Videos/, Adverts/, catalog.json, broadcasts.json, scan-cache.jsonl and scan-job.json are portable runtime data and are excluded from Git. Keep these on the USB or copy them separately. Apps/ holds generated native executables and is also excluded. Cloning this repository does not download the media or labels.

## Build and run

See BUILD-AND-UPDATE.md for native builds. On Windows, install Python 3, then run `py -3 -m pip install -r requirements-build.txt` and `py -3 build.py`. Start with `Start USB.tv.bat`. For source development, `py -3 server.py --library-root PATH_TO_LIBRARY` uses a separate library. Be aware that if the library has a full set of interface files, the server serves those files; copy edited interface assets into that library when previewing changes.

The GitHub Actions workflow builds all three targets and a combined update ZIP when manually started, or when a v-prefixed tag is pushed. Review GitHub Actions allowances before running hosted builds.

## Current implementation

HTML/CSS/JavaScript frontend, dependency-free Python backend, PyInstaller native packaging. Saved metadata uses relative media paths. Shared schedule snapshots persist independently of labels, with ordinary lineup additions delayed to a loop boundary at least an hour away.

Features include three themes, live channel previews, guide arrow navigation, saved guide span, scan progress and checkpoints, paginated bulk metadata review, channel arrows and delayed numeric tuning, an in-player quick label editor, and the automatic Interdimensional Customs channel for unassigned programmes. Customs removes assigned videos at the end of its current showing. Fullscreen settings choose a video-fills-screen view with app controls or whole-app fullscreen. Browsers that deny true fullscreen get a viewport-filling video view.

Mac executable builds have succeeded. Windows and Linux builds and large-library performance remain to be checked on target devices. Do not run tests unless the user asks.

## Working across machines

Commit and push code changes before switching computers; pull them on the other machine. This repository does not transfer the local Codex chat history. Share this handoff and the relevant task context when starting a new chat. Avoid editing both source copies independently without committing and merging changes.
