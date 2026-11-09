/* Ma semaine EPFL — UI */
(function () {
'use strict';
const L = self.Semaine;
const { DAYS, DAYS_S, MONTHS, MONTHS_L, MODE_ORDER, MODE_META, MODE_DEFAULTS, clone, fmt, parseT, hm, addDays, iso, fromIso, mondayOf, dateLbl, uid, dow, subjOf } = L;
const WORKER = (self.WORKER_URL || '').replace(/\/$/, '');
const LS = 'ma-semaine-epfl-v2';

let state;
try { state = L.normalize(JSON.parse(localStorage.getItem(LS))); } catch (e) { state = null; }
if (!state || !localStorage.getItem(LS)) state = L.defaultState();

let weekOffset = 0, selDay = null, tab = 'plan', lastDays = [];
let calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1), calSel = iso(new Date());

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('on'), 2600); }
const weekStart = () => addDays(mondayOf(new Date()), weekOffset * 7);

/* ---------- persistence + notification sync ---------- */
let syncTimer = null;
function save() {
  const keys = Object.keys(state.done).sort();
  while (keys.length > 12) delete state.done[keys.shift()];
  try { localStorage.setItem(LS, JSON.stringify(state)); } catch (e) { }
  if (state.notif.on) { clearTimeout(syncTimer); syncTimer = setTimeout(syncNotifs, 2500); }
}
async function getSub() {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager ? reg.pushManager.getSubscription() : null;
}
async function syncNotifs() {
  if (!WORKER || !state.notif.on) return false;
  try {
    const sub = await getSub(); if (!sub) return false;
    const notifications = L.buildNotifications(state, new Date(), 14);
    const r = await fetch(WORKER + '/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON(), notifications, backup: state }) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    localStorage.setItem(LS + '-sync', JSON.stringify({ t: Date.now(), n: notifications.length }));
    if (tab === 'set') renderSet();
    return true;
  } catch (e) { console.warn('sync', e); return false; }
}
const b64ToBytes = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s); return Uint8Array.from(b, c => c.charCodeAt(0)); };
async function enableNotifs() {
  if (isIOS && !standalone()) { toast('Ajoute d’abord l’app à ton écran d’accueil'); return; }
  if (!('Notification' in window) || !('serviceWorker' in navigator)) { toast('Notifs pas disponibles ici'); return; }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('Notifs refusées. Réactive-les dans Réglages iPhone → Notifications.'); renderSet(); return; }
  if (!WORKER) { toast('Serveur de notifs pas encore en ligne'); return; }
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const { publicKey } = await (await fetch(WORKER + '/vapid')).json();
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
    }
    state.notif.on = true; save();
    await syncNotifs();
    await fetch(WORKER + '/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) });
    toast('Notifs activées. Une notif de test arrive.');
  } catch (e) { console.warn(e); toast('Échec de l’activation : ' + (e.message || e)); }
  renderSet();
}
async function disableNotifs() {
  try { const sub = await getSub(); if (sub) { if (WORKER) await fetch(WORKER + '/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) }); await sub.unsubscribe(); } } catch (e) { }
  state.notif.on = false; save(); renderSet(); toast('Notifs désactivées');
}

/* ---------- Semaine ---------- */
function renderMast() {
  document.body.dataset.mode = state.mode;
  const ws = weekStart(), we = addDays(ws, 6);
  $('#wkLabel').textContent = 'Semaine du ' + ws.getDate() + (ws.getMonth() !== we.getMonth() ? ' ' + MONTHS[ws.getMonth()] : '') + ' au ' + dateLbl(we);
  $('#wkToday').style.display = weekOffset ? '' : 'none';
  $('#modeName').textContent = MODE_META[state.mode].name;
  $('#modeTag').textContent = MODE_META[state.mode].tag;
  $('#chips').innerHTML = MODE_ORDER.map(k => `<button type="button" class="chip" role="radio" aria-checked="${k === state.mode}" data-act="mode" data-v="${k}"><span>${MODE_META[k].name}</span></button>`).join('');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.querySelector('.mast')).backgroundColor;
}

function dayCard(d, sm, todayIdx, opts) {
  const rows = d.ev.map(e => {
    const su = e.subj ? subjOf(state, e.subj) : null;
    const c = su && e.kind !== 'sport' ? `--c:${esc(su.color)}` : '';
    const isDone = !!sm.done[e.id];
    const can = e.kind === 'study' || e.kind === 'sport';
    if (e.kind === 'mark') return `<div class="row k-mark"><span class="tm"></span><span class="ti">${esc(e.title)}</span></div>`;
    return `<div class="row k-${e.kind}${isDone ? ' done' : ''}" style="${c}">
      <span class="tm"><b>${fmt(e.start)}</b><br>${fmt(e.end)}</span>
      <span class="bd"><span class="ti">${esc(e.title)}${e.deadline ? `<span class="tagdl">${esc(e.dueLbl)}</span>` : ''}</span>${e.sub ? `<br><span class="su">${esc(e.sub)}</span>` : ''}</span>
      ${can && opts.week ? `<button type="button" class="chk" data-act="done" data-w="${opts.week}" data-v="${e.id}" aria-pressed="${isDone}" aria-label="Marquer comme fait : ${esc(e.title)}">${CHECK}</button>` : '<span></span>'}
    </div>`;
  }).join('');
  return `<article class="day${opts.sel ? ' sel' : ''}${d.d === todayIdx ? ' today' : ''}">
    <div class="day-h"><b>${DAYS[d.d]} ${dateLbl(d.date)}</b><br><span class="s">${d.plan ? hm(d.plan) + ' d’étude · ' + hm(d.dn) + ' fait' : 'pas d’étude prévue'}</span></div>
    <div class="rows">${rows}<div class="row k-mark"><span class="tm"></span><span class="ti">Au lit ${fmt(d.sleep)}</span></div></div>
    ${d.shortfall >= 30 ? `<div class="short">Il manque ${hm(d.shortfall)} pour l’objectif du jour.</div>` : ''}
  </article>`;
}

function renderPlan() {
  const ws = weekStart(), key = iso(ws);
  const days = L.generate(state, ws); lastDays = days;
  const sm = L.summarize(state, days, key);
  const todayIdx = weekOffset === 0 ? dow(new Date()) : -1;
  if (selDay == null) selDay = todayIdx >= 0 ? todayIdx : 0;
  const m = state.modes[state.mode];
  const pct = sm.plan ? Math.round(sm.dn / sm.plan * 100) : 0;
  const alerts = [];
  if (sm.sleepAvg < 450) alerts.push('Moins de 7h30 de sommeil par nuit en moyenne. Avance le coucher ou recule le réveil dans Réglages.');
  const short = days.filter(d => d.shortfall >= 30);
  if (short.length) alerts.push('L’objectif d’étude ne rentre pas en entier ' + short.map(d => DAYS[d.d].toLowerCase()).join(', ') + '. C’est normal les jours chargés en cours.');
  if (state.mode === 'exam' && !state.subjects.some(s => s.exam)) alerts.push('Mode Exam : ajoute tes dates d’examen dans Matières pour que les matières urgentes passent devant.');
  if (state.mode === 'exam' && state.coursesOn) alerts.push('Pendant la session, décoche « J’ai cours cette semaine » dans Cours pour libérer les journées.');
  if (!state.notif.on && weekOffset === 0) alerts.push('Les notifs sont coupées. Active-les dans Réglages.');

  let now = '';
  if (todayIdx >= 0) {
    const t = new Date(), mins = t.getHours() * 60 + t.getMinutes();
    const evs = days[todayIdx].ev.filter(e => e.kind !== 'mark');
    const cur = evs.find(e => e.start <= mins && mins < e.end), nxt = evs.find(e => e.start > mins);
    const cell = (k, e) => e ? `<div><div class="k">${k}</div><b>${esc(e.title)}</b><span class="t">${fmt(e.start)}–${fmt(e.end)}${e.sub ? ' · ' + esc(e.sub) : ''}</span></div>` : `<div><div class="k">${k}</div><b>${k === 'Maintenant' ? 'Rien de prévu' : 'Bonne nuit'}</b></div>`;
    now = `<div class="now">${cell('Maintenant', cur)}${cell('Ensuite', nxt)}</div>`;
  }
  const max = Math.max(1, ...Object.values(sm.per).map(x => x.plan));
  const subRows = state.subjects.map(su => {
    const p = sm.per[su.id] || { plan: 0, done: 0 };
    return `<div class="subrow" style="--c:${esc(su.color)}"><span class="nm"><span class="dot"></span>${esc(su.name)}</span><span class="bar"><b style="width:${p.plan / max * 100}%"></b><i style="width:${p.done / max * 100}%"></i></span><span class="n">${p.done ? hm(p.done) : '0'}/${hm(p.plan)}</span></div>`;
  }).join('');
  const strip = days.map(d => `<button type="button" role="tab" data-act="day" data-v="${d.d}" aria-selected="${d.d === selDay}" class="${d.d === todayIdx ? 'today' : ''}"><span class="d1">${DAYS_S[d.d]}</span><span class="d2">${d.date.getDate()}</span><span class="mini"><i style="width:${d.plan ? d.dn / d.plan * 100 : 0}%"></i></span></button>`).join('');
  const board = days.map(d => dayCard(d, sm, todayIdx, { sel: d.d === selDay, week: key })).join('');

  $('#planBody').innerHTML = `
    <div class="stats">
      <div class="stat"><div class="k">Étude prévue</div><div class="v">${hm(sm.plan)}</div><div class="s">objectif ${hm(m.studyDay)} par jour de semaine</div></div>
      <div class="stat"><div class="k">Fait</div><div class="v">${pct}%</div><div class="bar"><i style="width:${pct}%"></i></div><div class="s">${hm(sm.dn)} cochées</div></div>
      <div class="stat"><div class="k">Cours</div><div class="v">${state.coursesOn ? hm(sm.course) : '—'}</div><div class="s">${state.coursesOn ? 'travail total ' + hm(sm.course + sm.plan) : 'semaine sans cours'}</div></div>
      <div class="stat${sm.sleepAvg < 450 ? ' warn' : ''}"><div class="k">Sommeil moyen</div><div class="v">${hm(sm.sleepAvg)}</div><div class="s">sport ${sm.sportDone}/${sm.sport} séances</div></div>
    </div>
    ${now}
    ${alerts.length ? `<ul class="alerts">${alerts.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
    <div class="split"><h3>Par matière (fait / prévu)</h3>${subRows || '<p class="hint">Ajoute des matières dans l’onglet Matières.</p>'}</div>
    <div class="strip" role="tablist" aria-label="Jour">${strip}</div>
    <div class="board">${board}</div>`;
}

/* ---------- Calendrier ---------- */
function renderCal() {
  const y = calMonth.getFullYear(), mo = calMonth.getMonth();
  const first = new Date(y, mo, 1), start = addDays(first, -dow(first));
  const todayIso = iso(new Date());
  const weeks = {};
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i); const di = iso(d);
    if (i >= 35 && d.getMonth() !== mo) break;
    const wk = iso(mondayOf(d));
    if (!weeks[wk]) weeks[wk] = L.generate(state, mondayOf(d));
    const day = weeks[wk][dow(d)];
    const study = day.ev.filter(e => e.kind === 'study' || e.kind === 'course').reduce((a, e) => a + e.end - e.start, 0);
    const dots = [];
    state.events.filter(x => x.date === di).forEach(() => dots.push('<i class="ev"></i>'));
    state.deadlines.filter(x => (x.due || '').slice(0, 10) === di).forEach(() => dots.push('<i class="dl"></i>'));
    state.subjects.filter(s => s.exam === di).forEach(() => dots.push('<i class="ex"></i>'));
    cells.push(`<button type="button" class="cell${d.getMonth() !== mo ? ' out' : ''}${di === todayIso ? ' today' : ''}" data-act="calday" data-v="${di}" aria-selected="${di === calSel}" aria-label="${DAYS[dow(d)]} ${dateLbl(d)}">
      <span class="n">${d.getDate()}</span><span class="dots">${dots.slice(0, 4).join('')}</span><span class="load"><i style="width:${Math.min(100, study / 600 * 100)}%"></i></span></button>`);
  }
  const sel = fromIso(calSel), wk = iso(mondayOf(sel));
  const wdays = weeks[wk] || L.generate(state, mondayOf(sel));
  const sm = L.summarize(state, wdays, wk);
  const todayIdx = iso(mondayOf(new Date())) === wk ? dow(new Date()) : -1;
  const evs = state.events.filter(x => x.date === calSel).sort((a, b) => a.start - b.start);
  const dls = state.deadlines.filter(x => (x.due || '').slice(0, 10) === calSel);
  const exs = state.subjects.filter(s => s.exam === calSel);
  $('#calBody').innerHTML = `
    <div class="cal-h"><button type="button" data-act="calm" data-v="-1" aria-label="Mois précédent">‹</button><b>${MONTHS_L[mo]} ${y}</b><button type="button" data-act="calm" data-v="1" aria-label="Mois suivant">›</button></div>
    <div class="cal">${DAYS_S.map(n => `<span class="wd">${n}</span>`).join('')}${cells.join('')}</div>
    <div class="legend"><span><i style="background:var(--accent-fg)"></i>Événement</span><span><i style="background:var(--warn)"></i>Deadline</span><span><i style="background:var(--exam);border-radius:2px;width:14px"></i>Examen</span><span>barre = charge de travail</span></div>
    <div class="sec" style="margin-top:16px">
      <h3>${DAYS[dow(sel)]} ${dateLbl(sel)}</h3>
      ${exs.map(s => `<p><b style="color:var(--exam)">Examen : ${esc(s.name)}</b></p>`).join('')}
      ${dls.map(x => `<p><b style="color:var(--warn)">À rendre : ${esc(x.title)}</b> · ${esc((x.due || '').slice(11, 16))}</p>`).join('')}
      <div class="ehead event"><span>Date</span><span>Début</span><span>Fin</span><span>Quoi</span><span>Où</span><span></span></div>
      ${evs.map(x => `<div class="erow event" data-id="${esc(x.id)}" data-type="event">
        <label class="c-date"><span class="lbl-m">Date</span><input type="date" data-f="date" value="${esc(x.date)}"></label>
        <label><span class="lbl-m">Début</span><input type="time" data-f="start" value="${fmt(x.start)}"></label>
        <label><span class="lbl-m">Fin</span><input type="time" data-f="end" value="${fmt(x.end)}"></label>
        <label class="c-title"><span class="lbl-m">Quoi</span><input type="text" data-f="title" value="${esc(x.title)}"></label>
        <label class="c-place"><span class="lbl-m">Où</span><input type="text" data-f="place" value="${esc(x.place)}"></label>
        <button type="button" class="del" data-act="delEv" data-v="${esc(x.id)}" aria-label="Supprimer">×</button></div>`).join('')}
      <div class="foot-actions"><button type="button" class="btn acc" data-act="addEv">+ Événement ce jour-là</button><button type="button" class="btn" data-act="gotoWeek">Voir dans la semaine</button></div>
    </div>
    <div class="agenda">${dayCard(wdays[dow(sel)], sm, todayIdx, { sel: true, week: wk })}</div>`;
}

/* ---------- Cours & routines ---------- */
const subjOptions = sel => state.subjects.map(s => `<option value="${esc(s.id)}"${s.id === sel ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
const dayOptions = sel => DAYS.map((n, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${n}</option>`).join('');
function renderCours() {
  const list = state.courses.slice().sort((a, b) => a.day - b.day || a.start - b.start);
  const routines = state.routines.slice().sort((a, b) => a.day - b.day || a.start - b.start);
  const types = ['Cours', 'Exercices', 'TP', 'Labo', 'Projet'];
  $('#coursBody').innerHTML = `
    <div class="sec">
      <label class="toggle"><input type="checkbox" id="coursesOn" ${state.coursesOn ? 'checked' : ''}><span>J’ai cours cette semaine<small>Décoche pendant la session ou les vacances : les journées se remplissent d’étude selon le mode.</small></span></label>
    </div>
    <div class="sec">
      <h3>Horaire</h3>
      <div class="ehead course"><span>Jour</span><span>Début</span><span>Fin</span><span>Matière</span><span>Type</span><span>Salle</span><span></span></div>
      ${list.map(c => `<div class="erow course" data-id="${c.id}" data-type="course">
        <label><span class="lbl-m">Jour</span><select data-f="day">${dayOptions(c.day)}</select></label>
        <label><span class="lbl-m">Début</span><input type="time" data-f="start" value="${fmt(c.start)}"></label>
        <label><span class="lbl-m">Fin</span><input type="time" data-f="end" value="${fmt(c.end)}"></label>
        <label class="c-sub"><span class="lbl-m">Matière</span><select data-f="subj">${subjOptions(c.subj)}</select></label>
        <label><span class="lbl-m">Type</span><select data-f="type">${types.map(t => `<option${t === c.type ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="c-room"><span class="lbl-m">Salle</span><input type="text" data-f="room" value="${esc(c.room)}" placeholder="CE 1 1"></label>
        <button type="button" class="del" data-act="del" data-list="courses" data-v="${c.id}" aria-label="Supprimer ce cours">×</button>
      </div>`).join('')}
      <div class="foot-actions"><button type="button" class="btn" data-act="addCourse">+ Ajouter un cours</button></div>
    </div>
    <div class="sec">
      <h3>Routines</h3>
      <p>Les trucs fixes de ta semaine en dehors des cours : courses, lessive, cuisine, entraînement…</p>
      <div class="ehead routine"><span>Jour</span><span>Début</span><span>Fin</span><span>Quoi</span><span></span></div>
      ${routines.map(r => `<div class="erow routine" data-id="${r.id}" data-type="routine">
        <label><span class="lbl-m">Jour</span><select data-f="day">${dayOptions(r.day)}</select></label>
        <label><span class="lbl-m">Début</span><input type="time" data-f="start" value="${fmt(r.start)}"></label>
        <label><span class="lbl-m">Fin</span><input type="time" data-f="end" value="${fmt(r.end)}"></label>
        <label class="c-title"><span class="lbl-m">Quoi</span><input type="text" data-f="title" value="${esc(r.title)}"></label>
        <button type="button" class="del" data-act="del" data-list="routines" data-v="${r.id}" aria-label="Supprimer cette routine">×</button>
      </div>`).join('')}
      <div class="foot-actions"><button type="button" class="btn" data-act="addRoutine">+ Ajouter une routine</button></div>
    </div>`;
}

/* ---------- Matières ---------- */
function renderMat() {
  $('#matBody').innerHTML = `
    <div class="sec">
      <h3>Matières</h3>
      <p>La priorité règle combien de temps chaque matière reçoit. Avec une date d’examen, la matière monte en puissance dans les deux semaines d’avant, et tu reçois un rappel une semaine et la veille.</p>
      <div class="ehead subject"><span></span><span>Nom</span><span>Priorité</span><span>Examen</span><span></span></div>
      ${state.subjects.map(s => `<div class="erow subject" data-id="${esc(s.id)}" data-type="subject">
        <input type="color" data-f="color" value="${esc(s.color)}" aria-label="Couleur">
        <input type="text" data-f="name" value="${esc(s.name)}" aria-label="Nom">
        <label class="s-prio"><span class="lbl-m">Priorité</span><select data-f="prio">${[[1, 'Basse'], [2, 'Moyenne'], [3, 'Haute']].map(([v, n]) => `<option value="${v}"${+s.prio === v ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="s-exam"><span class="lbl-m">Date d’examen</span><input type="date" data-f="exam" value="${esc(s.exam)}"></label>
        <button type="button" class="del" data-act="delSubj" data-v="${esc(s.id)}" aria-label="Supprimer cette matière">×</button>
      </div>`).join('')}
      <div class="foot-actions"><button type="button" class="btn" data-act="addSubj">+ Ajouter une matière</button></div>
    </div>
    <div class="sec">
      <h3>Séries & deadlines</h3>
      <p>Le planning réserve les heures estimées dans les jours qui précèdent, et tu reçois un rappel la veille à 20h.</p>
      <div class="ehead deadline"><span>Matière</span><span>Quoi</span><span>Pour quand</span><span>Heures</span><span></span></div>
      ${state.deadlines.slice().sort((a, b) => (a.due || '').localeCompare(b.due || '')).map(x => `<div class="erow deadline" data-id="${esc(x.id)}" data-type="deadline">
        <label class="d-sub"><span class="lbl-m">Matière</span><select data-f="subj">${subjOptions(x.subj)}</select></label>
        <label class="d-title"><span class="lbl-m">Quoi</span><input type="text" data-f="title" value="${esc(x.title)}"></label>
        <label class="d-due"><span class="lbl-m">Pour quand</span><input type="datetime-local" data-f="due" value="${esc(x.due)}"></label>
        <label class="d-h"><span class="lbl-m">Heures</span><input type="number" min="0.5" max="40" step="0.5" data-f="hours" value="${esc(x.hours)}"></label>
        <button type="button" class="del" data-act="del" data-list="deadlines" data-v="${esc(x.id)}" aria-label="Supprimer">×</button>
      </div>`).join('') || '<p class="hint">Aucune deadline pour l’instant.</p>'}
      <div class="foot-actions"><button type="button" class="btn" data-act="addDl">+ Ajouter une deadline</button></div>
    </div>`;
}

/* ---------- Réglages ---------- */
function renderSet() {
  const N = state.notif, m = state.modes[state.mode];
  let sync = null; try { sync = JSON.parse(localStorage.getItem(LS + '-sync')); } catch (e) { }
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  let status;
  if (isIOS && !standalone()) status = `<div class="status bad"><span class="pill">À faire</span><div>Pour recevoir des notifs, installe l’app :<ol class="steps"><li>Ouvre cette page dans <b>Safari</b></li><li>Touche <b>Partager</b> (carré avec flèche)</li><li><b>Sur l’écran d’accueil</b> → Ajouter</li><li>Ouvre l’app depuis l’icône et reviens ici</li></ol></div></div>`;
  else if (!WORKER) status = `<div class="status bad"><span class="pill">Serveur</span><div>Le serveur de notifs n’est pas encore en ligne.</div></div>`;
  else if (perm === 'denied') status = `<div class="status bad"><span class="pill">Bloquées</span><div>Les notifs sont bloquées. Réactive-les dans Réglages iPhone → Notifications → EPFL Calendar.</div></div>`;
  else if (N.on) status = `<div class="status ok"><span class="pill">Actives</span><div>${sync ? sync.n + ' notifs programmées pour les 14 prochains jours. Dernière mise à jour ' + new Date(sync.t).toLocaleString('fr-CH', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) + '.' : 'En attente de synchronisation.'} Ouvre l’app au moins une fois par semaine pour que ça continue.</div></div>`;
  else status = `<div class="status"><span class="pill">Coupées</span><div>Active-les pour recevoir tes rappels de cours, de blocs d’étude et de deadlines.</div></div>`;
  const T = (f, label, sub) => `<label class="toggle"><input type="checkbox" data-nf="${f}" ${N[f] ? 'checked' : ''}><span>${label}${sub ? `<small>${sub}</small>` : ''}</span></label>`;
  const F = (f, label, type, val, extra = '') => `<div class="field"><label for="mf-${f}">${label}</label><input id="mf-${f}" type="${type}" data-mf="${f}" value="${esc(val)}" ${extra}></div>`;
  $('#setBody').innerHTML = `
    <div class="sec">
      <h3>Notifications</h3>
      ${status}
      <div class="foot-actions" style="margin:0 0 8px">${N.on ? `<button type="button" class="btn" data-act="testNotif">Envoyer une notif de test</button><button type="button" class="btn" data-act="notifOff">Couper</button>` : `<button type="button" class="btn acc" data-act="notifOn">Activer les notifs</button>`}</div>
      <div class="grid-f" style="margin-top:8px">
        <div class="field"><label for="nf-course">Avant un cours</label><select id="nf-course" data-nfn="course">${[0, 5, 10, 15, 20, 30].map(v => `<option value="${v}"${N.course === v ? ' selected' : ''}>${v ? v + ' min avant' : 'Jamais'}</option>`).join('')}</select></div>
        <div class="field"><label for="nf-event">Avant un événement</label><select id="nf-event" data-nfn="event">${[0, 10, 15, 30, 60].map(v => `<option value="${v}"${N.event === v ? ' selected' : ''}>${v ? v + ' min avant' : 'Jamais'}</option>`).join('')}</select></div>
      </div>
      ${T('study', 'Début de chaque bloc d’étude', 'avec la matière et ce qu’il faut faire')}
      ${T('morning', 'Résumé du matin', 'au réveil : cours, heures d’étude, sport')}
      ${T('evening', 'Bilan du soir', 'pour cocher ce que t’as fait')}
      ${T('deadline', 'Deadlines et examens', 'la veille d’un rendu, une semaine et la veille d’un examen')}
      ${T('sport', 'Sport', '10 min avant')}
      ${T('routine', 'Routines', 'courses, lessive, cuisine…')}
    </div>
    <div class="sec">
      <h3>Mode ${esc(MODE_META[state.mode].name)}</h3>
      <p>Chaque mode garde ses propres réglages. Change de mode dans l’onglet Semaine.</p>
      <div class="grid-f">
        ${F('wake', 'Réveil en semaine', 'time', fmt(m.wake))}
        ${F('wakeWE', 'Réveil le week-end', 'time', fmt(m.wakeWE))}
        ${F('sleep', 'Coucher', 'time', fmt(m.sleep))}
        ${F('studyDay', 'Étude par jour de semaine (h)', 'number', m.studyDay / 60, 'min="0" max="12" step="0.5" inputmode="decimal"')}
        ${F('sat', 'Étude le samedi (h, 0 = off)', 'number', m.sat / 60, 'min="0" max="12" step="0.5" inputmode="decimal"')}
        ${F('sun', 'Étude le dimanche (h, 0 = off)', 'number', m.sun / 60, 'min="0" max="12" step="0.5" inputmode="decimal"')}
        ${F('block', 'Durée d’un bloc (min)', 'number', m.block, 'min="20" max="120" step="5" inputmode="numeric"')}
        ${F('pause', 'Pause entre blocs (min)', 'number', m.pause, 'min="0" max="45" step="5" inputmode="numeric"')}
        ${F('freeEve', 'Temps libre le soir (min)', 'number', m.freeEve, 'min="0" max="300" step="15" inputmode="numeric"')}
        ${F('sportMin', 'Durée du sport (min)', 'number', m.sportMin, 'min="0" max="180" step="15" inputmode="numeric"')}
        ${F('sportLabel', 'Nom de l’activité', 'text', m.sportLabel)}
        <div class="field"><label>Jours de sport</label><div class="daypick">${DAYS_S.map((n, i) => `<button type="button" data-act="sportDay" data-v="${i}" aria-pressed="${(m.sportDays || []).includes(i)}" aria-label="${DAYS[i]}">${n}</button>`).join('')}</div></div>
      </div>
      <div class="foot-actions"><button type="button" class="btn" data-act="resetMode">Remettre ce mode par défaut</button></div>
    </div>
    <div class="sec">
      <h3>Sauvegarde</h3>
      <p>Tes données restent sur ton téléphone. Copie une sauvegarde si tu changes de téléphone ou réinstalles l’app.</p>
      <div class="foot-actions" style="margin-top:0"><button type="button" class="btn" data-act="export">Copier la sauvegarde</button><button type="button" class="btn" data-act="importShow">Restaurer</button></div>
      <div id="importBox"></div>
    </div>
    <p class="hint">Version ${esc(self.APP_VERSION || 'dev')}</p>`;
}

function renderAll() { renderMast(); renderPlan(); if (tab === 'cal') renderCal(); renderCours(); renderMat(); renderSet(); }
function showTab(t) {
  tab = t;
  document.querySelectorAll('.nav button').forEach(b => { if (b.dataset.tab === t) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === 'v-' + t));
  if (t === 'cal') renderCal();
  if (t === 'plan') { renderMast(); renderPlan(); }
  if (t === 'set') renderSet();
  window.scrollTo(0, 0);
}
function rerenderKeepScroll(fn) { const y = window.scrollY; fn(); window.scrollTo(0, y); }

/* ---------- Events ---------- */
document.addEventListener('click', async e => {
  const nb = e.target.closest('.nav button'); if (nb) { showTab(nb.dataset.tab); return; }
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act, v = b.dataset.v;
  switch (a) {
    case 'wk': weekOffset += +v; selDay = weekOffset === 0 ? null : 0; renderMast(); renderPlan(); return;
    case 'wk0': weekOffset = 0; selDay = null; renderMast(); renderPlan(); return;
    case 'mode': state.mode = v; save(); renderMast(); renderPlan(); return;
    case 'day':
      selDay = +v;
      document.querySelectorAll('.strip button').forEach(x => x.setAttribute('aria-selected', x.dataset.v === v));
      document.querySelectorAll('#planBody .day').forEach((x, i) => x.classList.toggle('sel', i === +v));
      return;
    case 'done': {
      const key = b.dataset.w; const d = state.done[key] = state.done[key] || {};
      if (d[v]) delete d[v]; else d[v] = 1; save();
      rerenderKeepScroll(() => { if (tab === 'cal') renderCal(); else renderPlan(); });
      return;
    }
    case 'calm': calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + (+v), 1); renderCal(); return;
    case 'calday': calSel = v; rerenderKeepScroll(renderCal); return;
    case 'gotoWeek': { const s = fromIso(calSel); weekOffset = Math.round((mondayOf(s) - mondayOf(new Date())) / (7 * 864e5)); selDay = dow(s); showTab('plan'); return; }
    case 'addEv': state.events.push({ id: uid(), date: calSel, start: 1110, end: 1200, title: 'Nouvel événement', place: '' }); save(); rerenderKeepScroll(renderCal); return;
    case 'delEv': state.events = state.events.filter(x => x.id !== v); save(); rerenderKeepScroll(renderCal); return;
    case 'del': state[b.dataset.list] = state[b.dataset.list].filter(x => x.id !== v); save(); rerenderKeepScroll(() => { renderCours(); renderMat(); }); return;
    case 'addCourse': state.courses.push({ id: uid(), day: 0, start: 495, end: 600, subj: (state.subjects[0] || {}).id || '', type: 'Cours', room: '' }); save(); rerenderKeepScroll(renderCours); return;
    case 'addRoutine': state.routines.push({ id: uid(), day: 5, start: 600, end: 660, title: 'Routine' }); save(); rerenderKeepScroll(renderCours); return;
    case 'addSubj': state.subjects.push({ id: uid(), name: 'Nouvelle matière', color: '#64748B', prio: 2, exam: '' }); save(); rerenderKeepScroll(() => { renderMat(); renderCours(); }); return;
    case 'delSubj': {
      const s = subjOf(state, v);
      if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = '?'; toast('Touche encore pour supprimer ' + (s ? s.name : '') + ' et ses cours'); setTimeout(() => { if (b.isConnected) { b.dataset.confirm = ''; b.textContent = '×'; } }, 3000); return; }
      state.subjects = state.subjects.filter(x => x.id !== v); state.courses = state.courses.filter(c => c.subj !== v); state.deadlines = state.deadlines.filter(x => x.subj !== v);
      save(); rerenderKeepScroll(renderAll); return;
    }
    case 'addDl': { const d = addDays(new Date(), 3); state.deadlines.push({ id: uid(), subj: (state.subjects[0] || {}).id || '', title: 'Série', due: iso(d) + 'T18:00', hours: 2 }); save(); rerenderKeepScroll(renderMat); return; }
    case 'sportDay': { const m = state.modes[state.mode]; const i = +v; m.sportDays = (m.sportDays || []).includes(i) ? m.sportDays.filter(x => x !== i) : [...(m.sportDays || []), i].sort(); b.setAttribute('aria-pressed', m.sportDays.includes(i)); save(); return; }
    case 'resetMode': state.modes[state.mode] = clone(MODE_DEFAULTS[state.mode]); save(); rerenderKeepScroll(renderSet); toast('Réglages du mode remis par défaut'); return;
    case 'notifOn': enableNotifs(); return;
    case 'notifOff': disableNotifs(); return;
    case 'testNotif': { const sub = await getSub(); if (!sub || !WORKER) { toast('Notifs pas activées'); return; } const r = await fetch(WORKER + '/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) }).then(r => r.json()).catch(() => ({})); toast(r.ok ? 'Notif de test envoyée' : 'Échec de l’envoi'); return; }
    case 'export': { const txt = JSON.stringify(state); try { await navigator.clipboard.writeText(txt); toast('Sauvegarde copiée. Colle-la dans tes Notes.'); } catch (err) { $('#importBox').innerHTML = '<textarea class="box" readonly>' + esc(txt) + '</textarea>'; } return; }
    case 'importShow': $('#importBox').innerHTML = '<textarea class="box" id="importTxt" placeholder="Colle ta sauvegarde ici"></textarea><div class="foot-actions"><button type="button" class="btn pri" data-act="importDo">Restaurer cette sauvegarde</button></div>'; return;
    case 'importDo': try { state = L.normalize(JSON.parse($('#importTxt').value)); save(); renderAll(); toast('Sauvegarde restaurée'); } catch (err) { toast('Texte de sauvegarde illisible'); } return;
  }
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'coursesOn') { state.coursesOn = t.checked; save(); renderPlan(); return; }
  if (t.dataset.nf) { state.notif[t.dataset.nf] = t.checked; save(); return; }
  if (t.dataset.nfn) { state.notif[t.dataset.nfn] = +t.value; save(); return; }
  const mf = t.dataset.mf;
  if (mf) {
    const m = state.modes[state.mode];
    if (['wake', 'wakeWE', 'sleep'].includes(mf)) { const v = parseT(t.value); if (v != null) m[mf] = v; }
    else if (['studyDay', 'sat', 'sun'].includes(mf)) m[mf] = Math.max(0, Math.round((+t.value || 0) * 60));
    else if (mf === 'sportLabel') m[mf] = t.value.slice(0, 40);
    else m[mf] = Math.max(0, Math.round(+t.value || 0));
    if (m.block < 20) m.block = 20;
    save(); return;
  }
  const f = t.dataset.f; if (!f) return;
  const row = t.closest('[data-id]'); if (!row) return;
  const id = row.dataset.id, type = row.dataset.type;
  const listName = { course: 'courses', routine: 'routines', subject: 'subjects', deadline: 'deadlines', event: 'events' }[type];
  const item = (state[listName] || []).find(x => x.id === id); if (!item) return;
  if (f === 'start' || f === 'end') { const v = parseT(t.value); if (v != null) item[f] = v; }
  else if (f === 'day' || f === 'prio') item[f] = +t.value;
  else if (f === 'hours') item[f] = Math.max(0, +t.value || 0);
  else item[f] = t.value;
  save();
  if (type === 'subject' && f === 'name') renderCours();
  if (type === 'event') rerenderKeepScroll(renderCal);
});

/* ---------- boot ---------- */
renderAll();
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(reg => { reg.update().catch(() => { }); }).catch(e => console.warn('sw', e));
}
syncNotifs();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (tab === 'plan') rerenderKeepScroll(renderPlan);
  syncNotifs();
});
setInterval(() => { if (document.visibilityState === 'visible' && tab === 'plan' && weekOffset === 0) rerenderKeepScroll(renderPlan); }, 120000);
})();
