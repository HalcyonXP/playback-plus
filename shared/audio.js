(() => {
  "use strict";
  const MAX_DELAY_MS = 5000;
  const STEP_MS = 500;
  function delay(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error("Enter a finite delay in milliseconds");
    return Math.max(0, Math.min(MAX_DELAY_MS, Math.round(number)));
  }
  function normalize(value = {}) {
    return {
      enabled: value.enabled === true,
      delayMs: Number.isFinite(value.delayMs) ? delay(value.delayMs) : 0,
      dialogueEnabled: value.dialogueEnabled === true,
      dialogueRun: Number.isSafeInteger(value.dialogueRun) && value.dialogueRun >= 0 ? value.dialogueRun : 0,
      dialogueMix: Number.isInteger(value.dialogueMix) && value.dialogueMix >= 0 && value.dialogueMix <= 100 ? value.dialogueMix : 100,
      revision: Number.isSafeInteger(value.revision) && value.revision >= 0 ? value.revision : 0,
      pageUrl: typeof value.pageUrl === "string" ? value.pageUrl : ""
    };
  }
  function transition(current, message) {
    const next = normalize(current);
    switch (message.type) {
      case "AUDIO_SYNC_SET": next.delayMs = delay(message.delayMs); break;
      case "AUDIO_SYNC_NUDGE":
        if (message.direction !== 1 && message.direction !== -1) throw new Error("Invalid audio adjustment");
        next.delayMs = delay(next.delayMs + message.direction * STEP_MS); break;
      case "AUDIO_SYNC_ENABLE":
        if (typeof message.enabled !== "boolean") throw new Error("Invalid correction state");
        next.enabled = message.enabled; break;
      case "AUDIO_SYNC_TOGGLE": next.enabled = !next.enabled; break;
      case "DIALOGUE_ENABLE":
        if (typeof message.enabled !== "boolean") throw new Error("Invalid dialogue state");
        if (message.enabled && !next.dialogueEnabled) next.dialogueRun = next.revision + 1;
        next.dialogueEnabled = message.enabled; break;
      case "DIALOGUE_MIX":
        if (!Number.isInteger(message.mix) || message.mix < 0 || message.mix > 100) throw new Error("Filter mix must be 0–100");
        next.dialogueMix = message.mix; break;
      default: throw new Error("Unknown audio action");
    }
    next.revision++;
    return next;
  }
  globalThis.VideoAudioUtils = Object.freeze({ MAX_DELAY_MS, STEP_MS, delay, normalize, transition });
})();
