# Playback Plus

**Your playback, your pace.** Control playback speed, sound timing and dialogue in Firefox—independently for each tab.

**Version 1.7.0 · Firefox 142+**

## Make playback work for you

- **Playback speed:** watch or listen at **0.25×–8×**, with quick presets and a one-key toggle back to normal speed.
- **Audio sync:** when sound arrives before the picture, add up to **5 seconds** of delay. Adjust in 500 ms steps or enter an exact value.
- **Dialogue focus:** reduce background noise with local RNNoise speech enhancement. Adjust **Filter mix** to blend original and filtered sound.
- **Your controls:** a compact Studio Deck panel with configurable keyboard shortcuts. Changes affect your current tab, not your other open tabs.

## Install

This repository currently provides **source code**, not a prebuilt extension download.

### Try it in Firefox

1. Choose **Code → Download ZIP** on this GitHub page and extract it.
2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. Select **Load Temporary Add-on…** and choose the extracted `manifest.json`.
4. Reload your media tabs, then open **Playback Plus** from Firefox’s Extensions menu.

Temporary installation lasts until Firefox closes. If you use the separate **Audio Sync** add-on, disable it first to avoid conflicting audio processing.

<details>
<summary>Keep it installed — Developer Edition or Nightly</summary>

With Python installed, run this from the extracted folder:

```sh
python tools/package_extension.py
```

This creates `dist/playback-plus-1.7.0.xpi`. In Firefox Developer Edition or Nightly:

1. Open `about:config` and set `xpinstall.signatures.required` to `false`. **This disables signature enforcement; only do so if you understand the security implications.**
2. Open `about:addons` → gear menu → **Install Add-on From File…** and select the XPI.
3. Accept the permissions and reload your media tabs.

Standard Firefox requires a signed extension for permanent installation.

</details>

## Everyday controls

Open the extension to change speed, or choose **Audio sync**, **Dialogue focus** or **Configuration**.

| Shortcut | Action |
| --- | --- |
| **Numpad 0** | Toggle between 1× and this tab’s last alternate speed |
| **Numpad + / −** | Increase or decrease speed by 0.25× |

Shortcuts work while the webpage has focus. Customize them in **Configuration**; audio shortcuts start unassigned. Click a binding and press a key to change it, or press **Escape** during capture to clear it.

- Your latest speed choice becomes the starting speed for new tabs; existing tabs keep their own speed.
- Audio sync and Dialogue focus start **Off**. Changing a value does not turn either feature on.
- Audio settings survive a same-page reload but reset when you navigate to a different page. Switching tabs does not stop processing.

## Good to know

- Support varies by website. Protected pages, DRM video and some players cannot be controlled.
- Audio sync **delays sound only**; it cannot advance late audio.
- Dialogue focus enhances mixed audio—it does not isolate a chosen speaker or guarantee noise removal. It can affect voices and music, and adds about **30 ms** of processing delay even at 0% mix, plus browser/device latency.
- **If filtering fails, original sound can return suddenly louder.** Start at a comfortable volume. If audio sounds wrong or disappears, turn **both audio features Off and reload the page** to restore native playback. Turning Off alone does not fully restore the native audio path after activation.

## Privacy

Audio processing stays on your device. No audio uploads, recordings or analytics. Website access lets the extension find media; tab/session access keeps each tab’s settings independent. Speed preferences and shortcuts may sync through your Firefox Account. Audio settings stay tab-local.

[Report a problem or suggest a feature](https://github.com/HalcyonXP/playback-plus/issues) · [RNNoise credits and licenses](content/vendor/rnnoise/PROVENANCE.md)
