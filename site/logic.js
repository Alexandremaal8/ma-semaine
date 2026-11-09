/* EPFL Calendar — planning logic (no DOM). Shared by the app and the tests.
 * Model: each mode sets a weekly study target. It is spread automatically over the days in proportion to
 * the free time each day has (days off get nothing). The week's séries must all be finished; what isn't
 * checked off by the end of a block moves to the next free blocks, then to a bounded catch-up time in the
 * evenings, and whatever is left at the end of the week carries into the next one. */
(function (root) {
'use strict';
const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const DAYS_S = ['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di'];
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MONTHS_L = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MODE_ORDER = ['chill', 'normal', 'charbon', 'avance', 'rattrapage', 'exam', 'recup'];
const MODE_META = {
  chill: { name: 'Chill', tag: 'Les séries et un peu de révision. Samedi off, soirées longues.' },
  normal: { name: 'Normal', tag: 'Séries finies chaque semaine, révisions régulières, soirées à toi.' },
  charbon: { name: 'Charbon', tag: 'Grosse semaine : presque tout le temps libre passe en étude. Le sommeil ne bouge pas.' },
  avance: { name: 'Avance', tag: 'Avant un voyage ou une grosse période : tu révises tout le semestre en avance, matières d’examen en priorité.' },
  rattrapage: { name: 'Rattrapage', tag: 'T’as pris du retard : on le rattrape en priorité, un peu chaque soir, sans te cramer.' },
  exam: { name: 'Exam', tag: 'Révisions. Les matières dont l’examen approche passent devant.' },
  recup: { name: 'Récup', tag: 'Fatigué ou malade : le strict minimum. Ce qui ne rentre pas passe à la semaine suivante.' }
};
/* week: weekly study minutes · sat/sun: share of a weekday · ext: max catch-up minutes added per evening */
const MODE_DEFAULTS = {
  chill:      { week: 720,  sat: 0,   sun: 0.5, block: 45, pause: 15, freeEve: 150, ext: 30 },
  normal:     { week: 1200, sat: 0.6, sun: 0.6, block: 50, pause: 10, freeEve: 90,  ext: 45 },
  charbon:    { week: 1920, sat: 1,   sun: 0.8, block: 50, pause: 10, freeEve: 45,  ext: 60 },
  avance:     { week: 1680, sat: 1,   sun: 0.6, block: 50, pause: 10, freeEve: 75,  ext: 30 },
  rattrapage: { week: 1440, sat: 1,   sun: 0.7, block: 50, pause: 10, freeEve: 120, ext: 75 },
  exam:       { week: 2100, sat: 1,   sun: 1,   block: 50, pause: 10, freeEve: 60,  ext: 60 },
  recup:      { week: 360,  sat: 0,   sun: 0.3, block: 30, pause: 15, freeEve: 180, ext: 0 }
};
const REV_LABELS = {
  chill: ['Relire le cours'], normal: ['Relire + fiche résumé', 'Exos en plus'],
  charbon: ['Fiches + exos en plus', 'Refaire les exos ratés'], rattrapage: ['Relire le cours'],
  avance: ['Fiche de révision du chapitre', 'Exos d’anciens examens', 'Refaire les séries difficiles'],
  exam: ['Annales / examen blanc', 'Révision active (fiches, flashcards)', 'Refaire les séries'], recup: ['Relire tranquillement']
};
const PRIO_W = [0, 1, 1.6, 2.3];
const COMMUTE = 40;
const MIN_FREE_EVE = 45;
const SPORT_MIN = 120, SPORT_MAX = 180;

const clone = o => JSON.parse(JSON.stringify(o));
const pad = n => String(n).padStart(2, '0');
const fmt = m => { m = Math.round(m); const h = Math.floor(m / 60) % 24; return pad(h) + ':' + pad(((m % 60) + 60) % 60); };
const parseT = s => { if (!s) return null; const [a, b] = String(s).split(':').map(Number); if (isNaN(a)) return null; return a * 60 + (b || 0); };
const hm = m => { m = Math.round(m); const h = Math.floor(m / 60), r = m % 60; return h ? (r ? h + 'h' + pad(r) : h + 'h') : r + ' min'; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const fromIso = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const mondayOf = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const dateLbl = d => d.getDate() + ' ' + MONTHS[d.getMonth()];
const uid = () => Math.random().toString(36).slice(2, 9);
const dow = d => (d.getDay() + 6) % 7;
const subjOf = (S, id) => S.subjects.find(x => x.id === id);

function defaultState() {
  const C = (day, s, e, subj, type, room) => ({ id: uid(), day, start: s, end: e, subj, type, room: room || '' });
  const R = (day, s, e, title, kind) => ({ id: uid(), day, start: s, end: e, title, kind: kind || 'other' });
  return {
    v: 4, mode: 'normal', coursesOn: true, since: Date.now(),
    wake: 390, sleep: 1380, wakeWE: 510, sleepSat: 1440,
    subjects: [
      { id: 'ana', name: 'Analyse I', color: '#C2410C', prio: 3, exam: '', serie: 180, corr: 30 },
      { id: 'alg', name: 'Algèbre linéaire', color: '#1D4ED8', prio: 3, exam: '', serie: 180, corr: 30 },
      { id: 'phy', name: 'Physique (mécanique)', color: '#047857', prio: 2, exam: '', serie: 150, corr: 30 },
      { id: 'aicc', name: 'AICC I', color: '#7C3AED', prio: 2, exam: '', serie: 150, corr: 30 },
      { id: 'prog', name: 'Programmation', color: '#0E7490', prio: 2, exam: '', serie: 120, corr: 30 }
    ],
    courses: [
      C(0, 615, 720, 'ana', 'Cours', 'CM 1 2 / CO 3'), C(0, 975, 1140, 'phy', 'Cours', 'CE 1 6'),
      C(1, 495, 600, 'aicc', 'Cours', 'RLC E1 240'), C(1, 615, 660, 'phy', 'Cours', ''), C(1, 915, 1020, 'alg', 'Cours', 'CE 1 1 / CO 3'),
      C(2, 615, 720, 'ana', 'Cours', 'BCH 2201 / CE 1 1'), C(2, 795, 900, 'prog', 'Cours', 'RLC E1 240'), C(2, 915, 1020, 'aicc', 'Cours', 'RLC E1 240'), C(2, 1035, 1140, 'phy', 'Exercices', ''),
      C(3, 495, 600, 'alg', 'Cours', 'SG 1138'), C(3, 615, 720, 'ana', 'Exercices', ''),
      C(4, 495, 600, 'alg', 'Exercices', ''), C(4, 615, 720, 'aicc', 'Exercices', ''), C(4, 795, 900, 'prog', 'Exercices', ''), C(4, 915, 960, 'prog', 'Cours', 'INF')
    ],
    routines: [
      R(1, 1035, 1095, 'Sport', 'sport'), R(3, 1050, 1110, 'Sport', 'sport'), R(5, 600, 645, 'Sport', 'sport'),
      R(5, 690, 780, 'Courses'),
      R(6, 540, 780, 'Lessive, nettoyage, cuisine'),
      R(6, 1215, 1260, 'Préparer la semaine (sac, lunch, cours de lundi)')
    ],
    events: [], offDays: [], trips: [], mocks: [], weekModes: {}, noCourseWeeks: [],
    modes: clone(MODE_DEFAULTS),
    notif: { on: false, course: 10, study: true, sport: true, routine: true, morning: true, evening: true, deadline: true, event: 15 },
    done: {}
  };
}

function normalize(s) {
  const d = defaultState();
  const old = s || {};
  const out = Object.assign({}, d, old);
  if ((old.v || 0) < 3) {
    // v2 → v3: fixed wake/sleep, sport moves to routines, séries per subject, new modes
    out.wake = d.wake; out.sleep = d.sleep; out.wakeWE = d.wakeWE; out.sleepSat = d.sleepSat;
    out.modes = clone(MODE_DEFAULTS);
    const defSerie = { ana: 180, alg: 180, phy: 150, aicc: 150, prog: 120 };
    out.subjects = (old.subjects || d.subjects).map(x => Object.assign({ serie: defSerie[x.id] || 120 }, x));
    const rs = (old.routines || []).map(r => Object.assign({ kind: 'other' }, r));
    if (!rs.some(r => r.kind === 'sport')) rs.unshift(...d.routines.filter(r => r.kind === 'sport'));
    out.routines = rs;
    out.done = {}; out.since = Date.now();
  }
  if ((old.v || 0) < 4) {
    // v3 → v4: Sunday morning is chores, mode and courses are chosen per week
    const sunMorning = r => r.day === 6 && r.start < 780 && r.kind !== 'sport';
    out.routines = (out.routines || []).filter(r => !sunMorning(r));
    out.routines.push({ id: uid(), day: 6, start: 540, end: 780, title: 'Lessive, nettoyage, cuisine', kind: 'other' });
    out.routines = out.routines.map(r => r.day === 5 && /lessive/i.test(r.title) ? Object.assign({}, r, { title: 'Courses' }) : r);
    if (old.coursesOn === false) out.noCourseWeeks = [iso(mondayOf(new Date()))];
    out.coursesOn = true;
  }
  out.modes = Object.assign({}, clone(MODE_DEFAULTS), out.modes || {});
  for (const k of MODE_ORDER) out.modes[k] = Object.assign({}, MODE_DEFAULTS[k], out.modes[k] || {});
  if (!MODE_ORDER.includes(out.mode)) out.mode = 'normal';
  out.notif = Object.assign({}, d.notif, out.notif || {});
  out.done = out.done || {};
  ['subjects', 'courses', 'routines', 'events', 'offDays', 'trips', 'mocks', 'noCourseWeeks'].forEach(k => { if (!Array.isArray(out[k])) out[k] = d[k]; });
  if (!out.weekModes || typeof out.weekModes !== 'object') out.weekModes = {};
  out.subjects.forEach(x => { if (x.serie == null) x.serie = 120; if (x.corr == null) x.corr = x.serie ? 30 : 0; });
  out.v = 4;
  return out;
}

/* trips: {id, title, from, to, light} — first and last day are travel days, days in between are light */
function tripOn(S, dIso) {
  for (const t of S.trips || []) if (t.from && t.to && dIso >= t.from && dIso <= t.to) return { trip: t, edge: dIso === t.from || dIso === t.to };
  return null;
}
function weekCfg(S, weekStart) {
  const key = iso(weekStart);
  let tripDays = 0; for (let d = 0; d < 7; d++) if (tripOn(S, iso(addDays(weekStart, d)))) tripDays++;
  const mode = MODE_ORDER.includes((S.weekModes || {})[key]) ? S.weekModes[key] : S.mode;
  const coursesOn = !(S.noCourseWeeks || []).includes(key) && tripDays < 3;
  return { key, mode, coursesOn, tripDays, chosen: !!(S.weekModes || {})[key] };
}
/* a suggestion for a given week, with the reason */
function recommendMode(S, weekStart) {
  const end = addDays(weekStart, 7);
  for (const t of S.trips || []) {
    if (!t.from || !t.to) continue;
    const from = fromIso(t.from), to = fromIso(t.to);
    if (from >= weekStart && from < addDays(weekStart, 7)) return { mode: 'avance', why: 'Tu pars le ' + dateLbl(from) + ' : finis en avance.' };
    if (from >= end && (from - end) / 864e5 < 21) return { mode: 'avance', why: 'Départ « ' + (t.title || 'voyage') + ' » dans ' + Math.ceil((from - weekStart) / 864e5) + ' jours : prends de l’avance.' };
    if (to < weekStart && (weekStart - to) / 864e5 < 10) {
      const soon = S.subjects.filter(su => su.exam && (fromIso(su.exam) - weekStart) / 864e5 < 56);
      if (soon.length) return { mode: 'exam', why: 'Retour de voyage avec des examens qui arrivent : on met le paquet.' };
    }
  }
  const nearExam = S.subjects.some(su => su.exam && (fromIso(su.exam) - weekStart) / 864e5 >= 0 && (fromIso(su.exam) - weekStart) / 864e5 < 21);
  if (nearExam) return { mode: 'exam', why: 'Un examen dans moins de 3 semaines.' };
  return null;
}

const sportMinutes = S => S.routines.filter(r => r.kind === 'sport').reduce((a, r) => a + Math.max(0, r.end - r.start), 0);

/* ---------- one day: fixed events + the free windows where study can go ---------- */
function layoutDay(S, m, weekStart, d) {
  const date = addDays(weekStart, d), we = d >= 5, dIso = iso(date);
  const tr = tripOn(S, dIso);
  if (tr) {
    const wake = we ? S.wakeWE : S.wake, sleep = Math.min(1440, (d === 5 ? S.sleepSat : S.sleep) < 240 ? (d === 5 ? S.sleepSat : S.sleep) + 1440 : (d === 5 ? S.sleepSat : S.sleep));
    const light = tr.edge ? 0 : (+tr.trip.light || 0);
    const gaps = light ? [{ s: 600, e: 600 + light + 30 }] : [];
    const chunk = (gs, limit) => { const res = []; let left = limit; for (const g of gs) { let t = g.s; while (left >= 20 && t + 20 <= g.e) { const len = Math.min(left, g.e - t); res.push({ start: t, end: t + len, len }); left -= len; t += len + (+m.pause); } } return res; };
    return { d, date, dIso, we, off: !light, trip: tr.trip, tripEdge: tr.edge, wake, sleep, wind: sleep - 30, eveStart: sleep - 30, ev: [], courses: [], firstC: null, goHome: null, gaps, extGaps: [], chunk, cap: light };
  }
  const off = (S.offDays || []).includes(dIso);
  const courses = S.coursesOn ? S.courses.filter(c => c.day === d && c.end > c.start).sort((a, b) => a.start - b.start) : [];
  const firstC = courses.length ? courses[0].start : null;
  const lastC = courses.length ? Math.max(...courses.map(c => c.end)) : null;
  const wake = firstC != null ? Math.min(we ? S.wakeWE : S.wake, firstC - 30 - COMMUTE - 15) : (we ? S.wakeWE : S.wake);
  let sleep = d === 5 ? S.sleepSat : S.sleep; if (sleep < 240) sleep += 1440; if (sleep > 1440) sleep = 1440;
  const ev = [];
  const busy = () => ev.filter(e => e.end > e.start);
  const free = (s, e) => busy().every(b => b.end <= s || b.start >= e);
  ev.push({ kind: 'meal', start: wake, end: wake + 30, title: 'Petit-déj' });
  courses.forEach(c => { const su = subjOf(S, c.subj); ev.push({ kind: 'course', start: c.start, end: c.end, title: su ? su.name : 'Cours', sub: [c.type, c.room].filter(Boolean).join(' · '), subj: c.subj, ctype: c.type, cid: c.id }); });
  (S.events || []).filter(x => x.date === dIso && x.end > x.start).forEach(x => ev.push({ kind: 'event', start: x.start, end: x.end, title: x.title || 'Événement', sub: x.place || '', eid: x.id }));
  (S.mocks || []).filter(x => x.date === dIso && x.end > x.start).forEach(x => { const su = subjOf(S, x.subj); ev.push({ kind: 'event', start: x.start, end: x.end, title: 'Examen blanc · ' + (su ? su.name : ''), sub: x.place || 'facultatif, mais on veut être prêt', subj: x.subj, mock: true }); });
  (S.routines || []).filter(r => r.day === d && r.end > r.start).forEach(r => { if (free(r.start, r.end)) ev.push({ kind: r.kind === 'sport' ? 'sport' : 'routine', start: r.start, end: r.end, title: r.title, rid: r.id }); });
  let goHome = null;
  if (courses.length) {
    if (free(firstC - COMMUTE - 5, firstC - 5)) ev.push({ kind: 'move', start: firstC - COMMUTE - 5, end: firstC - 5, title: 'Maison → EPFL' });
    let ret = S.mode === 'charbon' ? Math.max(lastC, 1110) : lastC;
    for (let k = 0; k < 8 && !free(ret, ret + COMMUTE); k++) ret += 15;
    goHome = ret;
    ev.push({ kind: 'move', start: ret, end: ret + COMMUTE, title: 'EPFL → maison' });
  }
  for (const s of [720, 735, 705, 750, 780, 795, 690]) if (free(s, s + 45)) { ev.push({ kind: 'meal', start: s, end: s + 45, title: courses.some(c => c.start < s + 120 && c.end > s - 60) ? 'Midi à l’EPFL' : 'Midi' }); break; }
  const wind = sleep - 30;
  ev.push({ kind: 'rest', start: wind, end: sleep, title: 'Écrans off, routine du soir' });
  for (const s of [1140, 1155, 1170, 1185, 1200, 1110, 1095]) if (s + 45 <= wind && free(s, s + 45)) { ev.push({ kind: 'meal', start: s, end: s + 45, title: 'Souper' }); break; }
  const eveStart = Math.max(wake + 30, wind - m.freeEve);
  // catch-up window: the first part of the free evening, never below MIN_FREE_EVE of real free time
  const extEnd = Math.min(eveStart + (+m.ext || 0), wind - MIN_FREE_EVE);
  const gapsIn = (lo, hi) => {
    const out = []; let t = lo;
    for (const b of busy().filter(b => b.end > lo && b.start < hi).sort((a, b) => a.start - b.start)) { if (b.start > t) out.push({ s: t, e: b.start }); t = Math.max(t, b.end); }
    if (hi > t) out.push({ s: t, e: hi });
    return out;
  };
  const gaps = off ? [] : gapsIn(wake + 30, eveStart);
  const extGaps = off || extEnd <= eveStart ? [] : gapsIn(eveStart, extEnd);
  const chunk = (gs, limit) => {
    const res = []; let left = limit;
    for (const g of gs) {
      let t = g.s;
      while (left >= 20) {
        const len = Math.min(+m.block, g.e - t, left);
        if (len < 30 && !(len === left && len >= 20)) break;
        res.push({ start: t, end: t + len, len });
        left -= len; t += len + (+m.pause);
        if (t + 20 > g.e) break;
      }
      if (left < 20) break;
    }
    return res;
  };
  const cap = chunk(gaps, Infinity).reduce((a, x) => a + x.len, 0);
  return { d, date, dIso, we, off, wake, sleep, wind, eveStart, ev, courses, firstC, goHome, gaps, extGaps, chunk, cap };
}

/* ---------- requirements for the week ---------- */
function examWeight(S, su, date) {
  let b = 1;
  if (su.exam) {
    const dd = (fromIso(su.exam) - date) / 864e5;
    if (dd < 0) b = .05; else if (dd <= 3) b = 4; else if (dd <= 7) b = 2.6; else if (dd <= 14) b = 1.7; else if (dd <= 28) b = 1.2;
  } else if (S.mode === 'exam') b = .35;
  for (const mk of S.mocks || []) {
    if (mk.subj !== su.id || !mk.date) continue;
    const dd = (fromIso(mk.date) - date) / 864e5;
    if (dd >= -4 && dd <= 10) b = Math.max(b, 2.2);
  }
  return (PRIO_W[su.prio] || 1) * b;
}
function doneBySubject(S, key) {
  const out = {}; let total = 0;
  for (const v of Object.values(S.done[key] || {})) if (v && typeof v === 'object' && v.m) { out[v.s || '_'] = (out[v.s || '_'] || 0) + v.m; total += v.m; }
  return { by: out, total };
}
/* Séries from last week that were never finished. Only counts if the app was used that week. */
function carryOver(S, weekStart) {
  const prevKey = iso(addDays(weekStart, -7));
  if (!S.done[prevKey] || !weekCfg(S, addDays(weekStart, -7)).coursesOn) return {};
  const done = doneBySubject(S, prevKey).by, out = {};
  for (const su of S.subjects) { const left = (su.serie || 0) + (su.serie ? (su.corr || 0) : 0) - (done[su.id] || 0); if (left >= 20) out[su.id] = Math.round(left); }
  return out;
}

function generate(S0, weekStart, now) {
  now = now || new Date();
  const cfg = weekCfg(S0, weekStart);
  const S = Object.assign({}, S0, { mode: cfg.mode, coursesOn: cfg.coursesOn });
  const m = S.modes[S.mode];
  const key = iso(weekStart);
  const nowT = now.getTime();
  const sinceT = S.since || 0;
  const days = []; for (let d = 0; d < 7; d++) days.push(layoutDay(S, m, weekStart, d));

  // must = this week's séries + unfinished séries from last week; revision fills the rest of the target
  const carry = carryOver(S, weekStart);
  // must = séries + checking them against the correction, plus anything unfinished from last week
  const must = {}, corr = {}; let mustTotal = 0;
  for (const su of S.subjects) {
    const c = S.coursesOn && su.serie ? (+su.corr || 0) : 0;
    const v = (S.coursesOn ? (+su.serie || 0) : 0) + c + (carry[su.id] || 0);
    corr[su.id] = c;
    if (v > 0) { must[su.id] = v; mustTotal += v; }
  }
  let T = S.mode === 'recup' ? Math.min(+m.week, mustTotal || +m.week) : Math.max(+m.week, mustTotal ? Math.ceil((mustTotal * 1.1 + 30) / 15) * 15 : 0);

  // trip days only get their light study; the rest of the target shrinks with them
  const tripDays = days.filter(x => x.trip);
  if (tripDays.length) {
    const homeW = days.filter(x => !x.trip).reduce((a, x) => a + (x.d === 5 ? +m.sat : x.d === 6 ? +m.sun : 1), 0);
    const fullW = 5 + (+m.sat) + (+m.sun);
    T = Math.max(mustTotal, Math.round(T * homeW / (fullW || 1))) + tripDays.reduce((a, x) => a + x.cap, 0);
  }
  // spread T over the days: proportional to free time × weekend share, capped by each day's room
  const w = days.map(x => x.off || x.trip ? 0 : x.d === 5 ? +m.sat : x.d === 6 ? +m.sun : 1);
  const alloc = days.map(() => 0); let rem = T - tripDays.reduce((a, x) => a + x.cap, 0); let active = days.map((x, i) => i).filter(i => w[i] > 0 && days[i].cap > 0);
  for (let it = 0; it < 8 && rem > 1 && active.length; it++) {
    const sw = active.reduce((a, i) => a + w[i] * days[i].cap, 0);
    const sat = active.filter(i => alloc[i] + rem * w[i] * days[i].cap / sw >= days[i].cap);
    if (!sat.length) { active.forEach(i => { alloc[i] += rem * w[i] * days[i].cap / sw; }); rem = 0; break; }
    sat.forEach(i => { rem -= days[i].cap - alloc[i]; alloc[i] = days[i].cap; });
    active = active.filter(i => !sat.includes(i));
  }
  const placed = days.map((x, i) => x.trip ? x.chunk(x.gaps, x.cap) : x.chunk(x.gaps, Math.round(alloc[i] / 5) * 5));
  // rounding and minimum block sizes leave a few minutes out: give them to the days that still have room
  let deficit = T - placed.flat().reduce((a, c) => a + c.len, 0);
  for (const i of days.map((x, i) => i).filter(i => w[i] > 0).sort((a, b) => (days[b].cap - alloc[b]) - (days[a].cap - alloc[a]))) {
    if (deficit < 15) break;
    const had = placed[i].reduce((a, c) => a + c.len, 0);
    const more = days[i].chunk(days[i].gaps, had + Math.max(deficit, 20));
    const got = more.reduce((a, c) => a + c.len, 0) - had;
    if (got > 0) { placed[i] = more; deficit -= got; }
  }
  const unplaced = Math.max(0, Math.round(deficit));
  const slots = [];
  days.forEach((x, i) => {
    x.alloc = placed[i].reduce((a, c) => a + c.len, 0);
    placed[i].forEach(c => slots.push(Object.assign(c, { d: x.d, date: x.date, startT: x.date.getTime() + c.start * 6e4, endT: x.date.getTime() + c.end * 6e4, campus: !x.we && x.courses.length && c.start >= x.firstC && x.goHome != null && c.start < x.goHome })));
  });

  // revision budget by subject
  const revPool = Math.max(0, T - mustTotal);
  const ws = S.subjects.map(su => examWeight(S, su, addDays(weekStart, 3)));
  const wsum = ws.reduce((a, b) => a + b, 0) || 1;
  const rev = {}; S.subjects.forEach((su, i) => { rev[su.id] = revPool * ws[i] / wsum; });

  const labels = REV_LABELS[S.mode] || REV_LABELS.normal;
  const serieLabel = (su, isCarry) => isCarry ? 'Série en retard' : 'Série d’exercices';
  const prevCourse = (s) => days[s.d].courses.find(c => c.end <= s.start && c.end >= s.start - 60 && c.type === 'Cours');

  // assignment helper: fills slots in order from the given budgets (must first, then revision)
  function assignInto(list, mustLeft, carryLeft, revLeft, corrLeft) {
    const lastByDay = {}; const cnt = {};
    for (const s of list) {
      let pick = null, kind = null;
      // a subject's correction check only comes once its série is fully placed
      const serieLeft = k => mustLeft[k] - (corrLeft[k] || 0);
      const mk = Object.keys(mustLeft).filter(k => mustLeft[k] >= 15 && subjOf(S, k));
      const ck = mk.filter(k => serieLeft(k) < 15 && (corrLeft[k] || 0) >= 15);
      const sk = mk.filter(k => serieLeft(k) >= 15);
      if (ck.length) {
        ck.sort((a, b) => (lastByDay[s.d] === a) - (lastByDay[s.d] === b));
        pick = ck[0]; kind = 'corr';
      } else if (sk.length) {
        mk.length = 0; mk.push(...sk);
        // late séries first, then the subject with the most left; avoid repeating the previous block's subject
        mk.sort((a, b) => ((carryLeft[b] || 0) > 0) - ((carryLeft[a] || 0) > 0) || (mustLeft[b] - (lastByDay[s.d] === b ? 1e4 : 0)) - (mustLeft[a] - (lastByDay[s.d] === a ? 1e4 : 0)));
        pick = mk[0]; kind = 'serie';
      } else {
        const rk = Object.keys(revLeft).filter(k => revLeft[k] >= 15 && subjOf(S, k));
        if (rk.length) {
          const pc = prevCourse(s);
          if (pc && rk.includes(pc.subj) && S.mode !== 'exam' && lastByDay[s.d] !== pc.subj) pick = pc.subj;
          else {
            const mockSoon = k => (S.mocks || []).some(x => x.subj === k && x.date && fromIso(x.date) > s.date && (fromIso(x.date) - s.date) / 864e5 <= 4) ? 600 : 0;
            rk.sort((a, b) => (revLeft[b] + mockSoon(b) - (lastByDay[s.d] === b ? 1e4 : 0)) - (revLeft[a] + mockSoon(a) - (lastByDay[s.d] === a ? 1e4 : 0))); pick = rk[0];
          }
          kind = 'rev';
        }
      }
      if (!pick) { s.kind2 = 'ahead'; continue; }
      const su = subjOf(S, pick);
      if (kind === 'corr') {
        const need = Math.max(20, Math.min(s.len, corrLeft[pick]));
        if (need < s.len) { s.end = s.start + need; s.endT = s.startT + need * 6e4; s.len = need; }
        s.title = 'Vérifier la série avec la correction'; s.serie = true; s.corr = true;
        mustLeft[pick] -= s.len; corrLeft[pick] -= s.len;
      } else if (kind === 'serie') {
        const sl = mustLeft[pick] - (corrLeft[pick] || 0);
        if (sl + 20 <= s.len) { const need = Math.max(20, sl); s.end = s.start + need; s.endT = s.startT + need * 6e4; s.len = need; }
        const isCarry = (carryLeft[pick] || 0) > 0;
        s.title = serieLabel(su, isCarry); s.serie = true; s.late = isCarry;
        mustLeft[pick] -= s.len; if (isCarry) carryLeft[pick] -= s.len;
      } else {
        const pc = prevCourse(s);
        const k = cnt[pick] = (cnt[pick] || 0) + 1;
        s.title = pc && pc.subj === pick && S.mode !== 'exam' ? 'Reprendre le cours à chaud' : labels[(k - 1) % labels.length];
        revLeft[pick] -= s.len;
      }
      s.subj = pick; lastByDay[s.d] = pick;
    }
  }

  // 1. reference plan for the whole week (what each block "was meant" to be)
  const base = slots.map(s => Object.assign({}, s));
  assignInto(base, clone(must), clone(carry), clone(rev), clone(corr));

  // 2. live plan: done work comes off the budgets, unfinished work moves to the blocks still ahead
  const doneMap = S.done[key] || {};
  const { by: doneBy } = doneBySubject(S, key);
  const mustLeft = {}, carryLeft = {}, revLeft = {}, corrLeft = {};
  for (const su of S.subjects) {
    const dn = doneBy[su.id] || 0;
    const mu = must[su.id] || 0;
    mustLeft[su.id] = Math.max(0, mu - dn);
    corrLeft[su.id] = Math.min(corr[su.id] || 0, mustLeft[su.id]);
    carryLeft[su.id] = Math.max(0, (carry[su.id] || 0) - dn);
    revLeft[su.id] = Math.max(0, (rev[su.id] || 0) - Math.max(0, dn - mu));
  }
  const idOf = (d, s) => d + '-' + s.start + '-study';
  const future = [], live = [];
  let lateMin = 0;
  slots.forEach((s, i) => {
    const id = idOf(s.d, s), rec = doneMap[id];
    const b = base[i];
    if (rec && typeof rec === 'object') live.push(Object.assign({}, s, { id, title: rec.t || b.title, subj: rec.s, state: 'done', serie: rec.serie }));
    else if (s.endT <= nowT) {
      const pre = s.endT <= sinceT;
      if (!pre) lateMin += s.len;
      live.push(Object.assign({}, b, { id, state: pre ? 'pre' : 'missed' }));
    } else { const f = Object.assign({}, s, { id, state: 'todo' }); future.push(f); live.push(f); }
  });
  // done blocks that aren't regular slots (catch-up blocks done earlier) keep showing where they were
  const slotIds = new Set(slots.map(s => idOf(s.d, s)));
  for (const [id, rec] of Object.entries(doneMap)) {
    if (slotIds.has(id) || !rec || typeof rec !== 'object' || rec.d == null || rec.a == null) continue;
    const x = days[rec.d]; if (!x) continue;
    live.push({ d: rec.d, date: x.date, start: rec.a, end: rec.a + rec.m, len: rec.m, id, title: rec.t, subj: rec.s, state: 'done', catchup: true });
  }
  const mustNeeded = Object.values(mustLeft).reduce((a, b) => a + b, 0);
  const futureCap = future.reduce((a, s) => a + s.len, 0);
  // 3. not enough room for the séries → first the bounded catch-up time in the evenings still ahead,
  //    then daytime free time left on the remaining days (never on days off, trips or off-weekends)
  let extended = 0;
  const freeParts = (x, gs) => {
    const taken = live.filter(s => s.d === x.d).map(s => ({ s: s.start - (+m.pause), e: s.end + (+m.pause) }));
    const out = [];
    for (const g of gs) {
      let parts = [{ s: g.s, e: g.e }];
      for (const t of taken) parts = parts.flatMap(p => t.e <= p.s || t.s >= p.e ? [p] : [{ s: p.s, e: Math.min(p.e, t.s) }, { s: Math.max(p.s, t.e), e: p.e }].filter(q => q.e - q.s >= 20));
      out.push(...parts);
    }
    return out;
  };
  function extendBy(need) {
    const added = [];
    for (const pass of ['ext', 'day']) for (const x of days) {
      if (need < 15) return added;
      if (x.off || x.trip || (pass === 'day' && w[x.d] === 0)) continue;
      for (const c of x.chunk(freeParts(x, pass === 'ext' ? x.extGaps : x.gaps), need)) {
        const startT = x.date.getTime() + c.start * 6e4, endT = x.date.getTime() + c.end * 6e4;
        if (endT <= nowT) continue;
        const f = Object.assign(c, { d: x.d, date: x.date, startT, endT, id: x.d + '-' + c.start + '-study', state: 'todo', catchup: true });
        added.push(f); live.push(f); need -= c.len; extended += c.len;
        if (need < 15) break;
      }
    }
    return added;
  }
  // (10% + 30 min of margin: blocks rarely line up exactly with what's left of each série)
  const mustNeed = mustNeeded ? Math.round(mustNeeded * 1.1 + 30) : 0;
  if (mustNeed > futureCap) future.push(...extendBy(mustNeed - futureCap));
  future.sort((a, b) => a.startT - b.startT);
  assignInto(future, mustLeft, carryLeft, revLeft, corrLeft);
  const leftNow = () => Object.values(mustLeft).reduce((a, b) => a + (b >= 25 ? b : 0), 0);
  for (let k = 0; k < 2 && leftNow() >= 25; k++) {
    const more = extendBy(leftNow() + 20).sort((a, b) => a.startT - b.startT);
    if (!more.length) break;
    assignInto(more, mustLeft, carryLeft, {}, corrLeft);
  }
  const mustLeftAfter = leftNow();

  for (const s of live) {
    const x = days[s.d];
    if (s.kind2 === 'ahead') { x.ev.push({ kind: 'free', start: s.start, end: s.end, title: 'Libre', sub: 'T’es en avance', id: s.id }); continue; }
    const su = s.subj ? subjOf(S, s.subj) : null;
    x.ev.push({ kind: 'study', start: s.start, end: s.end, title: s.title || 'Étude', sub: [su ? su.name : '', s.campus ? 'à l’EPFL' : '', s.catchup ? 'rattrapage' : ''].filter(Boolean).join(' · '), subj: s.subj, id: s.id, state: s.state, serie: !!s.serie, late: !!s.late, catchup: !!s.catchup, len: s.len });
  }
  // free time and days off
  for (const x of days) {
    const FT = { kind: 'free', title: 'Temps libre', sub: 'guitare, potes, série…' };
    const occupied = () => x.ev.filter(e => e.end > e.start);
    const fill = (lo, hi, tmpl) => {
      let t = lo;
      for (const b of occupied().filter(b => b.end > lo && b.start < hi).sort((a, b) => a.start - b.start)) { if (b.start - t >= 30) x.ev.push(Object.assign({}, tmpl, { start: t, end: b.start })); t = Math.max(t, b.end); }
      if (hi - t >= 30) x.ev.push(Object.assign({}, tmpl, { start: t, end: hi }));
    };
    if (x.trip) fill(x.wake + 30, x.wind, { kind: 'free', title: (x.tripEdge ? 'Voyage · ' : '') + (x.trip.title || 'Voyage'), sub: x.tripEdge ? 'pas d’étude aujourd’hui' : (x.alloc ? 'profite, juste un peu de révision le matin' : 'profite') });
    else if (x.off) fill(x.wake + 30, x.wind, { kind: 'free', title: 'Jour off', sub: 'repos, rien à faire' });
    else {
      fill(x.eveStart, x.wind, FT);
      if (x.we && x.alloc > 0) fill(x.wake + 30, x.eveStart, { kind: 'free', title: 'Libre', sub: 'le reste est à toi' });
      if (x.we && x.alloc === 0) fill(x.wake + 30, x.eveStart, { kind: 'free', title: 'Journée off', sub: 'zéro cours, zéro série' });
    }
    x.ev.sort((a, b) => a.start - b.start);
    x.ev.forEach(e => { if (!e.id) e.id = x.d + '-' + e.start + '-' + e.kind; });
    x.plan = x.ev.filter(e => e.kind === 'study').reduce((a, e) => a + e.end - e.start, 0);
    x.dn = x.ev.filter(e => e.kind === 'study' && e.state === 'done').reduce((a, e) => a + e.end - e.start, 0);
  }
  days.meta = { cfg, T, mustTotal, carry, lateMin, extended, unplaced, mustLeftAfter, sportMin: sportMinutes(S) };
  return days;
}

function summarize(S, days, weekKey) {
  const done = S.done[weekKey] || {};
  let plan = 0, dn = 0, course = 0, sport = 0, sportDone = 0; const per = {};
  for (const day of days) for (const e of day.ev) {
    const L = e.end - e.start;
    if (e.kind === 'study') { plan += L; const p = per[e.subj] = per[e.subj] || { plan: 0, done: 0 }; p.plan += L; if (e.state === 'done') { dn += L; p.done += L; } }
    if (e.kind === 'course') course += L;
    if (e.kind === 'sport') { sport += L; if (done[e.id]) sportDone += L; }
  }
  let sl = 0; for (let i = 0; i < 7; i++) { const nextWake = i < 6 ? days[i + 1].wake : days[0].wake; sl += nextWake + 1440 - days[i].sleep; }
  return { plan, dn, course, sport, sportDone, per, sleepAvg: sl / 7, done, meta: days.meta };
}

function buildNotifications(S, now, horizonDays) {
  const N = S.notif || {}; const out = [];
  const nowT = now.getTime(), endT = nowT + (horizonDays || 14) * 864e5;
  let ws = mondayOf(now);
  const push = (at, title, body, tag) => { if (at > nowT + 30e3 && at < endT) out.push({ at, title, body, tag }); };
  while (ws.getTime() < endT) {
    const days = generate(S, ws, now);
    for (const day of days) {
      const base = day.date.getTime(), T = m => base + m * 6e4, evs = day.ev;
      if (N.morning) {
        const nC = evs.filter(e => e.kind === 'course').length, st = evs.filter(e => e.kind === 'study').reduce((a, e) => a + e.end - e.start, 0);
        const first = evs.find(e => e.kind === 'course');
        const parts = [];
        if (day.off) parts.push('jour off, profite');
        if (nC) parts.push(nC + ' cours' + (first ? ', premier à ' + fmt(first.start) : ''));
        if (st) parts.push(hm(st) + ' d’étude');
        if (evs.some(e => e.kind === 'sport')) parts.push('sport');
        push(T(day.wake), 'Bonjour ! ' + DAYS[day.d] + ' ' + dateLbl(day.date), parts.length ? 'Aujourd’hui : ' + parts.join(', ') + '.' : 'Journée tranquille.', 'morning');
      }
      for (const e of evs) {
        if (e.state === 'done') continue;
        if (e.kind === 'course' && N.course > 0) push(T(e.start - N.course), fmt(e.start) + ' · ' + e.title, (e.sub || 'Cours') + ' · dans ' + N.course + ' min', 'c' + e.id);
        if (e.kind === 'study' && N.study) push(T(e.start), (e.late || e.catchup ? 'Rattrapage · ' : 'Étude · ') + ((subjOf(S, e.subj) || {}).name || ''), e.title + ' · ' + hm(e.end - e.start), 's' + e.id);
        if (e.kind === 'sport' && N.sport) push(T(e.start - 10), e.title + ' à ' + fmt(e.start), 'Prends tes affaires, ça commence dans 10 min.', 'p' + e.id);
        if (e.kind === 'routine' && N.routine) push(T(e.start), e.title, fmt(e.start) + '–' + fmt(e.end), 'r' + e.id);
        if (e.kind === 'event' && N.event > 0) push(T(e.start - N.event), e.title + ' à ' + fmt(e.start), (e.sub ? e.sub + ' · ' : '') + 'dans ' + N.event + ' min', 'e' + e.id);
      }
      if (N.evening && evs.some(e => e.kind === 'study')) push(T(day.sleep - 50), 'Bilan du jour', 'Coche ce que t’as fait : le reste sera replacé dans ta semaine.', 'evening');
    }
    ws = addDays(ws, 7);
  }
  // every Sunday evening: pick next week's mode
  for (let t = mondayOf(now); t.getTime() < endT; t = addDays(t, 7)) {
    const sun = addDays(t, 6); sun.setHours(19, 30, 0, 0);
    const rec = recommendMode(S, addDays(t, 7));
    push(sun.getTime(), 'Quel mode pour la semaine prochaine ?', rec ? 'Je te conseille ' + MODE_META[rec.mode].name + ' : ' + rec.why : 'Ouvre l’app pour choisir ton mode et dire si t’as cours.', 'week' + iso(t));
  }
  if (N.deadline) for (const mk of S.mocks || []) {
    if (!mk.date) continue; const su = subjOf(S, mk.subj); const t = addDays(fromIso(mk.date), -1); t.setHours(19, 30, 0, 0);
    push(t.getTime(), 'Examen blanc demain · ' + (su ? su.name : ''), 'Facultatif, mais révise tes fiches et dors bien.', 'm' + mk.id);
  }
  if (N.deadline) for (const su of S.subjects) {
    if (!su.exam) continue; const ex = fromIso(su.exam);
    for (const k of [7, 1]) { const t = addDays(ex, -k); t.setHours(19, 30, 0, 0); push(t.getTime(), 'Examen ' + su.name + (k === 1 ? ' demain' : ' dans une semaine'), k === 1 ? 'Relis tes fiches, prépare tes affaires et dors tôt.' : 'Passe en mode Exam si c’est pas déjà fait.', 'x' + su.id + k); }
  }
  out.sort((a, b) => a.at - b.at);
  return out.slice(0, 400);
}

function buildAgenda(S, now, nDays) {
  const out = []; const nowT = now.getTime(); const endT = nowT + (nDays || 3) * 864e5;
  let ws = mondayOf(now);
  while (ws.getTime() < endT) {
    for (const day of generate(S, ws, now)) {
      const base = day.date.getTime();
      for (const e of day.ev) {
        if (['meal', 'move', 'rest'].includes(e.kind) || e.state === 'done') continue;
        const s = base + e.start * 6e4, en = base + e.end * 6e4;
        if (en <= nowT || s >= endT) continue;
        const su = e.subj ? subjOf(S, e.subj) : null;
        out.push({ s, e: en, t: e.title, u: e.sub || '', c: su ? su.color : (e.kind === 'event' ? '#E2510E' : '#9C99A3'), k: e.kind });
      }
    }
    ws = addDays(ws, 7);
  }
  return out.sort((a, b) => a.s - b.s).slice(0, 40);
}

const API = { tripOn, weekCfg, recommendMode, DAYS, DAYS_S, MONTHS, MONTHS_L, MODE_ORDER, MODE_META, MODE_DEFAULTS, SPORT_MIN, SPORT_MAX, clone, pad, fmt, parseT, hm, addDays, iso, fromIso, mondayOf, dateLbl, uid, dow, defaultState, normalize, subjOf, sportMinutes, generate, summarize, buildNotifications, buildAgenda };
if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.Semaine = API;
})(typeof self !== 'undefined' ? self : this);
