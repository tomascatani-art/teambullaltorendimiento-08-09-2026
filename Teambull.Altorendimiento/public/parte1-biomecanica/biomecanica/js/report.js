// Informe PDF (jsPDF). Solo incluye valores calculados; lo no disponible se declara como tal.
import { SERIES_COLORS, SHORT, usedCols } from './moments.js';

const ACC = [10, 122, 168];
const INK = [8, 16, 26];
const GREY = [110, 117, 128];
const LINE = [220, 223, 228];
const RED = [200, 30, 30];

import { shotCertificate } from './certificate.js';

export async function buildReport(r, { captureFrame, renderChart, limitations, styleLabel, moments = [], flight = null, phases = null, angleChecks = [], chartSel = null, chartColors = null, faults = [], velocity = null }) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const PW = 210, PH = 297, M = 16;
  const m = r.meta;
  let y = 0;
  let page = 1;
  const cert = shotCertificate(r);

  const footer = () => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...GREY);
    doc.text(`SwimBull · ${m.swimmer} · ${m.date || ''} · Análisis automático ${m.appVersion}`, M, PH - 8);
    doc.text(String(page), PW - M, PH - 8, { align: 'right' });
  };
  const newPage = (title) => {
    footer();
    doc.addPage(); page++;
    doc.setFillColor(...INK); doc.rect(0, 0, PW, 14, 'F');
    doc.setFillColor(...ACC); doc.rect(0, 14, PW, 0.8, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(255, 255, 255);
    doc.text('SwimBull', M, 9);
    doc.setFont('helvetica', 'normal'); doc.text(title.toUpperCase(), PW - M, 9, { align: 'right' });
    y = 26;
  };
  const ensure = (h, title) => { if (y + h > PH - 16) newPage(title); };
  const h2 = (t) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...INK);
    doc.text(t, M, y); y += 2;
    doc.setDrawColor(...ACC); doc.setLineWidth(0.6); doc.line(M, y, M + 12, y); y += 6;
  };
  const para = (t, size = 9.5, color = INK, indent = 0) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(size); doc.setTextColor(...color);
    const lines = doc.splitTextToSize(t, PW - 2 * M - indent);
    for (const ln of lines) { ensure(5, 'continuación'); doc.text(ln, M + indent, y); y += size * 0.45; }
    y += 1.5;
  };
  const fmt = (v, d = 1) => Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '-';
  const light = { bg: '#ffffff', grid: '#e3e6ea', text: '#111316', text2: '#6e7580', text3: '#9aa1ab', accent: '#0a7aa8' };

  // ---------- portada ----------
  doc.setFillColor(...INK); doc.rect(0, 0, PW, 92, 'F');
  doc.setFillColor(...ACC); doc.rect(0, 92, PW, 1.4, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('SwimBull', M, 20);
  doc.setFontSize(26); doc.text('Informe biomecánico', M, 52);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.setTextColor(200, 204, 210);
  doc.text('Natación · análisis automático por video', M, 62);
  doc.setFontSize(18); doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold');
  doc.text(m.swimmer, M, 80);

  y = 106;
  const rows = [
    ['Fecha del análisis', m.date || '-'],
    ['Estilo', styleLabel[m.style] + ' (declarado por el entrenador)'],
    ['Prueba o tarea', m.event || 'No informada'],
    ['Tipo de toma', m.viewLabel + ' (declarada)'],
    ['Video', `${m.fileName} · ${m.width}×${m.height} px · ${fmt(m.sourceFps, 2)} fps${m.frameStep > 1 ? ` (analizado a ${fmt(m.fps, 1)} fps)` : ''} · ${fmt(m.duration, 1)} s`],
    ['Calidad de la toma', `Grado ${cert.grade}: ${cert.meaning} Nadador detectado en el ${fmt(100 * r.quality.detectedFraction, 0)}% de los cuadros.`],
    ['Modelo de pose', m.model],
    ...(m.camera?.moved ? [['Cámara', `en mano: se compensó su movimiento (hasta ${Math.round(m.camera.maxShift)} px, estimado en ${Math.round(100 * m.camera.okFrac)} % de los cuadros)`]] : []),
    ...(m.cleanup ? [['Correcciones de puntos', `${m.cleanup.swaps} cruces izquierda/derecha y ${m.cleanup.spikes} saltos corregidos automáticamente${m.cleanup.searched ? ` · ${m.cleanup.found} cuadros recuperados recortando al nadador` : ''} · ${m.cleanup.edits} correcciones a mano`]] : []),
  ];
  doc.setFontSize(9.5);
  for (const [k, v] of rows) {
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...GREY); doc.text(k.toUpperCase(), M, y);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...INK);
    const lines = doc.splitTextToSize(v, PW - 2 * M - 48);
    doc.text(lines, M + 48, y);
    y += Math.max(1, lines.length) * 4.6 + 2.4;
    doc.setDrawColor(...LINE); doc.setLineWidth(0.2); doc.line(M, y - 3.6, PW - M, y - 3.6);
  }

  // fotograma de portada
  const bestArm = r.arms.L.cycles.filter(c => c.accepted).length >= r.arms.R.cycles.filter(c => c.accepted).length ? 'L' : 'R';
  const accepted = r.arms[bestArm].cycles.filter(c => c.accepted);
  const detectedIdx = r.times.map((_, i) => i).filter(i => r.quality.detectedMask[i]);
  const coverIdx = accepted.length ? accepted[0].start : detectedIdx.length ? detectedIdx[detectedIdx.length >> 1] : 0;
  {
    const c = await captureFrame(coverIdx, { maxWidth: 1000 });
    const w = PW - 2 * M, h = Math.min(105, w * c.height / c.width);
    const ww = h * c.width / c.height;
    y += 4;
    doc.addImage(c.toDataURL('image/jpeg', 0.85), 'JPEG', M + (w - ww) / 2, y, ww, h);
    y += h + 4;
    doc.setFontSize(8); doc.setTextColor(...GREY); doc.setFont('helvetica', 'normal');
    doc.text(`Fotograma en t = ${r.times[coverIdx].toFixed(3)} s con esqueleto y ángulos detectados automáticamente.`, M, y);
  }

  // ---------- resumen ----------
  newPage('Resumen ejecutivo');
  h2('Variables cuantitativas');
  const colX = [M, M + 72, M + 108, M + 135];
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...GREY);
  ['VARIABLE', 'VALOR', 'ESTADO', 'CONFIANZA'].forEach((t, k) => doc.text(t, colX[k], y));
  y += 2; doc.setDrawColor(...LINE); doc.line(M, y, PW - M, y); y += 4.5;
  for (const x of r.metrics) {
    ensure(9, 'Resumen ejecutivo');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...INK);
    doc.text(doc.splitTextToSize(x.label, 68)[0], colX[0], y);
    doc.setFont('helvetica', 'bold');
    if (x.value == null) { doc.setTextColor(...GREY); doc.text('No disponible', colX[1], y); }
    else doc.text(`${fmt(x.value, x.unit === 's' ? 2 : 1)} ${x.unit || ''}`, colX[1], y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...(x.status === 'medido' ? [21, 128, 61] : x.status === 'estimado' ? ACC : GREY));
    doc.text(x.status, colX[2], y);
    doc.setTextColor(...(x.confidence === 'baja' ? RED : INK));
    doc.text(x.confidence || '-', colX[3], y);
    y += 4;
    doc.setFontSize(7.5); doc.setTextColor(...GREY);
    const dl = doc.splitTextToSize(x.detail || '', PW - 2 * M);
    for (const ln of dl) { doc.text(ln, M, y); y += 3.3; }
    y += 1.2; doc.setDrawColor(...LINE); doc.line(M, y - 2, PW - M, y - 2); y += 2.5;
  }
  y += 3;
  ensure(30, 'Resumen ejecutivo');
  h2('Observaciones basadas en datos');
  const obs = r.observations.filter(o => o.priority !== 'info');
  if (!obs.length) para('No surgieron observaciones cuantitativas que superen los umbrales definidos (variabilidad entre ciclos > 8%, diferencia entre brazos > 10%).', 9.5, GREY);
  for (const o of obs) para(`${o.type} (prioridad ${o.priority}): ${o.text}`);
  y += 2;
  ensure(30, 'Resumen ejecutivo');
  h2('Errores técnicos');
  const fv = (f) => `${Number.isFinite(f.value) ? f.value.toFixed(f.unit === '°' || f.unit === '%' ? 1 : 0) : '-'}${f.unit === '°' ? '°' : ' ' + f.unit}${Number.isFinite(f.se) ? ` ± ${(1.96 * f.se).toFixed(1)}` : ''}`;
  const conf = faults.filter(f => f.decision === 'confirmado'), pend = faults.filter(f => !f.decision && (f.status === 'detectado' || f.status === 'posible'));
  if (!conf.length && !pend.length) para('Ningún error de la biblioteca quedó confirmado ni sugerido en este análisis. Solo se evalúan los errores que esta toma permite medir.', 9.5, GREY);
  for (const f of conf) para(`Confirmado por el entrenador · ${f.label}: ${fv(f)}${Number.isFinite(f.thr) ? ` (umbral ${f.thr})` : ''}.${f.note ? ` Nota: ${f.note}` : ''}`, 9.5, RED);
  for (const f of pend) para(`Sugerido, sin confirmar · ${f.label}: ${fv(f)} (umbral ${f.thr}, ${f.status}).`, 9, INK);
  const nm = faults.filter(f => f.status === 'no medible');
  if (nm.length) para(`No medibles con esta toma: ${nm.map(f => f.label.toLowerCase()).join(', ')}.`, 8.5, GREY);
  para('La app sugiere cada error con su medida, su margen y los cuadros que lo prueban; solo los confirmados por el entrenador son diagnóstico. Los cuadros de evidencia de los errores confirmados están en Fotogramas clave.', 8.5, GREY);
  if (velocity?.phases) {
    y += 2;
    ensure(40, 'Resumen ejecutivo');
    h2('Velocidad dentro del ciclo');
    const pm = (x) => Number.isFinite(x) ? ` ± ${(1.96 * x).toFixed(2)}` : '';
    para(`Ciclo completo: ${velocity.cycle.v.toFixed(2)} m/s${pm(velocity.cycle.se)}. Distancia por ciclo: ${velocity.dpc.v.toFixed(2)} m${pm(velocity.dpc.se)}. Variación dentro del ciclo: ${Number.isFinite(velocity.ivv) ? velocity.ivv.toFixed(0) + ' %' : '-'}.`, 9.5);
    for (const p of velocity.phases) para(`${p.label}: ${Number.isFinite(p.v) ? p.v.toFixed(2) : '-'} m/s${pm(p.se)} (${Number.isFinite(p.pct) ? p.pct.toFixed(0) : '-'} % del ciclo)`, 9, INK, 2);
    para(`Media de ${velocity.n} ciclos; ± es el margen del 95 % entre ciclos. Escala marcada en la toma (${velocity.scale.D} m), con ± ${(196 * velocity.scaleRel).toFixed(1)} % de error por marcarla; ruido de la posición del punto: ${(100 * velocity.sigmaX).toFixed(1)} cm. Si las marcas no están a la misma distancia de la cámara que el nadador, todas las velocidades se corren en la misma proporción.`, 8.5, GREY);
  }
  y += 2;
  ensure(30, 'Resumen ejecutivo');
  h2(`Certificado de la toma: grado ${cert.grade}`);
  para(cert.meaning, 9.5);
  for (const k of cert.checks) para(`${k.status === 'ok' ? 'Bien' : k.status === 'warn' ? 'Aviso' : 'Limita'} · ${k.label}: ${k.value}.${k.fix ? ` Próxima vez: ${k.fix}` : ''}`, 9, k.status === 'bad' ? RED : k.status === 'warn' ? INK : GREY, 2);
  y += 2;
  ensure(30, 'Resumen ejecutivo');
  h2('Limitaciones de la evaluación');
  for (const w of r.quality.warnings) para('• ' + w, 9, RED);
  for (const l of limitations) para('• ' + l, 9);

  // ---------- gráficos ----------
  newPage('Informe biomecánico');
  h2('Evolución temporal');
  para('Ángulos proyectados en el plano de la imagen, cuadro por cuadro. Línea continua: dato con confianza suficiente; punteada: interpolado (huecos de hasta 0,2 s); sin línea: articulación no visible. Las líneas verticales marcan el inicio de cada ciclo aceptado.', 8.5, GREY);
  const charts = [];
  const side = bestArm;
  const sname = side === 'L' ? 'izquierdo' : 'derecho';
  const okSeries = (id) => r.metrics.find(x => x.id === 'ang_' + id)?.status === 'estimado';
  if (okSeries('elbow' + side)) charts.push(['elbow' + side, `Codo ${sname}`]);
  if (okSeries('shoulder' + side)) charts.push(['shoulder' + side, `Hombro ${sname} (brazo-tronco)`]);
  const kneeSide = (r.angleSummary['kneeL']?.validFrames || 0) >= (r.angleSummary['kneeR']?.validFrames || 0) ? 'L' : 'R';
  if (okSeries('knee' + kneeSide)) charts.push(['knee' + kneeSide, `Rodilla ${kneeSide === 'L' ? 'izquierda' : 'derecha'}`]);
  if (okSeries('trunkIncl')) charts.push(['trunkIncl', 'Inclinación del tronco']);
  charts.push(['arm' + side, `Mano ${side === 'L' ? 'izquierda' : 'derecha'}: posición respecto del hombro (longitudes de tronco)`]);
  for (const [id, title] of charts) {
    ensure(52, 'Informe biomecánico');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...INK); doc.text(title, M, y); y += 2;
    const cv = document.createElement('canvas');
    renderChart(cv, r, id, null, light, { w: 1100, h: 260 });
    const w = PW - 2 * M, h = w * 260 / 1100;
    doc.addImage(cv.toDataURL('image/png'), 'PNG', M, y, w, h);
    y += h + 6;
  }

  // ---------- verificación con un ángulo conocido ----------
  if (angleChecks.length) {
    ensure(30, 'Informe biomecánico');
    h2('Verificación de los ángulos en esta toma');
    for (const c of angleChecks) para(`Ángulo real ${fmt(c.real, 1)}°, medido en el video ${fmt(c.measured, 1)}°: error ${c.err >= 0 ? '+' : ''}${fmt(c.err, 1)}°.`, 9);
    para('Algo con ángulo conocido filmado en la misma toma y marcado a mano. Indica el error de medir ángulos en el plano de esta cámara (perspectiva y lente); no incluye el error del modelo de pose al ubicar las articulaciones.', 8.5, GREY);
  }

  // ---------- fases de la brazada ----------
  if (phases && !phases.error && (phases.arms.L.n || phases.arms.R.n)) {
    ensure(60, 'Informe biomecánico');
    h2('Fases de la brazada');
    para('Eventos de Chollet a partir de la pose: entrada (la muñeca pasa por debajo del nivel del hombro), inicio de la tracción (mano más adelantada), mano bajo el hombro y salida (mano más atrasada). Margen de cada evento: ±1 cuadro. Valores medios de los ciclos completos con los cuatro eventos a la vista, ± desvío entre ciclos.', 8.5, GREY);
    const PC = [[42, 120, 214], [235, 104, 52], [27, 175, 122], [237, 161, 0]];
    for (const side of ['L', 'R']) {
      const a = phases.arms[side];
      if (!a.n) continue;
      ensure(34, 'Informe biomecánico');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...INK);
      doc.text(`Brazo ${side === 'L' ? 'izquierdo' : 'derecho'} · ${a.n} ciclo${a.n === 1 ? '' : 's'} · ciclo medio ${fmt(a.cycleDur, 2)} s`, M, y); y += 4;
      // barra con el reparto del ciclo
      let bx = M; const bw = PW - 2 * M;
      a.summary.forEach((x, k) => { const w = bw * x.pct / 100; doc.setFillColor(...PC[k]); doc.rect(bx, y, w, 6, 'F'); if (x.pct >= 9) { doc.setFontSize(7.5); doc.setTextColor(255, 255, 255); doc.text(`${fmt(x.pct, 0)} %`, bx + w / 2, y + 4.2, { align: 'center' }); } bx += w; });
      y += 10;
      doc.setFontSize(8.5);
      for (const [k, x] of a.summary.entries()) {
        doc.setFillColor(...PC[k]); doc.rect(M, y - 2.6, 3, 3, 'F');
        doc.setTextColor(...INK); doc.setFont('helvetica', 'normal');
        doc.text(x.label, M + 5, y);
        doc.text(`${fmt(x.dur, 2)} s${Number.isFinite(x.durSd) ? ` ±${fmt(x.durSd, 2)}` : ''}`, M + 60, y);
        doc.text(`${fmt(x.pct, 0)} % del ciclo${Number.isFinite(x.pctSd) ? ` ±${fmt(x.pctSd, 0)}` : ''}`, M + 100, y);
        y += 5;
      }
      y += 3;
    }
  }

  // ---------- momentos clave y articulaciones juntas ----------
  if (chartSel || moments.length) {
    ensure(70, 'Informe biomecánico');
    h2('Momentos clave');
    const ids = chartSel || ['knee' + kneeSide, 'hip' + kneeSide, 'elbow' + side, 'shoulder' + side].filter(id => r.angles[id]?.values.some(Number.isFinite));
    if (ids.length) {
      const cv = document.createElement('canvas');
      renderChart(cv, r, ids, null, { ...light, series: ids.length > 1 ? (chartColors || SERIES_COLORS.light) : null, moments: moments.map(m => ({ frame: m.frame, n: m.n })) }, { w: 1100, h: 300 });
      const w = PW - 2 * M, h = w * 300 / 1100;
      doc.addImage(cv.toDataURL('image/png'), 'PNG', M, y, w, h);
      y += h + 3;
      // leyenda: color y nombre de cada serie
      doc.setFontSize(8);
      let lx = M;
      ids.forEach((id, k) => {
        const hex = ids.length > 1 ? (chartColors || SERIES_COLORS.light)[k] : '#0a7aa8';
        doc.setFillColor(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16));
        doc.rect(lx, y - 2.4, 6, 2.4, 'F');
        doc.setTextColor(...INK); doc.text(SHORT[id] || id, lx + 8, y);
        lx += 10 + doc.getTextWidth(SHORT[id] || id) + 6;
      });
      y += 6;
    }
    if (moments.length) {
      const cols = usedCols(moments);
      const cw = Math.min(16, (PW - 2 * M - 62) / Math.max(1, cols.length));
      const cx = [M, M + 6, M + 44];
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...GREY);
      doc.text('#', cx[0], y); doc.text('MOMENTO', cx[1], y); doc.text('TIEMPO (s)', cx[2], y);
      cols.forEach((id, k) => doc.text(SHORT[id].toUpperCase(), M + 62 + k * cw, y, { maxWidth: cw - 1 }));
      y += 3.5; doc.setDrawColor(...LINE); doc.line(M, y, PW - M, y); y += 4.5;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...INK);
      for (const m of moments) {
        ensure(6, 'Informe biomecánico');
        doc.text(String(m.n), cx[0], y); doc.text(doc.splitTextToSize(m.label, 36)[0], cx[1], y); doc.text(fmt(m.t, 3), cx[2], y);
        cols.forEach((id, k) => { const a = m.angles[id]; doc.text(a ? `${fmt(a.v, 0)}°${a.interp ? '*' : ''}` : '-', M + 62 + k * cw, y); });
        y += 5;
      }
      if (flight && !flight.error) {
        y += 2; ensure(30, 'Informe biomecánico');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...INK); doc.text('Vuelo de la salida', M, y); y += 5;
        const z = (v) => (Math.abs(v) < 0.5 ? 0 : v);
        const kv = [['Tiempo de vuelo', `${fmt(flight.time, 2)} s (±${fmt(flight.frameDur, 3)})`], ['Ángulo de despegue (+ = subiendo)', `${fmt(z(flight.takeoff.deg), 0)}° ±${fmt(Math.max(1, flight.takeoff.err), 0)}`], ['Ángulo de entrada (- = bajando)', `${fmt(z(flight.entry.deg), 0)}° ±${fmt(Math.max(1, flight.entry.err), 0)}`]];
        if (flight.body) kv.push(['Cuerpo al entrar (línea cadera-mano)', `${fmt(z(flight.body.deg), 0)}° ±${fmt(Math.max(1, flight.body.err), 0)}`]);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
        for (const [k, v] of kv) { doc.setTextColor(...GREY); doc.text(k, M, y); doc.setTextColor(...INK); doc.text(v, M + 70, y); y += 5; }
        for (const w of flight.warn) para('• ' + w, 8.5, RED);
        para('Trayectoria de la cadera (punto medio de ambas) ajustada a una parábola entre el despegue y la entrada marcados. Ángulos en el plano de la imagen: válidos con toma lateral, cámara fija y nivelada.', 8, GREY);
      }
      para(`Tiempos con precisión de un cuadro (±${fmt(1 / m.fps, 3)} s). Ángulos 2D en el plano de la imagen; "-" = articulación no vista con confianza en ese cuadro; * = punto interpolado.`, 8, GREY);
    }
    y += 2;
  }

  // ---------- tabla de ciclos ----------
  ensure(40, 'Informe biomecánico');
  h2('Comparación entre ciclos');
  const pcs = r.perCycle.filter(p => p.side === side);
  if (!pcs.length) para('No hay ciclos completos aceptados para comparar.', 9.5, GREY);
  else {
    const cx = [M, M + 22, M + 52, M + 84, M + 116];
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...GREY);
    ['CICLO', 'INICIO (s)', 'DURACIÓN (s)', 'CODO MÍN. (°)', 'CODO MÁX. (°)'].forEach((t, k) => doc.text(t, cx[k], y));
    y += 2; doc.line(M, y, PW - M, y); y += 4.5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...INK);
    pcs.forEach((p, k) => {
      ensure(6, 'Informe biomecánico');
      [String(k + 1), fmt(p.tStart, 2), fmt(p.duration, 2), p.elbowMin != null ? fmt(p.elbowMin, 0) : '-', p.elbowMax != null ? fmt(p.elbowMax, 0) : '-'].forEach((t, j) => doc.text(t, cx[j], y));
      y += 5;
    });
    para(`Brazo ${sname}. Codo mínimo = máxima flexión observada en el plano de la imagen durante el ciclo.`, 8, GREY);
  }

  // ---------- fotogramas ----------
  const picks = [];
  for (const mo of moments.slice(0, 6)) picks.push([mo.frame, `${mo.n}. ${mo.label}`]);
  for (const f of faults.filter(f => f.decision === 'confirmado')) for (const fr of (f.frames || []).slice(0, 2)) if (Number.isInteger(fr) && fr >= 0) picks.push([fr, `Evidencia: ${f.label.toLowerCase()}`]);
  if (!moments.length) for (const c of accepted.slice(0, 2)) picks.push([c.start, 'Inicio de ciclo (mano adelantada)']);
  if (!moments.length) for (const p of pcs.filter(p => p.elbowMinFrame >= 0).slice(0, 2)) picks.push([p.elbowMinFrame, 'Máxima flexión de codo del ciclo']);
  if (!picks.length && detectedIdx.length) {
    for (const q of [0.2, 0.4, 0.6, 0.8]) picks.push([detectedIdx[Math.floor(q * (detectedIdx.length - 1))], 'Fotograma de muestra']);
  }
  if (picks.length) {
    newPage('Fotogramas anotados');
    h2('Fotogramas clave');
    const colW = (PW - 2 * M - 6) / 2;
    let col = 0, rowH = 0;
    for (const [i, label] of picks) {
      const c = await captureFrame(i, { maxWidth: 900 });
      const h = colW * c.height / c.width;
      if (col === 0) ensure(h + 12, 'Fotogramas anotados');
      const x = M + col * (colW + 6);
      doc.addImage(c.toDataURL('image/jpeg', 0.85), 'JPEG', x, y, colW, h);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GREY);
      doc.text(`${label} · t = ${r.times[i].toFixed(3)} s`, x, y + h + 4);
      rowH = Math.max(rowH, h + 10);
      col++;
      if (col === 2) { col = 0; y += rowH; rowH = 0; }
    }
    if (col) y += rowH;
  }
  footer();
  return doc.output('blob');
}
