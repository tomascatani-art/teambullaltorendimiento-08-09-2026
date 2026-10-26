// Corrección de perspectiva con el plano del agua: cuatro puntos del video con su posición conocida en la
// pileta (metros a lo largo del andarivel y a lo ancho) definen una homografía. Con ella cualquier punto que
// esté sobre la superficie del agua pasa a metros, aunque la cámara no esté de frente ni el nadador sobre la
// corchera marcada. Los puntos fuera del plano (por ejemplo bajo el agua) no quedan corregidos.

// Resuelve A x = b (n×n) por eliminación con pivoteo. null si el sistema es singular.
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let i = c + 1; i < n; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let i = 0; i < n; i++) if (i !== c) { const f = M[i][c] / M[c][c]; for (let j = c; j <= n; j++) M[i][j] -= f * M[c][j]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}

// Homografía que lleva src[k] → dst[k] (4 pares [x, y]). Devuelve 9 coeficientes (h33 = 1) o null.
export function homography(src, dst) {
  if (src.length !== 4 || dst.length !== 4) return null;
  // normalización: los píxeles van a ~[-1, 1] para que el sistema quede bien condicionado
  const cx = src.reduce((a, p) => a + p[0], 0) / 4, cy = src.reduce((a, p) => a + p[1], 0) / 4;
  const s = Math.max(1e-9, Math.max(...src.map(p => Math.hypot(p[0] - cx, p[1] - cy))));
  const n = src.map(p => [(p[0] - cx) / s, (p[1] - cy) / s]);
  const A = [], b = [];
  for (let k = 0; k < 4; k++) {
    const [x, y] = n[k], [u, v] = dst[k];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solve(A, b);
  if (!h) return null;
  return { h: [...h, 1], cx, cy, s };
}

export function applyH(H, p) {
  const x = (p[0] - H.cx) / H.s, y = (p[1] - H.cy) / H.s, h = H.h;
  const w = h[6] * x + h[7] * y + h[8];
  if (Math.abs(w) < 1e-12) return null;
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

// Los cuatro puntos tienen que formar un cuadrilátero convexo (sin cruzarse), si no la homografía no vale.
export function convex(pts) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4], c = pts[(i + 2) % 4];
    const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(z) < 1e-9) return false;
    if (sign && Math.sign(z) !== sign) return false;
    sign = Math.sign(z);
  }
  return true;
}

// plane: { a, b, w, pts: [p0..p3] } con p0 = corchera cercana a `a` m, p1 = cercana a `b` m,
// p2 = corchera lejana a `b` m, p3 = lejana a `a` m; w = ancho entre las dos corcheras (m).
export function planeCorners(plane) { return [[plane.a, 0], [plane.b, 0], [plane.b, plane.w], [plane.a, plane.w]]; }
export function planeH(plane) {
  if (!plane || !plane.pts || plane.pts.some(p => !p) || !(plane.b !== plane.a) || !(plane.w > 0)) return null;
  if (!convex(plane.pts)) return null;
  return homography(plane.pts, planeCorners(plane));
}

// Metros por píxel en un punto (a lo largo del andarivel): cuánto cambia la distancia al mover un píxel
// en la dirección en que más cambia. Sirve para el margen de error por píxel.
export function planeMpp(H, p) {
  const q = applyH(H, p), qx = applyH(H, [p[0] + 1, p[1]]), qy = applyH(H, [p[0], p[1] + 1]);
  if (!q || !qx || !qy) return NaN;
  return Math.hypot(qx[0] - q[0], qy[0] - q[0]);
}
