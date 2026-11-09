/* EPFL Calendar — UI */
(function () {
'use strict';
const L = self.Semaine;
const { DAYS, DAYS_S, MONTHS, MONTHS_L, MODE_ORDER, MODE_META, MODE_DEFAULTS, clone, fmt, parseT, hm, addDays, iso, fromIso, mondayOf, dateLbl, uid, dow, subjOf } = L;
const WORKER = (self.WORKER_URL || '').replace(/\/$/, '');
const LS = 'ma-semaine-epfl-v2';
const MODE_COLORS = { chill: '#1C76A6', normal: '#2E7A55', charbon: '#E2510E', exam: '#C8102E', recup: '#6A58B3' };
const SUBJ_COLORS = ['#C2410C', '#1D4ED8', '#047857', '#7C3AED', '#0E7490', '#BE185D', '#A16207', '#475569'];
const MINOR = new Set(['meal', 'move', 'rest']);

let state;
try { state = L.normalize(JSON.parse(localStorage.getItem(LS))); } catch (e) { state = null; }
if (!state || !localStorage.getItem(LS)) state = L.defaultState();

let tab = 'today';
let selDate = iso(new Date());
let calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let calSel = iso(new Date());

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const CHEV = '<svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>';
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const todayIso = () => iso(new Date());
const longDate = d => DAYS[dow(d)] + ' ' + d.getDate() + ' ' + MONTHS_L[d.getMonth()];

function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('on'), 2600); }

/* ---------- persistence + server sync ---------- */
let syncTimer = null;
function save() {
  const keys = Object.keys(state.done).sort();
  while (keys.length > 12) delete state.done[keys.shift()];
  try { localStorage.setItem(LS, JSON.stringify(state)); } catch (e) { }
  clearTimeout(syncTimer); syncTimer = setTimeout(syncAll, 2500);
}
async function getSub() {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager ? reg.pushManager.getSubscription() : null;
}
const post = (path, body) => fetch(WORKER + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function syncAll() {
  if (!WORKER) return;
  try {
    if (state.widgetToken) await post('/agenda', { token: state.widgetToken, mode: MODE_META[state.mode].name, agenda: L.buildAgenda(state, new Date(), 3) });
  } catch (e) { console.warn('agenda', e); }
  if (!state.notif.on) return;
  try {
    const sub = await getSub(); if (!sub) return;
    const notifications = L.buildNotifications(state, new Date(), 14);
    const r = await post('/sync', { subscription: sub.toJSON(), notifications, backup: state });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    localStorage.setItem(LS + '-sync', JSON.stringify({ t: Date.now(), n: notifications.length }));
    if (tab === 'set') renderSet();
  } catch (e) { console.warn('sync', e); }
}
const b64ToBytes = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s); return Uint8Array.from(b, c => c.charCodeAt(0)); };
async function enableNotifs() {
  if (isIOS && !standalone()) { toast('Ajoute d’abord l’app à ton écran d’accueil'); return; }
  if (!('Notification' in window) || !('serviceWorker' in navigator)) { toast('Notifs pas disponibles ici'); return; }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { renderSet(); toast('Notifs refusées'); return; }
  if (!WORKER) { toast('Serveur de notifs pas encore en ligne'); return; }
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const { publicKey } = await (await fetch(WORKER + '/vapid')).json();
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
    }
    state.notif.on = true; save(); await syncAll();
    await post('/test', { subscription: sub.toJSON() });
    toast('C’est bon ! Une notif de test arrive.');
  } catch (e) { console.warn(e); toast('Échec : ' + (e.message || e)); }
  renderSet(); renderToday();
}
async function disableNotifs() {
  try { const sub = await getSub(); if (sub) { if (WORKER) await post('/unsubscribe', { subscription: sub.toJSON() }); await sub.unsubscribe(); } } catch (e) { }
  state.notif.on = false; save(); renderSet(); toast('Notifs coupées');
}

/* ---------- Sheet ---------- */
let sheetSubmit = null;
function openSheet(title, html, onSubmit) {
  $('#shTitle').textContent = title;
  $('#shBody').innerHTML = html;
  sheetSubmit = onSubmit || null;
  $('#sheetBg').classList.add('on');
  document.body.style.overflow = 'hidden';
}
function closeSheet() { $('#sheetBg').classList.remove('on'); document.body.style.overflow = ''; sheetSubmit = null; }
$('#sheetBg').addEventListener('click', e => { if (e.target.id === 'sheetBg') closeSheet(); });
$('#shBody').addEventListener('submit', e => { e.preventDefault(); if (sheetSubmit) { const fd = Object.fromEntries(new FormData(e.target).entries()); if (sheetSubmit(fd, e.submitter) !== false) closeSheet(); } });

const F = {
  text: (n, l, v, cls = 'full', ph = '') => `<div class="f ${cls}"><label for="f-${n}">${l}</label><input id="f-${n}" name="${n}" type="text" value="${esc(v)}" placeholder="${esc(ph)}"></div>`,
  time: (n, l, v, cls = '') => `<div class="f ${cls}"><label for="f-${n}">${l}</label><input id="f-${n}" name="${n}" type="time" value="${fmt(v)}" required></div>`,
  date: (n, l, v, cls = 'full') => `<div class="f ${cls}"><label for="f-${n}">${l}</label><input id="f-${n}" name="${n}" type="date" value="${esc(v)}"></div>`,
  num: (n, l, v, extra = '', cls = '') => `<div class="f ${cls}"><label for="f-${n}">${l}</label><input id="f-${n}" name="${n}" type="number" inputmode="decimal" value="${esc(v)}" ${extra}></div>`,
  select: (n, l, opts, v, cls = 'full') => `<div class="f ${cls}"><label for="f-${n}">${l}</label><select id="f-${n}" name="${n}">${opts.map(([k, t]) => `<option value="${esc(k)}"${String(k) === String(v) ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></div>`,
  seg: (n, l, opts, v, cls = 'full') => `<div class="f ${cls}"><label>${l}</label><div class="seg">${opts.map(([k, t]) => `<label><input type="radio" name="${n}" value="${esc(k)}"${String(k) === String(v) ? ' checked' : ''}><span>${esc(t)}</span></label>`).join('')}</div></div>`,
  colors: (n, v) => `<div class="f full"><label>Couleur</label><div class="swatches">${SUBJ_COLORS.map(c => `<label><input type="radio" name="${n}" value="${c}"${c === v ? ' checked' : ''}><span style="--c:${c}"></span></label>`).join('')}</div></div>`
};
const dayOpts = DAYS.map((d, i) => [i, d]);
const subjOpts = () => state.subjects.map(s => [s.id, s.name]);
const actions = (canDelete, saveLabel = 'Enregistrer') => `<div class="sh-actions">${canDelete ? '<button type="submit" class="btn danger" value="delete">Supprimer</button>' : ''}<button type="submit" class="btn pri" value="save">${saveLabel}</button></div>`;
const isDel = btn => btn && btn.value === 'delete';
const timesOk = fd => { const s = parseT(fd.start), e = parseT(fd.end); if (s == null || e == null || e <= s) { toast('L’heure de fin doit être après le début'); return null; } return [s, e]; };

function editCourse(id) {
  const c = state.courses.find(x => x.id === id) || { id: null, day: 0, start: 495, end: 600, subj: (state.subjects[0] || {}).id, type: 'Cours', room: '' };
  openSheet(c.id ? 'Modifier le cours' : 'Nouveau cours', `<div class="fields">
    ${F.select('subj', 'Matière', subjOpts(), c.subj)}
    ${F.seg('type', 'Type', [['Cours', 'Cours'], ['Exercices', 'Exos'], ['TP', 'TP']], c.type)}
    ${F.select('day', 'Jour', dayOpts, c.day)}
    ${F.time('start', 'Début', c.start)}${F.time('end', 'Fin', c.end)}
    ${F.text('room', 'Salle', c.room, 'full', 'ex. CE 1 1')}
  </div>${actions(!!c.id)}`, (fd, btn) => {
    if (isDel(btn)) { state.courses = state.courses.filter(x => x.id !== c.id); return done(); }
    const t = timesOk(fd); if (!t) return false;
    const obj = { id: c.id || uid(), day: +fd.day, start: t[0], end: t[1], subj: fd.subj, type: fd.type || 'Cours', room: fd.room.trim() };
    if (c.id) Object.assign(c, obj); else state.courses.push(obj);
    return done();
  });
}
function editRoutine(id) {
  const r = state.routines.find(x => x.id === id) || { id: null, day: 5, start: 600, end: 660, title: '' };
  openSheet(r.id ? 'Modifier la routine' : 'Nouvelle routine', `<div class="fields">
    ${F.text('title', 'Quoi', r.title, 'full', 'ex. Courses + lessive')}
    ${F.select('day', 'Jour', dayOpts, r.day)}
    ${F.time('start', 'Début', r.start)}${F.time('end', 'Fin', r.end)}
  </div>${actions(!!r.id)}`, (fd, btn) => {
    if (isDel(btn)) { state.routines = state.routines.filter(x => x.id !== r.id); return done(); }
    const t = timesOk(fd); if (!t) return false;
    const obj = { id: r.id || uid(), day: +fd.day, start: t[0], end: t[1], title: fd.title.trim() || 'Routine' };
    if (r.id) Object.assign(r, obj); else state.routines.push(obj);
    return done();
  });
}
function editSubject(id) {
  const s = state.subjects.find(x => x.id === id) || { id: null, name: '', color: SUBJ_COLORS[state.subjects.length % SUBJ_COLORS.length], prio: 2, exam: '' };
  openSheet(s.id ? s.name : 'Nouvelle matière', `<div class="fields">
    ${F.text('name', 'Nom', s.name, 'full', 'ex. Analyse I')}
    ${F.colors('color', s.color)}
    ${F.seg('prio', 'Importance (plus = plus de temps d’étude)', [[1, 'Faible'], [2, 'Normale'], [3, 'Haute']], s.prio)}
    ${F.date('exam', 'Date d’examen (laisse vide si tu ne sais pas)', s.exam)}
  </div>${actions(!!s.id)}`, (fd, btn) => {
    if (isDel(btn)) {
      if (btn.dataset.sure !== '1') { btn.dataset.sure = '1'; btn.textContent = 'Confirmer ?'; toast('Ses cours et deadlines seront aussi supprimés'); return false; }
      state.subjects = state.subjects.filter(x => x.id !== s.id); state.courses = state.courses.filter(c => c.subj !== s.id); state.deadlines = state.deadlines.filter(x => x.subj !== s.id); return done();
    }
    const obj = { id: s.id || uid(), name: fd.name.trim() || 'Matière', color: fd.color || s.color, prio: +fd.prio || 2, exam: fd.exam || '' };
    if (s.id) Object.assign(s, obj); else state.subjects.push(obj);
    return done();
  });
}
function editEvent(id, date) {
  const x = state.events.find(e => e.id === id) || { id: null, date: date || calSel, start: 1110, end: 1200, title: '', place: '' };
  openSheet(x.id ? 'Modifier l’événement' : 'Nouvel événement', `<div class="fields">
    ${F.text('title', 'Quoi', x.title, 'full', 'ex. Anniversaire de Léa')}
    ${F.date('date', 'Jour', x.date)}
    ${F.time('start', 'Début', x.start)}${F.time('end', 'Fin', x.end)}
    ${F.text('place', 'Où (facultatif)', x.place)}
  </div>${actions(!!x.id)}`, (fd, btn) => {
    if (isDel(btn)) { state.events = state.events.filter(e => e.id !== x.id); return done(); }
    const t = timesOk(fd); if (!t) return false;
    if (!fd.date) { toast('Choisis un jour'); return false; }
    const obj = { id: x.id || uid(), date: fd.date, start: t[0], end: t[1], title: fd.title.trim() || 'Événement', place: fd.place.trim() };
    if (x.id) Object.assign(x, obj); else state.events.push(obj);
    calSel = obj.date; return done();
  });
}
function editDeadline(id, date) {
  const x = state.deadlines.find(e => e.id === id) || { id: null, subj: (state.subjects[0] || {}).id, title: '', due: (date || iso(addDays(new Date(), 3))) + 'T18:00', hours: 2 };
  openSheet(x.id ? 'Modifier la deadline' : 'Nouvelle deadline', `<div class="fields">
    ${F.select('subj', 'Matière', subjOpts(), x.subj)}
    ${F.text('title', 'Quoi', x.title, 'full', 'ex. Série 9')}
    ${F.date('dueDate', 'À rendre le', (x.due || '').slice(0, 10), '')}
    <div class="f"><label for="f-dueTime">à</label><input id="f-dueTime" name="dueTime" type="time" value="${esc((x.due || '').slice(11, 16) || '18:00')}"></div>
    ${F.seg('hours', 'Temps de travail estimé', [[1, '1h'], [2, '2h'], [3, '3h'], [5, '5h']], [1, 2, 3, 5].includes(+x.hours) ? +x.hours : 2)}
  </div><p class="hint" style="margin-top:10px">Le planning réserve ce temps dans les jours d’avant, et tu reçois un rappel la veille.</p>${actions(!!x.id)}`, (fd, btn) => {
    if (isDel(btn)) { state.deadlines = state.deadlines.filter(e => e.id !== x.id); return done(); }
    if (!fd.dueDate) { toast('Choisis une date'); return false; }
    const obj = { id: x.id || uid(), subj: fd.subj, title: fd.title.trim() || 'Série', due: fd.dueDate + 'T' + (fd.dueTime || '18:00'), hours: +fd.hours || 2 };
    if (x.id) Object.assign(x, obj); else state.deadlines.push(obj);
    calSel = fd.dueDate; return done();
  });
}
function editExam(subjId, date) {
  const opts = subjOpts();
  openSheet('Date d’examen', `<div class="fields">
    ${F.select('subj', 'Matière', opts, subjId || (opts[0] || [])[0])}
    ${F.date('exam', 'Date', date || (subjOf(state, subjId) || {}).exam || calSel)}
  </div><p class="hint" style="margin-top:10px">La matière prend plus de place dans ton planning les deux semaines d’avant. Rappels une semaine avant et la veille.</p>${actions(!!subjId)}`, (fd, btn) => {
    const s = subjOf(state, fd.subj); if (!s) return false;
    if (isDel(btn)) { s.exam = ''; return done(); }
    s.exam = fd.exam || ''; if (s.exam) calSel = s.exam; return done();
  });
}
function addSheet() {
  openSheet('Ajouter', `<div class="modes">
    <button type="button" class="mopt" data-act="newEvent" style="--m:var(--acc)"><span class="sw8"></span><span><b>Un événement</b><small>Soirée, rendez-vous, match… Le planning travaille autour.</small></span></button>
    <button type="button" class="mopt" data-act="newDeadline" style="--m:var(--warn)"><span class="sw8"></span><span><b>Une série à rendre</b><small>Le temps nécessaire est réservé dans les jours d’avant.</small></span></button>
    <button type="button" class="mopt" data-act="newExam" style="--m:var(--exam)"><span class="sw8"></span><span><b>Un examen</b><small>La matière passe en priorité quand l’examen approche.</small></span></button>
  </div>`);
}
function modeSheet() {
  openSheet('Mode de la semaine', `<div class="modes" role="radiogroup">${MODE_ORDER.map(k => `<button type="button" class="mopt" role="radio" aria-checked="${k === state.mode}" data-act="setMode" data-v="${k}" style="--m:${MODE_COLORS[k]}"><span class="sw8"></span><span><b>${MODE_META[k].name}</b><small>${esc(MODE_META[k].tag)}</small></span></button>`).join('')}</div>
    <button type="button" class="linkbtn" data-act="tuneMode">Ajuster le mode ${esc(MODE_META[state.mode].name)}</button>`);
}
function tuneMode() {
  const m = state.modes[state.mode];
  openSheet('Mode ' + MODE_META[state.mode].name, `<div class="fields">
    ${F.time('wake', 'Réveil (semaine)', m.wake)}${F.time('wakeWE', 'Réveil (week-end)', m.wakeWE)}
    ${F.time('sleep', 'Coucher', m.sleep)}
    ${F.select('studyDay', 'Étude par jour', [0, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360, 420, 480].map(v => [v, v ? hm(v) : 'Aucune']), m.studyDay, '')}
    ${F.select('sat', 'Samedi', [0, 60, 120, 180, 240, 300, 360].map(v => [v, v ? hm(v) + ' d’étude' : 'Jour off']), m.sat, '')}
    ${F.select('sun', 'Dimanche', [0, 60, 120, 180, 240, 300, 360].map(v => [v, v ? hm(v) + ' d’étude' : 'Jour off']), m.sun, '')}
  </div>
  <details class="more" style="margin-top:14px;border:0"><summary style="padding:8px 2px">Plus de réglages</summary><div class="fields">
    ${F.select('block', 'Durée d’un bloc', [25, 30, 45, 50, 60, 75, 90].map(v => [v, v + ' min']), m.block, '')}
    ${F.select('pause', 'Pause entre blocs', [5, 10, 15, 20].map(v => [v, v + ' min']), m.pause, '')}
    ${F.select('freeEve', 'Temps libre le soir', [0, 30, 45, 60, 90, 120, 150, 180].map(v => [v, v ? hm(v) : 'Aucun']), m.freeEve, '')}
    ${F.select('sportMin', 'Durée du sport', [0, 30, 45, 60, 75, 90].map(v => [v, v ? v + ' min' : 'Pas de sport']), m.sportMin, '')}
    <div class="f full"><label>Jours de sport</label><div class="seg">${DAYS_S.map((n, i) => `<label><input type="checkbox" name="sd${i}"${(m.sportDays || []).includes(i) ? ' checked' : ''}><span>${n}</span></label>`).join('')}</div></div>
  </div></details>
  <div class="sh-actions"><button type="submit" class="btn" value="reset">Par défaut</button><button type="submit" class="btn pri" value="save">Enregistrer</button></div>`, (fd, btn) => {
    if (btn && btn.value === 'reset') { state.modes[state.mode] = clone(MODE_DEFAULTS[state.mode]); toast('Mode remis par défaut'); return done(); }
    for (const k of ['wake', 'wakeWE', 'sleep']) { const v = parseT(fd[k]); if (v != null) m[k] = v; }
    for (const k of ['studyDay', 'sat', 'sun', 'block', 'pause', 'freeEve', 'sportMin']) if (fd[k] != null) m[k] = +fd[k];
    m.sportDays = DAYS_S.map((_, i) => i).filter(i => fd['sd' + i]);
    return done();
  });
}
function weekSheet() {
  const ws = mondayOf(fromIso(selDate)), key = iso(ws);
  const days = L.generate(state, ws), sm = L.summarize(state, days, key);
  const pct = sm.plan ? Math.round(sm.dn / sm.plan * 100) : 0;
  const max = Math.max(1, ...Object.values(sm.per).map(x => x.plan));
  const alerts = [];
  if (sm.sleepAvg < 450) alerts.push('Moins de 7h30 de sommeil par nuit. Avance le coucher dans « Ajuster le mode ».');
  const short = days.filter(d => d.shortfall >= 30);
  if (short.length) alerts.push('L’objectif d’étude ne rentre pas en entier ' + short.map(d => DAYS[d.d].toLowerCase()).join(', ') + ' (journées chargées en cours).');
  if (state.mode === 'exam' && !state.subjects.some(s => s.exam)) alerts.push('Ajoute tes dates d’examen (Calendrier → +) pour que le mode Exam sache quoi prioriser.');
  if (state.mode === 'exam' && state.coursesOn) alerts.push('Pendant la session, coupe « J’ai cours » dans Ma semaine pour libérer les journées.');
  openSheet('Semaine du ' + dateLbl(ws), `<div class="stats">
      <div class="stat"><div class="k">Étude faite</div><div class="v">${pct}%</div><div class="hint" style="padding:0">${hm(sm.dn)} sur ${hm(sm.plan)}</div></div>
      <div class="stat"><div class="k">Cours</div><div class="v">${state.coursesOn ? hm(sm.course) : '—'}</div></div>
      <div class="stat${sm.sleepAvg < 450 ? ' warn' : ''}"><div class="k">Sommeil moyen</div><div class="v">${hm(sm.sleepAvg)}</div></div>
      <div class="stat"><div class="k">Sport</div><div class="v">${sm.sportDone}/${sm.sport}</div></div>
    </div>
    ${alerts.map(a => `<div class="alert">${esc(a)}</div>`).join('')}
    <div class="sec-t" style="margin-top:20px">Par matière</div>
    <div class="group" style="padding:2px 14px">${state.subjects.map(s => { const p = sm.per[s.id] || { plan: 0, done: 0 }; return `<div class="subrow" style="--c:${esc(s.color)}"><span>${esc(s.name)}</span><span class="num">${p.done ? hm(p.done) : '0'} / ${hm(p.plan)}</span><span class="bar"><b style="width:${p.plan / max * 100}%"></b><i style="width:${p.done / max * 100}%"></i></span></div>`; }).join('')}</div>`);
}
function done() { save(); renderAll(); return true; }

/* ---------- Aujourd'hui ---------- */
function renderToday() {
  document.body.dataset.mode = state.mode;
  const sel = fromIso(selDate), ws = mondayOf(sel), key = iso(ws);
  const days = L.generate(state, ws), sm = L.summarize(state, days, key);
  const day = days[dow(sel)];
  const isToday = selDate === todayIso();
  const now = new Date(), mins = now.getHours() * 60 + now.getMinutes();
  const isPastDay = sel < fromIso(todayIso());
  const we = addDays(ws, 6);
  $('#tEyebrow').textContent = isToday ? 'Aujourd’hui' : (Math.abs(sel - fromIso(todayIso())) === 864e5 ? (sel > fromIso(todayIso()) ? 'Demain' : 'Hier') : 'Semaine du ' + ws.getDate() + (ws.getMonth() !== we.getMonth() ? ' ' + MONTHS[ws.getMonth()] : '') + ' au ' + dateLbl(we));
  $('#tTitle').textContent = DAYS[dow(sel)] + ' ' + sel.getDate() + ' ' + MONTHS[sel.getMonth()];
  $('#modePill').innerHTML = `<span class="dot"></span>${MODE_META[state.mode].name}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>`;
  $('#strip').innerHTML = `<button type="button" class="arr" data-act="wk" data-v="-7" aria-label="Semaine précédente">‹</button><div class="days" role="tablist">${days.map(d => {
    const di = iso(d.date);
    return `<button type="button" role="tab" class="sd${di === todayIso() ? ' today' : ''}" aria-selected="${di === selDate}" data-act="pick" data-v="${di}"><span class="l">${DAYS_S[d.d]}</span><span class="n">${d.date.getDate()}</span><span class="p"><i style="width:${d.plan ? d.dn / d.plan * 100 : 0}%"></i></span></button>`;
  }).join('')}</div><button type="button" class="arr" data-act="wk" data-v="7" aria-label="Semaine suivante">›</button>`;

  const main = day.ev.filter(e => e.kind !== 'mark');
  let hero = '';
  if (isToday) {
    const cur = main.find(e => !MINOR.has(e.kind) && e.start <= mins && mins < e.end) || main.find(e => e.start <= mins && mins < e.end);
    const nxt = main.find(e => e.start > mins && !MINOR.has(e.kind));
    if (cur) {
      const p = Math.round((mins - cur.start) / (cur.end - cur.start) * 100);
      hero = `<div class="hero"><div class="k">Maintenant · encore ${hm(cur.end - mins)}</div><div class="t">${esc(cur.title)}</div><div class="s">${esc(cur.sub || '')}</div><div class="bar"><i style="width:${p}%"></i></div>${nxt ? `<div class="next"><span class="num">${fmt(nxt.start)}</span><span>Ensuite <b>${esc(nxt.title)}</b></span></div>` : ''}</div>`;
    } else if (nxt) {
      hero = `<div class="hero"><div class="k">Prochain · dans ${hm(nxt.start - mins)}</div><div class="t">${esc(nxt.title)}</div><div class="s"><span class="num">${fmt(nxt.start)}–${fmt(nxt.end)}</span>${nxt.sub ? ' · ' + esc(nxt.sub) : ''}</div></div>`;
    } else hero = `<div class="hero quiet"><div class="k">C’est fini pour aujourd’hui</div><div class="t">Bonne soirée</div><div class="s">Au lit vers ${fmt(day.sleep)}.</div></div>`;
  }
  const st = main.filter(e => e.kind === 'study'), stDone = st.filter(e => sm.done[e.id]);
  const prog = st.length ? `<div class="prog"><span><b>${stDone.length}/${st.length}</b> blocs</span><span class="track"><i style="width:${stDone.length / st.length * 100}%"></i></span><span class="num">${hm(day.dn)} / ${hm(day.plan)}</span></div>` : '';
  const notice = !state.notif.on && isToday ? `<div class="notice"><span>Les rappels sont coupés.</span><button type="button" data-act="goSet">Activer</button></div>` : '';

  const rows = [`<div class="it k-minor"><span class="tm">${fmt(day.wake)}</span><span class="minor">Réveil</span></div>`];
  for (const e of main) {
    if (MINOR.has(e.kind)) { rows.push(`<div class="it k-minor"><span class="tm">${fmt(e.start)}</span><span class="minor">${esc(e.title)}</span></div>`); continue; }
    const su = e.subj ? subjOf(state, e.subj) : null;
    const isDone = !!sm.done[e.id], can = e.kind === 'study' || e.kind === 'sport';
    const cls = ['it', 'k-' + e.kind];
    if (isToday && e.start <= mins && mins < e.end) cls.push('now');
    if ((isToday && e.end <= mins) || isPastDay) cls.push('past');
    if (isDone) cls.push('done');
    rows.push(`<div class="${cls.join(' ')}"${su ? ` style="--c:${esc(su.color)}"` : ''}><span class="tm">${fmt(e.start)}<small>${fmt(e.end)}</small></span>
      <div class="card"><div class="bd"><div class="ti">${esc(e.title)}${e.deadline ? `<span class="tag">${esc(e.dueLbl)}</span>` : ''}</div>${e.sub ? `<div class="su">${esc(e.sub)}</div>` : ''}</div>
      ${can ? `<button type="button" class="chk" data-act="done" data-w="${key}" data-v="${e.id}" aria-pressed="${isDone}" aria-label="Fait : ${esc(e.title)}">${CHECK}</button>` : ''}</div></div>`);
  }
  $('#todayBody').innerHTML = `${hero}${notice}${prog}<div class="tl">${rows.join('')}</div>
    <div class="endday">Au lit ${fmt(day.sleep)}</div>
    ${day.shortfall >= 30 ? `<p class="short">Journée chargée : ${hm(day.shortfall)} d’étude ne rentrent pas.</p>` : ''}
    <button type="button" class="linkbtn" data-act="weekSheet">Bilan de la semaine</button>`;
}

/* ---------- Calendrier ---------- */
function renderCal() {
  const y = calMonth.getFullYear(), mo = calMonth.getMonth();
  const first = new Date(y, mo, 1), start = addDays(first, -dow(first));
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i), di = iso(d);
    if (i >= 35 && d.getMonth() !== mo) break;
    const dots = [];
    if (state.events.some(x => x.date === di)) dots.push('<i class="i-ev"></i>');
    if (state.deadlines.some(x => (x.due || '').slice(0, 10) === di)) dots.push('<i class="i-dl"></i>');
    if (state.subjects.some(s => s.exam === di)) dots.push('<i class="i-ex"></i>');
    cells.push(`<button type="button" class="cell${d.getMonth() !== mo ? ' out' : ''}${di === todayIso() ? ' today' : ''}" data-act="calday" data-v="${di}" aria-selected="${di === calSel}" aria-label="${longDate(d)}"><span class="n">${d.getDate()}</span><span class="dots">${dots.join('')}</span></button>`);
  }
  const items = [];
  state.subjects.filter(s => s.exam === calSel).forEach(s => items.push(`<button type="button" class="li" data-act="editExam" data-v="${esc(s.id)}" style="--c:var(--exam)"><span class="dt"></span><span class="bd"><span class="ti">Examen · ${esc(s.name)}</span></span>${CHEV}</button>`));
  state.deadlines.filter(x => (x.due || '').slice(0, 10) === calSel).forEach(x => { const s = subjOf(state, x.subj); items.push(`<button type="button" class="li" data-act="editDeadline" data-v="${esc(x.id)}" style="--c:var(--warn)"><span class="dt"></span><span class="bd"><span class="ti">${esc(x.title)}</span><span class="su">À rendre · ${esc(s ? s.name : '')} · ${x.hours}h de travail</span></span><span class="rt">${esc((x.due || '').slice(11, 16))}</span>${CHEV}</button>`); });
  state.events.filter(x => x.date === calSel).sort((a, b) => a.start - b.start).forEach(x => items.push(`<button type="button" class="li" data-act="editEvent" data-v="${esc(x.id)}" style="--c:var(--acc)"><span class="dt"></span><span class="bd"><span class="ti">${esc(x.title)}</span>${x.place ? `<span class="su">${esc(x.place)}</span>` : ''}</span><span class="rt">${fmt(x.start)}<br>${fmt(x.end)}</span>${CHEV}</button>`));
  const sel = fromIso(calSel);
  $('#calBody').innerHTML = `
    <div class="cal-h"><button type="button" data-act="calm" data-v="-1" aria-label="Mois précédent">‹</button><b>${MONTHS_L[mo]} ${y}</b><button type="button" data-act="calm" data-v="1" aria-label="Mois suivant">›</button></div>
    <div class="cal">${DAYS_S.map(n => `<span class="wd">${n}</span>`).join('')}${cells.join('')}</div>
    <div class="legend"><span><i class="i-ev"></i>Événement</span><span><i class="i-dl"></i>À rendre</span><span><i class="i-ex"></i>Examen</span></div>
    <div class="sec-t">${longDate(sel)}<button type="button" data-act="openDay">Voir la journée</button></div>
    <div class="group">${items.join('') || '<div class="empty">Rien d’ajouté ce jour-là. Touche + pour ajouter un événement, une série ou un examen.</div>'}</div>`;
}

/* ---------- Ma semaine type ---------- */
function renderWeek() {
  const byDay = DAYS.map((_, i) => state.courses.filter(c => c.day === i).sort((a, b) => a.start - b.start));
  const courseRows = byDay.map((list, i) => list.length ? `<div class="dayhead">${DAYS[i]}</div>` + list.map(c => { const s = subjOf(state, c.subj); return `<button type="button" class="li" data-act="editCourse" data-v="${c.id}" style="--c:${esc(s ? s.color : '')}"><span class="dt"></span><span class="bd"><span class="ti">${esc(s ? s.name : 'Cours')}</span><span class="su">${esc([c.type, c.room].filter(Boolean).join(' · '))}</span></span><span class="rt">${fmt(c.start)}<br>${fmt(c.end)}</span>${CHEV}</button>`; }).join('') : '').join('');
  const prioL = ['', 'Importance faible', 'Importance normale', 'Importance haute'];
  $('#weekBody').innerHTML = `
    <div class="group" style="margin-top:18px"><label class="row-sw"><span class="bd"><span class="ti">J’ai cours cette semaine</span><span class="su">Coupe pendant la session ou les vacances</span></span><input type="checkbox" class="sw" id="coursesOn" ${state.coursesOn ? 'checked' : ''}></label></div>
    <div class="sec-t">Horaire<button type="button" data-act="editCourse">+ Cours</button></div>
    <div class="group">${courseRows || '<div class="empty">Aucun cours.</div>'}</div>
    <div class="sec-t">Matières<button type="button" data-act="editSubject">+ Matière</button></div>
    <div class="group">${state.subjects.map(s => `<button type="button" class="li" data-act="editSubject" data-v="${esc(s.id)}" style="--c:${esc(s.color)}"><span class="dt"></span><span class="bd"><span class="ti">${esc(s.name)}</span><span class="su">${prioL[s.prio] || ''}${s.exam ? ' · examen le ' + dateLbl(fromIso(s.exam)) : ''}</span></span>${CHEV}</button>`).join('') || '<div class="empty">Aucune matière.</div>'}</div>
    <div class="sec-t">Routines<button type="button" data-act="editRoutine">+ Routine</button></div>
    <div class="group">${state.routines.slice().sort((a, b) => a.day - b.day || a.start - b.start).map(r => `<button type="button" class="li" data-act="editRoutine" data-v="${r.id}"><span class="dt"></span><span class="bd"><span class="ti">${esc(r.title)}</span><span class="su">${DAYS[r.day]}</span></span><span class="rt">${fmt(r.start)}<br>${fmt(r.end)}</span>${CHEV}</button>`).join('') || '<div class="empty">Aucune routine.</div>'}</div>`;
}

/* ---------- Réglages ---------- */
function renderSet() {
  const N = state.notif;
  let sync = null; try { sync = JSON.parse(localStorage.getItem(LS + '-sync')); } catch (e) { }
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  let status;
  if (isIOS && !standalone()) status = `<div class="status"><b>Installe d’abord l’app</b>Pour recevoir des rappels :<ol><li>Ouvre cette page dans <b style="display:inline">Safari</b></li><li>Touche Partager, puis « Sur l’écran d’accueil »</li><li>Ouvre l’app depuis l’icône et reviens ici</li></ol></div>`;
  else if (perm === 'denied') status = `<div class="status"><b>Rappels bloqués</b>Réactive-les dans Réglages iPhone → Notifications → EPFL Calendar.</div>`;
  else if (N.on) status = `<div class="status"><b>Rappels activés</b>${sync ? sync.n + ' rappels prévus sur les 14 prochains jours.' : 'Mise à jour en cours…'}</div><div class="btns"><button type="button" class="btn" data-act="testNotif">Tester</button><button type="button" class="btn" data-act="notifOff">Couper</button></div>`;
  else status = `<div class="status"><b>Rappels coupés</b>Reçois un rappel avant tes cours, au début de tes blocs d’étude et la veille de tes deadlines.</div><div class="btns"><button type="button" class="btn pri full" data-act="notifOn">Activer les rappels</button></div>`;
  const T = (f, label, sub) => `<label class="row-sw"><span class="bd"><span class="ti">${label}</span>${sub ? `<span class="su">${sub}</span>` : ''}</span><input type="checkbox" class="sw" data-nf="${f}" ${N[f] ? 'checked' : ''}></label>`;
  $('#setBody').innerHTML = `
    <div class="sec-t">Rappels</div>
    <div class="group">${status}
      ${N.on ? `<details class="more"><summary>Choisir mes rappels</summary>
        <label class="row-sw"><span class="bd"><span class="ti">Avant un cours</span></span><select data-nfn="course" style="border:1px solid var(--line);border-radius:10px;padding:7px 10px;background:var(--bg)">${[0, 5, 10, 15, 30].map(v => `<option value="${v}"${N.course === v ? ' selected' : ''}>${v ? v + ' min avant' : 'Non'}</option>`).join('')}</select></label>
        ${T('study', 'Blocs d’étude', 'Au début de chaque bloc')}
        ${T('morning', 'Matin et soir', 'Programme du jour au réveil, bilan avant de dormir')}
        ${T('deadline', 'Deadlines et examens', 'La veille, et une semaine avant un examen')}
        ${T('sport', 'Sport, routines et événements', 'Juste avant')}
      </details>` : ''}
    </div>
    <div class="sec-t">Mode</div>
    <div class="group"><button type="button" class="li" data-act="modeSheet" style="--c:${MODE_COLORS[state.mode]}"><span class="dt"></span><span class="bd"><span class="ti">${MODE_META[state.mode].name}</span><span class="su">Changer de mode</span></span>${CHEV}</button>
      <button type="button" class="li" data-act="tuneMode"><span class="bd"><span class="ti">Ajuster le mode ${MODE_META[state.mode].name}</span><span class="su">Réveil, coucher, heures d’étude, sport</span></span>${CHEV}</button></div>
    <div class="sec-t">Widget</div>
    <div class="group"><button type="button" class="li" data-act="widgetSheet"><span class="bd"><span class="ti">Widget pour l’écran d’accueil</span><span class="su">Ton programme sans ouvrir l’app</span></span>${CHEV}</button></div>
    <div class="sec-t">Sauvegarde</div>
    <div class="group"><button type="button" class="li" data-act="export"><span class="bd"><span class="ti">Copier une sauvegarde</span><span class="su">À coller dans tes Notes</span></span></button><button type="button" class="li" data-act="importShow"><span class="bd"><span class="ti">Restaurer une sauvegarde</span></span>${CHEV}</button></div>
    <p class="hint" style="margin-top:14px;text-align:center">EPFL Calendar · version ${esc(self.APP_VERSION || 'dev')}</p>`;
}

function widgetScript() {
  return `// EPFL Calendar — widget Scriptable
const URL_ = "${WORKER}/agenda?t=${state.widgetToken}";
const ACC = new Color("#E2510E");
let data;
try { data = await new Request(URL_).loadJSON(); } catch (e) { data = { agenda: [] }; }
const now = Date.now();
const items = (data.agenda || []).filter(x => x.e > now);
const fam = config.widgetFamily || "medium";
const max = fam === "small" ? 2 : fam === "large" ? 8 : 3;
const fmt = t => { const d = new Date(t); return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2); };
const w = new ListWidget();
w.backgroundColor = Color.dynamic(new Color("#FFFFFF"), new Color("#1A191F"));
w.url = "${location.href.split('#')[0]}";
const head = w.addStack(); head.centerAlignContent();
const h = head.addText("EPFL CALENDAR"); h.font = Font.boldSystemFont(10); h.textColor = ACC;
head.addSpacer();
const md = head.addText((data.mode || "").toUpperCase()); md.font = Font.mediumSystemFont(10); md.textColor = Color.gray();
w.addSpacer(6);
if (!items.length) { const t = w.addText("Rien de prévu"); t.font = Font.boldSystemFont(15); }
items.slice(0, max).forEach((x, i) => {
  const row = w.addStack(); row.layoutHorizontally(); row.spacing = 7;
  const bar = row.addStack(); bar.size = new Size(4, i === 0 ? 34 : 28); bar.cornerRadius = 2; bar.backgroundColor = new Color(x.c || "#9C99A3");
  const col = row.addStack(); col.layoutVertically();
  const live = x.s <= now;
  const top = col.addText((live ? "Maintenant · jusqu’à " + fmt(x.e) : fmt(x.s) + "–" + fmt(x.e)));
  top.font = Font.mediumMonospacedSystemFont(10); top.textColor = live ? ACC : Color.gray();
  const t = col.addText(x.t); t.font = Font.boldSystemFont(i === 0 ? 15 : 13); t.lineLimit = 1;
  if (x.u && fam !== "small") { const u = col.addText(x.u); u.font = Font.systemFont(11); u.textColor = Color.gray(); u.lineLimit = 1; }
  w.addSpacer(i === 0 ? 6 : 4);
});
w.addSpacer();
const nextChange = items.length ? Math.min(...items.slice(0, 2).map(x => x.s > now ? x.s : x.e)) : now + 3600e3;
w.refreshAfterDate = new Date(Math.max(nextChange, now + 5 * 60e3));
if (config.runsInWidget) Script.setWidget(w); else await w.presentMedium();
Script.complete();`;
}
function widgetSheet() {
  if (!WORKER) { toast('Serveur pas encore en ligne'); return; }
  if (!state.widgetToken) { state.widgetToken = Array.from(crypto.getRandomValues(new Uint8Array(18)), b => b.toString(16).padStart(2, '0')).join(''); save(); syncAll(); }
  openSheet('Widget', `<p style="margin:0 0 12px;color:var(--muted)">iPhone ne permet pas aux web apps d’avoir leur propre widget. On passe par <b style="color:var(--ink)">Scriptable</b>, une app gratuite qui sert juste à ça.</p>
    <div class="group"><div class="status"><ol style="margin:0">
      <li>Installe <b style="display:inline">Scriptable</b> depuis l’App Store</li>
      <li>Touche <b style="display:inline">Copier le script</b> ci-dessous</li>
      <li>Dans Scriptable : <b style="display:inline">+</b> en haut à droite, colle, puis renomme le script « EPFL Calendar »</li>
      <li>Sur l’écran d’accueil : appui long → <b style="display:inline">+</b> → Scriptable → choisis la taille → Ajouter</li>
      <li>Appui long sur le widget → Modifier le widget → Script : <b style="display:inline">EPFL Calendar</b></li>
    </ol></div></div>
    <div class="sh-actions"><button type="button" class="btn pri" data-act="copyWidget">Copier le script</button></div>
    <p class="hint" style="margin-top:10px">Le widget affiche ce que tu fais maintenant et la suite. Il se met à jour quand tu ouvres l’app.</p>`);
}

function renderAll() { renderToday(); if (tab === 'cal') renderCal(); renderWeek(); renderSet(); }
function showTab(t) {
  tab = t;
  document.querySelectorAll('.nav button').forEach(b => { if (b.dataset.tab === t) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === 'v-' + t));
  if (t === 'cal') renderCal(); if (t === 'today') renderToday(); if (t === 'set') renderSet(); if (t === 'week') renderWeek();
  window.scrollTo(0, 0);
}
const keepScroll = fn => { const y = window.scrollY; fn(); window.scrollTo(0, y); };
async function copyText(txt, okMsg) {
  try { await navigator.clipboard.writeText(txt); toast(okMsg); }
  catch (e) { openSheet('Copie', `<p class="hint">Sélectionne tout le texte et copie-le.</p><textarea class="box" readonly>${esc(txt)}</textarea>`); }
}

/* ---------- Events ---------- */
document.addEventListener('click', async e => {
  const nb = e.target.closest('.nav button'); if (nb) { showTab(nb.dataset.tab); return; }
  const b = e.target.closest('[data-act]'); if (!b || b.type === 'submit') return;
  const a = b.dataset.act, v = b.dataset.v;
  switch (a) {
    case 'closeSheet': closeSheet(); return;
    case 'pick': selDate = v; renderToday(); return;
    case 'wk': selDate = iso(addDays(fromIso(selDate), +v)); renderToday(); return;
    case 'done': { const d = state.done[b.dataset.w] = state.done[b.dataset.w] || {}; if (d[v]) delete d[v]; else d[v] = 1; save(); keepScroll(renderToday); return; }
    case 'modeSheet': modeSheet(); return;
    case 'setMode': state.mode = v; save(); renderAll(); closeSheet(); toast('Mode ' + MODE_META[v].name); return;
    case 'tuneMode': tuneMode(); return;
    case 'weekSheet': weekSheet(); return;
    case 'goSet': showTab('set'); return;
    case 'calm': calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + (+v), 1); renderCal(); return;
    case 'calday': calSel = v; keepScroll(renderCal); return;
    case 'openDay': selDate = calSel; showTab('today'); return;
    case 'addSheet': addSheet(); return;
    case 'newEvent': editEvent(null, calSel); return;
    case 'newDeadline': editDeadline(null, calSel); return;
    case 'newExam': editExam(null, calSel); return;
    case 'editEvent': editEvent(v); return;
    case 'editDeadline': editDeadline(v); return;
    case 'editExam': editExam(v); return;
    case 'editCourse': editCourse(v); return;
    case 'editRoutine': editRoutine(v); return;
    case 'editSubject': editSubject(v); return;
    case 'notifOn': enableNotifs(); return;
    case 'notifOff': disableNotifs(); return;
    case 'testNotif': { const sub = await getSub(); if (!sub || !WORKER) { toast('Rappels pas activés'); return; } const r = await post('/test', { subscription: sub.toJSON() }).then(r => r.json()).catch(() => ({})); toast(r.ok ? 'Notif de test envoyée' : 'Échec de l’envoi'); return; }
    case 'widgetSheet': widgetSheet(); return;
    case 'copyWidget': copyText(widgetScript(), 'Script copié. Colle-le dans Scriptable.'); return;
    case 'export': copyText(JSON.stringify(state), 'Sauvegarde copiée. Colle-la dans tes Notes.'); return;
    case 'importShow': openSheet('Restaurer', `<textarea class="box" name="txt" placeholder="Colle ta sauvegarde ici"></textarea><div class="sh-actions"><button type="submit" class="btn pri">Restaurer</button></div>`, fd => { try { state = L.normalize(JSON.parse(fd.txt)); save(); renderAll(); toast('Sauvegarde restaurée'); } catch (err) { toast('Texte illisible'); return false; } }); return;
  }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'coursesOn') { state.coursesOn = t.checked; save(); renderToday(); return; }
  if (t.dataset.nf) { if (t.dataset.nf === 'sport') { state.notif.sport = state.notif.routine = t.checked; state.notif.event = t.checked ? 15 : 0; } else if (t.dataset.nf === 'morning') { state.notif.morning = state.notif.evening = t.checked; } else state.notif[t.dataset.nf] = t.checked; save(); return; }
  if (t.dataset.nfn) { state.notif[t.dataset.nfn] = +t.value; save(); }
});

/* ---------- boot ---------- */
renderAll();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').then(r => r.update().catch(() => { })).catch(e => console.warn('sw', e));
syncAll();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (tab === 'today') keepScroll(renderToday);
  syncAll();
});
setInterval(() => { if (document.visibilityState === 'visible' && tab === 'today') keepScroll(renderToday); }, 60000);
})();
