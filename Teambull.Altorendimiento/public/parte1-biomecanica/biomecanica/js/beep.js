// Pitido al registrar cada repetición en vivo, para que el deportista sepa que la subida ya contó.
// El navegador solo deja sonar después de un toque: unlock() se llama desde un botón.
let ctx = null;
export const beeps = { count: 0 }; // para las pruebas automáticas

export function unlock() {
  const C = window.AudioContext || window.webkitAudioContext;
  if (!C) return;
  ctx ||= new C();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}

// kind 'rep': un pitido agudo; 'stop': dos graves (el déficit de la serie pasó el límite).
export function beep(kind = 'rep') {
  beeps.count++;
  if (!ctx) return;
  const tones = kind === 'stop' ? [[440, 0], [440, 0.22]] : [[1320, 0]];
  for (const [hz, at] of tones) {
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + at;
    o.type = 'sine'; o.frequency.value = hz;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + 0.2);
  }
}
