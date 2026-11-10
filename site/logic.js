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
  chill:      { week: 720,  sat: 0,   sun: 0.5, block: 45, pause: 15, freeEve: 150, ext: 30, bl: 30 },
  normal:     { week: 1200, sat: 0.6, sun: 0.6, block: 50, pause: 10, freeEve: 90,  ext: 45, bl: 60 },
  charbon:    { week: 1920, sat: 1,   sun: 0.8, block: 50, pause: 10, freeEve: 45,  ext: 60, bl: 90 },
  avance:     { week: 1680, sat: 1,   sun: 0.6, block: 50, pause: 10, freeEve: 75,  ext: 30, bl: 75 },
  rattrapage: { week: 1440, sat: 1,   sun: 0.7, block: 50, pause: 10, freeEve: 120, ext: 75, bl: 150 },
  exam:       { week: 2100, sat: 1,   sun: 1,   block: 50, pause: 10, freeEve: 60,  ext: 60, bl: 45 },
  recup:      { week: 360,  sat: 0,   sun: 0.3, block: 30, pause: 15, freeEve: 180, ext: 0, bl: 0 }
};
const REV_LABELS = {
  chill: ['Relire le cours'], normal: ['Relire + fiche résumé', 'Exos en plus'],
  charbon: ['Fiches + exos en plus', 'Refaire les exos ratés'], rattrapage: ['Relire le cours'],
  avance: ['Fiche de révision du chapitre', 'Exos d’anciens examens', 'Refaire les séries difficiles'],
  exam: ['Annales / examen blanc', 'Révision active (fiches, flashcards)', 'Refaire les séries'], recup: ['Relire tranquillement']
};
const PRIO_W = [0, 1, 1.6, 2.3];
/* 5 minutes every morning: 5 gentle exercises, about 1 min each. Never force, never bounce, breathe slowly. */
const STRETCH = [
  { name: 'Réveil du dos', moves: [
    ['Rotations des épaules', '10 grands cercles vers l’arrière, puis 10 vers l’avant, bras relâchés.', 60, false],
    ['Étirement du cou', 'Oreille vers l’épaule sans lever l’épaule, main posée légèrement sur la tête. 30 s de chaque côté.', 60, true],
    ['Chat-vache', 'À quatre pattes : dos rond en expirant, dos creux en inspirant, lentement.', 60, false],
    ['Posture de l’enfant', 'Fesses vers les talons, bras devant, front au sol. Respire dans le dos.', 60, false],
    ['Flexion avant debout', 'Jambes légèrement pliées, laisse pendre le haut du corps et la tête. Remonte doucement, vertèbre par vertèbre.', 60, false]] },
  { name: 'Hanches et jambes', moves: [
    ['Fente basse', 'Un genou au sol, l’autre pied devant, pousse doucement le bassin vers l’avant. 30 s par côté.', 60, true],
    ['Quadriceps debout', 'Attrape ta cheville derrière toi, genoux serrés, tiens-toi au mur. 30 s par côté.', 60, true],
    ['Mollets au mur', 'Mains au mur, une jambe tendue derrière, talon au sol. 30 s par côté.', 60, true],
    ['Papillon assis', 'Plantes des pieds jointes, genoux qui tombent vers l’extérieur, dos droit.', 60, false],
    ['Rotations de chevilles', '10 cercles par pied dans chaque sens.', 60, false]] },
  { name: 'Spécial bureau', moves: [
    ['Ouverture de poitrine', 'Avant-bras contre un cadre de porte, avance doucement le buste. 30 s par côté.', 60, true],
    ['Poignets', 'Bras tendu, tire doucement les doigts vers toi, paume vers l’avant puis vers toi. 30 s par main.', 60, true],
    ['Torsion assise', 'Assis, tourne le buste en tenant le dossier de la chaise. 30 s par côté.', 60, true],
    ['Menton rentré', 'Rentre le menton comme pour faire un double menton, tiens 3 s, 10 fois. Parfait contre la nuque penchée sur les cours.', 60, false],
    ['Étirement des bras au plafond', 'Doigts croisés, paumes vers le haut, grandis-toi en respirant.', 60, false]] },
  { name: 'Colonne souple', moves: [
    ['Chat-vache', 'À quatre pattes, alterne dos rond et dos creux au rythme de ta respiration.', 60, false],
    ['Fil de l’aiguille', 'À quatre pattes, glisse un bras sous l’autre, épaule au sol. 30 s par côté.', 60, true],
    ['Torsion allongée', 'Sur le dos, genoux pliés qui tombent d’un côté, regard de l’autre. 30 s par côté.', 60, true],
    ['Genoux contre la poitrine', 'Sur le dos, serre les genoux et balance doucement de gauche à droite.', 60, false],
    ['Cobra doux', 'Sur le ventre, mains sous les épaules, soulève juste un peu la poitrine, coudes pliés.', 60, false]] },
  { name: 'Arrière des jambes', moves: [
    ['Ischios assis', 'Une jambe tendue, l’autre pliée, penche-toi dos droit vers le pied tendu. 30 s par côté.', 60, true],
    ['Pigeon allongé', 'Sur le dos, cheville sur le genou opposé, tire la jambe du dessous vers toi. 30 s par côté.', 60, true],
    ['Fente basse', 'Un genou au sol, bassin vers l’avant. 30 s par côté.', 60, true],
    ['Flexion avant debout', 'Genoux souples, laisse pendre, remonte lentement.', 60, false],
    ['Respiration profonde', 'Debout, inspire 4 s en levant les bras, expire 6 s en les descendant.', 60, false]] },
  { name: 'Tout le corps', moves: [
    ['Rotations des épaules', '10 cercles vers l’arrière, 10 vers l’avant.', 60, false],
    ['Inclinaison latérale', 'Un bras au-dessus de la tête, penche-toi sur le côté. 30 s par côté.', 60, true],
    ['Fente basse', 'Un genou au sol, bassin vers l’avant. 30 s par côté.', 60, true],
    ['Chat-vache', 'Dos rond, dos creux, lentement.', 60, false],
    ['Posture de l’enfant', 'Fesses aux talons, bras devant, respire.', 60, false]] },
  { name: 'Dimanche tranquille', moves: [
    ['Respiration profonde', 'Inspire 4 s, expire 6 s, épaules relâchées.', 60, false],
    ['Étirement du cou', 'Oreille vers l’épaule, 30 s par côté.', 60, true],
    ['Papillon assis', 'Plantes des pieds jointes, dos droit.', 60, false],
    ['Torsion allongée', 'Sur le dos, genoux d’un côté. 30 s par côté.', 60, true],
    ['Posture de l’enfant', 'Fesses aux talons, front au sol.', 60, false]] }
];
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
/* Semester week ("semaine 9"): counted from S.semStart; the série of week N is série N */
function semWeek(S, weekStart) {
  if (!S.semStart) return null;
  const n = Math.round((mondayOf(weekStart) - mondayOf(fromIso(S.semStart))) / (7 * 864e5)) + 1;
  return n >= 1 && n <= 20 ? n : null;
}

function defaultState() {
  const C = (day, s, e, subj, type, room) => ({ id: uid(), day, start: s, end: e, subj, type, room: room || '' });
  const R = (day, s, e, title, kind, subj) => ({ id: uid(), day, start: s, end: e, title, kind: kind || 'other', subj: subj || '' });
  return {
    v: 10, semStart: '2026-09-14', blOrder: 'auto', mode: 'normal', coursesOn: true, since: Date.now(),
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
      C(2, 615, 720, 'ana', 'Cours', 'BCH 2201 / CE 1 1'), C(2, 855, 900, 'prog', 'Cours', 'RLC E1 240'), C(2, 915, 1020, 'aicc', 'Cours', 'RLC E1 240'), C(2, 1035, 1140, 'phy', 'Exercices', ''),
      C(3, 495, 600, 'alg', 'Cours', 'SG 1138'), C(3, 615, 720, 'ana', 'Exercices', ''),
      C(4, 495, 600, 'alg', 'Exercices', ''), C(4, 615, 720, 'aicc', 'Exercices', ''), C(4, 795, 900, 'prog', 'Exercices', ''), C(4, 915, 960, 'prog', 'Cours', 'INF')
    ],
    routines: [
      R(0, 910, 970, 'Revoir le cours d’avant + survoler celui d’aujourd’hui', 'study', 'phy'),
      R(2, 795, 840, 'MOOC de prog · 2e heure', 'study', 'prog'),
      R(1, 1035, 1095, 'Sport', 'sport'), R(3, 1050, 1110, 'Sport', 'sport'), R(5, 600, 645, 'Sport', 'sport'),
      R(5, 660, 765, 'Lessive + courses (lancer la machine, courses, ranger, étendre)'),
      R(6, 540, 780, 'Lessive, nettoyage, cuisine'),
      R(6, 1215, 1260, 'Préparer la semaine (sac, lunch, cours de lundi)')
    ],
    events: [], offDays: [], trips: [], mocks: [], backlog: [], cancel: [],
    // weekly tasks with a deadline day (0 = Monday): placed by the planner before that day
    weekly: [{ id: uid(), subj: 'prog', title: 'MOOC de prog · 1re heure', minutes: 60, before: 2 }],
    // projects over several weeks: hours spread until the due date, plus sessions with your partner
    projects: [], rolled: {}, weekModes: {}, autoModes: {}, autoMode: true, noCourseWeeks: [],
    modes: clone(MODE_DEFAULTS),
    notif: { on: false, course: 10, stretch: true, move: true, study: true, sport: true, routine: true, morning: true, evening: true, deadline: true, event: 15 },
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
  if ((old.v || 0) < 8) {
    if (!out.semStart) out.semStart = '2026-09-14';   // week of 9 Nov 2026 = semaine 9
    if (!out.blOrder) out.blOrder = 'auto';
  }
  if ((old.v || 0) < 7) {
    // v6 → v7: the app picks modes by itself; S.mode becomes your usual mode
    out.autoMode = true;
    if (!['chill', 'normal', 'charbon'].includes(out.mode)) out.mode = 'normal';
  }
  if ((old.v || 0) < 6) {
    // v5 → v6: every Monday, 1h of physics prep before the 16:15 lecture
    const has = (out.routines || []).some(r => r.kind === 'study' && r.day === 0);
    const phy = (out.subjects || []).find(x => /phys/i.test(x.name)) || {};
    if (!has && phy.id) out.routines = (out.routines || []).concat([{ id: uid(), day: 0, start: 910, end: 970, title: 'Revoir le cours d’avant + survoler celui d’aujourd’hui', kind: 'study', subj: phy.id }]);
  }
  if ((old.v || 0) < 5) {
    // v4 → v5: Saturday is laundry #1 started before groceries (about 1h15 of laundry overall)
    out.routines = (out.routines || []).filter(r => !(r.day === 5 && r.kind !== 'sport' && /courses|lessive/i.test(r.title)));
    out.routines.push({ id: uid(), day: 5, start: 660, end: 765, title: 'Lessive + courses (lancer la machine, courses, ranger, étendre)', kind: 'other' });
  }
  if ((old.v || 0) < 9) {
    // v8 → v9: the programming MOOC — 1h before Wednesday, 2nd hour in the free first hour of Wednesday's prog slot
    const prog = (out.subjects || []).find(x => x.id === 'prog' || /programm/i.test(x.name));
    if (prog) {
      const wc = (out.courses || []).find(c => c.day === 2 && c.subj === prog.id && c.start === 795 && c.end === 900);
      if (wc) wc.start = 855;
      if (!(out.routines || []).some(r => r.day === 2 && /mooc/i.test(r.title))) out.routines = (out.routines || []).concat([{ id: uid(), day: 2, start: 795, end: 840, title: 'MOOC de prog · 2e heure', kind: 'study', subj: prog.id }]);
      if (!Array.isArray(out.weekly)) out.weekly = [{ id: uid(), subj: prog.id, title: 'MOOC de prog · 1re heure', minutes: 60, before: 2 }];
    }
  }
  if ((old.v || 0) < 10) {
    // v9 → v10: the prog "exam" of 25 Nov is in fact Mini-projet 2, a group project from 25 Nov to 17 Dec
    const prog = (out.subjects || []).find(x => x.id === 'prog' || /programm/i.test(x.name));
    if (prog && prog.exam === '2026-11-25' && !(out.projects || []).length) {
      prog.exam = '';
      out.projects = [{ id: uid(), subj: prog.id, title: 'Mini-projet 2', from: '2026-11-25', to: '2026-12-17', hours: 20, group: true, sessions: [] }];
    }
  }
  out.modes = Object.assign({}, clone(MODE_DEFAULTS), out.modes || {});
  for (const k of MODE_ORDER) out.modes[k] = Object.assign({}, MODE_DEFAULTS[k], out.modes[k] || {});
  if (!MODE_ORDER.includes(out.mode)) out.mode = 'normal';
  out.notif = Object.assign({}, d.notif, out.notif || {});
  out.done = out.done || {};
  ['subjects', 'courses', 'routines', 'events', 'offDays', 'trips', 'mocks', 'noCourseWeeks', 'backlog', 'cancel', 'weekly', 'projects'].forEach(k => { if (!Array.isArray(out[k])) out[k] = d[k]; });
  if (!out.weekModes || typeof out.weekModes !== 'object') out.weekModes = {};
  if (!out.frozen || typeof out.frozen !== 'object') out.frozen = {};
  if (!out.autoModes || typeof out.autoModes !== 'object') out.autoModes = {};
  if (!out.rolled || typeof out.rolled !== 'object') out.rolled = {};
  out.subjects.forEach(x => { if (x.serie == null) x.serie = 120; if (x.corr == null) x.corr = x.serie ? 30 : 0; });
  out.v = 10;
  return out;
}

/* trips: {id, title, from, to, light} — first and last day are travel days, days in between are light */
function tripOn(S, dIso) {
  for (const t of S.trips || []) if (t.from && t.to && dIso >= t.from && dIso <= t.to) return { trip: t, edge: dIso === t.from || dIso === t.to };
  return null;
}
function tripDaysIn(S, weekStart) { let n = 0; for (let d = 0; d < 7; d++) if (tripOn(S, iso(addDays(weekStart, d)))) n++; return n; }
function coursesOnFor(S, weekStart) { return !(S.noCourseWeeks || []).includes(iso(weekStart)) && tripDaysIn(S, weekStart) < 3; }
const examsWithin = (S, from, days) => S.subjects.filter(su => su.exam && (fromIso(su.exam) - from) / 864e5 >= 0 && (fromIso(su.exam) - from) / 864e5 < days);

/* What the app would pick by itself for a week, with the reason. Order matters: exams first, then trips, then backlog. */
function recommendMode(S, weekStart) {
  const end = addDays(weekStart, 7);
  const soon = examsWithin(S, weekStart, 21);
  if (soon.length) return { mode: 'exam', why: 'Examen : ' + soon[0].name + ', le ' + dateLbl(fromIso(soon[0].exam)) };
  for (const t of S.trips || []) {
    if (!t.from || !t.to) continue;
    const from = fromIso(t.from), to = fromIso(t.to);
    if (to < weekStart && (weekStart - to) / 864e5 < 10 && examsWithin(S, weekStart, 56).length) return { mode: 'exam', why: 'Retour de voyage' + (t.title ? ' (' + t.title + ')' : '') + ', les examens arrivent' };
  }
  for (const t of S.trips || []) {
    if (!t.from || !t.to) continue;
    const from = fromIso(t.from);
    if (from >= weekStart && from < end) return { mode: 'avance', why: 'Départ' + (t.title ? ' (' + t.title + ')' : '') + ' le ' + dateLbl(from) };
    if (from >= end && (from - weekStart) / 864e5 < 21) return { mode: 'avance', why: 'Départ' + (t.title ? ' (' + t.title + ')' : '') + ' dans ' + Math.round((from - weekStart) / 864e5) + ' jours' };
  }
  if (!coursesOnFor(S, weekStart) && tripDaysIn(S, weekStart) < 3 && examsWithin(S, weekStart, 42).length) return { mode: 'exam', why: 'Semaine sans cours avant les examens' };
  const late = backlogTotal(S);
  if (late >= 180) return { mode: 'rattrapage', why: hm(late) + ' de retard à rattraper' };
  return null;
}
/* Mode of a week: your choice for that week > a switch the app made during the week > automatic pick > your usual mode */
function weekCfg(S, weekStart) {
  const key = iso(weekStart);
  const tripDays = tripDaysIn(S, weekStart);
  const coursesOn = coursesOnFor(S, weekStart);
  const manual = (S.weekModes || {})[key], live = (S.autoModes || {})[key];
  let mode = S.mode, source = 'base', why = '';
  if (MODE_ORDER.includes(manual)) { mode = manual; source = 'manual'; }
  else if (live && MODE_ORDER.includes(live.mode)) { mode = live.mode; source = 'auto'; why = live.why || ''; }
  else if (S.autoMode !== false) { const r = recommendMode(S, weekStart); if (r) { mode = r.mode; source = 'auto'; why = r.why; } }
  return { key, mode, coursesOn, tripDays, source, why, chosen: source === 'manual' };
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
    return { d, date, dIso, we, off: !light, trip: tr.trip, tripEdge: tr.edge, wake, sleep, wind: sleep - 30, eveStart: sleep - 30, ev: [{ kind: 'stretch', start: wake, end: wake + 5, title: 'Stretching · 5 min', sub: STRETCH[d].name }], courses: [], firstC: null, goHome: null, gaps, extGaps: [], chunk, cap: light };
  }
  const off = (S.offDays || []).includes(dIso);
  const dayMocks = (S.mocks || []).filter(x => x.date === dIso && x.end > x.start);
  const canc = (S.cancel || []).filter(x => x.date === dIso);
  let courses = S.coursesOn ? S.courses.filter(c => c.day === d && c.end > c.start && !canc.some(x => x.subj === c.subj && (!x.type || x.type === c.type))).map(c => Object.assign({}, c)) : [];
  // a mock exam or one of your events during a course takes the place of that part of the course
  const dayEvents = (S.events || []).filter(x => x.date === dIso && x.end > x.start);
  for (const mk of dayMocks.concat(dayEvents)) {
    courses = courses.flatMap(c => {
      if (mk.end <= c.start || mk.start >= c.end) return [c];
      const parts = [];
      if (mk.start - c.start >= 15) parts.push(Object.assign({}, c, { end: mk.start }));
      if (c.end - mk.end >= 15) parts.push(Object.assign({}, c, { id: c.id + '-b', start: mk.end, afterMock: dayMocks.includes(mk) }));
      return parts;
    });
  }
  courses.sort((a, b) => a.start - b.start);
  const firstC = courses.length ? courses[0].start : null;
  const lastC = courses.length ? Math.max(...courses.map(c => c.end)) : null;
  const wake = firstC != null ? Math.min(we ? S.wakeWE : S.wake, firstC - 30 - COMMUTE - 15) : (we ? S.wakeWE : S.wake);
  let sleep = d === 5 ? S.sleepSat : S.sleep; if (sleep < 240) sleep += 1440; if (sleep > 1440) sleep = 1440;
  const ev = [];
  const busy = () => ev.filter(e => e.end > e.start);
  const free = (s, e) => busy().every(b => b.end <= s || b.start >= e);
  ev.push({ kind: 'stretch', start: wake, end: wake + 5, title: 'Stretching · 5 min', sub: STRETCH[d].name });
  courses.forEach(c => { const su = subjOf(S, c.subj); ev.push({ kind: 'course', start: c.start, end: c.end, title: su ? su.name : 'Cours', sub: [c.type + (c.afterMock ? ' (après l’examen blanc)' : ''), c.room].filter(Boolean).join(' · '), subj: c.subj, ctype: c.type, cid: c.id, room: c.room || '' }); });
  (S.events || []).filter(x => x.date === dIso && x.end > x.start).forEach(x => ev.push({ kind: 'event', start: x.start, end: x.end, title: x.title || 'Événement', sub: x.place || '', eid: x.id }));
  S.subjects.filter(su => su.exam === dIso).forEach(su => ev.push({ kind: 'event', start: wake + 30, end: wake + 30, title: 'Examen · ' + su.name, sub: 'bonne chance !', subj: su.id, exam: true }));
  dayMocks.forEach(x => { const su = subjOf(S, x.subj); ev.push({ kind: 'event', start: x.start, end: x.end, title: 'Examen blanc · ' + (su ? su.name : ''), sub: x.place || 'facultatif, mais on veut être prêt', subj: x.subj, mock: true }); });
  // project sessions with your partner (one date, or every week until the due date)
  for (const p of S.projects || []) for (const ss of p.sessions || []) {
    if (!ss.date || !(ss.end > ss.start)) continue;
    const on = ss.date === dIso || (ss.weekly && dIso > ss.date && dIso <= p.to && dow(fromIso(ss.date)) === d);
    if (on && free(ss.start, ss.end)) ev.push({ kind: 'fixed', start: ss.start, end: ss.end, title: p.title + ' · en binôme', subj: p.subj, fsub: (subjOf(S, p.subj) || {}).name + (ss.place ? ' · ' + ss.place : ' · avec ton binôme'), pid: p.id });
  }
  // sport and chores happen at home: never while you are on campus or on the way
  const leaveAt = courses.length ? firstC - COMMUTE - 5 : null;
  const homeAt = courses.length ? (S.mode === 'charbon' ? Math.max(lastC, 1110) : lastC) + COMMUTE : null;
  (S.routines || []).filter(r => r.day === d && r.end > r.start).forEach(r0 => {
    let r = r0;
    if (r.kind !== 'study' && courses.length && r.start < homeAt && r.end > leaveAt) {
      const len = r.end - r.start, lim = sleep - 30;
      let t = homeAt + 5; while (t + len <= lim && !free(t, t + len)) t += 15;
      if (t + len > lim) return;
      r = Object.assign({}, r0, { start: t, end: t + len, moved: true });
    }
    if (!free(r.start, r.end)) return;
    if (r.kind === 'study') { if (!S.coursesOn || !subjOf(S, r.subj)) return; ev.push({ kind: 'fixed', start: r.start, end: r.end, title: r.title, subj: r.subj, rid: r.id }); }
    else ev.push({ kind: r.kind === 'sport' ? 'sport' : 'routine', start: r.start, end: r.end, title: r.title, rid: r.id, sub: r.moved ? 'à la maison, après les cours' : undefined, movable: true });
  });
  { // breakfast right after stretching, shortened if something starts early
    const nextBusy = Math.min(wake + 35, ...busy().filter(b => b.start >= wake + 5).map(b => b.start));
    if (nextBusy - (wake + 5) >= 15) ev.push({ kind: 'meal', start: wake + 5, end: nextBusy, title: 'Petit-déj' });
  }
  let goHome = null;
  if (courses.length) {
    if (free(firstC - COMMUTE - 5, firstC - 5)) ev.push({ kind: 'move', start: firstC - COMMUTE - 5, end: firstC - 5, title: 'Maison → EPFL' });
    let ret = S.mode === 'charbon' ? Math.max(lastC, 1110) : lastC;
    for (let k = 0; k < 40 && !free(ret, ret + COMMUTE); k++) ret += 15;
    goHome = ret;
    if (free(ret, ret + COMMUTE)) ev.push({ kind: 'move', start: ret, end: ret + COMMUTE, title: 'EPFL → maison' });
  }
  for (const s of [720, 735, 705, 750, 780, 795, 690]) if (free(s, s + 45)) { ev.push({ kind: 'meal', start: s, end: s + 45, title: courses.some(c => c.start < s + 120 && c.end > s - 60) ? 'Midi à l’EPFL' : 'Midi' }); break; }
  const wind = sleep - 30;
  ev.push({ kind: 'rest', start: wind, end: sleep, title: 'Écrans off, routine du soir' });
  for (const s of [1140, 1155, 1170, 1185, 1200, 1110, 1095]) if (s + 45 <= wind && free(s, s + 45)) { ev.push({ kind: 'meal', start: s, end: s + 45, title: 'Souper' }); break; }
  const eveStart = Math.max(wake + 35, wind - m.freeEve);
  // catch-up window: the first part of the free evening, never below MIN_FREE_EVE of real free time
  const extEnd = Math.min(eveStart + (+m.ext || 0), wind - MIN_FREE_EVE);
  const gapsIn = (lo, hi) => {
    const out = []; let t = lo;
    for (const b of busy().filter(b => b.end > lo && b.start < hi).sort((a, b) => a.start - b.start)) { if (b.start > t) out.push({ s: t, e: b.start }); t = Math.max(t, b.end); }
    if (hi > t) out.push({ s: t, e: hi });
    return out;
  };
  const gaps = off ? [] : gapsIn(wake + 35, eveStart);
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
  for (const v of Object.values(S.done[key] || {})) if (v && typeof v === 'object' && v.m && !v.fx && !v.b) { out[v.s || '_'] = (out[v.s || '_'] || 0) + v.m; total += v.m; }
  return { by: out, total };
}
/* Séries from last week that were never finished. Only counts if the app was used that week. */
/* The correction of a série comes out 2 days after that subject's exercise session.
 * Returns the day it can be checked, or null when the subject has no session that week. */
function corrAvail(S, weekStart, su) {
  if (!coursesOnFor(S, weekStart)) return null;
  const ex = S.courses.filter(c => c.subj === su.id && /exerc/i.test(c.type || ''));
  if (!ex.length) return null;
  const last = Math.max(...ex.map(c => c.day));
  const planned = addDays(weekStart, last + 2);
  // the correction was spotted on Moodle earlier than the usual 2 days
  const seen = ((S.corrSeen || {})[iso(weekStart)] || {})[su.id];
  if (seen) { const d = fromIso(seen); if (d < planned) return d < weekStart ? weekStart : d; }
  return planned;
}
const corrDeferred = (S, weekStart, su) => { const a = corrAvail(S, weekStart, su); return !!a && a >= addDays(weekStart, 7); };

/* Backlog ("Retard"): items you add, plus unfinished séries added automatically at the end of each week.
 * An item stays until you tick it; the minutes of blocks done for it count as progress. */
function backlogCredit(S, id) {
  let m = 0;
  for (const wk of Object.values(S.done || {})) for (const v of Object.values(wk || {})) if (v && typeof v === 'object' && v.b === id) m += v.m || 0;
  return m;
}
function backlogScore(S, x, now) {
  now = now || new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let score = 0; const why = [];
  if (x.urgent) { score += 100; why.push('urgent'); }
  const su = subjOf(S, x.subj);
  const mk = (S.mocks || []).filter(m => m.subj === x.subj && m.date && fromIso(m.date) >= today).map(m => (fromIso(m.date) - today) / 864e5).sort((a, b) => a - b)[0];
  if (mk != null && mk <= 14) { score += mk <= 7 ? 60 : 30; why.push('examen blanc dans ' + Math.round(mk) + ' j'); }
  if (su && su.exam) { const dd = (fromIso(su.exam) - today) / 864e5; if (dd >= 0 && dd <= 28) { score += dd <= 10 ? 70 : 35; why.push('examen dans ' + Math.round(dd) + ' j'); } }
  const t = (x.title || '').toLowerCase();
  if (/s[ée]rie/.test(t)) { score += 20; if (!why.length) why.push('série à rendre propre'); }
  else if (/cours|relire|chapitre/.test(t)) { score += 12; if (!why.length) why.push('cours à rattraper'); }
  if (su) score += (PRIO_W[su.prio] || 1) * 5;
  const age = x.created ? (now - x.created) / 864e5 : 0;
  score += Math.min(30, age * 2);
  if (age >= 7 && why.length < 2) why.push('en retard depuis ' + Math.round(age) + ' j');
  // older séries come first: série 6 before série 7
  const n = /s[ée]rie\s*(\d+)/i.exec(x.title || ''); if (n) score += Math.max(0, 15 - +n[1]) * 0.5;
  return { score, why: why.slice(0, 2).join(' · ') };
}
function backlogOpen(S) {
  const now = new Date();
  const list = (S.backlog || []).filter(x => !x.done).map(x => { const c = backlogCredit(S, x.id), p = backlogScore(S, x, now); return Object.assign({}, x, { credit: c, left: Math.max(0, (+x.minutes || 0) - c), score: p.score, why: p.why }); });
  if (S.blOrder === 'manual') return list.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || (a.created || 0) - (b.created || 0));
  return list.sort((a, b) => b.score - a.score || (a.created || 0) - (b.created || 0));
}
const backlogTotal = S => backlogOpen(S).reduce((a, x) => a + x.left, 0);

function carryOver(S, weekStart) {
  // replaced by the backlog: unfinished séries become backlog items at the end of the week
  if (S.backlog) return {};
  const prevKey = iso(addDays(weekStart, -7));
  if (!S.done[prevKey] || !coursesOnFor(S, addDays(weekStart, -7))) return {};
  const done = doneBySubject(S, prevKey).by, out = {};
  const pws = addDays(weekStart, -7);
  for (const su of S.subjects) { const left = (su.serie || 0) + (su.serie && !corrDeferred(S, pws, su) ? (su.corr || 0) : 0) - (done[su.id] || 0); if (left >= 20) out[su.id] = Math.round(left); }
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
  const must = {}, corr = {}, corrFrom = {}, corrPrev = {}; let mustTotal = 0;
  const prevWs = addDays(weekStart, -7), prevCfg = { coursesOn: coursesOnFor(S0, prevWs) };
  for (const su of S.subjects) {
    // this week's correction only if it comes out before Sunday night; otherwise it moves to next week,
    // and last week's late correction is checked this week
    const deferred = corrDeferred(S0, weekStart, su);
    const fromPrev = prevCfg.coursesOn && su.serie && corrDeferred(S0, prevWs, su) ? (+su.corr || 0) : 0;
    corrPrev[su.id] = !!fromPrev;
    const c = (S.coursesOn && su.serie && !deferred ? (+su.corr || 0) : 0) + fromPrev;
    const av = corrAvail(S0, weekStart, su);
    corrFrom[su.id] = fromPrev && !(S.coursesOn && su.serie && !deferred) ? null : (av && !deferred ? av : null);
    const sDone = !!((S.serieDone || {})[key] || {})[su.id];
    const v = (S.coursesOn && !sDone ? (+su.serie || 0) : 0) + c + (carry[su.id] || 0);
    corr[su.id] = c;
    if (v > 0) { must[su.id] = v; mustTotal += v; }
  }
  // projects: this week's share of the hours still to do (partner sessions count), on top of the usual target
  const projNeed = p => {
    if (!p.from || !p.to || !(p.hours > 0)) return null;
    const pf = fromIso(p.from), pt = fromIso(p.to), we = addDays(weekStart, 7);
    if (pt < weekStart || pf >= we || (p.subj && !subjOf(S, p.subj))) return null;
    let prev = 0, soloNow = 0;
    for (const [wk, recs] of Object.entries(S.done || {})) for (const v of Object.values(recs || {})) {
      if (!v || typeof v !== 'object' || !String(v.t || '').startsWith(p.title)) continue;
      if (wk < key) prev += v.m || 0; else if (wk === key && v.t === p.title) soloNow += v.m || 0;
    }
    const weeksLeft = Math.max(1, Math.round((mondayOf(pt) - weekStart) / (7 * 864e5)) + 1);
    let meet = 0; for (const x of days) for (const e of x.ev) if (e.pid === p.id) meet += e.end - e.start;
    const solo = Math.max(0, Math.round(Math.max(0, p.hours * 60 - prev) / weeksLeft - meet));
    return { pf, pt, we, solo, left: Math.max(0, solo - soloNow) };
  };
  const projExtra = S.mode === 'recup' ? 0 : Math.min(600, (S.projects || []).reduce((a, p) => { const n = projNeed(p); return a + (n ? n.solo : 0); }, 0));
  let T = S.mode === 'recup' ? Math.min(+m.week, mustTotal || +m.week) : Math.max(+m.week, mustTotal ? Math.ceil((mustTotal * 1.1 + 30) / 15) * 15 : 0);
  T += projExtra;

  // trip days only get their light study; the rest of the target shrinks with them
  const tripDays = days.filter(x => x.trip);
  if (tripDays.length) {
    const homeW = days.filter(x => !x.trip).reduce((a, x) => a + (x.d === 5 ? +m.sat : x.d === 6 ? +m.sun : 1), 0);
    const fullW = 5 + (+m.sat) + (+m.sun);
    T = Math.max(mustTotal, Math.round(T * homeW / (fullW || 1))) + tripDays.reduce((a, x) => a + x.cap, 0);
  }
  // spread T over the days: proportional to free time × weekend share, capped by each day's room
  const examDay = x => S.subjects.some(su => su.exam === x.dIso);
  const w = days.map(x => x.off || x.trip ? 0 : (x.d === 5 ? +m.sat : x.d === 6 ? +m.sun : 1) * (examDay(x) ? 0.35 : 1));
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

  // the part of the week already lived keeps the plan it had (a mode change, a day off or a new event
  // only reshapes what's still ahead)
  const fz = (S.frozen || {})[key];
  let frozen = [];
  if (fz && fz.until && Array.isArray(fz.items)) {
    frozen = fz.items.filter(it => days[it.d]).map(it => { const x = days[it.d]; return { d: it.d, date: x.date, start: it.start, end: it.end, len: it.end - it.start, startT: x.date.getTime() + it.start * 6e4, endT: x.date.getTime() + it.end * 6e4, title: it.title, subj: it.subj, serie: !!it.serie, late: !!it.late, catchup: !!it.catchup, campus: !!it.campus, frozen: true }; });
    const cut = Math.max(fz.until, ...frozen.map(f => f.endT));
    for (let i = slots.length - 1; i >= 0; i--) if (slots[i].startT < cut) slots.splice(i, 1);
  }

  // revision budget by subject
  const revPool = Math.max(0, T - mustTotal);
  const ws = S.subjects.map(su => examWeight(S, su, addDays(weekStart, 3)));
  const wsum = ws.reduce((a, b) => a + b, 0) || 1;
  const rev = {}; S.subjects.forEach((su, i) => { rev[su.id] = revPool * ws[i] / wsum; });

  const labels = REV_LABELS[S.mode] || REV_LABELS.normal;
  const wkN = semWeek(S, weekStart);
  const serieLabel = (su, isCarry) => isCarry ? 'Série en retard' : (wkN ? 'Série ' + wkN : 'Série d’exercices');
  // why a revision block exists: an exam or a mock exam coming up beats the generic label
  const revReason = (subj, date) => {
    const mk = (S.mocks || []).find(x => x.subj === subj && x.date && fromIso(x.date) >= date && (fromIso(x.date) - date) / 864e5 <= 10);
    if (mk) return 'Révision pour l’examen blanc (' + DAYS[dow(fromIso(mk.date))].toLowerCase() + ' ' + fromIso(mk.date).getDate() + ')';
    const su = subjOf(S, subj);
    if (su && su.exam && fromIso(su.exam) >= date && (fromIso(su.exam) - date) / 864e5 <= 28) return 'Révision pour l’examen du ' + dateLbl(fromIso(su.exam));
    return null;
  };
  const prevCourse = (s) => days[s.d].courses.find(c => c.end <= s.start && c.end >= s.start - 60 && c.type === 'Cours');

  // assignment helper: fills slots in order from the given budgets (must first, then revision)
  function assignInto(list, mustLeft, carryLeft, revLeft, corrLeft, bl, prep) {
    const lastByDay = {}; const cnt = {};
    const suffix = []; { let acc = 0; for (let i = list.length - 1; i >= 0; i--) { suffix[i] = acc; acc += list[i].len; } }
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      let pick = null, kind = null;
      if (prep) {
        // weekly tasks with a deadline go first, in the first free blocks before their day
        const room = t => t.dayCap ? t.dayCap - (t.used[s.d] || 0) : Infinity;
        const tk = Object.keys(prep).find(k => prep[k].task && prep[k].left >= 15 && s.date < prep[k].date && (!prep[k].from || s.date >= prep[k].from) && room(prep[k]) >= 20);
        if (tk) {
          const t = prep[tk];
          const parts = Math.ceil(t.left / s.len); let len = Math.min(s.len, room(t), Math.max(20, Math.ceil(t.left / parts / 5) * 5));
          if (t.dayCap) t.used[s.d] = (t.used[s.d] || 0) + len;
          if (len < s.len) { s.end = s.start + len; s.endT = s.startT + len * 6e4; s.len = len; }
          s.title = t.title; s.subj = t.subj; s.task = true; t.left -= s.len;
          if (t.subj) { revLeft[t.subj] = Math.max(0, (revLeft[t.subj] || 0) - s.len); lastByDay[s.d] = t.subj; }
          continue;
        }
        const pk = Object.keys(prep).find(k => !prep[k].task && prep[k].left >= 15 && s.date < prep[k].date && (prep[k].date - s.date) / 864e5 <= 2 && lastByDay[s.d] !== k);
        if (pk) {
          const md = prep[pk].date;
          s.title = 'Révision pour l’examen blanc (' + DAYS[dow(md)].toLowerCase() + ' ' + md.getDate() + ')'; s.subj = pk;
          prep[pk].left -= s.len; revLeft[pk] = Math.max(0, (revLeft[pk] || 0) - s.len); lastByDay[s.d] = pk;
          continue;
        }
      }
      if (bl && bl.items.some(x => x.left >= 15)) {
        const mustSum = Object.values(mustLeft).reduce((a, b) => a + Math.max(0, b), 0);
        const used = bl.dayUsed[s.d] || 0;
        const corrNow = Object.keys(mustLeft).some(k => mustLeft[k] - (corrLeft[k] || 0) < 15 && (corrLeft[k] || 0) >= 15 && (!corrFrom[k] || s.date >= corrFrom[k]));
        if (!corrNow && used + 15 <= bl.cap && suffix[i] >= (mustSum ? mustSum * 1.1 + 30 : 0)) {
          const it = bl.items.find(x => x.left >= 15);
          const len = Math.min(s.len, Math.max(20, Math.min(it.left, bl.cap - used)));
          if (len < s.len) { s.end = s.start + len; s.endT = s.startT + len * 6e4; s.len = len; }
          const su = subjOf(S, it.subj);
          s.title = 'Retard · ' + it.title; s.subj = su ? it.subj : null; s.bl = it.id; s.late = true;
          it.left -= s.len; bl.dayUsed[s.d] = used + s.len;
          if (su) lastByDay[s.d] = it.subj;
          continue;
        }
      }
      // a subject's correction check only comes once its série is fully placed
      const serieLeft = k => mustLeft[k] - (corrLeft[k] || 0);
      const mk = Object.keys(mustLeft).filter(k => mustLeft[k] >= 15 && subjOf(S, k));
      const ck = mk.filter(k => serieLeft(k) < 15 && (corrLeft[k] || 0) >= 15 && (!corrFrom[k] || s.date >= corrFrom[k]));
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
      // (backlog items without a subject are handled above; nothing else to do here)
      const su = subjOf(S, pick);
      if (kind === 'corr') {
        const need = Math.max(20, Math.min(s.len, corrLeft[pick]));
        if (need < s.len) { s.end = s.start + need; s.endT = s.startT + need * 6e4; s.len = need; }
        s.title = 'Vérifier la série ' + (corrFrom[pick] === null && corrPrev[pick] && wkN ? (wkN - 1) + ' ' : wkN ? wkN + ' ' : '') + 'avec la correction'; s.serie = true; s.corr = true;
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
        s.title = revReason(pick, s.date) || (pc && pc.subj === pick && S.mode !== 'exam' ? 'Reprendre le cours de ' + (pc.start < 720 ? 'ce matin' : 'cet après-midi') + ' à chaud' : labels[(k - 1) % labels.length]);
        revLeft[pick] -= s.len;
      }
      s.subj = pick; lastByDay[s.d] = pick;
    }
  }

  // 1. reference plan for the whole week (what each block "was meant" to be)
  const base = slots.map(s => Object.assign({}, s));
  const blOpen = backlogOpen(S);
  const blCap = +m.bl || 0;
  const mkBl = () => ({ cap: blCap, dayUsed: {}, items: blOpen.map(x => ({ id: x.id, title: x.title, subj: x.subj, left: x.left })) });
  const mkPrep = () => {
    const out = {};
    for (const mk of S.mocks || []) {
      if (!mk.date || !subjOf(S, mk.subj)) continue;
      const md = fromIso(mk.date);
      if (md < weekStart || md >= addDays(weekStart, 7)) continue;
      const done = Object.values(doneMapAll).filter(v => v && v.s === mk.subj && /examen blanc/.test(v.t || '')).reduce((a, v) => a + (v.m || 0), 0);
      out[mk.subj] = { date: md, left: Math.max(0, 100 - done) };
    }
    for (const t of S.weekly || []) {
      if (!t.minutes || t.before == null) continue;
      if (t.subj && !subjOf(S, t.subj)) continue;
      if (t.subj && !coursesOnFor(S, weekStart)) continue;
      const done = Object.values(doneMapAll).filter(v => v && v.t === t.title).reduce((a, v) => a + (v.m || 0), 0);
      out['task:' + t.id] = { task: true, title: t.title, subj: t.subj || null, date: addDays(weekStart, +t.before), left: Math.max(0, +t.minutes - done) };
    }
    // a project never takes the time the week's séries need
    const roomForProjects = Math.max(0, slots.reduce((a, x) => a + x.len, 0) - mustTotal * 1.15 - 30);
    for (const p of S.projects || []) {
      const n = projNeed(p); if (!n) continue;
      out['proj:' + p.id] = { task: true, title: p.title, subj: p.subj || null, from: n.pf, date: new Date(Math.min(addDays(n.pt, 1).getTime(), n.we.getTime())), left: Math.min(n.left, roomForProjects), dayCap: 90, used: {} };
    }
    return Object.keys(out).length ? out : null;
  };
  const doneMapAll = S.done[key] || {};
  assignInto(base, clone(must), clone(carry), clone(rev), clone(corr), blOpen.length && blCap ? mkBl() : null, mkPrep());

  // 2. live plan: done work comes off the budgets, unfinished work moves to the blocks still ahead
  const doneMap = S.done[key] || {};
  const { by: doneBy } = doneBySubject(S, key);
  const mustLeft = {}, carryLeft = {}, revLeft = {}, corrLeft = {};
  const serieMin = {}; for (const v of Object.values(doneMap)) if (v && typeof v === 'object' && v.serie && !v.c && !v.b && v.s) serieMin[v.s] = (serieMin[v.s] || 0) + (v.m || 0);
  for (const su of S.subjects) {
    const dn = (doneBy[su.id] || 0) - (((S.serieDone || {})[key] || {})[su.id] ? (serieMin[su.id] || 0) : 0);
    const mu = must[su.id] || 0;
    mustLeft[su.id] = Math.max(0, mu - dn);
    corrLeft[su.id] = Math.min(corr[su.id] || 0, mustLeft[su.id]);
    carryLeft[su.id] = Math.max(0, (carry[su.id] || 0) - dn);
    revLeft[su.id] = Math.max(0, (rev[su.id] || 0) - Math.max(0, dn - mu));
  }
  const idOf = (d, s) => d + '-' + s.start + '-study';
  const future = [], live = [];
  let lateMin = 0;
  for (const x of days) for (const e of x.ev) {
    if (e.kind !== 'fixed') continue;
    const id = idOf(x.d, e), rec = doneMap[id], len = e.end - e.start;
    const startT = x.date.getTime() + e.start * 6e4, endT = x.date.getTime() + e.end * 6e4;
    e.kind = 'study'; e.id = id; e.fixed = true; e.len = len;
    const su = subjOf(S, e.subj); e.sub = e.fsub || (su ? su.name : '') + ' · tous les ' + DAYS[x.d].toLowerCase() + 's';
    if (rec && typeof rec === 'object') e.state = 'done';
    else if (endT <= nowT) { e.state = endT <= sinceT ? 'pre' : 'missed'; }
    else e.state = 'todo';
    revLeft[e.subj] = Math.max(0, (revLeft[e.subj] || 0) - len);
  }
  for (const f of frozen) {
    const id = idOf(f.d, f), rec = doneMap[id];
    if (rec && typeof rec === 'object') live.push(Object.assign({}, f, { id, title: rec.t || f.title, subj: rec.s, state: 'done', part: rec.p }));
    else if (f.endT <= nowT) { const pre = f.endT <= sinceT; if (!pre) lateMin += f.len; live.push(Object.assign({}, f, { id, state: pre ? 'pre' : 'missed' })); }
    else {
      // block in progress at the moment of the change: keeps its task, which comes off the budgets
      live.push(Object.assign({}, f, { id, state: 'todo' }));
      if (f.subj && f.serie) { mustLeft[f.subj] = Math.max(0, (mustLeft[f.subj] || 0) - f.len); }
      else if (f.subj) revLeft[f.subj] = Math.max(0, (revLeft[f.subj] || 0) - f.len);
    }
  }
  slots.forEach((s, i) => {
    const id = idOf(s.d, s), rec = doneMap[id];
    const b = base[i];
    if (rec && typeof rec === 'object') live.push(Object.assign({}, s, { id, title: rec.t || b.title, subj: rec.s, state: 'done', serie: rec.serie, corr: !!rec.c, bl: rec.b, late: !!rec.b, part: rec.p }));
    else if (s.endT <= nowT) {
      const pre = s.endT <= sinceT;
      if (!pre) lateMin += s.len;
      live.push(Object.assign({}, b, { id, state: pre ? 'pre' : 'missed' }));
    } else { const f = Object.assign({}, s, { id, state: 'todo' }); future.push(f); live.push(f); }
  });
  // done blocks that aren't regular slots (catch-up blocks done earlier) keep showing where they were
  // (fixed blocks like the Monday physics prep are already in the day: never show them twice)
  const slotIds = new Set(slots.concat(frozen).map(s => idOf(s.d, s)));
  for (const x of days) for (const e of x.ev) if (e.fixed) slotIds.add(e.id);
  for (const [id, rec] of Object.entries(doneMap)) {
    if (slotIds.has(id) || !rec || typeof rec !== 'object' || rec.fx || rec.d == null || rec.a == null || !rec.m) continue;
    const x = days[rec.d]; if (!x) continue;
    const it = { d: rec.d, date: x.date, start: rec.a, end: rec.a + rec.m, len: rec.m, id, title: rec.t, subj: rec.s, state: 'done', bl: rec.b, late: !!rec.b };
    // a block done early whose slot later moved: its time is used, so a block still to do on top of it goes away
    for (let i = live.length - 1; i >= 0; i--) { const o = live[i]; if (o.d === it.d && o.state === 'todo' && o.start < it.end && o.end > it.start) { live.splice(i, 1); const fi = future.indexOf(o); if (fi >= 0) future.splice(fi, 1); } }
    live.push(it);
  }
  const unfinished = {}; for (const k of Object.keys(mustLeft)) if (mustLeft[k] >= 20) unfinished[k] = { left: Math.round(mustLeft[k]), corr: Math.round(corrLeft[k] || 0) };
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
  function extendBy(need, fromDay) {
    const added = [];
    for (const pass of ['ext', 'day']) for (const x of days) {
      if (need < 15) return added;
      if (x.d < (fromDay || 0)) continue;
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
  // in Récup, what doesn't fit simply waits (it goes to Retard at the end of the week)
  if (mustNeed > futureCap && S.mode !== 'recup') future.push(...extendBy(mustNeed - futureCap));
  future.sort((a, b) => a.startT - b.startT);
  const blLive = blOpen.length && blCap ? mkBl() : null;
  assignInto(future, mustLeft, carryLeft, revLeft, corrLeft, blLive, mkPrep());
  const leftNow = () => Object.values(mustLeft).reduce((a, b) => a + (b >= 25 ? b : 0), 0);
  for (let k = 0; k < 2 && leftNow() >= 25 && S.mode !== 'recup'; k++) {
    // if only corrections are left, extra time only helps on/after the day they come out
    const leftK = Object.keys(mustLeft).filter(k => mustLeft[k] >= 25);
    const onlyCorr = leftK.every(k => mustLeft[k] - (corrLeft[k] || 0) < 15 && corrFrom[k]);
    const fromDay = onlyCorr && leftK.length ? Math.min(...leftK.map(k => Math.round((corrFrom[k] - weekStart) / 864e5))) : 0;
    const more = extendBy(leftNow() + 20, fromDay).sort((a, b) => a.startT - b.startT);
    if (!more.length) break;
    assignInto(more, mustLeft, carryLeft, {}, corrLeft);
  }
  const mustLeftAfter = leftNow();
  let blPlaced = 0;
  if (blLive) {
    const leftBl = () => blLive.items.reduce((a, x) => a + (x.left >= 15 ? x.left : 0), 0);
    if (leftBl() >= 30) {
      const room = days.filter(x => x.date.getTime() + 864e5 > nowT).reduce((a, x) => a + Math.max(0, blCap - (blLive.dayUsed[x.d] || 0)), 0);
      const more = extendBy(Math.min(leftBl(), room)).sort((a, b) => a.startT - b.startT);
      assignInto(more, Object.fromEntries(Object.keys(mustLeft).map(k => [k, 0])), {}, {}, {}, blLive);
      for (const f of more) if (!f.bl) { const i = live.indexOf(f); if (i >= 0) live.splice(i, 1); extended -= f.len; }
    }
    blPlaced = live.filter(x => x.bl && x.state === 'todo').reduce((a, x) => a + x.len, 0);
  }

  for (const s of live) {
    const x = days[s.d];
    // a block shortened during planning may already be over
    if (s.state === 'todo' && x.date.getTime() + s.end * 6e4 <= nowT) s.state = x.date.getTime() + s.end * 6e4 <= sinceT ? 'pre' : 'missed';
    if (s.kind2 === 'ahead') { x.ev.push({ kind: 'free', start: s.start, end: s.end, title: 'Libre', sub: 'T’es en avance', id: s.id }); continue; }
    const su = s.subj ? subjOf(S, s.subj) : null;
    x.ev.push({ kind: 'study', start: s.start, end: s.end, title: s.title || 'Étude', sub: [su ? su.name : '', s.campus ? 'à l’EPFL' : '', s.catchup && !s.bl ? 'rattrapage' : ''].filter(Boolean).join(' · '), subj: s.subj, id: s.id, state: s.state, serie: !!s.serie, corr: !!s.corr, late: !!s.late, catchup: !!s.catchup && !s.bl, bl: s.bl || null, len: s.len, part: s.part });
  }
  // a marker after the last série block of each subject: the série should be finished by then
  if (S.coursesOn) for (const su of S.subjects) {
    if (!su.serie) continue;
    const ticked = !!((S.serieDone || {})[key] || {})[su.id];
    let last = null;
    for (const x of days) for (const e of x.ev) if (e.kind === 'study' && e.subj === su.id && e.serie && !e.corr && !e.bl && !/retard/i.test(e.title)) { const t = x.date.getTime() + e.end * 6e4; if (!last || t > last.t) last = { t, x, end: e.end }; }
    if (!last) continue;
    last.x.ev.push({ kind: 'milestone', start: last.end, end: last.end, title: 'Finir la ' + (wkN ? 'série ' + wkN : 'série'), sub: su.name + (ticked ? ' · finie' : ' · coche quand la série est finie'), subj: su.id, id: 'ms-' + su.id, state: ticked ? 'done' : 'todo' });
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
    if (x.trip) fill(x.wake + 35, x.wind, { kind: 'free', title: (x.tripEdge ? 'Voyage · ' : '') + (x.trip.title || 'Voyage'), sub: x.tripEdge ? 'pas d’étude aujourd’hui' : (x.alloc ? 'profite, juste un peu de révision le matin' : 'profite') });
    else if (x.off) fill(x.wake + 35, x.wind, { kind: 'free', title: 'Jour off', sub: 'repos, rien à faire' });
    else {
      fill(x.eveStart, x.wind, FT);
      if (x.we && x.alloc > 0) fill(x.wake + 35, x.eveStart, { kind: 'free', title: 'Libre', sub: 'le reste est à toi' });
      if (x.we && x.alloc === 0) fill(x.wake + 35, x.eveStart, { kind: 'free', title: 'Journée off', sub: 'zéro cours, zéro série' });
    }
    // a routine (sport, chores) that lands on a block kept from earlier moves later the same evening
    const solidK = o => o.end > o.start && !['meal', 'move', 'rest', 'free'].includes(o.kind);
    for (const e of x.ev.filter(e => e.movable)) {
      const clash = t => x.ev.some(o => o !== e && !o.movable && solidK(o) && o.start < t + (e.end - e.start) && o.end > t);
      if (!clash(e.start)) continue;
      const len = e.end - e.start; let t = e.start;
      while (t + len <= x.wind && (clash(t) || x.ev.some(o => o !== e && o.movable && !o.drop && o.start < t + len && o.end > t))) t += 15;
      if (t + len <= x.wind) { e.start = t; e.end = t + len; } else e.drop = true;
    }
    x.ev = x.ev.filter(e => !e.drop);
    // free time gives way to a routine that moved onto it
    for (const e of x.ev.filter(e => e.movable)) {
      const out = [];
      for (const f of x.ev) {
        if (f.kind !== 'free' || f.start >= e.end || f.end <= e.start) { out.push(f); continue; }
        if (e.start - f.start >= 15) out.push(Object.assign({}, f, { end: e.start, id: undefined }));
        if (f.end - e.end >= 15) out.push(Object.assign({}, f, { start: e.end, id: undefined }));
      }
      x.ev = out;
    }
    // meals and trips are only markers: if a block kept from earlier sits on one, the marker gives way
    const solid = x.ev.filter(e => e.end > e.start && !['meal', 'move', 'rest', 'free'].includes(e.kind));
    x.ev = x.ev.filter(e => !['meal', 'move'].includes(e.kind) || !solid.some(o => o.start < e.end && o.end > e.start));
    x.ev.sort((a, b) => a.start - b.start || (a.kind === 'milestone') - (b.kind === 'milestone'));
    x.ev.forEach(e => { if (!e.id) e.id = x.d + '-' + e.start + '-' + e.kind + (e.eid ? '-' + e.eid : ''); });
    x.plan = x.ev.filter(e => e.kind === 'study').reduce((a, e) => a + e.end - e.start, 0);
    x.dn = x.ev.filter(e => e.kind === 'study' && e.state === 'done').reduce((a, e) => a + e.end - e.start, 0);
  }
  const blNext = {}; for (const x of live) if (x.bl && x.state === 'todo' && (!blNext[x.bl] || x.startT < blNext[x.bl])) blNext[x.bl] = x.startT;
  days.meta = { unfinished, blPlaced, blNext, blTotal: blOpen.reduce((a, x) => a + x.left, 0), cfg, T, mustTotal, mustAllDone: mustTotal > 0 && mustNeeded === 0, carry, lateMin, extended, unplaced, mustLeftAfter, sportMin: sportMinutes(S) };
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
        if (!N.stretch) parts.push('5 min de stretching (' + STRETCH[day.d].name.toLowerCase() + ')');
        if (day.off) parts.push('jour off, profite');
        if (nC) parts.push(nC + ' cours' + (first ? ', premier à ' + fmt(first.start) : ''));
        if (st) parts.push(hm(st) + ' d’étude');
        if (evs.some(e => e.kind === 'sport')) parts.push('sport');
        push(T(day.wake + (N.stretch ? 6 : 0)), 'Bonjour ! ' + DAYS[day.d] + ' ' + dateLbl(day.date), parts.length ? 'Aujourd’hui : ' + parts.join(', ') + '.' : 'Journée tranquille.', 'morning');
      }
      if (N.stretch) { const st = evs.find(e => e.kind === 'stretch'); if (st && st.state !== 'done') push(T(st.start), 'Stretching · 5 min', STRETCH[day.d].name + ' · touche pour lancer le minuteur', 'stretch-' + iso(day.date)); }
      for (const e of evs) {
        if (e.state === 'done') continue;
        if (e.kind === 'move' && N.move && /→ EPFL/.test(e.title)) {
          const c = evs.find(x => x.kind === 'course' && x.start >= e.end);
          push(T(e.start), 'Il est temps de partir', c ? c.title + ' à ' + fmt(c.start) + (c.sub ? ' · ' + c.sub : '') : 'Direction l’EPFL', 'mv' + e.id);
        }
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
    const nc = weekCfg(S, addDays(t, 7));
    push(sun.getTime(), 'Semaine prochaine : mode ' + MODE_META[nc.mode].name, (nc.source === 'auto' ? nc.why + '. ' : '') + 'Ouvre l’app si tu veux changer, ou si t’as pas cours.', 'week' + iso(t));
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

/* Snapshot of what was planned up to `now` for the current week — taken before any change */
function freezePast(S, now) {
  now = now || new Date();
  const ws = mondayOf(now), key = iso(ws);
  if (now.getTime() <= ws.getTime() + 60e3) return;
  const days = generate(S, ws, now);
  const items = [];
  for (const x of days) for (const e of x.ev) if (e.kind === 'study' && !e.fixed && x.date.getTime() + e.start * 6e4 < now.getTime())
    items.push({ d: x.d, start: e.start, end: e.end, title: e.title, subj: e.subj, serie: e.serie, late: e.late, catchup: e.catchup, campus: /EPFL/.test(e.sub || '') });
  S.frozen = { [key]: { until: now.getTime(), items } };
}


/* Moodle key from the "launch" trick: the browser ends on https://token=<base64 of "sig:::token:::private">.
 * Safari may lowercase that address, so each 4-letter group is re-cased until it decodes to what is expected. */
function moodleTokens(text) {
  let s = String(text || '');
  const i = s.lastIndexOf('token='); if (i < 0) return [];
  s = s.slice(i + 6); try { s = decodeURIComponent(s); } catch (e) { }
  s = s.replace(/[^A-Za-z0-9+/]/g, '');
  const B = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const dec = g => { const v = [...g].map(c => B.indexOf(c)); const n = (v[0] << 18) | (v[1] << 12) | ((v[2] || 0) << 6) | (v[3] || 0); return String.fromCharCode((n >> 16) & 255, (n >> 8) & 255, n & 255).slice(0, g.length - 1); };
  const ok = (ch, pos) => pos < 32 || (pos >= 35 && pos < 67) ? /[0-9a-f]/.test(ch) : pos < 35 || (pos >= 67 && pos < 70) ? ch === ':' : /[0-9A-Za-z]/.test(ch);
  const groups = [];
  for (let g = 0; g * 4 < Math.min(s.length, 96); g++) {
    const raw = s.slice(g * 4, g * 4 + 4), letters = [...raw].map((c, k) => /[a-z]/i.test(c) ? k : -1).filter(k => k >= 0), cands = new Set();
    for (let m = 0; m < 1 << letters.length; m++) {
      const v = [...raw]; letters.forEach((k, b) => { v[k] = m >> b & 1 ? v[k].toUpperCase() : v[k].toLowerCase(); });
      const d = dec(v.join('')); if ([...d].every((ch, j) => ok(ch, g * 3 + j))) cands.add(d);
    }
    groups.push([...cands]);
  }
  let outs = [''];
  for (const g of groups.slice(0, 23)) { const next = []; for (const o of outs) for (const c of g) next.push(o + c); outs = next.slice(0, 16); if (!outs.length) return []; }
  return [...new Set(outs.map(o => o.slice(35, 67)).filter(t => /^[0-9a-f]{32}$/.test(t)))].slice(0, 8);
}


/* ---------- reading a Moodle announcement: what it is about and when ---------- */
const MONTHS_RE = [['janvier','janv','january','jan'],['fevrier','fevr','fev','february','feb'],['mars','march','mar'],['avril','avr','april','apr'],['mai','may'],['juin','june','jun'],['juillet','juil','july','jul'],['aout','august','aug'],['septembre','sept','sep','september'],['octobre','oct','october'],['novembre','nov','november'],['decembre','dec','december']];
const WD_RE = [['dimanche','sunday','sun'],['lundi','monday','mon'],['mardi','tuesday','tue','tues'],['mercredi','wednesday','wed'],['jeudi','thursday','thu','thur','thurs'],['vendredi','friday','fri'],['samedi','saturday','sat']];
const plain = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`]/g, "'");
function monthOf(w) { w = w.replace(/\.$/, ''); for (let i = 0; i < 12; i++) if (MONTHS_RE[i].includes(w)) return i; return -1; }
function parseAnnounce(title, text, ref) {
  const t = plain(title + ' . ' + text), r = new Date(ref || Date.now());
  let kind = null, type = '';
  if (/(examen blanc|exam(en)? blanc|mock|midterm|mi-semestre|test blanc|practice exam|partiel)/.test(t)) kind = 'mock';
  else if (/(pas de cours|cours (est |sera )?annule|no (lecture|class|course)|lecture (is )?cancel|cancelled|annule|pas de seance|no exercise session|pas d'exercices|no exercises|seance .{0,20}annulee)/.test(t)) {
    kind = 'cancel'; type = /(exerc|seance d'ex|exercise|ta session|tutorial)/.test(t) ? 'Exercices' : /(cours|lecture|class)/.test(t) ? 'Cours' : '';
  } else if (/(examen final|final exam|exam(en)? (de |du |of )?(session|janvier|january|fevrier|february)|date de l'examen|exam date)/.test(t)) kind = 'exam';
  if (!kind) return null;
  // talking about an exam that already happened (results, statistics, grades, solutions, copy review): nothing to plan
  const past = /(resultat|results?\b|statisti|stats\b|grades?\b|notes? (de|du|sont|are)|moyenne|average|median|distribution|corrig|solution|consultation des copies|copy review|review session|feedback|a eu lieu|took place|thank(s| you) for (taking|participating)|merci (d'avoir|pour votre participation)|how (did|was) the|retour sur|bilan)/.test(t);
  if (past && kind !== 'cancel') return null;
  const found = [];
  const fix = (y, mo, d) => { if (mo < 0 || mo > 11 || d < 1 || d > 31) return null; let yy = y || r.getFullYear(); let dt = new Date(yy, mo, d); if (!y && dt < addDays(r, -60)) dt = new Date(yy + 1, mo, d); if (dt.getMonth() !== mo) return null; return dt; };
  let m;
  const mw = MONTHS_RE.flat().sort((a, b) => b.length - a.length).join('|');
  const reA = new RegExp('(\\d{1,2})(?:er|st|nd|rd|th)?\\s+(?:of\\s+)?(' + mw + ')\\.?(?:\\s+(20\\d\\d))?(?![a-z])', 'g');
  while ((m = reA.exec(t))) { const d = fix(m[3] ? +m[3] : 0, monthOf(m[2]), +m[1]); if (d) found.push({ d, at: m.index }); }
  const reB = new RegExp('(?<![a-z])(' + mw + ')\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d\\d))?(?!\\d)', 'g');
  while ((m = reB.exec(t))) { const d = fix(m[3] ? +m[3] : 0, monthOf(m[1]), +m[2]); if (d) found.push({ d, at: m.index }); }
  const reC = /(?<![\d.:,])(\d{1,2})[./](\d{1,2})(?:[./](\d{2}|\d{4}))?(?![\d:h])/g;
  while ((m = reC.exec(t))) { const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : 0; const d = fix(y, +m[2] - 1, +m[1]); if (d) found.push({ d, at: m.index }); }
  if (!found.length && kind === 'cancel') {
    const rel = /(demain|tomorrow)/.exec(t); if (rel) found.push({ d: addDays(new Date(r.getFullYear(), r.getMonth(), r.getDate()), 1), at: rel.index });
    else { const wd = new RegExp('(?:ce |this |next |prochain )?(' + WD_RE.flat().join('|') + ')(?![a-z])').exec(t); if (wd) { const k = WD_RE.findIndex(x => x.includes(wd[1])); let d = new Date(r.getFullYear(), r.getMonth(), r.getDate()); let n = (k - d.getDay() + 7) % 7 || 7; if (/next|prochain/.test(wd[0]) && n < 7) n += 7 * (/(next|prochain)/.test(wd[0]) && n <= 2 ? 0 : 0); found.push({ d: addDays(d, n), at: wd.index }); } }
  }
  if (!found.length) return { kind, type, date: null };
  found.sort((a, b) => a.at - b.at);
  const first = found.find(f => f.d >= addDays(new Date(r.getFullYear(), r.getMonth(), r.getDate()), 0)) || found[0];
  // a time near the date: 8h15, 08:15, 8:15 am, de 8h à 10h, 8:15-10:00
  const near = t.slice(Math.max(0, first.at - 80), first.at + 140);
  const tm = /(\d{1,2})\s*(?:h|:)\s*(\d{2})?\s*(am|pm)?(?:\s*(?:-|–|a|to|jusqu'a|until)\s*(\d{1,2})\s*(?:h|:)?\s*(\d{2})?\s*(am|pm)?)?/.exec(near.replace(/(\d{1,2})[./](\d{1,2})[./]?(\d{2,4})?/g, ' '));
  let start = null, end = null;
  const mm = (h, mi, ap) => { h = +h; mi = +(mi || 0); if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0; return h >= 6 && h <= 22 && mi < 60 ? h * 60 + mi : null; };
  if (tm) { start = mm(tm[1], tm[2], tm[3] || tm[6]); if (tm[4]) end = mm(tm[4], tm[5], tm[6]); if (end != null && start != null && end <= start) end = null; }
  return { kind, type, date: iso(first.d), start, end };
}

const API = { parseAnnounce, moodleTokens, corrAvail, STRETCH, semWeek, backlogScore, backlogOpen, backlogTotal, backlogCredit, coursesOnFor, freezePast, tripOn, weekCfg, recommendMode, DAYS, DAYS_S, MONTHS, MONTHS_L, MODE_ORDER, MODE_META, MODE_DEFAULTS, SPORT_MIN, SPORT_MAX, clone, pad, fmt, parseT, hm, addDays, iso, fromIso, mondayOf, dateLbl, uid, dow, defaultState, normalize, subjOf, sportMinutes, generate, summarize, buildNotifications, buildAgenda };
if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.Semaine = API;
})(typeof self !== 'undefined' ? self : this);
