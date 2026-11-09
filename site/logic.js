/* Ma semaine EPFL — planning logic (no DOM). Shared by the app and the tests. */
(function (root) {
'use strict';
const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const DAYS_S = ['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di'];
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MONTHS_L = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MODE_ORDER = ['chill', 'normal', 'charbon', 'exam', 'recup'];
const MODE_META = {
  chill: { name: 'Chill', tag: 'Le minimum pour suivre. Soirées longues et samedi off.' },
  normal: { name: 'Normal', tag: 'Rythme de croisière : séries à jour, sport trois fois, soirées à toi.' },
  charbon: { name: 'Charbon', tag: 'Grosse semaine. Tu restes à l’EPFL jusqu’au soir et presque tout le temps libre passe en étude. Le sommeil, lui, ne bouge pas.' },
  exam: { name: 'Exam', tag: 'Révisions. Les matières dont l’examen approche passent devant, priorité aux annales et à la révision active.' },
  recup: { name: 'Récup', tag: 'Fatigué ou malade : le strict minimum, beaucoup de sommeil, un peu d’air.' }
};
const MODE_DEFAULTS = {
  chill:   { wake: 480, wakeWE: 570, sleep: 1410, studyDay: 120, sat: 0,   sun: 120, block: 45, pause: 15, sportDays: [1, 3, 5], sportMin: 75, sportLabel: 'Sport', freeEve: 150 },
  normal:  { wake: 450, wakeWE: 510, sleep: 1380, studyDay: 210, sat: 150, sun: 120, block: 50, pause: 10, sportDays: [1, 3, 5], sportMin: 60, sportLabel: 'Sport', freeEve: 90 },
  charbon: { wake: 405, wakeWE: 480, sleep: 1380, studyDay: 330, sat: 330, sun: 240, block: 50, pause: 10, sportDays: [2, 5],    sportMin: 60, sportLabel: 'Sport (vider la tête)', freeEve: 45 },
  exam:    { wake: 450, wakeWE: 480, sleep: 1380, studyDay: 360, sat: 360, sun: 300, block: 50, pause: 10, sportDays: [1, 3, 5], sportMin: 45, sportLabel: 'Sport court', freeEve: 60 },
  recup:   { wake: 510, wakeWE: 600, sleep: 1365, studyDay: 60,  sat: 0,   sun: 60,  block: 30, pause: 15, sportDays: [2, 5],    sportMin: 30, sportLabel: 'Marche au bord du lac', freeEve: 180 }
};
const LABELS = {
  chill: ['Série d’exercices', 'Relire le cours'],
  normal: ['Série d’exercices', 'Relire + fiche résumé'],
  charbon: ['Série d’exercices', 'Fiches + exos en plus', 'Refaire les exos ratés'],
  exam: ['Annales / examen blanc', 'Révision active (fiches, flashcards)', 'Refaire les séries'],
  recup: ['Relire tranquillement']
};
const PRIO_W = [0, 1, 1.6, 2.3];
const COMMUTE = 40;

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

function defaultState() {
  const C = (day, s, e, subj, type, room) => ({ id: uid(), day, start: s, end: e, subj, type, room: room || '' });
  const R = (day, s, e, title) => ({ id: uid(), day, start: s, end: e, title });
  return {
    v: 2, mode: 'normal', coursesOn: true,
    subjects: [
      { id: 'ana', name: 'Analyse I', color: '#C2410C', prio: 3, exam: '' },
      { id: 'alg', name: 'Algèbre linéaire', color: '#1D4ED8', prio: 3, exam: '' },
      { id: 'phy', name: 'Physique (mécanique)', color: '#047857', prio: 2, exam: '' },
      { id: 'aicc', name: 'AICC I', color: '#7C3AED', prio: 2, exam: '' },
      { id: 'prog', name: 'Programmation', color: '#0E7490', prio: 2, exam: '' }
    ],
    courses: [
      C(0, 615, 720, 'ana', 'Cours', 'CM 1 2 / CO 3'), C(0, 975, 1140, 'phy', 'Cours', 'CE 1 6'),
      C(1, 495, 600, 'aicc', 'Cours', 'RLC E1 240'), C(1, 615, 660, 'phy', 'Cours', ''), C(1, 915, 1020, 'alg', 'Cours', 'CE 1 1 / CO 3'),
      C(2, 615, 720, 'ana', 'Cours', 'BCH 2201 / CE 1 1'), C(2, 795, 900, 'prog', 'Cours', 'RLC E1 240'), C(2, 915, 1020, 'aicc', 'Cours', 'RLC E1 240'), C(2, 1035, 1140, 'phy', 'Exercices', ''),
      C(3, 495, 600, 'alg', 'Cours', 'SG 1138'), C(3, 615, 720, 'ana', 'Exercices', ''),
      C(4, 495, 600, 'alg', 'Exercices', ''), C(4, 615, 720, 'aicc', 'Exercices', ''), C(4, 795, 900, 'prog', 'Exercices', ''), C(4, 915, 960, 'prog', 'Cours', 'INF')
    ],
    routines: [
      R(5, 570, 660, 'Courses + lessive'),
      R(6, 705, 840, 'Cuisiner les lunchs de la semaine'),
      R(6, 1215, 1260, 'Préparer la semaine (sac, lunch, cours de lundi)')
    ],
    deadlines: [],
    events: [],
    modes: clone(MODE_DEFAULTS),
    notif: { on: false, course: 10, study: true, sport: true, routine: true, morning: true, evening: true, deadline: true, event: 15 },
    done: {}
  };
}

function normalize(s) {
  const d = defaultState();
  const out = Object.assign({}, d, s || {});
  out.modes = Object.assign({}, clone(MODE_DEFAULTS), out.modes || {});
  for (const k of MODE_ORDER) out.modes[k] = Object.assign({}, MODE_DEFAULTS[k], out.modes[k] || {});
  if (!MODE_ORDER.includes(out.mode)) out.mode = 'normal';
  out.notif = Object.assign({}, d.notif, out.notif || {});
  out.done = out.done || {};
  ['subjects', 'courses', 'routines', 'deadlines', 'events'].forEach(k => { if (!Array.isArray(out[k])) out[k] = d[k]; });
  out.v = 2;
  return out;
}

const subjOf = (S, id) => S.subjects.find(x => x.id === id);

function generate(S, weekStart) {
  const m = S.modes[S.mode];
  const days = [], slots = [];
  for (let d = 0; d < 7; d++) {
    const date = addDays(weekStart, d), we = d >= 5, dIso = iso(date);
    const courses = S.coursesOn ? S.courses.filter(c => c.day === d && c.end > c.start).sort((a, b) => a.start - b.start) : [];
    const firstC = courses.length ? courses[0].start : null;
    const lastC = courses.length ? Math.max(...courses.map(c => c.end)) : null;
    const wake = firstC != null ? Math.min(we ? m.wakeWE : m.wake, firstC - 30 - COMMUTE - 15) : (we ? m.wakeWE : m.wake);
    let sleep = m.sleep; if (sleep < 240) sleep += 1440; if (sleep > 1440) sleep = 1440;
    const ev = [];
    const busy = () => ev.filter(e => e.end > e.start);
    const free = (s, e) => busy().every(b => b.end <= s || b.start >= e);
    ev.push({ kind: 'mark', start: wake, end: wake, title: 'Réveil ' + fmt(wake) });
    ev.push({ kind: 'meal', start: wake, end: wake + 30, title: 'Petit-déj' });
    courses.forEach(c => { const su = subjOf(S, c.subj); ev.push({ kind: 'course', start: c.start, end: c.end, title: su ? su.name : 'Cours', sub: [c.type, c.room].filter(Boolean).join(' · '), subj: c.subj, ctype: c.type, cid: c.id }); });
    // one-off events and weekly routines are fixed
    (S.events || []).filter(x => x.date === dIso && x.end > x.start).forEach(x => ev.push({ kind: 'event', start: x.start, end: x.end, title: x.title || 'Événement', sub: x.place || '', eid: x.id }));
    (S.routines || []).filter(r => r.day === d && r.end > r.start).forEach(r => { if (free(r.start, r.end)) ev.push({ kind: 'routine', start: r.start, end: r.end, title: r.title }); });
    // commute
    let goHome = null;
    if (courses.length) {
      if (free(firstC - COMMUTE - 5, firstC - 5)) ev.push({ kind: 'move', start: firstC - COMMUTE - 5, end: firstC - 5, title: 'Maison → EPFL' });
      let ret = S.mode === 'charbon' ? Math.max(lastC, 1110) : lastC;
      for (let k = 0; k < 6 && !free(ret, ret + COMMUTE); k++) ret += 15;
      goHome = ret;
      ev.push({ kind: 'move', start: ret, end: ret + COMMUTE, title: 'EPFL → maison' });
    }
    for (const s of [720, 735, 705, 750, 780, 795, 690]) if (free(s, s + 45)) { ev.push({ kind: 'meal', start: s, end: s + 45, title: courses.some(c => c.start < s + 120 && c.end > s - 60) ? 'Midi à l’EPFL' : 'Midi' }); break; }
    const wind = sleep - 30;
    ev.push({ kind: 'rest', start: wind, end: sleep, title: 'Écrans off, routine du soir' });
    let dinner = null;
    for (const s of [1140, 1155, 1170, 1185, 1200, 1110, 1095]) if (s + 45 <= wind && free(s, s + 45)) { dinner = { kind: 'meal', start: s, end: s + 45, title: 'Souper' }; ev.push(dinner); break; }
    let eveStart = wind - m.freeEve;
    if (m.freeEve > 0) {
      const FT = { kind: 'free', title: 'Temps libre', sub: 'guitare, potes, série…' };
      if (dinner && eveStart < dinner.end && eveStart >= dinner.start) eveStart = dinner.end;
      // never put free time on top of a fixed thing
      const pieces = [];
      let t = eveStart;
      for (const b of busy().filter(b => b.end > eveStart && b.start < wind).sort((a, b) => a.start - b.start)) { if (b.start > t) pieces.push([t, b.start]); t = Math.max(t, b.end); }
      if (t < wind) pieces.push([t, wind]);
      pieces.filter(p => p[1] - p[0] >= 15).forEach(p => ev.push(Object.assign({}, FT, { start: p[0], end: p[1] })));
    }
    const studyEnd = Math.min(eveStart, wind);
    if ((m.sportDays || []).includes(d) && m.sportMin > 0) {
      const L = +m.sportMin;
      const cands = we ? [630, 690, 960, 1020, 900] : [1035, 1080, 1020, 975, 1110, 1200, 750];
      for (const s of cands) if (s >= wake + 30 && s + L <= studyEnd && free(s, s + L)) { ev.push({ kind: 'sport', start: s, end: s + L, title: m.sportLabel || 'Sport', sub: we ? '' : 'Centre sportif UNIL-EPFL' }); break; }
    }
    const target = we ? (d === 5 ? +m.sat : +m.sun) : +m.studyDay;
    const gaps = [];
    {
      const bs = busy().filter(b => b.end > wake + 30 && b.start < studyEnd).sort((a, b) => a.start - b.start);
      let t = wake + 30;
      for (const b of bs) { if (b.start > t) gaps.push({ s: t, e: b.start }); t = Math.max(t, b.end); }
      if (studyEnd > t) gaps.push({ s: t, e: studyEnd });
    }
    if (we && target === 0) gaps.forEach(g => { if (g.e - g.s >= 30) ev.push({ kind: 'free', start: g.s, end: g.e, title: 'Journée off', sub: 'zéro cours, zéro série' }); });
    let remaining = target;
    if (target > 0) for (const g of gaps) {
      let t = g.s;
      while (remaining >= 20) {
        const len = Math.min(+m.block, g.e - t, remaining);
        if (len < 30 && !(len === remaining && len >= 20)) break;
        const prevC = courses.find(c => c.end <= t && c.end >= t - 60);
        const campus = !we && courses.length && t >= firstC && goHome != null && t < goHome;
        slots.push({ d, date, start: t, end: t + len, len, prevC, campus, startT: date.getTime() + t * 6e4, endT: date.getTime() + (t + len) * 6e4 });
        remaining -= len; t += len + (+m.pause);
        if (t + 20 > g.e) break;
      }
      if (remaining < 20) break;
    }
    if (we && target > 0) {
      const daySlots = slots.filter(x => x.d === d);
      for (const g of gaps) {
        let t = g.s;
        for (const x of daySlots.filter(x => x.start >= g.s && x.end <= g.e)) t = Math.max(t, x.end + (+m.pause));
        if (g.e - t >= 90) ev.push({ kind: 'free', start: t, end: g.e, title: 'Libre', sub: 'le reste est à toi' });
      }
    }
    days.push({ d, date, wake, sleep, ev, target, shortfall: remaining >= 20 ? remaining : 0 });
  }
  assign(S, slots);
  for (const s of slots) {
    const su = subjOf(S, s.subj);
    const sub = [su ? su.name : '', s.campus ? 'à l’EPFL' : ''].filter(Boolean).join(' · ');
    days[s.d].ev.push({ kind: 'study', start: s.start, end: s.end, title: s.title, sub, subj: s.subj, deadline: s.deadline, dueLbl: s.dueLbl });
  }
  for (const day of days) {
    day.ev.sort((a, b) => a.start - b.start || (a.kind === 'mark' ? -1 : b.kind === 'mark' ? 1 : 0));
    day.ev.forEach(e => { e.id = day.d + '-' + e.start + '-' + e.kind; });
  }
  return days;
}

function assign(S, slots) {
  const subs = S.subjects;
  if (!subs.length) { slots.forEach(s => { s.title = 'Étude'; s.subj = null; }); return; }
  const assigned = {}; let total = 0;
  const give = (s, id, title) => { s.subj = id; s.title = title; assigned[id] = (assigned[id] || 0) + s.len; total += s.len; };
  const ws = slots.length ? slots[0].startT : 0;
  const dls = S.deadlines.filter(x => x.due && subjOf(S, x.subj)).map(x => ({ ...x, dueT: new Date(x.due).getTime(), need: Math.round((+x.hours || 0) * 60) }))
    .filter(x => x.need > 0 && x.dueT > ws).sort((a, b) => a.dueT - b.dueT);
  for (const dl of dls) {
    const win = dl.dueT - 4 * 864e5;
    const c = slots.filter(s => !s.subj && s.endT <= dl.dueT);
    const inW = c.filter(s => s.startT >= win).sort((a, b) => a.startT - b.startT);
    const outW = c.filter(s => s.startT < win).sort((a, b) => b.startT - a.startT);
    const due = new Date(dl.dueT);
    const lbl = DAYS[dow(due)].toLowerCase() + ' ' + fmt(due.getHours() * 60 + due.getMinutes());
    const perDay = {};
    for (const pass of [2, 99]) for (const s of inW.concat(outW)) {
      if (dl.need <= 0) break; if (s.subj || (perDay[s.d] || 0) >= pass) continue;
      give(s, dl.subj, dl.title); s.deadline = true; s.dueLbl = 'pour ' + lbl; dl.need -= s.len; perDay[s.d] = (perDay[s.d] || 0) + 1;
    }
  }
  if (S.mode !== 'exam') {
    const used = new Set();
    for (const s of slots) {
      if (s.subj || !s.prevC || s.prevC.type !== 'Cours' || used.has(s.prevC.id) || !subjOf(S, s.prevC.subj)) continue;
      used.add(s.prevC.id); give(s, s.prevC.subj, 'Reprendre le cours à chaud');
    }
  }
  const weight = (su, date) => {
    let b = 1;
    if (su.exam) {
      const dd = (fromIso(su.exam) - date) / 864e5;
      if (dd < 0) b = .05; else if (dd <= 3) b = 4; else if (dd <= 7) b = 2.6; else if (dd <= 14) b = 1.7; else if (dd <= 28) b = 1.2;
    } else if (S.mode === 'exam') b = .35;
    return (PRIO_W[su.prio] || 1) * b;
  };
  const labels = LABELS[S.mode] || LABELS.normal; const cnt = {};
  const lastByDay = {};
  for (const s of slots.slice().sort((a, b) => a.startT - b.startT)) {
    if (s.subj) { lastByDay[s.d] = s.subj; continue; }
    const w = subs.map(su => weight(su, s.date)); const sum = w.reduce((a, b) => a + b, 0) || 1;
    let best = null, bv = -Infinity;
    subs.forEach((su, i) => {
      let v = (total + s.len) * w[i] / sum - (assigned[su.id] || 0);
      if (lastByDay[s.d] === su.id && subs.length > 1) v -= s.len * 0.9;
      if (v > bv) { bv = v; best = su; }
    });
    const k = cnt[best.id] = (cnt[best.id] || 0) + 1;
    give(s, best.id, labels[(k - 1) % labels.length]);
    lastByDay[s.d] = best.id;
  }
}

function summarize(S, days, weekKey) {
  const done = S.done[weekKey] || {};
  let plan = 0, dn = 0, course = 0, sport = 0, sportDone = 0; const per = {};
  for (const day of days) {
    day.plan = 0; day.dn = 0;
    for (const e of day.ev) {
      const L = e.end - e.start;
      if (e.kind === 'study') { plan += L; day.plan += L; const p = per[e.subj] = per[e.subj] || { plan: 0, done: 0 }; p.plan += L; if (done[e.id]) { dn += L; day.dn += L; p.done += L; } }
      if (e.kind === 'course') course += L;
      if (e.kind === 'sport') { sport++; if (done[e.id]) sportDone++; }
    }
  }
  let sl = 0; for (let i = 0; i < 7; i++) { const nextWake = i < 6 ? days[i + 1].wake : days[0].wake; sl += nextWake + 1440 - days[i].sleep; }
  return { plan, dn, course, sport, sportDone, per, sleepAvg: sl / 7, done };
}

/* Notifications for the next `horizonDays`, as [{at, title, body, tag}] */
function buildNotifications(S, now, horizonDays) {
  const N = S.notif || {}; const out = [];
  const nowT = now.getTime(), endT = nowT + (horizonDays || 14) * 864e5;
  let ws = mondayOf(now);
  const push = (at, title, body, tag) => { if (at > nowT + 30e3 && at < endT) out.push({ at, title, body, tag }); };
  while (ws.getTime() < endT) {
    const days = generate(S, ws);
    const done = S.done[iso(ws)] || {};
    for (const day of days) {
      const base = day.date.getTime(), T = m => base + m * 6e4;
      const evs = day.ev;
      if (N.morning) {
        const nC = evs.filter(e => e.kind === 'course').length, st = evs.filter(e => e.kind === 'study').reduce((a, e) => a + e.end - e.start, 0);
        const first = evs.find(e => e.kind === 'course');
        const parts = [];
        if (nC) parts.push(nC + ' cours' + (first ? ', premier à ' + fmt(first.start) : ''));
        if (st) parts.push(hm(st) + ' d’étude');
        if (evs.some(e => e.kind === 'sport')) parts.push('sport');
        push(T(day.wake), 'Bonjour ! ' + DAYS[day.d] + ' ' + dateLbl(day.date), parts.length ? 'Aujourd’hui : ' + parts.join(', ') + '.' : 'Journée tranquille aujourd’hui.', 'morning');
      }
      for (const e of evs) {
        if (done[e.id]) continue;
        if (e.kind === 'course' && N.course > 0) push(T(e.start - N.course), fmt(e.start) + ' · ' + e.title, (e.sub || 'Cours') + ' · dans ' + N.course + ' min', 'c' + e.id);
        if (e.kind === 'study' && N.study) push(T(e.start), 'Bloc d’étude · ' + (subjOf(S, e.subj) || {}).name, e.title + ' · ' + hm(e.end - e.start) + (e.deadline ? ' (' + e.dueLbl + ')' : ''), 's' + e.id);
        if (e.kind === 'sport' && N.sport) push(T(e.start - 10), e.title + ' à ' + fmt(e.start), 'Prends tes affaires, ça commence dans 10 min.', 'p' + e.id);
        if (e.kind === 'routine' && N.routine) push(T(e.start), e.title, fmt(e.start) + '–' + fmt(e.end), 'r' + e.id);
        if (e.kind === 'event' && N.event > 0) push(T(e.start - N.event), e.title + ' à ' + fmt(e.start), (e.sub ? e.sub + ' · ' : '') + 'dans ' + N.event + ' min', 'e' + e.id);
      }
      if (N.evening) {
        const st = evs.filter(e => e.kind === 'study');
        if (st.length) push(T(day.sleep - 50), 'Bilan du jour', 'Ouvre l’app et coche les ' + st.length + ' blocs que t’as faits.', 'evening');
      }
    }
    ws = addDays(ws, 7);
  }
  if (N.deadline) for (const x of S.deadlines) {
    if (!x.due) continue; const due = new Date(x.due); const eve = new Date(due); eve.setDate(eve.getDate() - 1); eve.setHours(20, 0, 0, 0);
    push(eve.getTime(), 'Demain : ' + x.title, 'À rendre ' + DAYS[dow(due)].toLowerCase() + ' à ' + fmt(due.getHours() * 60 + due.getMinutes()) + '.', 'd' + x.id);
  }
  if (N.deadline) for (const su of S.subjects) {
    if (!su.exam) continue; const ex = fromIso(su.exam);
    for (const k of [7, 1]) { const t = addDays(ex, -k); t.setHours(19, 30, 0, 0); push(t.getTime(), 'Examen ' + su.name + (k === 1 ? ' demain' : ' dans une semaine'), k === 1 ? 'Relis tes fiches, prépare tes affaires et dors tôt.' : 'Passe en mode Exam si c’est pas déjà fait.', 'x' + su.id + k); }
  }
  out.sort((a, b) => a.at - b.at);
  return out.slice(0, 400);
}

const API = { DAYS, DAYS_S, MONTHS, MONTHS_L, MODE_ORDER, MODE_META, MODE_DEFAULTS, clone, pad, fmt, parseT, hm, addDays, iso, fromIso, mondayOf, dateLbl, uid, dow, defaultState, normalize, subjOf, generate, summarize, buildNotifications };
if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.Semaine = API;
})(typeof self !== 'undefined' ? self : this);
