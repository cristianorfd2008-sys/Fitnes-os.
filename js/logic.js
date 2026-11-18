// FITNESS OS — lógica de domínio pura (sem DOM, sem IndexedDB).
// Tudo aqui é testável com `node --test`. Nenhuma função altera o programa:
// elas apenas calculam e sugerem, com justificativa e dados usados.

export const SCHEMA_VERSION = 1;

/** Arredonda para o incremento de carga mais próximo (ex.: 2.5 kg). */
export function roundToIncrement(value, increment = 2.5) {
  if (!Number.isFinite(value)) return NaN;
  if (!(increment > 0)) return value;
  return Math.round(value / increment) * increment;
}

/**
 * 1RM estimado (Epley ajustado por RIR): carga × (1 + (reps + RIR) / 30).
 * É uma ESTIMATIVA para comparar desempenho ao longo do tempo no mesmo exercício,
 * não um teste de força. Retorna null se os dados forem inválidos.
 */
export function estimate1RM(load, reps, rir = 0) {
  if (![load, reps].every(Number.isFinite) || load <= 0 || reps <= 0) return null;
  const r = Number.isFinite(rir) && rir > 0 ? rir : 0;
  return +(load * (1 + (reps + r) / 30)).toFixed(1);
}

/** Série considerada "efetiva" (contável para volume): concluída e RIR ≤ 4 (ou RIR não informado). */
export function isEffectiveSet(set) {
  if (!set || !set.done) return false;
  if (!Number.isFinite(set.reps) || set.reps <= 0) return false;
  return !Number.isFinite(set.rir) || set.rir <= 4;
}

/** Melhor 1RM estimado de uma entrada de exercício numa sessão. */
export function bestE1RM(entry) {
  let best = null;
  for (const s of entry?.sets ?? []) {
    if (!s.done) continue;
    const e = estimate1RM(s.load, s.reps, s.rir);
    if (e != null && (best == null || e > best)) best = e;
  }
  return best;
}

/** Tonelagem (carga × reps) das séries concluídas. */
export function tonnage(entry) {
  return (entry?.sets ?? []).reduce(
    (acc, s) => (s.done && Number.isFinite(s.load) && Number.isFinite(s.reps) ? acc + s.load * s.reps : acc),
    0,
  );
}

/**
 * Séries efetivas por grupo muscular. Convenção (registrada em DECISIONS.md):
 * músculo principal conta 1 série; secundários contam 0,5.
 * @param sessions sessões concluídas
 * @param exerciseById função (id) => exercício {primary, secondary[]}
 */
export function setsPerMuscle(sessions, exerciseById) {
  const out = {};
  for (const sess of sessions) {
    for (const entry of sess.entries ?? []) {
      const ex = exerciseById(entry.exerciseId);
      if (!ex) continue;
      const n = (entry.sets ?? []).filter(isEffectiveSet).length;
      if (!n) continue;
      out[ex.primary] = (out[ex.primary] ?? 0) + n;
      for (const m of ex.secondary ?? []) out[m] = (out[m] ?? 0) + n * 0.5;
    }
  }
  return out;
}

/** Início da semana (segunda-feira, 00:00 local) para uma data. */
export function weekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // 0 = segunda
  d.setDate(d.getDate() - dow);
  return d;
}

/** Sessões concluídas por semana nas últimas `weeks` semanas (mais antiga → mais recente). */
export function sessionsPerWeek(sessions, now = new Date(), weeks = 8) {
  const current = weekStart(now).getTime();
  const WEEK = 7 * 24 * 3600 * 1000;
  const buckets = Array.from({ length: weeks }, (_, i) => ({
    weekStart: new Date(current - (weeks - 1 - i) * WEEK),
    count: 0,
  }));
  for (const s of sessions) {
    if (s.status !== 'done' || !s.finishedAt) continue;
    const ws = weekStart(s.finishedAt).getTime();
    const idx = weeks - 1 - Math.round((current - ws) / WEEK);
    if (idx >= 0 && idx < weeks) buckets[idx].count++;
  }
  return buckets;
}

/** Histórico de um exercício: [{date, sessionId, bestE1RM, topLoad, sets}] em ordem cronológica. */
export function exerciseHistory(sessions, exerciseId) {
  const rows = [];
  for (const s of sessions) {
    if (s.status !== 'done') continue;
    for (const entry of s.entries ?? []) {
      if (entry.exerciseId !== exerciseId) continue;
      const done = (entry.sets ?? []).filter((x) => x.done);
      if (!done.length) continue;
      rows.push({
        date: s.finishedAt ?? s.startedAt,
        sessionId: s.id,
        bestE1RM: bestE1RM(entry),
        topLoad: Math.max(...done.map((x) => (Number.isFinite(x.load) ? x.load : 0))),
        sets: done.map((x) => ({ load: x.load, reps: x.reps, rir: x.rir })),
      });
    }
  }
  return rows.sort((a, b) => new Date(a.date) - new Date(b.date));
}

/**
 * Sugestão de progressão dupla para a PRÓXIMA sessão de um exercício.
 * Regras (ver DECISIONS.md D-008):
 *  - Todas as séries planejadas chegaram ao topo da faixa com RIR ≥ alvo − 1 → subir carga.
 *  - Reps dentro da faixa → manter carga e buscar +1 rep.
 *  - Metade ou mais das séries abaixo do mínimo da faixa → manter carga (ou reduzir ~5–10% se repetir).
 * Retorna {action, load, reasoning, dataUsed, limitations}. Nunca altera o programa.
 */
export function suggestProgression(plan, lastSets, opts = {}) {
  const increment = opts.increment ?? 2.5;
  const limitations = [
    'Baseada apenas na última sessão deste exercício.',
    'Não considera sono, fadiga ou dor — confira o check-in antes de aplicar.',
  ];
  const sets = (lastSets ?? []).filter((s) => s.done && Number.isFinite(s.reps));
  if (!plan || !sets.length) {
    return {
      action: 'baseline',
      load: null,
      reasoning: 'Sem registro anterior: escolha uma carga que permita ficar na faixa de repetições com o RIR alvo.',
      dataUsed: [],
      limitations,
    };
  }
  const loads = sets.map((s) => s.load).filter(Number.isFinite);
  const workLoad = loads.length ? Math.max(...loads) : null;
  const atTop = sets.filter((s) => s.reps >= plan.repMax).length;
  const below = sets.filter((s) => s.reps < plan.repMin).length;
  const rirTarget = Number.isFinite(plan.rir) ? plan.rir : 2;
  const rirOk = sets.every((s) => !Number.isFinite(s.rir) || s.rir >= rirTarget - 1);
  const dataUsed = sets.map((s) => `${s.load ?? '–'} kg × ${s.reps}${Number.isFinite(s.rir) ? ` @RIR ${s.rir}` : ''}`);

  if (sets.length >= plan.sets && atTop >= plan.sets && rirOk && workLoad != null) {
    const pct = workLoad * 0.025; // ~2,5%
    const next = roundToIncrement(workLoad + Math.max(increment, pct), increment);
    return {
      action: 'increase_load',
      load: next,
      reasoning: `Todas as ${plan.sets} séries atingiram ${plan.repMax} reps com esforço dentro do alvo. Suba a carga para ${next} kg e volte ao início da faixa (${plan.repMin}).`,
      dataUsed,
      limitations,
    };
  }
  if (below >= Math.ceil(sets.length / 2)) {
    return {
      action: 'hold_or_reduce',
      load: workLoad,
      reasoning: `${below} de ${sets.length} séries ficaram abaixo de ${plan.repMin} reps. Mantenha ${workLoad ?? 'a'} kg; se acontecer de novo na próxima, reduza 5–10% e reconstrua.`,
      dataUsed,
      limitations,
    };
  }
  return {
    action: 'add_reps',
    load: workLoad,
    reasoning: `Repetições dentro da faixa ${plan.repMin}–${plan.repMax}. Mantenha ${workLoad ?? 'a mesma'} kg e tente +1 rep em pelo menos uma série.`,
    dataUsed,
    limitations,
  };
}

/**
 * Detecta estagnação: nas últimas `window` exposições (mín. 3, em ≥ 14 dias),
 * o melhor 1RM estimado não superou o melhor das exposições anteriores em > `tolerance`.
 */
export function detectStagnation(history, { window = 3, tolerance = 0.01, minDays = 14 } = {}) {
  const rows = history.filter((r) => r.bestE1RM != null);
  if (rows.length < window + 1) return { stagnant: false, reason: 'Dados insuficientes.' };
  const recent = rows.slice(-window);
  const before = rows.slice(0, -window);
  const spanDays = (new Date(recent.at(-1).date) - new Date(recent[0].date)) / 86400000;
  if (spanDays < minDays) return { stagnant: false, reason: 'Período curto demais para concluir.' };
  const prevBest = Math.max(...before.map((r) => r.bestE1RM));
  const recentBest = Math.max(...recent.map((r) => r.bestE1RM));
  const stagnant = recentBest <= prevBest * (1 + tolerance);
  return {
    stagnant,
    prevBest,
    recentBest,
    reason: stagnant
      ? `Melhor 1RM estimado nas últimas ${window} sessões (${recentBest} kg) não superou o recorde anterior (${prevBest} kg) em ${Math.round(spanDays)} dias.`
      : 'Houve progresso recente.',
  };
}

/** Resumo de prontidão a partir de um check-in (escalas 1–5). Apenas sinaliza; não diagnostica. */
export function readinessFlags(checkin) {
  if (!checkin) return [];
  const flags = [];
  if (checkin.pain?.has) flags.push({ level: 'alert', text: `Dor/desconforto relatado${checkin.pain.location ? ` (${checkin.pain.location})` : ''}. Evite exercícios que a provoquem; se persistir, procure avaliação profissional.` });
  if (Number.isFinite(checkin.sleepHours) && checkin.sleepHours < 6) flags.push({ level: 'warn', text: `Sono curto (${checkin.sleepHours} h).` });
  if (checkin.fatigue >= 4) flags.push({ level: 'warn', text: 'Fadiga alta relatada.' });
  if (checkin.energy != null && checkin.energy <= 2) flags.push({ level: 'warn', text: 'Disposição baixa relatada.' });
  return flags;
}

/**
 * Alertas de dor por exercício (sessões concluídas, em ordem cronológica).
 * Regra (D-019): dor ≥ 4 → alerta; dor ≥ 3 em duas sessões seguidas do mesmo exercício → alerta;
 * dor = 3 isolada → aviso. Só sinaliza; não diagnostica.
 */
export function painAlerts(sessions, nameOf = (id) => id) {
  const byEx = new Map();
  for (const s of [...sessions].sort((a, b) => new Date(a.finishedAt ?? a.startedAt) - new Date(b.finishedAt ?? b.startedAt))) {
    for (const e of s.entries ?? []) {
      if (!Number.isFinite(e.pain)) continue;
      if (!byEx.has(e.exerciseId)) byEx.set(e.exerciseId, []);
      byEx.get(e.exerciseId).push(e.pain);
    }
  }
  const out = [];
  for (const [id, vals] of byEx) {
    const last = vals.at(-1), prev = vals.at(-2);
    if (last >= 4) out.push({ exerciseId: id, name: nameOf(id), level: 'alert', text: `dor ${last}/10 na última sessão. Use a alternativa.` });
    else if (last >= 3 && prev >= 3) out.push({ exerciseId: id, name: nameOf(id), level: 'alert', text: `dor ${prev} e ${last}/10 em sessões seguidas. Troque o exercício e considere avaliação.` });
    else if (last === 3) out.push({ exerciseId: id, name: nameOf(id), level: 'warn', text: 'dor 3/10 na última sessão. Mantenha a carga e reduza a amplitude.' });
  }
  return out;
}

// ---------- Validação de entradas ----------

const LIMITS = {
  load: [0, 1000],
  reps: [0, 200],
  rir: [0, 10],
  weightKg: [20, 400],
  cm: [5, 300],
  sleepHours: [0, 24],
  scale: [1, 5],
};

/** Converte texto (aceita vírgula decimal) em número dentro do limite, ou null. */
export function parseNum(raw, kind) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().replace(',', '.');
  if (s === '') return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  const n = Number(s);
  const [min, max] = LIMITS[kind] ?? [-Infinity, Infinity];
  return n < min || n > max ? NaN : n;
}

// ---------- Backup ----------

const STORES = ['meta', 'exercises', 'programs', 'sessions', 'bodyMetrics', 'checkins'];
export const BACKUP_STORES = STORES;

export function buildBackup(data, now = new Date()) {
  const out = { app: 'FITNESS OS', schemaVersion: SCHEMA_VERSION, exportedAt: now.toISOString(), data: {} };
  for (const s of STORES) out.data[s] = Array.isArray(data[s]) ? data[s] : [];
  return out;
}

/** Valida um backup. Retorna {ok, errors[], counts}. Não confia no conteúdo do arquivo. */
export function validateBackup(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') return { ok: false, errors: ['Arquivo não é um objeto JSON.'] };
  if (obj.app !== 'FITNESS OS') errors.push('Arquivo não é um backup do FITNESS OS.');
  if (!Number.isInteger(obj.schemaVersion) || obj.schemaVersion > SCHEMA_VERSION)
    errors.push(`Versão de esquema incompatível (${obj.schemaVersion}).`);
  const counts = {};
  for (const s of STORES) {
    const arr = obj.data?.[s];
    if (!Array.isArray(arr)) { errors.push(`Coleção ausente: ${s}.`); continue; }
    counts[s] = arr.length;
    const keyField = s === 'meta' ? 'key' : 'id';
    arr.forEach((rec, i) => {
      if (!rec || typeof rec !== 'object' || typeof rec[keyField] !== 'string' || !rec[keyField])
        errors.push(`${s}[${i}] sem "${keyField}" válido.`);
    });
  }
  return { ok: errors.length === 0, errors: errors.slice(0, 20), counts };
}

export function uid(prefix = 'id') {
  const rnd = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${rnd}`;
}
