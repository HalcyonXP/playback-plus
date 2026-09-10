/* Output-time delay. No dependencies and no network access. */
"use strict";
class VideoAudioDelayProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions || {};
    this.maxFrames = Math.min(Math.ceil(sampleRate * 5), Math.max(0, Math.round(o.maxFrames || 0)));
    this.length = this.maxFrames + 256;
    this.buffers = [];
    this.position = 0;
    this.delayFrames = 0;
    this.volume = 1;
    this.playing = false;
    this.port.onmessage = ({ data: m }) => {
      if (!m) return;
      if (m.type === "delay" && Number.isFinite(m.frames)) this.delayFrames = Math.max(0, Math.min(this.maxFrames, Math.round(m.frames)));
      if (m.type === "volume" && Number.isFinite(m.value)) this.volume = Math.max(0, Math.min(1, m.value));
      if (m.type === "stop" || m.type === "start" || m.type === "flush") {
        for (const buffer of this.buffers) buffer.fill(0);
        this.position = 0;
        this.playing = m.type === "start";
      }
    };
  }
  process(inputs, outputs) {
    const input = inputs[0] || [];
    const output = outputs[0] || [];
    const count = output[0]?.length || 128;
    while (this.buffers.length < output.length) this.buffers.push(new Float32Array(this.length));
    // Sample-by-sample writing supports delays shorter than a render quantum.
    for (let i = 0; i < count; i++) {
      const read = (this.position - this.delayFrames + this.length) % this.length;
      for (let c = 0; c < output.length; c++) {
        const buffer = this.buffers[c];
        // Firefox's MediaElementAudioSourceNode already applies the element's
        // volume/mute before this node. Store level-normalized samples, then
        // apply the CURRENT volume at output so delayed samples react immediately
        // without multiplying the player's volume twice. Muted input cannot be
        // recovered; unmuting may need to refill the delay.
        const raw = this.volume > 0 ? (input[c]?.[i] || 0) / this.volume : 0;
        buffer[this.position] = this.playing ? Math.max(-1, Math.min(1, raw)) : 0;
        output[c][i] = this.playing ? buffer[read] * this.volume : 0;
      }
      this.position = (this.position + 1) % this.length;
    }
    return true;
  }
}
registerProcessor("video-audio-delay", VideoAudioDelayProcessor);
