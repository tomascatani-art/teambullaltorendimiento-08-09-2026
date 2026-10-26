// Dos cámaras a la vez: la toma desde el borde y la subacuática (o dos ángulos cualquiera), sincronizadas.
// La sincronización automática compara el sonido de los dos videos: busca el desfase en el que coinciden los
// golpes de sonido (un aplauso, el silbato, la bocina, la entrada al agua). Sirve si las dos cámaras grabaron
// sonido; una cámara dentro del agua graba apagado, así que siempre conviene verificar en un momento que se
// vea en las dos y corregir cuadro a cuadro.

const HOP = 0.01; // s por muestra de la envolvente

// Golpes de sonido: subida de la energía (en dB) cada 10 ms, solo la parte positiva. samples: Float32Array mono.
export function onsetEnvelope(samples, sampleRate) {
  const hop = Math.round(sampleRate * HOP), n = Math.floor(samples.length / hop);
  const db = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let e = 0;
    for (let i = k * hop, end = i + hop; i < end; i++) e += samples[i] * samples[i];
    db[k] = 10 * Math.log10(e / hop + 1e-10);
  }
  const out = new Float64Array(n);
  for (let k = 1; k < n; k++) out[k] = Math.max(0, db[k] - db[k - 1]);
  return out;
}

// Desfase (s) que hay que sumarle al tiempo del video A para encontrar el mismo instante en el B:
// tB = tA + offset. Correlación normalizada de las envolventes, con interpolación parabólica del pico.
// score = correlación del pico; ratio = pico sobre el segundo mejor pico lejos del primero (confianza).
export function bestOffset(envA, envB, { maxLag = 60, hop = HOP } = {}) {
  const z = (e) => { let m = 0; for (const v of e) m += v; m /= e.length || 1; let s = 0; for (const v of e) s += (v - m) ** 2; s = Math.sqrt(s) || 1; return Float64Array.from(e, v => (v - m) / s); };
  const a = z(envA), b = z(envB), L = Math.round(maxLag / hop);
  const lags = [], cs = [];
  for (let lag = -L; lag <= L; lag++) {
    // b[k + lag] contra a[k]
    let c = 0, cnt = 0;
    const k0 = Math.max(0, -lag), k1 = Math.min(a.length, b.length - lag);
    for (let k = k0; k < k1; k++) { c += a[k] * b[k + lag]; cnt++; }
    if (cnt < 200) continue; // menos de 2 s en común
    lags.push(lag); cs.push(c * Math.sqrt(a.length / cnt)); // compensa el solapamiento parcial
  }
  if (!cs.length) return null;
  let bi = 0; for (let i = 1; i < cs.length; i++) if (cs[i] > cs[bi]) bi = i;
  let frac = 0;
  if (bi > 0 && bi < cs.length - 1 && lags[bi + 1] - lags[bi - 1] === 2) { const y0 = cs[bi - 1], y1 = cs[bi], y2 = cs[bi + 1], d = y0 - 2 * y1 + y2; if (d < 0) frac = 0.5 * (y0 - y2) / d; }
  let second = -Infinity;
  for (let i = 0; i < cs.length; i++) if (Math.abs(lags[i] - lags[bi]) > 0.3 / hop && cs[i] > second) second = cs[i];
  return { offset: (lags[bi] + frac) * hop, score: cs[bi], ratio: second > 0 ? cs[bi] / second : Infinity };
}

async function decodeMono(file) {
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Ctx) throw new Error('El navegador no permite leer el audio.');
  const buf = await file.arrayBuffer(), ctx = new Ctx(1, 22050, 22050);
  let audio;
  try { audio = await new Promise((res, rej) => { const p = ctx.decodeAudioData(buf, res, rej); if (p && p.then) p.then(res, rej); }); }
  catch { throw new Error(`"${file.name}" no tiene sonido o no se pudo leer.`); }
  const ch = audio.getChannelData(0);
  if (audio.numberOfChannels < 2) return { samples: ch, rate: audio.sampleRate };
  const c2 = audio.getChannelData(1), s = new Float32Array(ch.length);
  for (let i = 0; i < ch.length; i++) s[i] = (ch[i] + c2[i]) / 2;
  return { samples: s, rate: audio.sampleRate };
}

// Desfase entre dos archivos por el sonido. Devuelve { offset, score, ratio, reliable }.
export async function audioOffset(fileA, fileB) {
  const [a, b] = await Promise.all([decodeMono(fileA), decodeMono(fileB)]);
  const r = bestOffset(onsetEnvelope(a.samples, a.rate), onsetEnvelope(b.samples, b.rate));
  if (!r) throw new Error('Los videos no tienen al menos 2 segundos en común.');
  return { ...r, reliable: r.ratio >= 1.3 && r.score > 0.15 };
}
