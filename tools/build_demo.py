"""Build a small, explicit GitHub Pages export; never publish the working tree.

Usage: python tools/build_demo.py [--output .pi/pages-site]
Python standard library only. No network, dependencies, media engines or XPI files.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
DEMO_FILES = ("index.html", "gallery.css", "gallery.js", "theme.js", "themes.css", "palettes.json")
ASSETS = {
    "popup.css": "popup/popup.css",
    "tactile.css": "popup/tactile.css",
    "popup.js": "popup/popup.js",
    "audio.js": "popup/audio.js",
    "speed.js": "shared/speed.js",
    "shortcuts.js": "shared/shortcuts.js",
    "shared-audio.js": "shared/audio.js",
    "fixture.js": "tests/browser-init.js",
}
CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; frame-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'"


def source_bytes(relative):
    source = ROOT / relative
    if any(p.is_symlink() for p in (source, *source.parents) if ROOT in p.parents) or ROOT not in source.resolve().parents:
        raise ValueError(f"Source must be a regular in-repository file: {relative}")
    return source.read_bytes()


def build(output):
    payload = {f"demo/{name}": source_bytes(f"demo/{name}") for name in DEMO_FILES}
    payload.update({f"demo/assets/{name}": source_bytes(path) for name, path in ASSETS.items()})
    html = source_bytes("popup/popup.html").decode("utf-8")
    replacements = {
        "popup.css": "assets/popup.css", "tactile.css": "assets/tactile.css",
        "popup.js": "assets/popup.js", "audio.js": "assets/audio.js",
        "../shared/speed.js": "assets/speed.js", "../shared/shortcuts.js": "assets/shortcuts.js",
        "../shared/audio.js": "assets/shared-audio.js",
    }
    def replace_url(match):
        path = match[2]
        if path not in replacements:
            raise ValueError(f"Unreviewed popup dependency: {path}")
        return f'{match[1]}="{replacements[path]}"'
    dependencies = re.findall(r'(?:href|src)="([^"]+)"', html)
    if sorted(dependencies) != sorted(replacements):
        raise ValueError("Popup dependencies changed; review the demo export mapping")
    html = re.sub(r'(href|src)="([^"]+)"', replace_url, html)
    html = html.replace('<title>Playback Plus</title>', '<title>Playback Plus — fictional design preview</title>')
    html = html.replace('</head>', f'<meta http-equiv="Content-Security-Policy" content="{CSP}">\n'
                        '<link rel="stylesheet" href="themes.css">\n<script src="theme.js"></script>\n</head>')
    # The fake browser API must be present before the real UI controllers run.
    html = html.replace('<script src="assets/speed.js">', '<script src="assets/fixture.js"></script>\n<script src="assets/speed.js">')
    payload["demo/preview.html"] = html.encode("utf-8")
    payload["index.html"] = b'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=demo/"><title>Playback Plus design demo</title><p><a href="demo/">Open the Playback Plus design demo</a></p></html>\n'
    payload[".nojekyll"] = b""
    info = {
        "kind": "Fictional design demo, not an installable extension",
        "base_extension_version": json.loads(source_bytes("manifest.json"))["version"],
        "files": {name: {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()} for name, data in sorted(payload.items())},
    }
    payload["build-info.json"] = (json.dumps(info, indent=2) + "\n").encode("utf-8")
    if output.is_symlink() or output.resolve() == ROOT:
        raise ValueError("Output must be a separate, regular directory")
    output = output.resolve()
    if output.exists():
        existing = {p.relative_to(output).as_posix() for p in output.rglob('*') if p.is_file()}
        if existing - payload.keys() or any(p.is_symlink() for p in output.rglob('*')):
            raise ValueError("Output contains unreviewed files or symlinks; choose a clean directory")
    for name, data in payload.items():
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    print(json.dumps({"files": len(payload), "bytes": sum(map(len, payload.values())), "output": str(output)}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / '.pi/pages-site')
    build(parser.parse_args().output)
