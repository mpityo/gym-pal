/** Small SVG/HTML charts. No library. Colours come from CSS variables. */
import { h } from './util.js';
import { dayKey, weekStart, addDays } from './metrics.js';

const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of children.flat()) if (c) el.append(c);
  return el;
}

/** Line with a dot on the last point. values: numbers. */
export function sparkline(values, { width = 120, height = 32, label } = {}) {
  const vals = values.filter((v) => Number.isFinite(v));
  if (vals.length < 2) return h('span', { class: 'muted small' }, vals.length ? 'One session so far' : '—');
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const pad = 3;
  const pts = vals.map((v, i) => [pad + (i / (vals.length - 1)) * (width - pad * 2), height - pad - ((v - min) / span) * (height - pad * 2)]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [lx, ly] = pts[pts.length - 1];
  return s(
    'svg',
    { class: 'spark', viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': label ?? 'trend' },
    s('path', { d, fill: 'none', class: 'spark__line' }),
    s('circle', { cx: lx, cy: ly, r: 3, class: 'spark__dot' }),
  );
}

/** Vertical bars. items: [{ label, value, highlight, title }] */
export function bars(items, { height = 120, fmt = String } = {}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return h(
    'div',
    { class: 'bars', style: { height: `${height}px` } },
    items.map((i) =>
      h(
        'div',
        { class: `bars__col${i.highlight ? ' is-on' : ''}`, title: i.title ?? `${i.label}: ${fmt(i.value)}` },
        h('span', { class: 'bars__val' }, i.value ? fmt(i.value) : ''),
        h('span', { class: 'bars__bar', style: { height: `${Math.max(i.value ? 3 : 0, (i.value / max) * 100)}%` } }),
        h('span', { class: 'bars__label' }, i.label),
      ),
    ),
  );
}

/** Horizontal bars with an optional target tick. items: [{ label, value, note, target }] */
export function hbars(items, { max, target, fmt = String } = {}) {
  const top = max ?? Math.max(1, target ?? 0, ...items.map((i) => i.value));
  return h(
    'div',
    { class: 'hbars' },
    items.map((i) => {
      const t = i.target ?? target;
      const met = t != null && i.value >= t;
      return h(
        'div',
        { class: 'hbars__row' },
        h('span', { class: 'hbars__label' }, i.label),
        h(
          'span',
          { class: 'hbars__track' },
          h('span', { class: `hbars__fill${met ? ' is-met' : ''}`, style: { width: `${Math.min(100, (i.value / top) * 100)}%` } }),
          t != null && h('span', { class: 'hbars__target', style: { left: `${Math.min(100, (t / top) * 100)}%` } }),
        ),
        h('span', { class: 'hbars__val' }, fmt(i.value), i.note && h('span', { class: 'hbars__note' }, i.note)),
      );
    }),
  );
}

/** One stacked bar. parts: [{ label, value, cls }] */
export function split(parts, { fmt = String } = {}) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return h(
    'div',
    { class: 'split' },
    h(
      'div',
      { class: 'split__bar' },
      parts.filter((p) => p.value > 0).map((p) => h('span', { class: `split__seg ${p.cls}`, style: { width: `${(p.value / total) * 100}%` }, title: p.label })),
    ),
    h(
      'ul',
      { class: 'split__legend' },
      parts.map((p) =>
        h('li', {}, h('span', { class: `split__key ${p.cls}` }), h('span', {}, p.label), h('strong', {}, fmt(p.value)), h('span', { class: 'muted' }, `${Math.round((p.value / total) * 100)}%`)),
      ),
    ),
  );
}

/** GitHub-style calendar, Monday rows, last `weeks` weeks. cal: dayKey -> value */
export function heatmap(cal, { weeks = 16, now = Date.now() } = {}) {
  const start = addDays(weekStart(now), -7 * (weeks - 1));
  const vals = Object.values(cal);
  const max = Math.max(1, ...vals);
  const cols = [];
  for (let w = 0; w < weeks; w++) {
    const cells = [];
    for (let d = 0; d < 7; d++) {
      const ts = addDays(start, w * 7 + d);
      const v = cal[dayKey(ts)] ?? 0;
      const level = v ? Math.min(4, 1 + Math.floor((v / max) * 3.999)) : 0;
      cells.push(h('span', { class: `heat__cell l${level}${ts > now ? ' is-future' : ''}`, title: `${dayKey(ts)}${v > 1 ? `: ${Math.round(v).toLocaleString()} lb` : v ? ': cardio' : ''}` }));
    }
    cols.push(h('span', { class: 'heat__col' }, cells));
  }
  return h('div', { class: 'heat' }, h('span', { class: 'heat__days' }, ['M', '', 'W', '', 'F', '', 'S'].map((d) => h('span', {}, d))), cols);
}

export function zoneBar(zones) {
  const total = zones.reduce((a, z) => a + z.secs, 0) || 1;
  return h(
    'div',
    { class: 'zones' },
    h('div', { class: 'zones__bar' }, zones.map((z) => z.secs > 0 && h('span', { class: `zones__seg z${z.id}`, style: { width: `${(z.secs / total) * 100}%` }, title: `Zone ${z.id} ${z.name}` }))),
    h(
      'ul',
      { class: 'zones__legend' },
      zones.map((z) => h('li', {}, h('span', { class: `zones__key z${z.id}` }), `Z${z.id} ${z.name}`, h('strong', {}, `${Math.round(z.secs / 60)} min`))),
    ),
  );
}
