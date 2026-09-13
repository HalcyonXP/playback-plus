# Bundled RNNoise

`rnnoise-sync.js` is the **unmodified** Jitsi rnnoise-wasm synchronous ES module,
including its embedded WebAssembly and default RNNoise model. It is loaded locally
only when Voice Clarity is enabled; no model/audio download or upload occurs at runtime.

- Repository: https://github.com/jitsi/rnnoise-wasm
- Pinned commit: `cb529a59a8478fe604e57986fc96afdaecfa6fb7`
- Artifact: `dist/rnnoise-sync.js` (1,933,102 bytes)
- SHA-256: `05a553f523d59502d133a6d05dbf1878137c9e7bcff06edf5561f7001b62f95f`
- Retrieved via HTTPS on 2026-09-10. Upstream describes this synchronous build as
  RNNoise 0.2 (its separate asynchronous artifact is older; do not substitute it).
- The pinned repository's RNNoise submodule is
  https://github.com/xiph/rnnoise/tree/372f7b4b76cde4ca1ec4605353dd17898a99de38
- Upstream build recipe: `build.sh` and `Dockerfile` at the Jitsi commit above.
  We use the published artifact, not a locally reproduced Emscripten build.
- Redistribution notices are retained in `LICENSE` (Jitsi Apache-2.0 and original
  MIT notice) and `RNNOISE-COPYING` (RNNoise BSD-3-Clause).
- `python -X utf8 tools/vendor_rnnoise.py` re-fetches these three pinned files and
  verifies all hashes before replacing them. Normal testing/packaging needs no network.

Integration: `content/dialogue-core.js` adapts 128-sample render blocks to RNNoise's
480-sample, 48 kHz, float PCM frames scaled by 32768. Two independent channel states
share the module heap. No additional speech gate or output boost is applied. The
pinned algorithm's 960-sample delay plus 480-sample framing gives 1440 samples / 30 ms;
the dry mix uses the same delay. Node tests execute the bundled WASM and verify
impulse-peak alignment, channel isolation, blending, reset and disposal. Generated
signal tests do not establish dialogue intelligibility or live-site compatibility.
