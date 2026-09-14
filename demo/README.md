# Public design demo

Live gallery: https://halcyonxp.github.io/playback-plus/demo/

This is a **fictional UI demonstration**, not an installable add-on. It previews the released GB1 — Charcoal / Ice blue theme alongside eight experimental palettes, all with 8 px rounded outer frames. No real media or audio is processed. Settings and shortcut assignments are memory-only and reset on reload. Theme links use `?theme=n1` through the IDs in `palettes.json`.

## Source and build

- `index.html`, `gallery.css`, `gallery.js`: public gallery and acknowledgement-driven theme switching.
- `theme.js`, `themes.css`, `palettes.json`: reviewed colour-study assets. The stylesheet is a deliberate design proposal layer, not a production popup import.
- `../tools/build_demo.py`: explicit static export. Generates the preview from the runtime popup markup and copies only its two stylesheets, six UI/shared scripts and `tests/browser-init.js` as a fictional browser API. No audio engines, RNNoise, icons, packages or private files are deployed.

```sh
python tools/build_demo.py
python -m http.server 8000 --directory .pi/pages-site
```

Open `http://localhost:8000/demo/`. The server is for development only; GitHub Pages serves the published copy. Do not serve the repository root to share private working files. The builder rejects unexpected files in an existing output directory rather than deleting or uploading them.

`npm run check` includes the static demo export tests. Test all nine palette buttons, Configuration navigation, Save/re-save, On/Off, hover/focus/pinned info and keyboard help scrolling, shortcut capture, keyboard activation and narrow-screen scrolling in actual browsers before changing the preview. Display fonts and native form controls can vary by OS/browser; a web demo does not validate native Firefox popup sizing or real audio behavior.

## Publication

`.github/workflows/pages.yml` builds on relevant pushes to `main` or manual dispatch, uploads only `_site`, and deploys through the `github-pages` environment. The official Actions are pinned to reviewed commit hashes. Standard public-repository runners are used; no paid runner, custom domain, external CDN, analytics service or billing change is required. Deployment artifacts have one-day retention.

The generated site contains a root redirect, `/demo/`, `.nojekyll` and a `build-info.json` file recording the deployed file sizes/hashes. Development notes, this README, tests and build tools are not part of the site artifact (the one intentionally selected fictional-API script is renamed to `demo/assets/fixture.js`). Updating the site must not replace extension release tags or XPI assets.

The gallery adds no analytics, cookies, forms or database. GitHub Pages itself logs visitors' IP addresses for security, as disclosed in the gallery footer. Viewing needs no GitHub account; sending feedback through GitHub Issues does.

Official hosting references:
- [Pages availability and data collection](https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages)
- [Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
