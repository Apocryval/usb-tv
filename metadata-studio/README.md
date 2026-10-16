# USB.tv Metadata Studio

A separate local authoring tool for Windows, macOS and Linux. Copy this entire
folder to your desktop PC; it does not need to live on the deployed USB.

It reads a USB.tv `catalog.json` and its videos, extracts audio and representative
frames with FFmpeg, transcribes with whisper.cpp, then asks a local Ollama vision
model for metadata and two TV-guide tagline styles. It never writes your catalogue.
Python uses only its standard library: there is no pip environment to install.
**Python 3.10 or newer is required.**

## Windows setup, once

1. Install [Python](https://www.python.org/downloads/windows/) (enable its launcher),
   [Ollama for Windows](https://docs.ollama.com/windows) and a current NVIDIA driver.
2. Open PowerShell and download the starter vision model:

   ```powershell
   ollama pull gemma3:4b
   ```

   Keep Ollama running. This tool uses its loopback API. Select local models only.
   You can try another vision model later by changing `model` in the config.
   Model size alone does not determine runtime memory; long context and images
   add overhead. Begin with the 4B model on either machine.
3. Get a Windows FFmpeg build using the links on the
   [FFmpeg download page](https://ffmpeg.org/download.html#build-windows).
   Extract it and either put `ffmpeg.exe` and `ffprobe.exe` in this folder's `bin/`,
   including any required DLLs, or set their full paths in the config below.
4. Get `whisper-cli.exe` from the official
   [whisper.cpp releases](https://github.com/ggml-org/whisper.cpp/releases).
   Extract the **whole Windows archive**, keeping its DLLs beside the executable.
   A CPU build is sufficient to get started; GPU acceleration is optional.
   Check that the release actually includes `whisper-cli.exe`.
5. Download `ggml-base.en.bin` from the model links in the official
   [whisper.cpp model guide](https://github.com/ggml-org/whisper.cpp/tree/master/models).
   This is an English starter model. For multilingual videos use a multilingual
   model such as `ggml-base.bin` and set `language` to `auto`. Larger Whisper models
   can improve transcription but take more time and memory.
6. Copy `config.example.json` to `config.json`. Edit the paths for your PC:

   ```json
   {
     "library_root": "E:/USB.tv",
     "ollama_url": "http://127.0.0.1:11434",
     "model": "gemma3:4b",
     "ffmpeg": "C:/AI/ffmpeg/bin/ffmpeg.exe",
     "ffprobe": "C:/AI/ffmpeg/bin/ffprobe.exe",
     "whisper_cli": "C:/AI/whisper/whisper-cli.exe",
     "whisper_model": "C:/AI/models/ggml-base.en.bin",
     "language": "en",
     "frame_count": 6,
     "context_length": 8192
   }
   ```

   Use forward slashes in JSON paths, or double each backslash. Paths can contain
   spaces. `library_root` is the folder containing `catalog.json`, `Videos` and
   `Adverts`; it can be a local copy of the library or the mounted USB.
7. Open PowerShell **in the metadata-studio folder**:

   ```powershell
   py -3 studio.py doctor
   ```

   This reports missing tool paths, the Whisper model, and whether the selected
   Ollama model is locally available. It does not install anything. The first
   actual analysis is still needed to check native binaries/drivers work together.

### Optional NVIDIA acceleration for transcription

Ollama handles its own NVIDIA acceleration. Whisper uses whichever capabilities
your `whisper-cli` build provides. A generic CPU release will not suddenly use
the RTX 5070 Ti. You can start with CPU transcription and switch its executable
path later without changing the rest of the tool.

For a CUDA build, follow the official
[whisper.cpp NVIDIA instructions](https://github.com/ggml-org/whisper.cpp#nvidia-gpu-support).
Building on Windows requires Git, CMake, Visual Studio C++ build tools and a CUDA
Toolkit compatible with your card and compiler. In a developer terminal:

```powershell
git clone https://github.com/ggml-org/whisper.cpp.git
cd whisper.cpp
cmake -B build -DGGML_CUDA=1
cmake --build build --config Release -j
```

Point `whisper_cli` to `build/bin/Release/whisper-cli.exe`. Keep the build's
libraries beside it. CUDA/compiler combinations change, so use the upstream
instructions if CMake reports a compatibility error.

## First video, then batches

Rescan in USB.tv first so every video has a stable ID and content fingerprint.
On Windows, double-click **Start Metadata Studio.bat** to analyse the first present
video. Or select specific IDs from PowerShell:

```powershell
py -3 studio.py analyze --ids 000001
py -3 studio.py analyze --ids 000002,000003,000004
py -3 studio.py analyze --all
```

Without `--ids` or `--all`, only the first video is processed. Programmes and adverts
are both supported. `--all` includes present media even if disabled for broadcast.
Each video is processed sequentially; progress appears in the terminal. Keep that
window open. Ctrl+C stops processing; completed stages remain cached. Rerun the
same command to reuse transcripts and frame summaries. Metadata itself is
regenerated, allowing changes to your genre/channel vocabulary. A failed video
is reported and the remaining batch continues.

To use a different library without editing config:

```powershell
py -3 studio.py analyze --library "F:/USB.tv" --ids 000001
```

## Review and import

After processing, `output/review.html` opens in your browser. It works as a local
file, without an HTTP server. You can also reopen it directly, or run:

```powershell
py -3 studio.py review
```

1. Read the evidence and uncertainties. Correct title, factual description,
   genres, channel allocations, tags and both tagline styles.
2. Tick **Approve** for each finished video. Editing a field unticks approval.
3. Choose **Export approved for USB.tv**. Your browser downloads JSON.
4. In the updated USB.tv player: **Library & Labels → Bulk Review & Suggestions →
   Import CSV / JSON**. Open **Description, tags & taglines** under each display
   title to inspect the extra fields. Select the rows to apply and save them.

Restart USB.tv using its launcher after updating the player: an already running
server still uses its old metadata-saving code. The Mac executable has been
rebuilt alongside this change; Windows/Linux player executables need rebuilding
using the main project's `BUILD-AND-UPDATE.md`, or you can run the updated Python
source on the authoring PC. Metadata Studio itself is Python source and does not
need a build step on any platform.

The player checks IDs, file paths and fingerprints on import. Use the catalogue
that supplied these videos; sequential IDs alone are not unique across libraries.
If you rename a file after analysis, rescan and regenerate suggestions for it.
Genres remain separate from channel routing. AI channel suggestions are limited
to existing channel names; uncertain allocations stay empty for you to decide.
**Saving replaces each approved row's label lists**, so retain any existing labels
you want when reviewing.

Use **Save review draft** before closing the page or regenerating analysis, then
**Load draft** to resume. Browser edits are not automatically written back to disk.
`output/suggestions.json` is the machine-generated report, not your browser edits.
The player stores both tagline fields for later use; this version does not add
tagline text to the TV guide presentation.

## Mac and Linux

Use native FFmpeg/ffprobe and a native whisper.cpp build (Apple Silicon builds
support Metal). Set their absolute paths and your library root in `config.json`,
download a local Ollama vision model, then:

```sh
python3 studio.py doctor
python3 studio.py analyze --ids 000001
```

`start-studio.command` is also provided for macOS. You may need `chmod +x
start-studio.command` after copying it. No Windows binaries work on macOS; the
Python pipeline and review page are shared, while native tools differ.

## Offline operation, cache and limitations

- Initial software/model downloads need internet access. For explicitly offline
  Ollama operation, set `OLLAMA_NO_CLOUD=1` in its environment and restart Ollama;
  see [Ollama's local-only mode](https://docs.ollama.com/faq#how-do-i-disable-ollamas-cloud-features).
  Studio accepts only loopback Ollama URLs and rejects detected cloud models.
  It does not fetch models or video information from the internet.
- Analysis can be slow on the first run. The starter implementation unloads the
  Ollama model after each request to keep memory available; it prioritises a
  predictable memory footprint over maximum throughput.
- `cache/<sha256>/` stores the transcript, JPEG frames, speech/frame summaries
  and evidence locally. Temporary uncompressed audio is removed after transcription.
  Cache files may contain private content; delete `cache/` to remove them.
- Cache keys include model digest, context length, transcription model file
  metadata, frame settings and pipeline version. If you modify analysis prompts
  in code, increment `PIPELINE_VERSION` to invalidate old analysis stages.
- Content hashes avoid trusting stale video IDs and allow reuse after renames.
  The complete video is hashed before analysis, which takes time on slow drives.
- Speech transcription covers the audio; only evenly spaced frames are viewed.
  The tool is not a scene-by-scene video understanding system. It can miss brief
  moments, music-only context, subtitles between samples or content at the ends.
- AI output is a suggestion. It does not infer advert break points, identify
  people from appearance, assign confidence scores or automatically save labels.
- This first version has been authored on macOS; Windows/CUDA execution and model
  quality have not yet been exercised on your desktop.

## Structure

`studio.py` separates native tool execution, Ollama requests, cached evidence,
metadata generation and report rendering. `review.html` is the standalone review
template. `config.json`, `bin/`, `models/`, `cache/` and `output/` are ignored by Git.
No companion files are included in USB.tv's native builds or update packages.
You can copy this folder independently and keep its tool/model downloads on the PC.
