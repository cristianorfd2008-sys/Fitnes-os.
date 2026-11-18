// FITNESS OS — aplicação (roteamento, telas e ações).
import * as db from './db.js';
import { LIBRARY, MUSCLES } from './library.js';
import {
  uid, parseNum, suggestProgression, exerciseHistory, detectStagnation, setsPerMuscle,
  sessionsPerWeek, readinessFlags, bestE1RM, tonnage, painAlerts,
} from './logic.js';
import { TEMPLATES } from './templates.js';
import { h, toast, fmtDate, fmtDateLong, fmtNum, todayISO, lineChart, barChart } from './ui.js';

// ---------- Estado em memória (cache do IndexedDB; o banco é a fonte de verdade) ----------
const state = { exercises: [], programs: [], sessions: [], bodyMetrics: [], checkins: [], settings: {} };

async function loadAll() {
  const [exercises, programs, sessions, bodyMetrics, checkins, settings] = await Promise.all([
    db.getAll('exercises'), db.getAll('programs'), db.getAll('sessions'), db.getAll('bodyMetrics'), db.getAll('checkins'),
    db.getMeta('settings', {}),
  ]);
  Object.assign(state, { exercises, programs, sessions, bodyMetrics, checkins, settings: { increment: 2.5, defaultRest: 120, ...settings } });
}

const allExercises = () => [...LIBRARY, ...state.exercises];
const exerciseById = (id) => allExercises().find((e) => e.id === id);
const exName = (id) => exerciseById(id)?.name ?? `Exercício removido (${id})`;
const activeProgram = () => state.programs.find((p) => p.active) ?? null;
const doneSessions = () => state.sessions.filter((s) => s.status === 'done').sort((a, b) => new Date(a.finishedAt) - new Date(b.finishedAt));
const openSession = () => state.sessions.find((s) => s.status === 'active') ?? null;

async function save(store, rec) {
  await db.put(store, rec);
  const list = state[store];
  const i = list.findIndex((r) => r.id === rec.id);
  if (i >= 0) list[i] = rec; else list.push(rec);
  return rec;
}
async function remove(store, id) {
  await db.del(store, id);
  state[store] = state[store].filter((r) => r.id !== id);
}

// ---------- Roteamento ----------
const routes = {
  '': renderDashboard, painel: renderDashboard, treino: renderWorkout, historico: renderHistory, sessao: renderSessionDetail,
  corpo: renderBody, checkin: renderCheckin, programa: renderProgram, biblioteca: renderLibrary, exercicio: renderExercise,
  dados: renderData, mais: renderMore,
};
const NAV = [
  ['painel', 'Painel', 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z'],
  ['treino', 'Treino', 'M20.6 14.9l1.4-1.4-1.4-1.4-3.6 3.6-8.5-8.5 3.6-3.6L10.7 2 9.3 3.4 7.9 2 5.8 4.1 4.4 2.7 3 4.1l1.4 1.4L2 7.6 3.4 9l1.4-1.4 3.6 3.6-3.6 3.6L6.2 16l1.4-1.4L9 16l1.4 1.4 2.1-2.1 3.5 3.5-3.6 3.6 1.4 1.4 1.4-1.4 1.4 1.4 2.1-2.1 1.4 1.4 1.4-1.4-1.4-1.4 2.1-2.1z'],
  ['historico', 'Histórico', 'M13 3a9 9 0 0 0-9 9H1l3.9 3.9L9 12H6a7 7 0 1 1 2 4.9l-1.4 1.4A9 9 0 1 0 13 3zm-1 5v5l4.3 2.5.7-1.2-3.5-2.1V8z'],
  ['corpo', 'Corpo', 'M12 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm9 7h-6v13h-2v-6h-2v6H9V9H3V7h18v2z'],
  ['mais', 'Mais', 'M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z'],
];

function parseHash() {
  const [path, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  return { path, params: rest.map(decodeURIComponent) };
}

async function render() {
  const { path, params } = parseHash();
  const fn = routes[path] ?? renderDashboard;
  const main = document.getElementById('main');
  main.replaceChildren();
  try {
    const view = await fn(...params);
    main.append(view);
  } catch (err) {
    console.error(err);
    main.append(h('div', { class: 'card alert' }, h('h2', {}, 'Algo deu errado'), h('p', {}, String(err.message ?? err))));
  }
  const top = ['treino', 'historico', 'corpo'].includes(path) ? path : ['sessao'].includes(path) ? 'historico' : ['', 'painel'].includes(path) ? 'painel' : 'mais';
  document.querySelectorAll('#nav a').forEach((a) => a.setAttribute('aria-current', a.dataset.route === top ? 'page' : 'false'));
  main.focus({ preventScroll: true });
  renderTimer();
}

const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };
const page = (title, ...children) => h('section', { class: 'page' }, h('h1', {}, title), ...children);
const card = (...children) => h('div', { class: 'card' }, ...children);
const btn = (label, onclick, cls = '') => h('button', { type: 'button', class: `btn ${cls}`, onclick }, label);

/** Botão de exclusão em dois toques (sem diálogos nativos). */
function confirmBtn(label, onConfirm) {
  let armed = false, t;
  const b = btn(label, async () => {
    if (!armed) { armed = true; b.textContent = 'Toque de novo para confirmar'; b.classList.add('armed'); t = setTimeout(() => { armed = false; b.textContent = label; b.classList.remove('armed'); }, 4000); return; }
    clearTimeout(t); await onConfirm();
  }, 'danger');
  return b;
}

// ---------- Painel ----------
function renderDashboard() {
  const prog = activeProgram();
  const done = doneSessions();
  const open = openSession();
  const nextDay = prog ? nextProgramDay(prog) : null;
  const lastCheckin = [...state.checkins].sort((a, b) => b.date.localeCompare(a.date))[0];
  const flags = lastCheckin && lastCheckin.date >= isoDaysAgo(2) ? readinessFlags(lastCheckin) : [];
  const weeks = sessionsPerWeek(state.sessions, new Date(), 8);
  const last7 = done.filter((s) => new Date(s.finishedAt) >= daysAgo(7));
  const vol = setsPerMuscle(last7, exerciseById);
  const stagn = stagnationAlerts();
  const pain = painAlerts(done.filter((s) => new Date(s.finishedAt) >= daysAgo(14)), exName);

  return page('Painel',
    !prog && card(h('h2', {}, 'Comece por aqui'),
      h('p', {}, 'Nenhum programa ativo. Crie a sua ficha atual em Programa para começar a registrar treinos. O programa definitivo será montado depois da sua avaliação individual.'),
      btn('Criar programa', () => go('#/programa'), 'primary')),
    open && card(h('h2', {}, 'Treino em andamento'), h('p', {}, `${open.dayName} — iniciado ${fmtDateLong(open.startedAt)}`), btn('Continuar treino', () => go('#/treino'), 'primary')),
    prog && !open && card(h('h2', {}, 'Próxima sessão'), h('p', { class: 'big' }, nextDay?.name ?? '—'),
      h('p', { class: 'muted small' }, `${prog.name} · ${nextDay?.items.length ?? 0} exercícios`),
      nextDay && btn('Iniciar treino', () => startSession(prog, nextDay), 'primary')),
    flags.length > 0 && card(h('h2', {}, 'Alertas do check-in'), h('ul', { class: 'flags' }, flags.map((f) => h('li', { class: f.level }, f.text)))),
    pain.length > 0 && card(h('h2', {}, 'Dor registrada recentemente'),
      h('ul', { class: 'flags' }, pain.map((p) => h('li', { class: p.level }, h('strong', {}, p.name), ` — ${p.text}`))),
      h('p', { class: 'muted small' }, 'Procure avaliação profissional se a dor durar depois do treino, aparecer à noite, vier com formigamento/fraqueza ou se repetir.')),
    stagn.length > 0 && card(h('h2', {}, 'Possível estagnação'),
      h('ul', { class: 'flags' }, stagn.map((a) => h('li', { class: 'warn' }, h('strong', {}, a.name), ' — ', a.reason))),
      h('p', { class: 'muted small' }, 'Critério: melhor 1RM estimado das 3 últimas sessões não supera o recorde anterior, em ≥ 14 dias. É um sinal para revisar sono, esforço e técnica, não uma ordem para mudar o programa.')),
    card(h('h2', {}, 'Frequência semanal'), barChart(weeks.map((w) => ({ label: fmtDate(w.weekStart).slice(0, 5), value: w.count })), { label: 'Sessões por semana' }),
      h('p', { class: 'muted small' }, `${done.length} ${done.length === 1 ? "sessão registrada" : "sessões registradas"} no total.`)),
    card(h('h2', {}, 'Séries efetivas — últimos 7 dias'),
      Object.keys(vol).length
        ? h('table', { class: 'table' }, h('tbody', {}, Object.entries(vol).sort((a, b) => b[1] - a[1]).map(([m, n]) => h('tr', {}, h('td', {}, MUSCLES[m] ?? m), h('td', { class: 'num' }, fmtNum(n))))))
        : h('p', { class: 'muted' }, 'Sem séries registradas nos últimos 7 dias.'),
      h('p', { class: 'muted small' }, 'Conta séries concluídas com RIR ≤ 4. Músculo principal = 1; secundários = 0,5 (convenção, ver DECISIONS.md).')),
    card(h('h2', {}, 'Recentes'), recentList(done.slice(-3).reverse())),
  );
}

function recentList(list) {
  if (!list.length) return h('p', { class: 'muted' }, 'Nenhuma sessão concluída ainda.');
  return h('ul', { class: 'list' }, list.map((s) => h('li', {}, h('a', { href: `#/sessao/${s.id}` },
    h('span', {}, s.dayName), h('span', { class: 'muted small' }, `${fmtDateLong(s.finishedAt)} · ${countDoneSets(s)} séries`)))));
}

const countDoneSets = (s) => s.entries.reduce((a, e) => a + e.sets.filter((x) => x.done).length, 0);
const daysAgo = (n) => new Date(Date.now() - n * 86400000);
const isoDaysAgo = (n) => { const d = daysAgo(n); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

function nextProgramDay(prog) {
  if (!prog.days.length) return null;
  const last = doneSessions().filter((s) => s.programId === prog.id).at(-1);
  if (!last) return prog.days[0];
  const idx = prog.days.findIndex((d) => d.id === last.dayId);
  return prog.days[(idx + 1) % prog.days.length];
}

function stagnationAlerts() {
  const ids = new Set(doneSessions().flatMap((s) => s.entries.map((e) => e.exerciseId)));
  const out = [];
  for (const id of ids) {
    const r = detectStagnation(exerciseHistory(state.sessions, id));
    if (r.stagnant) out.push({ id, name: exName(id), reason: r.reason });
  }
  return out;
}

// ---------- Treino ----------
async function startSession(prog, day) {
  if (openSession()) return go('#/treino');
  const sess = {
    id: uid('ses'), programId: prog.id, dayId: day.id, dayName: day.name, startedAt: new Date().toISOString(), finishedAt: null,
    status: 'active', notes: '',
    entries: day.items.map((it) => ({
      exerciseId: it.exerciseId, plan: { sets: it.sets, repMin: it.repMin, repMax: it.repMax, rir: it.rir, restSec: it.restSec, notes: it.notes ?? '' },
      sets: Array.from({ length: it.sets }, () => prefillSet(it)), notes: '',
    })),
  };
  await save('sessions', sess);
  toast('Treino iniciado');
  go('#/treino');
}

function prefillSet(item) {
  const last = exerciseHistory(state.sessions, item.exerciseId).at(-1);
  const sug = suggestProgression(item, last?.sets.map((s) => ({ ...s, done: true })), { increment: state.settings.increment });
  return { load: sug.load ?? null, reps: null, rir: null, done: false };
}

function renderWorkout() {
  const open = openSession();
  if (open) return renderSessionEditor(open, { live: true });
  const prog = activeProgram();
  if (!prog) return page('Treino', card(h('p', {}, 'Crie e ative um programa para iniciar treinos.'), btn('Ir para Programa', () => go('#/programa'), 'primary')));
  const next = nextProgramDay(prog);
  return page('Treino', h('p', { class: 'muted' }, `Programa: ${prog.name}`),
    ...prog.days.map((d) => card(
      h('div', { class: 'row between' }, h('h2', {}, d.name), d.id === next?.id ? h('span', { class: 'pill' }, 'Próximo') : null),
      h('ul', { class: 'plain small' }, d.items.map((it) => h('li', {}, `${exName(it.exerciseId)} — ${it.sets}×${it.repMin}–${it.repMax} @RIR ${it.rir}`))),
      btn(`Iniciar ${d.name}`, () => startSession(prog, d), d.id === next?.id ? 'primary' : ''))));
}

function renderSessionEditor(sess, { live }) {
  const persist = () => save('sessions', sess);
  const wrap = h('section', { class: 'page' },
    h('div', { class: 'row between' }, h('h1', {}, sess.dayName), h('span', { class: 'muted small' }, fmtDateLong(sess.startedAt))));

  sess.entries.forEach((entry, ei) => {
    const plan = entry.plan ?? {};
    const prevHist = exerciseHistory(state.sessions.filter((s) => s.id !== sess.id), entry.exerciseId);
    const prev = prevHist.at(-1);
    const sug = suggestProgression(plan, prev?.sets.map((s) => ({ ...s, done: true })), { increment: state.settings.increment });
    const body = h('div', { class: 'sets' });
    const drawSets = () => {
      body.replaceChildren(
        h('div', { class: 'set head', 'aria-hidden': 'true' }, h('span', {}, '#'), h('span', {}, 'kg'), h('span', {}, 'reps'), h('span', {}, 'RIR'), h('span', {}, '')),
        ...entry.sets.map((set, si) => setRow(entry, set, si, plan, async ({ toggled = false, startRest = false } = {}) => {
          await persist();
          if (startRest && live) startTimer(plan.restSec || state.settings.defaultRest, exName(entry.exerciseId));
          // Só redesenha ao concluir/desmarcar: redesenhar ao digitar trocaria o botão sob o dedo e perderia o toque.
          if (toggled) drawSets();
        })),
        h('div', { class: 'row gap' },
          btn('+ Série', async () => { const last = entry.sets.at(-1); entry.sets.push({ load: last?.load ?? null, reps: null, rir: null, done: false }); await persist(); drawSets(); }, 'ghost small'),
          entry.sets.length > 0 && btn('− Série', async () => { entry.sets.pop(); await persist(); drawSets(); }, 'ghost small')),
      );
    };
    drawSets();
    wrap.append(h('div', { class: 'card exercise', dataset: { ex: entry.exerciseId } },
      h('div', { class: 'row between' }, h('h2', {}, h('a', { href: `#/exercicio/${entry.exerciseId}` }, exName(entry.exerciseId))), h('span', { class: 'muted small' }, `${ei + 1}/${sess.entries.length}`)),
      h('p', { class: 'small' }, `Meta: ${plan.sets ?? '–'}×${plan.repMin ?? '–'}–${plan.repMax ?? '–'} reps · RIR ${plan.rir ?? '–'} · descanso ${fmtRest(plan.restSec)}`),
      plan.notes ? h('p', { class: 'small muted' }, plan.notes) : null,
      h('details', { class: 'suggest' }, h('summary', {}, prev ? `Última vez (${fmtDate(prev.date)}): ${prev.sets.map((x) => `${fmtNum(x.load)}×${x.reps}`).join(', ')}` : 'Sem histórico'),
        h('p', { class: 'small' }, h('strong', {}, 'Sugestão: '), sug.reasoning),
        sug.dataUsed.length ? h('p', { class: 'small muted' }, `Dados usados: ${sug.dataUsed.join('; ')}`) : null,
        h('p', { class: 'small muted' }, `Limitações: ${sug.limitations.join(' ')}`)),
      body,
      h('label', { class: 'field' }, h('span', {}, 'Dor/desconforto articular neste exercício (0–10)'),
        h('select', { 'aria-label': `Dor em ${exName(entry.exerciseId)}`, onchange: async (e) => {
          entry.pain = e.target.value === '' ? null : Number(e.target.value); await persist();
          if (entry.pain >= 4) toast('Dor 4+: pare este exercício e use a alternativa.', 'err');
          else if (entry.pain === 3) toast('Dor 3: reduza carga ou amplitude e não aumente a carga.');
        } }, h('option', { value: '' }, '—'), Array.from({ length: 11 }, (_, n) => h('option', { value: n, selected: entry.pain === n }, n)))),
      h('label', { class: 'field' }, h('span', {}, 'Observações do exercício'),
        h('textarea', { rows: 1, value: entry.notes ?? '', onchange: async (e) => { entry.notes = e.target.value.slice(0, 1000); await persist(); } }))));
  });

  wrap.append(card(h('label', { class: 'field' }, h('span', {}, 'Observações da sessão'),
    h('textarea', { rows: 2, value: sess.notes ?? '', onchange: async (e) => { sess.notes = e.target.value.slice(0, 2000); await persist(); } }))));

  if (live) {
    wrap.append(h('div', { class: 'row gap' },
      btn('Concluir treino', async () => {
        const n = countDoneSets(sess);
        if (!n) return toast('Marque pelo menos uma série como concluída.', 'err');
        sess.status = 'done'; sess.finishedAt = new Date().toISOString();
        await persist(); stopTimer(); toast(`Treino concluído: ${n} séries`); go(`#/sessao/${sess.id}`);
      }, 'primary'),
      confirmBtn('Descartar', async () => { await remove('sessions', sess.id); stopTimer(); toast('Treino descartado'); go('#/treino'); })));
  } else {
    wrap.append(h('div', { class: 'row gap' }, btn('Salvar e voltar', () => { toast('Alterações salvas'); go(`#/sessao/${sess.id}`); }, 'primary')));
  }
  return wrap;
}

const fmtRest = (sec) => (sec ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : '–');

function setRow(entry, set, si, plan, onChange) {
  const input = (kind, key, ph, mode = 'decimal') => h('input', {
    type: 'text', inputmode: mode, class: 'num-in', placeholder: ph, value: set[key] ?? '',
    'aria-label': `Série ${si + 1} ${kind === 'load' ? 'carga em kg' : kind === 'reps' ? 'repetições' : 'RIR'}`,
    onchange: async (e) => {
      const v = parseNum(e.target.value, kind);
      if (Number.isNaN(v)) { e.target.setAttribute('aria-invalid', 'true'); toast('Valor inválido', 'err'); return; }
      e.target.removeAttribute('aria-invalid');
      set[key] = v; await onChange();
    },
  });
  return h('div', { class: `set${set.done ? ' done' : ''}` },
    h('span', { class: 'idx' }, si + 1),
    input('load', 'load', '0'), input('reps', 'reps', plan.repMin ? `${plan.repMin}–${plan.repMax}` : '0', 'numeric'), input('rir', 'rir', String(plan.rir ?? ''), 'numeric'),
    h('button', {
      type: 'button', class: `check${set.done ? ' on' : ''}`, 'aria-pressed': String(!!set.done), 'aria-label': `Concluir série ${si + 1}`,
      onclick: async (e) => {
        // Lê os campos diretamente (o evento change pode ainda não ter disparado).
        const row = e.currentTarget.closest('.set');
        const [loadIn, repsIn, rirIn] = row.querySelectorAll('input');
        const vals = { load: parseNum(loadIn.value, 'load'), reps: parseNum(repsIn.value, 'reps'), rir: parseNum(rirIn.value, 'rir') };
        if (Object.values(vals).some(Number.isNaN)) return toast('Corrija os valores inválidos.', 'err');
        if (!set.done && !Number.isFinite(vals.reps)) return toast('Informe as repetições.', 'err');
        Object.assign(set, vals);
        set.done = !set.done; set.ts = new Date().toISOString();
        await onChange({ toggled: true, startRest: set.done });
      },
    }, '✓'));
}

// ---------- Cronômetro de descanso (persistente via timestamp) ----------
let timerTick = null;
function startTimer(sec, label) {
  const t = { endAt: Date.now() + sec * 1000, total: sec, label };
  db.setMeta('timer', t); state.timer = t; renderTimer();
}
function stopTimer() { state.timer = null; db.setMeta('timer', null); renderTimer(); }
function renderTimer() {
  const bar = document.getElementById('timer');
  clearInterval(timerTick);
  const t = state.timer;
  if (!t) { bar.hidden = true; return; }
  bar.hidden = false;
  const draw = () => {
    const left = Math.round((t.endAt - Date.now()) / 1000);
    const txt = left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Descanso concluído';
    bar.querySelector('.t-time').textContent = txt;
    bar.querySelector('.t-label').textContent = t.label ?? 'Descanso';
    bar.querySelector('.t-fill').style.width = `${Math.max(0, Math.min(100, (left / t.total) * 100))}%`;
    bar.classList.toggle('over', left <= 0);
    if (left <= 0 && !t.alerted) { t.alerted = true; alertEnd(); }
  };
  draw();
  timerTick = setInterval(draw, 250);
}
function alertEnd() {
  try { navigator.vibrate?.([200, 100, 200]); } catch {}
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = 880; g.gain.value = 0.15; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.35);
  } catch {}
}

// ---------- Histórico ----------
function renderHistory() {
  const done = doneSessions().reverse();
  const ids = [...new Set(done.flatMap((s) => s.entries.map((e) => e.exerciseId)))];
  const select = h('select', { 'aria-label': 'Exercício' }, h('option', { value: '' }, 'Escolha um exercício'), ids.map((id) => h('option', { value: id }, exName(id))));
  const out = h('div');
  select.addEventListener('change', () => {
    out.replaceChildren();
    if (!select.value) return;
    const hist = exerciseHistory(state.sessions, select.value);
    out.append(lineChart(hist.map((r) => ({ x: r.date, y: r.bestE1RM })), { label: 'Melhor 1RM estimado', unit: 'kg', secondary: hist.map((r) => ({ x: r.date, y: r.topLoad })) }),
      h('p', { class: 'muted small' }, 'Linha cheia: melhor 1RM estimado (Epley + RIR). Linha tracejada: maior carga usada. Estimativas servem para comparar tendências, não para medir força máxima.'),
      h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Data'), h('th', {}, 'Séries'), h('th', { class: 'num' }, '1RMe'))),
        h('tbody', {}, hist.slice().reverse().map((r) => h('tr', {}, h('td', {}, fmtDate(r.date)), h('td', { class: 'small' }, r.sets.map((x) => `${fmtNum(x.load)}×${x.reps}${Number.isFinite(x.rir) ? `@${x.rir}` : ''}`).join(' ')), h('td', { class: 'num' }, fmtNum(r.bestE1RM)))))));
  });
  return page('Histórico',
    card(h('h2', {}, 'Evolução por exercício'), select, out),
    card(h('h2', {}, `Sessões (${done.length})`), done.length ? h('ul', { class: 'list' }, done.map((s) => h('li', {}, h('a', { href: `#/sessao/${s.id}` },
      h('span', {}, s.dayName), h('span', { class: 'muted small' }, `${fmtDateLong(s.finishedAt)} · ${countDoneSets(s)} séries · ${fmtNum(s.entries.reduce((a, e) => a + tonnage(e), 0), 0)} kg`))))) : h('p', { class: 'muted' }, 'Nenhuma sessão concluída.')));
}

function renderSessionDetail(id, mode) {
  const sess = state.sessions.find((s) => s.id === id);
  if (!sess) return page('Sessão', h('p', {}, 'Sessão não encontrada.'));
  if (mode === 'editar') return renderSessionEditor(sess, { live: false });
  const dur = sess.finishedAt ? Math.round((new Date(sess.finishedAt) - new Date(sess.startedAt)) / 60000) : null;
  return page(sess.dayName,
    h('p', { class: 'muted' }, `${fmtDateLong(sess.startedAt)}${dur != null ? ` · ${dur} min` : ''} · ${countDoneSets(sess)} séries`),
    ...sess.entries.map((e) => card(h('h2', {}, exName(e.exerciseId)),
      h('ul', { class: 'plain small' }, e.sets.filter((x) => x.done).map((x, i) => h('li', {}, `${i + 1}. ${fmtNum(x.load)} kg × ${x.reps}${Number.isFinite(x.rir) ? ` @RIR ${x.rir}` : ''}`))),
      h('p', { class: 'muted small' }, `1RM estimado: ${fmtNum(bestE1RM(e))} kg · tonelagem ${fmtNum(tonnage(e), 0)} kg`),
      e.notes ? h('p', { class: 'small' }, e.notes) : null)),
    sess.notes ? card(h('p', {}, sess.notes)) : null,
    h('div', { class: 'row gap' }, btn('Editar', () => go(`#/sessao/${id}/editar`)),
      confirmBtn('Excluir sessão', async () => { await remove('sessions', id); toast('Sessão excluída'); go('#/historico'); })));
}

// ---------- Corpo ----------
const MEASURES = [['waistCm', 'Cintura (cm)'], ['chestCm', 'Peitoral (cm)'], ['armCm', 'Braço (cm)'], ['thighCm', 'Coxa (cm)']];
function renderBody() {
  const list = [...state.bodyMetrics].sort((a, b) => a.date.localeCompare(b.date));
  const form = h('form', { class: 'grid2', onsubmit: async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const rec = { id: uid('bm'), date: f.get('date') || todayISO(), notes: String(f.get('notes') ?? '').slice(0, 500) };
    const w = parseNum(f.get('weightKg'), 'weightKg');
    if (Number.isNaN(w)) return toast('Peso inválido (20–400 kg).', 'err');
    rec.weightKg = w;
    for (const [k] of MEASURES) { const v = parseNum(f.get(k), 'cm'); if (Number.isNaN(v)) return toast('Medida inválida.', 'err'); rec[k] = v; }
    if (rec.weightKg == null && MEASURES.every(([k]) => rec[k] == null)) return toast('Informe ao menos um valor.', 'err');
    await save('bodyMetrics', rec); toast('Registro salvo'); render();
  } },
    h('label', { class: 'field' }, h('span', {}, 'Data'), h('input', { type: 'date', name: 'date', value: todayISO(), max: todayISO() })),
    h('label', { class: 'field' }, h('span', {}, 'Peso (kg)'), h('input', { name: 'weightKg', inputmode: 'decimal', placeholder: 'ex.: 72,4' })),
    ...MEASURES.map(([k, l]) => h('label', { class: 'field' }, h('span', {}, l), h('input', { name: k, inputmode: 'decimal' }))),
    h('label', { class: 'field span2' }, h('span', {}, 'Observações'), h('input', { name: 'notes', maxlength: 500 })),
    h('button', { type: 'submit', class: 'btn primary span2' }, 'Salvar registro'));

  const weights = list.filter((r) => Number.isFinite(r.weightKg)).map((r) => ({ x: r.date, y: r.weightKg }));
  const avg = weights.map((p, i) => { const win = weights.slice(Math.max(0, i - 6), i + 1); return { x: p.x, y: win.reduce((a, b) => a + b.y, 0) / win.length }; });
  const cmp = comparePeriods(weights);
  return page('Corpo',
    card(h('h2', {}, 'Novo registro'), h('p', { class: 'muted small' }, 'Dica: pese-se em condições parecidas (ex.: ao acordar, após ir ao banheiro).'), form),
    card(h('h2', {}, 'Peso corporal'), lineChart(avg.length > 1 ? weights : weights, { label: 'Peso', unit: 'kg', secondary: avg }),
      h('p', { class: 'muted small' }, 'Pontos: medições. Linha tracejada: média móvel das últimas 7 medições (reduz o ruído diário de água e conteúdo intestinal).'),
      cmp && h('p', {}, cmp)),
    card(h('h2', {}, 'Registros'), list.length ? h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Data'), h('th', { class: 'num' }, 'Peso'), h('th', {}, 'Medidas'), h('th', {}, ''))),
      h('tbody', {}, list.slice().reverse().map((r) => h('tr', {}, h('td', {}, fmtDate(r.date + 'T12:00')), h('td', { class: 'num' }, fmtNum(r.weightKg)),
        h('td', { class: 'small' }, MEASURES.filter(([k]) => Number.isFinite(r[k])).map(([k, l]) => `${l.split(' ')[0]} ${fmtNum(r[k])}`).join(' · ')),
        h('td', {}, confirmBtn('Excluir', async () => { await remove('bodyMetrics', r.id); toast('Registro excluído'); render(); })))))) : h('p', { class: 'muted' }, 'Sem registros.')));
}

function comparePeriods(weights) {
  const now = Date.now(), D = 86400000;
  const a = weights.filter((p) => now - new Date(p.x) <= 14 * D);
  const b = weights.filter((p) => now - new Date(p.x) > 14 * D && now - new Date(p.x) <= 28 * D);
  if (a.length < 2 || b.length < 2) return null;
  const ma = a.reduce((s, p) => s + p.y, 0) / a.length, mb = b.reduce((s, p) => s + p.y, 0) / b.length;
  const diff = ma - mb;
  return `Média das últimas 2 semanas: ${fmtNum(ma)} kg (${diff >= 0 ? '+' : ''}${fmtNum(diff, 2)} kg vs. 2 semanas anteriores; ≈ ${fmtNum((diff / mb) * 100 / 2, 2)}% do peso por semana).`;
}

// ---------- Check-in ----------
function renderCheckin() {
  const today = state.checkins.find((c) => c.date === todayISO());
  const scale = (name, label, low, high, val) => h('fieldset', { class: 'scale' }, h('legend', {}, label),
    h('div', { class: 'row' }, [1, 2, 3, 4, 5].map((n) => h('label', { class: 'chip' }, h('input', { type: 'radio', name, value: n, checked: val === n }), h('span', {}, n)))),
    h('div', { class: 'row between muted small' }, h('span', {}, low), h('span', {}, high)));
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const sleep = parseNum(f.get('sleepHours'), 'sleepHours');
    if (Number.isNaN(sleep)) return toast('Horas de sono inválidas.', 'err');
    const n = (k) => (f.get(k) ? Number(f.get(k)) : null);
    const rec = { id: today?.id ?? uid('ci'), date: todayISO(), sleepHours: sleep, sleepQuality: n('sleepQuality'), energy: n('energy'), fatigue: n('fatigue'), soreness: n('soreness'),
      performance: n('performance'), pain: { has: f.get('painHas') === 'on', location: String(f.get('painLocation') ?? '').slice(0, 200) }, notes: String(f.get('notes') ?? '').slice(0, 1000) };
    await save('checkins', rec); toast('Check-in salvo'); render();
  } },
    h('label', { class: 'field' }, h('span', {}, 'Horas de sono'), h('input', { name: 'sleepHours', inputmode: 'decimal', value: today?.sleepHours ?? '' })),
    scale('sleepQuality', 'Qualidade do sono', 'ruim', 'ótima', today?.sleepQuality),
    scale('energy', 'Disposição', 'baixa', 'alta', today?.energy),
    scale('fatigue', 'Fadiga', 'nenhuma', 'muita', today?.fatigue),
    scale('soreness', 'Dor muscular tardia', 'nenhuma', 'muita', today?.soreness),
    scale('performance', 'Desempenho percebido (último treino)', 'ruim', 'ótimo', today?.performance),
    h('label', { class: 'check-line' }, h('input', { type: 'checkbox', name: 'painHas', checked: !!today?.pain?.has }), h('span', {}, 'Tenho dor ou desconforto (não muscular comum)')),
    h('label', { class: 'field' }, h('span', {}, 'Onde / como'), h('input', { name: 'painLocation', value: today?.pain?.location ?? '' })),
    h('label', { class: 'field' }, h('span', {}, 'Observações'), h('textarea', { name: 'notes', rows: 2, value: today?.notes ?? '' })),
    h('button', { type: 'submit', class: 'btn primary' }, today ? 'Atualizar check-in de hoje' : 'Salvar check-in'));
  const recent = [...state.checkins].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14);
  return page('Check-in', card(form),
    card(h('h2', {}, 'Últimos check-ins'), recent.length ? h('table', { class: 'table' }, h('thead', {}, h('tr', {}, ['Data', 'Sono', 'Disp.', 'Fadiga', 'Dor'].map((t) => h('th', {}, t)))),
      h('tbody', {}, recent.map((c) => h('tr', {}, h('td', {}, fmtDate(c.date + 'T12:00')), h('td', {}, `${fmtNum(c.sleepHours)} h`), h('td', {}, c.energy ?? '–'), h('td', {}, c.fatigue ?? '–'), h('td', {}, c.pain?.has ? 'sim' : '–')))))
      : h('p', { class: 'muted' }, 'Sem check-ins.'),
      h('p', { class: 'muted small' }, 'O check-in só gera alertas informativos. Dor persistente ou sintomas preocupantes: procure avaliação profissional.')));
}

// ---------- Programa ----------
function renderProgram() {
  const wrap = page('Programa');
  if (!state.programs.length) wrap.append(card(h('p', {}, 'Cadastre aqui a ficha que você usa hoje. O programa individualizado do FITNESS OS será proposto depois da avaliação e só entra aqui com a sua aprovação.')));
  const nameIn = h('input', { placeholder: 'Nome do programa (ex.: Ficha atual)', 'aria-label': 'Nome do novo programa', maxlength: 80 });
  wrap.append(card(h('div', { class: 'row gap' }, nameIn, btn('Criar', async () => {
    const name = nameIn.value.trim(); if (!name) return toast('Dê um nome ao programa.', 'err');
    const p = { id: uid('prg'), name, active: !activeProgram(), createdAt: new Date().toISOString(), days: [] };
    await save('programs', p); toast('Programa criado'); render();
  }, 'primary'))));

  for (const t of TEMPLATES) {
    const exists = state.programs.some((p) => p.templateKey === t.key);
    wrap.append(card(h('h2', {}, t.name), h('p', { class: 'small muted' }, t.description),
      exists ? h('p', { class: 'small' }, 'Já adicionado abaixo.') : btn('Adicionar e ativar', async () => {
        for (const q of state.programs) { if (q.active) { q.active = false; await save('programs', q); } }
        const p = { id: uid('prg'), name: t.name, templateKey: t.key, active: true, createdAt: new Date().toISOString(),
          days: t.days.map((d) => ({ id: uid('day'), name: d.name, items: d.items.map((x) => ({ ...x })) })) };
        await save('programs', p); toast('Programa adicionado e ativado'); render();
      }, 'primary')));
  }

  for (const p of state.programs) {
    const persist = async () => { p.updatedAt = new Date().toISOString(); await save('programs', p); };
    const dayIn = h('input', { placeholder: 'Nome do dia (ex.: Superiores A)', 'aria-label': `Novo dia em ${p.name}`, maxlength: 60 });
    wrap.append(h('div', { class: `card program${p.active ? ' active' : ''}` },
      h('div', { class: 'row between' }, h('h2', {}, p.name), p.active ? h('span', { class: 'pill' }, 'Ativo') : btn('Ativar', async () => {
        for (const q of state.programs) { if (q.active) { q.active = false; await save('programs', q); } }
        p.active = true; await persist(); toast('Programa ativado'); render();
      }, 'small')),
      ...p.days.map((d, di) => dayEditor(p, d, di, persist)),
      h('div', { class: 'row gap' }, dayIn, btn('+ Dia', async () => {
        const name = dayIn.value.trim(); if (!name) return toast('Dê um nome ao dia.', 'err');
        p.days.push({ id: uid('day'), name, items: [] }); await persist(); render();
      })),
      confirmBtn('Excluir programa', async () => { await remove('programs', p.id); toast('Programa excluído'); render(); })));
  }
  return wrap;
}

function dayEditor(p, d, di, persist) {
  const sel = h('select', { 'aria-label': `Exercício para ${d.name}` }, h('option', { value: '' }, '+ Adicionar exercício'),
    Object.entries(MUSCLES).map(([m, label]) => h('optgroup', { label }, allExercises().filter((e) => e.primary === m).map((e) => h('option', { value: e.id }, e.name)))));
  sel.addEventListener('change', async () => {
    if (!sel.value) return;
    d.items.push({ exerciseId: sel.value, sets: 3, repMin: 8, repMax: 12, rir: 2, restSec: state.settings.defaultRest, notes: '' });
    await persist(); render();
  });
  const num = (it, key, label, kind) => h('label', { class: 'mini' }, h('span', {}, label), h('input', {
    inputmode: 'numeric', value: it[key], 'aria-label': `${label} — ${exName(it.exerciseId)}`,
    onchange: async (e) => { const v = parseNum(e.target.value, kind); if (v == null || Number.isNaN(v)) { e.target.value = it[key]; return toast('Valor inválido', 'err'); }
      it[key] = v; if (it.repMin > it.repMax) [it.repMin, it.repMax] = [it.repMax, it.repMin]; await persist(); },
  }));
  return h('div', { class: 'day' },
    h('div', { class: 'row between' }, h('h3', {}, d.name), h('div', { class: 'row' },
      di > 0 && btn('↑', async () => { [p.days[di - 1], p.days[di]] = [p.days[di], p.days[di - 1]]; await persist(); render(); }, 'ghost small'),
      confirmBtn('Remover dia', async () => { p.days.splice(di, 1); await persist(); render(); }))),
    ...d.items.map((it, ii) => h('div', { class: 'item' },
      h('div', { class: 'row between' }, h('strong', {}, exName(it.exerciseId)), h('div', { class: 'row' },
        ii > 0 && btn('↑', async () => { [d.items[ii - 1], d.items[ii]] = [d.items[ii], d.items[ii - 1]]; await persist(); render(); }, 'ghost small', ),
        btn('✕', async () => { d.items.splice(ii, 1); await persist(); render(); }, 'ghost small'))),
      h('div', { class: 'row gap wrap' }, num(it, 'sets', 'Séries', 'reps'), num(it, 'repMin', 'Reps mín', 'reps'), num(it, 'repMax', 'Reps máx', 'reps'), num(it, 'rir', 'RIR', 'rir'), num(it, 'restSec', 'Desc. (s)', 'reps')),
      h('input', { class: 'note', placeholder: 'Nota técnica (opcional)', value: it.notes ?? '', maxlength: 200, 'aria-label': `Nota para ${exName(it.exerciseId)}`, onchange: async (e) => { it.notes = e.target.value; await persist(); } }))),
    sel);
}

// ---------- Biblioteca ----------
function renderLibrary() {
  const q = h('input', { type: 'search', placeholder: 'Buscar exercício…', 'aria-label': 'Buscar exercício' });
  const list = h('div');
  const draw = () => {
    const term = q.value.trim().toLowerCase();
    list.replaceChildren(...Object.entries(MUSCLES).map(([m, label]) => {
      const items = allExercises().filter((e) => e.primary === m && (!term || e.name.toLowerCase().includes(term)));
      return items.length ? card(h('h2', {}, label), h('ul', { class: 'list' }, items.map((e) => h('li', {}, h('a', { href: `#/exercicio/${e.id}` }, h('span', {}, e.name), h('span', { class: 'muted small' }, e.equipment ?? '')))))) : null;
    }).filter(Boolean));
  };
  q.addEventListener('input', draw); draw();
  const form = h('form', { class: 'row gap wrap', onsubmit: async (e) => {
    e.preventDefault(); const f = new FormData(e.target); const name = String(f.get('name')).trim();
    if (!name) return toast('Informe o nome.', 'err');
    await save('exercises', { id: uid('exu'), name: name.slice(0, 80), primary: f.get('primary'), secondary: [], equipment: String(f.get('equipment') ?? '').slice(0, 40), instructions: [], errors: [], alternatives: [], video: null, source: 'user' });
    toast('Exercício adicionado'); render();
  } }, h('input', { name: 'name', placeholder: 'Nome', 'aria-label': 'Nome do exercício', maxlength: 80 }),
    h('select', { name: 'primary', 'aria-label': 'Músculo principal' }, Object.entries(MUSCLES).map(([m, l]) => h('option', { value: m }, l))),
    h('input', { name: 'equipment', placeholder: 'Equipamento', 'aria-label': 'Equipamento', maxlength: 40 }),
    h('button', { type: 'submit', class: 'btn' }, 'Adicionar'));
  return page('Biblioteca', q, list, card(h('h2', {}, 'Exercício personalizado'), form));
}

function renderExercise(id) {
  const e = exerciseById(id);
  if (!e) return page('Exercício', h('p', {}, 'Não encontrado.'));
  const hist = exerciseHistory(state.sessions, id);
  return page(e.name,
    card(h('p', {}, h('strong', {}, 'Principal: '), MUSCLES[e.primary] ?? e.primary),
      e.secondary?.length ? h('p', {}, h('strong', {}, 'Secundários: '), e.secondary.map((m) => MUSCLES[m] ?? m).join(', ')) : null,
      e.equipment ? h('p', { class: 'muted small' }, `Equipamento: ${e.equipment}`) : null),
    e.instructions?.length ? card(h('h2', {}, 'Execução'), h('ul', {}, e.instructions.map((t) => h('li', {}, t)))) : null,
    e.errors?.length ? card(h('h2', {}, 'Erros comuns'), h('ul', {}, e.errors.map((t) => h('li', {}, t)))) : null,
    e.alternatives?.length ? card(h('h2', {}, 'Alternativas'), h('ul', { class: 'list' }, e.alternatives.map((a) => h('li', {}, h('a', { href: `#/exercicio/${a}` }, exName(a)))))) : null,
    card(h('h2', {}, 'Vídeo'), e.video ? h('a', { href: e.video, target: '_blank', rel: 'noopener noreferrer' }, 'Abrir demonstração verificada') : h('p', { class: 'muted small' }, 'Ainda sem vídeo verificado. Links só são adicionados depois de conferidos.')),
    hist.length > 1 ? card(h('h2', {}, 'Sua evolução'), lineChart(hist.map((r) => ({ x: r.date, y: r.bestE1RM })), { label: 'Melhor 1RM estimado', unit: 'kg' })) : null);
}

// ---------- Mais / Dados ----------
function renderMore() {
  const link = (href, t, d) => h('li', {}, h('a', { href }, h('span', {}, t), h('span', { class: 'muted small' }, d)));
  return page('Mais', card(h('ul', { class: 'list' },
    link('#/checkin', 'Check-in diário', 'Sono, disposição, fadiga, dores'),
    link('#/programa', 'Programa', 'Fichas, dias e exercícios'),
    link('#/biblioteca', 'Biblioteca', 'Exercícios, técnica e alternativas'),
    link('#/dados', 'Dados e backup', 'Exportar, importar, armazenamento'))),
    h('p', { class: 'muted small center' }, 'FITNESS OS · seus dados ficam apenas neste aparelho.'));
}

async function renderData() {
  const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
  const lastBackup = await db.getMeta('lastBackupAt');
  const fileIn = h('input', { type: 'file', accept: 'application/json,.json', 'aria-label': 'Arquivo de backup' });
  const counts = `${state.sessions.length} sessões · ${state.bodyMetrics.length} registros corporais · ${state.checkins.length} check-ins · ${state.programs.length} programas`;
  return page('Dados e backup',
    card(h('h2', {}, 'Armazenamento'), h('p', {}, counts),
      h('p', { class: 'small' }, `Armazenamento persistente: ${persisted == null ? 'não suportado' : persisted ? 'concedido' : 'não concedido'}`),
      est ? h('p', { class: 'muted small' }, `Uso: ${fmtNum(est.usage / 1024, 0)} KB`) : null,
      persisted === false && btn('Pedir armazenamento persistente', async () => { const r = await db.requestPersistence(); toast(r.granted ? 'Concedido' : 'O navegador não concedeu (instale como app para aumentar a chance)'); render(); })),
    card(h('h2', {}, 'Exportar backup'), h('p', { class: 'small' }, `Último backup: ${lastBackup ? fmtDateLong(lastBackup) : 'nunca'}. Recomendado: semanalmente, guardando o arquivo fora do celular.`),
      btn('Baixar backup (.json)', async () => {
        const data = await db.exportAll();
        const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
        const a = h('a', { href: URL.createObjectURL(blob), download: `fitnessos-backup-${todayISO()}.json` });
        document.body.append(a); a.click(); a.remove();
        await db.setMeta('lastBackupAt', new Date().toISOString()); toast('Backup gerado');
      }, 'primary')),
    card(h('h2', {}, 'Restaurar backup'), h('p', { class: 'small' }, 'Substitui TODOS os dados atuais pelos do arquivo. Faça um backup antes.'), fileIn,
      confirmBtn('Restaurar', async () => {
        const file = fileIn.files?.[0]; if (!file) return toast('Escolha um arquivo.', 'err');
        if (file.size > 50 * 1024 * 1024) return toast('Arquivo grande demais.', 'err');
        try {
          const counts = await db.importAll(JSON.parse(await file.text()));
          await loadAll(); state.timer = null; toast(`Restaurado: ${counts.sessions} sessões`); render();
        } catch (err) { toast(`Backup inválido: ${String(err.message).split('\n')[0]}`, 'err'); }
      })),
    card(h('h2', {}, 'Apagar tudo'), h('p', { class: 'small' }, 'Remove todos os dados deste aparelho. Não pode ser desfeito sem um backup.'),
      confirmBtn('Apagar todos os dados', async () => { await db.wipeAll(); await loadAll(); state.timer = null; toast('Dados apagados'); go('#/painel'); })));
}

// ---------- Inicialização ----------
async function init() {
  const nav = document.getElementById('nav');
  nav.replaceChildren(...NAV.map(([r, label, d]) => h('a', { href: `#/${r}`, dataset: { route: r } },
    (() => { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); const p = document.createElementNS(svg.namespaceURI, 'path'); p.setAttribute('d', d); svg.append(p); return svg; })(),
    h('span', {}, label))));
  const timer = document.getElementById('timer');
  timer.querySelector('.t-plus').addEventListener('click', () => { if (state.timer) { state.timer.endAt += 15000; state.timer.total += 15; state.timer.alerted = false; db.setMeta('timer', state.timer); renderTimer(); } });
  timer.querySelector('.t-stop').addEventListener('click', stopTimer);
  await loadAll();
  state.timer = await db.getMeta('timer', null);
  if (state.timer && Date.now() - state.timer.endAt > 10 * 60000) state.timer = null;
  window.addEventListener('hashchange', render);
  await render();
  document.documentElement.dataset.ready = 'true';
  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !navigator.webdriver) {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW', e));
  }
}

window.__fitnessos = { state, registerSW: () => navigator.serviceWorker.register('./sw.js') };
init();
