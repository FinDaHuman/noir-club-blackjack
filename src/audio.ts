import type { Settings } from './settings';
export type SoundPreviewResult = 'playing' | 'muted' | 'unavailable';
// An original, synthesized lounge arrangement. No external recordings or requests.
class TableAudio {
  private context: AudioContext | null = null;
  private musicGain: GainNode | null = null;
  private effectsGain: GainNode | null = null;
  private musicVolume = 65;
  private effectsVolume = 80;
  private timer: ReturnType<typeof setInterval> | null = null;
  private next = 0;
  private beat = 0;
  effects = true;
  music = true;
  async unlock() {
    try {
      if (this.context?.state === 'closed') {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        this.context = null;
        this.musicGain = null;
        this.effectsGain = null;
      }
      this.context ??= new AudioContext();
      if (!this.musicGain) {
        this.musicGain = this.context.createGain();
        this.musicGain.gain.value = this.music ? this.musicVolume * 0.002 : 0;
        this.musicGain.connect(this.context.destination);
      }
      if (!this.effectsGain) {
        this.effectsGain = this.context.createGain();
        this.effectsGain.gain.value = this.effects ? this.effectsVolume / 80 : 0;
        this.effectsGain.connect(this.context.destination);
      }
      if (this.context.state !== 'running') await this.context.resume();
      if (this.context.state !== 'running') return false;
      if (!this.timer) {
        this.next = this.context.currentTime + 0.08;
        this.timer = setInterval(() => this.schedule(), 100);
      }
      return true;
    } catch {
      return false;
    }
  }
  configure(settings: Settings) {
    this.music = settings.music;
    this.effects = settings.effects;
    this.musicVolume = settings.musicVolume;
    this.effectsVolume = settings.effectsVolume;
    if (this.context) {
      const now = this.context.currentTime;
      const volume = (node: GainNode | null, target: number) => {
        if (!node) return;
        const current = node.gain.value;
        // Keep idle buses at the requested level and replace any earlier volume ramp.
        node.gain.cancelScheduledValues(now);
        node.gain.value = target;
        node.gain.setValueAtTime(current, now);
        node.gain.linearRampToValueAtTime(target, now + 0.05);
      };
      volume(this.musicGain, this.music ? this.musicVolume * 0.002 : 0);
      volume(this.effectsGain, this.effects ? this.effectsVolume / 80 : 0);
    }
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
  async preview(): Promise<SoundPreviewResult> {
    if (!this.effects || this.effectsVolume === 0) return 'muted';
    if (!(await this.unlock())) return 'unavailable';
    if (!this.effects || this.effectsVolume === 0) return 'muted';
    // Allow the audio output to wake before a recognizable sequence of table sounds.
    this.play('card', 0.08);
    this.play('chip', 0.4);
    this.play('win', 0.65);
    return 'playing';
  }
  play(effect: 'card' | 'chip' | 'win' | 'loss' | 'push', delay = 0) {
    const ctx = this.context;
    if (
      !ctx ||
      !this.effectsGain ||
      ctx.state !== 'running' ||
      !this.effects ||
      this.effectsVolume === 0
    )
      return;
    const output = this.effectsGain;
    const now = ctx.currentTime + delay;
    if (effect === 'card') {
      this.noise(now, 0.16, 0.2, output, 900);
      this.tone(160, now + 0.06, 0.05, 0.06, output);
    } else if (effect === 'chip') {
      this.tone(1850, now, 0.055, 0.05, output, 'triangle');
      this.tone(2600, now + 0.035, 0.045, 0.035, output);
    } else {
      const notes =
        effect === 'win' ? [523, 659, 784, 1047] : effect === 'loss' ? [294, 247] : [392, 523];
      notes.forEach((n, i) => this.tone(n, now + i * 0.11, 0.6, 0.055, output, 'triangle'));
    }
  }
  visibility(hidden: boolean) {
    if (hidden) void this.context?.suspend();
    else if (this.context) void this.context.resume().catch(() => {});
  }
}
export const audio = new TableAudio();
