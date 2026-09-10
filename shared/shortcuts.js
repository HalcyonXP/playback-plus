(() => {
  "use strict";

  const HOTKEYS_KEY = "hotkeys";
  const DEFAULT_HOTKEYS = Object.freeze({ toggle: "Numpad0", increase: "NumpadAdd", decrease: "NumpadSubtract",
    audioToggle: null, audioIncrease: null, audioDecrease: null });
  const ACTIONS = Object.freeze(Object.keys(DEFAULT_HOTKEYS));

  // Physical codes distinguish the numpad and work with Num Lock off.
  function isHotkeyCode(code) {
    return typeof code === "string"
      && /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|Numpad(Add|Subtract|Decimal|Divide|Multiply|Enter)|F([1-9]|1[0-9]|2[0-4])|Space|Enter|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Arrow(Up|Down|Left|Right)|Equal|Minus|Backquote|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|IntlBackslash|IntlRo|IntlYen)$/.test(code);
  }

  function normalizeHotkeys(value) {
    const result = {};
    const used = new Set();
    for (const action of ACTIONS) {
      const raw = value?.[action];
      let code = raw === null ? null : isHotkeyCode(raw) ? raw : DEFAULT_HOTKEYS[action];
      // Malformed/imported Sync data must never trigger two actions at once.
      if (used.has(code)) code = null;
      result[action] = code;
      if (code !== null) used.add(code);
    }
    return result;
  }

  function assignHotkey(current, action, code) {
    if (!ACTIONS.includes(action) || (code !== null && !isHotkeyCode(code))) {
      throw new Error("Unsupported hotkey");
    }
    const next = normalizeHotkeys(current);
    if (code !== null && ACTIONS.some(other => other !== action && next[other] === code)) {
      throw new Error("That key is already assigned to another action");
    }
    next[action] = code;
    return next;
  }

  function formatHotkey(code) {
    const labels = { NumpadAdd: "Num +", NumpadSubtract: "Num −", NumpadMultiply: "Num *",
      NumpadDivide: "Num /", NumpadDecimal: "Num .", Equal: "= / +", Minus: "− / _",
      Backquote: "`", BracketLeft: "[", BracketRight: "]", Backslash: "\\",
      Semicolon: ";", Quote: "'", Comma: ",", Period: "." };
    if (code === null) return "Not set";
    return labels[code] ?? code.replace(/^Key|^Digit/, "").replace(/^Numpad/, "Num ")
      .replace(/([a-z])([A-Z])/g, "$1 $2");
  }

  function hasUnsupportedModifiers(event) {
    return event.altKey || event.ctrlKey || event.metaKey
      || (event.shiftKey && event.code !== "Equal" && event.code !== "Minus");
  }

  // Subscribe before reading. Neither a slow read nor BFCache refresh can undo
  // newer Sync delivery. Only hotkeys are global; tab speeds remain independent.
  function observeHotkeys(onChange) {
    let generation = 0;
    browser.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && Object.hasOwn(changes, HOTKEYS_KEY)) {
        generation++;
        onChange(normalizeHotkeys(changes[HOTKEYS_KEY].newValue));
      }
    });
    return {
      async refresh() {
        const before = ++generation;
        const stored = await browser.storage.sync.get(HOTKEYS_KEY);
        if (before === generation) onChange(normalizeHotkeys(stored[HOTKEYS_KEY]));
      }
    };
  }

  globalThis.VideoSpeedShortcuts = Object.freeze({
    HOTKEYS_KEY, DEFAULT_HOTKEYS, ACTIONS, isHotkeyCode, normalizeHotkeys,
    assignHotkey, formatHotkey, hasUnsupportedModifiers, observeHotkeys
  });
})();
