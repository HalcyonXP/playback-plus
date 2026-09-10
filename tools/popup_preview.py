"""Headless Firefox popup layout/keyboard checks with a fictional single-tab API.
Requires Selenium, Pillow and a cached geckodriver (or --geckodriver). No downloads,
user profiles or real media. Actual extension/audio integration: firefox_smoke.py.
"""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import threading

from PIL import Image, ImageDraw
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.support.ui import WebDriverWait

ROOT = Path(__file__).resolve().parents[1]


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        if self.path == '/preview':
            data = b'<!doctype html><iframe src="/popup/popup.html" style="width:360px;height:600px;border:0"></iframe>'
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        elif self.path == '/popup/popup.html':
            html = (ROOT / 'popup/popup.html').read_text(encoding='utf-8')
            html = html.replace('<script src="../shared/speed.js">',
                                '<script src="../tests/browser-init.js"></script>\n    <script src="../shared/speed.js">')
            data = html.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:
            super().do_GET()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--firefox', default='C:/Program Files/Firefox Developer Edition/firefox.exe')
    parser.add_argument('--geckodriver')
    parser.add_argument('--forced-colors', action='store_true', help='Simulate Firefox high-contrast document colours in the test profile')
    parser.add_argument('--reduced-motion', action='store_true', help='Simulate the reduced-motion preference in the test profile')
    args = parser.parse_args()
    candidates = sorted((Path.home() / '.cache/selenium/geckodriver').glob('**/geckodriver.exe'))
    driver_path = args.geckodriver or (str(candidates[-1]) if candidates else None)
    if not driver_path or not Path(driver_path).is_file():
        parser.error('Provide --geckodriver; no cached executable found. Nothing will be downloaded.')
    output = ROOT / '.pi'
    if args.forced_colors or args.reduced_motion:
        output /= 'popup-accessibility' + ('-contrast' if args.forced_colors else '') + ('-motion' if args.reduced_motion else '')
    output.mkdir(parents=True, exist_ok=True)
    options = Options()
    options.binary_location = args.firefox
    options.add_argument('-headless')
    options.set_preference('layout.css.devPixelsPerPx', '1.0')
    if args.forced_colors:
        options.set_preference('browser.display.document_color_use', 2)
        options.set_preference('browser.display.use_system_colors', False)
        options.set_preference('browser.display.background_color', '#000000')
        options.set_preference('browser.display.foreground_color', '#ffffff')
    if args.reduced_motion:
        options.set_preference('ui.prefersReducedMotion', 1)
    service = Service(driver_path, popen_kw={'creation_flags': subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0})
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    results = []
    shots = []
    try:
        with webdriver.Firefox(options=options, service=service) as driver:
            driver.set_page_load_timeout(20)
            driver.set_window_size(700, 850)
            driver.get(f'http://127.0.0.1:{server.server_port}/preview')
            driver.switch_to.frame(0)
            wait = WebDriverWait(driver, 10)
            find = lambda id: driver.find_element(By.ID, id)
            wait.until(lambda _: find('speedRange').is_enabled() and find('audioExact').is_enabled())
            assert not find('availabilityText').text
            if args.forced_colors:
                assert driver.execute_script("return matchMedia('(forced-colors: active)').matches")
                assert driver.execute_script("return getComputedStyle(document.querySelector('.presets button[aria-pressed=true]')).outlineStyle") == 'solid'
            if args.reduced_motion:
                assert driver.execute_script("return matchMedia('(prefers-reduced-motion: reduce)').matches")
                assert driver.execute_script("return parseFloat(getComputedStyle(document.querySelector('#audioEnabled'),'::after').transitionDuration)") <= 0.00001

            def layout(name):
                metrics = driver.execute_script('''
                    document.scrollingElement.scrollTop = 0; document.body.scrollTop = 0;
                    const visible = [...document.querySelectorAll('main *')].filter(e => e.getClientRects().length && e.getBoundingClientRect().height);
                    return {width: document.documentElement.scrollWidth,
                      overflow: visible.filter(e => { const r = e.getBoundingClientRect(); return r.left < -1 || r.right > 361; }).map(e => e.id || e.tagName),
                      height: Math.min(innerHeight, document.body.getBoundingClientRect().height),
                      naturalHeight: document.body.getBoundingClientRect().height,
                      scrollHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight};
                ''')
                assert metrics['width'] <= 360 and not metrics['overflow'], (name, metrics)
                assert metrics['height'] <= 600, (name, metrics)
                if name in ('main', 'audio-off', 'dialogue-off', 'configuration'):
                    assert metrics['scrollHeight'] <= metrics['clientHeight'], ('Default view should not scroll', name, metrics)
                filename = output / f'popup-{name}.png'
                driver.find_element(By.TAG_NAME, 'body').screenshot(str(filename))
                results.append({'view': name, **metrics})
                shots.append((name, filename))

            # Check actual pseudo-element stroke centres, not just the span's line box.
            centred = driver.execute_script('''
                return ['decreaseButton', 'increaseButton'].every(id => {
                    const button = document.getElementById(id);
                    const span = button.querySelector('span');
                    const b = button.getBoundingClientRect(), r = span.getBoundingClientRect();
                    return (id === 'increaseButton' ? ['::before', '::after'] : ['::before']).every(pseudo => {
                        const s = getComputedStyle(span, pseudo), t = new DOMMatrix(s.transform);
                        const x = r.left + parseFloat(s.left) + t.e + parseFloat(s.width) / 2;
                        const y = r.top + parseFloat(s.top) + t.f + parseFloat(s.height) / 2;
                        return s.content === '""' && Math.abs(x - (b.left + b.width / 2)) < 0.1
                            && Math.abs(y - (b.top + b.height / 2)) < 0.1;
                    });
                });
            ''')
            assert centred, 'Speed +/- strokes must be visually centred in their buttons'
            key = find('increaseButton')
            rest_shadow = driver.execute_script('return getComputedStyle(arguments[0]).boxShadow', key)
            ActionChains(driver).move_to_element(key).click_and_hold().perform()
            assert driver.execute_script('return getComputedStyle(arguments[0]).transform', key) == 'matrix(1, 0, 0, 1, 0, 3)'
            if not args.forced_colors:
                assert driver.execute_script('return getComputedStyle(arguments[0]).boxShadow', key) != rest_shadow
            ActionChains(driver).release().perform()
            wait.until(lambda _: find('speedValue').text == '2.25×')
            find('decreaseButton').click()
            wait.until(lambda _: find('speedValue').text == '2.00×')
            assert not find('notice').text, 'Routine changes must be silent'
            ActionChains(driver).move_to_element(driver.find_element(By.CSS_SELECTOR, '.header')).perform()
            layout('main')
            speed_range = find('speedRange')
            find('decreaseButton').send_keys(Keys.TAB)
            assert driver.execute_script('return document.activeElement.id') == 'speedRange'
            assert driver.execute_script('return getComputedStyle(document.activeElement).outlineStyle') != 'none'
            speed_range.send_keys(Keys.END)
            wait.until(lambda _: find('speedValue').text == '8.00×')
            assert not find('increaseButton').is_enabled()
            layout('speed-max')
            speed_range.send_keys(Keys.HOME)
            wait.until(lambda _: find('speedValue').text == '0.25×')
            assert not find('decreaseButton').is_enabled()
            layout('speed-min')
            driver.execute_script('return fixtureApi.changeSpeed(2)')
            assert not find('notice').text, 'Routine changes must be silent'
            for view in ('audio', 'dialogue'):
                find(view + 'Button').click()
                switch = find(view + 'Enabled')
                wait.until(lambda _: switch.is_enabled())
                assert switch.get_attribute('role') == 'switch'
                assert switch.get_attribute('aria-label') == ('Audio sync' if view == 'audio' else 'Dialogue focus')
                assert switch.get_attribute('aria-checked') == 'false'
                layout(view + '-off')
                switch.send_keys(Keys.SPACE)
                wait.until(lambda _: switch.get_attribute('aria-checked') == 'true' and switch.is_enabled())
                layout(view + '-on')
                if view == 'audio':
                    exact = find('audioExact')
                    exact.clear()
                    exact.send_keys('5000', Keys.ENTER)
                    wait.until(lambda _: find('audioValue').text == '5000 ms')
                    assert not find('audioIncrease').is_enabled()
                    layout('audio-max')
                    exact.clear()
                    exact.send_keys('12.5', Keys.ENTER)
                    wait.until(lambda _: 'whole number' in find('audioError').text)
                    layout('audio-invalid')
                    exact.clear()
                    exact.send_keys('0', Keys.ENTER)
                    wait.until(lambda _: find('audioValue').text == '0 ms' and switch.is_enabled())
                else:
                    mix = find('dialogueMix')
                    mix.send_keys(Keys.HOME)
                    wait.until(lambda _: find('dialogueValue').text == '0%' and switch.is_enabled())
                    mix.send_keys(Keys.END)
                    wait.until(lambda _: find('dialogueValue').text == '100%' and switch.is_enabled())
                    driver.execute_script('fixtureApi.setAudioReport({unsupported: 1})')
                    wait.until(lambda _: find('dialogueStatus').text.startswith('Limited support'))
                    layout('dialogue-partial')
                    find('dialogueBackButton').click()
                    layout('main-partial')
                    find('dialogueButton').click()
                    driver.execute_script('fixtureApi.setAudioReport({dialogueConnected: 0, dialogueFailed: 1, dialogueError: "RNNoise failed. Using unfiltered audio. Turn Off and On to retry."})')
                    wait.until(lambda _: 'Turn it Off and On' in find('dialogueError').text)
                    assert 'RNNoise' not in find('dialogueError').text
                    assert switch.get_attribute('aria-checked') == 'true'
                    layout('dialogue-failure')
                    driver.execute_script('fixtureApi.setAudioReport({})')
                    wait.until(lambda _: not find('dialogueError').text)
                switch.send_keys(Keys.SPACE)
                wait.until(lambda _: switch.get_attribute('aria-checked') == 'false' and switch.is_enabled())
                details = find(view + 'Details')
                assert not details.get_attribute('open')
                assert find(view + 'Safety').is_displayed(), 'Safety warning must stay outside collapsed help'
                summary = details.find_element(By.TAG_NAME, 'summary')
                summary.send_keys(Keys.ENTER)
                wait.until(lambda _: details.get_attribute('open'))
                assert details.find_element(By.TAG_NAME, 'p').is_displayed()
                layout(view + '-help')
                summary.send_keys(Keys.ENTER)
                wait.until(lambda _: not details.get_attribute('open'))
                find(view + 'BackButton').click()
                assert driver.execute_script('return document.activeElement.id') == view + 'Button'
            find('configButton').click()
            assert 'Shared shortcuts' in driver.find_element(By.CSS_SELECTOR, '.shortcut-scope').text
            assert driver.find_element(By.CSS_SELECTOR, '.audio-config-label').text == 'AUDIO SYNC'
            layout('configuration')
            find('audioIncreaseKeyButton').click()
            assert find('audioIncreaseKeyButton').get_attribute('aria-pressed') == 'true'
            layout('configuration-capture')
            find('audioIncreaseKeyButton').click()
            summary = find('shortcutDetails').find_element(By.TAG_NAME, 'summary')
            summary.send_keys(Keys.ENTER)
            wait.until(lambda _: find('shortcutDetails').get_attribute('open'))
            layout('configuration-help')
            print(json.dumps({'passed': True, 'checks': 'tactile press depth, centred +/- strokes, speed/mix keyboard endpoints, exact-delay bounds/errors, partial/failure status, shortcut capture, layout, switches/help and Back focus', 'views': results}, indent=2))
    finally:
        server.shutdown()
        server.server_close()
    # Compact side-by-side review of the four default views.
    names = {'main', 'audio-off', 'dialogue-off', 'configuration'}
    images = [(name, Image.open(path).convert('RGB')) for name, path in shots if name in names]
    sheet = Image.new('RGB', (380 * len(images), 640), '#202630')
    draw = ImageDraw.Draw(sheet)
    for i, (name, image) in enumerate(images):
        draw.text((i * 380 + 10, 8), name, fill='white')
        sheet.paste(image, (i * 380 + 10, 30))
    sheet.save(output / 'popup-review.png')


if __name__ == '__main__':
    main()
