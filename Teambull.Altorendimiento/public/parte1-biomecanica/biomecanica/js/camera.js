// Movimiento de la cámara entre cuadros (filmación en mano o con paneo), como la compensación de Kinovea.
// Se buscan recortes del fondo (corcheras, bordes, paredes, techo) del cuadro anterior en el siguiente por
// correlación normalizada y se ajusta una transformación de semejanza (desplazamiento, giro y zoom) con los
// pares que coinciden entre sí. Las zonas donde hay personas se excluyen: el nadador se mueve y no es fondo.
// Transformación T = [a, b, tx, ty]: x' = a·x − b·y + tx, y' = b·x + a·y + ty.
import { cutPatch, matchPatch } from './track.js';

export const IDENT = [1, 0, 0, 0];
export const apply = (T, p) => [T[0] * p[0] - T[1] * p[1] + T[2], T[1] * p[0] + T[0] * p[1] + T[3]];
// compose(A, B): primero B, después A
export const compose = (A, B) => [A[0] * B[0] - A[1] * B[1], A[0] * B[1] + A[1] * B[0], ...apply(A, [B[2], B[3]])];
export function invert(T) {
  const d = T[0] * T[0] + T[1] * T[1], a = T[0] / d, b = -T[1] / d;
  return [a, b, -(a * T[2] - b * T[3]), -(b * T[2] + a * T[3])];
}
// la misma transformación en otra escala de píxeles (de trabajo a video: s = ancho video / ancho de trabajo)
export const rescale = (T, s) => [T[0], T[1], T[2] * s, T[3] * s];

// Semejanza por mínimos cuadrados que lleva los puntos P a los Q.
export function fitSimilarity(P, Q) {
  const n = P.length;
  if (n < 2) return null;
  let px = 0, py = 0, qx = 0, qy = 0;
  for (let k = 0; k < n; k++) { px += P[k][0]; py += P[k][1]; qx += Q[k][0]; qy += Q[k][1]; }
  px /= n; py /= n; qx /= n; qy /= n;
  let sxx = 0, sa = 0, sb = 0;
  for (let k = 0; k < n; k++) {
    const x = P[k][0] - px, y = P[k][1] - py, u = Q[k][0] - qx, v = Q[k][1] - qy;
    sxx += x * x + y * y; sa += x * u + y * v; sb += x * v - y * u;
  }
  if (sxx < 1e-9) return [1, 0, qx - px, qy - py];
  const a = sa / sxx, b = sb / sxx;
  return [a, b, qx - (a * px - b * py), qy - (b * px + a * py)];
}

// Ajuste robusto: prueba semejanzas con pares de puntos (en orden fijo, sin azar) y se queda con la que
// más pares explica dentro de `tol` píxeles; después reajusta con todos esos pares.
export function robustSimilarity(P, Q, tol = 1.5) {
  const n = P.length;
  if (n < 3) return null;
  let best = null, bestIn = [];
  const step = Math.max(1, Math.floor(n / 12));
  for (let i = 0; i < n; i += step) for (let j = i + 1; j < n; j += step) {
    const T = fitSimilarity([P[i], P[j]], [Q[i], Q[j]]);
    if (!T || Math.abs(Math.hypot(T[0], T[1]) - 1) > 0.2) continue; // zoom de más de 20 % entre dos cuadros: no es la cámara
    const inl = [];
    for (let k = 0; k < n; k++) { const r = apply(T, P[k]); if (Math.hypot(r[0] - Q[k][0], r[1] - Q[k][1]) <= tol) inl.push(k); }
    if (inl.length > bestIn.length) { bestIn = inl; best = T; }
  }
  if (!best) return null;
  const T = fitSimilarity(bestIn.map(k => P[k]), bestIn.map(k => Q[k])) || best;
  return { T, inliers: bestIn.length, n };
}

// Movimiento del cuadro B respecto del A, en escala de grises (ancho w, alto h). exclude: cajas [x0, y0, x1, y1]
// en píxeles de trabajo donde no se buscan recortes. guess: transformación prevista de B a A (la anterior);
// cada recorte se busca alrededor de donde esa transformación lo ubica en B.
// Devuelve { T, inliers, n } con T llevando coordenadas de B a A, o null si no hay fondo suficiente.
export function frameMotion(A, B, w, h, { exclude = [], cols = 8, rows = 6, half = 8, search = 18, guess = IDENT, minStd = 6 } = {}) {
  const back = invert(guess);
  const P = [], Q = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = Math.round((c + 0.5) * w / cols), y = Math.round((r + 0.5) * h / rows);
    if (x - half - search < 0 || y - half - search < 0 || x + half + search >= w || y + half + search >= h) continue;
    if (exclude.some(b => x >= b[0] - half && x <= b[2] + half && y >= b[1] - half && y <= b[3] + half)) continue;
    const T = cutPatch(A, w, h, x, y, half);
    let m = 0; for (const v of T) m += v; m /= T.length;
    let s = 0; for (const v of T) s += (v - m) * (v - m);
    if (Math.sqrt(s / T.length) < minStd) continue; // zona lisa: no se puede ubicar
    const g = apply(back, [x, y]);
    const hit = matchPatch(B, w, h, T, half, g[0], g[1], search);
    if (hit.score < 0.8) continue;
    P.push([hit.x, hit.y]); Q.push([x, y]);
  }
  const res = robustSimilarity(P, Q);
  if (!res || res.inliers < 4 || res.inliers < 0.4 * res.n) return null;
  return res;
}

// Seguimiento de la cámara cuadro a cuadro contra un cuadro clave (no contra el anterior, para que los
// errores no se acumulen). El clave se renueva cuando la cámara se alejó tanto que quedan pocos recortes
// en común. push(G, exclude) devuelve { toBase, ok }: del cuadro nuevo al primero.
export function cameraTracker(w, h, opts = {}) {
  let key = null, keyToBase = IDENT, cur = IDENT; // cur: del cuadro anterior al clave
  return {
    push(G, exclude = []) {
      if (!key) { key = G; return { toBase: IDENT, ok: true }; }
      let m = frameMotion(key, G, w, h, { ...opts, exclude, guess: cur });
      if (!m) {
        // sin coincidencia con el clave: se reinicia desde este cuadro, suponiendo la cámara quieta
        key = G; keyToBase = compose(keyToBase, cur); cur = IDENT;
        return { toBase: keyToBase, ok: false };
      }
      cur = m.T;
      const toBase = compose(keyToBase, cur);
      const c = apply(cur, [w / 2, h / 2]);
      if (m.inliers < 0.6 * m.n || Math.hypot(c[0] - w / 2, c[1] - h / 2) > 0.15 * w) { key = G; keyToBase = toBase; cur = IDENT; }
      return { toBase, ok: true };
    },
  };
}

// Transformaciones acumuladas de cada cuadro al primero (steps[k] lleva el cuadro k al k−1; null = sin
// estimación: se supone quieta y se marca como no confiable).
export function chainSteps(steps) {
  const out = [IDENT], ok = [true];
  for (let k = 1; k < steps.length; k++) {
    out.push(compose(out[k - 1], steps[k] ? steps[k].T : IDENT));
    ok.push(!!steps[k]);
  }
  return { toBase: out, ok };
}

// Resumen para mostrar: cuánto se movió la cámara (máximo desplazamiento de un punto del centro, en
// píxeles del video) y en cuántos cuadros se pudo estimar.
export function cameraSummary(cam, w, h) {
  const c = [w / 2, h / 2];
  let max = 0;
  for (const T of cam.toBase) { const p = apply(T, c); max = Math.max(max, Math.hypot(p[0] - c[0], p[1] - c[1])); }
  const okFrac = cam.ok.filter(Boolean).length / Math.max(1, cam.ok.length);
  return { maxShift: max, okFrac, moved: max > 0.01 * Math.max(w, h) };
}

// Un punto del cuadro k visto en el cuadro i (para dibujar trayectorias sobre la imagen que se mueve).
export function between(cam, k, i, p) {
  if (!cam) return p;
  return apply(invert(cam.toBase[i]), apply(cam.toBase[k], p));
}
