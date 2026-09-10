"""Optional real-Firefox smoke test; uses a disposable profile, never the user's profile.
Requires Node/npx with web-ext already available, plus Firefox Developer Edition.
"""
import argparse
import json
import io
import math
import random
import struct
import wave
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
DRIVER = r"""
(async () => {
  const checks = [];
  const origin = '__ORIGIN__';
  const pause = () => new Promise(resolve => setTimeout(resolve, 100));
  function check(condition, name) {
    if (!condition) throw new Error(name);
    checks.push(name);
    void fetch(origin + '/progress', { method: 'POST', body: JSON.stringify({ checks }) });
  }
  async function waitFor(operation) {
    let error;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      try {
        return await Promise.race([
          operation(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('API response timed out')), 5000))
        ]);
      } catch (e) { error = e; await pause(); }
    }
    throw error;
  }
  const request = (tabId, type, values = {}) => waitFor(() => browser.tabs.sendMessage(tabId, {
    type: 'SMOKE_ACTION', action: { type, ...values }
  }, { frameId: 0 }));
  const get = id => request(id, 'VIDEO_SPEED_GET_STATE');
  const set = (id, speed) => request(id, 'VIDEO_SPEED_SET', { speed });
  async function mediaAt(id, speed, minimum = 3) {
    return waitFor(async () => {
      const results = await browser.scripting.executeScript({
        target: { tabId: id, allFrames: true },
        func: () => {
          const roots = [document, ...[...document.querySelectorAll('*')].map(e => e.shadowRoot).filter(Boolean)];
          return roots.flatMap(root => [...root.querySelectorAll('video, audio')].map(e => e.playbackRate));
        }
      });
      const rates = results.flatMap(result => result.result || []);
      if (rates.length < minimum || rates.some(rate => rate !== speed)) {
        throw new Error(`Tab ${id}: expected ${speed}, got ${rates}`);
      }
      return rates;
    });
  }
  let report;
  try {
    await fetch(origin + '/started');
    const a = await browser.tabs.create({ url: origin + '/media#a', active: false });
    const b = await browser.tabs.create({ url: origin + '/media#b', active: false });
    await mediaAt(a.id, 2);
    await mediaAt(b.id, 2);
    await set(a.id, 2.5);
    await set(b.id, 3);
    await mediaAt(a.id, 2.5);
    await mediaAt(b.id, 3);
    check(true, 'real video/audio and iframe rates are tab-local');
    await request(a.id, 'VIDEO_SPEED_TOGGLE');
    const c = await browser.tabs.create({ url: origin + '/media#c', active: false });
    await mediaAt(c.id, 1);
    check((await get(c.id)).lastNon1xSpeed === 2.5, 'new tab inherits 1x and the alternate');
    await mediaAt(b.id, 3);
    await browser.scripting.executeScript({ target: { tabId: a.id }, func: () => {
      document.body.append(document.createElement('audio'));
      const host = document.createElement('test-player');
      host.attachShadow({ mode: 'open' }).append(document.createElement('audio'), document.createElement('video'));
      document.body.append(host);
    } });
    await mediaAt(a.id, 1, 6);
    check(true, 'dynamic audio and open-shadow audio/video follow tab speed');
    await browser.tabs.reload(a.id);
    await mediaAt(a.id, 1);
    await browser.tabs.update(a.id, { url: origin + '/other#a' });
    await mediaAt(a.id, 1);
    check((await get(a.id)).lastNon1xSpeed === 2.5, 'reload/navigation preserve the alternate');
    await browser.tabs.remove(a.id);
    const closed = await waitFor(async () => {
      const entry = (await browser.sessions.getRecentlyClosed()).find(s => s.tab?.url?.endsWith('#a'));
      if (!entry) throw new Error('Closed test tab not found');
      return entry;
    });
    const restored = await browser.sessions.restore(closed.tab.sessionId);
    await mediaAt(restored.tab.id, 1);
    check((await get(restored.tab.id)).lastNon1xSpeed === 2.5, 'Firefox closed-tab restoration preserves tab session values');
    await request(restored.tab.id, 'VIDEO_SPEED_TOGGLE');
    await mediaAt(restored.tab.id, 2.5);
    await mediaAt(b.id, 3);
    check(true, 'restored tab toggles independently');
    const duplicate = await browser.tabs.duplicate(b.id, { active: true });
    await mediaAt(duplicate.id, 2.5);
    check((await get(duplicate.id)).lastNon1xSpeed === 2.5, 'duplicated tabs start from the latest default');
    // Exercise real content-script keyboard listeners (synthetic DOM events).
    async function press(id, code, fields = {}, editable = false) {
      return browser.scripting.executeScript({ target: { tabId: id, frameIds: [0] },
        func: (code, fields, editable) => {
          const target = editable ? document.body.appendChild(document.createElement('input')) : window;
          const event = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...fields });
          target.dispatchEvent(event);
          if (editable) target.remove();
          return event.defaultPrevented;
        }, args: [code, fields, editable]
      });
    }
    await set(b.id, 3);
    check(!(await press(b.id, 'Equal'))[0].result, 'number-row increase is unassigned by default');
    await press(b.id, 'NumpadAdd');
    await mediaAt(b.id, 3.25);
    await press(b.id, 'NumpadSubtract');
    await mediaAt(b.id, 3);
    check(!(await press(b.id, 'NumpadAdd', {}, true))[0].result, 'editable input bypasses numpad hotkeys');
    check(!(await press(b.id, 'NumpadAdd', { ctrlKey: true }))[0].result, 'modified shortcuts are ignored');

    // The actual popup document runs in an extension iframe, not a UI mock.
    // Native toolbar-popup dismissal/OS-reserved keys still need manual testing.
    const preview = document.createElement('iframe');
    preview.src = browser.runtime.getURL('popup/popup.html');
    preview.style = 'width:360px;height:600px;border:0';
    document.body.append(preview);
    const popup = await waitFor(async () => {
      const doc = preview.contentDocument;
      if (!doc?.querySelector('#toggleKeyButton') || doc.querySelector('#toggleKeyButton').disabled) {
        throw new Error('Popup not initialized');
      }
      return doc;
    });
    popup.querySelector('#configButton').click();
    check(popup.querySelector('#mainView').hidden && !popup.querySelector('#configView').hidden,
      'configuration replaces the main view inside the popup');
    function capture(button, code, fields = {}) {
      popup.querySelector(button).click();
      const win = preview.contentWindow;
      popup.dispatchEvent(new win.KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...fields }));
      popup.dispatchEvent(new win.KeyboardEvent('keyup', { code, bubbles: true, cancelable: true, ...fields }));
    }
    async function saved(action, code) {
      return waitFor(async () => {
        const stored = await browser.storage.sync.get('hotkeys');
        if (stored.hotkeys?.[action] !== code) throw new Error('Hotkey not saved yet');
        if (popup.querySelector('#toggleKeyButton').disabled) throw new Error('Popup still saving');
      });
    }
    capture('#toggleKeyButton', 'NumpadAdd');
    check(popup.querySelector('#hotkeyHint').textContent.includes('already assigned'), 'popup rejects duplicate binding');
    popup.querySelector('#toggleKeyButton').click(); // cancel invalid capture
    capture('#toggleKeyButton', 'KeyK');
    await saved('toggle', 'KeyK');
    await waitFor(async () => {
      if (!(await press(b.id, 'KeyK'))[0].result) throw new Error('Binding not delivered');
    });
    await mediaAt(b.id, 1);
    await mediaAt(duplicate.id, 2.5);
    check(!(await press(b.id, 'Numpad0'))[0].result, 'old toggle is removed from open tabs');
    capture('#increaseKeyButton', 'Equal', { shiftKey: true });
    await saved('increase', 'Equal');
    await waitFor(async () => {
      if (!(await press(b.id, 'Equal', { shiftKey: true }))[0].result) throw new Error('Row binding not delivered');
    });
    await mediaAt(b.id, 1.25);
    capture('#toggleKeyButton', 'Escape');
    await saved('toggle', null);
    await waitFor(async () => {
      if ((await press(b.id, 'KeyK'))[0].result) throw new Error('Clear not delivered');
    });
    check(popup.querySelector('#toggleKeyButton').textContent === 'Not set', 'Escape clears and displays disabled binding');
    check(popup.documentElement.scrollWidth <= 360, 'configuration fits the popup width');
    popup.querySelector('#backButton').click();
    check(!popup.querySelector('#mainView').hidden && popup.querySelector('#configView').hidden, 'Back restores speed controls');
    __AUDIO_TESTS__
    report = { passed: true, checks };
  } catch (error) {
    report = { passed: false, checks, error: String(error), stack: error.stack,
      tabStates: await Promise.all((await browser.tabs.query({})).map(async tab => ({
        id: tab.id, state: await browser.sessions.getTabValue(tab.id, 'videoSpeedState')
      })))
    };
  }
  await fetch(origin + '/result', { method: 'POST', body: JSON.stringify(report) });
  // Every window belongs to the isolated headless test instance.
  for (const win of await browser.windows.getAll()) await browser.windows.remove(win.id);
})();
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--firefox", default="C:/Program Files/Firefox Developer Edition/firefox.exe")
    args = parser.parse_args()
    finished = threading.Event()
    result = {}
    requests = []
    wav = io.BytesIO()
    with wave.open(wav, 'wb') as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(48000)
        audio.writeframes(b''.join(struct.pack('<h', int(13000 * math.sin(2 * math.pi * 440 * i / 48000))) for i in range(48000 * 4)))
    tone = wav.getvalue()
    wav = io.BytesIO()
    rng = random.Random(42)
    with wave.open(wav, 'wb') as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(48000)
        audio.writeframes(b''.join(struct.pack('<h', rng.randint(-13000, 13000)) for _ in range(48000 * 4)))
    noise = wav.getvalue()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_GET(self):
            requests.append(self.path)
            self.send_response(200)
            is_tone = self.path.startswith(('/tone.wav', '/noise.wav'))
            samples = noise if self.path.startswith('/noise.wav') else tone
            self.send_header("Content-Type", "audio/wav" if is_tone else "text/html")
            if is_tone:
                self.send_header('Content-Length', str(len(samples)))
            self.end_headers()
            body = '<!doctype html><video controls></video><audio controls></audio>'
            if self.path.startswith('/audio'):
                body = '<!doctype html><audio id="one" controls loop preload="auto" src="/tone.wav"></audio>'
                if not self.path.startswith('/audio-frame'):
                    body += '<video id="two" controls loop preload="auto" src="/tone.wav"></video>'
                    body += f'<audio id="unsafe" preload="auto" src="http://localhost:{self.server.server_port}/tone.wav"></audio>'
                    body += '<iframe src="/audio-frame"></iframe>'
            elif self.path != "/frame":
                body += '<iframe src="/frame"></iframe>'
            try:
                self.wfile.write(samples if is_tone else body.encode())
            except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
                pass  # Test navigation/closure can cancel an in-flight fixture request.

        def do_POST(self):
            result.update(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            self.send_response(200)
            self.end_headers()
            if self.path == "/result":
                finished.set()

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    try:
        with tempfile.TemporaryDirectory(prefix="video-speed-smoke-") as temp:
            stage = Path(temp) / "extension"
            stage.mkdir()
            for name in ("background", "content", "shared", "popup", "icons"):
                shutil.copytree(ROOT / name, stage / name)
            manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
            manifest["permissions"].append("scripting")  # test-only DOM assertions
            manifest["background"]["scripts"].append("launch-test.js")
            manifest["content_scripts"][0]["js"].append("test-bridge.js")
            (stage / "test-bridge.js").write_text(
                'browser.runtime.onMessage.addListener(m => m.type === "SMOKE_ACTION" ? browser.runtime.sendMessage(m.action) : undefined);',
                encoding="utf-8"
            )
            (stage / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            (stage / "launch-test.js").write_text(
                'browser.tabs.create({url: browser.runtime.getURL("driver.html"), active: true});', encoding="utf-8"
            )
            (stage / "driver.html").write_text('<!doctype html><script src="driver.js"></script>', encoding="utf-8")
            audio_tests = (ROOT / 'tools/audio_smoke_driver.js').read_text(encoding='utf-8')
            audio_tests = audio_tests.replace('__DIALOGUE_TESTS__', (ROOT / 'tools/dialogue_smoke_driver.js').read_text(encoding='utf-8'))
            (stage / "driver.js").write_text(DRIVER.replace("__ORIGIN__", origin).replace('__AUDIO_TESTS__', audio_tests), encoding="utf-8")
            command = ["npx", "--no-install", "web-ext", "run", "--source-dir", str(stage),
                       "--firefox", args.firefox, "--no-reload", "--no-input", "--args=-headless", "--verbose",
                       "--pref=devtools.console.stdout.content=true", "--pref=media.autoplay.default=0",
                       "--pref=media.autoplay.block-webaudio=false"]
            flags = 0
            if os.name == "nt":
                command = ["cmd.exe", "/d", "/c", *command]
                flags = subprocess.CREATE_NO_WINDOW
            with (Path(temp) / "browser.log").open("w", encoding="utf-8") as log:
                process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, creationflags=flags)
                try:
                    if not finished.wait(180):
                        result.update(passed=False, error="Firefox smoke test timed out")
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        pass
                finally:
                    if process.poll() is None:
                        if os.name == "nt":
                            subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                                           capture_output=True, creationflags=flags, check=False)
                        else:
                            process.terminate()
                        process.wait(timeout=10)
            if not result.get("passed"):
                log_text = (Path(temp) / "browser.log").read_text(encoding="utf-8", errors="replace")
                (ROOT / ".pi" / "firefox-smoke.log").write_text(log_text, encoding="utf-8")
                print(log_text[-12000:])
                print("HTTP requests:", requests)
            print(json.dumps(result, indent=2))
    finally:
        server.shutdown()
        server.server_close()
    return 0 if result.get("passed") else 1


if __name__ == "__main__":
    raise SystemExit(main())
