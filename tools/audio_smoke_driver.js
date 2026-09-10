// Inserted into the disposable extension's driver by firefox_smoke.py.
await (async () => {
  const audio = await browser.tabs.create({ url: origin + '/audio', active: true });
  const audioOther = await browser.tabs.create({ url: origin + '/audio', active: false });
  const audioRequest = (type, fields = {}) => request(audio.id, 'AUDIO_SYNC_' + type, fields);
  const audioState = () => audioRequest('GET');
  const audioStatus = () => audioRequest('STATUS_GET');
  async function page(func, args = []) {
    const results = await browser.scripting.executeScript({ target: { tabId: audio.id, frameIds: [0] }, world: 'MAIN', func, args });
    return results[0].result;
  }
  await waitFor(async () => {
    const s = await audioStatus();
    if (s.frames.reduce((n, f) => n + (f.eligible || 0), 0) < 3) throw new Error('Audio fixture not loaded: ' + JSON.stringify(s));
    check(s.frames.every(f => f.contextState === 'native'), 'real Firefox leaves native audio untouched before enable');
  });
  await set(audio.id, 1);
  // Test-only output instrumentation: route every worklet through an analyser and
  // zero gain before the destination. No test sound reaches the user's speakers.
  await browser.scripting.executeScript({ target: { tabId: audio.id, allFrames: true }, world: 'MAIN', func: () => {
    const Native = window.AudioWorkletNode;
    window.__audioTest = { nodes: [] };
    window.AudioWorkletNode = class extends Native {
      constructor(context, name, options) {
        super(context, name, options);
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        const silent = context.createGain();
        silent.gain.value = 0;
        analyser.connect(silent);
        silent.connect(context.destination);
        const nativeConnect = this.connect.bind(this);
        this.connect = destination => nativeConnect(destination === context.destination ? analyser : destination);
        window.__audioTest.nodes.push({ node: this, analyser, name });
      }
    };
  } });
  await audioRequest('SET', { delayMs: 151 });
  await audioRequest('NUDGE', { direction: 1 });
  check((await audioState()).delayMs === 651 && !(await audioState()).enabled, 'exact 151 plus fixed 500 equals 651 without enabling audio');
  await audioRequest('SET', { delayMs: 500 });
  await audioRequest('ENABLE', { enabled: true });
  await waitFor(async () => {
    const s = await audioStatus();
    if (s.frames.reduce((n, f) => n + (f.connected || 0), 0) < 3) throw new Error('Engine not connected: ' + JSON.stringify(s));
    check(s.frames.some(f => f.unsupported >= 1), 'cross-origin source without CORS remains outside the audio graph');
  });
  const signal = await page(async () => {
    const one = document.getElementById('one');
    const analyser = window.__audioTest.nodes[0].analyser;
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const rms = () => {
      const samples = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(samples);
      return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    };
    await one.play();
    await wait(150); const early = rms();
    await wait(600); const full = rms();
    one.volume = 0.5;
    await wait(100); const halfImmediate = rms();
    await wait(600); const halfSettled = rms();
    one.muted = true;
    await wait(100); const muted = rms();
    one.muted = false;
    one.pause();
    await wait(100); const paused = rms();
    await one.play();
    await wait(150); const resumedEarly = rms();
    await wait(600); const resumed = rms();
    one.currentTime = 1;
    await wait(150); const seekEarly = rms();
    await wait(600); const seekLater = rms();
    one.pause();
    return { early, full, halfImmediate, halfSettled, muted, paused, resumedEarly, resumed, seekEarly, seekLater };
  });
  check(signal.early < 0.001 && signal.full > 0.1, 'real samples are silent before 500 ms and audible after delay: ' + JSON.stringify(signal));
  check(signal.halfImmediate / signal.full > 0.4 && signal.halfImmediate / signal.full < 0.6
    && signal.halfSettled / signal.full > 0.4 && signal.halfSettled / signal.full < 0.6,
    'volume is immediate and not applied twice');
  check(signal.muted < 0.001 && signal.paused < 0.001, 'mute and pause immediately suppress buffered output');
  check(signal.resumedEarly < 0.001 && signal.resumed > 0.05 && signal.seekEarly < 0.001 && signal.seekLater > 0.05,
    'resume and seeking fill a fresh delay instead of replaying stale sound');
  await set(audio.id, 2);
  const fastSignal = await page(async () => {
    const one = document.getElementById('one');
    const analyser = window.__audioTest.nodes[0].analyser;
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const rms = () => { const v = new Float32Array(512); analyser.getFloatTimeDomainData(v); return Math.sqrt(v.reduce((n, x) => n + x*x, 0) / v.length); };
    one.volume = 1; one.currentTime = 0;
    await wait(100); await one.play();
    await wait(150); const early = rms();
    await wait(600); const later = rms();
    one.pause();
    return { early, later, speed: one.playbackRate };
  });
  check(fastSignal.speed === 2 && fastSignal.early < 0.001 && fastSignal.later > 0.1, 'audio delay remains output-time based at 2x playback speed');
  await page(() => {
    const host = document.createElement('audio-test-player');
    const a = document.createElement('audio'); a.src = '/tone.wav'; a.preload = 'auto';
    host.attachShadow({ mode: 'open' }).append(a); document.body.append(host);
  });
  await waitFor(async () => { const s = await audioStatus(); if (s.frames.reduce((n, f) => n + (f.connected || 0), 0) < 4) throw new Error('Shadow audio not connected yet'); });
  check(true, 'dynamic open-shadow audio joins correction alongside video/audio and iframe media');
  check(!(await request(audioOther.id, 'AUDIO_SYNC_GET')).enabled, 'audio correction does not enable another tab');
  // Exercise the actual popup's audio controls with the media tab active.
  preview.remove();
  const ap = document.createElement('iframe');
  ap.src = browser.runtime.getURL('popup/popup.html');
  ap.style = 'width:360px;height:600px;border:0';
  document.body.append(ap);
  const ad = await waitFor(async () => {
    const doc = ap.contentDocument;
    if (!doc?.querySelector('#audioEnabled') || doc.querySelector('#audioEnabled').disabled) throw new Error('Audio popup not ready');
    return doc;
  });
  check(ad.querySelector('#availability').hidden && ad.querySelector('#availabilityText').textContent === ''
    && ad.querySelector('.logo').naturalWidth === 96, 'popup loads its icon and keeps normal header status quiet');
  ad.querySelector('#audioButton').click();
  const audioHelp = ad.querySelector('#audioDetails');
  check(!audioHelp.open && !ad.querySelector('#audioSafety').closest('details')
    && ad.querySelector('#audioEnabled').getAttribute('aria-label') === 'Audio sync', 'audio switch is named and recovery warning stays outside collapsed help');
  audioHelp.querySelector('summary').click();
  check(audioHelp.open && ad.documentElement.scrollWidth <= 360, 'expanded audio help fits the popup width');
  audioHelp.querySelector('summary').click();
  check(ad.querySelector('#mainView').hidden && !ad.querySelector('#audioView').hidden, 'real audio detail view replaces main view');
  const exact = ad.querySelector('#audioExact');
  exact.value = '153';
  exact.dispatchEvent(new ap.contentWindow.Event('change', { bubbles: true }));
  await waitFor(async () => { if ((await audioState()).delayMs !== 153 || ad.querySelector('#audioIncrease').disabled) throw new Error('Exact write pending'); });
  ad.querySelector('#audioIncrease').click();
  await waitFor(async () => { if ((await audioState()).delayMs !== 653) throw new Error('Step write pending'); });
  check(ad.documentElement.scrollWidth <= 360, 'audio view fits 360px without horizontal scrolling');
  ad.querySelector('#audioBackButton').click();
  ad.querySelector('#configButton').click();
  check(ad.querySelector('#audioToggleKeyButton').textContent === 'Not set', 'new audio shortcuts start unassigned');
  check(ad.querySelector('.shortcut-scope').textContent.includes('Shared shortcuts')
    && ad.querySelector('.audio-config-label').textContent === 'Audio sync', 'configuration distinguishes shared bindings from tab-local actions');
  ad.querySelector('#audioToggleKeyButton').click();
  for (const type of ['keydown', 'keyup']) ad.dispatchEvent(new ap.contentWindow.KeyboardEvent(type, { code: 'KeyJ', bubbles: true, cancelable: true }));
  await waitFor(async () => { if ((await browser.storage.sync.get('hotkeys')).hotkeys.audioToggle !== 'KeyJ') throw new Error('Audio binding pending'); });
  await press(audio.id, 'KeyJ');
  await waitFor(async () => { if ((await audioState()).enabled) throw new Error('Audio toggle pending'); });
  check((await audioState()).delayMs === 653, 'audio hotkey turns correction Off without losing selected delay');
  const untouched = await page(async () => {
    const before = window.__audioTest.nodes.length;
    const newAudio = document.createElement('audio'); newAudio.src = '/tone.wav'; newAudio.preload = 'auto'; document.body.append(newAudio);
    await new Promise(resolve => setTimeout(resolve, 1400));
    return window.__audioTest.nodes.length === before;
  });
  check(untouched, 'new players remain native after correction is switched Off');
  check(ad.documentElement.scrollWidth <= 360, 'six-key configuration fits popup width');
  __DIALOGUE_TESTS__
  await audioRequest('SET', { delayMs: 222 });
  await browser.tabs.reload(audio.id);
  await waitFor(async () => {
    const s = await audioState();
    const status = await audioStatus();
    if (s.delayMs !== 222 || s.enabled || s.dialogueEnabled || s.dialogueMix !== 37 || !status.frames.length || !status.frames.every(f => f.contextState === 'native')) throw new Error('Reload state not settled: ' + JSON.stringify(status));
  });
  check(true, 'Off and exact delay survive reload, restoring native audio');
  // Reload test has paused media, so no sound can escape the discarded instrumentation.
  await audioRequest('ENABLE', { enabled: true });
  await request(audio.id, 'DIALOGUE_ENABLE', { enabled: true });
  await browser.tabs.reload(audio.id);
  await waitFor(async () => {
    const s = await audioState();
    const status = await audioStatus();
    if (!s.enabled || s.delayMs !== 222 || !s.dialogueEnabled || s.dialogueMix !== 37 || status.frames.reduce((n, f) => n + (f.dialogueConnected || 0), 0) < 3 || status.frames.reduce((n, f) => n + (f.connected || 0), 0) < 3) throw new Error('Enabled reload not settled');
  });
  check(true, 'enabled Audio Sync and RNNoise with exact delay/mix survive a real Firefox reload');
  await page(() => history.pushState({}, '', '/audio?route=next'));
  await waitFor(async () => { const s = await audioState(); if (s.enabled || s.delayMs !== 0 || s.dialogueEnabled || s.dialogueMix !== 100) throw new Error('SPA reset pending'); });
  check(true, 'different SPA route resets correction to Off at zero');
  await audioRequest('SET', { delayMs: 500 });
  await browser.tabs.update(audio.id, { url: origin + '/audio?new-page' });
  await waitFor(async () => { const s = await audioState(); if (s.delayMs !== 0 || s.enabled) throw new Error('Navigation reset pending'); });
  check(true, 'different full-page navigation resets only audio settings');
  await audioRequest('SET', { delayMs: 400 });
  await browser.tabs.goBack(audio.id);
  await waitFor(async () => { const s = await audioState(); if (s.delayMs !== 0 || s.enabled) throw new Error('Back navigation reset pending'); });
  check(true, 'back navigation resets audio rather than reviving the old correction');
  await browser.tabs.remove([audio.id, audioOther.id]);
})();
