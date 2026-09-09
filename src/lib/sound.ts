/**
 * Short (<2s) end-of-phase chime via Web Audio. No network fetch, no deps.
 * The AudioContext is created lazily and resumed on user gesture to respect
 * browser autoplay policies. All failures are silent — the timer never crashes.
 */

let context: AudioContext | null = null;

function getContext(): AudioContext | null {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!context) {
      context = new Ctor();
    }
    if (context.state === 'suspended') {
      void context.resume().catch(() => undefined);
    }
    return context;
  } catch {
    return null;
  }
}

/** Must be called from a user gesture at least once (autoplay policy). */
export function unlockAudio(): void {
  getContext();
}

export function playChime(): void {
  try {
    const ctx = getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    // Two-note chime: E5 then A5, each 0.35s, total < 1s.
    const notes: Array<{ freq: number; start: number }> = [
      { freq: 659.25, start: 0 },
      { freq: 880.0, start: 0.32 },
    ];
    for (const { freq, start } of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + start);
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(0.5, now + start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + 0.38);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + 0.42);
    }
  } catch {
    // Silent fail — never break the timer.
  }
}
