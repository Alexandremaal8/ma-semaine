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
// which home-screen icon opened the app: the full app, or its Focus / Sport space
const APP = document.documentElement.dataset.app || 'main';
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
/* ---------- sync between your devices ---------- */
const KEY_LS = LS + '-key', UPD_LS = LS + '-upd';
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { } };
const syncKey = () => lsGet(KEY_LS);
const localUpdated = () => +(lsGet(UPD_LS) || 0);
let pulling = false;
async function pull(force) {
  const k = syncKey(); if (!WORKER || !k) return false;
  pulling = true;
  try {
    const r = await (await fetch(WORKER + '/store?k=' + k, { cache: 'no-store' })).json();
    if (r && r.state && (force || r.updated > localUpdated())) {
      const notifOn = state.notif.on;              // reminders are per device
      state = L.normalize(r.state); state.notif.on = notifOn;
      lsSet(LS, JSON.stringify(state)); lsSet(UPD_LS, String(r.updated));
      renderAll();
      return true;
    }
    if (r && !r.state && localUpdated()) pushState();
  } catch (e) { console.warn('pull', e); }
  finally { pulling = false; }
  return false;
}
async function pushState() {
  const k = syncKey(); if (!WORKER || !k) return;
  const upd = localUpdated() || Date.now();
  if (lsGet(LS + '-pushed') === k + ':' + upd) return;   // nothing new since the last send
  try {
    const r = await (await fetch(WORKER + '/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ k, updated: localUpdated() || Date.now(), state }) })).json();
    if (r && r.newer) await pull(true); else if (r && r.ok) lsSet(LS + '-pushed', k + ':' + upd);
  } catch (e) { console.warn('push', e); }
}
const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
const linkUrl = k => location.origin + location.pathname + '#lien-' + k;

function save() {
  const keys = Object.keys(state.done).sort();
  while (keys.length > 12) delete state.done[keys.shift()];
  try { localStorage.setItem(LS, JSON.stringify(state)); } catch (e) { }
  lsSet(UPD_LS, String(Date.now()));
  clearTimeout(syncTimer); syncTimer = setTimeout(syncAll, 2500);
}
async function getSub() {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager ? reg.pushManager.getSubscription() : null;
}
const post = (path, body) => fetch(WORKER + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
// sends a thing only if it changed (or after `maxMin` minutes), to stay well under the server's daily write quota
function sigOf(x) { const t = JSON.stringify(x); let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return t.length + ':' + h; }
function onceFor(name, payload, maxMin) {
  const key = LS + '-sent-' + name, sig = sigOf(payload), prev = (lsGet(key) || '').split('|');
  if (prev[0] === sig && Date.now() - +prev[1] < maxMin * 60e3) return false;
  lsSet(key, sig + '|' + Date.now()); return true;
}
async function syncAll() {
  if (!WORKER) return;
  if (syncKey() && !pulling) await pushState();
  try {
    if (state.widgetToken) { const body = { token: state.widgetToken, mode: MODE_META[cfgOf(iso(mondayOf(new Date()))).mode].name, agenda: L.buildAgenda(state, new Date(), 3) }; if (onceFor('agenda', body, 30)) await post('/agenda', body); }
  } catch (e) { console.warn('agenda', e); }
  const sub = state.notif.on ? await getSub().catch(() => null) : null;
  if (!sub) {
    // this device has no reminders (e.g. your PC): refresh the reminders of your other devices
    if (syncKey()) { const notifications = L.buildNotifications(state, new Date(), 14); if (onceFor('notifs', notifications, 360)) post('/notifs', { k: syncKey(), notifications }).catch(() => { }); }
    return;
  }
  try {
    const notifications = L.buildNotifications(state, new Date(), 14);
    if (!onceFor('sync', { e: sub.endpoint, notifications, k: syncKey() }, 360)) return;
    const r = await post('/sync', { subscription: sub.toJSON(), notifications, backup: onceFor('backup', 1, 1440) ? state : undefined, syncKey: syncKey() || undefined });
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
function closeSheet() { clearInterval(stretchTimer); if (ciOpen) { ciOpen = false; ciQueue = []; ciSkipUntil = Date.now() + 2 * 3600e3; setTimeout(() => { renderAll(); endChange(); }, 0); } $('#sheetBg').classList.remove('on'); document.body.style.overflow = ''; sheetSubmit = null; if (typeof sportRun !== 'undefined' && sportRun) setTimeout(renderSportBar, 50); }
$('#sheetBg').addEventListener('click', e => { if (e.target.id === 'sheetBg') closeSheet(); });
$('#shBody').addEventListener('submit', e => { e.preventDefault(); if (sheetSubmit) { beginChange(); const fd = Object.fromEntries(new FormData(e.target).entries()); if (sheetSubmit(fd, e.submitter) !== false) closeSheet(); } });

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
function editProject(id) {
  const p = (state.projects || []).find(x => x.id === id) || { id: null, subj: (state.subjects[0] || {}).id, title: '', from: todayIso(), to: '', hours: 15, group: true, sessions: [] };
  const sess = (p.sessions || []).map((ss, i) => `<button type="button" class="li" data-act="editSession" data-v="${esc(p.id || '')}" data-i="${i}"><span class="bd"><span class="ti">${ss.weekly ? 'Chaque ' + DAYS[dow(fromIso(ss.date))].toLowerCase() : dateLbl(fromIso(ss.date))} · ${fmt(ss.start)}–${fmt(ss.end)}</span><span class="su">${ss.weekly ? 'dès le ' + dateLbl(fromIso(ss.date)) : 'une fois'}${ss.place ? ' · ' + esc(ss.place) : ''}</span></span>${CHEV}</button>`).join('');
  openSheet(p.id ? p.title : 'Nouveau projet', `<div class="fields">
    ${F.text('title', 'Nom', p.title, 'full', 'ex. Mini-projet 2')}
    ${F.select('subj', 'Matière', subjOpts(), p.subj)}
    ${F.date('from', 'Début', p.from, '')}${F.date('to', 'À rendre le', p.to, '')}
    ${F.num('hours', 'Heures de travail en tout (environ)', p.hours, 'min="1" max="200" step="1"', 'full')}
  </div>
  ${p.id ? `<div class="sec-t" style="margin:16px 0 6px">Séances en binôme<button type="button" data-act="editSession" data-v="${esc(p.id)}" data-i="-1">+ Séance</button></div><div class="group">${sess || '<div class="empty">Ajoute vos créneaux communs : ils sont bloqués dans ton planning et comptent dans les heures du projet.</div>'}</div>` : ''}
  <p class="hint" style="margin-top:10px">L’app répartit les heures restantes jusqu’au rendu, chaque semaine, sans jamais prendre le temps de tes séries. Ce n’est pas un examen : pas de mode Exam pour ça.</p>${actions(!!p.id)}`, (fd, btn) => {
    const others = (state.projects || []).filter(x => x.id !== p.id);
    if (isDel(btn)) { state.projects = others; return done(); }
    if (!fd.from || !fd.to || fd.to < fd.from) { toast('Choisis un début et une date de rendu après le début'); return false; }
    const obj = { id: p.id || uid(), subj: fd.subj, title: String(fd.title || '').trim() || 'Projet', from: fd.from, to: fd.to, hours: Math.max(1, +fd.hours || 10), group: true, sessions: p.sessions || [] };
    state.projects = others.concat([obj]);
    const su = subjOf(state, obj.subj);
    if (su && su.exam && su.exam >= obj.from && su.exam <= obj.to) su.exam = '';   // the project replaces a placeholder "exam" date
    const isNew = !p.id; done(); if (isNew) setTimeout(() => editProject(obj.id), 400); return true;
  });
}
function editSession(pid, i) {
  const p = (state.projects || []).find(x => x.id === pid); if (!p) return;
  const ss = p.sessions[i] || { date: p.from > todayIso() ? p.from : todayIso(), start: 1035, end: 1140, weekly: true, place: '' };
  openSheet('Séance en binôme', `<div class="fields">
    ${F.date('date', i >= 0 && ss.weekly ? 'À partir du' : 'Jour', ss.date)}
    ${F.time('start', 'Début', ss.start)}${F.time('end', 'Fin', ss.end)}
    ${F.seg('weekly', 'Répéter', [['1', 'Chaque semaine'], ['0', 'Une fois']], ss.weekly ? '1' : '0')}
    ${F.text('place', 'Où (facultatif)', ss.place || '', 'full', 'ex. BC 07')}
  </div><p class="hint" style="margin-top:10px">Chaque semaine : jusqu’au rendu (${dateLbl(fromIso(p.to))}).</p>${actions(i >= 0)}`, (fd, btn) => {
    if (isDel(btn)) { p.sessions.splice(i, 1); done(); setTimeout(() => editProject(pid), 400); return true; }
    const t = timesOk(fd); if (!t) return false;
    if (!fd.date) { toast('Choisis un jour'); return false; }
    const obj = { date: fd.date, start: t[0], end: t[1], weekly: fd.weekly === '1', place: String(fd.place || '').trim() };
    if (i >= 0) p.sessions[i] = obj; else p.sessions.push(obj);
    done(); setTimeout(() => editProject(pid), 400); return true;
  });
}
function editWeekly(id) {
  const t = (state.weekly || []).find(x => x.id === id) || { id: null, subj: (state.subjects[0] || {}).id, title: '', minutes: 60, before: 2 };
  openSheet(t.id ? 'Modifier la tâche' : 'Nouvelle tâche de la semaine', `<div class="fields">
    ${F.text('title', 'Quoi', t.title, 'full', 'ex. MOOC de prog')}
    ${F.select('subj', 'Matière', subjOpts(), t.subj)}
    ${F.num('minutes', 'Durée (min)', t.minutes, 'min="15" max="600" step="15"')}
    ${F.select('before', 'À finir avant', [[1, 'Mardi'], [2, 'Mercredi'], [3, 'Jeudi'], [4, 'Vendredi'], [5, 'Samedi'], [6, 'Dimanche'], [7, 'Fin de semaine']], t.before)}
  </div><p class="hint" style="margin-top:10px">L’app la place chaque semaine dans tes premiers créneaux libres avant ce jour, et la redécale si tu la rates.</p>${actions(!!t.id)}`, (fd, btn) => {
    const others = (state.weekly || []).filter(x => x.id !== t.id);
    if (isDel(btn)) { state.weekly = others; return done(); }
    const title = String(fd.title || '').trim() || 'Tâche';
    state.weekly = others.concat([{ id: t.id || uid(), subj: fd.subj, title, minutes: Math.max(15, +fd.minutes || 60), before: +fd.before }]);
    return done();
  });
}
function editRoutine(id) {
  const r = state.routines.find(x => x.id === id) || { id: null, day: 5, start: 600, end: 660, title: '', kind: 'other' };
  openSheet(r.id ? 'Modifier la routine' : 'Nouvelle routine', `<div class="fields">
    ${F.seg('kind', 'Type', [['sport', 'Sport'], ['study', 'Étude fixe'], ['other', 'Autre']], r.kind || 'other')}
    ${F.select('subj', 'Matière (si étude fixe)', subjOpts(), r.subj || (state.subjects[0] || {}).id)}
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
    const obj = { id: r.id || uid(), day: +fd.day, start: t[0], end: t[1], title: fd.title.trim() || (fd.kind === 'sport' ? 'Sport' : fd.kind === 'study' ? 'Étude' : 'Routine'), kind: ['sport', 'study'].includes(fd.kind) ? fd.kind : 'other', subj: fd.kind === 'study' ? fd.subj : '' };
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
  done();
}
function toggleOff(di) {
  const i = state.offDays.indexOf(di);
  if (i >= 0) state.offDays.splice(i, 1);
  else state.offDays.push(di);
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
function autoLine(wk) {
  const r = L.recommendMode(state, fromIso(wk));
  return r ? `${MODE_META[r.mode].name} · ${esc(r.why)}` : `ton mode habituel (${MODE_META[state.mode].name})`;
}
function modeSheet(wk) {
  wk = wk || wkOf(selDate);
  const cfg = cfgOf(wk), manual = cfg.source === 'manual', noExam = !state.subjects.some(su => su.exam);
  openSheet('Semaine du ' + dateLbl(fromIso(wk)), `
    <div class="group" style="margin-bottom:12px"><label class="row-sw"><span class="bd"><span class="ti">J’ai cours cette semaine</span><span class="su">Sinon : semaine de travail sans cours, ni séries</span></span><input type="checkbox" class="sw" data-courses="${wk}" ${cfg.coursesOn ? 'checked' : ''}${cfg.tripDays >= 3 ? ' disabled' : ''}></label></div>
    <div class="modes" role="radiogroup">
      <button type="button" class="mopt" role="radio" aria-checked="${!manual}" data-act="setMode" data-v="auto" data-w="${wk}" style="--m:var(--ink)"><span class="sw8"></span><span><b>Automatique <em class="badge" style="--m:var(--ink)">conseillé</em></b><small>L’app choisit pour toi : ${autoLine(wk).replace(/\.$/, "")}. Elle passe aussi en Rattrapage toute seule si le retard ne rentre plus.</small></span></button>
      ${['chill', 'normal', 'charbon', 'recup'].map(k => `<button type="button" class="mopt" role="radio" aria-checked="${manual && k === cfg.mode}" data-act="setMode" data-v="${k}" data-w="${wk}" style="--m:${MODE_COLORS[k]}"><span class="sw8"></span><span><b>${MODE_META[k].name}</b><small>${esc(MODE_META[k].tag)}${k === 'exam' && noExam ? ' <b style="display:inline;color:var(--warn)">Ajoute d’abord tes dates d’examen.</b>' : ''}</small></span></button>`).join('')}
    </div>
    <details class="more" style="margin-top:10px;border:0"${manual && ['avance', 'rattrapage', 'exam'].includes(cfg.mode) ? ' open' : ''}><summary style="padding:8px 2px">Situations spéciales <small style="color:var(--muted);font-weight:500">· l’app les met toute seule quand il faut</small></summary><div class="modes" role="radiogroup">
      ${['avance', 'rattrapage', 'exam'].map(k => `<button type="button" class="mopt" role="radio" aria-checked="${manual && k === cfg.mode}" data-act="setMode" data-v="${k}" data-w="${wk}" style="--m:${MODE_COLORS[k]}"><span class="sw8"></span><span><b>${MODE_META[k].name}</b><small>${esc(MODE_META[k].tag)}${k === 'exam' && noExam ? ' <b style="display:inline;color:var(--warn)">Ajoute d’abord tes dates d’examen.</b>' : ''}</small></span></button>`).join('')}
    </div></details><div>
    </div>
    <div class="day-actions"><button type="button" class="linkbtn" data-act="weekendOff" data-v="${wk}">${state.offDays.includes(iso(addDays(fromIso(wk), 5))) && state.offDays.includes(iso(addDays(fromIso(wk), 6))) ? 'Annuler le week-end off' : 'Prendre le week-end off'}</button><button type="button" class="linkbtn" data-act="tuneMode" data-v="${cfg.mode}">Ajuster le mode ${esc(MODE_META[cfg.mode].name)}</button></div>
    <p class="hint" style="text-align:center;margin-top:12px">Tu peux changer en pleine semaine : ce qui est passé ne bouge pas, seul ce qui reste s’adapte.</p>`);
}
function baseModeSheet() {
  openSheet('Mode habituel', `<p class="hint" style="margin:-4px 0 12px;padding:0">Le mode des semaines « normales », quand rien de spécial n’arrive (pas d’examen proche, pas de voyage, pas de retard).</p>
    <div class="modes">${['chill', 'normal', 'charbon'].map(k => `<button type="button" class="mopt" aria-checked="${state.mode === k}" data-act="setBase" data-v="${k}" style="--m:${MODE_COLORS[k]}"><span class="sw8"></span><span><b>${MODE_META[k].name}</b><small>${esc(MODE_META[k].tag)}</small></span></button>`).join('')}</div>`);
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
    ${F.select('semw', 'Semaine du semestre en ce moment', Array.from({ length: 16 }, (_, i) => [i + 1, 'Semaine ' + (i + 1)]), L.semWeek(state, mondayOf(new Date())) || 9)}
    ${F.date('semEnd', 'Dernier jour de cours du semestre', state.semEnd || '')}
  </div><p class="hint" style="margin-top:10px">Sert à nommer les séries (en semaine 9, c’est la série 9). Après le dernier jour de cours, plus de cours ni de séries : les semaines deviennent des semaines de révision.</p>${actions(false)}`, fd => {
    if (fd.semEnd !== undefined) state.semEnd = fd.semEnd || '';
    if (fd.semw) state.semStart = iso(addDays(mondayOf(new Date()), -7 * (+fd.semw - 1)));
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
      ${(() => { const fl = ((state.focus || {}).log || []).filter(x => x.at >= ws.getTime() && x.at < addDays(ws, 7).getTime()); const fm = Math.round(fl.reduce((a, x) => a + x.ms, 0) / 6e4); const sp = (state.sportLog || []).filter(x => x.at >= ws.getTime() && x.at < addDays(ws, 7).getTime()).length; return (fm ? `<div class="stat"><div class="k">Focus chronométré</div><div class="v">${hm(fm)}</div><div class="hint" style="padding:0">${fl.length} session${fl.length > 1 ? 's' : ''}</div></div>` : '') + (sp ? `<div class="stat"><div class="k">Séances de sport</div><div class="v">${sp}</div></div>` : ''); })()}
    </div>
    ${alerts.map(a => `<div class="alert">${esc(a)}</div>`).join('')}
    <div class="sec-t" style="margin-top:20px">Par matière</div>
    <div class="group" style="padding:2px 14px">${state.subjects.map(s => { const p = sm.per[s.id] || { plan: 0, done: 0 }; return `<div class="subrow" style="--c:${esc(s.color)}"><span>${esc(s.name)}</span><span class="num">${p.done ? hm(p.done) : '0'} / ${hm(p.plan)}</span><span class="bar"><b style="width:${p.plan / max * 100}%"></b><i style="width:${p.done / max * 100}%"></i></span></div>`; }).join('')}</div>`);
}
function done() { save(); renderAll(); endChange(); setTimeout(autoCheck, 50); return true; }
/* Too much late work for this week's mode → switch what's left of the week to Rattrapage (unless you chose the mode yourself) */
function autoCheck() {
  if (state.autoMode === false) return;
  const ws = mondayOf(new Date()), key = iso(ws);
  const days = L.generate(state, ws), c = days.meta.cfg;
  if (c.source === 'manual' || ['rattrapage', 'charbon', 'exam', 'recup'].includes(c.mode)) return;
  const M = days.meta;
  // switch when the séries no longer fit, or when 4h+ of this week's blocks were not done
  if (M.mustLeftAfter < 60 && M.lateMin < 240) return;
  const why = M.mustLeftAfter >= 60 ? hm(M.mustLeftAfter) + ' de séries ne rentraient plus' : hm(M.lateMin) + ' pas faits cette semaine';
  beginChange();
  state.autoModes[key] = { mode: 'rattrapage', why };
  save(); renderAll();
  endChange('Mode Rattrapage activé automatiquement', why);
}

/* ---------- "Emploi du temps modifié" ---------- */
let pendingSig = null;
function planSig() {
  const nowT = Date.now(), blocks = new Set(), mins = {};
  for (const k of [0, 7]) {
    const ws = addDays(mondayOf(new Date()), k);
    for (const x of L.generate(state, ws)) for (const e of x.ev) {
      if (e.kind !== 'study' || x.date.getTime() + e.start * 6e4 <= nowT) continue;
      blocks.add([iso(x.date), e.start, e.end, e.subj, e.title].join('|'));
      const dk = iso(x.date); mins[dk] = (mins[dk] || 0) + e.end - e.start;
    }
  }
  return { blocks, mins };
}
function showCard(title, detail) {
  const el = $('#upd');
  el.innerHTML = `<span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span><span><b>${esc(title)}</b><small>${esc(detail)}</small></span>`;
  el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  clearTimeout(showCard._t); showCard._t = setTimeout(() => el.classList.remove('on'), 3800);
}
function beginChange() { L.freezePast(state); pendingSig = planSig(); }
function endChange(title, lead) {
  if (!pendingSig) return;
  const a = pendingSig, b = planSig(); pendingSig = null;
  let added = 0, removed = 0;
  b.blocks.forEach(k => { if (!a.blocks.has(k)) added++; });
  a.blocks.forEach(k => { if (!b.blocks.has(k)) removed++; });
  const moved = Math.max(added, removed);
  const deltas = [...new Set([...Object.keys(a.mins), ...Object.keys(b.mins)])]
    .map(k => [k, (b.mins[k] || 0) - (a.mins[k] || 0)]).filter(x => Math.abs(x[1]) >= 10)
    .sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).slice(0, 3)
    .map(([k, d]) => { const dt = fromIso(k); return `${DAYS[dow(dt)].toLowerCase()} ${dt.getDate()} ${d > 0 ? '+' : '−'}${hm(Math.abs(d))}`; });
  const detail = moved ? `${moved} bloc${moved > 1 ? 's' : ''} réorganisé${moved > 1 ? 's' : ''}${deltas.length ? ' · ' + deltas.join(', ') : ''}` : 'Rien à déplacer, tout tient déjà.';
  const el = $('#upd');
  el.innerHTML = `<span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span><span><b>${esc(title || 'Emploi du temps modifié')}</b><small>${esc((lead ? lead + ' · ' : '') + detail)}</small></span>`;
  el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  clearTimeout(endChange._t); endChange._t = setTimeout(() => el.classList.remove('on'), 3800);
}

/* ---------- Aujourd'hui ---------- */
function renderToday() {
  const sel = fromIso(selDate), ws = mondayOf(sel), key = iso(ws);
  const days = L.generate(state, ws), sm = L.summarize(state, days, key);
  const wmode = days.meta.cfg.mode;
  const spPlan = sportPlanFor(key, days);
  document.body.dataset.mode = wmode;
  const day = days[dow(sel)];
  const isToday = selDate === todayIso();
  const now = new Date(), mins = now.getHours() * 60 + now.getMinutes();
  const isPastDay = sel < fromIso(todayIso());
  const we = addDays(ws, 6);
  $('#tEyebrow').textContent = isToday ? 'Aujourd’hui' : (Math.abs(sel - fromIso(todayIso())) === 864e5 ? (sel > fromIso(todayIso()) ? 'Demain' : 'Hier') : 'Semaine du ' + ws.getDate() + (ws.getMonth() !== we.getMonth() ? ' ' + MONTHS[ws.getMonth()] : '') + ' au ' + dateLbl(we));
  $('#tTitle').textContent = DAYS[dow(sel)] + ' ' + sel.getDate() + ' ' + MONTHS[sel.getMonth()];
  $('#modePill').innerHTML = `<span class="dot"></span><span class="pt">${MODE_META[wmode].name}${days.meta.cfg.coursesOn ? '' : '<small> · sans cours</small>'}</span>${days.meta.cfg.source === 'auto' ? '<small class="autotag">auto</small>' : ''}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>`;
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
      hero = `<div class="hero"><div class="k">Maintenant · encore ${hm(cur.end - mins)}</div><div class="t">${esc(cur.title)}${cur.workout ? ' · ' + esc(cur.workout) : ''}</div><div class="s">${esc(cur.sub || '')}${roomBtn(cur)}</div>${cur.kind === 'study' && cur.state === 'todo' && !foRun() ? `<button type="button" class="hero-go" data-act="foGo" data-v="${esc(cur.id)}" data-w="${key}">▶ Lancer le focus</button>` : ''}${cur.kind === 'sport' && !(state.done[key] || {})[cur.id] ? `<button type="button" class="hero-go" data-act="sportSheet" data-w="${key}" data-id="${esc(cur.id)}">▶ Commencer la séance</button>` : ''}<div class="bar"><i style="width:${p}%"></i></div>${nxt ? `<div class="next"><span class="num">${fmt(nxt.start)}</span><span>Ensuite <b>${esc(nxt.title)}${nxt.workout ? ' · ' + esc(nxt.workout) : ''}</b></span></div>` : ''}</div>`;
    } else if (nxt) hero = `<div class="hero"><div class="k">Prochain · dans ${hm(nxt.start - mins)}</div><div class="t">${esc(nxt.title)}${nxt.workout ? ' · ' + esc(nxt.workout) : ''}</div><div class="s"><span class="num">${fmt(nxt.start)}–${fmt(nxt.end)}</span>${nxt.sub ? ' · ' + esc(nxt.sub) : ''}${roomBtn(nxt)}</div>${nxt.kind === 'study' && nxt.state === 'todo' && !foRun() && nxt.start - mins <= 20 ? `<button type="button" class="hero-go" data-act="foGo" data-v="${esc(nxt.id)}" data-w="${key}">▶ Commencer maintenant</button>` : ''}</div>`;
    else hero = `<div class="hero quiet"><div class="k">C’est fini pour aujourd’hui</div><div class="t">Bonne soirée</div><div class="s">Au lit vers ${fmt(day.sleep)}.</div></div>`;
  }
  let late = '';
  const thisWeek = iso(mondayOf(new Date())) === key;
  if (thisWeek && M.mustLeftAfter >= 15) late = `<div class="notice warn"><span><b>${hm(M.mustLeftAfter)} de séries ne rentrent plus</b> cette semaine.${wmode !== 'rattrapage' ? ' Le mode Rattrapage peut t’aider.' : ' Elles passeront à la semaine prochaine.'}</span>${wmode !== 'rattrapage' ? `<button type="button" data-act="setMode" data-v="rattrapage" data-w="${key}">Rattrapage</button>` : ''}</div>`;
  // weekly check-in: Sunday evening, for next week
  let pickWeek = '';
  if (isToday && dow(now) === 6 && now.getHours() >= 16) {
    const target = iso(addDays(ws, 7));
    if (!(state.weekSeen || {})[target]) {
      const tc = cfgOf(target);
      pickWeek = `<div class="pickweek"><div class="k">Semaine prochaine · du ${dateLbl(fromIso(target))}</div>
        <b>Mode ${MODE_META[tc.mode].name}${tc.coursesOn ? '' : ', sans cours'}</b>
        <p>${tc.source === 'manual' ? 'Choisi par toi.' : tc.source === 'auto' ? 'Choisi automatiquement : ' + esc(tc.why) + '.' : 'Ton mode habituel.'}</p>
        <div class="chipsel"><button type="button" class="chipm on" data-act="weekOk" data-v="${target}" style="--m:var(--accent)">C’est bon</button><button type="button" class="chipm" data-act="modeSheet" data-w="${target}" style="--m:var(--ink)">Changer</button></div></div>`;
    }
  }
  let advice = '';
  const blT = M.blTotal || 0;
  if (thisWeek && M.mustAllDone && !pickWeek) {
    const weOff = state.offDays.includes(iso(addDays(ws, 5))) && state.offDays.includes(iso(addDays(ws, 6)));
    advice = `<div class="notice"><span><b>Toutes tes séries de la semaine sont faites.</b> Tu peux continuer, ou lever le pied.</span>${wmode !== 'chill' ? `<button type="button" data-act="setMode" data-v="chill" data-w="${key}">Chill</button>` : ''}${weOff ? '' : `<button type="button" data-act="weekendOff" data-v="${key}">Week-end off</button>`}</div>`;
  } else if (thisWeek && M.cfg.source === 'auto' && M.cfg.why && !pickWeek) {
    advice = `<div class="notice"><span><b>Mode ${MODE_META[wmode].name} automatique.</b> ${esc(M.cfg.why)}.</span><button type="button" data-act="modeSheet" data-w="${key}">Changer</button></div>`;
  }
  const st = main.filter(e => e.kind === 'study'), stDone = st.filter(e => e.state === 'done');
  const prog = st.length ? `<div class="prog"><span><b>${stDone.length}/${st.length}</b> blocs</span><span class="track"><i style="width:${stDone.length / st.length * 100}%"></i></span><span class="num">${hm(day.dn)} / ${hm(day.plan)}</span></div>` : '';
  const notice = !state.notif.on && isToday ? `<div class="notice"><span>Les rappels sont coupés.</span><button type="button" data-act="goSet">Activer</button></div>` : '';

  const rows = [`<div class="it k-minor"><span class="tm">${fmt(day.wake)}</span><span class="minor">Réveil</span></div>`];
  for (const e of main) {
    if (e.kind === 'milestone') {
      const su = subjOf(state, e.subj);
      rows.push(`<div class="it k-ms${e.state === 'done' ? ' done' : ''}" style="--c:${esc(su ? su.color : '')}"><span class="tm">${fmt(e.start)}</span>
        <div class="ms"><span class="flag"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg></span><span class="bd"><b>${esc(e.title)}</b><small>${esc(e.sub)}</small>${(() => { if (!su || !thisWeek) return ''; const av = L.corrAvail(state, ws, su); return av && av > fromIso(todayIso()) && su.corr ? `<button type="button" class="linkbtn mini" data-act="corrNow" data-w="${key}" data-v="${esc(su.id)}">Corrigé déjà sorti ?</button>` : ''; })()}</span>
        <button type="button" class="chk" data-act="msDone" data-w="${key}" data-v="${esc(e.subj)}" aria-pressed="${e.state === 'done'}" aria-label="${esc(e.title)} : ${esc(su ? su.name : '')}">${CHECK}</button></div></div>`);
      continue;
    }
    if (MINOR.has(e.kind)) { rows.push(`<div class="it k-minor"><span class="tm">${fmt(e.start)}</span><span class="minor">${esc(e.title)}</span></div>`); continue; }
    const su = e.subj ? subjOf(state, e.subj) : null;
    const isDone = e.kind === 'study' ? e.state === 'done' : !!sm.done[e.id];
    const can = e.kind === 'study' || e.kind === 'sport' || e.kind === 'stretch';
    const cls = ['it', 'k-' + e.kind];
    if (isToday && e.start <= mins && mins < e.end) cls.push('now');
    if (e.state === 'missed') cls.push('missed');
    else if ((isToday && e.end <= mins) || isPastDay) cls.push('past');
    if (isDone) cls.push('done');
    const tags = (e.part ? `<span class="tag cu">fait à ${Math.round(e.part * 100)} %</span>` : '') + (e.state === 'missed' ? '<span class="tag">pas fait · replacé</span>' : '') + (e.late && !e.bl && e.state !== 'done' ? '<span class="tag">semaine passée</span>' : '') + (e.catchup && e.state !== 'done' ? '<span class="tag cu">rattrapage</span>' : '');
    rows.push(`<div class="${cls.join(' ')}"${su ? ` style="--c:${esc(su.color)}"` : ''}><span class="tm">${fmt(e.start)}<small>${fmt(e.end)}</small></span>
      <div class="card"><div class="bd"${e.state === 'missed' && e.kind === 'study' ? ` data-act="checkin" data-w="${key}" data-v="${e.id}" role="button" tabindex="0"` : ''}${e.kind === 'stretch' ? ` data-act="stretchSheet" data-v="${dow(sel)}" data-w="${key}" data-id="${e.id}" role="button" tabindex="0"` : ''}${e.kind === 'sport' ? ` data-act="sportSheet" data-w="${key}" data-id="${e.id}" role="button" tabindex="0"` : ''}><div class="ti">${esc(e.title)}${e.kind === 'sport' && spPlan[e.id] != null && spPlan[e.id] >= 0 ? ' · ' + esc(SP.workouts[spPlan[e.id]].name) : ''}${tags}</div>${e.sub || e.kind === 'sport' ? `<div class="su">${esc(e.sub || '')}${e.kind === 'stretch' ? ' · touche pour les exercices' : ''}${e.kind === 'sport' ? (e.sub ? ' · ' : '') + (isDone ? 'séance faite' : 'touche pour la séance guidée') : ''}</div>` : ''}${(e.kind === 'course' || e.cid) && !e.room && e.cid ? `<div class="md-links">${roomBtn(e, true)}</div>` : ''}${revLine(e, key, sel, day.ev)}${mdBlockLinks(e, key)}${foBtn(e, key, sel)}</div>
      ${can ? `<button type="button" class="chk" data-act="done" data-w="${key}" data-v="${e.id}" aria-pressed="${isDone}" aria-label="Fait : ${esc(e.title)}">${CHECK}</button>` : ''}</div></div>`);
  }
  const blNote = isToday && blT >= 15 ? `<div class="notice"><span><b>Retard : ${hm(blT)}</b> · ${hm(M.blPlaced)} prévus cette semaine.</span><button type="button" data-tab-go="bl">Voir</button></div>` : '';
  const prop = thisWeek ? proposal(ws, key, M, wmode) : '';
  const news = isToday && APP === 'main' && !(state.dismiss || {})['news-focus'] ? `<div class="news"><b>Nouveau : Focus et Sport</b><p><b>Focus</b> : touche ▶ sur un bloc, le chrono tourne (même app fermée) et le vrai temps recale ton planning. Pomodoro en option, stats dans Ma semaine.<br><b>Sport</b> : ta prochaine séance, tes progrès exercice par exercice, tes records et l’historique.<br>Les deux peuvent avoir leur propre icône sur l’écran d’accueil.</p><div class="btns" style="padding:0"><button type="button" class="btn pri" data-tab-go="focus">Ouvrir Focus</button><button type="button" class="btn" data-tab-go="sport">Sport</button><button type="button" class="btn" data-act="icons">Icônes</button><button type="button" class="btn" data-act="dismiss" data-v="news-focus">OK</button></div></div>` : '';
  $('#todayBody').innerHTML = `${pickWeek}${hero}${news}${prop}${late}${prop ? '' : advice}${blNote}${notice}${prog}<div class="tl">${rows.join('')}</div>
    <div class="endday">Au lit ${fmt(day.sleep)}</div>
    ${isToday ? mdFeedCard() + mdTodayCard() : ''}
    <div class="day-actions">${day.trip ? '' : `<button type="button" class="linkbtn" data-act="offDay" data-v="${selDate}">${day.off ? 'Annuler le jour off' : 'Prendre ce jour off'}</button>`}<button type="button" class="linkbtn" data-act="weekSheet">Bilan de la semaine</button></div>`;
}

/* ---------- Calendrier ---------- */
function renderCal() {
  const y = calMonth.getFullYear(), mo = calMonth.getMonth();
  const first = new Date(y, mo, 1), start = addDays(first, -dow(first));
  const mdAll = mdEvents(), mdByDay = {}; mdAll.forEach(e => { mdByDay[e.date] = 1; });
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
    if (mdByDay[di]) dots.push('<i class="i-md"></i>');
    cells.push(`<button type="button" class="cell${d.getMonth() !== mo ? ' out' : ''}${di === todayIso() ? ' today' : ''}" data-act="calday" data-v="${di}" aria-selected="${di === calSel}" aria-label="${longDate(d)}"><span class="n">${d.getDate()}</span><span class="dots">${dots.join('')}</span></button>`);
  }
  const items = [];
  state.subjects.filter(s => s.exam === calSel).forEach(s => items.push(`<button type="button" class="li" data-act="editExam" data-v="${esc(s.id)}" style="--c:var(--exam)"><span class="dt"></span><span class="bd"><span class="ti">Examen · ${esc(s.name)}</span></span>${CHEV}</button>`));
  const tr = L.tripOn(state, calSel);
  if (tr) items.push(`<button type="button" class="li" data-act="editTrip" data-v="${esc(tr.trip.id)}" style="--c:#0F766E"><span class="dt"></span><span class="bd"><span class="ti">${esc(tr.trip.title || 'Voyage')}</span><span class="su">Du ${dateLbl(fromIso(tr.trip.from))} au ${dateLbl(fromIso(tr.trip.to))}${tr.edge ? ' · jour de voyage' : ''}</span></span>${CHEV}</button>`);
  (state.mocks || []).filter(x => x.date === calSel).forEach(x => { const su = subjOf(state, x.subj); items.push(`<button type="button" class="li" data-act="editMock" data-v="${esc(x.id)}" style="--c:#DB2777"><span class="dt"></span><span class="bd"><span class="ti">Examen blanc · ${esc(su ? su.name : '')}</span><span class="su">Facultatif${x.place ? ' · ' + esc(x.place) : ''}</span></span><span class="rt">${fmt(x.start)}<br>${fmt(x.end)}</span>${CHEV}</button>`); });
  if (state.offDays.includes(calSel)) items.push(`<button type="button" class="li" data-act="offDay" data-v="${calSel}" style="--c:var(--faint)"><span class="dt"></span><span class="bd"><span class="ti">Jour off</span><span class="su">Touche pour annuler</span></span></button>`);
  state.events.filter(x => x.date === calSel).sort((a, b) => a.start - b.start).forEach(x => items.push(`<button type="button" class="li" data-act="editEvent" data-v="${esc(x.id)}" style="--c:var(--acc)"><span class="dt"></span><span class="bd"><span class="ti">${esc(x.title)}</span>${x.place ? `<span class="su">${esc(x.place)}</span>` : ''}</span><span class="rt">${fmt(x.start)}<br>${fmt(x.end)}</span>${CHEV}</button>`));
  mdAll.filter(e => e.date === calSel).forEach(e => { const su = e.subj ? subjOf(state, e.subj) : null; items.push(`<div class="li" style="--c:${su ? esc(su.color) : '#F98012'}"><span class="dt"></span><span class="bd"><span class="ti">${esc(e.title)}</span><span class="su">Moodle · ${esc(su ? su.name : e.course || '')}</span></span><span class="rt">${(() => { const m = mdMin(e.start); return m && m !== 1439 ? fmt(m) : ''; })()}</span></div>`); });
  const sel = fromIso(calSel);
  $('#calBody').innerHTML = `
    <div class="cal-h"><button type="button" data-act="calm" data-v="-1" aria-label="Mois précédent">‹</button><b>${MONTHS_L[mo]} ${y}</b><button type="button" data-act="calm" data-v="1" aria-label="Mois suivant">›</button></div>
    <div class="cal">${DAYS_S.map(n => `<span class="wd">${n}</span>`).join('')}${cells.join('')}</div>
    <div class="legend"><span><i class="i-ev"></i>Événement</span><span><i class="i-off"></i>Off</span><span><i class="i-trip"></i>Voyage</span><span><i class="i-mock"></i>Exam blanc</span><span><i class="i-ex"></i>Examen</span>${state.moodleOn ? '<span><i class="i-md"></i>Moodle</span>' : ''}</div>
    <div class="sec-t">${longDate(sel)}<button type="button" data-act="openDay">Voir la journée</button></div>
    <div class="group">${items.join('') || '<div class="empty">Rien d’ajouté ce jour-là. Touche + pour ajouter quelque chose.</div>'}</div>`;
}

/* ---------- "T'as fini ?" after a block ---------- */
let ciQueue = [], ciOpen = false, ciSkipUntil = 0;
function ciCandidates() {
  const nowT = Date.now(), out = [];
  for (const k of [-7, 0]) {
    const ws = addDays(mondayOf(new Date()), k), wk = iso(ws), asked = (state.asked || {})[wk] || {};
    if (ws.getTime() + 7 * 864e5 < (state.since || 0)) continue;
    for (const x of L.generate(state, ws)) for (const e of x.ev) {
      if (e.kind !== 'study' || e.state !== 'missed' || asked[e.id]) continue;
      const endT = x.date.getTime() + e.end * 6e4;
      if (nowT - endT > 36 * 3600e3) continue;
      out.push({ wk, id: e.id, e, date: x.date, endT });
    }
  }
  return out.sort((a, b) => a.endT - b.endT).slice(0, 6);
}
function checkIn(force) {
  if (ciOpen || (!force && Date.now() < ciSkipUntil) || $('#sheetBg').classList.contains('on') || (!force && (foRun() || tab === 'focus' || tab === 'sport'))) return;   // never in the middle of a focus or a workout
  ciQueue = ciCandidates(); if (!ciQueue.length) return;
  beginChange(); ciOpen = true; ciShow();
}
function ciShow() {
  const c = ciQueue[0]; if (!c) { ciOpen = false; closeSheet(); renderAll(); endChange('Emploi du temps mis à jour', 'avec ce que t’as fait'); return; }
  const su = subjOf(state, c.e.subj);
  const opt = (f, t, cls) => `<button type="button" class="btn ${cls || ''}" data-act="ciAns" data-v="${f}">${t}</button>`;
  openSheet('T’as fini ce bloc ?', `<div class="ci-card" style="--c:${esc(su ? su.color : 'var(--faint)')}"><span class="num">${DAYS[dow(c.date)]} ${fmt(c.e.start)}–${fmt(c.e.end)}</span><b>${esc(c.e.title)}</b><small>${esc(su ? su.name : '')}</small></div>
    <div class="ci-opts">${opt(1, 'Oui, fini', 'pri')}${opt(.75, 'Presque (¾)')}${opt(.5, 'À moitié')}${opt(.25, 'Un peu (¼)')}${opt(0, 'Pas fait')}</div>
    <p class="hint" style="margin-top:12px">Ce qui reste est replacé tout seul dans ta semaine.${ciQueue.length > 1 ? ' Encore ' + (ciQueue.length - 1) + ' bloc' + (ciQueue.length > 2 ? 's' : '') + ' à faire le point.' : ''}</p>
    <button type="button" class="linkbtn" data-act="ciLater">Plus tard</button>`);
}
function ciAnswer(f) {
  const c = ciQueue.shift(); if (!c) return;
  if (f > 0) {
    if (/examen blanc/.test(c.e.title || '')) revRemember(c.wk, c.id, f);
    if (/^Examen du /.test(c.e.title || '')) examRemember(c.wk, c.id, f);
    const d = state.done[c.wk] = state.done[c.wk] || {}, e = c.e, len = e.end - e.start;
    d[c.id] = { s: e.subj, t: e.title, m: Math.round(len * f), d: dow(c.date), a: e.start, serie: e.serie, c: !!e.corr || undefined, b: e.bl || undefined, p: f < 1 ? f : undefined };
  } else { state.asked = state.asked || {}; (state.asked[c.wk] = state.asked[c.wk] || {})[c.id] = 1; }
  const keys = Object.keys(state.asked || {}).sort(); while (keys.length > 3) delete state.asked[keys.shift()];
  save(); ciShow();
}
/* Suggestions you accept or not */
function proposal(ws, key, M, wmode) {
  const dis = state.dismiss || {};
  // 1. leaving Rattrapage once the late work is caught up
  if (wmode === 'rattrapage' && (M.blTotal || 0) < 30 && M.mustLeftAfter === 0 && M.lateMin < 60 && !dis[key + ':exitR']) {
    const rec = L.recommendMode(state, ws); let sug = rec && rec.mode !== 'rattrapage' ? rec.mode : state.mode;
    if (sug === 'rattrapage') sug = 'normal';
    const alt = sug === 'charbon' ? 'normal' : 'charbon';
    return `<div class="prop"><b>Ton retard est rattrapé.</b><p>Je te propose de repasser en <b>${MODE_META[sug].name}</b>${rec && rec.mode === sug ? ' (' + esc(rec.why) + ')' : ''} pour le reste de la semaine. Ce qui est passé ne bouge pas.</p>
      <div class="btns" style="padding:0"><button type="button" class="btn pri" data-act="setMode" data-v="${sug}" data-w="${key}">${MODE_META[sug].name}</button><button type="button" class="btn" data-act="setMode" data-v="${alt}" data-w="${key}">${MODE_META[alt].name}</button><button type="button" class="btn" data-act="dismiss" data-v="${key}:exitR">Rester</button></div></div>`;
  }
  // 2. your séries take more (or less) time than planned
  for (const su of state.subjects) {
    const log = ((state.serieLog || {})[su.id] || []).slice(-2);
    if (log.length < 2 || !su.serie) continue;
    const diffs = log.map(x => x.m - su.serie);
    if (!(diffs.every(d => d >= 30) || diffs.every(d => d <= -30))) continue;
    const avg = Math.round(log.reduce((a, x) => a + x.m, 0) / log.length / 30) * 30;
    const id = 'est:' + su.id + ':' + log[log.length - 1].wk;
    if (dis[id] || avg === su.serie || avg < 30) continue;
    return `<div class="prop"><b>La série de ${esc(su.name)} te prend plutôt ${hm(avg)}.</b><p>Les 2 dernières semaines : ${log.map(x => hm(x.m)).join(' et ')}, pour ${hm(su.serie)} prévues. J’ajuste le planning ?</p>
      <div class="btns" style="padding:0"><button type="button" class="btn pri" data-act="serieAdjust" data-v="${esc(su.id)}" data-m="${avg}">Passer à ${hm(avg)}</button><button type="button" class="btn" data-act="dismiss" data-v="${id}">Garder ${hm(su.serie)}</button></div></div>`;
  }
  // 3. things found on Moodle (time-sensitive), then the exam-dates nudge
  // 3. exam session coming and no exam dates yet: the 6-week campaign can't start without them
  let nudge = '';
  if (!state.subjects.some(su => su.exam) && state.semEnd && !(state.dismiss || {})['examDates']) {
    const left = (fromIso(state.semEnd) - fromIso(todayIso())) / 864e5;
    if (left <= 45 && left >= -20) nudge = `<div class="prop"><b>Tes dates d’examens ?</b><p>La session approche. Avec les dates (IS-Academia → Mon plan d’examens), l’app lance 6 semaines avant chaque examen une campagne de révision en 3 passes, en tenant compte du Liban.</p><div class="btns" style="padding:0"><button type="button" class="btn pri" data-act="editExam" data-v="${esc((state.subjects[0] || {}).id || '')}">Ajouter une date</button><button type="button" class="btn" data-act="dismiss" data-v="examDates">Plus tard</button></div></div>`;
  }
  return mdProposal() || nudge;
}

/* ---------- course rooms ---------- */
const baseCid = id => String(id || '').replace(/-b$/, '');
function roomBtn(e, inCard) { return e && (e.kind === 'course' || e.cid) && !e.room && e.cid ? `${inCard ? '' : ' '}<button type="button" class="linkbtn mini${inCard ? '' : ' on-hero'}" data-act="roomAdd" data-v="${esc(baseCid(e.cid))}">+ salle</button>` : ''; }
function roomSheet(cid) {
  const c = state.courses.find(x => x.id === cid); if (!c) return;
  const su = subjOf(state, c.subj);
  openSheet('Salle · ' + (su ? su.name : 'Cours'), `<p class="hint" style="margin:-4px 0 12px;padding:0">${esc(c.type)} du ${DAYS[c.day].toLowerCase()} ${fmt(c.start)}–${fmt(c.end)}. Elle sera affichée chaque semaine.</p><div class="fields">${F.text('room', 'Salle', c.room || '', 'full', 'ex. CE 1 6')}</div><div class="sh-actions"><button type="submit" class="btn pri">Enregistrer</button></div>`, fd => { c.room = String(fd.room || '').trim().slice(0, 40); save(); renderAll(); endChange('Salle enregistrée', (su ? su.name + ' · ' : '') + (c.room || 'aucune salle') + ', chaque ' + DAYS[c.day].toLowerCase() + '.'); return true; });
}

/* ---------- Moodle (lien calendrier) ---------- */
const MD_LS = LS + '-moodle';
let moodle = (() => { try { return JSON.parse(lsGet(MD_LS)); } catch (e) { return null; } })();
const MD_GUESS = { ana: /analys|math-101/, alg: /algebr|math-111/, phy: /physi|phys-101/, aicc: /aicc|cs-101|information.*comput/, prog: /programm|cs-107|cs-108|cs-111/ };
const deacc = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function mdSubj(course, title) {
  const map = state.moodleMap || {};
  if (course && Object.prototype.hasOwnProperty.call(map, course)) return map[course] || null;
  const t = deacc(course + ' ' + (course ? '' : title));
  for (const su of state.subjects) {
    const re = MD_GUESS[su.id]; if (re && re.test(t)) return su.id;
    const w = deacc(su.name).split(/[^a-z0-9]+/).find(x => x.length >= 4); if (w && t.includes(w)) return su.id;
  }
  return null;
}
function mdKind(title) {
  const t = deacc(title);
  if (/blanc|mock|midterm|mi-semestre/.test(t)) return 'mock';
  if (/(examen|exam\b|exam |final)/.test(t) && !/quiz/.test(t)) return 'exam';
  if (/s[e]rie|serie|exercise sheet|problem set/.test(t)) return 'serie';
  if (/due|a rendre|rendu|closes|ferme|deadline|devoir|assignment|quiz|delai/.test(t)) return 'due';
  return 'event';
}
const mdMin = t => { const d = new Date(t); return d.getHours() * 60 + d.getMinutes(); };
function mdEvents() {
  if (!state.moodleOn || !moodle || !moodle.events) return [];
  // Moodle sends "X opens" and "X closes" as two events: merge them into one (start → end)
  const out = [], open = {};
  for (const e of moodle.events) {
    const m = /^(.*?)\s+(opens|closes|s’ouvre|s'ouvre|se ferme|ouverture|fermeture)$/i.exec(e.title);
    if (!m) { out.push({ ...e }); continue; }
    const base = m[1], k = e.course + '|' + base, isOpen = /open|ouvr/i.test(m[2]);
    if (isOpen) { const x = { ...e, title: base, end: e.end, opens: true }; open[k] = x; out.push(x); }
    else if (open[k] && e.start - open[k].start < 14 * 864e5) { open[k].end = e.start; open[k].uid = open[k].uid + '+'; if (e.todo) open[k].todo = true; delete open[k].opens; delete open[k]; }
    else out.push({ ...e, title: base, closes: true });
  }
  return out.map(e => { let k = mdKind(e.title); if (e.closes && k === 'event') k = 'due'; return { ...e, subj: mdSubj(e.course, e.title), kind: k, date: iso(new Date(e.start)), dueAt: e.end > e.start ? e.end : e.start }; });
}
async function mdFetch(force) {
  if (!WORKER || !syncKey() || !state.moodleOn) return;
  if (!force && moodle && Date.now() - (moodle.fetched || 0) < 30 * 60e3) return;
  try {
    const d = await fetch(WORKER + '/moodle?k=' + syncKey() + (force ? '&force=1' : '')).then(r => r.json());
    if (d && !d.error && !d.none) { d.fetched = Date.now(); moodle = d; lsSet(MD_LS, JSON.stringify(d)); mdApply(); mdAutoDone(); keepScroll(renderAll); }
    return d;
  } catch (e) { return null; }
}
async function ensureKey() {
  if (syncKey()) return true;
  if (!WORKER) return false;
  lsSet(KEY_LS, newKey()); if (!localUpdated()) lsSet(UPD_LS, String(Date.now()));
  await pushState(); return true;
}
function moodleConnect() {
  openSheet('Connecter Moodle', `<ol class="steps"><li>Dans Safari, va sur <b>moodle.epfl.ch/calendar/export.php</b></li><li>Choisis <b>Tous</b> et <b>Récents et 60 prochains jours</b></li><li>Touche <b>Obtenir l’URL du calendrier</b> et copie le lien</li></ol>
    <div class="fields">${F.text('ical', 'Lien du calendrier Moodle', state.moodleOn && moodle ? '' : '', 'full', 'https://moodle.epfl.ch/calendar/export_execute.php?…')}</div>
    <p class="hint" style="margin-top:10px">Ce lien reste privé : il sert seulement à lire tes échéances, une fois par heure.</p>
    <div class="sh-actions"><button type="submit" class="btn pri">Connecter</button></div>`, fd => {
    const link = String(fd.ical || '').trim();
    if (!/^https:\/\/moodle\.epfl\.ch\/calendar\/export_execute\.php\?/.test(link)) { toast('Colle le lien qui commence par moodle.epfl.ch/calendar/export_execute.php'); return false; }
    (async () => {
      const btn = $('#shBody .btn.pri'); if (btn) { btn.disabled = true; btn.textContent = 'Connexion…'; }
      const ok = await ensureKey();
      let d = null; if (ok) d = await post('/moodle', { k: syncKey(), ical: link }).then(r => r.json()).catch(() => null);
      if (!d || d.error || (d.errors && d.errors.ical)) { if (btn) { btn.disabled = false; btn.textContent = 'Connecter'; } toast(d ? (d.error || d.errors.ical) : 'Serveur injoignable, réessaie'); return; }
      d.fetched = Date.now(); moodle = d; lsSet(MD_LS, JSON.stringify(d));
      state.moodleOn = true; save(); closeSheet(); renderAll();
      const n = mdEvents().filter(e => e.start > Date.now()).length;
      showCard('Moodle connecté', n + ' échéance' + (n > 1 ? 's' : '') + ' à venir trouvée' + (n > 1 ? 's' : '') + '. Je te proposerai de les ajouter au planning.');
      if (mdUnmapped().length) setTimeout(moodleMapSheet, 600);
    })();
    return false;
  });
}
const mdCourses = () => [...new Set(((moodle && moodle.events) || []).map(e => e.course).filter(Boolean))];
const mdUnmapped = () => mdCourses().filter(c => !mdSubj(c, ''));
function moodleMapSheet() {
  const cs = mdCourses();
  if (!cs.length) { toast('Aucun cours trouvé dans le calendrier Moodle pour l’instant'); return; }
  const opts = [['', 'Ignorer ce cours']].concat(subjOpts());
  openSheet('Cours Moodle', `<p style="margin:0 0 12px;color:var(--muted)">À quelle matière correspond chaque cours ?</p><div class="fields">${cs.map((c, i) => F.select('c' + i, esc(c), opts, mdSubj(c, '') || '')).join('')}</div><div class="sh-actions"><button type="submit" class="btn pri">Enregistrer</button></div>`, fd => {
    state.moodleMap = state.moodleMap || {};
    cs.forEach((c, i) => { state.moodleMap[c] = fd['c' + i] || ''; });
    return done();
  });
}
function moodleSet() {
  if (!state.moodleOn) return `<div class="status"><b>Relier Moodle</b>Tes échéances, quiz et dates d’examen Moodle arrivent dans l’app, qui te propose de les caser dans ton planning.</div><div class="btns"><button type="button" class="btn pri full" data-act="mdConnect">Connecter Moodle</button></div>`;
  const up = mdEvents().filter(e => e.start > Date.now());
  const err = moodle && moodle.errors && moodle.errors.ical;
  const when = moodle && moodle.at ? new Date(moodle.at) : null;
  return `<div class="status"><b>${err ? 'Moodle : problème de lecture' : 'Moodle connecté'}</b>${err ? esc(err) + '. Reconnecte avec un nouveau lien.' : up.length + ' échéance' + (up.length > 1 ? 's' : '') + ' à venir' + (when ? ' · mis à jour à ' + fmt(when.getHours() * 60 + when.getMinutes()) : '')}</div>
    <button type="button" class="li" data-act="mdMap"><span class="bd"><span class="ti">Cours ↔ matières</span><span class="su">${mdUnmapped().length ? mdUnmapped().length + ' cours pas encore reliés' : 'Tous les cours sont reliés'}</span></span>${CHEV}</button>
    <button type="button" class="li" data-act="mdKey"><span class="bd"><span class="ti">${moodle && moodle.ok && moodle.ok.api ? 'Séries, corrigés et annonces : actifs' : 'Tout automatiser'}</span><span class="su">${moodle && moodle.ok && moodle.ok.api ? (moodle.courses || []).length + ' cours suivis · touche pour gérer la clé' : (moodle && moodle.errors && moodle.errors.api ? esc(moodle.errors.api) : 'Nouvelles séries, corrigés et annonces, avec la clé Moodle')}</span></span>${CHEV}</button>
    ${mdApi() ? `<button type="button" class="li" data-act="mdAnnList"><span class="bd"><span class="ti">Annonces des cours</span><span class="su">${(moodle.announcements || []).length} annonces ces 45 derniers jours</span></span>${CHEV}</button>` : ''}
    ${mdApi() ? `<button type="button" class="li" data-act="mdDocsPick"><span class="bd"><span class="ti">Documents des cours</span><span class="su">${(() => { const it = (moodle.items || []).filter(i => i.file); return it.length + ' fichiers · ' + it.filter(i => i.kind === 'serie').length + ' séries · ' + it.filter(i => i.kind === 'correction').length + ' corrigés reconnus'; })()}</span></span>${CHEV}</button>` : ''}
    <div class="btns"><button type="button" class="btn" data-act="mdRefresh">Actualiser</button><button type="button" class="btn" data-act="mdConnect">Changer le lien</button><button type="button" class="btn" data-act="mdOff">Déconnecter</button></div>`;
}

/* with the Moodle key: files (séries, corrigés) and announcements */
function mdCourseSubj(id) {
  const c = ((moodle && moodle.courses) || []).find(x => x.id === id); if (!c) return null;
  const code = (c.short.match(/[A-Z]{2,5}-\d{3}/) || [])[0];
  return (code && mdSubj(code, '')) || mdSubj(c.short, '') || mdSubj(c.name, '');
}
function mdFeed() {
  if (!moodle || !moodle.ok || !moodle.ok.api) return [];
  const since = Date.now() - 4 * 864e5, dis = state.dismiss || {};
  const items = (moodle.items || []).filter(i => i.time > since).map(i => ({ file: i.file, id: 'f' + i.course + '-' + i.time + i.title.slice(0, 20), t: i.time, subj: mdCourseSubj(i.course), title: mdName(i), tag: i.kind === 'correction' ? 'Corrigé' : i.kind === 'serie' ? 'Série' : 'Doc', url: i.url }));
  const ann = (moodle.announcements || []).filter(a => a.time > since).map(a => ({ id: 'a' + a.course + '-' + a.time + a.title.slice(0, 20), t: a.time, subj: mdCourseSubj(a.course), title: a.title, text: a.ai && a.ai.summary ? a.ai.summary : a.text, tag: 'Annonce', annId: annKey(a) }));
  return items.concat(ann).filter(x => !dis['mf:' + x.id]).sort((a, b) => b.t - a.t).slice(0, 5);
}
// séries read on Moodle: their estimated time replaces the usual one, adjusted to how fast you really are
function serieRatio(subj) {
  const r = [];
  for (const x of ((state.serieLog || {})[subj] || [])) { const ai = ((state.serieAi || {})[x.wk] || {})[subj]; if (ai > 0 && x.m > 0) r.push(x.m / ai); }
  if (r.length < 2) return 1;
  r.sort((a, b) => a - b); return Math.max(0.6, Math.min(1.6, r[Math.floor(r.length / 2)]));
}
function mdEstimates() {
  if (!mdApi()) return [];
  const changed = [];
  for (const ws of [mondayOf(new Date()), addDays(mondayOf(new Date()), 7)]) {
    const wk = iso(ws); if (!L.coursesOnFor(state, ws)) continue;
    const n = L.semWeek(state, ws);
    for (const su of state.subjects) {
      if (!su.serie || ((state.serieDone || {})[wk] || {})[su.id]) continue;
      const it = mdFiles(su.id).find(i => i.kind === 'serie' && i.num === n && i.est && i.est.minutes > 0); if (!it) continue;
      state.serieAi = state.serieAi || {}; (state.serieAi[wk] = state.serieAi[wk] || {})[su.id] = it.est.minutes;
      const mine = Math.max(45, Math.min(360, Math.round(it.est.minutes * serieRatio(su.id) / 5) * 5));
      state.serieEst = state.serieEst || {}; const m = state.serieEst[wk] = state.serieEst[wk] || {};
      if (m[su.id] !== mine) { m[su.id] = mine; changed.push(su.name + ' ≈ ' + hm(mine)); }
    }
  }
  for (const k of Object.keys(state.serieEst || {}).sort().slice(0, -6)) { delete state.serieEst[k]; if (state.serieAi) delete state.serieAi[k]; }
  return changed;
}
// a corrigé published earlier than planned moves the correction forward, automatically
function mdApply() {
  if (!moodle || !moodle.ok || !moodle.ok.api) return;
  { const before = JSON.stringify(state.serieEst || {}); beginChange(); const ch = mdEstimates(); if (ch.length && JSON.stringify(state.serieEst || {}) !== before) { save(); renderAll(); endChange('Séries lues sur Moodle', 'Durées estimées d’après les PDF : ' + ch.join(', ') + '. Ton planning est recalé.'); } }
  const done = []; state.corrSeen = state.corrSeen || {};
  for (const i of moodle.items || []) {
    if (i.kind !== 'correction' || i.time < Date.now() - 10 * 864e5) continue;
    const subj = mdCourseSubj(i.course), su = subj && subjOf(state, subj); if (!su) continue;
    const d = new Date(i.time), ws = mondayOf(d), wk = iso(ws), di = iso(d);
    const av = L.corrAvail(state, ws, su); if (!av || av <= fromIso(di)) continue;
    const m = state.corrSeen[wk] = state.corrSeen[wk] || {}; if (m[subj]) continue;
    if (!done.length) beginChange();
    m[subj] = di; done.push(su.name);
  }
  if (done.length) { save(); renderAll(); endChange('Corrigé publié sur Moodle', 'La correction de ' + done.join(', ') + ' est avancée.'); }
}
function mdFeedCard() {
  const f = mdFeed(); if (!f.length) return '';
  const ago = t => { const h = Math.round((Date.now() - t) / 3600e3); return h < 1 ? 'à l’instant' : h < 24 ? 'il y a ' + h + ' h' : 'il y a ' + Math.round(h / 24) + ' j'; };
  return `<div class="sec-t">Nouveautés Moodle</div><div class="group">${f.map(x => { const su = x.subj ? subjOf(state, x.subj) : null; return `<div class="li" style="--c:${su ? esc(su.color) : '#F98012'}"${x.file ? ` data-act="mdOpen" data-v="${esc(x.file)}" role="button" tabindex="0"` : x.annId != null ? ` data-act="mdAnn" data-v="${esc(x.annId)}" role="button" tabindex="0"` : ''}><span class="dt"></span><span class="bd"><span class="ti">${deacc(x.title).startsWith(deacc(x.tag)) ? '' : `<span class="tag cu" style="margin:0 6px 0 0">${x.tag}</span>`}${esc(x.title)}</span><span class="su">${esc(su ? su.name : 'Moodle')} · ${ago(x.t)}${x.file ? ' · touche pour ouvrir' : x.annId != null ? ' · touche pour lire' : ''}${x.text ? ' · ' + esc(x.text.slice(0, 110)) + (x.text.length > 110 ? '…' : '') : ''}</span></span><button type="button" class="linkbtn mini" style="margin:0" data-act="dismiss" data-v="mf:${esc(x.id)}" aria-label="Masquer">OK</button></div>`; }).join('')}</div>`;
}
function moodleKeySheet() {
  const L1 = 'https://moodle.epfl.ch/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=12345&urlscheme=https';
  openSheet('Tout automatiser', `<p style="margin:0 0 10px;color:var(--muted)">Avec la clé, l’app voit aussi les nouvelles séries, les corrigés et les annonces de tes cours.</p>
    <ol class="steps"><li>Dans Safari (connecté à Moodle), ouvre <button type="button" class="linkbtn mini" data-act="mdCopyLaunch" style="margin:0">ce lien</button></li><li>Refuse d’ouvrir l’app Moodle si on te le propose</li><li>Sur la page « serveur introuvable », touche l’adresse en haut, sélectionne tout et copie</li></ol>
    <div class="fields">${F.text('addr', 'Adresse copiée', '', 'full', 'https://token=…')}</div>
    <p class="hint" style="margin-top:10px">La clé reste sur ton serveur. Pour la révoquer : Moodle → Preferences → Security keys.</p>
    <div class="sh-actions">${moodle && moodle.ok && moodle.ok.api ? '<button type="submit" class="btn danger" value="delete">Retirer la clé</button>' : ''}<button type="submit" class="btn pri" value="save">Activer</button></div>`, (fd, btn) => {
    if (isDel(btn)) { (async () => { await post('/moodle', { k: syncKey(), token: '' }).catch(() => { }); await mdFetch(true); renderAll(); toast('Clé retirée'); })(); return; }
    const toks = L.moodleTokens(fd.addr);
    if (!toks.length) { toast('Adresse illisible : copie toute l’adresse, elle commence par https://token='); return false; }
    (async () => {
      const b = $('#shBody .btn.pri'); if (b) { b.disabled = true; b.textContent = 'Vérification…'; }
      const d = await post('/moodle', { k: syncKey(), tokens: toks }).then(r => r.json()).catch(() => null);
      if (!d || d.error || !d.ok || !d.ok.api) { if (b) { b.disabled = false; b.textContent = 'Activer'; } toast(d ? (d.error || (d.errors && d.errors.api) || 'Moodle a refusé la clé') : 'Serveur injoignable, réessaie'); return; }
      d.fetched = Date.now(); moodle = d; lsSet(MD_LS, JSON.stringify(d)); closeSheet(); mdApply(); mdAutoDone(); renderAll();
      showCard('Moodle entièrement relié', (d.user ? 'Salut ' + d.user + ' ! ' : '') + (d.courses || []).length + ' cours suivis : séries, corrigés et annonces arrivent maintenant dans l’app.');
    })();
    return false;
  });
}

/* opening course files (PDF) through the saved Moodle key */
const mdApi = () => !!(state.moodleOn && moodle && moodle.ok && moodle.ok.api);
const mdName = i => ((state.mdNames || {})[i.file] || i.nice || i.title);
const mdFileUrl = u => { const it = ((moodle && moodle.items) || []).find(i => i.file === u); return WORKER + '/moodle/file?k=' + syncKey() + '&u=' + encodeURIComponent(u) + (it ? '&n=' + encodeURIComponent(mdName(it)) : ''); };
function mdOpen(u) { const w = window.open(mdFileUrl(u), '_blank'); if (!w) location.href = mdFileUrl(u); }
function mdFiles(subj) { return mdApi() ? (moodle.items || []).filter(i => i.file && mdCourseSubj(i.course) === subj) : []; }
// the file for a série / correction block: same number, else the one published around that week
function mdPick(subj, kind, n, wk) {
  const fs = mdFiles(subj).filter(i => i.kind === kind);
  const byNum = n ? fs.find(i => i.num === n) : null; if (byNum) return byNum;
  if (!wk) return null;
  const a = fromIso(wk).getTime() - 7 * 864e5, b = fromIso(wk).getTime() + 7 * 864e5;
  return fs.find(i => i.time >= a && i.time < b) || null;
}
function mdFileFor(e, wk) {
  if (e.kind !== 'study' || !e.subj || !(e.serie || e.corr)) return null;
  const n = +((/(\d{1,2})/.exec(e.title) || [])[1] || 0);
  return mdPick(e.subj, e.corr ? 'correction' : 'serie', n, wk);
}
function mdBlockLinks(e, wk) {
  if (!mdApi() || !e.subj) return '';
  const out = [], n = +((/(\d{1,2})/.exec(e.title) || [])[1] || 0);
  let estLine = '';
  if (e.serie && !e.corr) { const f0 = mdPick(e.subj, 'serie', n, wk); const es = f0 && f0.est; if (es && es.minutes) estLine = `<div class="su rev">${es.n} exercice${es.n > 1 ? 's' : ''} · ≈ ${hm(Math.max(45, Math.min(360, Math.round(es.minutes * serieRatio(e.subj) / 5) * 5)))} pour toi${es.hard && es.hard.length ? ' · plus dur : exo ' + es.hard.join(', ') : ''}${es.topics && es.topics.length ? '<br>' + esc(es.topics.join(' · ')) : ''}</div>`; }
  // backlog blocks like "Retard · Série 8": the série and its corrigé are one tap away
  if (e.bl && !e.serie && !e.corr) { const m = /s[ée]rie\s*(\d{1,2})/i.exec(e.title || ''); if (m) { const sf = mdPick(e.subj, 'serie', +m[1], null), cf = mdPick(e.subj, 'correction', +m[1], null); if (sf) out.push(`<button type="button" class="linkbtn mini" data-act="mdOpen" data-v="${esc(sf.file)}">Ouvrir la série ${+m[1]}</button>`); if (cf) out.push(`<button type="button" class="linkbtn mini" data-act="mdOpen" data-v="${esc(cf.file)}">Corrigé</button>`); if (sf || cf) return estLine + `<div class="md-links">${out.join('')}</div>`; } }
  const f = mdFileFor(e, wk); if (f) out.push(`<button type="button" class="linkbtn mini" data-act="mdOpen" data-v="${esc(f.file)}">${e.corr ? 'Ouvrir le corrigé' : 'Ouvrir la série'}</button>`);
  if (e.corr) { const sf = mdPick(e.subj, 'serie', n, wk); if (sf) out.push(`<button type="button" class="linkbtn mini" data-act="mdOpen" data-v="${esc(sf.file)}">Énoncé</button>`); }
  const study = e.kind === 'study' || e.kind === 'course';
  if (study && mdFiles(e.subj).length && (!f || e.kind === 'course' || !(e.serie || e.corr))) out.push(`<button type="button" class="linkbtn mini" data-act="mdDocs" data-v="${esc(e.subj)}">Documents du cours</button>`);
  return estLine + (out.length ? `<div class="md-links">${out.join('')}</div>` : '');
}
function mdDocsSheet(subj) {
  const su = subjOf(state, subj), fs = mdFiles(subj);
  if (!fs.length) { toast('Aucun document trouvé pour ce cours'); return; }
  const lbl = { serie: 'Série', correction: 'Corrigé', exam: 'Examen' };
  const rows = fs.slice(0, 80).map(i => { const nm = mdName(i), orig = i.title !== nm; return `<div class="li doc"><button type="button" class="doc-open" data-act="mdOpen" data-v="${esc(i.file)}"><span class="bd"><span class="ti">${lbl[i.kind] && !deacc(nm).startsWith(deacc(lbl[i.kind])) ? `<span class="tag cu" style="margin:0 6px 0 0">${lbl[i.kind]}</span>` : ''}${esc(nm)}</span><span class="su">${esc(i.section || '')}${i.section ? ' · ' : ''}${dateLbl(new Date(i.time))}${orig ? ' · <i>' + esc(i.title) + '</i>' : ''}</span></span></button><button type="button" class="doc-ren" data-act="mdRename" data-v="${esc(i.file)}" data-s="${esc(subj)}" aria-label="Renommer">✎</button></div>`; }).join('');
  openSheet('Documents · ' + (su ? su.name : ''), `<p class="hint" style="margin:-4px 0 10px;padding:0">Noms remis au propre automatiquement (le nom d’origine est en petit). Touche ✎ pour renommer.</p><div class="group">${rows}</div>`, () => true);
  const f = $('#shBody .sh-actions'); if (f) f.remove();
}
function mdRename(file, subj) {
  const it = ((moodle && moodle.items) || []).find(i => i.file === file); if (!it) return;
  openSheet('Renommer', `<p class="hint" style="margin:-4px 0 10px;padding:0">Nom d’origine : <i>${esc(it.title)}</i>. Le fichier ne change pas, seulement le nom affiché.</p><div class="fields">${F.text('nm', 'Nom', mdName(it), 'full')}</div><div class="sh-actions">${(state.mdNames || {})[file] ? '<button type="submit" class="btn danger" value="delete">Nom automatique</button>' : ''}<button type="submit" class="btn pri" value="save">Enregistrer</button></div>`, (fd, btn) => {
    state.mdNames = state.mdNames || {};
    const v = String(fd.nm || '').trim().slice(0, 120);
    if (isDel(btn) || !v || v === it.nice) delete state.mdNames[file]; else state.mdNames[file] = v;
    save(); setTimeout(() => mdDocsSheet(subj), 350); return true;
  });
}
function mdDocsPick() {
  const subs = state.subjects.filter(su => mdFiles(su.id).length);
  if (!subs.length) { toast('Aucun document trouvé pour l’instant'); return; }
  openSheet('Documents des cours', `<div class="group">${subs.map(su => `<button type="button" class="li" style="--c:${esc(su.color)}" data-act="mdDocs" data-v="${esc(su.id)}"><span class="dt"></span><span class="bd"><span class="ti">${esc(su.name)}</span><span class="su">${mdFiles(su.id).length} documents</span></span>${CHEV}</button>`).join('')}</div>`, () => true);
}
const mdWhen = e => { const d = new Date(e.start), m = mdMin(e.start); return DAYS_S[dow(d)] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + (m && m !== 1439 ? ' · ' + fmt(m) : ''); };
const de = n => (/^[aeiouyhàâéèêîïôû]/i.test(n) ? 'd’' : 'de ') + n;
const mdLong = e => { const d = new Date(e.start), m = mdMin(e.start); return DAYS[dow(d)].toLowerCase() + ' ' + d.getDate() + ' ' + MONTHS_L[d.getMonth()].toLowerCase() + (m && m !== 1439 ? ' à ' + fmt(m) : ''); };
function mdTodayCard() {
  const now = Date.now(), ev = mdEvents().filter(e => e.end >= now - 3600e3 && e.start < now + 7 * 864e5 && e.kind !== 'event').slice(0, 4);
  if (!ev.length) return '';
  return `<div class="sec-t">Moodle · 7 prochains jours</div><div class="group">${ev.map(e => { const su = e.subj ? subjOf(state, e.subj) : null; return `<div class="li" style="--c:${su ? esc(su.color) : 'var(--faint)'}"><span class="dt"></span><span class="bd"><span class="ti">${esc(e.title)}</span><span class="su">${esc(su ? su.name : e.course || 'Moodle')}</span></span><span class="rt">${mdWhen(e).replace(' · ', '<br>')}</span></div>`; }).join('')}</div>`;
}
function mdProposal() {
  const dis = state.dismiss || {}, now = Date.now();
  for (const e of mdEvents()) {
    if (!e.subj || (e.kind === 'due' ? e.dueAt : e.start) < now || dis['md:' + e.uid]) continue;
    const su = subjOf(state, e.subj); if (!su) continue;
    const ign = `<button type="button" class="btn" data-act="dismiss" data-v="md:${esc(e.uid)}">Ignorer</button>`;
    if (e.kind === 'exam' && e.start < now + 150 * 864e5 && su.exam !== e.date)
      return `<div class="prop"><b>Moodle : examen ${esc(de(su.name))}, le ${mdLong(e)}</b><p>« ${esc(e.title)} ». ${su.exam ? 'Tu avais noté le ' + dateLbl(fromIso(su.exam)) + '. ' : ''}Je l’utilise pour le mode Exam et les révisions ?</p><div class="btns" style="padding:0"><button type="button" class="btn pri" data-act="mdExam" data-v="${esc(e.uid)}">Ajouter</button>${ign}</div></div>`;
    if (e.kind === 'mock' && e.start < now + 60 * 864e5 && !(state.mocks || []).some(m => m.subj === e.subj && m.date === e.date))
      return `<div class="prop"><b>Moodle : examen blanc ${esc(de(su.name))}</b><p style="margin-bottom:0">Le ${mdLong(e)}.</p><p>Je l’ajoute ? La séance d’exercices de ce jour-là est remplacée, et tu as une révision avant.</p><div class="btns" style="padding:0"><button type="button" class="btn pri" data-act="mdMock" data-v="${esc(e.uid)}">Ajouter</button>${ign}</div></div>`;
    if (e.kind === 'due' && e.dueAt < now + 7 * 864e5 && !(moodle.actionOk && !e.todo) && !(state.backlog || []).some(b => b.mdUid === e.uid))
      return `<div class="prop"><b>${esc(su.name)} : ${esc(e.title)}</b><p>À rendre au plus tard ${mdLong({ start: e.dueAt })}. Je le cale dans ton planning avant ?</p><div class="btns" style="padding:0"><button type="button" class="btn pri" data-act="mdDue" data-v="${esc(e.uid)}" data-m="60">1h</button><button type="button" class="btn" data-act="mdDue" data-v="${esc(e.uid)}" data-m="30">30 min</button><button type="button" class="btn" data-act="mdDue" data-v="${esc(e.uid)}" data-m="120">2h</button>${ign}</div></div>`;
  }
  // dates found in announcements (mock exams, exams, cancelled sessions)
  for (const an of mdApi() ? moodle.announcements || [] : []) {
    if (dis['ma:' + annKey(an)]) continue;
    const subj = mdCourseSubj(an.course), su = subj && subjOf(state, subj); if (!su) continue;
    const p = annPlan(an); if (!p || !p.date || fromIso(p.date) < fromIso(todayIso())) continue;
    const when = dateLbl(fromIso(p.date)) + (p.start != null ? ' à ' + fmt(p.start) + (p.end ? '–' + fmt(p.end) : '') : '');
    const btns = (main, label) => `<div class="btns" style="padding:0"><button type="button" class="btn pri" data-act="${main}" data-v="${esc(annKey(an))}">${label}</button><button type="button" class="btn" data-act="mdAnn" data-v="${esc(annKey(an))}">Lire l’annonce</button><button type="button" class="btn" data-act="dismiss" data-v="ma:${esc(annKey(an))}">Ignorer</button></div>`;
    const said = p.summary ? esc(p.summary) : '« ' + esc(an.title) + ' »';
    if (p.kind === 'mock' && !(state.mocks || []).some(m => m.subj === subj && m.date === p.date))
      return `<div class="prop"><b>Annonce : examen blanc ${esc(de(su.name))}</b><p>${said} · ${when}${p.room ? ', ' + esc(p.room) : ''}${p.start == null ? ' (heure à vérifier)' : ''}. Je l’ajoute au planning, avec la révision avant ?</p>${btns('maMock', 'Ajouter')}</div>`;
    if (p.kind === 'room') return `<div class="prop"><b>Annonce · ${esc(su.name)}, ${dateLbl(fromIso(p.date))}</b><p>${said}${p.room ? ' Salle : ' + esc(p.room) + '.' : ''}</p><div class="btns" style="padding:0"><button type="button" class="btn pri" data-act="dismiss" data-v="ma:${esc(annKey(an))}">Noté</button><button type="button" class="btn" data-act="mdAnn" data-v="${esc(annKey(an))}">Lire l’annonce</button></div></div>`;
    if (p.kind === 'deadline' && !(state.backlog || []).some(x => x.maKey === annKey(an))) return `<div class="prop"><b>À faire avant le ${dateLbl(fromIso(p.date))} · ${esc(su.name)}</b><p>${said} Je l’ajoute à ton retard pour ne pas l’oublier ?</p>${btns('maTodo', 'Ajouter')}</div>`;
    if (p.kind === 'exam' && su.exam !== p.date && fromIso(p.date) < addDays(new Date(), 150))
      return `<div class="prop"><b>Annonce : examen ${esc(de(su.name))} le ${dateLbl(fromIso(p.date))}</b><p>${said}. ${su.exam ? 'Tu avais noté le ' + dateLbl(fromIso(su.exam)) + '. ' : ''}Je l’utilise pour le mode Exam et les révisions ?</p>${btns('maExam', 'Ajouter')}</div>`;
    if (p.kind === 'cancel' && !(state.cancel || []).some(c => c.subj === subj && c.date === p.date) && state.courses.some(c => c.subj === subj && c.day === dow(fromIso(p.date)) && (!p.type || c.type === p.type)))
      return `<div class="prop"><b>Annonce : pas ${p.type === 'Exercices' ? 'd’exercices' : 'de cours'} ${esc(de(su.name))} le ${dateLbl(fromIso(p.date))}</b><p>${said}. Je libère ce créneau dans ton planning ?</p>${btns('maCancel', 'Libérer')}</div>`;
  }
  return '';
}
// things already done on Moodle (quiz taken, homework submitted) leave your backlog by themselves
function mdAutoDone() {
  if (!mdApi() || !moodle.actionOk) return;
  const evs = mdEvents(), now = Date.now(), gone = [];
  for (const b of state.backlog || []) {
    if (!b.mdUid || b.done) continue;
    const e = evs.find(x => x.uid === b.mdUid);
    if (e && !e.todo && e.dueAt > now + 3600e3) { if (!gone.length) beginChange(); b.done = true; b.doneAt = now; b.mdAuto = true; gone.push(b.title); }
  }
  if (gone.length) { save(); renderAll(); endChange('Fait sur Moodle', gone.join(', ') + ' : retiré de ton retard. Annulable dans l’onglet Retard.'); }
}
const annKey = an => an.course + ':' + an.id;
// what an announcement means for the planner: the AI reading when there is one, else the built-in reading
function annPlan(an) {
  if (an.ai) {
    const K = { add_mock: 'mock', add_exam: 'exam', cancel_session: 'cancel', room_change: 'room', deadline: 'deadline' }[an.ai.action];
    return K && an.ai.date ? { kind: K, date: an.ai.date, start: an.ai.start, end: an.ai.end, type: an.ai.session || '', room: an.ai.room, summary: an.ai.summary } : null;
  }
  return L.parseAnnounce(an.title, an.text, an.posted || an.time);
}
const annFind = k => ((moodle && moodle.announcements) || []).find(a => annKey(a) === String(k));
function mdAnnSheet(id) {
  const an = annFind(id); if (!an) return;
  const subj = mdCourseSubj(an.course), su = subj && subjOf(state, subj), d = new Date(an.time);
  openSheet(an.title, `<p class="hint" style="margin:-4px 0 12px;padding:0">${esc(su ? su.name : 'Moodle')} · ${dateLbl(d)} ${fmt(d.getHours() * 60 + d.getMinutes())}${an.author ? ' · ' + esc(an.author) : ''}</p>${an.ai && an.ai.summary ? `<div class="ann-sum"><b>En bref</b>${esc(an.ai.summary)}</div>` : ''}<div class="ann-text">${esc(an.text || '')}</div><div class="sh-actions"><a class="btn" href="https://moodle.epfl.ch/mod/forum/discuss.php?d=${encodeURIComponent(an.id)}" target="_blank" rel="noopener">Ouvrir sur Moodle</a></div>`, () => true);
}
function mdAnnList() {
  const as = (moodle && moodle.announcements) || [];
  if (!as.length) { toast('Aucune annonce ces 45 derniers jours'); return; }
  openSheet('Annonces des cours', `<div class="group">${as.map(an => { const subj = mdCourseSubj(an.course), su = subj && subjOf(state, subj); return `<button type="button" class="li" style="--c:${su ? esc(su.color) : '#F98012'}" data-act="mdAnn" data-v="${esc(annKey(an))}"><span class="dt"></span><span class="bd"><span class="ti">${esc(an.title)}</span><span class="su">${esc(su ? su.name : 'Moodle')} · ${dateLbl(new Date(an.time))}</span></span>${CHEV}</button>`; }).join('')}</div>`, () => true);
}
function mdAction(a, v, b) {
  if (a === 'mdConnect') { moodleConnect(); return true; }
  if (a === 'mdMap') { moodleMapSheet(); return true; }
  if (a === 'mdKey') { moodleKeySheet(); return true; }
  if (a === 'mdOpen') { mdOpen(v); return true; }
  if (a === 'mdAnn') { mdAnnSheet(v); return true; }
  if (a === 'mdAnnList') { mdAnnList(); return true; }
  if (a === 'maMock' || a === 'maExam' || a === 'maCancel' || a === 'maTodo') {
    const an = annFind(v); if (!an) return true;
    const subj = mdCourseSubj(an.course), p = annPlan(an); if (!subj || !p || !p.date) return true;
    beginChange();
    if (a === 'maMock') { const s0 = p.start != null ? p.start : 495; state.mocks.push({ id: uid(), subj, date: p.date, start: s0, end: p.end != null ? p.end : s0 + 105, place: '' }); }
    if (a === 'maExam') { const su = subjOf(state, subj); if (su) su.exam = p.date; }
    if (a === 'maTodo') state.backlog.push({ id: uid(), subj, title: (p.summary || an.title).slice(0, 90), minutes: 15, urgent: true, created: Date.now(), auto: false, maKey: annKey(an) });
    if (a === 'maCancel') { state.cancel = state.cancel || []; state.cancel.push({ date: p.date, subj, type: p.type || '' }); }
    done(); return true;
  }
  if (a === 'mdDocs') { mdDocsSheet(v); return true; }
  if (a === 'mdRename') { mdRename(v, b.dataset.s); return true; }
  if (a === 'mdDocsPick') { mdDocsPick(); return true; }
  if (a === 'mdCopyLaunch') { copyText('https://moodle.epfl.ch/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=12345&urlscheme=https', 'Lien copié : colle-le dans Safari'); return true; }
  if (a === 'mdRefresh') { (async () => { const d = await mdFetch(true); if (d && !d.error && mdApi()) { await post('/moodle/study', { k: syncKey() }).catch(() => { }); await mdFetch(true); } toast(d && !d.error ? 'Moodle à jour' : 'Moodle injoignable pour l’instant'); })(); return true; }
  if (a === 'mdOff') { post('/moodle', { k: syncKey(), remove: true }).catch(() => { }); state.moodleOn = false; moodle = null; lsSet(MD_LS, null); save(); renderAll(); toast('Moodle déconnecté'); return true; }
  const e = mdEvents().find(x => x.uid === v); if (!e) return a.startsWith('md');
  beginChange();
  if (a === 'mdExam') { const su = subjOf(state, e.subj); if (su) su.exam = e.date; done(); return true; }
  if (a === 'mdMock') { let s = mdMin(e.start), en = mdMin(e.end); if (!(en > s) || s < 420) { s = 495; en = 600; } state.mocks.push({ id: uid(), subj: e.subj, date: e.date, start: s, end: en, place: '' }); done(); return true; }
  if (a === 'mdDue') { state.backlog.push({ id: uid(), subj: e.subj, title: e.title, minutes: +b.dataset.m || 60, urgent: true, created: Date.now(), auto: false, mdUid: e.uid }); done(); return true; }
  return false;
}

/* ---------- Stretching ---------- */
let stretchTimer = null;
function stretchSheet(d, wk, id) {
  const r = L.STRETCH[d];
  openSheet('Stretching · ' + r.name, `<p class="hint" style="margin:-4px 0 12px;padding:0">5 exercices, 1 min chacun. Doucement, sans forcer ni faire de à-coups : tu dois sentir un étirement, jamais une douleur. Respire lentement.</p>
    <div class="group" id="stList">${r.moves.map((mv, i) => `<div class="st-row" data-i="${i}"><span class="st-n">${i + 1}</span><span class="bd"><span class="ti">${esc(mv[0])}${mv[3] ? ' <em class="tag cu">2 côtés</em>' : ''}</span><span class="su">${esc(mv[1])}</span></span><span class="st-t num" id="stT${i}">1:00</span></div>`).join('')}</div>
    <div class="st-now" id="stNow" hidden></div>
    <div class="sh-actions"><button type="button" class="btn pri" data-act="stretchGo" data-v="${d}" data-w="${wk}" data-id="${id}" id="stGo">Démarrer le minuteur</button></div>`);
}
function stretchRun(d, wk, id) {
  const r = L.STRETCH[d]; let i = 0, t = r.moves[0][2];
  const go = $('#stGo'), now = $('#stNow');
  clearInterval(stretchTimer);
  go.textContent = 'Arrêter'; go.dataset.act = 'stretchStop';
  const paint = () => {
    document.querySelectorAll('.st-row').forEach((el, k) => { el.classList.toggle('on', k === i); el.classList.toggle('ok', k < i); });
    const mv = r.moves[i], el = $('#stT' + i); if (el) el.textContent = Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
    now.hidden = false;
    now.innerHTML = `<b>${esc(mv[0])}</b><span>${mv[3] && t <= mv[2] / 2 ? 'Change de côté' : mv[3] ? 'Premier côté' : 'Tiens la position, respire'}</span>`;
  };
  paint();
  stretchTimer = setInterval(() => {
    if (!$('#stNow')) { clearInterval(stretchTimer); return; }
    t--;
    if (t <= 0) {
      i++;
      if (i >= r.moves.length) {
        clearInterval(stretchTimer);
        const dm = state.done[wk] = state.done[wk] || {}; dm[id] = { k: 'stretch', m: 5 }; save();
        now.innerHTML = '<b>Bravo, c’est fait</b><span>Le stretching du jour est coché.</span>';
        document.querySelectorAll('.st-row').forEach(el => el.classList.add('ok'));
        go.textContent = 'Fermer'; go.dataset.act = 'closeSheet';
        renderToday(); return;
      }
      t = r.moves[i][2];
    }
    paint();
  }, 1000);
}

/* ---------- Révisions d'examen blanc : quoi réviser dans chaque bloc ---------- */
// the material to cover: Moodle sections (cours, séries, corrigés) when Moodle is linked, else the semester weeks so far
function revTopics(subj, mockIso) {
  const md = fromIso(mockIso).getTime(), out = [];
  const fs = mdFiles(subj).filter(i => i.time < md && i.kind !== 'exam');
  if (fs.length) {
    const sec = {};
    for (const i of fs) { const k = i.section || 'Divers'; (sec[k] = sec[k] || { label: k, t: i.time, files: [] }); sec[k].t = Math.min(sec[k].t, i.time); sec[k].files.push(i.file); }
    Object.values(sec).sort((a, b) => a.t - b.t).slice(-14).forEach(x => out.push({ label: x.label, files: x.files }));
  } else {
    const n = Math.max(1, L.semWeek(state, mondayOf(fromIso(mockIso))) - 1);
    for (let k = 1; k <= Math.min(n, 14); k++) out.push({ label: 'Semaine ' + k, sub: 'cours + série ' + k, files: [] });
  }
  const ex = mdFiles(subj).filter(i => i.kind === 'exam');
  out.push({ label: 'Examen d’entraînement', sub: 'en conditions réelles, chrono', files: ex.map(i => i.file), last: true });
  return out;
}
// every revision block before this mock, in order, with the part of the material it covers
function revPlan(subj, mockIso) {
  const md = fromIso(mockIso), weeks = [mondayOf(addDays(md, -4)), mondayOf(md)].filter((w, i, a) => a.findIndex(x => +x === +w) === i);
  const blocks = [];
  for (const ws of weeks) {
    const wk = iso(ws), days = L.generate(state, ws), dm = state.done[wk] || {};
    for (const x of days) for (const e of x.ev) if (e.kind === 'study' && e.subj === subj && /examen blanc/.test(e.title) && x.date < md) blocks.push({ id: e.id, wk, at: x.date.getTime() + e.start * 6e4, len: e.end - e.start, done: !!dm[e.id] && e.state === 'done' });
  }
  blocks.sort((a, b) => a.at - b.at);
  const topics = revTopics(subj, mockIso), mk = subj + ':' + mockIso, kept = (state.revDone || {})[mk] || {};
  const covered = new Set(); for (const b of blocks) if (b.done && kept[b.id]) kept[b.id].forEach(i => covered.add(i));
  const left = topics.map((t, i) => i).filter(i => !covered.has(i));
  const todo = blocks.filter(b => !(b.done && kept[b.id]));
  const plan = {};
  for (const b of blocks) if (b.done && kept[b.id]) plan[b.id] = kept[b.id];
  // the practice exam gets the last block to itself when there are at least 2 blocks left
  const exI = topics.length - 1, lastAlone = todo.length >= 2 && left.includes(exI);
  const spread = lastAlone ? todo.slice(0, -1) : todo, pool = lastAlone ? left.filter(i => i !== exI) : left;
  if (lastAlone) plan[todo[todo.length - 1].id] = [exI];
  const total = spread.reduce((a, b) => a + b.len, 0) || 1; let acc = 0, from = 0;
  spread.forEach((b, k) => {
    acc += b.len;
    let to = k === spread.length - 1 ? pool.length : Math.round(pool.length * acc / total);
    if (to <= from && from < pool.length) to = from + 1;
    plan[b.id] = pool.slice(from, to); from = to;
  });
  return { topics, plan, mk };
}
// official exams: 3 passes over the whole material; each block takes the next topics not done yet in its pass
function examTopics(subj, examIso, pass) {
  const base = revTopics(subj, examIso).filter(t => !t.last);
  if (pass === 0) return base.map(t => ({ label: t.label, sub: 'cours + 1-2 exos clés', files: t.files }));
  if (pass === 1) return base.map(t => ({ label: t.label, sub: 'exos des séries sans corrigé', files: t.files }));
  const ex = mdFiles(subj).filter(i => i.kind === 'exam');
  const list = ex.length ? ex.map(i => ({ label: mdName(i), sub: 'en conditions réelles, puis correction', files: [i.file] })) : [1, 2, 3].map(k => ({ label: 'Ancien examen n°' + k, sub: 'en conditions réelles, puis correction', files: [] }));
  return list.concat([{ label: 'Points faibles', sub: 'refais les exos ratés des examens', files: [] }]);
}
function examPlanFor(e, x, dayEv) {
  const su = subjOf(state, e.subj); if (!su || !su.exam) return null;
  const pass = L.examPass(state, su.exam, x), topics = examTopics(e.subj, su.exam, pass), k = e.subj + ':' + su.exam + ':' + pass;
  const done = new Set(((state.examDone || {})[k]) || []);
  const mine = ((state.examBlk || {})[e.id]);
  if (mine && mine.k === k) return { su, pass, topics, idx: mine.idx, k, done, mine: true };
  // how fast to go: what's left of this pass over the campaign days left in it
  const ds = L.examDays(state, su.exam), from = ds.indexOf(iso(x)), passEnd = Math.floor(ds.length * [0.45, 0.8, 1][pass]);
  const daysLeft = Math.max(1, passEnd - Math.max(0, from)), left = topics.map((t, i) => i).filter(i => !done.has(i));
  const per = Math.max(1, Math.ceil(left.length / daysLeft));
  // several blocks the same day take consecutive topics
  const same = (dayEv || []).filter(z => z.kind === 'study' && z.subj === e.subj && /^Examen du /.test(z.title) && !(state.examBlk || {})[z.id] && z.state !== 'done').sort((a, b) => a.start - b.start);
  const rank = Math.max(0, same.findIndex(z => z.id === e.id)), perBlock = Math.max(1, Math.ceil(per / Math.max(1, same.length)));
  const at = Math.min(rank * perBlock, Math.max(0, left.length - perBlock));
  return { su, pass, topics, idx: left.slice(at, at + perBlock), k, done };
}
function examLine(e, x, dayEv) {
  const p = examPlanFor(e, x, dayEv); if (!p) return '';
  const ts = p.idx.map(i => p.topics[i]);
  const prog = `Passe ${p.pass + 1}/3 · ${p.done.size}/${p.topics.length} fait${p.done.size > 1 ? 's' : ''}`;
  if (!ts.length) return `<div class="su rev"><b>${prog}.</b> Cette passe est finie : refais ce qui t’a posé problème.</div>`;
  const hasFiles = ts.some(t => t.files.length);
  return `<div class="su rev"><b>À réviser :</b> ${esc(ts.map(t => t.label + ' (' + t.sub + ')').join(', '))}</div><div class="su rev">${prog}</div>${hasFiles ? `<div class="md-links"><button type="button" class="linkbtn mini" data-act="exDocs" data-v="${esc(e.id)}" data-w="${esc(iso(mondayOf(x)))}">Docs à réviser</button></div>` : ''}`;
}
function examRemember(wk, id, part) {
  const days = L.generate(state, fromIso(wk)); let e = null, x = null;
  let dev = null; for (const dd of days) { const f = dd.ev.find(z => z.id === id); if (f) { e = f; x = dd.date; dev = dd.ev; break; } }
  if (!e || !/^Examen du /.test(e.title)) return;
  const p = examPlanFor(e, x, dev); if (!p || !p.idx.length) return;
  const idx = part != null && part < 1 ? p.idx.slice(0, Math.floor(p.idx.length * part)) : p.idx;
  state.examDone = state.examDone || {}; state.examBlk = state.examBlk || {};
  state.examDone[p.k] = [...new Set((state.examDone[p.k] || []).concat(idx))];
  state.examBlk[id] = { k: p.k, idx };
}
function examForget(id) {
  const b = (state.examBlk || {})[id]; if (!b) return;
  state.examDone[b.k] = (state.examDone[b.k] || []).filter(i => !b.idx.includes(i)); delete state.examBlk[id];
}
function exDocsSheet(id, wk) {
  const days = L.generate(state, fromIso(wk)); let e = null, x = null;
  let dev = null; for (const dd of days) { const f = dd.ev.find(z => z.id === id); if (f) { e = f; x = dd.date; dev = dd.ev; break; } }
  const p = e && examPlanFor(e, x, dev); if (!p) return;
  const items = (moodle && moodle.items) || [];
  openSheet('À réviser', p.idx.map(i => p.topics[i]).map(t => `<div class="sec-t" style="margin:12px 0 6px">${esc(t.label)}</div><div class="group">${t.files.map(f => { const it = items.find(z => z.file === f); return it ? `<button type="button" class="li" data-act="mdOpen" data-v="${esc(f)}"><span class="bd"><span class="ti">${esc(mdName(it))}</span></span>${CHEV}</button>` : ''; }).join('') || '<div class="empty">Pas de document.</div>'}</div>`).join(''), () => true);
}
function revLine(e, key, xdate, dayEv) {
  if (e.kind === 'study' && e.subj && /^Examen du /.test(e.title) && xdate) return examLine(e, xdate, dayEv);
  if (e.kind !== 'study' || !e.subj || !/examen blanc/.test(e.title)) return '';
  const m = /\((\S+) (\d{1,2})\)/.exec(e.title); const mock = (state.mocks || []).filter(x => x.subj === e.subj && x.date >= key).sort((a, b) => a.date < b.date ? -1 : 1).find(x => fromIso(x.date).getDate() === +(m ? m[2] : -1));
  if (!mock) return '';
  const { topics, plan } = revPlan(e.subj, mock.date), idx = plan[e.id] || [];
  if (!idx.length) return `<div class="su rev">Tout est couvert : refais les exos qui t’ont posé problème.</div>`;
  const ts = idx.map(i => topics[i]);
  const label = ts.length <= 3 ? ts.map(t => t.label + (t.sub ? ' (' + t.sub + ')' : '')).join(', ') : ts[0].label + ' → ' + ts[ts.length - 1].label;
  const hasFiles = ts.some(t => t.files.length);
  return `<div class="su rev"><b>À réviser :</b> ${esc(label)}</div>${hasFiles ? `<div class="md-links"><button type="button" class="linkbtn mini" data-act="revDocs" data-v="${esc(e.subj)}" data-d="${esc(mock.date)}" data-id="${esc(e.id)}">Docs à réviser</button></div>` : ''}`;
}
function revDocsSheet(subj, mockIso, id) {
  const { topics, plan } = revPlan(subj, mockIso), idx = plan[id] || [];
  const items = ((moodle && moodle.items) || []);
  const rows = idx.map(i => topics[i]).map(t => `<div class="sec-t" style="margin:12px 0 6px">${esc(t.label)}</div><div class="group">${t.files.map(f => { const it = items.find(x => x.file === f); return it ? `<button type="button" class="li" data-act="mdOpen" data-v="${esc(f)}"><span class="bd"><span class="ti">${esc(mdName(it))}</span></span>${CHEV}</button>` : ''; }).join('') || '<div class="empty">Pas de document.</div>'}</div>`).join('');
  openSheet('À réviser', rows || '<div class="empty">Rien à ouvrir pour ce bloc.</div>', () => true);
}
// when a revision block is ticked, the material it covered stays covered; the rest moves to the next blocks
function revRemember(wk, id, part) {
  for (const mk of state.mocks || []) {
    const { plan, mk: key } = revPlan(mk.subj, mk.date); if (!(id in plan)) continue;
    let idx = plan[id]; if (part != null && part < 1) idx = idx.slice(0, Math.max(0, Math.floor(idx.length * part)));
    state.revDone = state.revDone || {}; (state.revDone[key] = state.revDone[key] || {})[id] = idx;
  }
}
function revForget(id) { for (const k of Object.keys(state.revDone || {})) delete state.revDone[k][id]; }

/* ---------- Focus : chrono d'étude ----------
 * You start a block (or a free session), the clock runs from timestamps (so it survives closing the app),
 * and at the end the real time is what counts: the block is ticked with the minutes you actually spent,
 * so the planner learns your real pace. */
let focusTick = null;
/* keep the screen on and make a short sound at the end of a phase (only while the app is open) */
let wakeLock = null, audioCtx = null, foLastPhase = '';
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { wakeLock = null; }
}
function unlockAudio() { try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch (e) { } }
function beep(n = 1, hz = 880) {
  try {
    if (!audioCtx) return; const t0 = audioCtx.currentTime;
    for (let i = 0; i < n; i++) { const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.frequency.value = hz; o.connect(g); g.connect(audioCtx.destination); const t = t0 + i * 0.28; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2); o.start(t); o.stop(t + 0.22); }
  } catch (e) { }
  if (navigator.vibrate) navigator.vibrate(n > 1 ? [200, 120, 200] : 200);
}
const FO = () => (state.focus = state.focus || { run: null, log: [] });
const foRun = () => (state.focus || {}).run || null;
const foElapsed = r => r ? Math.max(0, ((r.pauseAt || Date.now()) - r.start - (r.paused || 0))) : 0;
const mmss2 = ms => { const t = Math.floor(ms / 1000), h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
function findBlock(wk, id) {
  if (!wk || !id) return null;
  const days = L.generate(state, fromIso(wk));
  for (const x of days) { const e = x.ev.find(z => z.id === id); if (e) return { e, x, days }; }
  return null;
}
// the pomodoro phase at a given elapsed time
function foPhase(r) {
  const el = foElapsed(r) / 6e4;
  if (!r.pomo) return { work: true, n: 0, left: r.plan ? r.plan - el : null };
  const n = Math.floor(el / 30), inC = el - n * 30;
  return inC < 25 ? { work: true, n, left: 25 - inC } : { work: false, n, left: 30 - inC };
}
function foStart(opt) {
  const cur = foRun();
  if (cur) { toast('Un focus tourne déjà : termine-le d’abord'); foOpen(); return; }
  beginChange();
  unlockAudio(); keepAwake(true); foLastPhase = '';
  FO().run = { id: opt.id || null, wk: opt.wk || null, subj: opt.subj || null, title: opt.title || 'Focus libre', plan: opt.plan || 0, start: Date.now(), paused: 0, pauseAt: null, pomo: !!opt.pomo, fixed: !!opt.fixed };
  save(); endChange(); foOpen(); renderFocusBar();
}
function foPause() { const r = foRun(); if (!r) return; if (r.pauseAt) { r.paused += Date.now() - r.pauseAt; r.pauseAt = null; } else r.pauseAt = Date.now(); save(); foPaint(); }
// end: finished → the block is ticked with the real time; not finished → ticked at the share done, the rest gets replanned
function foStop(finished) {
  const r = foRun(); if (!r) return;
  const ms = foElapsed(r), min = Math.max(1, Math.round(ms / 6e4));
  beginChange();
  const f = FO(); f.run = null; keepAwake(false);
  f.log = (f.log || []).concat([{ at: r.start, end: Date.now(), wk: r.wk, id: r.id, subj: r.subj, title: r.title, ms, plan: r.plan || 0, fin: !!finished }]).slice(-400);
  if (min >= 3) {
    const wk = r.wk || iso(mondayOf(new Date(r.start)));
    const d = state.done[wk] = state.done[wk] || {};
    const fb = r.id ? findBlock(wk, r.id) : null;
    if (fb && !d[r.id]) {
      const ev = fb.e, plan = ev.end - ev.start;
      revRemember(wk, r.id, finished ? null : Math.min(.95, min / plan)); examRemember(wk, r.id, finished ? null : Math.min(.95, min / plan));
      d[r.id] = { s: ev.subj, t: ev.title, m: min, d: fb.x.d, a: ev.start, serie: ev.serie, c: !!ev.corr || undefined, fx: !!ev.fixed, b: ev.bl || undefined, focus: true };
      if (!finished) d[r.id].p = Math.max(.05, Math.min(.95, min / plan));
    } else if (!r.id && r.subj) {
      // free session: it shows in the day and counts for that subject
      const st = new Date(r.start), sm = st.getHours() * 60 + st.getMinutes();
      d['f-' + r.start] = { s: r.subj, t: r.title, m: min, d: dow(st), a: Math.floor(sm / 5) * 5, free: true, focus: true };
    }
  }
  save(); renderAll(); endChange(min >= 3 ? 'Focus enregistré' : 'Focus arrêté', min >= 3 ? `${esc(r.title)} · ${hm(min)} de vrai travail${r.plan ? ' (prévu ' + hm(r.plan) + ')' : ''}. Ton planning tient compte du temps réel.` : 'Moins de 3 min : rien d’enregistré.');
  foPaint(); renderFocusBar();
}
function foCancel() { const r = foRun(); if (!r) return; FO().run = null; keepAwake(false); save(); foPaint(); renderFocusBar(); toast('Focus annulé, rien d’enregistré'); }
// what to start now: the block in progress, else the next one today
function foSuggest() {
  const now = new Date(), wk = iso(mondayOf(now)), days = L.generate(state, mondayOf(now)), x = days[dow(now)], mins = now.getHours() * 60 + now.getMinutes();
  const todo = x.ev.filter(e => e.kind === 'study' && e.state === 'todo' && e.end > mins - 30).sort((a, b) => a.start - b.start);
  const missed = x.ev.filter(e => e.kind === 'study' && e.state === 'missed').sort((a, b) => b.start - a.start);
  return { wk, x, todo, missed, mins };
}
function foBlockRow(e, wk, big) {
  const su = subjOf(state, e.subj);
  return `<div class="li fo-row${big ? ' big' : ''}" style="--c:${esc((su || {}).color || 'var(--faint)')}"><span class="dt"></span><span class="bd"><span class="ti">${esc(e.title)}</span><span class="su"><span class="num">${fmt(e.start)}–${fmt(e.end)}</span> · ${esc(su ? su.name : '')}${e.state === 'missed' ? ' · raté, à rattraper' : ''}</span></span><button type="button" class="fo-play" data-act="foGo" data-v="${esc(e.id)}" data-w="${wk}" aria-label="Lancer le focus"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg></button></div>`;
}
function renderFocus() {
  const box = $('#focusBody'); if (!box) return;
  const r = foRun();
  let h = APP !== 'main' ? linkCard() : `<button type="button" class="back" data-tab-go="today">‹ Aujourd’hui</button>`;
  h += r ? `<div class="sp-head"><h1>Focus</h1></div>` : `<div class="sp-head"><h1>Focus</h1><p>Lance un bloc, travaille, et le vrai temps passé recale ton planning.</p></div>`;
  if (r) h += `<div id="foLive"></div>`;
  else {
    const s = foSuggest();
    const first = s.todo[0];
    h += first ? `<div class="sec-t">Maintenant</div><div class="group">${foBlockRow(first, s.wk, true)}</div>` : `<div class="group"><div class="empty">Plus de bloc prévu aujourd’hui. Tu peux lancer un focus libre.</div></div>`;
    const rest = s.todo.slice(1, 6).concat(s.missed.slice(0, 3));
    if (rest.length) h += `<div class="sec-t">Aujourd’hui</div><div class="group">${rest.map(e => foBlockRow(e, s.wk)).join('')}</div>`;
    h += `<div class="fo-opts"><label class="fo-pomo"><input type="checkbox" id="foPomo" ${state.focusPomo ? 'checked' : ''}> <span><b>Pomodoro</b> · 25 min de focus, 5 min de pause</span></label></div>
      <div class="btns"><button type="button" class="btn" data-act="foFree">Focus libre</button></div>`;
  }
  h += focusStats();
  box.innerHTML = h;
  const pc = $('#foPomo'); if (pc) pc.onchange = () => { state.focusPomo = pc.checked; save(); };
  foPaint();
}
function foPaint() {
  const live = $('#foLive'), r = foRun();
  if (!live) return;
  if (!r) { renderFocus(); return; }
  const el = foElapsed(r), ph = foPhase(r), su = subjOf(state, r.subj);
  const phKey = r.pauseAt ? 'pause' : r.pomo ? (ph.work ? 'w' : 'b') + ph.n : (r.plan && el > r.plan * 6e4 ? 'over' : 'on');
  if (foLastPhase && phKey !== foLastPhase && phKey !== 'pause' && foLastPhase !== 'pause') beep(2, phKey.startsWith('b') ? 660 : 880);
  foLastPhase = phKey;
  const target = r.pomo ? (ph.work ? 25 : 5) * 6e4 : (r.plan || 0) * 6e4;
  const inPhase = r.pomo ? (ph.work ? (25 - ph.left) : (5 - ph.left)) * 6e4 : el;
  const pct = target ? Math.min(1, inPhase / target) : 0, over = !r.pomo && r.plan && el > r.plan * 6e4;
  const R = 112, C = 2 * Math.PI * R;
  let extra = '';
  if (r.id && r.wk) { const fb = findBlock(r.wk, r.id); if (fb) extra = revLine(fb.e, r.wk, fb.x.date, fb.x.ev) + mdBlockLinks(fb.e, r.wk); }
  live.innerHTML = `<div class="fo-live${r.pauseAt ? ' paused' : ''}${r.pomo && !ph.work ? ' brk' : ''}" style="--c:${esc((su || {}).color || 'var(--acc)')}">
    <div class="fo-k">${r.pauseAt ? 'En pause' : r.pomo ? (ph.work ? 'Focus ' + (ph.n + 1) : 'Pause ' + (ph.n + 1) + ' · lève-toi') : over ? 'Temps prévu dépassé' : 'En cours'}</div>
    <div class="fo-ring"><svg viewBox="0 0 260 260"><circle cx="130" cy="130" r="${R}" class="tr"/><circle cx="130" cy="130" r="${R}" class="pr" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/></svg>
      <div class="fo-t"><div class="num">${mmss2(el)}</div><small>${r.pomo ? (ph.work ? 'pause dans ' : 'reprise dans ') + Math.ceil(ph.left) + ' min' : r.plan ? 'sur ' + hm(r.plan) + ' prévues' : 'focus libre'}</small></div></div>
    <div class="fo-n">${esc(r.title)}</div><div class="fo-s">${esc(su ? su.name : '')}</div>
    <div class="fo-extra">${extra}</div>
    <div class="fo-btns"><button type="button" class="btn" data-act="foPause">${r.pauseAt ? 'Reprendre' : 'Pause'}</button><button type="button" class="btn pri" data-act="foEnd">Terminer</button></div>
    <button type="button" class="linkbtn mini" data-act="foCancel" style="margin-top:12px">Annuler sans enregistrer</button></div>`;
  clearTimeout(focusTick); focusTick = setTimeout(() => { if (tab === 'focus' && document.visibilityState === 'visible') foPaint(); renderFocusBar(); }, 1000 - (Date.now() % 1000));
}
function foEndSheet() {
  const r = foRun(); if (!r) return;
  const min = Math.round(foElapsed(r) / 6e4);
  if (!r.id) { foStop(true); return; }
  openSheet('Fin du focus', `<p style="margin:0 0 14px;color:var(--muted)">${esc(r.title)} · ${hm(Math.max(1, min))} de travail${r.plan ? ' sur ' + hm(r.plan) + ' prévues' : ''}.</p>
    <div class="btns" style="flex-direction:column;align-items:stretch;padding:0"><button type="button" class="btn pri" data-act="foStop" data-v="1">Bloc fini ✓</button><button type="button" class="btn" data-act="foStop" data-v="0">Pas fini · replanifie le reste</button></div>`);
}
function foFreeSheet() {
  openSheet('Focus libre', `<div class="fields">${F.select('subj', 'Matière', subjOpts(), (state.subjects[0] || {}).id)}${F.text('title', 'Sur quoi ?', '', 'full', 'ex. Fiche résumé, exos en plus…')}${F.select('plan', 'Durée visée', [[0, 'Pas de limite'], [25, '25 min'], [50, '50 min'], [90, '1h30']], 50)}</div><div class="sh-actions"><button type="submit" class="btn pri">Lancer</button></div>`, fd => {
    const su = subjOf(state, fd.subj);
    setTimeout(() => foStart({ subj: fd.subj, title: (String(fd.title || '').trim() || 'Focus libre') + (su ? '' : ''), plan: +fd.plan || 0, pomo: !!state.focusPomo }), 350);
    return true;
  });
}
function foOpen() { if (APP === 'main' || APP === 'focus') showTab('focus'); else showTab('focus'); }
// the bar above the navigation while a focus runs (every screen, every app)
function renderFocusBar() {
  let bar = $('#foBar'); const r = foRun();
  if (!r) { if (bar) bar.remove(); return; }
  if (!bar) { bar = document.createElement('button'); bar.id = 'foBar'; bar.type = 'button'; bar.dataset.act = 'foOpen'; document.body.appendChild(bar); }
  const ph = foPhase(r);
  bar.className = 'fo-bar' + (r.pauseAt ? ' paused' : '') + (tab === 'focus' ? ' hide' : '');
  bar.innerHTML = `<span class="dot"></span><span class="t">${esc(r.title)}</span><span class="num">${r.pomo && !ph.work ? 'pause' : mmss2(foElapsed(r))}</span>`;
  if (tab !== 'focus') { clearTimeout(renderFocusBar.t); renderFocusBar.t = setTimeout(renderFocusBar, 1000); }
}
// what the clock says about you
function focusStats() {
  const log = ((state.focus || {}).log || []), now = new Date(), ws = mondayOf(now), wk = iso(ws);
  if (!log.length) return `<div class="sec-t">Tes stats</div><div class="group"><div class="empty">Tes stats apparaîtront après ton premier focus.</div></div>`;
  const day = t => iso(new Date(t)), min = l => l.reduce((a, x) => a + x.ms, 0) / 6e4;
  const today = log.filter(x => day(x.at) === todayIso()), week = log.filter(x => x.at >= ws.getTime());
  const byDay = Array.from({ length: 7 }, (_, i) => min(week.filter(x => day(x.at) === iso(addDays(ws, i)))));
  const plan = L.generate(state, ws).map(x => x.plan || 0);
  const mx = Math.max(60, ...byDay, ...plan);
  const bars = byDay.map((m, i) => `<div class="fo-bc"><div class="fo-bw"><i class="p" style="height:${Math.round(plan[i] / mx * 100)}%"></i><i class="f" style="height:${Math.round(m / mx * 100)}%"></i></div><small>${DAYS_S[i]}</small></div>`).join('');
  const subj = {}; for (const x of week) if (x.subj) subj[x.subj] = (subj[x.subj] || 0) + x.ms / 6e4;
  const subjRows = Object.entries(subj).sort((a, b) => b[1] - a[1]).map(([k, m]) => { const su = subjOf(state, k); return `<div class="fo-sr"><span style="--c:${esc((su || {}).color || 'var(--faint)')}"><i style="width:${Math.round(m / Math.max(...Object.values(subj)) * 100)}%"></i></span><b>${esc(su ? su.name : k)}</b><em class="num">${hm(Math.round(m))}</em></div>`; }).join('');
  // streak: days in a row with at least 45 min of focus
  let streak = 0; for (let d = new Date(now); ; d = addDays(d, -1)) { const m = min(log.filter(x => day(x.at) === iso(d))); if (m >= 45) streak++; else if (iso(d) !== todayIso()) break; if (streak > 365) break; }
  // pace: real time vs planned time on finished blocks
  const fin = log.filter(x => x.fin && x.plan >= 20).slice(-30), ratio = fin.length >= 3 ? fin.reduce((a, x) => a + x.ms / 6e4, 0) / fin.reduce((a, x) => a + x.plan, 0) : null;
  const pace = ratio == null ? '' : ratio < .9 ? `Tu finis tes blocs en ${Math.round(ratio * 100)} % du temps prévu : l’app te donne moins de temps par bloc là où c’est sûr.` : ratio > 1.1 ? `Tes blocs te prennent ${Math.round(ratio * 100)} % du temps prévu : l’app prévoit plus large pour tes séries.` : 'Tes blocs durent à peu près ce qui est prévu : ton planning est juste.';
  const avg = Math.round(min(log.slice(-20)) / Math.min(20, log.length));
  return `<div class="sec-t">Cette semaine</div><div class="group fo-stats">
    <div class="fo-kpi"><div><b>${hm(Math.round(min(today)))}</b><small>aujourd’hui</small></div><div><b>${hm(Math.round(min(week)))}</b><small>cette semaine</small></div><div><b>${streak} j</b><small>série de jours</small></div><div><b>${hm(avg)}</b><small>par session</small></div></div>
    <div class="fo-bars">${bars}</div><div class="fo-leg"><span><i class="f"></i>focus réel</span><span><i class="p"></i>prévu</span></div>
    ${subjRows ? `<div class="fo-subj">${subjRows}</div>` : ''}
    ${pace ? `<p class="fo-pace">${pace}</p>` : ''}</div>`;
}
function focusAction(a, v, b) {
  switch (a) {
    case 'foOpen': foOpen(); return true;
    case 'foGo': {
      const fb = findBlock(b.dataset.w, v); if (!fb) { toast('Bloc introuvable'); return true; }
      const e = fb.e; foStart({ id: e.id, wk: b.dataset.w, subj: e.subj, title: e.title, plan: e.end - e.start, pomo: !!state.focusPomo, fixed: !!e.fixed });
      return true;
    }
    case 'foPause': foPause(); return true;
    case 'foEnd': foEndSheet(); return true;
    case 'foStop': closeSheet(); setTimeout(() => foStop(v === '1'), 250); return true;
    case 'foCancel': foCancel(); return true;
    case 'foFree': foFreeSheet(); return true;
  }
  return false;
}

/* ---------- Espace Sport : prochaine séance, progrès, historique ---------- */
const spLog = () => state.sportLog || [];
// every 6th week of training is lighter (one set less, no new targets): muscles grow when they recover
function sportLightWeek(at) {
  const wk = iso(mondayOf(at ? new Date(at) : new Date()));
  if (state.sportLight && state.sportLight[wk] != null) return !!state.sportLight[wk];
  const weeks = [...new Set(spLog().map(x => iso(mondayOf(new Date(x.at)))))].filter(w => w < wk);
  return weeks.length >= 5 && weeks.length % 5 === 0;
}
function sportNextBlock() {
  const now = new Date();
  for (const ws of [mondayOf(now), addDays(mondayOf(now), 7)]) {
    const wk = iso(ws), days = L.generate(state, ws), dm = state.done[wk] || {};
    for (const x of days) for (const e of x.ev) if (e.kind === 'sport' && !dm[e.id] && x.date.getTime() + e.end * 6e4 > now.getTime()) return { e, x, wk };
  }
  return null;
}
function exHistory(id) {
  return spLog().filter(s => s.reps && s.reps[id]).map(s => ({ at: s.at, reps: s.reps[id], lv: s.lv ? s.lv[id] : null }));
}
function spark(vals, h = 34, w = 120) {
  if (vals.length < 2) return '';
  const mx = Math.max(...vals), mn = Math.min(...vals), r = mx - mn || 1;
  const pts = vals.map((v, i) => `${Math.round(i / (vals.length - 1) * w)},${Math.round(h - 4 - (v - mn) / r * (h - 8))}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}"/></svg>`;
}
function renderSport() {
  const box = $('#sportBody'); if (!box) return;
  const nb = sportNextBlock(), light = sportLightWeek(), log = spLog();
  let h = APP !== 'main' ? linkCard() : `<button type="button" class="back" data-tab-go="today">‹ Aujourd’hui</button>`;
  h += `<div class="sp-head"><h1>Sport</h1><p>Planche à pompes + câbles · 3 séances qui tournent, objectifs qui montent tout seuls.</p></div>`;
  if (light) h += `<div class="prop"><b>Semaine légère</b><p>Une série de moins par exercice, mêmes objectifs : c’est la semaine où tes muscles récupèrent et se renforcent. Ça revient à la normale la semaine prochaine.</p></div>`;
  if (nb) {
    const w = SP.workouts[nb.e.wi != null ? nb.e.wi : (state.sportNext || 0) % SP.workouts.length];
    const today = iso(nb.x.date) === todayIso();
    h += `<div class="sp-next"><div class="k">${today ? 'Aujourd’hui' : DAYS[nb.x.d] + ' ' + dateLbl(nb.x.date)} · ${fmt(nb.e.start)}</div><div class="t">${esc(w.name)}</div><div class="s">${esc(w.focus)} · ~45 min</div>
      <div class="sp-exl">${w.ex.map(e => `<span>${esc(e.name.split(' · ')[0])}</span>`).join('')}</div>
      <button type="button" class="btn pri" data-act="sportSheet" data-w="${nb.wk}" data-id="${esc(nb.e.id)}">${today ? 'Voir la séance' : 'Voir la séance'}</button></div>`;
  }
  h += `<div class="btns"><button type="button" class="btn" data-act="spFree">Séance hors planning</button></div>`;
  // the week
  const ws = mondayOf(new Date()), wk = iso(ws), days = L.generate(state, ws), dm = state.done[wk] || {};
  const sess = days.flatMap(x => x.ev.filter(e => e.kind === 'sport').map(e => ({ e, x })));
  const doneN = sess.filter(z => dm[z.e.id]).length;
  let streak = 0; for (let w0 = addDays(ws, -7); ; w0 = addDays(w0, -7)) { const n = log.filter(x => x.at >= w0.getTime() && x.at < addDays(w0, 7).getTime()).length; if (n >= 2) streak++; else break; if (streak > 100) break; }
  h += `<div class="sec-t">Cette semaine</div><div class="group fo-stats"><div class="fo-kpi"><div><b>${doneN}/${sess.length}</b><small>séances</small></div><div><b>${log.length}</b><small>séances en tout</small></div><div><b>${streak}</b><small>semaines d’affilée</small></div></div>
    <div class="sp-week">${sess.map(z => `<span class="${dm[z.e.id] ? 'ok' : ''}"><b>${DAYS_S[z.x.d]}</b>${esc(z.e.workout || '')}</span>`).join('')}</div></div>`;
  // progress per exercise
  h += `<div class="sec-t">Tes progrès</div>`;
  const openW = nb && nb.e.wi != null ? nb.e.wi : (state.sportNext || 0) % SP.workouts.length;
  for (const [wi, w] of SP.workouts.entries()) {
    h += `<details class="group sp-prog-g"${wi === openW ? ' open' : ''}><summary class="sp-wh">${esc(w.id)} · ${esc(w.name)}<span>${w.ex.length} exercices</span></summary>${w.ex.map(e => {
      const lv = L.sportLevel(state, e.id), hist = exHistory(e.id);
      const best = hist.length ? Math.max(...hist.flatMap(x => x.reps)) : null;
      const vals = hist.map(x => x.reps.reduce((a, r) => a + r, 0) / x.reps.length + (x.lv != null ? x.lv * 20 : 0));
      return `<div class="sp-ex"><div class="bd"><div class="ti">${esc(e.name)}</div><div class="su">${esc(e.levels[lv.lvl][0])} · objectif ${lv.target}${e.time ? ' s' : ''}${best != null ? ' · record ' + best + (e.time ? ' s' : '') : ''}</div><div class="sp-lvl">${e.levels.map((_, i) => `<i class="${i < lv.lvl ? 'ok' : i === lv.lvl ? 'on' : ''}"></i>`).join('')}</div></div>${spark(vals.slice(-12))}</div>`;
    }).join('')}</details>`;
  }
  // history
  h += `<div class="sec-t">Historique</div><div class="group">${log.slice(-12).reverse().map(s => { const w = SP.workouts.find(x => x.id === s.w); let reps = 0, secs = 0; for (const [id, arr] of Object.entries(s.reps || {})) { const ex = (w ? w.ex : []).find(z => z.id === id); const t = arr.reduce((a, r) => a + r, 0); if (ex && ex.time) secs += t; else reps += t; } const d = new Date(s.at); return `<div class="li"><span class="bd"><span class="ti">${esc(w ? w.name : s.w)}${s.light ? ' · légère' : ''}</span><span class="su">${DAYS[dow(d)]} ${dateLbl(d)}${s.min ? ' · ' + hm(s.min) : ''} · ${reps} reps${secs ? ' · ' + secs + ' s de gainage/cardio' : ''}</span></span></div>`; }).join('') || '<div class="empty">Ta première séance apparaîtra ici.</div>'}</div>`;
  box.innerHTML = h;
}
function spFreeSheet() {
  openSheet('Séance hors planning', `<p class="hint" style="margin:-4px 0 12px;padding:0">Elle compte dans tes progrès. La rotation continue après celle que tu choisis.</p><div class="btns" style="flex-direction:column;align-items:stretch;padding:0">${SP.workouts.map((w, i) => `<button type="button" class="btn${i === (state.sportNext || 0) % SP.workouts.length ? ' pri' : ''}" data-act="sportGo" data-v="${i}" data-w="${iso(mondayOf(new Date()))}" data-id="">${esc(w.name)}</button>`).join('')}</div>`);
}

/* ---------- the Focus and Sport icons share your data through your link ---------- */
function foBtn(e, key, sel) {
  if (e.kind !== 'study' || !(e.state === 'todo' || e.state === 'missed') || iso(sel) !== todayIso()) return '';
  const r = foRun();
  if (r && r.id === e.id) return `<div class="md-links"><button type="button" class="linkbtn mini fo on" data-act="foOpen">● Focus en cours · ${mmss2(foElapsed(r))}</button></div>`;
  return `<div class="md-links"><button type="button" class="linkbtn mini fo" data-act="foGo" data-v="${esc(e.id)}" data-w="${key}">▶ Focus</button></div>`;
}
function linkCard() {
  if (syncKey()) return '';
  return `<div class="prop link-card"><b>Relie cette icône à ton app</b><p>Sur iPhone, chaque icône a sa propre mémoire. Dans l’app principale : Réglages → Mes appareils → Copier le lien, puis colle-le ici.</p>
    <div class="fields" style="margin:8px 0 0">${F.text('lk', 'Ton lien', '', 'full', 'https://…#lien-…')}</div>
    <div class="btns" style="padding:8px 0 0"><button type="button" class="btn" data-act="lkPaste">Coller</button><button type="button" class="btn pri" data-act="lkGo">Relier</button></div></div>`;
}
async function lkGo(txt) {
  const m = /lien-([a-f0-9]{32})/.exec(txt || '') || /^\s*([a-f0-9]{32})\s*$/.exec((txt || '').replace(/\s/g, ''));
  if (!m) { toast('Colle le lien complet (il finit par #lien-…)'); return; }
  await linkWith(m[1]); renderAll(); if (tab === 'focus') renderFocus(); if (tab === 'sport') renderSport();
}
const iconUrl = (page, k) => location.href.split('#')[0].replace(/[^/]*$/, '') + page + (k ? '#lien-' + k : '');
async function iconsSheet() {
  if (!syncKey()) { await ensureKey(); }
  const k = syncKey();
  openSheet('Icônes Focus et Sport', `<p style="margin:0 0 12px;color:var(--muted)">Deux icônes de plus sur ton écran d’accueil : elles ouvrent directement le chrono ou le sport, avec ton planning à jour.</p>
    <div class="ic-row"><img src="icons/focus-192.png" alt=""><div><b>Focus</b><small>Chrono d’étude et stats</small></div><button type="button" class="btn" data-act="icCopy" data-v="focus.html">Copier le lien</button></div>
    <div class="ic-row"><img src="icons/sport-192.png" alt=""><div><b>Sport</b><small>Séances, progrès, historique</small></div><button type="button" class="btn" data-act="icCopy" data-v="sport.html">Copier le lien</button></div>
    <ol class="steps" style="margin-top:14px"><li>Copie un lien, colle-le dans <b>Safari</b> et ouvre-le</li><li>Partager → <b>Sur l’écran d’accueil</b></li><li>Ouvre la nouvelle icône : si elle te le demande, colle le même lien (il est encore copié)</li></ol>
    <p class="hint">Garde ces liens pour toi : ils donnent accès à ton planning. ${k ? '' : 'Active d’abord la synchro dans Mes appareils.'}</p>`);
}

/* ---------- Sport : séances guidées avec la planche à pompes + câbles ---------- */
let sportTimer = null, sportRun = null;
const SP = L.SPORT;
// which workout each sport block of the week gets: the rotation continues where you left off
function sportPlanFor(key, days) {
  const out = {};
  for (const x of days) for (const e of x.ev) if (e.kind === 'sport' && e.wi != null) out[e.id] = e.wi;
  return out;
}
function sportWorkoutOf(key, id) { const ws = fromIso(key); const p = sportPlanFor(key, L.generate(state, ws, new Date())); return p[id] != null && p[id] >= 0 ? p[id] : (state.sportNext || 0) % SP.workouts.length; }
const setsOf = (e, light) => light ? Math.max(2, e.sets - 1) : e.sets;
const exLine = e => { const lv = L.sportLevel(state, e.id); return `${setsOf(e, sportLightWeek())} × ${lv.target}${e.time ? ' s' : ''}${e.side ? ' (par côté)' : ''} · ${e.levels[lv.lvl][0]}`; };
function sportSheet(key, id) {
  const wi = sportWorkoutOf(key, id), w = SP.workouts[wi];
  const others = SP.workouts.map((x, i) => i === wi ? '' : `<button type="button" class="btn" data-act="sportPick" data-v="${i}" data-w="${key}" data-id="${esc(id)}">${esc(x.name)}</button>`).join('');
  openSheet('Sport · ' + w.name, `<p class="hint" style="margin:-4px 0 12px;padding:0">${esc(w.focus)} · ~45 min avec l’échauffement. Les objectifs montent tout seuls d’une séance à l’autre selon ce que tu fais.</p>
    <div class="group">${w.ex.map((e, i) => `<div class="st-row"><span class="st-n">${i + 1}</span><span class="bd"><span class="ti">${esc(e.name)}</span><span class="su">${esc(exLine(e))}</span></span></div>`).join('')}</div>
    <p class="hint" style="margin:10px 0 0">Autre séance aujourd’hui ?</p><div class="btns" style="padding:6px 0 0">${others}</div>
    <div class="sh-actions"><button type="button" class="btn pri" data-act="sportGo" data-v="${wi}" data-w="${key}" data-id="${esc(id)}">Commencer (échauffement 4 min)</button></div>`);
}
function sportStart(wi, key, id) {
  const w = SP.workouts[wi];
  unlockAudio(); keepAwake(true);
  sportRun = { wi, key, id, step: 'warm', wIdx: 0, t: SP.warm[0][2], ex: 0, set: 0, reps: {}, lv: {}, startedAt: Date.now(), light: sportLightWeek() };
  openSheet('Sport · ' + w.name, `<div id="spBox" class="sp-box"></div><div class="sh-actions" id="spAct"></div>`);
  sportPaint(); sportTick();
}
function sportTick() {
  clearInterval(sportTimer);
  sportTimer = setInterval(() => {
    if (!$('#spBox') || !sportRun) { clearInterval(sportTimer); return; }
    const r = sportRun;
    if (r.step === 'warm' || r.step === 'rest' || (r.step === 'timed' && r.going)) {
      r.t--;
      if (r.t <= 0) {
        if (r.step === 'warm') { r.wIdx++; beep(1, 660); if (r.wIdx >= SP.warm.length) { r.step = 'set'; } else r.t = SP.warm[r.wIdx][2]; }
        else if (r.step === 'rest') { r.step = 'set'; beep(2); }
        else if (r.step === 'timed') { r.going = false; beep(2); sportLog(r.target); return; }
        if (navigator.vibrate) navigator.vibrate(200);
      }
      sportPaint();
    }
  }, 1000);
}
const mmss = t => Math.floor(t / 60) + ':' + String(Math.max(0, t) % 60).padStart(2, '0');
function sportPaint() {
  const r = sportRun, box = $('#spBox'), act = $('#spAct'); if (!r || !box) return;
  const w = SP.workouts[r.wi], e = w.ex[r.ex];
  const prog = `<div class="sp-prog">${w.ex.map((x, i) => `<i class="${i < r.ex ? 'ok' : i === r.ex && r.step !== 'warm' ? 'on' : ''}"></i>`).join('')}</div>`;
  if (r.step === 'warm') {
    const m = SP.warm[r.wIdx];
    box.innerHTML = `${prog}<div class="sp-k">Échauffement · ${r.wIdx + 1}/${SP.warm.length}</div><div class="sp-n">${esc(m[0])}</div><div class="sp-h">${esc(m[1])}</div><div class="sp-big num">${mmss(r.t)}</div>`;
    act.innerHTML = `<button type="button" class="btn" data-act="spSkip">Passer l’échauffement</button>`;
    return;
  }
  const lv = L.sportLevel(state, e.id), lvl = e.levels[lv.lvl];
  r.lv[e.id] = lv.lvl;
  const head = `${prog}<div class="sp-k">${r.ex + 1}/${w.ex.length} · série ${r.set + 1}/${setsOf(e, r.light)}${r.light ? ' · semaine légère' : ''}</div><div class="sp-n">${esc(e.name)}</div><div class="sp-lv"><b>${esc(lvl[0])}</b> · ${esc(lvl[1])}</div>`;
  if (r.step === 'rest') {
    const nx = w.ex[r.ex];
    box.innerHTML = `${prog}<div class="sp-k">Repos</div><div class="sp-big num">${mmss(r.t)}</div><div class="sp-h">Ensuite : ${esc(nx.name)}, série ${r.set + 1}/${setsOf(nx, r.light)}</div>`;
    act.innerHTML = `<button type="button" class="btn" data-act="spRest" data-v="15">+15 s</button><button type="button" class="btn pri" data-act="spRest" data-v="0">Je suis prêt</button>`;
    return;
  }
  if (e.time) {
    if (r.step !== 'timed') { r.step = 'timed'; r.t = lv.target; r.target = lv.target; r.going = false; }
    box.innerHTML = `${head}<div class="sp-big num">${mmss(r.t)}</div><div class="sp-h">Objectif : ${lv.target} s${e.side ? ' de chaque côté' : ''}</div>`;
    act.innerHTML = r.going ? `<button type="button" class="btn" data-act="spStopTimed">J’arrête là</button>` : `<button type="button" class="btn pri" data-act="spGoTimed">Démarrer</button>`;
    return;
  }
  if (r.cur == null) r.cur = lv.target;
  box.innerHTML = `${head}<div class="sp-h">Objectif : <b>${lv.target} reps</b>${e.side ? ' par côté' : ''}. Note ce que tu as vraiment fait.</div>
    <div class="sp-step"><button type="button" class="btn" data-act="spRep" data-v="-1" aria-label="Une de moins">−</button><span class="sp-big num">${r.cur}</span><button type="button" class="btn" data-act="spRep" data-v="1" aria-label="Une de plus">+</button></div>`;
  act.innerHTML = `<button type="button" class="btn pri" data-act="spSet">Série faite</button>`;
}
function sportLog(n) {
  const r = sportRun, w = SP.workouts[r.wi], e = w.ex[r.ex];
  (r.reps[e.id] = r.reps[e.id] || []).push(n);
  r.cur = null; r.step = 'set'; r.set++;
  if (r.set >= setsOf(e, r.light)) { r.ex++; r.set = 0; }
  if (r.ex >= w.ex.length) { sportFinish(); return; }
  r.step = 'rest'; r.t = e.rest; sportPaint();
}
function sportFinish() {
  clearInterval(sportTimer); keepAwake(false);
  const r = sportRun, w = SP.workouts[r.wi]; sportRun = null;
  beginChange();
  const notes = w.ex.filter(e => r.reps[e.id]).map(e => { const p = r.light ? { note: 'semaine légère : objectif gardé', up: false } : L.sportProgress(state, e.id, r.reps[e.id]); return `<div class="st-row ok"><span class="st-n">${p && p.up ? '↑' : '='}</span><span class="bd"><span class="ti">${esc(e.name)}</span><span class="su">${r.reps[e.id].join(' · ')}${e.time ? ' s' : ''} → ${esc(p ? p.note : '')}</span></span></div>`; }).join('');
  const dm = state.done[r.key] = state.done[r.key] || {};
  const took = Math.max(1, Math.round((Date.now() - r.startedAt) / 6e4));
  if (r.id) dm[r.id] = { k: 'sport', m: Math.max(20, took), w: w.id };
  state.sportNext = (r.wi + 1) % SP.workouts.length;
  state.sportLog = (state.sportLog || []).concat([{ at: r.startedAt, w: w.id, reps: r.reps, lv: r.lv, min: took, light: r.light || undefined }]).slice(-150);
  save(); renderAll(); endChange();
  const box = $('#spBox'), act = $('#spAct');
  if (box) box.innerHTML = `<div class="sp-k">Séance terminée</div><div class="sp-n">Bien joué 💪</div><div class="sp-h">Tes objectifs pour la prochaine fois :</div><div class="group">${notes}</div>`;
  if (act) act.innerHTML = `<button type="button" class="btn pri" data-act="closeSheet">Fermer</button>`;
}
// a workout left in the middle (sheet closed): a bar to come back to it
function renderSportBar() {
  let bar = $('#spBar');
  if (!sportRun || ($('#spBox') && $('#sheetBg').classList.contains('on'))) { if (bar) bar.remove(); return; }
  if (!bar) { bar = document.createElement('button'); bar.id = 'spBar'; bar.type = 'button'; bar.dataset.act = 'spResume'; document.body.appendChild(bar); }
  const w = SP.workouts[sportRun.wi];
  bar.className = 'fo-bar sp'; bar.innerHTML = `<span class="dot"></span><span class="t">Séance en cours · ${esc(w.name)}</span><span>Reprendre ›</span>`;
}
function sportResume() {
  const r = sportRun; if (!r) return;
  const w = SP.workouts[r.wi];
  openSheet('Sport · ' + w.name, `<div id="spBox" class="sp-box"></div><div class="sh-actions" id="spAct"></div><button type="button" class="linkbtn mini" data-act="spQuit" style="margin:10px auto 0;display:block">Arrêter la séance sans l’enregistrer</button>`);
  keepAwake(true); renderSportBar(); sportPaint(); sportTick();
}
function sportAction(a, v, b) {
  const r = sportRun;
  switch (a) {
    case 'sportSheet': sportSheet(b.dataset.w, b.dataset.id); return true;
    case 'sportPick': { const key = b.dataset.w, id = b.dataset.id; sportStart(+v, key, id); return true; }
    case 'sportGo': sportStart(+v, b.dataset.w, b.dataset.id); return true;
    case 'spResume': sportResume(); return true;
    case 'spQuit': sportRun = null; clearInterval(sportTimer); keepAwake(false); closeSheet(); renderSportBar(); toast('Séance arrêtée'); return true;
    case 'spSkip': if (r) { r.step = 'set'; sportPaint(); } return true;
    case 'spRest': if (r) { if (+v) r.t += +v; else r.step = 'set'; sportPaint(); } return true;
    case 'spRep': if (r) { r.cur = Math.max(0, (r.cur || 0) + +v); sportPaint(); } return true;
    case 'spSet': if (r) sportLog(r.cur || 0); return true;
    case 'spGoTimed': if (r) { r.going = true; sportPaint(); } return true;
    case 'spStopTimed': if (r) { r.going = false; sportLog(Math.max(0, r.target - r.t)); } return true;
  }
  return false;
}

/* ---------- Retard ---------- */
const BL_TIMES = [[30, '30 min'], [60, '1h'], [90, '1h30'], [120, '2h'], [180, '3h'], [240, '4h'], [300, '5h']];
function editBacklog(id) {
  const x = (state.backlog || []).find(e => e.id === id) || { id: null, subj: (state.subjects[0] || {}).id, title: '', minutes: 120, urgent: false };
  const cr = x.id ? L.backlogCredit(state, x.id) : 0;
  openSheet(x.id ? 'Modifier le retard' : 'Ajouter un retard', `<div class="fields">
    ${F.select('subj', 'Matière', subjOpts(), x.subj)}
    ${F.text('title', 'Quoi, précisément', x.title, 'full', 'ex. Série 6 · Cours 8 à relire · Exos 3 à 5 de la série 7')}
    ${F.select('minutes', 'Temps qu’il te faut' + (cr ? ' (en tout, ' + hm(cr) + ' déjà fait)' : ''), BL_TIMES.concat([[x.minutes, hm(x.minutes)]]).filter((v, i, a) => a.findIndex(w => w[0] === v[0]) === i).sort((a, b) => a[0] - b[0]), x.minutes)}
  </div>
  <div class="group" style="margin-top:12px"><label class="row-sw"><span class="bd"><span class="ti">Urgent</span><span class="su">Passe avant les autres retards</span></span><input type="checkbox" class="sw" name="urgent" ${x.urgent ? 'checked' : ''}></label></div>
  ${actions(!!x.id)}`, (fd, btn) => {
    if (isDel(btn)) { state.backlog = state.backlog.filter(e => e.id !== x.id); return done(); }
    const obj = { id: x.id || uid(), subj: fd.subj, title: fd.title.trim() || 'Retard', minutes: +fd.minutes || 60, urgent: !!fd.urgent, created: x.created || Date.now(), auto: !!x.auto };
    if (x.id) Object.assign(x, obj); else state.backlog.push(obj);
    return done();
  });
}
function renderBacklog() {
  const ws = mondayOf(new Date()), days = L.generate(state, ws), M = days.meta;
  const open = L.backlogOpen(state), total = open.reduce((a, x) => a + x.left, 0);
  const lastBl = days.flatMap(x => x.ev.filter(e => e.bl && e.state === 'todo').map(e => ({ d: x.date, e }))).sort((a, b) => (b.d - a.d) || (b.e.end - a.e.end))[0];
  const fmtNext = t => { const d = new Date(t); const di = iso(d); return (di === todayIso() ? 'aujourd’hui' : DAYS[dow(d)].toLowerCase()) + ' ' + fmt(d.getHours() * 60 + d.getMinutes()); };
  let summary;
  if (!open.length) summary = `<div class="hero quiet"><div class="k">Retard</div><div class="t">Rien à rattraper</div><div class="s">Si une série n’est pas finie à la fin d’une semaine, elle arrive ici toute seule.</div></div>`;
  else {
    const allIn = M.blPlaced >= total - 15;
    summary = `<div class="hero"><div class="k">À rattraper</div><div class="t">${hm(total)}</div><div class="s">${allIn ? 'Tout est casé cette semaine' + (lastBl ? ', fini d’ici ' + DAYS[dow(lastBl.d)].toLowerCase() : '') + '.' : hm(M.blPlaced) + ' cette semaine (max ' + hm(state.modes[M.cfg.mode].bl) + ' par jour en mode ' + MODE_META[M.cfg.mode].name + '), le reste ensuite.'}</div>
      <div class="bar"><i style="width:${total ? Math.min(100, M.blPlaced / total * 100) : 0}%"></i></div></div>`;
  }
  const week = M.lateMin >= 15 ? `<div class="notice"><span><b>Cette semaine : ${hm(M.lateMin)} pas faits</b>, déjà replacés dans ta semaine. Ce qui ne sera pas fait dimanche soir arrivera ici.</span></div>` : '';
  const manual = state.blOrder === 'manual';
  const rows = open.map((x, idx) => {
    const su = subjOf(state, x.subj), nx = M.blNext[x.id];
    const info = x.left < 15 ? '<b style="color:var(--acc)">Temps prévu fait · coche si c’est fini</b>' : `${hm(x.left)} restant${x.credit ? ' · ' + hm(x.credit) + ' déjà fait' : ''} · ${nx ? 'prochain bloc ' + fmtNext(nx) : 'pas encore placé'}`;
    return `<div class="bl-row" style="--c:${esc(su ? su.color : '')}">
      <button type="button" class="chk" data-act="blDone" data-v="${esc(x.id)}" aria-pressed="false" aria-label="Fini : ${esc(x.title)}">${CHECK}</button>
      <span class="rk num">${idx + 1}</span>
      <button type="button" class="bd" data-act="editBacklog" data-v="${esc(x.id)}"><span class="ti">${esc(x.title)}${x.urgent ? '<span class="tag">urgent</span>' : ''}${x.auto ? '<span class="tag cu">auto</span>' : ''}</span><span class="su">${esc(su ? su.name : '')} · ${info}</span>${!manual && x.why ? `<span class="why">Priorité : ${esc(x.why)}</span>` : ''}</button>
      ${manual ? `<span class="arrows"><button type="button" data-act="blUp" data-v="${esc(x.id)}" aria-label="Monter" ${idx === 0 ? 'disabled' : ''}>▲</button><button type="button" data-act="blDown" data-v="${esc(x.id)}" aria-label="Descendre" ${idx === open.length - 1 ? 'disabled' : ''}>▼</button></span>` : ''}
      ${x.left < 15 ? `<button type="button" class="more" data-act="blMore" data-v="${esc(x.id)}">+30 min</button>` : ''}
    </div>`;
  }).join('');
  const recent = (state.backlog || []).filter(x => x.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 6);
  $('#blBody').innerHTML = `${summary}${week}
    <div class="sec-t">${open.length ? 'À faire, dans l’ordre' : ''}<button type="button" data-act="editBacklog">+ Ajouter un retard</button></div>
    ${open.length > 1 ? `<div class="seg" style="margin:0 0 10px"><label><input type="radio" name="blOrder" value="auto" ${manual ? '' : 'checked'}><span>Ordre automatique</span></label><label><input type="radio" name="blOrder" value="manual" ${manual ? 'checked' : ''}><span>Mon ordre</span></label></div>
    <p class="hint" style="margin:-2px 4px 10px">${manual ? 'Utilise les flèches. Le n°1 est rattrapé en premier.' : 'L’app classe selon : urgent, examen ou examen blanc proche, séries avant cours, puis le plus ancien.'}</p>` : ''}
    ${open.length ? `<div class="group">${rows}</div><p class="hint" style="margin-top:8px">Les blocs « Retard » apparaissent dans ta journée. Coche ici quand c’est vraiment fini : tant que c’est pas coché, l’app continue de prévoir du temps.</p>` : '<div class="group"><div class="empty">Ajoute ce que t’as en retard (série, cours à relire…) avec le temps qu’il te faut. L’app le répartit dans tes semaines sans faire passer tes séries en retard.</div></div>'}
    ${recent.length ? `<div class="sec-t">Fini récemment</div><div class="group">${recent.map(x => `<div class="bl-row done" style="--c:${esc((subjOf(state, x.subj) || {}).color || '')}"><button type="button" class="chk" data-act="blUndo" data-v="${esc(x.id)}" aria-pressed="true" aria-label="Remettre : ${esc(x.title)}">${CHECK}</button><span class="bd"><span class="ti">${esc(x.title)}</span><span class="su">${esc((subjOf(state, x.subj) || {}).name || '')}</span></span></div>`).join('')}</div>` : ''}`;
  const badge = $('#blBadge'); if (badge) { badge.textContent = total >= 15 ? hm(total) : ''; badge.hidden = total < 15; }
}
/* End of a week: unfinished séries go to the backlog by themselves */
function rollover() {
  const cur = mondayOf(new Date()), sinceWs = mondayOf(new Date(state.since || Date.now()));
  const added = []; let touched = false;
  for (let k = 4; k >= 1; k--) {
    const ws = addDays(cur, -7 * k), key = iso(ws);
    if (state.rolled[key]) continue;
    state.rolled[key] = 1; touched = true;
    if (ws < sinceWs) continue;
    const end = new Date(addDays(ws, 7).getTime() - 1000);
    const M = L.generate(state, ws, end).meta;
    for (const [subj, u] of Object.entries(M.unfinished || {})) {
      const su = subjOf(state, subj); if (!su) continue;
      const n = L.semWeek(state, ws);
      const what = n ? 'série ' + n : 'série du ' + dateLbl(ws);
      const it = { id: uid(), subj, title: u.left - u.corr >= 15 ? (n ? 'Série ' + n : 'Série du ' + dateLbl(ws)) + (u.corr >= 15 ? ' + correction' : '') : 'Vérifier la ' + what + ' avec la correction', minutes: u.left, created: end.getTime(), auto: true };
      state.backlog.push(it); added.push(it);
    }
  }
  if (added.length) { save(); renderAll(); showCard('Retard mis à jour', added.length + ' série' + (added.length > 1 ? 's' : '') + ' pas finie' + (added.length > 1 ? 's' : '') + ' de la semaine passée · ' + hm(added.reduce((a, x) => a + x.minutes, 0))); }
  else if (touched) save();
}

/* ---------- Ma semaine type ---------- */
function renderWeek() {
  const byDay = DAYS.map((_, i) => state.courses.filter(c => c.day === i).sort((a, b) => a.start - b.start));
  const courseRows = byDay.map((list, i) => list.length ? `<div class="dayhead">${DAYS[i]}</div>` + list.map(c => { const s = subjOf(state, c.subj); return `<button type="button" class="li" data-act="editCourse" data-v="${c.id}" style="--c:${esc(s ? s.color : '')}"><span class="dt"></span><span class="bd"><span class="ti">${esc(s ? s.name : 'Cours')}</span><span class="su">${esc([c.type, c.room].filter(Boolean).join(' · '))}</span></span><span class="rt">${fmt(c.start)}<br>${fmt(c.end)}</span>${CHEV}</button>`; }).join('') : '').join('');
  const prioL = ['', 'Importance faible', 'Importance normale', 'Importance haute'];
  const foWeek = Math.round(((state.focus || {}).log || []).filter(x => x.at >= mondayOf(new Date()).getTime()).reduce((t, x) => t + x.ms, 0) / 6e4);
  const nbS = sportNextBlock();
  $('#weekBody').innerHTML = `
    <div class="spaces"><button type="button" class="space fo" data-tab-go="focus"><img src="icons/focus-192.png" alt=""><b>Focus</b><small>${foRun() ? 'en cours · ' + mmss2(foElapsed(foRun())) : foWeek ? hm(foWeek) + ' cette semaine' : 'chrono d’étude'}</small></button>
      <button type="button" class="space sp" data-tab-go="sport"><img src="icons/sport-192.png" alt=""><b>Sport</b><small>${nbS ? 'prochaine : ' + esc(nbS.e.workout || '') : 'progrès, historique'}</small></button></div>
    ${(() => {
      const today = todayIso(), up = [];
      (state.trips || []).filter(t => t.to >= today).forEach(t => up.push([t.from, `<button type="button" class="li" data-act="editTrip" data-v="${esc(t.id)}" style="--c:#0F766E"><span class="dt"></span><span class="bd"><span class="ti">${esc(t.title)}</span><span class="su">Voyage · du ${dateLbl(fromIso(t.from))} au ${dateLbl(fromIso(t.to))}</span></span>${CHEV}</button>`]));
      (state.mocks || []).filter(t => t.date >= today).forEach(t => { const su = subjOf(state, t.subj); up.push([t.date, `<button type="button" class="li" data-act="editMock" data-v="${esc(t.id)}" style="--c:#DB2777"><span class="dt"></span><span class="bd"><span class="ti">Examen blanc · ${esc(su ? su.name : '')}</span><span class="su">${longDate(fromIso(t.date))} · ${fmt(t.start)}</span></span>${CHEV}</button>`]); });
      (state.projects || []).filter(p => p.to >= today).forEach(p => { const su = subjOf(state, p.subj); up.push([p.from > today ? p.from : p.to, `<button type="button" class="li" data-act="editProject" data-v="${esc(p.id)}" style="--c:${esc((su || {}).color || 'var(--faint)')}"><span class="dt"></span><span class="bd"><span class="ti">${esc(p.title)}</span><span class="su">${p.from > today ? 'commence le ' + dateLbl(fromIso(p.from)) + ' · ' : ''}à rendre le ${dateLbl(fromIso(p.to))}</span></span>${CHEV}</button>`]); });
      state.subjects.filter(su => su.exam && su.exam >= today).forEach(su => up.push([su.exam, `<button type="button" class="li" data-act="editExam" data-v="${esc(su.id)}" style="--c:var(--exam)"><span class="dt"></span><span class="bd"><span class="ti">Examen · ${esc(su.name)}</span><span class="su">${longDate(fromIso(su.exam))}</span></span>${CHEV}</button>`]));
      return up.length ? `<div class="sec-t" style="margin-top:18px">À venir</div><div class="group">${up.sort((a, b) => a[0].localeCompare(b[0])).map(x => x[1]).join('')}</div>` : '';
    })()}
    <div class="sec-t">Horaire<button type="button" data-act="editCourse">+ Cours</button></div>
    <div class="group">${courseRows || '<div class="empty">Aucun cours.</div>'}</div>
    <div class="sec-t">Matières<button type="button" data-act="editSubject">+ Matière</button></div>
    <div class="group">${state.subjects.map(s => `<button type="button" class="li" data-act="editSubject" data-v="${esc(s.id)}" style="--c:${esc(s.color)}"><span class="dt"></span><span class="bd"><span class="ti">${esc(s.name)}</span><span class="su">${s.serie ? 'Série ' + hm(s.serie) + (s.corr ? ' + correction ' + hm(s.corr) : '') : 'Pas de série'} · ${prioL[s.prio] || ''}${s.exam ? ' · examen le ' + dateLbl(fromIso(s.exam)) : ''}</span></span>${CHEV}</button>`).join('') || '<div class="empty">Aucune matière.</div>'}</div>
    <div class="sec-t">Projets<button type="button" data-act="editProject">+ Projet</button></div>
    <div class="group">${(state.projects || []).map(p => { const su = subjOf(state, p.subj); const n = (p.sessions || []).length; return `<button type="button" class="li" data-act="editProject" data-v="${p.id}" style="--c:${esc((su || {}).color || 'var(--faint)')}"><span class="dt"></span><span class="bd"><span class="ti">${esc(p.title)}</span><span class="su">${dateLbl(fromIso(p.from))} → ${dateLbl(fromIso(p.to))} · ~${p.hours}h · ${n ? n + ' séance' + (n > 1 ? 's' : '') + ' en binôme' : 'aucune séance en binôme'}</span></span>${CHEV}</button>`; }).join('') || '<div class="empty">Aucun projet. Un projet sur plusieurs semaines (à rendre) : l’app répartit les heures jusqu’au rendu.</div>'}</div>
    <div class="sec-t">Tâches de la semaine<button type="button" data-act="editWeekly">+ Tâche</button></div>
    <div class="group">${(state.weekly || []).map(t => `<button type="button" class="li" data-act="editWeekly" data-v="${t.id}" style="--c:${esc((subjOf(state, t.subj) || {}).color || 'var(--faint)')}"><span class="dt"></span><span class="bd"><span class="ti">${esc(t.title)}</span><span class="su">${hm(t.minutes)} chaque semaine · avant ${t.before >= 7 ? 'la fin de semaine' : DAYS[t.before].toLowerCase()}</span></span>${CHEV}</button>`).join('') || '<div class="empty">Aucune tâche.</div>'}</div>
    <div class="sec-t">Routines<button type="button" data-act="editRoutine">+ Routine</button></div>
    ${(() => { const sp = L.sportMinutes(state); const ok = sp >= L.SPORT_MIN && sp <= L.SPORT_MAX; return `<p class="hint" style="margin:0 4px 8px;${ok ? '' : 'color:var(--warn);font-weight:650'}">Sport : ${hm(sp)} par semaine ${ok ? '(entre 2h et 3h, parfait)' : '· il faut entre 2h et 3h'}</p>`; })()}
    <div class="group">${state.routines.slice().sort((a, b) => a.day - b.day || a.start - b.start).map(r => `<button type="button" class="li" data-act="editRoutine" data-v="${r.id}" style="--c:${r.kind === 'sport' ? 'var(--ink)' : 'var(--faint)'}"><span class="dt"></span><span class="bd"><span class="ti">${esc(r.title)}</span><span class="su">${DAYS[r.day]}${r.kind === 'sport' ? ' · sport' : r.kind === 'study' ? ' · étude ' + esc((subjOf(state, r.subj) || {}).name || '') : ''}</span></span><span class="rt">${fmt(r.start)}<br>${fmt(r.end)}</span>${CHEV}</button>`).join('') || '<div class="empty">Aucune routine.</div>'}</div>`;
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
        ${T('stretch', 'Stretching', 'Au réveil, avec le minuteur')}
        ${T('move', 'Départ pour l’EPFL', 'Quand il faut quitter la maison')}
        ${T('study', 'Blocs d’étude', 'Au début de chaque bloc')}
        ${T('morning', 'Matin et soir', 'Programme du jour au réveil, bilan avant de dormir')}
        ${T('deadline', 'Examens', 'Une semaine avant et la veille')}
        ${T('sport', 'Sport, routines et événements', 'Juste avant')}
      </details>` : ''}
    </div>
    <div class="sec-t">Horaires</div>
    <div class="group"><button type="button" class="li" data-act="hoursSheet"><span class="bd"><span class="ti">Réveil ${fmt(state.wake)} · coucher ${fmt(state.sleep)}</span><span class="su">Du lundi au vendredi, dans tous les modes</span></span>${CHEV}</button></div>
    <div class="sec-t">Mode</div>
    ${(() => { const c = cfgOf(iso(mondayOf(new Date()))); return `<div class="group">
      <label class="row-sw"><span class="bd"><span class="ti">Choix automatique du mode</span><span class="su">Avance avant un voyage, Exam avant les examens, Rattrapage si le retard ne rentre plus</span></span><input type="checkbox" class="sw" data-auto="1" ${state.autoMode !== false ? 'checked' : ''}></label>
      <button type="button" class="li" data-act="modeSheet" style="--c:${MODE_COLORS[c.mode]}"><span class="dt"></span><span class="bd"><span class="ti">Cette semaine : ${MODE_META[c.mode].name}${c.coursesOn ? '' : ' · sans cours'}</span><span class="su">${c.source === 'manual' ? 'Choisi par toi' : c.source === 'auto' ? 'Automatique · ' + esc(c.why) : 'Mode habituel'}</span></span>${CHEV}</button>
      <button type="button" class="li" data-act="baseModeSheet"><span class="bd"><span class="ti">Mode habituel : ${MODE_META[state.mode].name}</span><span class="su">Pour les semaines sans rien de spécial</span></span>${CHEV}</button>
      <button type="button" class="li" data-act="tuneMode" data-v="${c.mode}"><span class="bd"><span class="ti">Ajuster le mode ${MODE_META[c.mode].name}</span><span class="su">Heures d’étude par semaine, week-end, rattrapage</span></span>${CHEV}</button></div>`; })()}
    <div class="sec-t">Moodle</div>
    <div class="group">${moodleSet()}</div>
    <div class="sec-t">Icônes Focus et Sport</div>
    <div class="group"><button type="button" class="li" data-act="icons"><span class="bd"><span class="ti">Ajouter les icônes à l’écran d’accueil</span><span class="su">Chrono d’étude et sport, comme deux apps à part, avec tes données</span></span>${CHEV}</button></div>
    <div class="sec-t">Mes appareils</div>
    <div class="group">${syncKey()
      ? `<div class="status"><b>Synchro activée</b>Tes données sont les mêmes sur tous les appareils reliés. Sur un autre appareil, ouvre le lien de connexion.</div>
         <button type="button" class="li" data-act="syncShow"><span class="bd"><span class="ti">Relier un autre appareil</span><span class="su">Lien et code de connexion</span></span>${CHEV}</button>
         <button type="button" class="li" data-act="syncOff"><span class="bd"><span class="ti">Délier cet appareil</span><span class="su">Il garde ses données mais ne se synchronise plus</span></span></button>`
      : `<div class="status"><b>Ouvrir l’app sur ton PC</b>Relie tes appareils pour avoir le même planning, les mêmes cases cochées et le même retard partout.</div>
         <div class="btns"><button type="button" class="btn pri" data-act="syncStart">Relier un appareil</button><button type="button" class="btn" data-act="syncEnter">J’ai un code</button></div>`}</div>
    <div class="sec-t">Widget</div>
    <div class="group"><button type="button" class="li" data-act="widgetSheet"><span class="bd"><span class="ti">Widget pour l’écran d’accueil</span><span class="su">Ton programme sans ouvrir l’app</span></span>${CHEV}</button></div>
    <div class="sec-t">Sauvegarde</div>
    <div class="group"><button type="button" class="li" data-act="export"><span class="bd"><span class="ti">Copier une sauvegarde</span><span class="su">À coller dans tes Notes</span></span></button><button type="button" class="li" data-act="importShow"><span class="bd"><span class="ti">Restaurer une sauvegarde</span></span>${CHEV}</button></div>
    <p class="hint" style="margin-top:14px;text-align:center">EPFL Calendar · version ${esc(self.APP_VERSION || 'dev')}</p>`;
}

function syncSheet() {
  const k = syncKey();
  openSheet('Relier un appareil', `<p style="margin:0 0 12px;color:var(--muted)">Sur ton PC, ouvre ce lien dans ton navigateur. Le plus simple : copie-le et envoie-le-toi (WhatsApp, mail…).</p>
    <div class="group"><div class="status" style="word-break:break-all;font-family:var(--f-mono);font-size:13px">${esc(linkUrl(k))}</div></div>
    <div class="sh-actions"><button type="button" class="btn pri" data-act="syncCopy">Copier le lien</button></div>
    <p class="hint" style="margin-top:14px">Ou, sur l’autre appareil : Réglages → « J’ai un code », et tape :<br><b style="font-family:var(--f-mono);color:var(--ink);letter-spacing:.04em">${esc(k.match(/.{1,4}/g).join(' '))}</b></p>
    <p class="hint" style="margin-top:10px">Garde ce lien pour toi : il donne accès à ton planning.</p>`);
}
async function linkWith(k) {
  lsSet(KEY_LS, k);
  const got = await pull(true);
  renderSet();
  showCard(got ? 'Appareil relié' : 'Code enregistré', got ? 'Ton planning est maintenant le même ici et sur ton autre appareil.' : 'Aucune donnée trouvée pour ce code pour l’instant.');
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

function renderAll() { renderToday(); if (tab === 'cal') renderCal(); renderWeek(); renderSet(); renderBacklog(); if (tab === 'focus') renderFocus(); if (tab === 'sport') renderSport(); renderFocusBar(); }
function showTab(t) {
  tab = t;
  document.querySelectorAll('.nav button').forEach(b => { if (b.dataset.tab === t) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === 'v-' + t));
  if (t === 'cal') renderCal(); if (t === 'today') renderToday(); if (t === 'set') renderSet(); if (t === 'week') renderWeek(); if (t === 'bl') renderBacklog(); if (t === 'focus') renderFocus(); if (t === 'sport') renderSport(); renderFocusBar();
  window.scrollTo(0, 0);
}
const keepScroll = fn => { const y = window.scrollY; fn(); window.scrollTo(0, y); };
async function copyText(txt, okMsg) {
  try { await navigator.clipboard.writeText(txt); toast(okMsg); }
  catch (e) { openSheet('Copie', `<p class="hint">Sélectionne tout le texte et copie-le.</p><textarea class="box" readonly>${esc(txt)}</textarea>`); }
}

/* ---------- Events ---------- */
const MUTATING = new Set(['dismissNOP', 'setMode', 'offDay', 'weekendOff', 'importDo']);
document.addEventListener('click', async e => {
  const nb = e.target.closest('.nav button'); if (nb) { showTab(nb.dataset.tab); return; }
  const tg = e.target.closest('[data-tab-go]'); if (tg) { showTab(tg.dataset.tabGo); return; }
  const b = e.target.closest('[data-act]'); if (!b || b.type === 'submit') return;
  const a = b.dataset.act, v = b.dataset.v;
  if (MUTATING.has(a)) beginChange();
  if (/^fo[A-Z]/.test(a) && focusAction(a, v, b)) return;
  if (/^(sport|sp)[A-Z]/.test(a) && sportAction(a, v, b)) return;
  if (a === 'spFree') { spFreeSheet(); return; }
  if (a === 'lkPaste') { try { const t = await navigator.clipboard.readText(); const f = $('#f-lk'); if (f) f.value = t; } catch (err) { toast('Colle-le à la main dans le champ'); } return; }
  if (a === 'lkGo') { lkGo(($('#f-lk') || {}).value); return; }
  if (a === 'icons') { iconsSheet(); return; }
  if (a === 'icCopy') { copyText(iconUrl(v, syncKey()), 'Lien copié : colle-le dans Safari'); return; }
  if (/^m[ad][A-Z]/.test(a) && mdAction(a, v, b)) return;
  switch (a) {
    case 'roomAdd': roomSheet(v); return;
    case 'revDocs': revDocsSheet(v, b.dataset.d, b.dataset.id); return;
    case 'exDocs': exDocsSheet(v, b.dataset.w); return;
    case 'corrNow': { beginChange(); const wk = b.dataset.w; state.corrSeen = state.corrSeen || {}; (state.corrSeen[wk] = state.corrSeen[wk] || {})[v] = todayIso(); done(); return; }
    case 'closeSheet': closeSheet(); return;
    case 'pick': selDate = v; renderToday(); return;
    case 'wk': selDate = iso(addDays(fromIso(selDate), +v)); renderToday(); return;
    case 'done': {
      const wk = b.dataset.w, d = state.done[wk] = state.done[wk] || {};
      if (d[v]) { delete d[v]; revForget(v); examForget(v); }
      else {
        revRemember(wk, v); examRemember(wk, v);
        const days = L.generate(state, fromIso(wk)); let ev = null;
        for (const x of days) { ev = x.ev.find(e => e.id === v); if (ev) break; }
        if (!ev) return;
        d[v] = ev.kind === 'study' ? { s: ev.subj, t: ev.title, m: ev.end - ev.start, d: +v.split('-')[0], a: ev.start, serie: ev.serie, c: !!ev.corr || undefined, fx: !!ev.fixed, b: ev.bl || undefined } : { k: ev.kind, m: ev.end - ev.start };
        if (ev.kind === 'sport') { const rec = d[v]; delete d[v]; const wi = sportWorkoutOf(wk, v); d[v] = rec; d[v].w = SP.workouts[wi].id; state.sportNext = (wi + 1) % SP.workouts.length; }
        b.setAttribute('aria-pressed', 'true'); b.classList.add('pop');
      }
      save(); setTimeout(() => keepScroll(() => { renderToday(); if (tab === 'cal') renderCal(); }), d[v] ? 420 : 0); return;
    }
    case 'offDay': toggleOff(v); closeSheet(); return;
    case 'weekendOff': weekendOff(v); closeSheet(); return;
    case 'hoursSheet': hoursSheet(); return;
    case 'modeSheet': modeSheet(b.dataset.w); return;
    case 'baseModeSheet': baseModeSheet(); return;
    case 'editBacklog': editBacklog(v); return;
    case 'checkin': { const c = ciCandidates().find(x => x.id === v) || null; if (!c) { toast('Ce bloc est trop ancien pour faire le point'); return; } beginChange(); ciQueue = [c]; ciOpen = true; ciShow(); return; }
    case 'ciAns': ciAnswer(+v); return;
    case 'ciLater': ciQueue = []; ciOpen = false; ciSkipUntil = Date.now() + 2 * 3600e3; closeSheet(); renderAll(); endChange(); return;
    case 'dismiss': state.dismiss = state.dismiss || {}; state.dismiss[v] = 1; save(); renderToday(); return;
    case 'serieAdjust': { beginChange(); const su = subjOf(state, v); if (su) su.serie = +b.dataset.m; done(); return; }
    case 'msDone': {
      beginChange();
      const wk = b.dataset.w; state.serieDone = state.serieDone || {}; const m = state.serieDone[wk] = state.serieDone[wk] || {};
      if (m[v]) delete m[v];
      else {
        m[v] = 1; b.classList.add('pop');
        // learn how long this série really took
        const mins = Object.values(state.done[wk] || {}).filter(r => r && r.s === v && r.serie && !r.c && !r.b).reduce((a, r) => a + (r.m || 0), 0);
        if (mins >= 30) { state.serieLog = state.serieLog || {}; const lg = (state.serieLog[v] || []).filter(x => x.wk !== wk); lg.push({ wk, m: mins }); state.serieLog[v] = lg.slice(-6); }
      }
      setTimeout(() => { save(); renderAll(); endChange(m[v] ? 'Série finie' : 'Série rouverte', (subjOf(state, v) || {}).name || ''); }, m[v] ? 380 : 0);
      return;
    }
    case 'stretchSheet': stretchSheet(+v, b.dataset.w, b.dataset.id); return;
    case 'stretchGo': stretchRun(+v, b.dataset.w, b.dataset.id); return;
    case 'stretchStop': clearInterval(stretchTimer); b.textContent = 'Démarrer le minuteur'; b.dataset.act = 'stretchGo'; return;
    case 'blUp': case 'blDown': {
      beginChange();
      const order = L.backlogOpen(state).map(x => x.id), i = order.indexOf(v), j = a === 'blUp' ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      order.forEach((id, k) => { const it = state.backlog.find(e => e.id === id); if (it) it.rank = k; });
      done(); return;
    }
    case 'blDone': { beginChange(); const x = state.backlog.find(e => e.id === v); if (x) { x.done = true; x.doneAt = Date.now(); } b.classList.add('pop'); b.setAttribute('aria-pressed', 'true'); setTimeout(() => { save(); renderAll(); endChange('Retard fini', x ? x.title : ''); }, 380); return; }
    case 'blUndo': { beginChange(); const x = state.backlog.find(e => e.id === v); if (x) { x.done = false; delete x.doneAt; } done(); return; }
    case 'blMore': { beginChange(); const x = state.backlog.find(e => e.id === v); if (x) x.minutes = L.backlogCredit(state, x.id) + 30; done(); return; }
    case 'setBase': beginChange(); state.mode = v; closeSheet(); done(); return;
    case 'weekOk': state.weekSeen = state.weekSeen || {}; state.weekSeen[v] = 1; save(); renderToday(); return;
    case 'setMode': { const wk = b.dataset.w || wkOf(selDate);
      if (v === 'auto') { delete state.weekModes[wk]; } else { state.weekModes[wk] = v; if (v === 'exam' && !state.subjects.some(su => su.exam)) setTimeout(() => toast('Ajoute tes dates d’examen pour que le mode Exam sache quoi prioriser'), 4200); }
      state.weekSeen = state.weekSeen || {}; state.weekSeen[wk] = 1; save(); renderAll(); closeSheet(); if (wk >= iso(mondayOf(new Date())) && wk <= iso(addDays(mondayOf(new Date()), 7))) endChange(); else { pendingSig = null; toast((v === 'auto' ? 'Mode automatique' : 'Mode ' + MODE_META[v].name) + ' pour la semaine du ' + dateLbl(fromIso(wk))); } return; }
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
    case 'editWeekly': editWeekly(v); return;
    case 'editProject': editProject(v); return;
    case 'editSession': editSession(v, +b.dataset.i); return;
    case 'editSubject': editSubject(v); return;
    case 'notifOn': enableNotifs(); return;
    case 'notifOff': disableNotifs(); return;
    case 'testNotif': { const sub = await getSub(); if (!sub || !WORKER) { toast('Rappels pas activés'); return; } const r = await post('/test', { subscription: sub.toJSON() }).then(r => r.json()).catch(() => ({})); toast(r.ok ? 'Notif de test envoyée' : 'Échec de l’envoi'); return; }
    case 'widgetSheet': widgetSheet(); return;
    case 'syncStart': {
      if (!WORKER) { toast('Serveur pas encore en ligne'); return; }
      if (!syncKey()) { lsSet(KEY_LS, newKey()); if (!localUpdated()) lsSet(UPD_LS, String(Date.now())); await pushState(); }
      renderSet(); syncSheet(); return;
    }
    case 'syncShow': syncSheet(); return;
    case 'syncCopy': copyText(linkUrl(syncKey()), 'Lien copié. Envoie-le-toi et ouvre-le sur ton PC.'); return;
    case 'syncEnter': openSheet('Relier avec un code', `<div class="fields">${F.text('code', 'Code de connexion', '', 'full', 'les 32 caractères affichés sur ton autre appareil')}</div><p class="hint" style="margin-top:10px">Les données de l’autre appareil remplacent celles d’ici.</p><div class="sh-actions"><button type="submit" class="btn pri">Relier</button></div>`, fd => { const c = String(fd.code || '').toLowerCase().replace(/[^a-f0-9]/g, ''); if (c.length !== 32) { toast('Code invalide : il fait 32 caractères'); return false; } linkWith(c); }); return;
    case 'syncOff': lsSet(KEY_LS, null); renderSet(); toast('Appareil délié'); return;
    case 'copyWidget': copyText(widgetScript(), 'Script copié. Colle-le dans Scriptable.'); return;
    case 'export': copyText(JSON.stringify(state), 'Sauvegarde copiée. Colle-la dans tes Notes.'); return;
    case 'importShow': openSheet('Restaurer', `<textarea class="box" name="txt" placeholder="Colle ta sauvegarde ici"></textarea><div class="sh-actions"><button type="submit" class="btn pri">Restaurer</button></div>`, fd => { try { state = L.normalize(JSON.parse(fd.txt)); save(); renderAll(); toast('Sauvegarde restaurée'); } catch (err) { toast('Texte illisible'); return false; } }); return;
  }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.courses) beginChange();
  if (t.name === 'blOrder') {
    beginChange();
    if (t.value === 'manual') L.backlogOpen(state).forEach((x, k) => { const it = state.backlog.find(e => e.id === x.id); if (it) it.rank = k; });
    state.blOrder = t.value; done(); return;
  }
  if (t.dataset.auto) { beginChange(); state.autoMode = t.checked; if (!t.checked) state.autoModes = {}; done(); return; }
  if (t.dataset.courses) {
    const wk = t.dataset.courses; state.noCourseWeeks = state.noCourseWeeks.filter(x => x !== wk);
    if (!t.checked) state.noCourseWeeks.push(wk);
    save(); renderToday(); renderSet(); endChange(); return;
  }
  if (t.dataset.nf) { if (t.dataset.nf === 'sport') { state.notif.sport = state.notif.routine = t.checked; state.notif.event = t.checked ? 15 : 0; } else if (t.dataset.nf === 'morning') { state.notif.morning = state.notif.evening = t.checked; } else state.notif[t.dataset.nf] = t.checked; save(); return; }
  if (t.dataset.nfn) { state.notif[t.dataset.nfn] = +t.value; save(); }
});


/* ---------- bubble touch effect ---------- */
const BUB_SEL = '.ci-opts .btn,.arrows button,.bl-row .bd,.bl-row .more,.chipm,.btn,.linkbtn,.li,.mopt,.mode-pill,.fab,.sd,.cell,.chk,.nav button,.notice button,.cal-h button,.strip .arr,.sec-t button';
document.addEventListener('pointerdown', e => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const el = e.target.closest(BUB_SEL); if (!el) return;
  const r = el.getBoundingClientRect(), size = Math.max(r.width, r.height) * 2.2;
  const b = document.createElement('span'); b.className = 'bub';
  b.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left}px;top:${e.clientY - r.top}px`;
  el.appendChild(b); setTimeout(() => b.remove(), 650);
}, { passive: true });

function openStretchToday() { const n = new Date(), ws = mondayOf(n); const b = document.querySelector('.nav button[data-tab="today"]'); if (b) b.click(); const day = L.generate(state, ws, n)[dow(n)]; const st = day && day.ev.find(e => e.kind === 'stretch'); stretchSheet(dow(n), iso(ws), st ? st.id : ''); }
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.open === 'stretch') openStretchToday(); if (e.data && e.data.open === 'focus') showTab('focus'); if (e.data && e.data.open === 'sport') showTab('sport'); });
/* ---------- boot ---------- */
renderAll();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').then(r => r.update().catch(() => { })).catch(e => console.warn('sw', e));
// the Focus and Sport icons: their own navigation, opening on their space
if (APP !== 'main') {
  const nav = document.querySelector('.nav .in') || document.querySelector('.nav');
  const ico = APP === 'focus' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V9.5M10 3h4"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M3 17h18M6 17l1.5-6M10 17L8.5 11M14 17l1.5-6M18 17l-1.5-6M6.5 11h3M14.5 11h3"/></svg>';
  const btns = [...nav.querySelectorAll('button')];
  const keep = btns.filter(x => ['today', 'cal'].includes(x.dataset.tab));
  btns.forEach(x => { if (!keep.includes(x)) x.remove(); });
  const first = document.createElement('button'); first.type = 'button'; first.dataset.tab = APP; first.innerHTML = ico + (APP === 'focus' ? 'Focus' : 'Sport');
  nav.insertBefore(first, keep[0] || null);
  document.title = APP === 'focus' ? 'EPFL Focus' : 'EPFL Sport';
  showTab(APP);
}
(async () => {
  // opened from a link like …/#lien-<code>: join that device's planning
  if (/^#ouvrir-stretch/.test(location.hash)) { history.replaceState(null, '', location.pathname); setTimeout(openStretchToday, 400); }
  if (/^#ouvrir-(focus|sport)/.test(location.hash)) { const t = location.hash.slice(9); history.replaceState(null, '', location.pathname); showTab(t); }
  const m = /^#lien-([a-f0-9]{32})$/.exec(location.hash);
  if (m) { history.replaceState(null, '', location.pathname); await linkWith(m[1]); }
  else await pull(false);
  rollover();
  setTimeout(autoCheck, 300);
  setTimeout(checkIn, 1200);
  syncAll();
  mdFetch(false);
})();
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  if (foRun() || sportRun) keepAwake(true);
  await pull(false);
  rollover(); setTimeout(autoCheck, 300); setTimeout(checkIn, 1000);
  if (tab === 'today') keepScroll(renderToday);
  syncAll();
  mdFetch(false);
});
// keep two open devices in step
setInterval(() => { if (document.visibilityState === 'visible' && syncKey()) pull(false); }, 45000);
setInterval(() => { if (document.visibilityState !== 'visible') return; if (tab === 'today') keepScroll(renderToday); checkIn(); }, 60000);
})();
