"""Versioned catalogue migration, stable identities and offline scanning."""
from library_paths import migrate_library_data
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import math
import os
import shutil
import threading
import platform
import sys
import time
from media import inspect_media, number, suggest_breaks, tool_path, measure_loudness, LOUDNESS_VERSION
from titles import title_from_path
from imports import ImportManager, RESERVED_FOLDERS

EXTENSIONS = {".mp4", ".m4v", ".webm", ".ogv", ".mov", ".mkv", ".avi",
              ".mpg", ".mpeg", ".wmv", ".flv", ".ts", ".m2ts", ".mts", ".3gp", ".vob"}
THEMES = ("satellite", "teletext", "goblin")
CUSTOMS_CHANNEL = "Interdimensional Customs"
STARTER_CHANNELS = ("Cartoons", "Documentaries", "Interdimensional Cable", "Sunday Morning Prerecorded")


class CatalogueConflict(ValueError):
    """An editor is saving against an out-of-date catalogue."""


def strings(value, limit=50):
    if not isinstance(value, list):
        return []
    return list(dict.fromkeys(str(item).strip()[:100] for item in value if str(item).strip()))[:limit]


def normalise_episodes(value, duration):
    if not isinstance(value, list) or len(value) > 200:
        raise ValueError("Use up to 200 episode markers")
    result, previous = [], 0
    for episode in value:
        if not isinstance(episode, dict):
            raise ValueError("Invalid episode marker")
        start, end = episode.get("start"), episode.get("end")
        if any(isinstance(point, bool) or not isinstance(point, (int, float)) or not math.isfinite(point) for point in (start, end)):
            raise ValueError("Episode boundaries must be finite seconds")
        if not 0 <= previous <= start < end <= duration:
            raise ValueError("Episode boundaries must be ordered, non-overlapping and within the video")
        title = str(episode.get("title", "")).strip()[:300]
        if not title:
            raise ValueError("Give every episode a title")
        result.append({"title": title, "start": start, "end": end})
        previous = end
    return result


def normalise_settings(settings):
    settings = settings if isinstance(settings, dict) else {}
    crt_mode = settings.get("crt_mode")
    if crt_mode not in ("off", "classic", "realistic"):
        crt_mode = "classic" if settings.get("crt", False) else "off"
    elif "crt" in settings and bool(settings["crt"]) != (crt_mode != "off"):
        # Older interfaces still write only the on/off flag.
        crt_mode = "classic" if settings["crt"] else "off"
    return {"theme": settings.get("theme") if settings.get("theme") in THEMES else "satellite",
            "crt": crt_mode != "off", "crt_mode": crt_mode,
            "volume_levelling": settings.get("volume_levelling", True) is not False,
            "volume_profile": "balanced" if settings.get("volume_profile") == "balanced" else "standard",
            "fullscreen_mode": "app" if settings.get("fullscreen_mode") == "app" else "video",
            "advanced_mode": bool(settings.get("advanced_mode", False)),
            "admin_playback": bool(settings.get("admin_playback", False)),
            "auto_imports": settings.get("auto_imports", True) is not False,
            "prepare_external_imports": settings.get("prepare_external_imports", False) is True,
            "guide_minutes": max(30, min(240, round(number(settings.get("guide_minutes"), 120) / 30) * 30)),
            "ad_interval": max(60, min(7200, number(settings.get("ad_interval"), 900))),
            "ad_length": max(0, min(600, number(settings.get("ad_length"), 90)))}


class Catalogue:
    def __init__(self, root, organise_new=True):
        self.organise_new = organise_new
        self.root = Path(root).resolve()
        self.data_root = migrate_library_data(self.root)
        self.path = self.data_root / "catalog.json"
        self.lock = threading.RLock()
        self.scan_lock = threading.Lock()
        self.root.mkdir(parents=True, exist_ok=True)
        for name in ("Videos", "Adverts"):
            (self.root / name).mkdir(exist_ok=True)
        self.folder_config = self.data_root / "video-folders.json"
        self.device = sys.platform + ":" + platform.node()
        self.video_root = self.root / "Videos"
        if self.folder_config.exists():
            saved = json.loads(self.folder_config.read_text(encoding="utf-8"))
            if saved.get(self.device):
                self.video_root = Path(saved[self.device]).resolve()

    def folder_status(self):
        return {"path": str(self.video_root), "default": str(self.root / "Videos"),
                "available": self.video_root.is_dir()}

    def set_video_folder(self, value):
        if not isinstance(value, str):
            raise ValueError("Enter a folder path.")
        path = Path(value.strip().strip('\"')).expanduser() if value.strip() else self.root / "Videos"
        if not path.is_absolute():
            raise ValueError("Enter the full folder path.")
        path = path.resolve()
        if not path.is_dir():
            raise ValueError("That folder is unavailable. Check the path and connect the drive.")
        # Force a permission check before persisting the selection.
        next(path.iterdir(), None)
        adverts = (self.root / "Adverts").resolve()
        if path.is_relative_to(adverts) or adverts.is_relative_to(path):
            raise ValueError("Choose a video folder separate from the Adverts folder.")
        if not self.scan_lock.acquire(blocking=False):
            raise ValueError("Wait for the scan to finish, or pause it before changing folders.")
        try:
            with self.lock:
                saved = json.loads(self.folder_config.read_text(encoding="utf-8")) if self.folder_config.exists() else {}
                saved[self.device] = str(path)
                temporary = self.folder_config.with_suffix(".json.tmp")
                temporary.write_text(json.dumps(saved, indent=2) + "\n", encoding="utf-8")
                temporary.replace(self.folder_config)
                self.video_root = path
        finally:
            self.scan_lock.release()
        return self.folder_status()

    def media_path(self, relative):
        relative = Path(relative)
        if not relative.parts or relative.parts[0] not in ("Videos", "Adverts"):
            raise ValueError("Invalid media path")
        base = self.video_root if relative.parts[0] == "Videos" else self.root / "Adverts"
        target = base.joinpath(*relative.parts[1:]).resolve()
        if not target.is_relative_to(base.resolve()):
            raise ValueError("Invalid media path")
        return target

    def media_name(self, path):
        if path.is_relative_to(self.video_root):
            return "Videos/" + path.relative_to(self.video_root).as_posix()
        return path.relative_to(self.root).as_posix()

    def read(self):
        if not self.path.exists():
            return {"version": 2, "revision": 0, "next_id": 1, "settings": normalise_settings({}), "channels": [], "genres": [], "videos": []}
        # A broken existing catalogue must not silently erase the user's labels.
        data = json.loads(self.path.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or not isinstance(data.get("videos"), list):
            raise ValueError("catalog.json is not a valid catalogue; restore it from a backup.")
        data["settings"] = normalise_settings(data.get("settings"))
        data.setdefault("revision", 0)
        data.setdefault("channels", [])
        data.setdefault("genres", [])
        data.setdefault("label_rules", [])
        return data

    def write(self, data):
        revision = 0
        if self.path.exists():
            current = json.loads(self.path.read_text(encoding="utf-8"))
            revision = current.get("revision", 0)
            if current.get("version", 1) < 2:
                backup = self.data_root / "catalog.v1.backup.json"
                if not backup.exists():
                    shutil.copy2(self.path, backup)
        data["revision"] = revision + 1
        temporary = self.path.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(self.path)

    def discover(self):
        paths = []
        if not self.video_root.is_dir():
            raise ValueError("Video folder is unavailable. Reconnect the drive or choose another folder in Library & labels.")
        for folder in (self.video_root, self.root / "Adverts"):
            def walk_error(error):
                raise error
            for directory, folders, names in os.walk(folder, followlinks=False, onerror=walk_error):
                folders[:] = [name for name in folders if name not in RESERVED_FOLDERS]
                for name in names:
                    path = Path(directory) / name
                    if path.is_file() and path.suffix.lower() in EXTENSIONS and path.resolve().is_relative_to(folder.resolve()):
                        paths.append(path)
        return sorted(paths, key=lambda path: self.media_name(path).casefold())

    def commit_scan(self, candidate, baseline):
        """Merge scan-owned fields with any labels edited while I/O was running."""
        with self.lock:
            current = self.read()
            actual = {item["id"]: item for item in current["videos"] if "id" in item}
            by_file = {item.get("file"): item for item in current["videos"]}
            original = {item["id"]: item for item in baseline["videos"] if "id" in item}
            original_files = {item.get("file"): item for item in baseline["videos"]}
            editable = ("title", "title_source", "genres", "channels", "tags", "description", "tagline", "tagline_goblin",
                        "enabled", "type", "bumper_role", "break_points", "breaks_approved", "duration", "episode_review", "episodes")
            result = []
            for scanned in candidate["videos"]:
                item = dict(scanned)
                latest = actual.get(item["id"]) or by_file.get(item.get("file"))
                before = original.get(item["id"]) or original_files.get(item.get("file"))
                if latest and before:
                    for key in editable:
                        if (key in ("duration", "episodes", "episode_review", "break_points", "breaks_approved")
                                and latest.get("fingerprint") != item.get("fingerprint")):
                            continue
                        if latest.get(key) != before.get(key):
                            item[key] = latest.get(key)
                    if latest.get('title') != before.get('title'):
                        item['title_source'] = latest.get('title_source') if latest.get('title_source') != before.get('title_source') else 'manual'
                item["genre"] = ", ".join(item.get("genres", []))
                result.append(item)
            ids = {item["id"] for item in result}
            files = {item.get("file") for item in result}
            result.extend(item for item in current["videos"] if item.get("id") not in ids and item.get("file") not in files)
            current.update(version=2, next_id=max(candidate["next_id"], current.get("next_id", 1)), videos=result)
            if current.get("starter_channels_version", 0) < 1:
                known = {str(c.get("name", "")).casefold() for c in current["channels"] if isinstance(c, dict)}
                current["channels"].extend({"name": name} for name in STARTER_CHANNELS if name.casefold() not in known)
                current["starter_channels_version"] = 1
            if not any(c.get("name") == CUSTOMS_CHANNEL for c in current["channels"] if isinstance(c, dict)):
                current["channels"].append({"name": CUSTOMS_CHANNEL, "ad_length": 0})
            for item in result:
                item["channels"] = [name for name in item.get("channels", []) if name != CUSTOMS_CHANNEL]
            current["genres"] = strings(current["genres"] + [g for item in result for g in item.get("genres", [])])
            known = {c["name"] for c in current["channels"] if isinstance(c, dict) and c.get("name")}
            for name in strings([name for item in result for name in item.get("channels", [])]):
                if name not in known:
                    current["channels"].append({"name": name})
                    known.add(name)
            hashes = {}
            for item in result:
                item.pop("duplicate_of", None)
                if not item.get("missing") and item.get("fingerprint"):
                    first = hashes.setdefault(item["fingerprint"], item["id"])
                    if first != item["id"]:
                        item["duplicate_of"] = first
            if not self.path.exists() or current != self.read():
                self.write(current)
            return current

    def scan(self, progress=None, cancelled=None):
        progress = progress or (lambda **values: None)
        cancelled = cancelled or (lambda: False)
        with self.scan_lock:
            with self.lock:
                baseline = self.read()
            # Keep an immutable baseline for concurrent label-edit merging.
            data = json.loads(json.dumps(baseline))
            old = [item for item in data["videos"] if isinstance(item, dict)]
            next_id = max(int(data.get("next_id", 1)), max((int(item["id"]) + 1 for item in old if str(item.get("id", "")).isdigit()), default=1))
            for item in old:
                if not str(item.get("id", "")).isdigit():
                    item["id"] = f"{next_id:06d}"
                    next_id += 1
                else:
                    item["id"] = f"{int(item['id']):06d}"
                item.setdefault("genres", [item["genre"]] if item.get("genre") and item["genre"] != "Unsorted" else [])
                item["genres"] = strings(item["genres"])
                item["channels"] = strings(item.get("channels", []))
                item.setdefault("type", "advert" if str(item.get("file", "")).startswith("Adverts/") else "programme")
                for key, value in (("title", ""), ("duration", 0), ("tags", []), ("enabled", True), ("break_points", []), ("suggested_break_points", []), ("breaks_approved", False), ("description", "")):
                    item.setdefault(key, value)
            data.update(next_id=next_id, videos=old)
            self.commit_scan(data,baseline)
            by_file = {item["file"]: item for item in old if "file" in item}
            by_hash = {}
            for item in old:
                by_hash.setdefault(item.get("fingerprint", ""), []).append(item)
            cache_path = self.data_root / "scan-cache.jsonl"
            cache = {}
            journal_dirty = False
            if cache_path.exists():
                with cache_path.open(encoding="utf-8") as handle:
                    for line in handle:
                        try:
                            entry = json.loads(line)
                            if isinstance(entry, dict) and isinstance(entry.get("file"), str):
                                cache[entry["file"]] = entry
                        except (ValueError, TypeError):
                            continue  # a power loss may leave an incomplete final journal line
            progress(stage="discovering", completed=0, total=0, current="")
            files = self.discover()
            organiser = None
            import_errors = []
            organise_new = self.organise_new and data["settings"]["auto_imports"]
            external = self.video_root.resolve() != (self.root / "Videos").resolve()
            def may_prepare(name):
                return not name.startswith("Videos/") or not external or data["settings"]["prepare_external_imports"]
            if organise_new or (self.root / "imports.json").exists():
                organiser = ImportManager(self.root, {"Videos": self.video_root, "Adverts": self.root / "Adverts"}, old, files)
                if organise_new:
                    import_errors = organiser.recover(cancelled, may_prepare)
                files = [path for path in self.discover() if not organiser.pending_destination(self.media_name(path))]
            present = {self.media_name(path) for path in files}
            used, updated, errors = set(), [], import_errors
            def checkpoint(final=False):
                remaining = [dict(item, missing=item.get("file") not in present) if final else item for item in old if item["id"] not in used]
                data.update(version=2, next_id=next_id, videos=updated + remaining)
                merged = self.commit_scan(data,baseline)
                # Advance the merge baseline and local drafts together: a later
                # checkpoint must preserve edits, including cleared labels.
                saved = {item["id"]: item for item in merged["videos"]}
                for item in old + updated:
                    current = saved.get(item["id"], {})
                    for key in ("title", "genres", "channels", "tags", "description", "tagline", "tagline_goblin", "enabled", "type", "bumper_role", "break_points", "breaks_approved", "duration", "episode_review", "episodes"):
                        if key in current:
                            item[key] = current[key]
                baseline.clear()
                baseline.update(json.loads(json.dumps(merged)))
                return merged
            try:
                for index, path in enumerate(files):
                    if cancelled():
                        raise InterruptedError("Scan paused; completed work is saved on the drive.")
                    rel = self.media_name(path)
                    progress(stage="scanning", completed=index, total=len(files), current=rel)
                    try:
                        stat = path.stat()
                        previous = by_file.get(rel)
                        source = str(path.resolve())
                        same = previous and previous.get("scan_source") == source and previous.get("size") == stat.st_size and previous.get("modified_ns") == stat.st_mtime_ns
                        cached = cache.get(rel, {})
                        cached_same = cached.get("scan_source") == source and cached.get("size") == stat.st_size and cached.get("modified_ns") == stat.st_mtime_ns
                        fingerprint = previous.get("fingerprint") if same else cached.get("fingerprint") if cached_same else None
                        if not fingerprint:
                            digest = hashlib.sha256()
                            with path.open("rb") as handle:
                                while chunk := handle.read(1024 * 1024):
                                    if cancelled():
                                        raise InterruptedError("Scan paused; completed work is saved on the drive.")
                                    digest.update(chunk)
                            fingerprint = digest.hexdigest()
                        match = previous or next((v for v in by_hash.get(fingerprint, []) if v["file"] not in present and v["id"] not in used), None)
                        new = match is None
                        import_info = {}
                        after_hash = path.stat()
                        if (after_hash.st_size, after_hash.st_mtime_ns) != (stat.st_size, stat.st_mtime_ns):
                            raise ValueError("File is still changing/copying; it will be retried on the next scan")
                        if new and organise_new and may_prepare(rel):
                            progress(stage="importing", completed=index, total=len(files), current=rel)
                            path, fingerprint, import_info = organiser.prepare(path, fingerprint, cancelled)
                            imported_rel = self.media_name(path)
                            present.discard(rel); present.add(imported_rel)
                            rel = imported_rel
                            stat = path.stat(); source = str(path.resolve())
                            cached_same = False; cached = {}
                            # A recovered conversion can have a prior catalogue entry
                            # for its original container. Carry those labels across.
                            match = next((v for v in by_hash.get(import_info.get("original_fingerprint"), [])
                                          if v["file"] not in present and v["id"] not in used), None)
                            new = match is None
                        item = dict(match) if match else {"id": f"{next_id:06d}", "title": "", "genres": [], "channels": [], "tags": [], "enabled": True,
                            "type": "advert" if rel.startswith("Adverts/") else "programme", "added_at": datetime.now(timezone.utc).isoformat(),
                            "break_points": [], "suggested_break_points": [], "breaks_approved": False, "description": ""}
                        item.update(import_info)
                        # Different OS timestamp precision can cause a rehash, but identical
                        # content keeps its previously collected metadata and user labels.
                        metadata = None
                        if new or item.get("fingerprint") != fingerprint:
                            metadata = cached.get("metadata") if cached_same and cached.get("fingerprint") == fingerprint else None
                            if not isinstance(metadata, dict):
                                metadata = inspect_media(path, self.root)
                            item["duration"] = metadata.get("duration", 0)
                            item["technical"] = metadata.get("technical", {})
                            if not item.get("title") and item.get('title_source') != 'manual' and str(metadata.get("title", '')).strip():
                                item["title"] = metadata["title"][:300]
                                item['title_source'] = 'embedded'
                            if not item.get("genres") and metadata.get("genre"):
                                item["genres"] = [metadata["genre"][:100]]
                            item["suggested_break_points"], item["break_suggestion_source"] = suggest_breaks(item["duration"], metadata.get("chapters", []))
                            if item.get("fingerprint") != fingerprint:
                                item.pop("audio_analysis", None)
                            if not new and item.get("fingerprint") != fingerprint:
                                item["break_points"], item["breaks_approved"] = [], False
                                if item.get("episodes") or item.get("episode_review", "unchecked") != "unchecked":
                                    item["previous_episode_metadata"] = {
                                        "fingerprint":item.get("fingerprint"),
                                        "episode_review":item.get("episode_review", "unchecked"),
                                        "episodes":item.get("episodes", [])}
                                item["episodes"], item["episode_review"] = [], "unchecked"
                            item["probe_status"] = "ready" if item["duration"] > 0 else "needs_browser"
                        if not str(item.get('title', '')).strip() and item.get('title_source') != 'manual':
                            generated = title_from_path(rel, item.get('original_name'))
                            if generated:
                                item['title'] = generated
                                item['title_source'] = 'filename'
                        after = path.stat()
                        if (after.st_size, after.st_mtime_ns) != (stat.st_size,stat.st_mtime_ns):
                            raise ValueError("File is still changing/copying; it will be retried on the next scan")
                        if new:
                            next_id += 1
                        used.add(item["id"])
                        item.update(file=rel, scan_source=source, size=stat.st_size, modified_ns=stat.st_mtime_ns, fingerprint=fingerprint, missing=False)
                        updated.append(item)
                        if new:
                            baseline["videos"].append(json.loads(json.dumps(item)))
                        if not same and not cached_same:
                            entry = {"file": rel, "scan_source": source, "size": stat.st_size, "modified_ns": stat.st_mtime_ns, "fingerprint": fingerprint, "metadata": metadata}
                            # Append small records immediately; no full catalogue rewrite per file.
                            with cache_path.open("a", encoding="utf-8") as handle:
                                handle.write("\n" + json.dumps(entry,ensure_ascii=False) + "\n")
                                handle.flush()
                                os.fsync(handle.fileno())
                            cache[rel] = entry
                            journal_dirty = True
                    except InterruptedError:
                        raise
                    except (OSError, ValueError) as error:
                        errors.append({"file": rel, "error": str(error)})
                    if (index + 1) % 25 == 0:
                        checkpoint()
                    progress(completed=index+1, total=len(files), errors=errors)
                result = checkpoint(final=True)
                # Compact only after a changed scan, keeping the journal bounded.
                if journal_dirty:
                    compact = cache_path.with_suffix(".jsonl.tmp")
                    compact.write_text("".join(json.dumps(cache[v["file"]],ensure_ascii=False)+"\n" for v in updated if v["file"] in cache), encoding="utf-8")
                    if not cache_path.exists() or compact.read_bytes() != cache_path.read_bytes():
                        compact.replace(cache_path)
                    else:
                        compact.unlink()
                return result
            except BaseException:
                checkpoint()
                raise

    def audio_status(self):
        with self.lock:
            data = self.read()
        videos = [v for v in data["videos"] if not v.get("missing") and v.get("enabled", True)]
        checked = [v for v in videos if self.audio_current(v) and v["audio_analysis"].get("status") != "failed"]
        return {"available": bool(tool_path("ffmpeg", self.root)), "total": len(videos),
                "checked": len(checked), "enabled": data["settings"]["volume_levelling"]}

    @staticmethod
    def audio_current(item):
        audio = item.get("audio_analysis") or {}
        return bool(item.get("fingerprint")) and audio.get("fingerprint") == item["fingerprint"] and audio.get("version") == LOUDNESS_VERSION

    def analyse_audio(self, progress=None, cancelled=None):
        progress = progress or (lambda **values: None)
        cancelled = cancelled or (lambda: False)
        ffmpeg = tool_path("ffmpeg", self.root)
        if not ffmpeg:
            progress(audio_note="New audio measurements need FFmpeg; saved levels remain available.")
            return self.read()
        with self.scan_lock:
            with self.lock:
                data = self.read()
            if not data["settings"]["volume_levelling"]:
                return data
            queue = [dict(item) for item in data["videos"] if not item.get("missing") and item.get("enabled", True)
                     and item.get("fingerprint") and (not self.audio_current(item)
                     or item["audio_analysis"].get("status") == "failed" and time.time() - item["audio_analysis"].get("measured_at", 0) > 3600)]
            if not queue:
                return data
            cache_path = self.data_root / "loudness-cache.jsonl"
            cache = {}
            if cache_path.exists():
                for line in cache_path.read_text(encoding="utf-8").splitlines():
                    try:
                        entry = json.loads(line)
                        if entry.get("version") == LOUDNESS_VERSION:
                            cache[entry["fingerprint"]] = entry
                    except (ValueError, KeyError, AttributeError):
                        pass
            pending = {}
            errors = []
            def commit():
                if not pending:
                    return
                with self.lock:
                    current = self.read()
                    for item in current["videos"]:
                        audio = pending.get(item.get("fingerprint"))
                        if audio:
                            item["audio_analysis"] = audio
                    self.write(current)
                pending.clear()
            progress(stage="audio", completed=0, total=len(queue), current="", changed=True)
            try:
                for index, snapshot in enumerate(queue):
                    if cancelled():
                        raise InterruptedError("Audio analysis paused; completed measurements are saved.")
                    with self.lock:
                        if not self.read()["settings"]["volume_levelling"]:
                            break
                    progress(stage="audio", completed=index, total=len(queue), current=snapshot["file"])
                    fingerprint = snapshot["fingerprint"]
                    audio = cache.get(fingerprint)
                    if audio and audio.get("status") == "failed" and time.time() - audio.get("measured_at", 0) > 3600:
                        audio = None
                    if not audio:
                        try:
                            path = self.media_path(snapshot["file"])
                            before = path.stat()
                            if before.st_size != snapshot.get("size") or before.st_mtime_ns != snapshot.get("modified_ns"):
                                raise RuntimeError("File changed; rescan before measuring audio.")
                            audio = measure_loudness(path, ffmpeg, cancelled)
                            after = path.stat()
                            if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                                raise RuntimeError("File changed during audio analysis; rescan to retry.")
                        except InterruptedError:
                            raise
                        except (OSError, ValueError, RuntimeError) as error:
                            audio = {"status": "failed", "gain_db": 0, "error": str(error)}
                        audio.update(version=LOUDNESS_VERSION, fingerprint=fingerprint, measured_at=time.time())
                        # Journal each completed result; a crash never requires repeating the whole batch.
                        with cache_path.open("a", encoding="utf-8") as handle:
                            handle.write("\n" + json.dumps(audio, allow_nan=False) + "\n")
                            handle.flush(); os.fsync(handle.fileno())
                        cache[fingerprint] = audio
                    if audio.get("status") == "failed":
                        errors.append({"file": snapshot["file"], "error": audio.get("error", "Audio analysis failed")})
                    pending[fingerprint] = audio
                    if (index + 1) % 10 == 0:
                        commit()
                    progress(completed=index+1, total=len(queue), errors=errors)
            finally:
                commit()
            return self.read()

    def save_edits(self, incoming):
        with self.lock:
            data = self.read()
            if "revision" in incoming and incoming["revision"] != data["revision"]:
                raise CatalogueConflict("The library changed since this page loaded. Refresh before saving; your changes have not been written.")
            existing = {item["id"]: item for item in data["videos"]}
            if not isinstance(incoming.get("videos"), list):
                raise ValueError("Expected a videos list")
            for edit in incoming["videos"]:
                if not isinstance(edit, dict) or edit.get("id") not in existing:
                    raise ValueError("Unknown video ID. Rescan the library first.")
                item = existing[edit["id"]]
                if "fingerprint" in edit and edit["fingerprint"] != item.get("fingerprint"):
                    raise CatalogueConflict("This video's content changed. Refresh and review it before saving.")
                old_title = item.get('title', '')
                for key, limit in (("title", 300), ("description", 1000), ("tagline", 300), ("tagline_goblin", 300)):
                    item[key] = str(edit.get(key, item.get(key, ""))).strip()[:limit]
                if item['title'] != old_title or item.get('title_source') == 'filename' and edit.get('title_source') == 'manual':
                    item['title_source'] = 'manual'
                for key in ("genres", "channels", "tags"):
                    item[key] = strings(edit.get(key, item.get(key, [])))
                item["channels"] = [name for name in item["channels"] if name != CUSTOMS_CHANNEL]
                item["genre"] = ", ".join(item["genres"])
                item["type"] = edit.get("type", item.get("type")) if edit.get("type", item.get("type")) in ("advert", "bumper") else "programme"
                if item["type"] == "bumper":
                    item["bumper_role"] = edit.get("bumper_role", item.get("bumper_role")) if edit.get("bumper_role", item.get("bumper_role")) in ("from_ads", "both") else "to_ads"
                item["enabled"] = bool(edit.get("enabled", item.get("enabled", True)))
                # Browser probing is a fallback for formats the built-in reader cannot inspect.
                if not number(item.get("duration")) and number(edit.get("duration")) > 0:
                    item["duration"] = min(number(edit["duration"]), 7 * 86400)
                    item["probe_status"] = "ready"
                    points, source = suggest_breaks(item["duration"])
                    item["suggested_break_points"], item["break_suggestion_source"] = points, source
                points = edit.get("break_points", item.get("break_points", []))
                if not isinstance(points, list):
                    raise ValueError("Break points must be a list of seconds")
                item["break_points"] = sorted(set(round(number(point), 3) for point in points if 0 < number(point) < number(item.get("duration"))))[:100]
                item["breaks_approved"] = bool(edit.get("breaks_approved", item.get("breaks_approved", False)))
                review = edit.get("episode_review", item.get("episode_review", "unchecked"))
                if review not in ("unchecked", "single", "multiple"):
                    raise ValueError("Invalid episode review choice")
                episodes = normalise_episodes(edit.get("episodes", item.get("episodes", [])), number(item.get("duration")))
                if review == "multiple" and len(episodes) < 2:
                    raise ValueError("Add at least two episode markers, or choose Single programme")
                item["episode_review"] = review
                item["episodes"] = episodes

            data["settings"] = normalise_settings(incoming.get("settings", data["settings"]))
            rules = incoming.get("label_rules", data.get("label_rules", []))
            if not isinstance(rules, list) or len(rules) > 200:
                raise ValueError("Use up to 200 labelling rules")
            data["label_rules"] = [{"keyword": str(rule.get("keyword", "")).strip()[:100], "genres": strings(rule.get("genres", [])), "channels": strings(rule.get("channels", []))} for rule in rules if isinstance(rule, dict) and str(rule.get("keyword", "")).strip()]
            channels = incoming.get("channels", data["channels"])
            if not isinstance(channels, list):
                raise ValueError("Expected a channel list")
            cleaned_channels = []
            seen = set()
            for channel in channels[:100]:
                if not isinstance(channel, dict):
                    continue
                name = str(channel.get("name", "")).strip()[:100]
                if name and name not in seen:
                    seen.add(name)
                    cleaned_channels.append({"name": name,
                        "ad_interval": max(60, min(7200, number(channel.get("ad_interval"), data["settings"]["ad_interval"]))),
                        "ad_length": max(0, min(600, number(channel.get("ad_length"), data["settings"]["ad_length"])))} )
            for item in data["videos"]:
                for name in item.get("channels", []):
                    if name not in seen:
                        cleaned_channels.append({"name": name})
                        seen.add(name)
            if CUSTOMS_CHANNEL not in seen:
                cleaned_channels.append({"name": CUSTOMS_CHANNEL, "ad_length": 0})
            data["channels"] = cleaned_channels
            data["genres"] = strings(strings(incoming.get("genres", data["genres"])) + [genre for item in data["videos"] for genre in item.get("genres", [])])
            self.write(data)
            return data
