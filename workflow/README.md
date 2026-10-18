# Local video classification workflow

The executable authoring workflow lives in `../metadata-studio/`; this folder holds its interchange/design notes. The canonical channel and genre policy is `../metadata-studio/taxonomy.json`. User-supplied channel definitions and a TV-style genre vocabulary were agreed on 2026-10-17. `taxonomy.draft.json` now points to the canonical policy instead of duplicating it.

## Policy

Eight assignable channels can overlap: Cartoons, Documentaries, Interdimensional Cable, Sunday Morning Prerecorded, Now That's What I Call Shit!, TTTV, Goblin TV and CRTV. Interdimensional Customs remains automatic. Read the canonical policy for inclusion/exclusion rules; channel names alone are not classification rules.

Genres describe content and format, with up to four per video. Topics such as physics, LGBTQ+, drag, SNL, TF2 and goblincore are tags. Existing library labels remain unchanged until replacement suggestions are approved. Very short surreal clips provisionally means around 60 seconds for Goblin TV; TF2/goblincore are unrestricted by length. CRTV means original release in 2004 or earlier, with supporting evidence for the actual content rather than the series start date or upload timestamp.

## Current implementation

`catalogue → FFmpeg frames + whisper.cpp transcript → local Ollama vision/text analysis → structured metadata → Studio review → USB.tv bulk import`

Studio respects USB.tv's external programme-folder mapping and hashes content before analysis. It stores resumable raw evidence and model summaries locally, uses the explicit policy and closed channel/genre enums, validates model output, and records policy/model identity plus per-video timing/token counts. It preserves existing titles by default. All assignments are suggestions; the tool never writes the catalogue. New policy runs do not merge old-policy suggestions silently.

Dependencies were installed and verified on 2026-10-17 under E:/USBtv-AI: portable Ollama, Qwen3-VL 8B Instruct, whisper.cpp CPU and base.en transcription weights. The doctor check reports ready. A synthetic speech/video sample passed real local transcription, CUDA vision inference, metadata generation and USB.tv import validation. No live media was analysed. The Studio launcher starts local Ollama automatically; E: must be connected. A representative real-library pilot remains necessary to evaluate classification quality and throughput.

## Interchange

`review-template.csv` contains all columns: id, file, fingerprint, type, title, genres, channels, description, tags, evidence, uncertainties, confidence. Studio excludes taglines from generation and export, including when loading older drafts. Existing manually written player taglines are preserved. Export a populated template from USB.tv to obtain correct identity values; catalogue IDs differ from filename reference numbers.

JSON is preferred for preserving lists and punctuation. `output.schema.draft.json` documents the contract, including optional release evidence and Studio review metadata. CSV uncertainties use a JSON array; other lists use semicolons. Missing fields preserve existing values; explicitly empty fields clear them. Imported rows start unselected. Review context is not saved as programme copy. Episode markers, schedule clocks and loudness analysis are outside classification output.

## Next refinements

- Prefer existing subtitles where useful; the current transcription adapter uses whisper.cpp audio transcription.
- Improve scene-aware sampling and timestamped transcript evidence for long compilations; current frames are evenly spaced and cannot establish every moment's content.
- Benchmark a mixed pilot across the channels, adverts, no-speech/music videos and ambiguous examples before a full-library run.
- Consider cloud review only for difficult cases after measuring local quality and usage. No cloud provider is enabled and no media has been uploaded.

Model weights, transcripts and derived caches stay out of portable player updates and Git. Approved labels remain in the existing portable catalogue, preserving the HDD-to-USB workflow.
