import createRNNWasmModuleSync from "./vendor/rnnoise/rnnoise-sync.js";
import "./dialogue-core.js";

// One WASM heap/model per frame's AudioWorkletGlobalScope, not per media/channel.
const rnnoise = createRNNWasmModuleSync();
class VideoDialogueProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    if (sampleRate !== 48000) throw new Error("Dialogue focus requires a 48 kHz audio context");
    this.dsp = new globalThis.VideoDialogueDSP(rnnoise);
    this.dsp.targetMix = this.dsp.mix = (options.processorOptions?.mix ?? 100) / 100;
    this.volume = 1;
    this.playing = false;
    this.failed = false;
    this.disposed = false;
    this.port.onmessage = ({ data: m }) => {
      if (this.disposed) return;
      try {
        if (m.type === "dispose") {
          this.dsp.dispose();
          this.disposed = true;
          this.port.close();
          return;
        }
        if (m.type === "mix" && Number.isInteger(m.value) && m.value >= 0 && m.value <= 100) this.dsp.targetMix = m.value / 100;
        if (m.type === "volume" && Number.isFinite(m.value) && m.value >= 0 && m.value <= 1) {
          if ((this.volume === 0) !== (m.value === 0)) this.dsp.reset();
          this.volume = m.value;
        }
        if (m.type === "stop" || m.type === "start") {
          this.dsp.reset();
          this.playing = m.type === "start";
        }
      } catch (error) { this.fail(error); }
    };
    this.port.postMessage({ type: "ready" });
  }
  fail(error) {
    if (this.failed) return;
    this.failed = true;
    this.port.postMessage({ type: "failed", error: String(error.message || error).slice(0, 200) });
  }
  process(inputs, outputs) {
    if (this.disposed) return false;
    const input = inputs[0] || [];
    const output = outputs[0] || [];
    if (!output.length) return true;
    if (!this.playing || !this.volume) {
      for (const channel of output) channel.fill(0);
      return true;
    }
    if (!this.failed) {
      try { this.dsp.process(input, output, this.volume); return true; }
      catch (error) { this.fail(error); }
    }
    // Immediate fail-open in the render callback, before the page can rewire the
    // graph. The page then bypasses this node while retaining Audio Sync's delay.
    for (let c = 0; c < output.length; c++) {
      const source = input[c] || input[0];
      if (source) output[c].set(source); else output[c].fill(0);
    }
    return true;
  }
}
registerProcessor("video-dialogue-focus", VideoDialogueProcessor);
