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
import time

LOUDNESS_VERSION = 1


def loudness_result(measurement):
    """Choose constant gain towards -18 LUFS, capped at +12 dB and -1.5 dBTP."""
    integrated = float(measurement["input_i"])
    peak = float(measurement["input_tp"])
    if not math.isfinite(integrated) or not math.isfinite(peak):
        return {"status": "silent", "gain_db": 0}
    gain = min(-18 - integrated, 12, -1.5 - peak)
    return {"status": "ready", "integrated_lufs": integrated, "true_peak_db": peak,
            "gain_db": round(max(-60, gain), 3)}


def measure_loudness(path, ffmpeg, cancelled=lambda: False, timeout=3600):
    command = [ffmpeg, "-nostdin", "-hide_banner", "-nostats", "-threads", "1", "-i", str(path),
               "-map", "0:a:0", "-vn", "-sn", "-dn", "-af",
               "loudnorm=I=-18:TP=-1.5:LRA=50:print_format=json", "-f", "null", "-"]
    options = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}
    process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, **options)
    deadline = time.monotonic() + timeout
    try:
        while True:
            if cancelled():
                raise InterruptedError("Audio analysis paused; completed measurements are saved.")
            if time.monotonic() >= deadline:
                raise RuntimeError("Audio analysis timed out.")
            try:
                _, stderr = process.communicate(timeout=.25)
                break
            except subprocess.TimeoutExpired:
                continue
        log = stderr.decode("utf-8", errors="replace")
        if process.returncode:
            if "matches no streams" in log or "does not contain any stream" in log:
                return {"status": "no_audio", "gain_db": 0}
            raise RuntimeError("FFmpeg could not read this file's audio.")
        for match in reversed(re.findall(r'\{[^{}]*"input_i"[^{}]*\}', log)):
            return loudness_result(json.loads(match))
        raise RuntimeError("FFmpeg did not return a loudness measurement.")
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.communicate(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill(); process.communicate()


def convert_mp4(source, destination, root, cancelled=lambda: False):
    ffmpeg = tool_path("ffmpeg", root)
    if not ffmpeg:
        raise ValueError("New video conversion needs FFmpeg. The original file has been retained.")
    original = inspect_media(source, root)
    technical = original.get("technical", {})
    copy_video = technical.get("video_codec") == "h264" and technical.get("pixel_format") == "yuv420p"
    command = [ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-xerror", "-y", "-i", str(source),
               "-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "0", "-map_chapters", "0"]
    if copy_video:
        command += ["-c:v", "copy"]
    else:
        command += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
                    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2"]
    command += ["-c:a", "copy"] if technical.get("audio_codec") == "aac" else ["-c:a", "aac", "-b:a", "192k"]
    command += ["-movflags", "+faststart", "-f", "mp4", str(destination)]
    options = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}
    process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, **options)
    deadline = time.monotonic() + min(86400, max(3600, number(original.get("duration")) * 4))
    try:
        while True:
            if cancelled():
                raise InterruptedError("Conversion paused; the original file is retained.")
            if time.monotonic() >= deadline:
                raise ValueError("MP4 conversion timed out; the original file is retained.")
            try:
                _, stderr = process.communicate(timeout=.25)
                break
            except subprocess.TimeoutExpired:
                continue
        if process.returncode:
            raise ValueError("FFmpeg could not convert this video; the original file is retained.")
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.communicate(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill(); process.communicate()
    converted = inspect_media(destination, root)
    duration = number(converted.get("duration"))
    if duration <= 0 or Path(destination).stat().st_size == 0:
        raise ValueError("Converted MP4 failed its duration check; original retained.")
    expected = number(original.get("duration"))
    if expected > 0 and abs(duration - expected) > max(2, expected * .01):
        raise ValueError("Converted MP4 has an unexpected duration; original retained.")
    with Path(destination).open("rb") as handle:
        header = handle.read(12)
    if header[4:8] != b"ftyp":
        raise ValueError("Converted file is not an MP4; original retained.")
    return converted


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
            inspected = set()
            for stream in data.get("streams", []):
                kind = stream.get("codec_type")
                if kind not in ("video", "audio") or kind in inspected:
                    continue
                inspected.add(kind)
                if kind in ("video", "audio"):
                    result["technical"][kind + "_codec"] = stream.get("codec_name", "")
                if kind == "video":
                    result["technical"].update(width=stream.get("width", 0), height=stream.get("height", 0), pixel_format=stream.get("pix_fmt", ""))
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
