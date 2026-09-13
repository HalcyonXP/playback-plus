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
            assert not driver.find_elements(By.CSS_SELECTOR, '.brand, .logo, #defaultKind, #defaultHint')
            assert find('defaultLabel').text == 'Default for new tabs'
            assert find('saveDefault').get_attribute('role') != 'switch'
            assert find('saveDefault').get_attribute('aria-checked') is None
            assert find('saveDefault').accessible_name == 'Save current playback speed as default for new tabs'
            readout = driver.execute_script("const r=document.getElementById('defaultReadout'),s=getComputedStyle(r),b=document.getElementById('saveDefault').getBoundingClientRect(),p=document.querySelector('.presets').getBoundingClientRect();return {cursor:s.cursor,background:s.backgroundImage,shadow:s.boxShadow,tabIndex:r.tabIndex,below:b.top>=p.bottom,first:document.querySelector('.adjuster').getBoundingClientRect().top}")
            assert readout == {'cursor':'default','background':'none','shadow':'none','tabIndex':-1,'below':True,'first':19}, readout
            find('defaultLabel').click()
            assert find('defaultSpeed').text == '1×', 'Readout clicks must not save'
            assert driver.execute_script("return getComputedStyle(document.querySelector('.presets')).gap") == '0px'
            assert find('dialogueMix').get_attribute('aria-label') == 'Filter mix'
            alignment = driver.execute_script("const l=document.getElementById('defaultLabel').getBoundingClientRect(), s=document.getElementById('saveDefault').getBoundingClientRect(); return (l.top+l.height/2)-(s.top+s.height/2)")
            assert abs(alignment) < .1, alignment
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
                      frameRadius: getComputedStyle(document.querySelector('.app')).borderRadius,
                      rateColour: getComputedStyle(document.getElementById('speedValue')).color,
                      warningColours: ['audioSafety','dialogueSafety'].map(id=>getComputedStyle(document.getElementById(id)).color),
                      overflow: visible.filter(e => { const r = e.getBoundingClientRect(); return r.left < -1 || r.right > 361; }).map(e => e.id || e.tagName),
                      height: Math.min(innerHeight, document.body.getBoundingClientRect().height),
                      naturalHeight: document.body.getBoundingClientRect().height,
                      scrollHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight};
                ''')
                assert metrics['frameRadius'] == '8px', name
                if not args.forced_colors:
                    assert metrics['rateColour'] == 'rgb(155, 202, 255)', name
                    assert metrics['warningColours'] == ['rgb(241, 199, 132)'] * 2, name
                playback = not find('mainView').get_attribute('hidden')
                assert find('saveDefault').is_displayed() == playback, name
                if playback:
                    assert 'PLAYBACK RATE' not in find('mainView').text and 'THIS TAB' not in find('mainView').text
                text_depth = driver.execute_script("""
                  return [...document.querySelectorAll('.app *')].filter(e=>e.getClientRects().length && [...e.childNodes].some(n=>n.nodeType===3 && n.textContent.trim())).every(e=>(getComputedStyle(e).textShadow !== 'none') === !matchMedia('(forced-colors: active)').matches);
                """)
                assert text_depth, ('All visible lettering has depth only outside forced colours', name)
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
            assert driver.execute_script('return getComputedStyle(arguments[0]).transform', key) == 'none', 'Flat actions must not jump on press'
            if not args.forced_colors:
                assert driver.execute_script('return getComputedStyle(arguments[0]).boxShadow', key) != rest_shadow
            ActionChains(driver).release().perform()
            wait.until(lambda _: find('speedValue').text == '2.25×')
            find('decreaseButton').click()
            wait.until(lambda _: find('speedValue').text == '2.00×')
            assert not find('notice').text, 'Routine changes must be silent'
            ActionChains(driver).move_to_element(find('speedValue')).perform()
            layout('main')
            # Real native range value stays at the destination; only its cap moves.
            motion = driver.execute_async_script("""
              const done = arguments[arguments.length - 1], range = document.getElementById('speedRange');
              const samples = [];
              const sample = () => samples.push({
                value: Number(range.value), rate: window.__videoSpeedMock.currentSpeed,
                offset: parseFloat(range.style.getPropertyValue('--speed-thumb-offset')) || 0,
                transform: getComputedStyle(range, '::-moz-range-thumb').transform
              });
              document.querySelector('[data-speed="0.5"]').click();
              sample();
              const start = performance.now();
              function frame(now) {
                sample();
                if (now - start < 300) requestAnimationFrame(frame);
                else done(samples);
              }
              requestAnimationFrame(frame);
            """)
            assert all(s['value'] == .5 and s['rate'] == .5 for s in motion), motion
            assert motion[-1]['offset'] == 0, motion
            if args.reduced_motion:
                assert all(s['offset'] == 0 for s in motion), motion
            else:
                assert motion[0]['offset'] > 0 and any(0 < s['offset'] < motion[0]['offset'] for s in motion), motion
                assert motion[0]['transform'] not in ('none', 'matrix(1, 0, 0, 1, 0, 0)'), motion
            assert find('defaultSpeed').text == '1×', 'Presets must not overwrite the saved snapshot'
            find('saveDefault').send_keys(Keys.SPACE)
            wait.until(lambda _: find('defaultSpeed').text == '0.5×' and find('saveDefault').is_enabled())
            layout('default-saved')
            driver.execute_script('return fixtureApi.changeSpeed(2)')
            assert find('defaultSpeed').text == '0.5×'
            layout('default-snapshot')
            find('saveDefault').send_keys(Keys.ENTER)
            wait.until(lambda _: find('defaultSpeed').text == '2×' and find('saveDefault').is_enabled())
            layout('default-resaved')
            driver.execute_script('return fixtureApi.changeSpeed(0.5)')
            find('saveDefault').click()
            wait.until(lambda _: find('defaultSpeed').text == '0.5×' and find('saveDefault').is_enabled())
            driver.execute_script('return fixtureApi.changeSpeed(2)')
            # Both +/- buttons use the same visual-only glide, with one final rate request.
            for button, expected in [('increaseButton', 2.25), ('decreaseButton', 2)]:
                traced = driver.execute_async_script("""
                  const button=arguments[0], done=arguments[arguments.length-1], range=document.getElementById('speedRange');
                  const original=browser.runtime.sendMessage, requests=[], samples=[];
                  browser.runtime.sendMessage = m => { if(m.type==='VIDEO_SPEED_SET')requests.push(m.speed); return original(m); };
                  const sample=()=>samples.push({value:Number(range.value),rate:window.__videoSpeedMock.currentSpeed,offset:parseFloat(range.style.getPropertyValue('--speed-thumb-offset'))||0});
                  document.getElementById(button).click(); sample(); const start=performance.now();
                  function frame(now) { sample(); if(now-start<300)requestAnimationFrame(frame); else {browser.runtime.sendMessage=original;done({requests,samples});} }
                  requestAnimationFrame(frame);
                """, button)
                assert traced['requests'] == [expected], traced
                samples = traced['samples']
                assert all(s['value'] == expected and s['rate'] == expected for s in samples), traced
                assert samples[-1]['offset'] == 0, traced
                if args.reduced_motion:
                    assert all(s['offset'] == 0 for s in samples), traced
                else:
                    assert samples[0]['offset'] != 0 and any(0 < abs(s['offset']) < abs(samples[0]['offset']) for s in samples), traced
                assert find('defaultSpeed').text == '0.5×', 'Nudges never update the snapshot'
            # Repeated presets reverse from the visible position; direct input cancels.
            interrupted = driver.execute_script("""
              const r = document.getElementById('speedRange');
              document.querySelector('[data-speed="3"]').click();
              document.querySelector('[data-speed="1"]').click();
              r.dispatchEvent(new KeyboardEvent('keydown', {code:'ArrowRight'}));
              return {value:r.value, offset:r.style.getPropertyValue('--speed-thumb-offset')};
            """)
            assert interrupted == {'value':'1', 'offset':'0px'}, interrupted
            driver.execute_script('return fixtureApi.changeSpeed(2)')
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
                assert switch.get_attribute('aria-label') == ('Audio sync' if view == 'audio' else 'Voice Clarity')
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
            # The approved no-media design has neither inline availability copy
            # nor an overlay. Empty/restricted/paused pages are not engine failures.
            absent = 'fixtureApi.setAudioReport({media:0,eligible:0,connected:0,dialogueConnected:0})'
            driver.execute_script(absent)
            find('audioButton').click()
            wait.until(lambda _: not find('audioEnabled').is_enabled())
            assert not find('audioStatus').text and not find('audioError').text
            layout('audio-no-media')
            find('audioBackButton').click()
            assert not find('availabilityText').text and find('saveDefault').is_enabled()
            layout('main-no-media')
            find('dialogueButton').click()
            wait.until(lambda _: not find('dialogueEnabled').is_enabled())
            assert not find('dialogueStatus').text and not find('dialogueError').text
            layout('dialogue-no-media')
            find('dialogueBackButton').click()
            find('configButton').click()
            assert find('toggleKeyButton').is_enabled()
            assert not driver.find_elements(By.CSS_SELECTOR, '.unavailable-overlay, .unavailable-message, [inert]')
            layout('configuration-no-media')
            find('backButton').click()
            driver.execute_script('fixtureApi.setAudioReport({})')
            find('audioButton').click()
            wait.until(lambda _: find('audioEnabled').is_enabled())
            find('audioEnabled').click()
            wait.until(lambda _: find('audioEnabled').get_attribute('aria-checked') == 'true' and find('audioEnabled').is_enabled())
            driver.execute_script("return fixtureApi.message({type:'DIALOGUE_ENABLE',enabled:true})")
            driver.execute_script(absent)
            wait.until(lambda _: find('audioSummary').get_attribute('textContent').endswith('selected') and not find('audioStatus').text)
            assert find('audioEnabled').is_enabled(), 'Off remains usable after media disappears'
            layout('audio-no-media-on')
            find('audioBackButton').click()
            find('dialogueButton').click()
            wait.until(lambda _: find('dialogueSummary').get_attribute('textContent').endswith('selected') and not find('dialogueStatus').text)
            assert find('dialogueEnabled').is_enabled(), 'Filter Off remains usable after media disappears'
            layout('dialogue-no-media-on')
            driver.execute_script('fixtureApi.setAudioReport({})')
            wait.until(lambda _: find('dialogueStatus').text.startswith('On'))
            driver.execute_script("return fixtureApi.message({type:'AUDIO_SYNC_ENABLE',enabled:false})")
            driver.execute_script("return fixtureApi.message({type:'DIALOGUE_ENABLE',enabled:false})")
            find('dialogueBackButton').click()
            find('configButton').click()
            instruction = 'Choose a shortcut. Press a key. Escape clears it.'
            assert find('hotkeyHint').text == instruction
            assert not driver.find_elements(By.CSS_SELECTOR, '.shortcut-scope')
            assert driver.execute_script("return document.getElementById('hotkeyHint').previousElementSibling.classList.contains('config-heading')")
            assert driver.find_element(By.CSS_SELECTOR, '.audio-config-label').text == 'AUDIO SYNC'
            assert driver.execute_script("const s=getComputedStyle(document.getElementById('shortcutDetails')); return s.borderTopWidth==='0px' && s.marginTop==='0px'"), 'Configuration help has no redundant divider or gap'
            assert driver.execute_script("return ['audioDetails','dialogueDetails'].every(id=>getComputedStyle(document.getElementById(id)).borderTopWidth==='1px')"), 'Other pages retain their help dividers'
            layout('configuration')
            def config_positions():
                return driver.execute_script("""
                  return {height:document.body.getBoundingClientRect().height,
                    rects:[document.getElementById('hotkeyHint'), ...document.querySelectorAll('.hotkey-row,.hotkey-button')].map(e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height]})};
                """)
            stable = config_positions()
            key_ids = ['toggleKeyButton','increaseKeyButton','decreaseKeyButton','audioToggleKeyButton','audioIncreaseKeyButton','audioDecreaseKeyButton']
            original_labels = {id: find(id).text for id in key_ids}
            for id in key_ids:
                find(id).click()
                assert find(id).text == 'Press key…' and find(id).get_attribute('aria-pressed') == 'true'
                assert find('hotkeyHint').text == instruction and not find('hotkeyFeedback').text
                assert config_positions() == stable, ('Capture must not move the instruction, rows or controls', id)
                assert all(find(other).text == original_labels[other] for other in key_ids if other != id)
                assert driver.execute_script('return arguments[0].scrollWidth <= arguments[0].clientWidth',find(id)), 'Press key must fit without truncation'
                find(id).click()
                assert config_positions() == stable and find(id).text == original_labels[id]
            find('audioIncreaseKeyButton').click()
            layout('configuration-capture')
            # A duplicate must affect the separate feedback region, not the instruction or key rows.
            driver.execute_script("document.dispatchEvent(new KeyboardEvent('keydown',{code:'NumpadAdd',bubbles:true}));document.dispatchEvent(new KeyboardEvent('keyup',{code:'NumpadAdd',bubbles:true}))")
            assert 'already assigned' in find('hotkeyFeedback').text and find('hotkeyHint').text == instruction
            assert config_positions()['rects'] == stable['rects']
            assert find('hotkeyFeedback').get_attribute('aria-live') == 'polite'
            layout('configuration-duplicate')
            find('audioIncreaseKeyButton').click()
            assert not find('hotkeyFeedback').text and config_positions() == stable
            # Wide labels retain their full accessible/hover names without moving rows.
            driver.execute_script("return fixtureApi.message({type:'VIDEO_SPEED_SET_HOTKEY',action:'audioToggle',code:'IntlBackslash'})")
            wait.until(lambda _: 'Intl Backslash' in find('audioToggleKeyButton').get_attribute('title'))
            assert 'Intl Backslash' in find('audioToggleKeyButton').get_attribute('aria-label')
            assert config_positions() == stable
            find('audioToggleKeyButton').click()
            assert config_positions() == stable and find('hotkeyHint').text == instruction
            driver.execute_script("document.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape',bubbles:true}));document.dispatchEvent(new KeyboardEvent('keyup',{code:'Escape',bubbles:true}))")
            wait.until(lambda _: find('audioToggleKeyButton').is_enabled() and find('audioToggleKeyButton').text == 'Not set')
            assert config_positions() == stable and find('hotkeyHint').text == instruction
            summary = find('shortcutDetails').find_element(By.TAG_NAME, 'summary')
            summary.send_keys(Keys.ENTER)
            wait.until(lambda _: find('shortcutDetails').get_attribute('open'))
            layout('configuration-help')
            print(json.dumps({'passed': True, 'checks': 'GB1 ice-blue readouts, amber warnings, rounded frame, Graphite ruled action materials, centred default row, non-interactive playback-only readout, snapshot Save/re-save, visual-only preset and +/- glide and interruption, stable compact hotkey targets/fixed instruction/separate feedback, stationary flat press state, centred +/- strokes, speed/mix keyboard endpoints, exact-delay bounds/errors, partial/failure status, shortcut capture, layout, switches/help and Back focus', 'views': results}, indent=2))
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
