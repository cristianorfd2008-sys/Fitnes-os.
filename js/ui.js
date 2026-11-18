// Utilitários de interface. Todo texto do usuário entra via textContent (nunca innerHTML) — proteção contra XSS.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

let toastTimer;
export function toast(msg, kind = 'ok') {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  el.textContent = msg;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), 2600);
}

export const fmtDate = (d) => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
export const fmtDateLong = (d) => new Date(d).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
export const fmtNum = (n, digits = 1) => (Number.isFinite(n) ? (+n.toFixed(digits)).toLocaleString('pt-BR') : '–');
export const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

/** Gráfico de linha em SVG acessível. points: [{x: Date|string, y: number}] */
export function lineChart(points, { label = 'Gráfico', unit = '', height = 160, secondary = null } = {}) {
  const pts = points.filter((p) => Number.isFinite(p.y));
  if (pts.length < 2) return h('p', { class: 'muted small' }, 'Registre pelo menos 2 valores para ver o gráfico.');
  const W = 320, H = height, P = { l: 36, r: 10, t: 10, b: 22 };
  const xs = pts.map((p) => new Date(p.x).getTime());
  const all = [...pts.map((p) => p.y), ...(secondary ?? []).filter((p) => Number.isFinite(p.y)).map((p) => p.y)];
  let ymin = Math.min(...all), ymax = Math.max(...all);
  if (ymin === ymax) { ymin -= 1; ymax += 1; }
  const pad = (ymax - ymin) * 0.1; ymin -= pad; ymax += pad;
  const xmin = Math.min(...xs), xmax = Math.max(...xs) || xmin + 1;
  const X = (t) => P.l + ((t - xmin) / (xmax - xmin || 1)) * (W - P.l - P.r);
  const Y = (v) => P.t + (1 - (v - ymin) / (ymax - ymin)) * (H - P.t - P.b);
  const path = (arr) => arr.map((p, i) => `${i ? 'L' : 'M'}${X(new Date(p.x).getTime()).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  const ticks = [ymin + pad, (ymin + ymax) / 2, ymax - pad];
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${label}: ${pts.length} pontos, de ${fmtNum(pts[0].y)} a ${fmtNum(pts.at(-1).y)} ${unit}`, class: 'chart' },
    ...ticks.map((t) => s('g', {}, s('line', { x1: P.l, x2: W - P.r, y1: Y(t), y2: Y(t), class: 'grid' }), s('text', { x: P.l - 4, y: Y(t) + 3, 'text-anchor': 'end', class: 'axis' }, fmtNum(t)))),
    s('text', { x: P.l, y: H - 6, class: 'axis' }, fmtDate(xmin)),
    s('text', { x: W - P.r, y: H - 6, 'text-anchor': 'end', class: 'axis' }, fmtDate(xmax)),
    secondary && secondary.length > 1 ? s('path', { d: path(secondary.filter((p) => Number.isFinite(p.y))), class: 'line2' }) : null,
    s('path', { d: path(pts), class: 'line' }),
    ...pts.map((p) => s('circle', { cx: X(new Date(p.x).getTime()), cy: Y(p.y), r: 2.5, class: 'dot' }, s('title', {}, `${fmtDate(p.x)}: ${fmtNum(p.y)} ${unit}`))),
  );
  return svg;
}

/** Gráfico de barras simples. bars: [{label, value}] */
export function barChart(bars, { label = 'Gráfico', height = 120 } = {}) {
  const W = 320, H = height, P = { l: 6, r: 6, t: 14, b: 18 };
  const max = Math.max(1, ...bars.map((b) => b.value));
  const bw = (W - P.l - P.r) / bars.length;
  return s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${label}: ${bars.map((b) => `${b.label} ${b.value}`).join(', ')}`, class: 'chart' },
    ...bars.map((b, i) => {
      const bh = (b.value / max) * (H - P.t - P.b);
      const x = P.l + i * bw + bw * 0.15;
      return s('g', {},
        s('rect', { x, y: H - P.b - bh, width: bw * 0.7, height: Math.max(bh, 0), rx: 3, class: 'bar' }),
        s('text', { x: x + bw * 0.35, y: H - P.b - bh - 3, 'text-anchor': 'middle', class: 'axis' }, b.value || ''),
        s('text', { x: x + bw * 0.35, y: H - 5, 'text-anchor': 'middle', class: 'axis' }, b.label));
    }));
}
