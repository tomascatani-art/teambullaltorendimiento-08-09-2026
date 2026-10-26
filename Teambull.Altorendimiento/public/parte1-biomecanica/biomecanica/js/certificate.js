// Certificado de calidad de la toma: antes de mirar los números, qué tan confiables son según cómo se
// filmó. Cada criterio sale de lo medido en el propio video (cuadros por segundo, tamaño del nadador en
// píxeles, cuadros con detección, articulaciones vistas, movimiento de la cámara, ciclos completos) y
// dice qué cambiar la próxima vez. Los umbrales son criterios de la app, no normas externas.
// Grado: A = apta para comparar entre evaluaciones; B = apta con reservas; C = solo orientativa.

const ms = (fps) => Math.round(1000 / fps);
function check(id, label, value, status, why, fix) { return { id, label, value, status, why, fix: status === 'ok' ? '' : fix }; }

export function shotCertificate(r) {
  const m = r.meta, q = r.quality, out = [];
  const fps = m.fps;
  out.push(check('fps', 'Cuadros por segundo', `${fps.toFixed(0)} fps (±${ms(fps)} ms por evento)`,
    fps >= 50 ? 'ok' : fps >= 25 ? 'warn' : 'bad',
    'Define con qué precisión se ubican la entrada de la mano, los ciclos y los momentos clave.',
    'Filmá a 60 fps o más (en el teléfono: cámara lenta o 4K/60).'));
  const diag = Math.hypot(m.width, m.height), body = Number.isFinite(q.swimmerSize) ? q.swimmerSize * diag : NaN;
  // con ~3 px de error por punto, el error de un ángulo entre segmentos de largo L px es ≈ √2·3/L rad
  const segPx = body / 3, angErr = Number.isFinite(segPx) && segPx > 0 ? Math.sqrt(2) * 3 / segPx * 180 / Math.PI : NaN;
  out.push(check('size', 'Tamaño del nadador', Number.isFinite(body) ? `${body.toFixed(0)} px de punta a punta${Number.isFinite(angErr) ? ` (aprox. ±${angErr.toFixed(0)}° por ángulo si cada punto erra 3 px)` : ''}` : 'sin datos',
    !Number.isFinite(body) ? 'bad' : body >= 400 ? 'ok' : body >= 200 ? 'warn' : 'bad',
    'Cuantos más píxeles ocupa el cuerpo, menos pesa el error de cada punto en los ángulos.',
    'Acercá la cámara o usá más resolución: que el nadador ocupe al menos la mitad del ancho de la imagen.'));
  const det = q.detectedFraction;
  out.push(check('det', 'Nadador detectado', `${(100 * det).toFixed(0)} % de los cuadros`,
    det >= 0.85 ? 'ok' : det >= 0.6 ? 'warn' : 'bad',
    'Los cuadros sin detección no se miden: solo se interpolan huecos cortos.',
    'Evitá espuma, reflejos y otras personas entre la cámara y el nadador; probá "Buscar al nadador en cuadros perdidos".'));
  const segs = q.groups.filter(g => g.name !== 'Cabeza');
  const worst = segs.length ? segs.reduce((a, g) => (g.usableFraction < a.usableFraction ? g : a), segs[0]) : null;
  if (worst) out.push(check('vis', 'Articulaciones vistas', `${worst.name}: ${(100 * worst.usableFraction).toFixed(0)} % usable (el peor segmento)`,
    worst.usableFraction >= 0.7 ? 'ok' : worst.usableFraction >= 0.4 ? 'warn' : 'bad',
    'Las medidas de un segmento poco visible quedan como no disponibles o con confianza baja.',
    'En toma lateral el lado lejano se tapa: filmá también del otro lado, o bajo el agua para la tracción.'));
  const cam = m.camera;
  if (cam) out.push(check('cam', 'Cámara', cam.moved ? `se movió hasta ${cam.maxShift.toFixed(0)} px; compensada en ${(100 * cam.okFrac).toFixed(0)} % de los cuadros` : 'quieta',
    !cam.moved ? 'ok' : cam.okFrac >= 0.9 ? 'warn' : 'bad',
    'Con la cámara en mano se compensan los recorridos siguiendo el fondo; con trípode no hace falta.',
    'Usá trípode o apoyá el teléfono; si es en mano, que se vean corcheras o bordes en todo momento.'));
  const ct = r.metrics.find(x => x.id === 'cycleTime'), nc = ct?.n || 0;
  out.push(check('cycles', 'Ciclos completos', `${nc}`,
    nc >= 4 ? 'ok' : 'warn', // en una salida o un viraje no hay ciclos: no invalida la toma
    'Con más ciclos los promedios tienen menos error y se puede saber si un cambio es real.',
    'Filmá un tramo más largo de nado regular (4 ciclos o más, sin salida ni viraje).'));
  if (m.timingSource && m.timingSource !== 'container') out.push(check('time', 'Tiempos de cada cuadro', 'estimados durante la reproducción', 'warn',
    'Sin los tiempos del archivo, los tiempos pueden tener un pequeño error extra.', 'Usá el archivo original del teléfono (sin pasar por WhatsApp ni editores).'));
  const bad = out.filter(c => c.status === 'bad').length, warn = out.filter(c => c.status === 'warn').length;
  const grade = bad ? 'C' : warn >= 2 ? 'B' : 'A';
  const meaning = { A: 'Apta para comparar ángulos y tiempos entre evaluaciones.', B: 'Apta con reservas: los números sirven, pero revisá los criterios marcados antes de comparar.', C: 'Solo orientativa: hay un criterio que limita la precisión. Conviene repetir la toma.' }[grade];
  return { grade, meaning, checks: out };
}

export function certificateHtml(c, esc) {
  const icon = { ok: '✓', warn: '!', bad: '✕' };
  return `<div class="cert cert-${c.grade}"><div class="cert-head"><span class="cert-grade">${c.grade}</span><div><b>Certificado de la toma</b><p>${esc(c.meaning)}</p></div></div>
    <ul class="cert-list">${c.checks.map(k => `<li class="${k.status}"><span class="cert-ic">${icon[k.status]}</span><div><b>${esc(k.label)}</b> <span class="mono">${esc(k.value)}</span><small>${esc(k.why)}${k.fix ? ` <i>Próxima vez: ${esc(k.fix)}</i>` : ''}</small></div></li>`).join('')}</ul>
    <p class="fine">Umbrales de la app: 50 fps, 400 px de cuerpo, 85 % de detección, 70 % del peor segmento visible, cámara quieta, 4 ciclos. A con a lo sumo un aviso, B con más avisos, C con algún criterio en rojo.</p></div>`;
}
