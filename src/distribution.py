"""Shared lists for the server, native builders and portable update packages."""
ASSETS = {"index.html", "style.css", "effects.css", "themes.css", "library.css",
          "goblin-cabinet.png",
          "goblin-stone-shelf.png",
          "goblin-station-logo.png", "goblin-tonight-banner.png", "goblin-guide-tablet.png", "goblin-library-ledger.png",
          "goblin-cabinet-tv.png", "goblin-document.png", "goblin-scroll-1.png", "goblin-scroll-2.png", "goblin-scroll-3.png", "caveat.ttf", "caveat-license.txt",
          "intro.css", "intro.js", "crt.js", "audio.js", "transitions.js", "app.js", "schedule.js", "schedule-plans.js", "suggestions.js", "favicon.ico", "goblin.css", "goblin.js", "goblin-cave.jpg", "goblin-moss.png", "goblin-plank.webp", "goblin-preview-growth.webp", "grenze-gotisch.ttf", "skranji-regular.ttf", "grenze-license.txt", "skranji-license.txt"}
TARGET_APPS = {
    "darwin-arm64": "Apps/darwin-arm64/USBtv",
    "linux-x64": "Apps/linux-x64/USBtv",
    "windows-x64": "Apps/windows-x64/USBtv.exe",
}
SOURCE_FILES = {"web/" + name for name in ASSETS} | {
    "src/" + name for name in ("server.py", "catalogue.py", "media.py", "imports.py", "broadcasts.py", "session.py", "distribution.py", "updater.py", "library_paths.py")
} | {"scripts/build.py", "scripts/package_update.py", "scripts/requirements-build.txt",
     "README.md", "docs/BUILD-AND-UPDATE.md", "docs/USER-GUIDE.md", "data/.gitkeep",
     "start-usbtv.sh", "start-usbtv.command", "Start USB.tv.bat",
     "update-usbtv.sh", "update-usbtv.command", "Update USB.tv.bat"}

UPDATE_FILES = SOURCE_FILES | set(TARGET_APPS.values()) | {
    f"Apps/{target}/source-sha256.txt" for target in TARGET_APPS
}

# Frozen file list understood by the pre-audio/CRT/import updater. Do not derive
# this from UPDATE_FILES: future additions must not change the bridge contract.
LEGACY_UPDATE_FILES = {
    "index.html", "style.css", "effects.css", "themes.css", "library.css",
    "intro.css", "intro.js", "app.js", "schedule.js", "schedule-plans.js",
    "suggestions.js", "favicon.ico", "server.py", "catalogue.py", "media.py",
    "broadcasts.py", "session.py", "distribution.py", "updater.py", "build.py",
    "package_update.py", "requirements-build.txt", "README.md", "BUILD-AND-UPDATE.md",
    "start-usbtv.sh", "start-usbtv.command", "Start USB.tv.bat",
    "update-usbtv.sh", "update-usbtv.command", "Update USB.tv.bat",
    "Apps/darwin-arm64/USBtv", "Apps/linux-x64/USBtv", "Apps/windows-x64/USBtv.exe",
    "Apps/darwin-arm64/source-sha256.txt", "Apps/linux-x64/source-sha256.txt",
    "Apps/windows-x64/source-sha256.txt",
}


def legacy_source(name):
    """Map the frozen bridge contract onto the reorganised source tree."""
    if name in ASSETS: return "web/" + name
    if name in {"build.py", "package_update.py", "requirements-build.txt"}: return "scripts/" + name
    if name == "BUILD-AND-UPDATE.md": return "docs/" + name
    if name.endswith(".py"): return "src/" + name
    return name
