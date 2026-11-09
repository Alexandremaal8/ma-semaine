/* EPFL Calendar — UI */
(function () {
'use strict';
const L = self.Semaine;
const { DAYS, DAYS_S, MONTHS, MONTHS_L, MODE_ORDER, MODE_META, MODE_DEFAULTS, clone, fmt, parseT, hm, addDays, iso, fromIso, mondayOf, dateLbl, uid, dow, subjOf } = L;
const WORKER = (self.WORKER_URL || '').replace(/\/$/, '');
const LS = 'ma-semaine-epfl-v2';
const MODE_COLORS = { chill: '#1C76A6', normal: '#2E7A55', charbon: '#E2510E', avance: '#0F766E', rattrapage: '#B7791F', exam: '#C8102E', recup: '#6A58B3' };
const wkOf = di => iso(mondayOf(fromIso(di)));
const cfgOf = wk => L.weekCfg(state, fromIso(wk));
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
    if (state.widgetToken) await post('/agenda', { token: state.widgetToken, mode: MODE_META[cfgOf(iso(mondayOf(new Date()))).mode].name, agenda: L.buildAgenda(state, new Date(), 3) });
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
$('#shBody').addEventListener('submit', e => { e.preventDefault(); if (sheetSubmit) { L.freezePast(state); const fd = Object.fromEntries(new FormData(e.target).entries()); if (sheetSubmit(fd, e.submitter) !== false) closeSheet(); } });

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
  const r = state.routines.find(x => x.id === id) || { id: null, day: 5, start: 600, end: 660, title: '', kind: 'other' };
  openSheet(r.id ? 'Modifier la routine' : 'Nouvelle routine', `<div class="fields">
    ${F.seg('kind', 'Type', [['sport', 'Sport'], ['other', 'Autre']], r.kind || 'other')}
    ${F.text('title', 'Quoi', r.title, 'full', 'ex. Courses + lessive')}
    ${F.select('day', 'Jour', dayOpts, r.day)}
    ${F.time('start', 'Début', r.start)}${F.time('end', 'Fin', r.end)}
  </div><p class="hint" style="margin-top:10px">Le sport doit faire entre 2h et 3h au total par semaine, quel que soit le mode.</p>${actions(!!r.id)}`, (fd, btn) => {
    const others = state.routines.filter(x => x.id !== r.id);
    const sportOf = list => list.filter(x => x.kind === 'sport').reduce((a, x) => a + x.end - x.start, 0);
    if (isDel(btn)) {
      if (r.kind === 'sport' && sportOf(others) < L.SPORT_MIN) { toast('Il faut garder au moins 2h de sport par semaine'); return false; }
      state.routines = others; return done();
    }
    const t = timesOk(fd); if (!t) return false;
    const obj = { id: r.id || uid(), day: +fd.day, start: t[0], end: t[1], title: fd.title.trim() || (fd.kind === 'sport' ? 'Sport' : 'Routine'), kind: fd.kind === 'sport' ? 'sport' : 'other' };
    const total = sportOf(others.concat([obj]));
    if (total < L.SPORT_MIN || total > L.SPORT_MAX) { toast('Sport : ' + hm(total) + ' par semaine. Il faut entre 2h et 3h.'); return false; }
    if (r.id) Object.assign(r, obj); else state.routines.push(obj);
    return done();
  });
}
function editSubject(id) {
  const s = state.subjects.find(x => x.id === id) || { id: null, name: '', color: SUBJ_COLORS[state.subjects.length % SUBJ_COLORS.length], prio: 2, exam: '', serie: 120, corr: 30 };
  openSheet(s.id ? s.name : 'Nouvelle matière', `<div class="fields">
    ${F.text('name', 'Nom', s.name, 'full', 'ex. Analyse I')}
    ${F.colors('color', s.color)}
    ${F.select('serie', 'Temps pour finir la série de la semaine', [[0, 'Pas de série'], [60, '1h'], [90, '1h30'], [120, '2h'], [150, '2h30'], [180, '3h'], [240, '4h'], [300, '5h']], s.serie)}
    ${F.select('corr', 'Vérifier la série avec la correction', [[0, 'Non'], [15, '15 min'], [20, '20 min'], [30, '30 min'], [45, '45 min'], [60, '1h']], s.corr == null ? 30 : s.corr)}
    ${F.seg('prio', 'Importance pour les révisions', [[1, 'Faible'], [2, 'Normale'], [3, 'Haute']], s.prio)}
    ${F.date('exam', 'Date d’examen (laisse vide si tu ne sais pas)', s.exam)}
  </div>${actions(!!s.id)}`, (fd, btn) => {
    if (isDel(btn)) {
      if (btn.dataset.sure !== '1') { btn.dataset.sure = '1'; btn.textContent = 'Confirmer ?'; toast('Ses cours seront aussi supprimés'); return false; }
      state.subjects = state.subjects.filter(x => x.id !== s.id); state.courses = state.courses.filter(c => c.subj !== s.id); return done();
    }
    const obj = { id: s.id || uid(), name: fd.name.trim() || 'Matière', color: fd.color || s.color, prio: +fd.prio || 2, exam: fd.exam || '', serie: +fd.serie || 0, corr: +fd.corr || 0 };
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
function weekendOff(wk) {
  const sat = iso(addDays(fromIso(wk), 5)), sun = iso(addDays(fromIso(wk), 6));
  const on = state.offDays.includes(sat) && state.offDays.includes(sun);
  state.offDays = state.offDays.filter(x => x !== sat && x !== sun);
  if (!on) state.offDays.push(sat, sun);
  toast(on ? 'Week-end off annulé' : 'Week-end off : la semaine s’adapte'); done();
}
function toggleOff(di) {
  const i = state.offDays.indexOf(di);
  if (i >= 0) { state.offDays.splice(i, 1); toast('Jour off annulé'); }
  else { state.offDays.push(di); toast('Jour off : le reste de la semaine s’adapte'); }
  done();
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
  const isOff = state.offDays.includes(calSel);
  const O = (act, color, title, sub) => `<button type="button" class="mopt" data-act="${act}" data-v="${calSel}" style="--m:${color}"><span class="sw8"></span><span><b>${title}</b><small>${sub}</small></span></button>`;
  openSheet('Ajouter le ' + dateLbl(fromIso(calSel)), `<div class="modes">
    ${O('newEvent', 'var(--acc)', 'Un événement', 'Soirée, rendez-vous, match… Les révisions de ce créneau sont replacées ailleurs.')}
    ${O('newMock', '#DB2777', 'Un examen blanc', 'Facultatif, mais la matière passe en priorité les jours d’avant.')}
    ${O('offDay', 'var(--faint)', isOff ? 'Annuler le jour off' : 'Un jour off', 'Aucune étude ce jour-là, le travail va sur les autres jours.')}
    ${O('newTrip', '#0F766E', 'Un voyage', 'Pas d’étude les jours de départ et retour, très peu pendant. L’app t’aide à partir avec de l’avance.')}
    ${O('newExam', 'var(--exam)', 'Un examen', 'La matière passe en priorité quand l’examen approche.')}
  </div>`);
}
function editMock(id, date) {
  const x = (state.mocks || []).find(e => e.id === id) || { id: null, subj: (state.subjects[0] || {}).id, date: date || calSel, start: 495, end: 600, place: '' };
  openSheet(x.id ? 'Examen blanc' : 'Nouvel examen blanc', `<div class="fields">
    ${F.select('subj', 'Matière', subjOpts(), x.subj)}
    ${F.date('date', 'Jour', x.date)}
    ${F.time('start', 'Début', x.start)}${F.time('end', 'Fin', x.end)}
    ${F.text('place', 'Où (facultatif)', x.place)}
  </div><p class="hint" style="margin-top:10px">Facultatif, mais t’as envie d’être prêt : la matière reçoit plus de révisions dans les jours d’avant, et tu as un rappel la veille.</p>${actions(!!x.id)}`, (fd, btn) => {
    if (isDel(btn)) { state.mocks = state.mocks.filter(e => e.id !== x.id); return done(); }
    const t = timesOk(fd); if (!t) return false;
    if (!fd.date) { toast('Choisis un jour'); return false; }
    const obj = { id: x.id || uid(), subj: fd.subj, date: fd.date, start: t[0], end: t[1], place: fd.place.trim() };
    if (x.id) Object.assign(x, obj); else state.mocks.push(obj);
    calSel = obj.date; return done();
  });
}
function editTrip(id, date) {
  const x = (state.trips || []).find(e => e.id === id) || { id: null, title: '', from: date || calSel, to: iso(addDays(fromIso(date || calSel), 7)), light: 60 };
  openSheet(x.id ? x.title || 'Voyage' : 'Nouveau voyage', `<div class="fields">
    ${F.text('title', 'Où', x.title, 'full', 'ex. Liban')}
    ${F.date('from', 'Départ', x.from, '')}${F.date('to', 'Retour', x.to, '')}
    ${F.seg('light', 'Étude par jour sur place', [[0, 'Rien'], [30, '30 min'], [60, '1h'], [90, '1h30']], x.light)}
  </div>
  <div class="rec" style="margin-top:14px"><b>Comment l’app s’organise :</b><br>• les 3 semaines avant le départ, elle te conseille le mode <b>Avance</b> pour partir en ayant révisé ;<br>• le jour du départ et du retour : aucune étude ;<br>• sur place : juste le temps choisi, le matin ;<br>• au retour, s’il y a des examens dans les 8 semaines : mode <b>Exam</b> conseillé.</div>
  ${actions(!!x.id)}`, (fd, btn) => {
    if (isDel(btn)) { state.trips = state.trips.filter(e => e.id !== x.id); return done(); }
    if (!fd.from || !fd.to || fd.to < fd.from) { toast('Le retour doit être après le départ'); return false; }
    const obj = { id: x.id || uid(), title: fd.title.trim() || 'Voyage', from: fd.from, to: fd.to, light: +fd.light || 0 };
    if (x.id) Object.assign(x, obj); else state.trips.push(obj);
    calSel = obj.from; toast('Voyage ajouté. Ajoute tes dates d’examen pour que l’app prépare le retour.'); return done();
  });
}
function modeSheet(wk) {
  wk = wk || wkOf(selDate);
  const cfg = cfgOf(wk), rec = L.recommendMode(state, fromIso(wk));
  openSheet('Semaine du ' + dateLbl(fromIso(wk)), `
    ${rec ? `<div class="rec"><b>Conseil : mode ${MODE_META[rec.mode].name}.</b> ${esc(rec.why)}</div>` : ''}
    <div class="group" style="margin-bottom:12px"><label class="row-sw"><span class="bd"><span class="ti">J’ai cours cette semaine</span><span class="su">Sinon : semaine de travail sans cours, ni séries</span></span><input type="checkbox" class="sw" data-courses="${wk}" ${cfg.coursesOn ? 'checked' : ''}${cfg.tripDays >= 3 ? ' disabled' : ''}></label></div>
    <div class="modes" role="radiogroup">${MODE_ORDER.map(k => `<button type="button" class="mopt" role="radio" aria-checked="${k === cfg.mode}" data-act="setMode" data-v="${k}" data-w="${wk}" style="--m:${MODE_COLORS[k]}"><span class="sw8"></span><span><b>${MODE_META[k].name}${rec && rec.mode === k ? ' <em class="badge">conseillé</em>' : ''}</b><small>${esc(MODE_META[k].tag)}</small></span></button>`).join('')}</div>
    <div class="day-actions"><button type="button" class="linkbtn" data-act="weekendOff" data-v="${wk}">${state.offDays.includes(iso(addDays(fromIso(wk), 5))) && state.offDays.includes(iso(addDays(fromIso(wk), 6))) ? 'Annuler le week-end off' : 'Prendre le week-end off'}</button><button type="button" class="linkbtn" data-act="tuneMode" data-v="${cfg.mode}">Ajuster le mode ${esc(MODE_META[cfg.mode].name)}</button></div>
    <p class="hint" style="text-align:center;margin-top:12px">Tu peux changer en pleine semaine : ce qui est passé ne bouge pas, seul ce qui reste s’adapte.</p>`);
}
function tuneMode(mk) {
  mk = MODE_ORDER.includes(mk) ? mk : cfgOf(wkOf(selDate)).mode;
  const m = state.modes[mk];
  const share = [[0, 'Off'], [0.5, 'Léger'], [1, 'Normal']];
  const near = v => share.reduce((a, b) => Math.abs(b[0] - v) < Math.abs(a[0] - v) ? b : a)[0];
  openSheet('Mode ' + MODE_META[mk].name, `<p class="hint" style="margin:-4px 0 12px;padding:0">Tu choisis le total de la semaine, l’app le répartit toute seule selon le temps libre de chaque jour. Les séries passent toujours en premier.</p><div class="fields">
    ${F.select('week', 'Étude par semaine (en plus des cours)', [240, 360, 480, 600, 720, 900, 1080, 1200, 1440, 1680, 1920, 2100, 2400].map(v => [v, hm(v)]), m.week)}
    ${F.seg('sat', 'Samedi', share, near(m.sat), '')}${F.seg('sun', 'Dimanche', share, near(m.sun), '')}
  </div>
  <details class="more" style="margin-top:14px;border:0"><summary style="padding:8px 2px">Plus de réglages</summary><div class="fields">
    ${F.select('block', 'Durée d’un bloc', [25, 30, 45, 50, 60, 75, 90].map(v => [v, v + ' min']), m.block, '')}
    ${F.select('pause', 'Pause entre blocs', [5, 10, 15, 20].map(v => [v, v + ' min']), m.pause, '')}
    ${F.select('freeEve', 'Temps libre le soir', [45, 60, 90, 120, 150, 180].map(v => [v, hm(v)]), m.freeEve, '')}
    ${F.select('ext', 'Rattrapage max par soir', [0, 30, 45, 60, 75, 90].map(v => [v, v ? v + ' min' : 'Jamais']), m.ext, '')}
  </div></details>
  <div class="sh-actions"><button type="submit" class="btn" value="reset">Par défaut</button><button type="submit" class="btn pri" value="save">Enregistrer</button></div>`, (fd, btn) => {
    if (btn && btn.value === 'reset') { state.modes[mk] = clone(MODE_DEFAULTS[mk]); toast('Mode remis par défaut'); return done(); }
    for (const k of ['week', 'sat', 'sun', 'block', 'pause', 'freeEve', 'ext']) if (fd[k] != null && fd[k] !== '') m[k] = +fd[k];
    return done();
  });
}
function hoursSheet() {
  openSheet('Horaires', `<p class="hint" style="margin:-4px 0 12px;padding:0">Les mêmes dans tous les modes.</p><div class="fields">
    ${F.time('wake', 'Réveil lun–ven', state.wake)}${F.time('sleep', 'Coucher (sauf samedi)', state.sleep)}
    ${F.time('wakeWE', 'Réveil week-end', state.wakeWE)}${F.time('sleepSat', 'Coucher samedi soir', state.sleepSat % 1440)}
  </div>${actions(false)}`, fd => {
    for (const k of ['wake', 'sleep', 'wakeWE', 'sleepSat']) { let v = parseT(fd[k]); if (v == null) continue; if (k.startsWith('sleep') && v < 240) v += 1440; state[k] = v; }
    return done();
  });
}
function weekSheet() {
  const ws = mondayOf(fromIso(selDate)), key = iso(ws);
  const days = L.generate(state, ws), sm = L.summarize(state, days, key);
  const pct = sm.plan ? Math.round(sm.dn / sm.plan * 100) : 0;
  const max = Math.max(1, ...Object.values(sm.per).map(x => x.plan));
  const alerts = [];
  const M = days.meta;
  if (M.mustLeftAfter >= 15) alerts.push(hm(M.mustLeftAfter) + ' de séries ne rentrent plus cette semaine. Elles passeront à la semaine prochaine, ou passe en mode Rattrapage.');
  if (M.unplaced >= 30) alerts.push('Pas assez de temps libre pour tout : ' + hm(M.unplaced) + ' d’étude ne rentrent pas.');
  if (M.sportMin < L.SPORT_MIN || M.sportMin > L.SPORT_MAX) alerts.push('Sport : ' + hm(M.sportMin) + ' par semaine. Il en faut entre 2h et 3h (Ma semaine → Routines).');
  if (sm.sleepAvg < 450) alerts.push('Moins de 7h30 de sommeil par nuit en moyenne.');
  if (M.cfg.mode === 'exam' && !state.subjects.some(s => s.exam)) alerts.push('Ajoute tes dates d’examen (Calendrier → +) pour que le mode Exam sache quoi prioriser.');
  if (M.cfg.mode === 'exam' && M.cfg.coursesOn) alerts.push('Pendant la session, coupe « J’ai cours cette semaine » (touche le mode en haut à droite).');
  openSheet('Semaine du ' + dateLbl(ws), `<div class="stats">
      <div class="stat"><div class="k">Étude faite</div><div class="v">${pct}%</div><div class="hint" style="padding:0">${hm(sm.dn)} sur ${hm(sm.plan)}</div></div>
      <div class="stat${M.lateMin ? ' warn' : ''}"><div class="k">Pas fait (replacé)</div><div class="v">${hm(M.lateMin)}</div></div>
      <div class="stat${sm.sleepAvg < 450 ? ' warn' : ''}"><div class="k">Sommeil moyen</div><div class="v">${hm(sm.sleepAvg)}</div></div>
      <div class="stat"><div class="k">Sport prévu</div><div class="v">${hm(sm.sport)}</div></div>
    </div>
    ${alerts.map(a => `<div class="alert">${esc(a)}</div>`).join('')}
    <div class="sec-t" style="margin-top:20px">Par matière</div>
    <div class="group" style="padding:2px 14px">${state.subjects.map(s => { const p = sm.per[s.id] || { plan: 0, done: 0 }; return `<div class="subrow" style="--c:${esc(s.color)}"><span>${esc(s.name)}</span><span class="num">${p.done ? hm(p.done) : '0'} / ${hm(p.plan)}</span><span class="bar"><b style="width:${p.plan / max * 100}%"></b><i style="width:${p.done / max * 100}%"></i></span></div>`; }).join('')}</div>`);
}
function done() { save(); renderAll(); return true; }

/* ---------- Aujourd'hui ---------- */
function renderToday() {
  const sel = fromIso(selDate), ws = mondayOf(sel), key = iso(ws);
  const days = L.generate(state, ws), sm = L.summarize(state, days, key);
  const wmode = days.meta.cfg.mode;
  document.body.dataset.mode = wmode;
  const day = days[dow(sel)];
  const isToday = selDate === todayIso();
  const now = new Date(), mins = now.getHours() * 60 + now.getMinutes();
  const isPastDay = sel < fromIso(todayIso());
  const we = addDays(ws, 6);
  $('#tEyebrow').textContent = isToday ? 'Aujourd’hui' : (Math.abs(sel - fromIso(todayIso())) === 864e5 ? (sel > fromIso(todayIso()) ? 'Demain' : 'Hier') : 'Semaine du ' + ws.getDate() + (ws.getMonth() !== we.getMonth() ? ' ' + MONTHS[ws.getMonth()] : '') + ' au ' + dateLbl(we));
  $('#tTitle').textContent = DAYS[dow(sel)] + ' ' + sel.getDate() + ' ' + MONTHS[sel.getMonth()];
  $('#modePill').innerHTML = `<span class="dot"></span>${MODE_META[wmode].name}${days.meta.cfg.coursesOn ? '' : ' · sans cours'}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>`;
  $('#strip').innerHTML = `<button type="button" class="arr" data-act="wk" data-v="-7" aria-label="Semaine précédente">‹</button><div class="days" role="tablist">${days.map(d => {
    const di = iso(d.date);
    return `<button type="button" role="tab" class="sd${di === todayIso() ? ' today' : ''}" aria-selected="${di === selDate}" data-act="pick" data-v="${di}"><span class="l">${DAYS_S[d.d]}</span><span class="n">${d.date.getDate()}</span><span class="p"><i style="width:${d.plan ? d.dn / d.plan * 100 : 0}%"></i></span></button>`;
  }).join('')}</div><button type="button" class="arr" data-act="wk" data-v="7" aria-label="Semaine suivante">›</button>`;

  const main = day.ev;
  const M = days.meta;
  let hero = '';
  if (day.trip) hero = `<div class="hero quiet"><div class="k">${day.tripEdge ? 'Jour de voyage' : 'En voyage'}</div><div class="t">${esc(day.trip.title || 'Voyage')}</div><div class="s">${day.tripEdge ? 'Pas d’étude aujourd’hui. Bon voyage !' : day.plan ? 'Juste ' + hm(day.plan) + ' de révision le matin, le reste du temps est à toi.' : 'Profite, pas d’étude.'}</div></div>`;
  else if (day.off) hero = `<div class="hero quiet"><div class="k">Jour off</div><div class="t">Repos aujourd’hui</div><div class="s">Le travail de ce jour est réparti sur le reste de la semaine.</div></div>`;
  else if (isToday) {
    const cur = main.find(e => !MINOR.has(e.kind) && e.start <= mins && mins < e.end) || main.find(e => e.start <= mins && mins < e.end);
    const nxt = main.find(e => e.start > mins && !MINOR.has(e.kind));
    if (cur) {
      const p = Math.round((mins - cur.start) / (cur.end - cur.start) * 100);
      hero = `<div class="hero"><div class="k">Maintenant · encore ${hm(cur.end - mins)}</div><div class="t">${esc(cur.title)}</div><div class="s">${esc(cur.sub || '')}</div><div class="bar"><i style="width:${p}%"></i></div>${nxt ? `<div class="next"><span class="num">${fmt(nxt.start)}</span><span>Ensuite <b>${esc(nxt.title)}</b></span></div>` : ''}</div>`;
    } else if (nxt) hero = `<div class="hero"><div class="k">Prochain · dans ${hm(nxt.start - mins)}</div><div class="t">${esc(nxt.title)}</div><div class="s"><span class="num">${fmt(nxt.start)}–${fmt(nxt.end)}</span>${nxt.sub ? ' · ' + esc(nxt.sub) : ''}</div></div>`;
    else hero = `<div class="hero quiet"><div class="k">C’est fini pour aujourd’hui</div><div class="t">Bonne soirée</div><div class="s">Au lit vers ${fmt(day.sleep)}.</div></div>`;
  }
  let late = '';
  const thisWeek = iso(mondayOf(new Date())) === key;
  if (thisWeek && M.mustLeftAfter >= 15) late = `<div class="notice warn"><span><b>${hm(M.mustLeftAfter)} de séries ne rentrent plus</b> cette semaine.${wmode !== 'rattrapage' ? ' Le mode Rattrapage peut t’aider.' : ' Elles passeront à la semaine prochaine.'}</span>${wmode !== 'rattrapage' ? `<button type="button" data-act="setMode" data-v="rattrapage" data-w="${key}">Rattrapage</button>` : ''}</div>`;
  // weekly check-in: Sunday evening for next week, or Monday if this week's mode was never chosen
  let pickWeek = '';
  if (isToday) {
    const dw = dow(now);
    const target = dw === 6 && now.getHours() >= 16 ? iso(addDays(ws, 7)) : (dw <= 1 && !M.cfg.chosen ? key : null);
    if (target) {
      const tc = cfgOf(target), rec = L.recommendMode(state, fromIso(target));
      const chosen = tc.chosen;
      pickWeek = `<div class="pickweek"><div class="k">${target === key ? 'Cette semaine' : 'Semaine prochaine'} · du ${dateLbl(fromIso(target))}</div>
        <b>${chosen ? 'Mode ' + MODE_META[tc.mode].name + ' choisi ✓' : 'Quel mode tu veux ?'}</b>
        ${rec ? `<p>Conseil : <b>${MODE_META[rec.mode].name}</b>. ${esc(rec.why)}</p>` : ''}
        <div class="chipsel">${MODE_ORDER.map(k => `<button type="button" class="chipm${tc.mode === k && chosen ? ' on' : ''}${rec && rec.mode === k ? ' rec' : ''}" data-act="setMode" data-v="${k}" data-w="${target}" style="--m:${MODE_COLORS[k]}">${MODE_META[k].name}</button>`).join('')}</div>
        <label class="row-sw" style="padding:10px 0 0;border:0"><span class="bd"><span class="ti">J’ai cours cette semaine-là</span></span><input type="checkbox" class="sw" data-courses="${target}" ${tc.coursesOn ? 'checked' : ''}${tc.tripDays >= 3 ? ' disabled' : ''}></label></div>`;
    }
  }
  // advice before a trip or after it (once per week, only if the current mode differs)
  let advice = '';
  if (thisWeek && M.mustAllDone && !pickWeek) {
    const weOff = state.offDays.includes(iso(addDays(ws, 5))) && state.offDays.includes(iso(addDays(ws, 6)));
    advice = `<div class="notice"><span><b>Toutes tes séries de la semaine sont faites.</b> Tu peux continuer, ou lever le pied.</span>${wmode !== 'chill' ? `<button type="button" data-act="setMode" data-v="chill" data-w="${key}">Chill</button>` : ''}${weOff ? '' : `<button type="button" data-act="weekendOff" data-v="${key}">Week-end off</button>`}</div>`;
  }
  const recNow = thisWeek ? L.recommendMode(state, ws) : null;
  if (recNow && recNow.mode !== wmode && !pickWeek && !advice) advice = `<div class="notice"><span><b>Conseil : mode ${MODE_META[recNow.mode].name}.</b> ${esc(recNow.why)}</span><button type="button" data-act="setMode" data-v="${recNow.mode}" data-w="${key}">Passer</button></div>`;
  else if (thisWeek && M.lateMin >= 15) late = `<div class="notice"><span><b>${hm(M.lateMin)} pas faits</b> cette semaine : c’est déjà replacé${M.extended ? ', avec ' + hm(M.extended) + ' de rattrapage' : ''}.</span></div>`;
  const st = main.filter(e => e.kind === 'study'), stDone = st.filter(e => e.state === 'done');
  const prog = st.length ? `<div class="prog"><span><b>${stDone.length}/${st.length}</b> blocs</span><span class="track"><i style="width:${stDone.length / st.length * 100}%"></i></span><span class="num">${hm(day.dn)} / ${hm(day.plan)}</span></div>` : '';
  const notice = !state.notif.on && isToday ? `<div class="notice"><span>Les rappels sont coupés.</span><button type="button" data-act="goSet">Activer</button></div>` : '';

  const rows = [`<div class="it k-minor"><span class="tm">${fmt(day.wake)}</span><span class="minor">Réveil</span></div>`];
  for (const e of main) {
    if (MINOR.has(e.kind)) { rows.push(`<div class="it k-minor"><span class="tm">${fmt(e.start)}</span><span class="minor">${esc(e.title)}</span></div>`); continue; }
    const su = e.subj ? subjOf(state, e.subj) : null;
    const isDone = e.kind === 'study' ? e.state === 'done' : !!sm.done[e.id];
    const can = e.kind === 'study' || e.kind === 'sport';
    const cls = ['it', 'k-' + e.kind];
    if (isToday && e.start <= mins && mins < e.end) cls.push('now');
    if (e.state === 'missed') cls.push('missed');
    else if ((isToday && e.end <= mins) || isPastDay) cls.push('past');
    if (isDone) cls.push('done');
    const tags = (e.state === 'missed' ? '<span class="tag">pas fait · replacé</span>' : '') + (e.late && e.state !== 'done' ? '<span class="tag">semaine passée</span>' : '') + (e.catchup && e.state !== 'done' ? '<span class="tag cu">rattrapage</span>' : '');
    rows.push(`<div class="${cls.join(' ')}"${su ? ` style="--c:${esc(su.color)}"` : ''}><span class="tm">${fmt(e.start)}<small>${fmt(e.end)}</small></span>
      <div class="card"><div class="bd"><div class="ti">${esc(e.title)}${tags}</div>${e.sub ? `<div class="su">${esc(e.sub)}</div>` : ''}</div>
      ${can ? `<button type="button" class="chk" data-act="done" data-w="${key}" data-v="${e.id}" aria-pressed="${isDone}" aria-label="Fait : ${esc(e.title)}">${CHECK}</button>` : ''}</div></div>`);
  }
  $('#todayBody').innerHTML = `${pickWeek}${hero}${late}${advice}${notice}${prog}<div class="tl">${rows.join('')}</div>
    <div class="endday">Au lit ${fmt(day.sleep)}</div>
    <div class="day-actions">${day.trip ? '' : `<button type="button" class="linkbtn" data-act="offDay" data-v="${selDate}">${day.off ? 'Annuler le jour off' : 'Prendre ce jour off'}</button>`}<button type="button" class="linkbtn" data-act="weekSheet">Bilan de la semaine</button></div>`;
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
    if (state.offDays.includes(di)) dots.push('<i class="i-off"></i>');
    if (L.tripOn(state, di)) dots.push('<i class="i-trip"></i>');
    if ((state.mocks || []).some(x => x.date === di)) dots.push('<i class="i-mock"></i>');
    if (state.subjects.some(s => s.exam === di)) dots.push('<i class="i-ex"></i>');
    cells.push(`<button type="button" class="cell${d.getMonth() !== mo ? ' out' : ''}${di === todayIso() ? ' today' : ''}" data-act="calday" data-v="${di}" aria-selected="${di === calSel}" aria-label="${longDate(d)}"><span class="n">${d.getDate()}</span><span class="dots">${dots.join('')}</span></button>`);
  }
  const items = [];
  state.subjects.filter(s => s.exam === calSel).forEach(s => items.push(`<button type="button" class="li" data-act="editExam" data-v="${esc(s.id)}" style="--c:var(--exam)"><span class="dt"></span><span class="bd"><span class="ti">Examen · ${esc(s.name)}</span></span>${CHEV}</button>`));
  const tr = L.tripOn(state, calSel);
  if (tr) items.push(`<button type="button" class="li" data-act="editTrip" data-v="${esc(tr.trip.id)}" style="--c:#0F766E"><span class="dt"></span><span class="bd"><span class="ti">${esc(tr.trip.title || 'Voyage')}</span><span class="su">Du ${dateLbl(fromIso(tr.trip.from))} au ${dateLbl(fromIso(tr.trip.to))}${tr.edge ? ' · jour de voyage' : ''}</span></span>${CHEV}</button>`);
  (state.mocks || []).filter(x => x.date === calSel).forEach(x => { const su = subjOf(state, x.subj); items.push(`<button type="button" class="li" data-act="editMock" data-v="${esc(x.id)}" style="--c:#DB2777"><span class="dt"></span><span class="bd"><span class="ti">Examen blanc · ${esc(su ? su.name : '')}</span><span class="su">Facultatif${x.place ? ' · ' + esc(x.place) : ''}</span></span><span class="rt">${fmt(x.start)}<br>${fmt(x.end)}</span>${CHEV}</button>`); });
  if (state.offDays.includes(calSel)) items.push(`<button type="button" class="li" data-act="offDay" data-v="${calSel}" style="--c:var(--faint)"><span class="dt"></span><span class="bd"><span class="ti">Jour off</span><span class="su">Touche pour annuler</span></span></button>`);
  state.events.filter(x => x.date === calSel).sort((a, b) => a.start - b.start).forEach(x => items.push(`<button type="button" class="li" data-act="editEvent" data-v="${esc(x.id)}" style="--c:var(--acc)"><span class="dt"></span><span class="bd"><span class="ti">${esc(x.title)}</span>${x.place ? `<span class="su">${esc(x.place)}</span>` : ''}</span><span class="rt">${fmt(x.start)}<br>${fmt(x.end)}</span>${CHEV}</button>`));
  const sel = fromIso(calSel);
  $('#calBody').innerHTML = `
    <div class="cal-h"><button type="button" data-act="calm" data-v="-1" aria-label="Mois précédent">‹</button><b>${MONTHS_L[mo]} ${y}</b><button type="button" data-act="calm" data-v="1" aria-label="Mois suivant">›</button></div>
    <div class="cal">${DAYS_S.map(n => `<span class="wd">${n}</span>`).join('')}${cells.join('')}</div>
    <div class="legend"><span><i class="i-ev"></i>Événement</span><span><i class="i-off"></i>Off</span><span><i class="i-trip"></i>Voyage</span><span><i class="i-mock"></i>Exam blanc</span><span><i class="i-ex"></i>Examen</span></div>
    <div class="sec-t">${longDate(sel)}<button type="button" data-act="openDay">Voir la journée</button></div>
    <div class="group">${items.join('') || '<div class="empty">Rien d’ajouté ce jour-là. Touche + pour ajouter quelque chose.</div>'}</div>`;
}

/* ---------- Ma semaine type ---------- */
function renderWeek() {
  const byDay = DAYS.map((_, i) => state.courses.filter(c => c.day === i).sort((a, b) => a.start - b.start));
  const courseRows = byDay.map((list, i) => list.length ? `<div class="dayhead">${DAYS[i]}</div>` + list.map(c => { const s = subjOf(state, c.subj); return `<button type="button" class="li" data-act="editCourse" data-v="${c.id}" style="--c:${esc(s ? s.color : '')}"><span class="dt"></span><span class="bd"><span class="ti">${esc(s ? s.name : 'Cours')}</span><span class="su">${esc([c.type, c.room].filter(Boolean).join(' · '))}</span></span><span class="rt">${fmt(c.start)}<br>${fmt(c.end)}</span>${CHEV}</button>`; }).join('') : '').join('');
  const prioL = ['', 'Importance faible', 'Importance normale', 'Importance haute'];
  $('#weekBody').innerHTML = `
    ${(() => {
      const today = todayIso(), up = [];
      (state.trips || []).filter(t => t.to >= today).forEach(t => up.push([t.from, `<button type="button" class="li" data-act="editTrip" data-v="${esc(t.id)}" style="--c:#0F766E"><span class="dt"></span><span class="bd"><span class="ti">${esc(t.title)}</span><span class="su">Voyage · du ${dateLbl(fromIso(t.from))} au ${dateLbl(fromIso(t.to))}</span></span>${CHEV}</button>`]));
      (state.mocks || []).filter(t => t.date >= today).forEach(t => { const su = subjOf(state, t.subj); up.push([t.date, `<button type="button" class="li" data-act="editMock" data-v="${esc(t.id)}" style="--c:#DB2777"><span class="dt"></span><span class="bd"><span class="ti">Examen blanc · ${esc(su ? su.name : '')}</span><span class="su">${longDate(fromIso(t.date))} · ${fmt(t.start)}</span></span>${CHEV}</button>`]); });
      state.subjects.filter(su => su.exam && su.exam >= today).forEach(su => up.push([su.exam, `<button type="button" class="li" data-act="editExam" data-v="${esc(su.id)}" style="--c:var(--exam)"><span class="dt"></span><span class="bd"><span class="ti">Examen · ${esc(su.name)}</span><span class="su">${longDate(fromIso(su.exam))}</span></span>${CHEV}</button>`]));
      return up.length ? `<div class="sec-t" style="margin-top:18px">À venir</div><div class="group">${up.sort((a, b) => a[0].localeCompare(b[0])).map(x => x[1]).join('')}</div>` : '';
    })()}
    <div class="sec-t">Horaire<button type="button" data-act="editCourse">+ Cours</button></div>
    <div class="group">${courseRows || '<div class="empty">Aucun cours.</div>'}</div>
    <div class="sec-t">Matières<button type="button" data-act="editSubject">+ Matière</button></div>
    <div class="group">${state.subjects.map(s => `<button type="button" class="li" data-act="editSubject" data-v="${esc(s.id)}" style="--c:${esc(s.color)}"><span class="dt"></span><span class="bd"><span class="ti">${esc(s.name)}</span><span class="su">${s.serie ? 'Série ' + hm(s.serie) + (s.corr ? ' + correction ' + hm(s.corr) : '') : 'Pas de série'} · ${prioL[s.prio] || ''}${s.exam ? ' · examen le ' + dateLbl(fromIso(s.exam)) : ''}</span></span>${CHEV}</button>`).join('') || '<div class="empty">Aucune matière.</div>'}</div>
    <div class="sec-t">Routines<button type="button" data-act="editRoutine">+ Routine</button></div>
    ${(() => { const sp = L.sportMinutes(state); const ok = sp >= L.SPORT_MIN && sp <= L.SPORT_MAX; return `<p class="hint" style="margin:0 4px 8px;${ok ? '' : 'color:var(--warn);font-weight:650'}">Sport : ${hm(sp)} par semaine ${ok ? '(entre 2h et 3h, parfait)' : '· il faut entre 2h et 3h'}</p>`; })()}
    <div class="group">${state.routines.slice().sort((a, b) => a.day - b.day || a.start - b.start).map(r => `<button type="button" class="li" data-act="editRoutine" data-v="${r.id}" style="--c:${r.kind === 'sport' ? 'var(--ink)' : 'var(--faint)'}"><span class="dt"></span><span class="bd"><span class="ti">${esc(r.title)}</span><span class="su">${DAYS[r.day]}${r.kind === 'sport' ? ' · sport' : ''}</span></span><span class="rt">${fmt(r.start)}<br>${fmt(r.end)}</span>${CHEV}</button>`).join('') || '<div class="empty">Aucune routine.</div>'}</div>`;
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
  else status = `<div class="status"><b>Rappels coupés</b>Reçois un rappel avant tes cours, au début de tes blocs d’étude et avant tes examens.</div><div class="btns"><button type="button" class="btn pri full" data-act="notifOn">Activer les rappels</button></div>`;
  const T = (f, label, sub) => `<label class="row-sw"><span class="bd"><span class="ti">${label}</span>${sub ? `<span class="su">${sub}</span>` : ''}</span><input type="checkbox" class="sw" data-nf="${f}" ${N[f] ? 'checked' : ''}></label>`;
  $('#setBody').innerHTML = `
    <div class="sec-t">Rappels</div>
    <div class="group">${status}
      ${N.on ? `<details class="more"><summary>Choisir mes rappels</summary>
        <label class="row-sw"><span class="bd"><span class="ti">Avant un cours</span></span><select data-nfn="course" style="border:1px solid var(--line);border-radius:10px;padding:7px 10px;background:var(--bg)">${[0, 5, 10, 15, 30].map(v => `<option value="${v}"${N.course === v ? ' selected' : ''}>${v ? v + ' min avant' : 'Non'}</option>`).join('')}</select></label>
        ${T('study', 'Blocs d’étude', 'Au début de chaque bloc')}
        ${T('morning', 'Matin et soir', 'Programme du jour au réveil, bilan avant de dormir')}
        ${T('deadline', 'Examens', 'Une semaine avant et la veille')}
        ${T('sport', 'Sport, routines et événements', 'Juste avant')}
      </details>` : ''}
    </div>
    <div class="sec-t">Horaires</div>
    <div class="group"><button type="button" class="li" data-act="hoursSheet"><span class="bd"><span class="ti">Réveil ${fmt(state.wake)} · coucher ${fmt(state.sleep)}</span><span class="su">Du lundi au vendredi, dans tous les modes</span></span>${CHEV}</button></div>
    <div class="sec-t">Mode</div>
    ${(() => { const c = cfgOf(iso(mondayOf(new Date()))); return `<div class="group"><button type="button" class="li" data-act="modeSheet" style="--c:${MODE_COLORS[c.mode]}"><span class="dt"></span><span class="bd"><span class="ti">${MODE_META[c.mode].name}${c.coursesOn ? '' : ' · sans cours'}</span><span class="su">Mode de cette semaine · changer</span></span>${CHEV}</button>
      <button type="button" class="li" data-act="tuneMode" data-v="${c.mode}"><span class="bd"><span class="ti">Ajuster le mode ${MODE_META[c.mode].name}</span>`; })()}<span class="su">Heures d’étude par semaine, week-end, rattrapage</span></span>${CHEV}</button></div>
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
const MUTATING = new Set(['setMode', 'offDay', 'weekendOff', 'importDo']);
document.addEventListener('click', async e => {
  const nb = e.target.closest('.nav button'); if (nb) { showTab(nb.dataset.tab); return; }
  const b = e.target.closest('[data-act]'); if (!b || b.type === 'submit') return;
  const a = b.dataset.act, v = b.dataset.v;
  if (MUTATING.has(a)) L.freezePast(state);
  switch (a) {
    case 'closeSheet': closeSheet(); return;
    case 'pick': selDate = v; renderToday(); return;
    case 'wk': selDate = iso(addDays(fromIso(selDate), +v)); renderToday(); return;
    case 'done': {
      const wk = b.dataset.w, d = state.done[wk] = state.done[wk] || {};
      if (d[v]) delete d[v];
      else {
        const days = L.generate(state, fromIso(wk)); let ev = null;
        for (const x of days) { ev = x.ev.find(e => e.id === v); if (ev) break; }
        if (!ev) return;
        d[v] = ev.kind === 'study' ? { s: ev.subj, t: ev.title, m: ev.end - ev.start, d: +v.split('-')[0], a: ev.start, serie: ev.serie } : { k: ev.kind, m: ev.end - ev.start };
        b.setAttribute('aria-pressed', 'true'); b.classList.add('pop');
      }
      save(); setTimeout(() => keepScroll(() => { renderToday(); if (tab === 'cal') renderCal(); }), d[v] ? 420 : 0); return;
    }
    case 'offDay': toggleOff(v); closeSheet(); return;
    case 'weekendOff': weekendOff(v); closeSheet(); return;
    case 'hoursSheet': hoursSheet(); return;
    case 'modeSheet': modeSheet(b.dataset.w); return;
    case 'setMode': { const wk = b.dataset.w || wkOf(selDate); state.weekModes[wk] = v; if (wk >= iso(mondayOf(new Date()))) state.mode = v; save(); renderAll(); closeSheet(); toast('Mode ' + MODE_META[v].name + (wk === iso(mondayOf(new Date())) ? '' : ' pour la semaine du ' + dateLbl(fromIso(wk)))); return; }
    case 'tuneMode': tuneMode(v); return;
    case 'newMock': editMock(null, calSel); return;
    case 'editMock': editMock(v); return;
    case 'newTrip': editTrip(null, calSel); return;
    case 'editTrip': editTrip(v); return;
    case 'weekSheet': weekSheet(); return;
    case 'goSet': showTab('set'); return;
    case 'calm': calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + (+v), 1); renderCal(); return;
    case 'calday': calSel = v; keepScroll(renderCal); return;
    case 'openDay': selDate = calSel; showTab('today'); return;
    case 'addSheet': addSheet(); return;
    case 'newEvent': editEvent(null, calSel); return;
    case 'newExam': editExam(null, calSel); return;
    case 'editEvent': editEvent(v); return;
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
  if (t.dataset.courses) L.freezePast(state);
  if (t.dataset.courses) {
    const wk = t.dataset.courses; state.noCourseWeeks = state.noCourseWeeks.filter(x => x !== wk);
    if (!t.checked) state.noCourseWeeks.push(wk);
    if (!state.weekModes[wk]) state.weekModes[wk] = cfgOf(wk).mode;
    save(); renderToday(); renderSet(); toast(t.checked ? 'Semaine avec cours' : 'Semaine de travail sans cours'); return;
  }
  if (t.dataset.nf) { if (t.dataset.nf === 'sport') { state.notif.sport = state.notif.routine = t.checked; state.notif.event = t.checked ? 15 : 0; } else if (t.dataset.nf === 'morning') { state.notif.morning = state.notif.evening = t.checked; } else state.notif[t.dataset.nf] = t.checked; save(); return; }
  if (t.dataset.nfn) { state.notif[t.dataset.nfn] = +t.value; save(); }
});


/* ---------- bubble touch effect ---------- */
const BUB_SEL = '.chipm,.btn,.linkbtn,.li,.mopt,.mode-pill,.fab,.sd,.cell,.chk,.nav button,.notice button,.cal-h button,.strip .arr,.sec-t button';
document.addEventListener('pointerdown', e => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const el = e.target.closest(BUB_SEL); if (!el) return;
  const r = el.getBoundingClientRect(), size = Math.max(r.width, r.height) * 2.2;
  const b = document.createElement('span'); b.className = 'bub';
  b.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left}px;top:${e.clientY - r.top}px`;
  el.appendChild(b); setTimeout(() => b.remove(), 650);
}, { passive: true });

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
