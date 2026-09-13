const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");

const ROOT = resolve(__dirname, "..");
const readSource = (path) => readFileSync(resolve(ROOT, path), "utf8");
const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
async function settle() {
  for (let i = 0; i < 5; i++) {
    await new Promise((done) => setImmediate(done));
  }
}
function event() {
  const listeners = [];
  return {
    listeners,
    addListener(listener) { listeners.push(listener); },
    emit(...args) { return Promise.all(listeners.map((listener) => listener(...args))); }
  };
}
function run(path, globals) {
  const context = vm.createContext(globals);
  vm.runInContext(readSource("shared/speed.js"), context);
  vm.runInContext(readSource("shared/shortcuts.js"), context);
  vm.runInContext(readSource("shared/audio.js"), context);
  vm.runInContext(readSource("background/audio.js"), context);
  vm.runInContext(readSource(path), context, { filename: path });
  return context;
}

class FakeElement {
  constructor(localName) {
    Object.assign(this, {
      nodeType: 1, localName, children: [], shadowRoot: null,
      listeners: new Map(), isContentEditable: false, dataset: {}, attributes: {},
      classList: { toggle() {}, remove() {} }, style: { setProperty() {} }
    });
  }
  focus() { this.focused = true; }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  dispatch(type, fields = {}) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ type, currentTarget: this, ...fields });
    }
  }
  querySelectorAll(selector) {
    const matches = [];
    for (const child of this.children) {
      if (selector === "*" || selector.split(", ").includes(child.localName)) {
        matches.push(child);
      }
      matches.push(...child.querySelectorAll(selector));
    }
    return matches;
  }
}
class FakeMedia extends FakeElement {
  constructor(type = "video") {
    super(type);
    this.playbackRate = 1;
    this.defaultPlaybackRate = 1;
  }
}

function createHarness({ defaults = { playbackSpeed: 2, lastNon1xSpeed: 2 }, tabs = [1, 2], sessions = new Map() } = {}) {
  const storedValues = { ...defaults };
  const audioSessions = new Map();
  const urls = new Map(tabs.map(id => [id, `https://example.com/${id}`]));
  const navigation = { onCommitted: event(), onHistoryStateUpdated: event(), onReferenceFragmentUpdated: event() };
  const tabIds = new Set(tabs);
  const frames = new Map();
  const popupListeners = event();
  const writes = [];
  const publications = [];
  const warnings = [];
  const storageChanges = event();
  const storage = {
    onChanged: storageChanges,
    sync: {
      async get() {
        if (harness.failRead) throw new Error("Storage unavailable");
        return clone(storedValues);
      },
      async set(values) {
        if (harness.failSync) throw new Error("Sync unavailable");
        const changes = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, {
          oldValue: clone(storedValues[key]), newValue: clone(value)
        }]));
        Object.assign(storedValues, clone(values));
        writes.push(clone(values));
        await storageChanges.emit(changes, "sync");
      },
      async remove(key) {
        const oldValue = clone(storedValues[key]);
        delete storedValues[key];
        await storageChanges.emit({ [key]: { oldValue } }, "sync");
      }
    }
  };
  let backgroundMessages;
  let installed;
  let created;
  const backgroundStorageListeners = new Set();
  const harness = {
    storedValues, sessions, audioSessions, writes, publications, warnings, storage,
    audioReports: new Map(),
    async navigate(tabId, url, transitionType = "link", kind = "onCommitted") {
      urls.set(tabId, url);
      await navigation[kind].emit({ tabId, url, frameId: 0, transitionType });
      await settle();
    },
    activeTab: tabs[0], failSync: false, failSessions: false,
    async request(message, sender = {}) {
      for (const listener of backgroundMessages.listeners) {
        const response = listener(clone(message), sender);
        if (response !== undefined) return clone(await response);
      }
      return undefined;
    },
    install() { return installed.emit(); },
    async createTab(id, restoredState) {
      tabIds.add(id);
      urls.set(id, `https://example.com/${id}`);
      if (restoredState) sessions.set(id, clone(restoredState));
      await created.emit({ id });
    },
    closeTab(id) {
      tabIds.delete(id);
      frames.delete(id);
      sessions.delete(id);
      audioSessions.delete(id);
    },
    restartBackground() {
      for (const listener of backgroundStorageListeners) {
        const index = storageChanges.listeners.indexOf(listener);
        if (index >= 0) storageChanges.listeners.splice(index, 1);
      }
      backgroundStorageListeners.clear();
      backgroundMessages = event();
      installed = event();
      created = event();
      for (const e of Object.values(navigation)) e.listeners.length = 0;
      run("background/background.js", {
        setTimeout, clearTimeout,
        console: { warn(...args) { warnings.push(args); } },
        browser: {
          runtime: {
            onInstalled: installed, onMessage: backgroundMessages,
            getURL(path) { return `moz-extension://test-extension/${path}`; },
            sendMessage(message) { return popupListeners.emit(clone(message)); }
          },
          storage: { ...storage, onChanged: { addListener(listener) {
            backgroundStorageListeners.add(listener);
            storageChanges.addListener(listener);
          } } },
          webNavigation: { ...navigation, async getAllFrames({ tabId }) { return (frames.get(tabId) || []).map((_, frameId) => ({ frameId })); } },
          sessions: {
            async getTabValue(id, key) {
              if (!tabIds.has(id)) throw new Error("Tab closed");
              if (key === "videoAudioState") return clone(audioSessions.get(id));
              if (key !== "videoSpeedState") throw new Error("Wrong session key");
              return clone(sessions.get(id));
            },
            async setTabValue(id, key, state) {
              if (!tabIds.has(id) || harness.failSessions) throw new Error("Session write failed");
              if (key === "videoAudioState") { audioSessions.set(id, clone(state)); return; }
              if (key !== "videoSpeedState") throw new Error("Wrong session key");
              sessions.set(id, clone(state));
            }
          },
          tabs: {
            onCreated: created,
            async get(id) { if (!tabIds.has(id)) throw new Error("Tab closed"); return { id, url: urls.get(id) }; },
            async query(query) {
              return query.active ? (tabIds.has(harness.activeTab) ? [{ id: harness.activeTab }] : [])
                : [...tabIds].map((id) => ({ id }));
            },
            async sendMessage(tabId, message, options) {
              publications.push({ tabId, message: clone(message) });
              if (message.type === "AUDIO_SYNC_STATUS") {
                const state = audioSessions.get(tabId);
                return { ...state, media: 1, eligible: 1, connected: state?.enabled || state?.dialogueEnabled ? 1 : 0, dialogueConnected: state?.dialogueEnabled ? 1 : 0, contextState: state?.enabled || state?.dialogueEnabled ? "running" : "native", ...(harness.audioReports.get(tabId) || {}) };
              }
              if (options) return frames.get(tabId)?.[options.frameId]?.message(message);
              return Promise.all((frames.get(tabId) ?? []).map((frame) => frame.message(message)));
            }
          }
        }
      });
    },
    createFrame(tabId) {
      const document = new FakeElement("#document");
      document.nodeType = 9;
      const messages = event();
      const events = new Map();
      const observers = [];
      class MutationObserver {
        constructor(callback) { this.callback = callback; this.observed = []; observers.push(this); }
        observe(root) { this.observed.push(root); }
      }
      const frame = {
        document, observers,
        async message(message) {
          for (const listener of messages.listeners) {
            const result = listener(clone(message));
            if (result !== undefined) return clone(await result);
          }
          return undefined;
        },
        addNode(node) {
          document.appendChild(node);
          observers[0].callback([{ addedNodes: [node] }]);
          return node;
        },
        pageshow() { for (const listener of events.get("pageshow") ?? []) listener({ persisted: true }); },
        dispatchKey(overrides = {}) {
          const key = {
            code: "Numpad0", repeat: false, isComposing: false,
            altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
            target: new FakeElement("div"), defaultPrevented: false, propagationStopped: false,
            composedPath() { return [this.target]; },
            preventDefault() { this.defaultPrevented = true; },
            stopImmediatePropagation() { this.propagationStopped = true; },
            ...overrides
          };
          for (const listener of events.get("keydown") ?? []) listener(key);
          return key;
        }
      };
      frames.set(tabId, [...(frames.get(tabId) ?? []), frame]);
      run("content/content.js", {
        console, document, MutationObserver, Node: { ELEMENT_NODE: 1 },
        VideoAudioBridge: { act(action) { void harness.request(action === "audioToggle" ? { type: "AUDIO_SYNC_TOGGLE" } : { type: "AUDIO_SYNC_NUDGE", direction: action === "audioIncrease" ? 1 : -1 }, { tab: { id: tabId } }); } },
        addEventListener(type, listener) {
          events.set(type, [...(events.get(type) ?? []), listener]);
        },
        browser: { storage, runtime: {
          onMessage: messages,
          sendMessage(message) { return harness.request(message, { tab: { id: tabId } }); }
        } }
      });
      return frame;
    },
    createPopup(tabId = harness.activeTab) {
      const ids = ["saveDefault", "defaultSpeed", "availability", "availabilityText", "speedValue", "speedRange", "decreaseButton", "increaseButton", "alternateValue", "notice", "toggleKeyButton", "increaseKeyButton", "decreaseKeyButton", "hotkeyHint", "hotkeyFeedback", "mainView", "configView", "configButton", "backButton", "audioView", "audioToggleKeyButton", "audioIncreaseKeyButton", "audioDecreaseKeyButton", "audioButton", "audioSummary", "audioBackButton", "audioEnabled", "audioValue", "audioExact", "audioDecrease", "audioIncrease", "audioReset", "audioStatus", "audioError", "dialogueButton", "dialogueSummary", "dialogueView", "dialogueBackButton", "dialogueEnabled", "dialogueMix", "dialogueValue", "dialogueStatus", "dialogueError"];
      const elements = Object.fromEntries(ids.map((id) => [id, new FakeElement("div")]));
      elements.hotkeyHint.textContent = readSource("popup/popup.html").match(/<p id="hotkeyHint"[^>]*>([^<]+)<\/p>/)[1];
      const presets = [0.5, 1, 1.5, 2, 2.5, 3].map((speed) => {
        const button = new FakeElement("button");
        button.dataset.speed = String(speed);
        return button;
      });
      elements.configView.hidden = true;
      elements.audioView.hidden = true;
      elements.dialogueView.hidden = true;
      const document = new FakeElement("#document");
      document.querySelector = selector => elements[selector.slice(1)];
      document.getElementById = id => elements[id];
      document.querySelectorAll = () => presets;
      const popupContext = run("popup/popup.js", {
        console,
        matchMedia() { return { matches: true, addEventListener() {} }; },
        requestAnimationFrame() { return 1; }, cancelAnimationFrame() {},
        setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {}, addEventListener() {},
        document,
        browser: {
          storage,
          runtime: { onMessage: popupListeners, sendMessage(message) { return harness.request(message, { url: "moz-extension://test-extension/popup/popup.html" }); } },
          tabs: {
            async query() { return [{ id: tabId }]; },
            async sendMessage(id, message) {
              const frame = frames.get(id)?.[0];
              if (!frame) throw new Error("Protected page or no content script");
              return frame.message(message);
            }
          }
        }
      });
      vm.runInContext(readSource("popup/audio.js"), popupContext, { filename: "popup/audio.js" });
      return { elements, presets, dispatchKey(overrides = {}, type = "keydown") {
        const key = {
          code: "KeyK", repeat: false, isComposing: false,
          altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
          defaultPrevented: false, propagationStopped: false,
          preventDefault() { this.defaultPrevented = true; },
          stopImmediatePropagation() { this.propagationStopped = true; },
          ...overrides
        };
        // Preserve the object so tests can inspect preventDefault effects.
        for (const listener of document.listeners.get(type) ?? []) listener(key);
        return key;
      } };
    }
  };
  harness.restartBackground();
  return harness;
}

module.exports = { readSource, run, settle, FakeElement, FakeMedia, createHarness };
