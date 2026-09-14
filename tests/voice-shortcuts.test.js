const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const {createHarness,settle,readSource,FakeElement} = require("./harness");
const send=(h,type,values={},tabId=1)=>h.request({type,tabId,...values});

test("six-key upgrades preserve old bindings and add three unassigned Voice Clarity actions", async()=>{
  const c=vm.createContext({});vm.runInContext(readSource("shared/shortcuts.js"),c);
  const u=c.VideoSpeedShortcuts;
  const old={toggle:"KeyT",increase:"KeyU",decrease:null,audioToggle:"KeyA",audioIncrease:"KeyB",audioDecrease:"KeyC"};
  const next=JSON.parse(JSON.stringify(u.normalizeHotkeys(old)));
  assert.deepEqual(next,{...old,dialogueToggle:null,dialogueIncrease:null,dialogueDecrease:null});
  assert.equal(u.ACTIONS.length,9);
  assert.throws(()=>u.assignHotkey(next,"dialogueToggle","KeyA"),/already assigned/);
  assert.equal(u.normalizeHotkeys({...next,dialogueIncrease:"KeyU"}).dialogueIncrease,null);
  assert.equal(u.normalizeHotkeys({...next,dialogueToggle:"KeyV",dialogueIncrease:"KeyV"}).dialogueIncrease,null);
  const h=createHarness();await settle();
  const raced=await Promise.allSettled([send(h,"VIDEO_SPEED_SET_HOTKEY",{action:"dialogueToggle",code:"KeyV"}),send(h,"VIDEO_SPEED_SET_HOTKEY",{action:"audioToggle",code:"KeyV"})]);
  assert.equal(raced[0].status,"fulfilled");assert.equal(raced[1].status,"rejected");
  await assert.rejects(h.request({type:"VIDEO_SPEED_SET_HOTKEY",action:"dialogueIncrease",code:"KeyX"},{tab:{id:1},url:"https://example.com"}),/extension pages/);
});

test("Voice Clarity toggles and nudges are atomic, bounded and preserve mix, delay and run token semantics",async()=>{
  const h=createHarness();
  await send(h,"AUDIO_SYNC_SET",{delayMs:750});await send(h,"AUDIO_SYNC_ENABLE",{enabled:true});
  await send(h,"DIALOGUE_MIX",{mix:55});
  await Promise.all(Array.from({length:3},()=>send(h,"DIALOGUE_NUDGE",{direction:1})));
  let s=await send(h,"AUDIO_SYNC_GET");assert.equal(s.dialogueMix,85);assert.equal(s.dialogueEnabled,false);
  assert.equal(s.dialogueRun,0);assert.equal(s.delayMs,750);assert.equal(s.enabled,true);
  await Promise.all(Array.from({length:12},()=>send(h,"DIALOGUE_NUDGE",{direction:1})));
  assert.equal((await send(h,"AUDIO_SYNC_GET")).dialogueMix,100);
  await Promise.all(Array.from({length:12},()=>send(h,"DIALOGUE_NUDGE",{direction:-1})));
  assert.equal((await send(h,"AUDIO_SYNC_GET")).dialogueMix,0);
  await send(h,"DIALOGUE_TOGGLE");s=await send(h,"AUDIO_SYNC_GET");const run=s.dialogueRun;
  assert.equal(s.dialogueEnabled,true);assert.equal(run,s.revision);
  await send(h,"DIALOGUE_NUDGE",{direction:1});assert.equal((await send(h,"AUDIO_SYNC_GET")).dialogueRun,run);
  await Promise.all([send(h,"DIALOGUE_TOGGLE"),send(h,"DIALOGUE_TOGGLE")]);
  s=await send(h,"AUDIO_SYNC_GET");assert.equal(s.dialogueEnabled,true);assert.ok(s.dialogueRun>run);assert.equal(s.dialogueMix,10);
  for(const direction of [0,10,-10,"1",null,NaN])await assert.rejects(send(h,"DIALOGUE_NUDGE",{direction}));
  const before=await send(h,"AUDIO_SYNC_GET");h.failSessions=true;await assert.rejects(send(h,"DIALOGUE_TOGGLE"));h.failSessions=false;
  assert.deepEqual(await send(h,"AUDIO_SYNC_GET"),before);
  await h.request({type:"DIALOGUE_NUDGE",tabId:2,direction:1},{tab:{id:1},url:"https://example.com"});
  assert.equal((await send(h,"AUDIO_SYNC_GET")).dialogueMix,20);
  assert.equal((await send(h,"AUDIO_SYNC_GET",{},2)).dialogueMix,100);
  h.restartBackground();await h.navigate(1,"https://example.com/1","reload");assert.equal((await send(h,"AUDIO_SYNC_GET")).dialogueMix,20);
  await h.navigate(1,"https://example.com/new");s=await send(h,"AUDIO_SYNC_GET");assert.equal(s.dialogueEnabled,false);assert.equal(s.dialogueMix,100);
});

test("Voice Clarity physical-code routing is tab-local, ignores typing/modifiers/IME and persists assignments",async()=>{
  const h=createHarness(),a=h.createFrame(1),b=h.createFrame(2);await settle();
  for(const [action,code] of [["dialogueToggle","KeyV"],["dialogueIncrease","KeyB"],["dialogueDecrease","KeyC"]])await send(h,"VIDEO_SPEED_SET_HOTKEY",{action,code});
  for(const override of [{repeat:true},{isComposing:true},{ctrlKey:true},{altKey:true},{metaKey:true},{shiftKey:true},{target:new FakeElement("input")},{target:new FakeElement("textarea")},{composedPath(){const x=new FakeElement("div");x.isContentEditable=true;return[x];}}])assert.equal(a.dispatchKey({code:"KeyV",...override}).defaultPrevented,false);
  a.dispatchKey({code:"KeyC"});a.dispatchKey({code:"KeyC"});await settle();
  assert.equal(h.audioSessions.get(1).dialogueMix,80);assert.equal(h.audioSessions.get(1).dialogueEnabled,false);
  a.dispatchKey({code:"KeyV"});b.dispatchKey({code:"KeyC"});await settle();
  assert.equal(h.audioSessions.get(1).dialogueEnabled,true);assert.equal(h.audioSessions.get(2).dialogueEnabled,false);assert.equal(h.audioSessions.get(2).dialogueMix,90);
  a.dispatchKey({code:"KeyB"});await settle();assert.equal(h.audioSessions.get(1).dialogueMix,90);
  assert.equal(h.sessions.get(1).speed,2,"not misrouted as speed decrease");
  h.restartBackground();const p=h.createPopup(1);await settle();assert.equal(p.elements.dialogueToggleKeyButton.textContent,"V");
  await h.storage.sync.set({hotkeys:{...h.storedValues.hotkeys,dialogueToggle:null}});assert.equal(a.dispatchKey({code:"KeyV"}).defaultPrevented,false);
});

test("real isolated bridge sends atomic Voice Clarity actions quietly and rejects unknown actions",async()=>{
  const events=new Map(),requests=[];let rejectWrite=false,toastAttempts=0;
  const window={postMessage(m){for(const f of events.get("message")||[])f({source:window,data:{source:"video-speed-audio-v1",direction:"from-page",id:m.id,ok:true,status:{contextState:"running"}}});}};
  const context=vm.createContext({window,setTimeout,clearTimeout,document:{getElementById(){toastAttempts++;throw Error("Voice Clarity must not show a toast");}},addEventListener(n,f){events.set(n,[...(events.get(n)||[]),f]);},browser:{runtime:{getURL:p=>"moz-extension://test/"+p,onMessage:{addListener(){}},async sendMessage(m){requests.push(m);if(rejectWrite)throw Error("private failure");return {revision:requests.length,dialogueEnabled:true,dialogueMix:50};}}}});
  vm.runInContext(readSource("shared/audio.js"),context);vm.runInContext(readSource("content/audio-bridge.js"),context);await settle();requests.length=0;
  for(const a of ["dialogueToggle","dialogueIncrease","dialogueDecrease"])context.VideoAudioBridge.act(a);
  await settle();assert.deepEqual(JSON.parse(JSON.stringify(requests)),[{type:"DIALOGUE_TOGGLE"},{type:"DIALOGUE_NUDGE",direction:1},{type:"DIALOGUE_NUDGE",direction:-1}]);
  const n=requests.length;context.VideoAudioBridge.act("bogus");context.VideoAudioBridge.act("toString");await settle();assert.equal(requests.length,n);
  rejectWrite=true;context.VideoAudioBridge.act("dialogueToggle");await settle();assert.equal(toastAttempts,0);
});
