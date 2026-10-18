"""Shared lists for the server, native builders and portable update packages."""
ASSETS = {"index.html", "style.css", "effects.css", "themes.css", "library.css",
          "intro.css", "intro.js", "crt.js", "audio.js", "app.js", "schedule.js", "schedule-plans.js", "suggestions.js", "favicon.ico"}
TARGET_APPS = {
    "darwin-arm64": "Apps/darwin-arm64/USBtv",
    "linux-x64": "Apps/linux-x64/USBtv",
    "windows-x64": "Apps/windows-x64/USBtv.exe",
}
SOURCE_FILES = ASSETS | {
    "server.py", "catalogue.py", "media.py", "imports.py", "broadcasts.py", "session.py", "distribution.py", "updater.py",
    "build.py", "package_update.py", "requirements-build.txt", "README.md",
    "BUILD-AND-UPDATE.md", "start-usbtv.sh", "start-usbtv.command", "Start USB.tv.bat",
    "update-usbtv.sh", "update-usbtv.command", "Update USB.tv.bat",
}
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
