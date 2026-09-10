"""Explicit, optional refresh of pinned RNNoise vendor files; not a build dependency."""
from hashlib import sha256
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
JITSI = "https://raw.githubusercontent.com/jitsi/rnnoise-wasm/cb529a59a8478fe604e57986fc96afdaecfa6fb7/"
RNNOISE = "https://raw.githubusercontent.com/xiph/rnnoise/372f7b4b76cde4ca1ec4605353dd17898a99de38/"
FILES = [
    ("rnnoise-sync.js", JITSI + "dist/rnnoise-sync.js", "05a553f523d59502d133a6d05dbf1878137c9e7bcff06edf5561f7001b62f95f"),
    ("LICENSE", JITSI + "LICENSE", "4646d0ab74a05730f8b3b12b6376ddccb7f0905ee5b69265b3d873b97ace3e94"),
    ("RNNOISE-COPYING", RNNOISE + "COPYING", "45d37ca1cdb278c088e1aa85e0e65ca3a534ed86a28dcc96ca16810248a61d35"),
]


def main():
    verified = []
    for name, url, expected in FILES:
        with urlopen(url, timeout=45) as response:
            data = response.read()
        actual = sha256(data).hexdigest()
        if actual != expected:
            raise ValueError(f"Hash mismatch for {name}: {actual}; no files replaced")
        verified.append((name, data))
    destination = ROOT / "content/vendor/rnnoise"
    destination.mkdir(parents=True, exist_ok=True)
    for name, data in verified:
        (destination / name).write_bytes(data)
        print(f"Verified {name}: {len(data)} bytes")


if __name__ == "__main__":
    main()
