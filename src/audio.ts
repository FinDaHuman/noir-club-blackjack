// An original, synthesized lounge arrangement. No external recordings or requests.
class TableAudio {
  private context: AudioContext | null = null;
  private musicGain: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private next = 0;
  private beat = 0;
  effects = true;
  music = true;
  async unlock() {
    try {
      this.context ??= new AudioContext();
      if (!this.musicGain) {
        this.musicGain = this.context.createGain();
        this.musicGain.connect(this.context.destination);
      }
      this.musicGain.gain.value = this.music ? 0.13 : 0;
      if (this.context.state === 'suspended') await this.context.resume();
      if (!this.timer) {
        this.next = this.context.currentTime + 0.08;
        this.timer = setInterval(() => this.schedule(), 100);
      }
      return true;
    } catch {
      return false;
    }
  }
  setMusic(enabled: boolean) {
    this.music = enabled;
    if (this.context && this.musicGain)
      this.musicGain.gain.setTargetAtTime(enabled ? 0.13 : 0, this.context.currentTime, 0.15);
  }
  private tone(
    frequency: number,
    start: number,
    duration: number,
    volume: number,
    output: AudioNode,
    type: OscillatorType = 'sine',
  ) {
    const ctx = this.context!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    osc.connect(gain);
    gain.connect(output);
    osc.start(start);
    osc.stop(start + duration + 0.02);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }
  private noise(
    start: number,
    duration: number,
    volume: number,
    output: AudioNode,
    highpass = 1400,
  ) {
    const ctx = this.context!;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = highpass;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(output);
    source.start(start);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }
  private schedule() {
    const ctx = this.context;
    if (!ctx || !this.musicGain || ctx.state !== 'running') return;
    if (this.next < ctx.currentTime) this.next = ctx.currentTime + 0.03;
    while (this.next < ctx.currentTime + 0.2) {
      const bar = Math.floor(this.beat / 8) % 4;
      const step = this.beat % 8;
      const chords = [
        [48, 55, 59, 62, 64],
        [45, 52, 55, 59, 60],
        [50, 57, 60, 64, 65],
        [43, 53, 57, 59, 62],
      ];
      const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
      if (step === 0 || step === 5)
        chords[bar]
          .slice(1)
          .forEach((note, i) =>
            this.tone(hz(note), this.next + i * 0.025, 1.65, 0.15, this.musicGain!, 'triangle'),
          );
      if (step % 2 === 0)
        this.tone(
          hz(chords[bar][0] - 12 + (step === 4 ? 7 : 0)),
          this.next,
          0.65,
          0.7,
          this.musicGain,
        );
      this.noise(this.next, 0.08, step % 2 ? 0.1 : 0.05, this.musicGain, 5500);
      if (step === 3 || step === 7)
        this.tone(hz(chords[bar][step === 3 ? 4 : 2] + 12), this.next, 1.1, 0.12, this.musicGain);
      this.next += step % 2 === 0 ? 0.28 : 0.22;
      this.beat++;
    }
  }
  play(effect: 'card' | 'chip' | 'win' | 'loss' | 'push') {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || !this.effects) return;
    const now = ctx.currentTime;
    if (effect === 'card') {
      this.noise(now, 0.16, 0.2, ctx.destination, 900);
      this.tone(160, now + 0.06, 0.05, 0.06, ctx.destination);
    } else if (effect === 'chip') {
      this.tone(1850, now, 0.055, 0.05, ctx.destination, 'triangle');
      this.tone(2600, now + 0.035, 0.045, 0.035, ctx.destination);
    } else {
      const notes =
        effect === 'win' ? [523, 659, 784, 1047] : effect === 'loss' ? [294, 247] : [392, 523];
      notes.forEach((n, i) =>
        this.tone(n, now + i * 0.11, 0.6, 0.055, ctx.destination, 'triangle'),
      );
    }
  }
  visibility(hidden: boolean) {
    if (hidden) void this.context?.suspend();
    else if (this.context) void this.context.resume().catch(() => {});
  }
}
export const audio = new TableAudio();
