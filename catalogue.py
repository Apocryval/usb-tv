"""Versioned catalogue migration, stable identities and offline scanning."""
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import os
import shutil
import threading
from media import inspect_media, number, suggest_breaks

EXTENSIONS = {".mp4", ".m4v", ".webm", ".ogv", ".mov", ".mkv", ".avi"}
THEMES = ("satellite", "teletext", "goblin")
CUSTOMS_CHANNEL = "Interdimensional Customs"
STARTER_CHANNELS = ("Cartoons", "Documentaries", "Interdimensional Cable", "Sunday Morning Prerecorded")


def strings(value, limit=50):
    if not isinstance(value, list):
        return []
    return list(dict.fromkeys(str(item).strip()[:100] for item in value if str(item).strip()))[:limit]


def normalise_settings(settings):
    settings = settings if isinstance(settings, dict) else {}
    return {"theme": settings.get("theme") if settings.get("theme") in THEMES else "satellite",
            "crt": bool(settings.get("crt", False)),
            "fullscreen_mode": "app" if settings.get("fullscreen_mode") == "app" else "video",
            "advanced_mode": bool(settings.get("advanced_mode", False)),
            "guide_minutes": max(30, min(240, round(number(settings.get("guide_minutes"), 120) / 30) * 30)),
            "ad_interval": max(60, min(7200, number(settings.get("ad_interval"), 900))),
            "ad_length": max(0, min(600, number(settings.get("ad_length"), 90)))}


class Catalogue:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.path = self.root / "catalog.json"
        self.lock = threading.RLock()
        self.scan_lock = threading.Lock()
        self.root.mkdir(parents=True, exist_ok=True)
        for name in ("Videos", "Adverts"):
            (self.root / name).mkdir(exist_ok=True)

    def read(self):
        if not self.path.exists():
            return {"version": 2, "next_id": 1, "settings": normalise_settings({}), "channels": [], "genres": [], "videos": []}
        # A broken existing catalogue must not silently erase the user's labels.
        data = json.loads(self.path.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or not isinstance(data.get("videos"), list):
            raise ValueError("catalog.json is not a valid catalogue; restore it from a backup.")
        data["settings"] = normalise_settings(data.get("settings"))
        data.setdefault("channels", [])
        data.setdefault("genres", [])
        data.setdefault("label_rules", [])
        return data

    def write(self, data):
        if self.path.exists():
            current = json.loads(self.path.read_text(encoding="utf-8"))
            if current.get("version", 1) < 2:
                backup = self.root / "catalog.v1.backup.json"
                if not backup.exists():
                    shutil.copy2(self.path, backup)
        temporary = self.path.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(self.path)

    def discover(self):
        paths = []
        for folder in ("Videos", "Adverts"):
            for path in (self.root / folder).rglob("*"):
                if path.is_file() and path.suffix.lower() in EXTENSIONS and path.resolve().is_relative_to(self.root / folder):
                    paths.append(path)
        return sorted(paths, key=lambda path: path.relative_to(self.root).as_posix().casefold())

    def commit_scan(self, candidate, baseline):
        """Merge scan-owned fields with any labels edited while I/O was running."""
        with self.lock:
            current = self.read()
            actual = {item["id"]: item for item in current["videos"]}
            by_file = {item.get("file"): item for item in current["videos"]}
            original = {item["id"]: item for item in baseline["videos"]}
            original_files = {item.get("file"): item for item in baseline["videos"]}
            editable = ("title", "genres", "channels", "tags", "description", "tagline", "tagline_goblin",
                        "enabled", "type", "break_points", "breaks_approved", "duration")
            result = []
            for scanned in candidate["videos"]:
                item = dict(scanned)
                latest = actual.get(item["id"]) or by_file.get(item.get("file"))
                before = original.get(item["id"]) or original_files.get(item.get("file"))
                if latest and before:
                    for key in editable:
                        if latest.get(key) != before.get(key):
                            item[key] = latest.get(key)
                item["genre"] = ", ".join(item.get("genres", []))
                result.append(item)
            ids = {item["id"] for item in result}
            files = {item.get("file") for item in result}
            result.extend(item for item in current["videos"] if item["id"] not in ids and item.get("file") not in files)
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
            cache_path = self.root / "scan-cache.jsonl"
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
            present = {path.relative_to(self.root).as_posix() for path in files}
            used, updated, errors = set(), [], []
            def checkpoint(final=False):
                remaining = [dict(item, missing=item.get("file") not in present) if final else item for item in old if item["id"] not in used]
                data.update(version=2, next_id=next_id, videos=updated + remaining)
                merged = self.commit_scan(data,baseline)
                # Advance the merge baseline and local drafts together: a later
                # checkpoint must preserve edits, including cleared labels.
                saved = {item["id"]: item for item in merged["videos"]}
                for item in old + updated:
                    current = saved.get(item["id"], {})
                    for key in ("title", "genres", "channels", "tags", "description", "tagline", "tagline_goblin", "enabled", "type", "break_points", "breaks_approved", "duration"):
                        if key in current:
                            item[key] = current[key]
                baseline.clear()
                baseline.update(json.loads(json.dumps(merged)))
                return merged
            try:
                for index, path in enumerate(files):
                    if cancelled():
                        raise InterruptedError("Scan paused; completed work is saved on the drive.")
                    rel = path.relative_to(self.root).as_posix()
                    progress(stage="scanning", completed=index, total=len(files), current=rel)
                    try:
                        stat = path.stat()
                        previous = by_file.get(rel)
                        same = previous and previous.get("size") == stat.st_size and previous.get("modified_ns") == stat.st_mtime_ns
                        cached = cache.get(rel, {})
                        cached_same = cached.get("size") == stat.st_size and cached.get("modified_ns") == stat.st_mtime_ns
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
                        item = dict(match) if match else {"id": f"{next_id:06d}", "title": "", "genres": [], "channels": [], "tags": [], "enabled": True,
                            "type": "advert" if rel.startswith("Adverts/") else "programme", "added_at": datetime.now(timezone.utc).isoformat(),
                            "break_points": [], "suggested_break_points": [], "breaks_approved": False, "description": ""}
                        # Different OS timestamp precision can cause a rehash, but identical
                        # content keeps its previously collected metadata and user labels.
                        metadata = None
                        if new or item.get("fingerprint") != fingerprint:
                            metadata = cached.get("metadata") if cached_same and cached.get("fingerprint") == fingerprint else None
                            if not isinstance(metadata, dict):
                                metadata = inspect_media(path, self.root)
                            item["duration"] = metadata.get("duration", 0)
                            item["technical"] = metadata.get("technical", {})
                            if not item.get("title") and metadata.get("title"):
                                item["title"] = metadata["title"][:300]
                            if not item.get("genres") and metadata.get("genre"):
                                item["genres"] = [metadata["genre"][:100]]
                            item["suggested_break_points"], item["break_suggestion_source"] = suggest_breaks(item["duration"], metadata.get("chapters", []))
                            if not new and item.get("fingerprint") != fingerprint:
                                item["break_points"], item["breaks_approved"] = [], False
                            item["probe_status"] = "ready" if item["duration"] > 0 else "needs_browser"
                        after = path.stat()
                        if (after.st_size, after.st_mtime_ns) != (stat.st_size,stat.st_mtime_ns):
                            raise ValueError("File is still changing/copying; it will be retried on the next scan")
                        if new:
                            next_id += 1
                        used.add(item["id"])
                        item.update(file=rel, size=stat.st_size, modified_ns=stat.st_mtime_ns, fingerprint=fingerprint, missing=False)
                        updated.append(item)
                        if new:
                            baseline["videos"].append(json.loads(json.dumps(item)))
                        if not same and not cached_same:
                            entry = {"file": rel, "size": stat.st_size, "modified_ns": stat.st_mtime_ns, "fingerprint": fingerprint, "metadata": metadata}
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

    def save_edits(self, incoming):
        with self.lock:
            data = self.read()
            existing = {item["id"]: item for item in data["videos"]}
            if not isinstance(incoming.get("videos"), list):
                raise ValueError("Expected a videos list")
            for edit in incoming["videos"]:
                if not isinstance(edit, dict) or edit.get("id") not in existing:
                    raise ValueError("Unknown video ID. Rescan the library first.")
                item = existing[edit["id"]]
                for key, limit in (("title", 300), ("description", 1000), ("tagline", 300), ("tagline_goblin", 300)):
                    item[key] = str(edit.get(key, item.get(key, ""))).strip()[:limit]
                for key in ("genres", "channels", "tags"):
                    item[key] = strings(edit.get(key, item.get(key, [])))
                item["channels"] = [name for name in item["channels"] if name != CUSTOMS_CHANNEL]
                item["genre"] = ", ".join(item["genres"])
                item["type"] = "advert" if edit.get("type", item.get("type")) == "advert" else "programme"
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
