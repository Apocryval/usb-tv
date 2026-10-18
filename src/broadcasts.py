"""Persistent broadcast snapshots, stored separately from editable video labels."""
from library_paths import library_file
import json
import math
from catalogue import normalise_episodes
from pathlib import Path


def read(root):
    path = library_file(root, "broadcasts.json")
    if not path.exists():
        return {"revision": 0, "channels": {}}
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("Invalid broadcast state")
    validate(value.get("channels"))
    if not isinstance(value.get("revision"), int):
        raise ValueError("Invalid broadcast revision")
    return value


def validate(channels):
    if not isinstance(channels, dict) or len(channels) > 100:
        raise ValueError("Invalid broadcast channel list")
    def finite(value, minimum=0):
        return isinstance(value, (int, float)) and math.isfinite(value) and value >= minimum
    for name, plan in channels.items():
        if not isinstance(name, str) or len(name) > 100 or not isinstance(plan, dict):
            raise ValueError("Invalid broadcast channel")
        for version in (plan.get("active"), plan.get("pending")):
            if version is None:
                if plan.get("active") is None:
                    raise ValueError("Missing active broadcast")
                continue
            if not isinstance(version, dict) or not finite(version.get("anchor")) or not isinstance(version.get("seed"), str) or len(version["seed"]) > 250:
                raise ValueError("Invalid broadcast version")
            snapshot = version.get("snapshot")
            if not isinstance(snapshot, dict) or not isinstance(snapshot.get("channel"), dict) or snapshot["channel"].get("name") != name:
                raise ValueError("Invalid broadcast snapshot")
            channel = snapshot["channel"]
            if not finite(channel.get("ad_interval"), 60) or not finite(channel.get("ad_length")):
                raise ValueError("Invalid broadcast break settings")
            videos = snapshot.get("videos")
            if not isinstance(videos, list) or len(videos) > 20000:
                raise ValueError("Invalid broadcast media list")
            for video in videos:
                if not isinstance(video, dict) or not isinstance(video.get("id"), str) or not finite(video.get("duration"), .001) or video.get("channels") != [name] or video.get("type") not in ("programme", "advert"):
                    raise ValueError("Invalid broadcast media")
                if not isinstance(video.get("break_points"), list) or not all(finite(point) for point in video["break_points"]):
                    raise ValueError("Invalid broadcast break points")
                normalise_episodes(video.get("episodes", []), video["duration"])


def save(root, incoming):
    current = read(root)
    if incoming.get("revision") != current["revision"]:
        return None
    channels = incoming.get("channels")
    validate(channels)
    updated = {"revision": current["revision"] + 1, "channels": channels}
    path = library_file(root, "broadcasts.json")
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(updated, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")
    temporary.replace(path)
    return updated
