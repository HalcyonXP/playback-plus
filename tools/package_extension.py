from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo
import json

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
EXTENSION_ENTRIES = (
    "manifest.json",
    "background",
    "content",
    "icons",
    "popup",
    "shared",
)

manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
version = manifest["version"]
output = DIST / f"playback-plus-{version}.xpi"

DIST.mkdir(parents=True, exist_ok=True)

files = []
for entry_name in EXTENSION_ENTRIES:
    entry = ROOT / entry_name
    if entry.is_file():
        files.append(entry)
    elif entry.is_dir():
        files.extend(path for path in entry.rglob("*") if path.is_file())
    else:
        raise FileNotFoundError(f"Missing extension entry: {entry}")

with ZipFile(output, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
    for path in sorted(files):
        relative = path.relative_to(ROOT).as_posix()
        info = ZipInfo(relative, date_time=(2024, 1, 1, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, path.read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=9)

print(f"Packaged {len(files)} files: {output}")
