// Cómo filmar según lo que se mide: dónde va el celular, a qué altura y distancia, qué tiene que verse y
// qué mide bien cada toma (y qué no). Se muestra al lado de donde se elige el video.
import { GUIDE } from './fpsguide.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Dibujos esquemáticos: el celular en naranja, la línea de mira punteada.
const CEL = (x, y, r = 0) => `<g transform="translate(${x} ${y}) rotate(${r})"><rect x="-7" y="-11" width="14" height="22" rx="3" fill="#FF6B35"/><circle cx="0" cy="-6" r="2" fill="#121017"/></g>`;
const SVG = {
  pileta: `<svg viewBox="0 0 260 120" role="img" aria-label="Vista de arriba de la pileta: el celular al costado del andarivel, mirando al nadador de lado; otro al final, mirándolo de frente">
    <rect x="20" y="30" width="200" height="44" rx="3" fill="#1D3B4A" stroke="#7DD6C0" stroke-width="1"/>
    <text x="24" y="24" font-size="9" fill="#8B8698">andarivel (vista de arriba)</text>
    <ellipse cx="110" cy="52" rx="20" ry="6" fill="#F4F1EA"/><path d="M134 52 l10 0 m-4 -4 l4 4 l-4 4" stroke="#F4F1EA" stroke-width="2" fill="none"/>
    <path d="M110 60 V96" stroke="#FF6B35" stroke-dasharray="4 3"/>${CEL(110, 104)}
    <text x="124" y="108" font-size="9" fill="#FF6B35">lateral: a 90°, 3 a 5 m</text>
    <path d="M232 52 H146" stroke="#8B8698" stroke-dasharray="4 3"/>${CEL(240, 52, 90)}
    <text x="186" y="20" font-size="9" fill="#8B8698">frontal</text></svg>`,
  prueba: `<svg viewBox="0 0 260 120" role="img" aria-label="La cámara en trípode en la tribuna, a la altura de la mitad de la pileta, encuadrando de pared a pared">
    <rect x="20" y="20" width="220" height="50" rx="3" fill="#1D3B4A" stroke="#7DD6C0" stroke-width="1"/>
    <path d="M130 20 V70" stroke="#7DD6C0" stroke-dasharray="2 3"/><text x="134" y="30" font-size="9" fill="#7DD6C0">25 m</text>
    <path d="M130 98 L22 70 M130 98 L238 70" stroke="#FF6B35" stroke-dasharray="4 3"/>${CEL(130, 104)}
    <text x="146" y="110" font-size="9" fill="#FF6B35">trípode, elevado, de pared a pared</text></svg>`,
  barra: `<svg viewBox="0 0 260 120" role="img" aria-label="Vista de costado: el celular en trípode a 2 o 3 metros, a la altura del disco, mirando el disco de frente">
    <circle cx="70" cy="22" r="7" fill="#F4F1EA"/><path d="M70 30 V66 M70 66 L60 100 M70 66 L80 100 M70 40 L58 50" stroke="#F4F1EA" stroke-width="3" fill="none"/>
    <circle cx="70" cy="44" r="18" fill="none" stroke="#7DD6C0" stroke-width="4"/>
    <path d="M90 44 H206" stroke="#FF6B35" stroke-dasharray="4 3"/>${CEL(214, 44, 90)}<path d="M214 56 L204 104 M214 56 L224 104 M214 56 V104" stroke="#8B8698"/>
    <path d="M70 112 H214" stroke="#8B8698"/><text x="128" y="108" font-size="9" fill="#8B8698">2 a 3 m</text>
    <text x="120" y="38" font-size="9" fill="#FF6B35">a la altura del disco</text></svg>`,
  salto: `<svg viewBox="0 0 260 120" role="img" aria-label="Dos opciones: el celular de costado a 2 o 3 metros con el cuerpo entero, o de frente, apoyado en el piso, mirando los pies">
    <circle cx="90" cy="18" r="7" fill="#F4F1EA"/><path d="M90 26 V62 M90 62 L82 96 M90 62 L98 96 M90 36 L78 48 M90 36 L102 48" stroke="#F4F1EA" stroke-width="3" fill="none"/>
    <path d="M10 100 H250" stroke="#8B8698"/>
    <path d="M112 70 H200" stroke="#FF6B35" stroke-dasharray="4 3"/>${CEL(208, 70, 90)}<path d="M208 82 L200 100 M208 82 L216 100" stroke="#8B8698"/>
    <text x="146" y="62" font-size="9" fill="#FF6B35">de costado, 2 a 3 m</text>
    <path d="M90 96 L30 96" stroke="#8B8698" stroke-dasharray="4 3"/>${CEL(22, 94, -90)}
    <text x="8" y="114" font-size="9" fill="#8B8698">de frente, en el piso, 1,5 a 2 m</text></svg>`,
};

// Para cada medición: tomas posibles (la primera es la recomendada) y lo que vale para todas.
const G = {
  tech: {
    svg: 'pileta',
    tomas: [
      { id: 'lateral-subacuatica', name: 'De costado, bajo el agua', donde: 'Celular en funda estanca (o GoPro) a 30 a 50 cm bajo la superficie, quieto (pegado a la pared o en un palo), a 90° del andarivel y a 3 a 5 m del nadador.', sirve: 'Ángulos de codo, rodilla y cadera, tracción, patada, ciclos y fases. Es la mejor para la técnica.', no: 'La simetría entre lado izquierdo y derecho.' },
      { id: 'lateral-superficie', name: 'De costado, desde el borde', donde: 'Desde el borde, a 90° del andarivel, a 3 a 5 m, con el celular quieto y bajo (cerca del agua).', sirve: 'Frecuencia y ritmo de brazada, recobro, cabeza y respiración.', no: 'Lo que pasa bajo el agua se ve mal por los reflejos: los ángulos de la tracción son menos precisos.' },
      { id: 'frontal', name: 'De frente', donde: 'Desde la pared hacia la que nada, centrado en su andarivel (sobre el agua o bajo el agua).', sirve: 'Entrada de la mano, cruce de la línea media, simetría, rolido y ancho de la patada de pecho.', no: 'Ángulos de codo y rodilla vistos de lado, ni velocidad.' },
      { id: 'posterior', name: 'De atrás o desde arriba', donde: 'Desde la pared de salida (de atrás) o desde la tribuna (arriba). Son tomas que complementan.', sirve: 'Patada (de atrás) y recorrido de la mano (desde arriba).', no: 'Ángulos ni fases con precisión.' },
    ],
    siempre: ['Celular quieto: nada de seguir al nadador con la mano.', 'Que el nadador se vea entero y lo más grande posible.', 'Buena luz y sin sol de frente.', `Cuadros por segundo: ${GUIDE.tech.rec} (mínimo ${GUIDE.tech.min}); salidas y virajes en cámara lenta, ${GUIDE.start.rec} (mínimo ${GUIDE.start.min}).`],
  },
  race: {
    svg: 'prueba',
    tomas: [
      { id: 'lateral', name: 'De costado, desde la tribuna', donde: 'Celular en trípode, elevado (tribuna o escalera), a la altura de la mitad de la pileta (25 m en una de 50) y encuadrando de pared a pared.', sirve: 'Salida, parciales, virajes, llegada, velocidad por tramo, frecuencia y largo de brazada.', no: 'Ángulos del cuerpo: para eso, una toma de técnica más cerca.' },
      { id: 'salidas', name: 'Salidas y virajes', donde: 'De costado, a 90° de la pileta, a la altura de los 5 m de la pared, en cámara lenta.', sirve: 'Tiempo de reacción, vuelo, entrada, nado subacuático y tiempo de viraje.', no: 'El resto de la prueba.' },
    ],
    siempre: ['Cámara fija: si se mueve, las marcas de distancia dejan de coincidir.', 'Que se vean las paredes y, si se puede, las marcas de 5 y 15 m.', `Cuadros por segundo: ${GUIDE.race.rec} (mínimo ${GUIDE.race.min}).`],
  },
  bar: {
    svg: 'barra',
    tomas: [
      { id: 'lateral', name: 'De costado (la única que sirve)', donde: 'Celular en trípode a 2 a 3 m, a la altura del disco, mirando el disco de frente (a 90° de la barra), sin zoom.', sirve: 'Velocidad media y pico de cada repetición, recorrido, pérdida de velocidad, RM estimado.', no: '' },
      { id: 'frontal', name: 'De frente o en diagonal: no', donde: '', sirve: '', no: 'El disco no se ve redondo y la barra se acerca y se aleja de la cámara: la velocidad sale mal.' },
    ],
    siempre: ['El disco entero a la vista en todo el recorrido, sin que lo tape el cuerpo ni el rack.', 'Celular quieto (trípode o apoyado).', `Cuadros por segundo: ${GUIDE.bar.rec} (mínimo ${GUIDE.bar.min}).`],
  },
  jump: {
    svg: 'salto',
    tomas: [
      { id: 'lateral', name: 'De costado', donde: 'A 2 a 3 m, celular a la altura de las rodillas o de la cadera, con el cuerpo entero y el piso en cuadro.', sirve: 'Tiempo de vuelo y altura; es la mejor para el marcado automático (ve tobillos, talones y puntas).', no: '' },
      { id: 'frontal', name: 'De frente (como My Jump)', donde: 'Celular apoyado en el piso o a 10 a 20 cm, a 1,5 a 2 m, mirando los pies.', sirve: 'Tiempo de vuelo y altura: se ve muy bien cuándo despega y apoya cada pie, ideal para marcar a mano.', no: 'El marcado automático puede fallar si no se ve la cadera.' },
    ],
    siempre: ['Celular quieto y los pies siempre en cuadro, también en el aire.', 'Cámara lenta del celular: 240 (mínimo 120). No por WhatsApp.', 'Que caiga en el mismo lugar del que despegó, con las piernas estiradas.'],
  },
};

export function filmGuide(kind, selected = '') {
  const g = G[kind];
  if (!g) return '';
  const toma = (t, k) => `<li class="fg-toma${t.id === selected ? ' sel' : ''}"><b>${esc(t.name)}</b>${k === 0 && t.sirve ? ' <span class="pill">recomendada</span>' : ''}
    ${t.donde ? `<span><i>Dónde:</i> ${esc(t.donde)}</span>` : ''}${t.sirve ? `<span><i>Sirve para:</i> ${esc(t.sirve)}</span>` : ''}${t.no ? `<span><i>${t.sirve ? 'No sirve para' : 'Por qué'}:</i> ${esc(t.no)}</span>` : ''}</li>`;
  return `<details class="film-guide"><summary>📹 Cómo filmar</summary>
    <div class="fg-dib">${SVG[g.svg]}</div>
    <ul class="fg-tomas">${g.tomas.map(toma).join('')}</ul>
    <p class="fine-label">Siempre</p><ul class="fg-siempre">${g.siempre.map(s => `<li>${esc(s)}</li>`).join('')}</ul></details>`;
}
