"""Offline media inspection. MP4/MOV work without optional external tools."""
from pathlib import Path
import json
import math
import os
import platform
import re
import shutil
import struct
import subprocess
import tempfile


def tool_path(name, root):
    system = platform.system().lower()
    arch = "arm64" if platform.machine().lower() in ("arm64", "aarch64") else "x64"
    filename = name + (".exe" if system == "windows" else "")
    bundled = Path(root) / "Tools" / f"{system}-{arch}" / filename
    if bundled.is_file():
        if system == "linux":
            # exFAT mounts can be noexec; mirror optional tools to the local executable cache.
            cache = Path(os.environ.get("XDG_CACHE_HOME", str(Path.home() / ".cache"))) / "USB.tv" / "tools"
            cache.mkdir(parents=True, exist_ok=True)
            target = cache / filename
            if not target.exists() or target.stat().st_size != bundled.stat().st_size or target.stat().st_mtime_ns != bundled.stat().st_mtime_ns:
                with tempfile.NamedTemporaryFile(dir=cache, delete=False) as handle:
                    temporary = Path(handle.name)
                shutil.copy2(bundled, temporary)
                temporary.chmod(0o700)
                temporary.replace(target)
            return str(target)
        return str(bundled)
    return shutil.which(name)


def number(value, default=0):
    try:
        result = float(value)
        return result if math.isfinite(result) else default
    except (ValueError, TypeError):
        return default


def boxes(handle, start, end):
    """Iterate bounded ISO BMFF boxes without reading video payloads."""
    position = start
    while position + 8 <= end:
        handle.seek(position)
        header = handle.read(8)
        if len(header) != 8:
            break
        size, kind = struct.unpack(">I4s", header)
        header_size = 8
        if size == 1:
            extended = handle.read(8)
            if len(extended) != 8:
                break
            size = struct.unpack(">Q", extended)[0]
            header_size = 16
        elif size == 0:
            size = end - position
        if size < header_size or position + size > end:
            break
        yield kind, position + header_size, position + size
        position += size


def inspect_mp4(path):
    result = {"duration": 0, "technical": {"container": path.suffix.lstrip(".")}}
    with path.open("rb") as handle:
        def walk(start, end, depth=0):
            if depth > 12:
                return
            for kind, content, stop in boxes(handle, start, end):
                handle.seek(content)
                if kind == b"mvhd":
                    payload = handle.read(min(40, stop - content))
                    if len(payload) >= 20:
                        version = payload[0]
                        offset = 20 if version == 1 else 12
                        if len(payload) >= offset + (12 if version == 1 else 8):
                            scale = struct.unpack_from(">I", payload, offset)[0]
                            ticks = struct.unpack_from(">Q" if version == 1 else ">I", payload, offset + 4)[0]
                            if scale:
                                result["duration"] = ticks / scale
                elif kind == b"tkhd" and stop - content >= 84:
                    handle.seek(stop - 8)
                    width, height = struct.unpack(">II", handle.read(8))
                    if width and height:
                        result["technical"].update(width=width >> 16, height=height >> 16)
                elif kind == b"stsd" and stop - content >= 16:
                    handle.seek(content + 8)
                    entry = handle.read(8)
                    codec = entry[4:].decode("ascii", errors="replace")
                    key = "audio_codec" if codec in ("mp4a", "ac-3", "ec-3", "Opus", "alac") else "video_codec"
                    result["technical"][key] = codec
                elif kind in (b"\xa9nam", b"\xa9gen", b"desc"):
                    for child, data_start, data_end in boxes(handle, content, stop):
                        if child == b"data" and data_end - data_start >= 8:
                            handle.seek(data_start + 8)
                            value = handle.read(min(data_end - data_start - 8, 4096)).decode("utf-8", errors="replace").strip("\x00 ")
                            result[{b"\xa9nam": "title", b"\xa9gen": "genre", b"desc": "description"}[kind]] = value
                elif kind in (b"moov", b"trak", b"mdia", b"minf", b"stbl", b"udta", b"ilst"):
                    walk(content, stop, depth + 1)
                elif kind == b"meta":
                    walk(content + 4, stop, depth + 1)
        walk(0, path.stat().st_size)
    return result


def inspect_media(path, root):
    result = {"duration": 0, "technical": {"container": path.suffix.lstrip(".")}, "chapters": []}
    probe = tool_path("ffprobe", root)
    if probe:
        try:
            completed = subprocess.run([probe, "-v", "error", "-show_format", "-show_streams", "-show_chapters", "-of", "json", str(path)], capture_output=True, timeout=30, check=True)
            data = json.loads(completed.stdout)
            fmt = data.get("format", {})
            tags = {k.lower(): v for k, v in fmt.get("tags", {}).items()}
            result.update(duration=number(fmt.get("duration")), title=str(tags.get("title", "")), genre=str(tags.get("genre", "")), description=str(tags.get("description", "")))
            result["technical"]["container"] = fmt.get("format_name", result["technical"]["container"])
            for stream in data.get("streams", []):
                kind = stream.get("codec_type")
                if kind in ("video", "audio"):
                    result["technical"][kind + "_codec"] = stream.get("codec_name", "")
                if kind == "video":
                    result["technical"].update(width=stream.get("width", 0), height=stream.get("height", 0))
            result["chapters"] = [number(chapter.get("start_time")) for chapter in data.get("chapters", [])]
            return result
        except (OSError, subprocess.SubprocessError, ValueError):
            pass
    if path.suffix.lower() in (".mp4", ".m4v", ".mov"):
        try:
            result.update(inspect_mp4(path))
        except (OSError, ValueError, struct.error):
            pass
    return result


def suggest_breaks(duration, chapters=(), candidates=None, interval=900):
    """Suggestions are never approved automatically; leave the opening/ending intact."""
    duration = number(duration)
    points = []
    targets = range(interval, int(duration - 120), interval)
    source = "chapters" if chapters else "silence/black frames" if candidates is not None else "interval"
    usable = [number(point) for point in (chapters or candidates or []) if 120 < number(point) < duration - 120]
    for target in targets:
        nearby = [point for point in usable if abs(point - target) <= 180]
        if nearby:
            point = min(nearby, key=lambda value: abs(value - target))
        elif source == "interval":
            point = target
        else:
            continue
        if not points or point - points[-1] >= 300:
            points.append(round(point, 3))
    return points, source


def analyse_breaks(path, root, duration):
    ffmpeg = tool_path("ffmpeg", root)
    if not ffmpeg:
        raise RuntimeError("Scene analysis needs optional FFmpeg in Tools/<platform>/ or on this computer. Editable interval suggestions are already available.")
    try:
        completed = subprocess.run([ffmpeg, "-hide_banner", "-nostats", "-i", str(path), "-vf", "scale=160:-2,blackdetect=d=0.3:pix_th=0.10", "-af", "silencedetect=n=-35dB:d=0.6", "-f", "null", "-"], capture_output=True, timeout=600)
    except (OSError, subprocess.SubprocessError) as error:
        raise RuntimeError("Scene analysis could not finish. You can still edit break points manually.") from error
    if completed.returncode:
        raise RuntimeError("FFmpeg could not analyse this file. You can still edit break points manually.")
    log = completed.stderr.decode("utf-8", errors="replace")
    candidates = [number(match) for match in re.findall(r"(?:silence_end:|black_end:)\s*([\d.]+)", log)]
    return suggest_breaks(duration, candidates=candidates)
