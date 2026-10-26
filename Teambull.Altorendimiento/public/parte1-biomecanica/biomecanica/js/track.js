// Seguimiento de un punto cuadro a cuadro (como el de Kinovea): se toma un recorte alrededor del punto
// y en el cuadro siguiente se busca la zona más parecida (correlación cruzada normalizada).
// Trabaja en escala de grises sobre una copia reducida del cuadro.

export const TRACK_W = 480; // ancho de trabajo en píxeles

// Correlación normalizada entre el molde T (lado s) y la imagen G (ancho w) con esquina en (x, y).
function ncc(G, w, T, tMean, tNorm, s, x, y) {
  let sum = 0, sum2 = 0, cross = 0;
  for (let j = 0; j < s; j++) {
    const row = (y + j) * w + x, trow = j * s;
    for (let i = 0; i < s; i++) { const g = G[row + i]; sum += g; sum2 += g * g; cross += g * T[trow + i]; }
  }
  const n = s * s, mean = sum / n, varG = sum2 - n * mean * mean;
  if (varG <= 1e-6 || tNorm <= 1e-6) return -1;
  return (cross - n * mean * tMean) / Math.sqrt(varG * tNorm);
}

export function cutPatch(G, w, h, cx, cy, half) {
  const s = half * 2 + 1, T = new Float32Array(s * s);
  const x0 = Math.round(cx) - half, y0 = Math.round(cy) - half;
  for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
    const x = Math.min(w - 1, Math.max(0, x0 + i)), y = Math.min(h - 1, Math.max(0, y0 + j));
    T[j * s + i] = G[y * w + x];
  }
  return T;
}
function stats(T) { let m = 0; for (const v of T) m += v; m /= T.length; let nrm = 0; for (const v of T) nrm += (v - m) * (v - m); return [m, nrm]; }

// Busca el molde T alrededor de (cx, cy) dentro de ±search. Devuelve { x, y, score }.
// sub: afina la posición a fracciones de píxel con una parábola sobre los vecinos del mejor puesto.
export function matchPatch(G, w, h, T, half, cx, cy, search, sub = false) {
  const s = half * 2 + 1, [tMean, tNorm] = stats(T);
  let best = { x: cx, y: cy, score: -1 };
  const xa = Math.max(0, Math.round(cx) - half - search), xb = Math.min(w - s, Math.round(cx) - half + search);
  const ya = Math.max(0, Math.round(cy) - half - search), yb = Math.min(h - s, Math.round(cy) - half + search);
  for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
    const sc = ncc(G, w, T, tMean, tNorm, s, x, y);
    if (sc > best.score) best = { x: x + half, y: y + half, score: sc };
  }
  if (sub && best.score > -1) {
    const bx = best.x - half, by = best.y - half;
    const at = (x, y) => (x >= 0 && y >= 0 && x <= w - s && y <= h - s ? ncc(G, w, T, tMean, tNorm, s, x, y) : NaN);
    const off = (a, c) => { const d = a - 2 * best.score + c; return Number.isFinite(d) && d < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / d)) : 0; };
    best.x += off(at(bx - 1, by), at(bx + 1, by)); best.y += off(at(bx, by - 1), at(bx, by + 1));
  }
  return best;
}

// Sigue el punto p0 (en píxeles de trabajo) desde el cuadro de índice i0 hacia adelante.
// getGray(i) => Promise<{ G, w, h }> o null al terminar. Devuelve [{ i, x, y, score }] y si se perdió.
export async function trackForward(getGray, i0, p0, { maxFrames = 400, half = 12, search = 22, minScore = 0.5, subpixel = false, onPoint, signal } = {}) {
  const first = await getGray(i0);
  if (!first) return { pts: [], lost: false };
  let T = cutPatch(first.G, first.w, first.h, p0[0], p0[1], half);
  let p = p0, vx = 0, vy = 0;
  const pts = [{ i: i0, x: p0[0], y: p0[1], score: 1 }];
  for (let k = 1; k <= maxFrames; k++) {
    if (signal?.aborted) break;
    const fr = await getGray(i0 + k);
    if (!fr) break;
    // se busca alrededor de la posición prevista por la velocidad reciente
    const m = matchPatch(fr.G, fr.w, fr.h, T, half, p[0] + vx, p[1] + vy, search, subpixel);
    if (m.score < minScore) return { pts, lost: true, lostAt: i0 + k };
    vx = 0.6 * vx + 0.4 * (m.x - p[0]); vy = 0.6 * vy + 0.4 * (m.y - p[1]);
    p = [m.x, m.y];
    // el molde se renueva de a poco: acompaña los cambios de forma sin perder el punto
    const N = cutPatch(fr.G, fr.w, fr.h, p[0], p[1], half);
    for (let q = 0; q < T.length; q++) T[q] = 0.75 * T[q] + 0.25 * N[q];
    const pt = { i: i0 + k, x: p[0], y: p[1], score: m.score };
    pts.push(pt);
    onPoint?.(pt, k);
  }
  return { pts, lost: false };
}

// Colores para las líneas de distintos días (distinguibles sobre agua y entre sí).
export const PATH_COLORS = ['#ff9f1c', '#4cc9f0', '#f72585', '#80ed99', '#ffd60a', '#c77dff', '#ff6b6b', '#ffffff'];
