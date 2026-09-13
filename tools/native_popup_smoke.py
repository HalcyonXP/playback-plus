"""Actual Firefox toolbar-popup sizing checks in a disposable headless profile.
Requires Selenium, cached geckodriver, Firefox Developer Edition. No downloads,
user-profile changes or speaker output. Test-only popup driver is never packaged.
"""
import argparse
import base64
import io
import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import tempfile
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.support.ui import WebDriverWait

ROOT = Path(__file__).resolve().parents[1]
DRIVER = r"""
(async () => {
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const el = id => document.getElementById(id);
  async function waitFor(predicate, label) {
    for (let i = 0; i < 100; i++) {
      if (predicate()) return;
      await pause(50);
    }
    throw new Error(label + ': ' + JSON.stringify({speed:el('speedValue').textContent, saved:el('defaultSpeed').textContent, disabled:el('saveDefault').disabled, notice:el('notice').textContent}));
  }
  const metrics = name => {
    const root = document.documentElement, body = document.body;
    return {name, innerHeight, innerWidth, dpr: devicePixelRatio, screenHeight: screen.availHeight,
      speed: el('speedValue').textContent, savedDefault: el('defaultSpeed').textContent,
      savingDefault: el('saveDefault').disabled, notice: el('notice').textContent,
      bodyHeight: body.getBoundingClientRect().height, appHeight: document.querySelector('.app').getBoundingClientRect().height,
      frameRadius: getComputedStyle(document.querySelector('.app')).borderRadius,
      rootBackground: getComputedStyle(root).backgroundColor, bodyBackground: getComputedStyle(body).backgroundColor,
      rootClient: root.clientHeight, rootScroll: root.scrollHeight, bodyClient: body.clientHeight, bodyScroll: body.scrollHeight,
      rootWidth: root.clientWidth, bodyWidth: body.clientWidth, scrollWidth: root.scrollWidth,
      scrollTop: document.scrollingElement.scrollTop, bodyMax: getComputedStyle(body).maxHeight};
  };
  async function report(name) {
    await pause(700); // native popup sizing is asynchronous (at most 10 Hz)
    const result = metrics(name);
    await fetch('__ORIGIN__/report', {method: 'POST', body: JSON.stringify(result)});
    return result;
  }
  try {
    for (let i=0; i<100 && (el('audioExact').disabled || el('speedRange').disabled || el('saveDefault').disabled); i++) await pause(100);
    if (el('audioExact').disabled) throw new Error('Popup/media not ready');
    await pause(400);
    document.body.setAttribute('data-native-test-ready', 'true');
    const main = await report('main');
    el('increaseButton').click();
    const changed = await report('main-speed-change');
    if (el('notice').textContent || !el('availability').hidden || changed.innerHeight !== main.innerHeight) throw new Error('Speed change must not create a banner or resize the popup');
    const oldDefault = el('defaultSpeed').textContent;
    el('defaultReadout').click();
    if (el('defaultSpeed').textContent !== oldDefault || el('saveDefault').hasAttribute('aria-checked')) throw new Error('Default readout must be inert and Save must not be a switch');
    el('saveDefault').click();
    await waitFor(() => !el('saveDefault').disabled && el('defaultSpeed').textContent === '1.25×', 'Default Save did not complete');
    const saved = await report('main-default-saved');
    if (el('defaultSpeed').textContent !== '1.25×' || saved.innerHeight !== main.innerHeight) throw new Error('Save must capture without resizing');
    el('decreaseButton').click();
    await report('main-default-kept');
    if (el('defaultSpeed').textContent !== '1.25×') throw new Error('Speed changes must not change saved default');
    el('saveDefault').click();
    await waitFor(() => !el('saveDefault').disabled && el('defaultSpeed').textContent === '1×', 'Default re-save did not complete');
    await report('main-default-resaved');
    if (el('defaultSpeed').textContent !== '1×' || el('notice').textContent) throw new Error('Save must replace the snapshot quietly');
    for (const view of ['audio', 'dialogue']) {
      el(view + 'Button').click();
      await report(view);
      el(view + 'Details').querySelector('summary').click();
      await report(view + '-expanded');
      document.scrollingElement.scrollTop = document.scrollingElement.scrollHeight;
      await report(view + '-bottom');
      el(view + 'Details').querySelector('summary').click();
      await report(view + '-collapsed');
      el(view + 'BackButton').click();
      await report('main-after-' + view);
    }
    el('configButton').click();
    const configuration = await report('configuration');
    const instruction = 'Choose a shortcut. Press a key. Escape clears it.';
    const positions = () => JSON.stringify([el('hotkeyHint'), ...document.querySelectorAll('.hotkey-row,.hotkey-button')].map(e=>e.getBoundingClientRect().toJSON()));
    const originalPositions = positions();
    el('audioIncreaseKeyButton').click();
    const capture = await report('configuration-capture');
    if (capture.innerHeight !== configuration.innerHeight || capture.bodyHeight !== configuration.bodyHeight || positions() !== originalPositions || el('hotkeyHint').textContent !== instruction || el('audioIncreaseKeyButton').textContent !== 'Press key…') throw new Error('Capture must not rewrite the instruction or resize/move the controls');
    document.dispatchEvent(new KeyboardEvent('keydown', {code:'NumpadAdd', bubbles:true}));
    document.dispatchEvent(new KeyboardEvent('keyup', {code:'NumpadAdd', bubbles:true}));
    await report('configuration-duplicate');
    if (!el('hotkeyFeedback').textContent.includes('already assigned') || el('hotkeyHint').textContent !== instruction || positions() !== originalPositions) throw new Error('Duplicate feedback must stay separate from the fixed instruction and controls');
    el('audioIncreaseKeyButton').click();
    const cancelled = await report('configuration-cancelled');
    if (cancelled.innerHeight !== configuration.innerHeight || el('hotkeyFeedback').textContent || positions() !== originalPositions) throw new Error('Cancel must restore quiet configuration');
    el('shortcutDetails').querySelector('summary').click();
    await report('configuration-expanded');
    document.scrollingElement.scrollTop = document.scrollingElement.scrollHeight;
    await report('configuration-bottom');
    el('shortcutDetails').querySelector('summary').click();
    await report('configuration-collapsed');
    el('backButton').click();
    await report('main-final');
    await fetch('__ORIGIN__/report', {method: 'POST', body: JSON.stringify({done:true})});
  } catch(error) {
    await fetch('__ORIGIN__/report', {method: 'POST', body: JSON.stringify({done:true, error:String(error) + '\n' + (error.stack || '')})});
  }
})();
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dpr', default='1.0')
    parser.add_argument('--height-cap', type=int, help='Test-only native-browser height constraint (simulates less available space)')
    parser.add_argument('--label', default='native-popup')
    parser.add_argument('--observe-only', action='store_true')
    parser.add_argument('--screenshots', action='store_true', help='Capture actual popup content via Firefox drawSnapshot, not detached OS chrome')
    parser.add_argument('--browser-theme', choices=('light', 'dark'), help='Enable a built-in Firefox theme in this disposable profile only')
    args = parser.parse_args()
    if args.height_cap is not None and not 200 <= args.height_cap <= 600:
        parser.error('--height-cap must be between 200 and 600 CSS pixels')
    cached = sorted((Path.home() / '.cache/selenium/geckodriver').glob('**/geckodriver.exe'))
    if not cached:
        parser.error('Cached geckodriver required; no automatic downloads.')
    reports = queue.Queue()
    tone = io.BytesIO()
    with wave.open(tone, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(48000); w.writeframes(b'\x00\x00' * 48000)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_GET(self):
            data = tone.getvalue() if self.path == '/tone.wav' else b'<!doctype html><title>Native popup sizing fixture</title><audio src="/tone.wav" preload="auto"></audio>'
            self.send_response(200)
            self.send_header('Content-Type', 'audio/wav' if self.path == '/tone.wav' else 'text/html')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers(); self.wfile.write(data)

        def do_POST(self):
            data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            resume = threading.Event()
            reports.put((data, resume))
            resume.wait(15)  # allow the parent to inspect the actual native browser rectangle
            self.send_response(200); self.end_headers()

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    results = []
    output = ROOT / '.pi'
    output.mkdir(exist_ok=True)
    try:
        with tempfile.TemporaryDirectory(prefix='playback-plus-native-') as temp:
            stage = Path(temp) / 'extension'
            stage.mkdir()
            for name in ('popup', 'icons', 'background', 'content', 'shared'):
                shutil.copytree(ROOT / name, stage / name)
            shutil.copy2(ROOT / 'manifest.json', stage / 'manifest.json')
            html = stage / 'popup/popup.html'
            html.write_text(html.read_text(encoding='utf-8').replace('</body>', '<script src="native-test.js"></script></body>'), encoding='utf-8')
            (stage / 'popup/native-test.js').write_text(DRIVER.replace('__ORIGIN__', origin), encoding='utf-8')
            options = Options()
            options.binary_location = 'C:/Program Files/Firefox Developer Edition/firefox.exe'
            options.add_argument('-headless')
            options.set_preference('layout.css.devPixelsPerPx', args.dpr)
            env = {**os.environ, 'MOZ_HEADLESS_WIDTH': '1600', 'MOZ_HEADLESS_HEIGHT': '1080'}
            service = Service(str(cached[-1]), service_args=['--allow-system-access'], env=env,
                              popen_kw={'creation_flags': subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0})
            with webdriver.Firefox(options=options, service=service) as browser:
                browser.set_page_load_timeout(20)
                browser.set_window_size(1200, 1000)
                browser.install_addon(str(stage), temporary=True)
                browser.get(origin + '/')
                browser.set_context('chrome')
                theme_result = None
                if args.browser_theme:
                    theme_result = browser.execute_async_script("""const done = arguments[arguments.length - 1];
                      const {AddonManager} = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
                      AddonManager.getAddonByID('firefox-compact-' + arguments[0] + '@mozilla.org')
                        .then(async addon => { if (!addon) throw new Error('Built-in theme missing'); await addon.enable(); return {id:addon.id, active:addon.isActive}; })
                        .then(done, error => done(String(error)));""", args.browser_theme)
                    if not isinstance(theme_result, dict) or not theme_result.get('active'):
                        raise AssertionError(theme_result)
                browser.execute_script("CustomizableUI.addWidgetToArea('video-speed_local-browser-action', CustomizableUI.AREA_NAVBAR)")
                WebDriverWait(browser, 15).until(lambda d: d.find_element(By.ID, 'video-speed_local-BAP').is_displayed())
                if args.screenshots:
                    # The toolbar icon is in the main chrome window (unlike the
                    # detached popup), so an ordinary element capture is valid.
                    browser.find_element(By.ID, 'video-speed_local-BAP').screenshot(str(output / (args.label + '-toolbar.png')))
                browser.find_element(By.ID, 'video-speed_local-BAP').click()
                if args.height_cap:
                    WebDriverWait(browser, 15).until(lambda d: d.find_elements(By.CSS_SELECTOR, '.webextension-popup-browser'))
                    # Use Firefox's content-size calculator, not a CSS clip of the
                    # outer XUL browser (that does not resize its content viewport).
                    browser.execute_script("""document.querySelector('.webextension-popup-browser').messageManager.sendAsyncMessage(
                      'Extension:InitBrowser', {fixedWidth: false, maxWidth: 800, maxHeight: arguments[0], allowScriptsToClose: true});""", args.height_cap)
                for _ in range(25):
                    result, resume = reports.get(timeout=35)
                    try:
                        if result.get('done'):
                            if result.get('error'):
                                raise AssertionError(result['error'])
                            break
                        result['native'] = browser.execute_script("const b = document.querySelector('.webextension-popup-browser'); return b?.getBoundingClientRect().toJSON()")
                        if result['name'] in ('main', 'audio', 'dialogue', 'configuration'):
                            result['requestedBrowserTheme'] = theme_result
                            result['chromePanel'] = browser.execute_script("""const b = document.querySelector('.webextension-popup-browser'), p = b?.closest('panel');
                              return p ? {id:p.id, radius:getComputedStyle(p).borderRadius, background:getComputedStyle(p).backgroundColor,
                                arrowBackground:getComputedStyle(p).getPropertyValue('--arrowpanel-background').trim(),
                                panelBackground:getComputedStyle(p).getPropertyValue('--panel-background').trim(),
                                scheme:getComputedStyle(p).colorScheme, chromeTheme:document.documentElement.getAttribute('lwtheme-id'),
                                browserBackground:getComputedStyle(b).backgroundColor, bounds:p.getBoundingClientRect().toJSON()} : null;""")
                            if args.screenshots:
                                # Ordinary WebDriver screenshots miss headless detached popup widgets.
                                # Capture the real popup browsing context. Firefox may composite its
                                # native panel colour even when a transparent snapshot is requested.
                                image = browser.execute_async_script("""const done = arguments[arguments.length - 1];
                                  const b = document.querySelector('.webextension-popup-browser'), r = b.getBoundingClientRect();
                                  b.browsingContext.currentWindowGlobal.drawSnapshot(new DOMRect(0, 0, r.width, r.height), window.devicePixelRatio, 'transparent').then(bitmap => {
                                    const c = document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas'); c.width = bitmap.width; c.height = bitmap.height;
                                    c.getContext('2d').drawImage(bitmap, 0, 0); bitmap.close(); done({png:c.toDataURL('image/png').split(',')[1]});
                                  }).catch(error => done({error:String(error)}));""")
                                if image.get('error'):
                                    raise AssertionError(image['error'])
                                (output / (args.label + '-' + result['name'] + '.png')).write_bytes(base64.b64decode(image['png']))
                        results.append(result)
                        print(json.dumps(result), flush=True)
                    finally:
                        resume.set()
                else:
                    raise AssertionError('Native popup driver did not finish')
    finally:
        server.shutdown(); server.server_close()
    (output / (args.label + '.json')).write_text(json.dumps(results, indent=2), encoding='utf-8')
    if not args.observe_only:
        assert len(results) == 23, 'All native sizing cases must complete'
        cap = args.height_cap or 600
        for r in results:
            assert r['innerWidth'] == 360 and r['scrollWidth'] == 360, r
            assert r['frameRadius'] == '8px', r
            assert r['rootBackground'] == 'rgba(0, 0, 0, 0)' and r['bodyBackground'] == 'rgba(0, 0, 0, 0)', r
            assert r['innerHeight'] <= cap + 1, r
            assert r['native'] and r['native']['height'] <= cap + 1, r
            assert r['bodyMax'] == 'none' and abs(r['bodyHeight'] - r['appHeight']) < 1, r
            expected = min(cap, round(r['bodyHeight'] + .499))
            assert abs(r['innerHeight'] - expected) <= 1, ('Native viewport should fit content up to its limit', r)
            if r['bodyHeight'] < cap:
                assert r['rootScroll'] <= r['rootClient'], ('Unnecessary scrollbar', r)
            else:
                assert r['rootScroll'] > r['rootClient'], ('Overflow must stay accessible', r)
            if r['name'].endswith('-bottom'):
                assert abs(r['scrollTop'] - (r['rootScroll'] - r['rootClient'])) <= 1, ('Cannot reach help end', r)
        by_name = {r['name']: r for r in results}
        for view in ('audio', 'dialogue', 'configuration'):
            start, expanded, collapsed = (by_name[view], by_name[view + '-expanded'], by_name[view + '-collapsed'])
            assert collapsed['innerHeight'] == start['innerHeight'], ('Closing help must restore original size', view)
            if start['innerHeight'] < cap:
                assert expanded['innerHeight'] > start['innerHeight'], ('Opening help must grow popup', view)
        assert by_name['main-final']['innerHeight'] == by_name['main']['innerHeight']
    print('Native popup cases:', len(results))


if __name__ == '__main__':
    main()
