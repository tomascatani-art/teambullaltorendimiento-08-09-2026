// Detección de la señal de salida en el audio del video.
// Busca el inicio de un sonido tonal fuerte y brusco (bocina electrónica) en la banda 500-4000 Hz.

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

// samples: Float32Array mono. Devuelve candidatos ordenados por puntaje: [{t, score, tonality, freq}].
export function detectStartSignal(samples, sampleRate, { maxSeconds = Infinity } = {}) {
  const N = 1024;
  const hop = Math.round(sampleRate * 0.005);
  const lo = Math.floor(500 * N / sampleRate), hi = Math.ceil(4000 * N / sampleRate);
  const total = Math.min(samples.length, Math.floor(maxSeconds * sampleRate));
  const frames = [];
  const win = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let s = 0; s + N <= total; s += hop) {
    for (let i = 0; i < N; i++) { re[i] = samples[s + i] * win[i]; im[i] = 0; }
    fft(re, im);
    let e = 0, peak = 0, peakBin = lo, logSum = 0;
    for (let k = lo; k <= hi; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      e += p;
      if (p > peak) { peak = p; peakBin = k; }
      logSum += Math.log(p + 1e-12);
    }
    const nb = hi - lo + 1;
    const flatness = Math.exp(logSum / nb) / (e / nb + 1e-12); // 1 = ruido, ~0 = tono
    frames.push({ t: (s + N / 2) / sampleRate, db: 10 * Math.log10(e + 1e-12), flatness, freq: peakBin * sampleRate / N });
  }
  const look = Math.round(1.0 / 0.005);
  const sustain = Math.round(0.08 / 0.005);
  const cands = [];
  for (let i = look; i < frames.length - sustain; i++) {
    const base = frames.slice(i - look, i).map(f => f.db).sort((a, b) => a - b)[Math.floor(look / 2)];
    const rise = frames[i].db - base;
    if (rise < 10) continue;
    // sostenido y tonal durante al menos 80 ms
    let ok = true, flat = 0;
    for (let k = i; k < i + sustain; k++) { if (frames[k].db - base < rise - 8) { ok = false; break; } flat += frames[k].flatness; }
    if (!ok) continue;
    flat /= sustain;
    const tonality = 1 - Math.min(1, flat * 4);
    if (tonality < 0.3) continue;
    // el inicio exacto: primer cuadro desde i-3 que supera la mitad de la subida
    let j = i;
    while (j > i - 4 && frames[j - 1].db - base > rise / 2) j--;
    cands.push({ t: frames[j].t, score: rise * tonality, rise, tonality, freq: frames[i].freq });
    i += Math.round(0.5 / 0.005); // evita repetir el mismo sonido
  }
  return cands.sort((a, b) => b.score - a.score);
}

// Decodifica el audio del archivo (si tiene) y busca la señal en los primeros 90 s.
export async function findStartSignal(file) {
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Ctx) return { error: 'El navegador no permite leer el audio.' };
  const buf = await file.arrayBuffer();
  const ctx = new Ctx(1, 44100, 44100);
  let audio;
  try {
    audio = await new Promise((res, rej) => { const p = ctx.decodeAudioData(buf, res, rej); if (p && p.then) p.then(res, rej); });
  } catch (e) {
    return { error: 'El video no tiene audio o no se pudo decodificar.' };
  }
  const ch = audio.getChannelData(0);
  let samples = ch;
  if (audio.numberOfChannels > 1) {
    const c2 = audio.getChannelData(1);
    samples = new Float32Array(ch.length);
    for (let i = 0; i < ch.length; i++) samples[i] = (ch[i] + c2[i]) / 2;
  }
  const cands = detectStartSignal(samples, audio.sampleRate, { maxSeconds: 90 });
  return { candidates: cands.slice(0, 3) };
}
