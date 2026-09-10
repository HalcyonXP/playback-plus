/* RNNoise 0.2 streaming adapter. No speech gate or automatic gain boost.
 * 48 kHz, 480-sample frames. The pinned model has 960 samples of algorithmic
 * delay; framing adds 480. Align the dry branch by the same 1440 samples.
 */
(() => {
  "use strict";
  const FRAME = 480;
  const LATENCY = 1440;
  class DialogueDSP {
    constructor(module) {
      this.module = module;
      this.states = [];
      this.pointer = 0;
      this.position = 0;
      this.dryPosition = 0;
      this.mix = 1;
      this.targetMix = 1;
      this.input = [new Float32Array(FRAME), new Float32Array(FRAME)];
      this.wet = [new Float32Array(FRAME), new Float32Array(FRAME)];
      this.dry = [new Float32Array(LATENCY), new Float32Array(LATENCY)];
      try {
        this.pointer = module._malloc(FRAME * 4);
        if (!this.pointer) throw new Error("RNNoise sample allocation failed");
        for (let c = 0; c < 2; c++) {
          const state = module._rnnoise_create(0);
          if (!state) throw new Error("RNNoise state allocation failed");
          this.states.push(state);
        }
      } catch (error) { this.dispose(); throw error; }
    }
    reset() {
      this.position = this.dryPosition = 0;
      for (const buffers of [this.input, this.wet, this.dry]) for (const b of buffers) b.fill(0);
      for (const state of this.states) this.module._rnnoise_init(state, 0);
      this.mix = this.targetMix;
    }
    dispose() {
      for (const state of this.states) this.module._rnnoise_destroy(state);
      this.states = [];
      if (this.pointer) this.module._free(this.pointer);
      this.pointer = 0;
    }
    process(input, output, volume) {
      const count = output[0].length;
      for (let i = 0; i < count; i++) {
        // Approximately 10 ms smoothing. Both branches have identical time alignment.
        this.mix += (this.targetMix - this.mix) / 480;
        for (let c = 0; c < 2; c++) {
          const raw = (input[c]?.[i] ?? input[0]?.[i] ?? 0) / volume;
          const sample = Number.isFinite(raw) ? Math.max(-1, Math.min(1, raw)) : 0;
          const dry = this.dry[c][this.dryPosition];
          this.dry[c][this.dryPosition] = sample;
          this.input[c][this.position] = sample * 32768;
          const value = dry * (1 - this.mix) + this.wet[c][this.position] * this.mix;
          if (output[c]) output[c][i] = Math.max(-1, Math.min(1, value)) * volume;
        }
        this.dryPosition = (this.dryPosition + 1) % LATENCY;
        if (++this.position === FRAME) {
          this.position = 0;
          for (let c = 0; c < 2; c++) {
            // Reacquire the view: Emscripten may grow memory during an allocation.
            this.module.HEAPF32.set(this.input[c], this.pointer >>> 2);
            this.module._rnnoise_process_frame(this.states[c], this.pointer, this.pointer);
            const heap = this.module.HEAPF32;
            for (let j = 0; j < FRAME; j++) {
              const value = heap[(this.pointer >>> 2) + j] / 32768;
              if (!Number.isFinite(value)) throw new Error("RNNoise returned invalid samples");
              this.wet[c][j] = value;
            }
          }
        }
      }
    }
  }
  globalThis.VideoDialogueDSP = DialogueDSP;
})();
