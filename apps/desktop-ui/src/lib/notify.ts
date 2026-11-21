// Desktop attention helpers.
//
// Notifications are optional and permission-gated by the browser/WebView. Sound
// is generated locally with a very short oscillator so the app ships no audio
// asset and nothing is fetched at runtime.

type NotifyOptions = {
  title: string;
  body?: string;
  silent?: boolean;
  flash?: boolean;
};

let audioContext: AudioContext | null = null;
let flashTimer: number | null = null;
const originalTitle = () => 'Tervixa Wiggle';

export function playAttentionSound(volume = 0.04) {
  try {
    const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    audioContext = audioContext ?? new AudioCtor();
    const ctx = audioContext;
    if (ctx.state === 'suspended') void ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.09);
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
  } catch {
    // Audio is best-effort; a missing output device must not break a turn.
  }
}

export function flashWindowTitle(message = 'Turn finished') {
  if (typeof document === 'undefined' || document.hasFocus()) return;
  if (flashTimer !== null) return;
  let on = false;
  flashTimer = window.setInterval(() => {
    on = !on;
    document.title = on ? `● ${message}` : originalTitle();
  }, 900);
  const stop = () => {
    if (flashTimer !== null) {
      window.clearInterval(flashTimer);
      flashTimer = null;
    }
    document.title = originalTitle();
    window.removeEventListener('focus', stop);
  };
  window.addEventListener('focus', stop);
}

export function notifyDesktop({ title, body, silent = false, flash = false }: NotifyOptions) {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body, silent, tag: 'tervixa-wiggle' });
    }
  } catch {
    // Notifications are optional.
  }
  if (flash) flashWindowTitle(title);
}
