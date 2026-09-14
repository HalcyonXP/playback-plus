// Included inside the existing audio smoke's instrumented, silent fixture.
await set(audio.id, 1);
ad.querySelector('#backButton').click();
check(!ad.querySelector('#mainView').hidden && ad.querySelector('#dialogueMix').getClientRects().length
  && ad.querySelector('#audioExact').getClientRects().length, 'Voice Clarity and Audio Sync are on the playback page');
const dialogueHelp = ad.querySelector('#dialogueDetails');
check(dialogueHelp.hidden && ad.querySelector('#dialogueSafety').closest('.info-panel')
  && ad.querySelector('#dialogueSafety').textContent.includes('suddenly louder'), 'dialogue fallback guidance is retained in themed info');
ad.querySelector('#dialogueInfo').click();
check(!dialogueHelp.hidden && ad.documentElement.scrollWidth <= 360, 'dialogue info fits the popup width');
ad.querySelector('#dialogueInfo').click();
const dialogue = (type, fields = {}) => request(audio.id, 'DIALOGUE_' + type, fields);
// Assign all new shortcuts through the actual popup, then dispatch physical codes in the page.
ad.querySelector('#configButton').click();
check(ad.querySelectorAll('.hotkey-button').length === 9 && !ad.querySelector('.config-note'), 'nine-key Familiar list has no bottom Voice Clarity note');
for (const [action, code] of [['Toggle','KeyV'],['Increase','KeyB'],['Decrease','KeyC']]) {
  const button = ad.querySelector('#dialogue' + action + 'KeyButton');
  check(button.textContent === 'Not set', 'Voice Clarity ' + action + ' shortcut starts unassigned');
  button.click();
  for (const type of ['keydown','keyup']) ad.dispatchEvent(new ap.contentWindow.KeyboardEvent(type,{code,bubbles:true,cancelable:true}));
  await waitFor(async () => { if ((await browser.storage.sync.get('hotkeys')).hotkeys['dialogue'+action] !== code || button.disabled) throw new Error('Voice shortcut save pending'); });
}
await press(audio.id, 'KeyC');
await waitFor(async () => { if ((await audioState()).dialogueMix !== 90) throw new Error('Mix down pending'); });
check(!(await audioState()).dialogueEnabled, 'mix shortcut adjusts by 10 points without enabling filter');
await press(audio.id, 'KeyB');
await waitFor(async () => { if ((await audioState()).dialogueMix !== 100) throw new Error('Mix up pending'); });
check((await request(audioOther.id,'AUDIO_SYNC_GET')).dialogueMix === 100, 'Voice Clarity shortcuts leave the other tab unchanged');
ad.querySelector('#backButton').click();
const mixControl = ad.querySelector('#dialogueMix');
mixControl.value = '0';
mixControl.dispatchEvent(new ap.contentWindow.Event('input', { bubbles: true }));
mixControl.dispatchEvent(new ap.contentWindow.Event('change', { bubbles: true }));
await waitFor(async () => {
  const s = await audioState();
  if (s.dialogueMix !== 0 || ad.querySelector('#dialogueEnabled').disabled) throw new Error('Mix save pending');
  check(!s.dialogueEnabled, 'Filter mix can be selected while Off without enabling RNNoise');
});
await press(audio.id, 'KeyV');
await waitFor(async () => {
  const s = await audioStatus();
  if (s.frames.reduce((n, f) => n + (f.dialogueConnected || 0), 0) < 5) throw new Error('RNNoise not connected: ' + JSON.stringify(s));
  check(!s.state.enabled && s.state.delayMs === 653, 'real RNNoise connects to video/audio, iframe, dynamic and shadow media independently of Audio Sync');
});
check(!(await request(audioOther.id, 'AUDIO_SYNC_GET')).dialogueEnabled, 'RNNoise does not enable another tab');
check(ad.documentElement.scrollWidth <= 360, 'Voice Clarity fits the 360px popup');
const original = await page(async () => {
  const one = document.getElementById('one');
  const entry = window.__audioTest.nodes.find(n => n.name === 'video-dialogue-focus');
  window.__dialogueTestEntry = entry;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const rms = () => { const v = new Float32Array(512); entry.analyser.getFloatTimeDomainData(v); return Math.sqrt(v.reduce((n, x) => n + x*x, 0) / v.length); };
  one.volume = 1; one.currentTime = 0; await one.play(); await wait(500);
  const full = rms();
  one.volume = 0.5; await wait(100); const halfImmediate = rms(); await wait(500); const halfSettled = rms();
  one.muted = true; await wait(100); const muted = rms();
  one.muted = false; one.volume = 1; one.pause(); await wait(100); const paused = rms();
  await one.play(); await wait(500); const resumed = rms();
  return { full, halfImmediate, halfSettled, muted, paused, resumed };
});
check(original.full > 0.1 && original.resumed > 0.1 && original.muted < 0.001 && original.paused < 0.001,
  'real RNNoise original mix passes audio, mute/pause stop it, resume recovers: ' + JSON.stringify(original));
check(original.halfImmediate / original.full > 0.4 && original.halfImmediate / original.full < 0.6
  && original.halfSettled / original.full > 0.4 && original.halfSettled / original.full < 0.6,
  'RNNoise path preserves immediate and settled player volume without double attenuation');
await dialogue('MIX', { mix: 100 });
const filtered = await page(async () => {
  await new Promise(resolve => setTimeout(resolve, 1300));
  const v = new Float32Array(512); window.__dialogueTestEntry.analyser.getFloatTimeDomainData(v);
  return Math.sqrt(v.reduce((n, x) => n + x*x, 0) / v.length);
});
check(Number.isFinite(filtered) && Math.abs(filtered - original.full) > 0.005,
  'real RNNoise changes a generated tone; tonal suppression can be weak: ' + filtered);
await dialogue('MIX', { mix: 0 });
await page(async () => {
  const one = document.getElementById('one');
  one.src = '/noise.wav'; await one.play();
});
const noiseOriginal = await page(async () => {
  await new Promise(resolve => setTimeout(resolve, 600));
  const v = new Float32Array(512); window.__dialogueTestEntry.analyser.getFloatTimeDomainData(v);
  return Math.sqrt(v.reduce((n, x) => n + x*x, 0) / v.length);
});
await dialogue('MIX', { mix: 100 });
const noiseFiltered = await page(async () => {
  await new Promise(resolve => setTimeout(resolve, 1300));
  const v = new Float32Array(512); window.__dialogueTestEntry.analyser.getFloatTimeDomainData(v);
  return Math.sqrt(v.reduce((n, x) => n + x*x, 0) / v.length);
});
check(noiseOriginal > 0.1 && noiseFiltered < noiseOriginal * 0.5,
  'real RNNoise suppresses generated broadband noise (not speech intelligibility): ' + JSON.stringify({ noiseOriginal, noiseFiltered }));
await dialogue('MIX', { mix: 0 });
await set(audio.id, 2);
const fast = await page(async () => {
  await new Promise(resolve => setTimeout(resolve, 500));
  const v = new Float32Array(512); window.__dialogueTestEntry.analyser.getFloatTimeDomainData(v);
  return { rms: Math.sqrt(v.reduce((n, x) => n + x*x, 0) / v.length), rate: document.getElementById('one').playbackRate };
});
check(fast.rate === 2 && fast.rms > 0.1, 'RNNoise pipeline continues at 2x playback');
// Exercise the real engine's processorerror handler, not a test-only runtime API.
await page(() => window.__dialogueTestEntry.node.dispatchEvent(new Event('processorerror')));
await waitFor(async () => {
  const s = await audioStatus();
  if (!s.frames.some(f => f.dialogueFailed > 0 && /unfiltered/.test(f.dialogueError))) throw new Error('Fallback status pending');
});
const fallback = await page(async () => {
  await new Promise(resolve => setTimeout(resolve, 200));
  const v = new Float32Array(512); window.__audioTest.nodes[0].analyser.getFloatTimeDomainData(v);
  document.getElementById('one').pause();
  return Math.sqrt(v.reduce((n, x) => n + x*x, 0) / v.length);
});
check(fallback > 0.1 && (await audioState()).dialogueEnabled, 'processor failure returns real unfiltered samples while retaining requested On state');
check(!ad.querySelector('#audioStatus,#audioError,#dialogueStatus,#dialogueError') && dialogueHelp.hidden,
  'processor failure leaves the popup quiet with on-demand safety guidance retained');
await press(audio.id, 'KeyV');
await waitFor(async () => { if ((await audioState()).dialogueEnabled) throw new Error('Shortcut Off pending'); });
await press(audio.id, 'KeyV');
await waitFor(async () => {
  const s = await audioStatus();
  if (s.frames.some(f => f.dialogueFailed) || s.frames.reduce((n, f) => n + (f.dialogueConnected || 0), 0) < 5) throw new Error('Retry pending: ' + JSON.stringify(s));
});
check(true, 'Voice Clarity shortcut Off/On retries RNNoise successfully after failure');
await dialogue('ENABLE', { enabled: false });
await dialogue('MIX', { mix: 37 });
