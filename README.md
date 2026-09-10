# Playback Plus

Firefox extension **v1.7.0**: independent **playback speed, optional audio delay and local RNNoise dialogue enhancement per tab**, with configurable speed/delay shortcuts. Firefox **142+**; verified in Developer Edition 156.0.

**v1.7.0 — tactile Studio Deck:** the physical-control design is now applied across all four views: raised keys, recessed slider tracks, bevelled switches and visible pressed states. Compact sizing, font sizes, centred +/− marks, quiet feedback and safety warnings are retained. Default native popup heights match v1.6.2 in the tested profiles. Playback, settings, permissions and add-on identity are unchanged.

**v1.6.2 — quieter feedback:** speed and shortcut changes no longer show save-confirmation banners. The normal header is silent; unsupported pages show only “Unavailable on this page.” Audio summaries, help and failures use plain language instead of connection counts, routing details or internal error text. Genuine errors and visible recovery/sudden-loudness warnings remain. Audio shortcuts keep brief selected-value feedback because they can be used with the popup closed. No playback/settings changes.

**v1.6.1 — content-sized popups:** default views use tighter spacing and compact shortcut rows, without smaller text. The body keeps its natural height so Firefox can expand/shrink the toolbar popup as help opens/closes. Scrolling appears only when content exceeds the viewport Firefox allows (at most 600 CSS px, possibly less available space). Long errors, key-capture instructions or expanded help can still need scrolling. No playback/settings changes.

**v1.6.0 — Studio Deck:** the audio-equipment design now spans speed, Audio sync, Dialogue focus and Configuration. A continuous graphite faceplate replaces the rounded cards, with amber readouts, calibrated native faders, tactile keys, shared shortcut rows and a matching play-plus icon. The main readout uses fixed two-decimal precision (e.g. **2.00×**); speed steps and playback behavior are unchanged. The + / − marks remain geometrically centred.

Audio sync and Dialogue focus report their own status separately; ordinary Off states need no connection commentary. On/Off switches show the requested setting, not a guarantee that every player is processed. Longer explanations are under **More information**, with recovery and sudden-loudness warnings outside collapsed help. All views remain 360 px wide, with root-level keyboard-accessible vertical scrolling only for overflow. Shortcut bindings are shared across tabs; each action affects only the tab where it is used.

## Install / upgrade

This repository contains source, not prebuilt packages. Run `npm run package` from the repository root with Python installed to create `dist/playback-plus-1.7.0.xpi` locally; no dependency download is needed. Alternatively, load `manifest.json` temporarily as described below.

1. **Disable the separate Audio Sync add-on first**, if installed. Do not run both audio engines on the same player. Its settings are not imported or deleted.
2. Unsigned installation requires Developer Edition or Nightly with `xpinstall.signatures.required` set to `false` in `about:config`. Only disable signature enforcement if you understand the security implications; standard Firefox requires a signed add-on.
3. Open `about:addons` → gear menu → **Install Add-on From File…** → choose the locally built `dist/playback-plus-1.7.0.xpi`.
4. Accept the permissions and **reload existing media pages**. v1.5.0 adds no permissions over v1.4.0; it bundles RNNoise locally. Firefox minimum remains 142. (v1.4.0 introduced **webNavigation** and MAIN-world audio integration.)

**v1.5.1 renames Video Speed to Playback Plus.** Playback behavior, permissions, settings keys and the extension ID (`video-speed@local`) are unchanged; this updates the existing extension rather than installing a separate one. Existing tab speeds, alternates and custom speed keys are retained. New audio shortcuts start unassigned. The older `defaultSpeed` preference is still migrated. Neither an active browser restart nor a change to browser settings is performed by the development/package tools.

For temporary installation: `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → [`manifest.json`](manifest.json). Temporary add-ons disappear on browser exit; use a packaged installation for restart testing.

## Playback speed

- One speed for supported `<video>` and `<audio>` elements and accessible frames in each tab. Other existing tabs do not change.
- Range **0.25×–8×**, in **0.25×** steps. Use the popup slider, presets or −/+.
- Every explicit speed selection also remembers the starting speed for **new** tabs, including selecting/toggling to **1×**. Initial default: **2×**.
- Each tab keeps its own last non-1× **alternate**. Quick toggle switches between it and 1×.
- Reload and navigation retain tab speed and alternate. Firefox tab-session values can restore them when Firefox restores a tab/session; a genuinely new tab uses the remembered default. Private tabs do not survive Firefox exit.
- Dynamic media and open shadow roots are discovered. Rates are reapplied when a site tries to reset them; some live streams reject rate changes.

Example: A selects 2.5× then toggles to 1×. New tab B starts at 1× with a 2.5× alternate. Selecting 3× in B leaves A at 1×; A's toggle still restores 2.5×.

## Audio sync

Open **Audio sync** below the speed panel. This is **delay-only**: use it when sound happens before the picture. It cannot advance late audio or delay the video picture.

- **On / Off:** controls only the selected delay; Dialogue focus is independent. Native audio is untouched until either audio feature is explicitly enabled. Editing a value never silently enables it.
- **−500 ms / +500 ms:** fixed adjustments, clamped to **0–5,000 ms**. No step selector or per-channel memory.
- **Exact delay:** any whole number of milliseconds in that range. Saves on Enter or leaving the field; e.g. 153 + 500 = 653 ms, not a rounded multiple of 500.
- **Reset:** selects 0 ms without changing On/Off or playback speed. Off keeps the selected delay for comparison.
- **Back:** returns to the main speed view. Reopening the popup starts at the main view.

### Tab lifecycle

| Action | Audio correction | Playback speed |
| --- | --- | --- |
| Switch tabs | Keeps running independently | Unchanged |
| Reload the same page | Keeps On/Off and exact delay | Unchanged |
| Navigate to a different page | Off at 0 ms | Retained |
| Change SPA route / URL fragment | Off at 0 ms when URL changes | Retained |
| Back/forward to another page | Off at 0 ms | Retained |
| Open a genuinely new tab | Off at 0 ms, no inherited delay | Remembered speed default |

Same-URL History API updates are not treated as a different page. Full document navigations other than a same-URL reload reset audio, even if the destination URL is the same. Audio state survives background event-page suspension. Full Firefox restart/restored-session audio behavior has **not** been case-tested; navigating restored documents resets it unless Firefox treats their load as a same-page reload. Audio state is not a shared preference or a channel profile.

### Coverage and recovery

Support is best-effort **across websites**, not restricted to Twitch and not a capture of Firefox's entire tab output. Eligible loaded video/audio elements, dynamic players, open shadow roots and accessible frames can share the tab's delay. Some protected/internal pages, DRM media, inaccessible frames, closed shadow roots, Web Audio-only players, and players already owned by another audio graph are unsupported. Known cross-origin media without CORS is left native; redirects and changing player sources can still fail. Insecure pages may not offer the required AudioWorklet API.

The popup distinguishes requested settings from engine connection status, including partial coverage, unavailable frames, autoplay suspension, and failures. “Connected” is an API status, not proof that a site's sound is audible or correctly synced. If prompted, click the webpage to allow its audio context to run.

**After first activation, turning both features Off uses a zero-added-delay processor path, not detachment back to native playback.** Audio sync Off removes only its selected delay, not Dialogue focus’s latency. Web Audio can introduce intrinsic latency. If sound is lost, switch both features Off and reload the page; this recreates the native audio path. Pause and mute suppress buffered sound immediately. Resume, seeking, unmuting or raising volume from zero may need to refill the selected delay; retuning can cause a short gap or repeat. Firefox applies media volume upstream, so the processor normalizes buffered samples and applies the current output volume to avoid double attenuation; transitions can have brief sample-level artifacts.

## Dialogue focus — RNNoise trial

Open **Dialogue focus** below Audio sync. This tries to suppress non-speech in the website’s mixed soundtrack, not isolate a particular speaker or turn down a separate game-audio track. Broad dialogue/site/device coverage has not been established.

- **On / Off:** independent of speed and Audio sync. Starts **Off**; switching Off retains the mix. No additional hotkey in this version.
- **Filter mix (0–100%):** starts at **100%**, RNNoise’s fully filtered result—not 100% noise removal. Lower values blend back original audio, including distracting sounds. Saves on releasing the slider or using its keyboard controls. Editing while Off does not enable it. This is a blend, not a native RNNoise suppression-strength setting.
- **Status:** distinguishes processing, partial coverage, loading, page-interaction requirements and failures. Requested On can remain On when the filter has failed; the status warns that the filter is unavailable and the visible safety note explains the risk of louder original sound. A connected engine does not prove audible or intelligible output.
- **Tab lifecycle:** same-page reload retains On/Off and mix; new tabs and different-page/SPA/back-forward navigation start **Off / 100%**. Switching tabs does not stop the current tab. No audio defaults or channel profiles are stored in Sync.
- **Failure policy:** return to **unfiltered audio**. If RNNoise fails, its node is bypassed while Audio Sync’s selected active delay is retained. If the shared delay processor itself fails, the engine attempts an unfiltered, no-delay connection through the existing source. Neither is a claim of native routing recovery; DRM/CORS/source failures may still require reload. Unfiltered sound can return suddenly louder. Turn Dialogue focus Off/On to retry RNNoise.

### Latency, quality and performance

Processing is local WebAssembly on the CPU; no NVIDIA GPU, companion app, account, uploads or runtime model download is required. The pinned RNNoise model and adapter add **about 30 ms** at 48 kHz, **plus browser/device audio latency** and any active Audio Sync delay. Even **0% mix retains this alignment delay** while On. Positive-only Audio Sync cannot advance late audio to undo it.

Stereo uses two independent channel states; mono is duplicated and larger channel layouts are downmixed to stereo while filtering. Mix changes are smoothed; On/Off, seeking and source changes can produce a short gap/repeat. Quiet words, radio voices, overlapping speakers, laughter, music and game ambience can be affected. There is no extra speech gate, output boost, model picker or siren-only mode.

CPU cost increases with playing media and tabs. Paused/muted processing skips inference; turning Off releases channel states, but the loaded model/heap can remain until page unload. Slow machines or many active players can produce glitches; ordinary CPU underruns are not guaranteed to trigger an error/fallback. No broad performance or listening-quality benchmark has been completed. In generated Firefox fixtures, broadband noise was strongly suppressed but a steady 440 Hz tone only weakly attenuated—**do not infer reliable siren removal from noise tests**.

Website coverage has the same limitations as Audio sync; restrictive site security policies can also prevent module/WASM loading. For a fair listening comparison, avoid stacking NVIDIA Broadcast output noise removal or another denoiser with this filter.

## Configuration / shortcuts

Configuration replaces the main view inside the popup. Back returns to speed controls. It contains all six binding buttons and the speed alternate/persistence reminder.

| Action | Default |
| --- | --- |
| Toggle speed between 1× and this tab's alternate | `Numpad 0` |
| Increase speed by 0.25× | `Numpad +` |
| Decrease speed by 0.25× | `Numpad −` |
| Toggle audio correction | Not set |
| Increase audio delay by 500 ms | Not set |
| Decrease audio delay by 500 ms | Not set |

Click a binding, then press a single physical key. Saves immediately for all tabs; duplicate keys across all six actions are rejected. **Escape during capture clears only that binding.** Same-button click, Back, or closing the popup cancels capture. Escape outside capture is left to Firefox.

Number-row keys are not enabled by default. `KeyboardEvent.code` distinguishes the numpad even with Num Lock off. Punctuation labels follow a US layout; physical positions may differ on other layouts. Shift is accepted only with Equal/Minus (row +/−); other modifiers, repeats, composition and editable targets are ignored. Modifier-only keys and Escape cannot be assigned. The old Alt+Shift commands are not retained as hidden bindings.

Keys require webpage focus, not Firefox's address bar or popup. They affect only their tab; browser/OS-reserved keys may never reach the extension. Audio adjustment keys can select a delay while Off; only the toggle enables correction. A brief page notice describes the selection; open Audio sync to check media/engine coverage.

## Privacy / permissions

No analytics or external network requests. Audio is processed locally; no audio recordings are saved or transmitted.

- **All websites:** discover supported media and keys, run the page-context audio engine, and expose its local worklet/model resources. This host scope is unchanged from v1.3.0.
- **Storage:** speed default/alternate and six key bindings in `browser.storage.sync`; Firefox Account Sync may synchronize them. Changes to speed defaults do not retune existing tabs. Private-window speed selections/key settings update the same shared preferences if the extension is allowed there.
- **Sessions:** per-tab speed and audio settings, plus the current top-level page URL for audio lifecycle comparison. No channel history or audio default is stored in Sync. Private audio remains tab-local.
- **webNavigation:** distinguish reload, navigation and SPA/fragment changes; enumerate frames for individual audio-status queries. The extension does not query browsing history or enumerate recently closed tabs in production.

## Development

Node's built-in test runner runs tests; Python's standard library builds the XPI. No `npm install` or compilation step is required for these operations. RNNoise is a pinned, bundled third-party runtime dependency; its licenses, hash and source/build references are in [`content/vendor/rnnoise/PROVENANCE.md`](content/vendor/rnnoise/PROVENANCE.md). Windows text edits should explicitly use UTF-8.

```powershell
npm run check
npx --no-install web-ext lint --source-dir . --self-hosted --ignore-files "tests/**" "design/**" "AGENTS.md"
npm run package
python -X utf8 tools/firefox_smoke.py
```

Optional UI verification: `python -X utf8 tools/popup_preview.py` uses Selenium, Pillow, cached geckodriver (or `--geckodriver PATH`) and disposable headless Firefox. It checks 17 default/On/expanded-help/bounds/error/partial/capture layouts, tactile press depth, centred +/- strokes, native keyboard faders/switches/help, visible focus, warning visibility and Back focus, and saves `.pi/popup-*.png`. This uses a fictional single-tab API, not real audio. No driver downloads or active-browser changes. `python -X utf8 tools/generate_icons.py` regenerates the four bundled PNG sizes using Pillow.

Accessibility preview: add `--forced-colors --reduced-motion` to the popup preview command. All 17 layouts and interaction checks passed with these Firefox preferences simulated; screenshots go to `.pi/popup-accessibility-contrast-motion/`. This is not a full screen-reader or OS high-contrast certification.

Native toolbar sizing: `python -X utf8 tools/native_popup_smoke.py` uses Selenium, cached geckodriver and a disposable headless Firefox profile. It temporarily installs a staged extension copy with a test-only popup driver, then operates the real toolbar button via geckodriver's `--allow-system-access` (only that test profile). Reports go to `.pi/native-popup.json`. Repeat with `--dpr 1.25 --label native-popup-125` for 125% pixel scaling, or `--height-cap 420 --label native-popup-constrained` to simulate a smaller allowance through Firefox's own popup size calculator. The latter is **not** an actual monitor-resolution test. All three 17-case runs passed on v1.7.0: default fit, silent speed changes without resizing, help expansion/collapse, stable width, and scroll-to-end access. Native default heights at 100% were 529 / 534 / 499 / 591 px (main / audio / dialogue / configuration).

The lint/smoke commands require cached `web-ext` (10.6.0 used here); acquire it explicitly if unavailable. Packaging allowlists runtime directories only, excluding tests, tools, design slides and operational notes. It produces a deterministic unsigned XPI and retains older packages.

### Repository hygiene

The public source includes runtime files and icons, bundled RNNoise with its required notices, tests, development tools, and this README. `.gitignore` allowlists these root entries; review and explicitly allow any new top-level file/directory intended for publication.

Local operational notes, design experiments, generated packages, screenshots/reports, caches, editor settings, and common credential files are excluded. Test tools create their ignored `.pi/` output directory when needed. Keep runtime icons and the bundled RNNoise artifact: they are required assets, not disposable build output. Do not remove third-party attribution notices.

Ignore rules do not protect secrets embedded in source or remove files/identities from earlier commits. Review the proposed file list and diff before committing, scan for credentials, and check history and commit author/email before publishing. Never force-add local secrets or private notes.

### Code map

- `shared/speed.js`, `shared/shortcuts.js`, `shared/audio.js`: normalization and transitions; six physical-key bindings with duplicate protection.
- `background/background.js`: sole serialized writer queue; speed state under `videoSpeedState`, Sync defaults/hotkeys. `background/audio.js` uses that same queue for `videoAudioState` and navigation resets.
- Broadcasts are not awaited inside the writer queue: frames may be awaiting queued state reads. Revisions reject stale state delivery. A persisted `dialogueRun` token preserves explicit Off/On retries even when intermediate state deliveries are coalesced.
- `content/content.js`: rate enforcement and keyboard dispatch. `content/audio-bridge.js`: isolated extension bridge, bounded page requests, BFCache refresh and informational status sanitization. Page messages cannot write preferences or access general extension APIs.
- `content/audio-engine.js`: page-context discovery and Web Audio routing; no context or source before activation. `content/audio-processor.js`: sample delay, pause/seek flushing, output-volume handling.
- `content/dialogue-processor.js`, `content/dialogue-core.js`: lazy RNNoise worklet and streaming/stereo/mix adapter, chained after the delay node using the existing media source. `content/vendor/rnnoise/`: unmodified pinned WASM module and licenses.
- `popup/popup.css` owns natural sizing, geometry and typography; `popup/tactile.css`, loaded afterward, adds the approved tactile finish and high-contrast overrides.
- `popup/popup.*` and `popup/audio.js`: main speed panel, unified key capture and separate delay/dialogue detail/status. Audio status is queried per frame outside the writer queue, with bounded waits.
- `tests/`: mocked integration/engine tests and sample-level processor tests. `tests/browser-init.js` is a lightweight single-tab preview mock, not audio or Firefox API validation.
- `tools/firefox_smoke.py` + `tools/audio_smoke_driver.js` + `tools/dialogue_smoke_driver.js`: disposable headless Firefox profile/extension copy and generated loopback WAV fixtures. Test-only analyser instrumentation routes played samples through zero gain before the destination; no test sound reaches speakers. Test permissions/autoplay preferences do not enter the package or user's profile.

### Verification scope

The v1.7.0 baseline passed runtime syntax checks and 36 Node tests, a 55-check headless Firefox integration run, 17 popup preview cases in both default and simulated contrast/reduced-motion settings, and three 17-case native sizing runs. These are prior release results, not checks automatically performed by cloning this repository. Local reports are intentionally not committed; use the commands above to reproduce the checks.

Tests include real bundled RNNoise WASM, not just mocks. Release packaging was compared against runtime files and repeated for determinism. This does not replace live-site/manual acceptance testing.

Automated tests cover existing speed behavior, audio state/limits/serialization, independent tabs, lifecycle resets, key configuration, popup saves/failures, native-until-enabled routing, unsafe-source skipping, source reuse, worklet-load failure and individual delayed samples. Real Firefox checks include speed regressions, loaded audio/video/frames, positive delay samples, immediate mute/pause, volume without double attenuation, refill after seek/resume, audio popup/exact entry/hotkeys and reload/SPA/full-page reset behavior. RNNoise checks add channel isolation, 30 ms alignment, original/filtered blend, pause/mute/volume, generated noise suppression, source changes, 2× playback, partial coverage, failure fallback/retry and popup settings/lifecycle. These do not establish dialogue intelligibility or compatibility with every live website or protected player.

Manual release checks still recommended:

1. Disable the old Audio Sync add-on, install the package, reload pages. On your usual Twitch/other player, tune the delay and compare On/Off.
2. Try a second tab with a different delay, switch tabs, reload one, then navigate it. Check that speed is preserved but audio navigation resets.
3. Test playback speeds and pause/mute/volume, seek, player/quality/ad replacements, full screen and embedded players. If routing fails, turn Off and reload.
4. Check all six keys in the **native toolbar popup**, Escape capture, Back/close cancellation, editable fields, physical numpad/Num Lock and OS-reserved keys. Automated key events are synthetic and the popup runs in an extension iframe.
5. With packaged installation and session restoration enabled, restart Firefox manually and check restored speed/alternate and audio behavior. Full browser-restart and private-window behavior need case-specific verification.

6. On a representative speech-and-noise clip, compare Dialogue focus Off with On / 100%, then lower the mix if words sound damaged. Check quiet/radio/multiple voices, sirens, stereo position, lip sync and CPU use. Start at a comfortable volume; unfiltered fallback can restore loud sounds. Detailed voice, device and long-session comparisons remain recommended.
