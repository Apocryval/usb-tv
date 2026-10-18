"""Number new imports and publish verified MP4s without replacing existing files."""
from library_paths import library_file
from pathlib import Path
import errno
import hashlib
import json
import os
import re
import time
import uuid

from media import convert_mp4

RESERVED_FOLDERS = {".usbtv-originals", ".usbtv-imports"}
REFERENCE = re.compile(r"^(\d{4,}) - (.+)$")


def fingerprint(path, cancelled=lambda: False):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            if cancelled():
                raise InterruptedError("Import paused; the original file is retained.")
            digest.update(chunk)
    return digest.hexdigest()


def reference(path):
    match = REFERENCE.match(Path(path).stem)
    return int(match[1]) if match else None


def formatted_name(path, number):
    stem = Path(path).stem
    match = REFERENCE.match(stem)
    if match:
        stem = match[2]
    stem = re.sub(r"[^\w.\-\s]", "", stem, flags=re.UNICODE)
    stem = re.sub(r"[\s_]+", "_", stem).strip("._-")[:140].rstrip("._-") or "Untitled"
    return f"{number:04d} - {stem}.mp4"


class ImportManager:
    def __init__(self, root, folders, known, files):
        self.root = Path(root)
        self.folders = {name: Path(path).resolve() for name, path in folders.items()}
        self.path = library_file(self.root, "imports.json")
        self.data = json.loads(self.path.read_text(encoding="utf-8")) if self.path.exists() else {"version": 1, "next_reference": 1, "jobs": {}}
        if self.data.get("version") != 1 or not isinstance(self.data.get("jobs"), dict):
            raise ValueError("imports.json is invalid; restore its backup before importing new files.")
        self.owners = {}
        self.known_references = {reference(item.get("file", "")) for item in known}
        for relative in [item.get("file", "") for item in known] + [self.name(path) for path in files]:
            number = reference(relative)
            if number is not None:
                self.owners.setdefault(number, set()).add(relative)
        maximum = max(self.owners, default=0)
        maximum = max(maximum, max((job.get("reference", 0) for job in self.data["jobs"].values()), default=0))
        self.data["next_reference"] = max(int(self.data.get("next_reference", 1)), maximum + 1)

    def name(self, path):
        path = Path(path)
        for name, base in self.folders.items():
            if path.is_relative_to(base):
                return name + "/" + path.relative_to(base).as_posix()
        raise ValueError("Import is outside the selected media folders.")

    def resolve(self, name):
        parts = Path(name).parts
        if not parts or parts[0] not in self.folders:
            raise ValueError("Invalid import journal path.")
        base = self.folders[parts[0]]
        path = base.joinpath(*parts[1:]).resolve()
        if not path.is_relative_to(base):
            raise ValueError("Import journal path is outside its media folder.")
        return path

    def save(self):
        temporary = self.path.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(self.data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(self.path)

    def allocate(self):
        number = self.data["next_reference"]
        self.data["next_reference"] += 1
        return number

    def pending_destination(self, name):
        return any(job["destination"] == name and job["state"] != "complete" for job in self.data["jobs"].values())

    def move(self, source, target, cancelled, claimed=None):
        """No-overwrite move. exFAT POSIX fallback copies exclusively and verifies."""
        if cancelled():
            raise InterruptedError("Import paused; the original file is retained.")
        target.parent.mkdir(parents=True, exist_ok=True)
        if os.name == "nt":
            source.rename(target)  # Windows rename fails rather than replacing an existing file.
            return
        try:
            os.link(source, target)
        except OSError as error:
            if error.errno not in {errno.EXDEV, errno.EPERM, errno.EOPNOTSUPP, errno.ENOSYS}:
                raise
        else:
            source.unlink()
            return
        with target.open("xb") as output:
            if claimed:
                claimed()
            with source.open("rb") as original:
                while chunk := original.read(1024 * 1024):
                    if cancelled():
                        raise InterruptedError("Import paused; the original file is retained.")
                    output.write(chunk)
            output.flush(); os.fsync(output.fileno())
        if fingerprint(source, cancelled) != fingerprint(target, cancelled):
            raise ValueError("Import copy could not be verified; original retained.")
        source.unlink()

    def finish(self, job, cancelled):
        target = self.resolve(job["destination"])
        if fingerprint(target, cancelled) != job["output_fingerprint"]:
            raise ValueError("Prepared MP4 failed verification; original retained.")
        source = self.resolve(job["source"])
        if source.exists():
            if fingerprint(source, cancelled) != job["source_fingerprint"]:
                job["state"] = "superseded"; self.save()
                quarantine = self.resolve(job["stage"] + ".superseded-" + uuid.uuid4().hex)
                self.move(target, quarantine, cancelled)
                raise ValueError("Original changed during import; both files have been retained.")
            if job["converted"]:
                backup = self.resolve(job["backup"])
                if backup.exists():
                    if fingerprint(backup, cancelled) != job["source_fingerprint"]:
                        if job["state"] != "archiving":
                            raise FileExistsError("Original backup already exists with different contents.")
                        quarantine = self.resolve(job["stage"] + ".interrupted-backup-" + uuid.uuid4().hex)
                        self.move(backup, quarantine, cancelled)
                    else:
                        source.unlink()  # Verified identical original is already in the backup folder.
                if source.exists():
                    def archiving():
                        job["state"] = "archiving"; self.save()
                    self.move(source, backup, cancelled, archiving)
            else:
                # A verified exclusive-copy rename may have stopped before its final unlink.
                source.unlink()
        job["state"] = "complete"
        self.save()

    def recover(self, cancelled, permitted=lambda name: True):
        errors = []
        for job in self.data["jobs"].values():
            if not permitted(job["source"]):
                continue
            if job["state"] in {"complete", "superseded"}:
                continue
            target = self.resolve(job["destination"])
            if not target.is_file() or not job.get("output_fingerprint"):
                continue
            try:
                if fingerprint(target, cancelled) == job["output_fingerprint"]:
                    self.finish(job, cancelled)
                elif job["state"] == "copying":
                    # Preserve interrupted output outside the scan before trying again.
                    quarantine = self.resolve(job["stage"] + ".interrupted-" + uuid.uuid4().hex)
                    self.move(target, quarantine, cancelled)
                    job["state"] = "prepared"; self.save()
            except InterruptedError:
                raise
            except (OSError, ValueError) as error:
                errors.append({"file": job["source"], "error": str(error)})
        return errors

    def prepare(self, path, source_fingerprint, cancelled=lambda: False):
        path = Path(path)
        source_name = self.name(path)
        for job in self.data["jobs"].values():
            if job["destination"] == source_name and job["state"] == "complete" and job["output_fingerprint"] == source_fingerprint:
                return path, source_fingerprint, self.info(job)
        # Recently modified files may still be copying. Retry during the next scan.
        age = time.time() - path.stat().st_mtime
        if age < 10:
            raise ValueError("New file may still be copying. Wait ten seconds and rescan; it has not been changed.")
        key = hashlib.sha256((source_name + "\0" + source_fingerprint).encode()).hexdigest()
        job = self.data["jobs"].get(key)
        if not job:
            supplied = reference(path)
            owners = self.owners.get(supplied, set())
            reserved = {entry["reference"] for entry in self.data["jobs"].values()}
            unique = supplied and supplied not in reserved and (owners == {source_name}
                or supplied not in self.known_references and owners and source_name == min(owners))
            number = supplied if unique else self.allocate()
            target = path.with_name(formatted_name(path, number))
            if target == path:
                return path, source_fingerprint, {"reference_number": number}
            token = uuid.uuid4().hex
            base = self.folders[Path(source_name).parts[0]]
            job = {"source": source_name, "source_fingerprint": source_fingerprint,
                   "destination": self.name(target), "reference": number, "converted": path.suffix.lower() != ".mp4",
                   "stage": self.name(base / ".usbtv-imports" / (token + ".mp4")),
                   "backup": self.name(base / ".usbtv-originals" / token / path.name), "state": "planned"}
            self.data["jobs"][key] = job
            self.save()  # Reserve the reference before any file operation.
        target = self.resolve(job["destination"])
        if target.exists() and job.get("output_fingerprint") and fingerprint(target, cancelled) == job["output_fingerprint"]:
            self.finish(job, cancelled)
            return target, job["output_fingerprint"], self.info(job)
        before = path.stat()
        output = path
        if job["converted"]:
            output = self.resolve(job["stage"])
            if not output.exists() or not job.get("output_fingerprint") or fingerprint(output, cancelled) != job["output_fingerprint"]:
                output.parent.mkdir(parents=True, exist_ok=True)
                convert_mp4(path, output, self.root, cancelled)
            after = path.stat()
            if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                raise ValueError("File changed during conversion; original retained. Rescan when copying finishes.")
            job["output_fingerprint"] = fingerprint(output, cancelled)
        else:
            job["output_fingerprint"] = source_fingerprint
        job["state"] = "prepared"; self.save()
        def claimed():
            job["state"] = "copying"; self.save()
        try:
            self.move(output, target, cancelled, claimed)
        except FileExistsError:
            # A file dropped concurrently must never be overwritten.
            job["reference"] = self.allocate()
            job["destination"] = self.name(path.with_name(formatted_name(path, job["reference"])))
            job["state"] = "prepared"; self.save()
            raise ValueError("Another file occupies the import filename. A new reference was reserved; rescan to continue.")
        job["state"] = "published"; self.save()
        self.finish(job, cancelled)
        return target, job["output_fingerprint"], self.info(job)

    @staticmethod
    def info(job):
        return {"reference_number": job["reference"], "original_name": Path(job["source"]).name,
                "original_fingerprint": job["source_fingerprint"],
                **({"original_backup": job["backup"]} if job["converted"] else {})}
