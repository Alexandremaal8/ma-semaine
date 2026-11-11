/* Moodle (moodle.epfl.ch) reader for EPFL Calendar.
 * Two independent sources, both optional:
 *  - the calendar export link (iCal): deadlines, quizzes and course events, no password needed
 *  - the mobile web-service key: course contents (new séries, corrections), announcements, upcoming events
 * Everything is summarised into a small "digest" kept in KV, refreshed at most once an hour. */

const BASE = 'https://moodle.epfl.ch';
const UA = { 'User-Agent': 'EPFL-Calendar/1.0 (personal study planner)' };

/* ---------- iCal ---------- */
function unfold(text) { return text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, ''); }
function icsDate(v) {
  // 20261113T225900Z | 20261113T225900 | 20261113
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/.exec(v || ''); if (!m) return null;
  if (!m[4]) return Date.UTC(+m[1], +m[2] - 1, +m[3], 0, 0, 0) - 60 * 60e3; // all-day: midnight Zurich (approx.)
  if (m[7]) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - 60 * 60e3;
}
const icsText = v => (v || '').replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\').trim();
export function parseIcs(text) {
  const out = [];
  for (const block of unfold(text).split('BEGIN:VEVENT').slice(1)) {
    const body = block.split('END:VEVENT')[0];
    const get = k => { const m = new RegExp('^' + k + '(?:;[^:\\n]*)?:(.*)$', 'mi').exec(body); return m ? m[1].trim() : ''; };
    const start = icsDate(get('DTSTART')); if (!start) continue;
    const end = icsDate(get('DTEND')) || start;
    out.push({ uid: get('UID').slice(0, 120), title: icsText(get('SUMMARY')).slice(0, 160), course: icsText(get('CATEGORIES')).slice(0, 80), desc: icsText(get('DESCRIPTION')).slice(0, 300), start, end, src: 'ical' });
  }
  return out.sort((a, b) => a.start - b.start);
}

/* ---------- web services ---------- */
async function ws(token, fn, params) {
  const body = new URLSearchParams({ wstoken: token, wsfunction: fn, moodlewsrestformat: 'json' });
  for (const [k, v] of Object.entries(params || {})) body.append(k, String(v));
  const r = await fetch(BASE + '/webservice/rest/server.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...UA }, body });
  const j = await r.json();
  if (j && j.exception) { const e = new Error(j.message || j.errorcode || 'Moodle error'); e.code = j.errorcode; throw e; }
  return j;
}
const stripLines = h => String(h || '').replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<li[^>]*>/gi, '• ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#039;|&apos;/g, '’').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const strip = h => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#039;|&apos;/g, '’').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
// what a file or activity is, from its name
export { numOf };
export function kindOf(name) {
  const n = (name || '').toLowerCase();
  if (/(corrig|correction|solution|l[öo]sung|corr\.|\bsol[_\-\s]?\d|\bsol\b|_sol|-sol|answers?\b)/.test(n)) return 'correction';
  if (/(s[ée]rie|serie|exercice|exercise|exo|problem set|problems|homework|devoir|sheet|feuille|ubung|übung|\btd\b|\bex[_\-\s]?\d|\bpset)/.test(n)) return 'serie';
  if (/(examen blanc|mock|midterm|exam|examen|quiz|test)/.test(n)) return 'exam';
  return 'other';
}
const numOf = name => { const m = /(?:s[ée]rie|serie|exercices?|exercises?|exos?|sheet|week|semaine|set|feuille|td|ex|sol|corrig[ée]|solutions?)[\s_\-]*n?[°o.]?[\s_\-]*0?(\d{1,2})(?!\d)/i.exec(name || '') || /(?:^|[^\d])0?(\d{1,2})(?!\d)/.exec((name || '').replace(/[A-Z]{2,5}-\d{3}/g, '')); return m ? +m[1] : null; };

export async function readApi(token) {
  const site = await ws(token, 'core_webservice_get_site_info');
  const courses = (await ws(token, 'core_enrol_get_users_courses', { userid: site.userid })) || [];
  const now = Date.now() / 1000;
  const items = [], announcements = [];
  for (const c of courses.slice(0, 15)) {
    // course contents: every file / activity with its date
    try {
      const sections = await ws(token, 'core_course_get_contents', { courseid: c.id });
      for (const sec of sections || []) for (const mod of sec.modules || []) {
        if (mod.visible === 0 || mod.uservisible === false) continue;
        const files = (mod.contents || []).filter(f => f.type === 'file' && f.fileurl).slice(0, 12);
        const name = strip(mod.name), base = { course: c.id, section: strip(sec.name).slice(0, 80), url: (mod.url || '').slice(0, 300) };
        if (!files.length) {
          const t = mod.added || 0; if (!t || t < now - 150 * 86400) continue;
          items.push({ ...base, title: name.slice(0, 160), nice: niceName(name, kindOf(name), numOf(name)), time: t * 1000, kind: kindOf(name), num: numOf(name) });
          continue;
        }
        for (const f of files) {
          const t = f.timemodified || f.timecreated || mod.added || 0; if (!t || t < now - 150 * 86400) continue;
          const label = files.length === 1 ? name : name + ' · ' + strip(f.filename).replace(/\.pdf$/i, '');
          const kind = kindOf(name + ' ' + f.filename), num = numOf(name + ' ' + f.filename);
          items.push({ ...base, title: label.slice(0, 160), nice: niceName(label, kind, num), time: t * 1000, kind, num, file: f.fileurl.slice(0, 400), mime: (f.mimetype || '').slice(0, 60) });
        }
      }
    } catch (e) { /* one course failing must not break the others */ }
  }
  // announcements (news forums)
  try {
    const forums = await ws(token, 'mod_forum_get_forums_by_courses', Object.fromEntries(courses.slice(0, 15).map((c, i) => ['courseids[' + i + ']', c.id])));
    for (const f of (forums || []).filter(f => f.type === 'news').slice(0, 15)) {
      try {
        const d = await ws(token, 'mod_forum_get_forum_discussions', { forumid: f.id, sortorder: 1, page: 0, perpage: 10 });
        for (const x of (d.discussions || [])) {
          const t = (x.timemodified || x.created || 0) * 1000;
          if (t < Date.now() - 45 * 864e5) continue;
          announcements.push({ id: x.discussion || x.id, course: f.course, title: strip(x.name || x.subject).slice(0, 160), text: stripLines(x.message).slice(0, 2500), time: t, posted: (x.created || x.timemodified || 0) * 1000, author: strip(x.userfullname || '').slice(0, 60) });
        }
      } catch (e) { }
    }
  } catch (e) { }
  // upcoming events (deadlines, quizzes) for the next 70 days
  let events = [], actionOk = false;
  try {
    const ev = await ws(token, 'core_calendar_get_action_events_by_timesort', { timesortfrom: Math.floor(now - 86400), timesortto: Math.floor(now + 70 * 86400), limitnum: 50 });
    events = (ev.events || []).map(e => ({ uid: 'api-' + e.id, title: strip(e.name).slice(0, 160), course: e.course ? e.course.fullname : '', courseId: e.course ? e.course.id : null, start: (e.timestart || e.timesort) * 1000, end: ((e.timestart || e.timesort) + (e.timeduration || 0)) * 1000, src: 'api', url: e.url || '', todo: true }));
    actionOk = true;
  } catch (e) { }
  return {
    user: (site.firstname || '').slice(0, 40),
    courses: courses.slice(0, 15).map(c => ({ id: c.id, name: strip(c.fullname).slice(0, 120), short: strip(c.shortname).slice(0, 60) })),
    items: items.sort((a, b) => b.time - a.time).slice(0, 400),
    announcements: announcements.sort((a, b) => b.time - a.time).slice(0, 60),
    events, actionOk
  };
}


/* a readable name for a course file: "MATH101_sol_ex09_v2_final.pdf" → "Corrigé série 9" */
const WORDS = { lecture: 'Cours', lect: 'Cours', lec: 'Cours', cours: 'Cours', week: 'Semaine', wk: 'Semaine', sem: 'Semaine', chapter: 'Chapitre', chap: 'Chapitre', ch: 'Chapitre', notes: 'Notes', summary: 'Résumé', slides: 'Slides', handout: 'Polycopié', poly: 'Polycopié', exam: 'Examen', midterm: 'Examen blanc', mock: 'Examen blanc', quiz: 'Quiz', tutorial: 'Tutoriel', lab: 'TP', tp: 'TP', appendix: 'Annexe', annex: 'Annexe', intro: 'Introduction' };
export function niceName(raw, kind, num) {
  if (kind === 'serie' && num) return 'Série ' + num;
  if (kind === 'correction' && num) return 'Corrigé série ' + num;
  const clean = part => {
    let t = String(part || '').replace(/\.[a-z0-9]{2,5}$/i, '');
    if (t === t.toUpperCase() && /[A-Z]{4}/.test(t)) t = t.toLowerCase();
    t = t.replace(/[A-Z]{2,5}-?\d{3}(\([a-z]{1,3}\))?/gi, ' ')
      .replace(/(\d{4})[-_.](\d{1,2})[-_.](\d{1,2})/g, ' ')
      .replace(/\s+[-–]+\s+/g, ' – ').replace(/[_+]+|(?<=[a-z\d])-(?=[a-z\d])|(?:^|\s)-+/gi, ' ')
      .replace(/\b(19|20)\d{2}\b/g, ' ')
      .replace(/\b(v\d+|final|finale?|copy|copie|draft|new|updated?|rev\d*)\b/gi, ' ')
      .replace(/\(\d\)/g, ' ')
      .replace(/\b(?=[a-z0-9]*\d)(?=[a-z0-9]*[a-z])[a-z0-9]{12,}\b/gi, ' ')
      .replace(/([a-z])(\d)/gi, '$1 $2').replace(/(\d)([a-z]{3,})/gi, '$1 $2')
      .replace(/\b0+(\d)/g, '$1')
      .replace(/\s+/g, ' ').trim();
    t = t.split(' ').map(w => WORDS[w.toLowerCase()] || w).join(' ');
    return t ? t[0].toUpperCase() + t.slice(1) : '';
  };
  const parts = String(raw || '').split(' · ').map(clean).filter(Boolean);
  for (let i = 1; i < parts.length; i++) { const prev = parts[i - 1].toLowerCase(); if (parts[i].toLowerCase().startsWith(prev + ' ')) parts[i] = parts[i].slice(prev.length + 1); }
  const out = parts.map(p => p.replace(/^–\s*|\s*–$/g, '')).filter((p, i) => p && !parts.slice(0, i).some(q => q.toLowerCase() === p.toLowerCase())).join(' · ');
  return (out || String(raw || '')).slice(0, 120);
}


/* ---------- understanding announcements (free Workers AI) ---------- */
const AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const annKey = a => a.course + ':' + a.id + ':' + a.time;
const PROMPT = `You read course announcements from EPFL's Moodle for a first-year student's study planner, and decide what the planner should do.
Answer with ONE JSON object only, no other text:
{"action":"add_mock|add_exam|cancel_session|room_change|deadline|info","date":"YYYY-MM-DD or null","start":"HH:MM or null","end":"HH:MM or null","room":"room or null","session":"Cours|Exercices|null","summary":"one short sentence in French (max 140 chars) saying what matters for the student"}
Rules:
- add_mock: ONLY if the announcement schedules an upcoming mock exam / midterm / examen blanc and gives (or changes) its date. Results, statistics, grades, solutions, copy review, feedback or comments about a mock that already happened are "info".
- add_exam: only if it gives the date of an upcoming final/session exam.
- cancel_session: a lecture (Cours) or exercise session (Exercices) will NOT take place on a given date.
- room_change: a session moves to another room or time on a given date (put the new room/time).
- deadline: something the student must do or hand in before a date (registration, quiz, form, project). Not the weekly exercise sets.
- info: everything else.
- Resolve relative dates ("ce jeudi", "next week", "tomorrow") from the posting date. Dates in the past are possible only for "info".
- start/end in 24h format. If unsure about a field, use null. If unsure about the action, use "info".`;
function cleanAi(o) {
  const A = ['add_mock', 'add_exam', 'cancel_session', 'room_change', 'deadline', 'info'];
  if (!o || !A.includes(o.action)) return null;
  const d = typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : null;
  const hm = v => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '')); return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null; };
  const out = { action: o.action, date: d, start: hm(o.start), end: hm(o.end), room: o.room && o.room !== 'null' ? String(o.room).slice(0, 40) : null, session: ['Cours', 'Exercices'].includes(o.session) ? o.session : null, summary: String(o.summary || '').slice(0, 160) };
  if (out.action !== 'info' && !out.date) out.action = 'info';
  if (out.end != null && out.start != null && out.end <= out.start) out.end = null;
  return out;
}
export async function analyzeAnnouncement(env, an, courseName) {
  if (!env.AI) return null;
  const posted = new Date(an.posted || an.time).toLocaleString('en-CA', { timeZone: 'Europe/Zurich', weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const r = await env.AI.run(AI_MODEL, { messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: `Course: ${courseName}\nPosted: ${posted} (Europe/Zurich)\nTitle: ${an.title}\n\n${String(an.text || '').slice(0, 3000)}` }], max_tokens: 220, temperature: 0 });
  const txt = typeof r === 'string' ? r : r && (typeof r.response === 'string' ? r.response : r.response ? JSON.stringify(r.response) : '');
  const m = /\{[\s\S]*\}/.exec(txt || ''); if (!m) return null;
  try { return cleanAi(JSON.parse(m[0])); } catch (e) { return null; }
}
async function understand(env, dig, old) {
  const prev = {}; for (const a of (old && old.announcements) || []) if (a.ai) prev[annKey(a)] = a.ai;
  let budget = 8;
  for (const a of dig.announcements || []) {
    const k = annKey(a);
    if (prev[k]) { a.ai = prev[k]; continue; }
    if (budget-- <= 0) continue;
    try { const c = (dig.courses || []).find(x => x.id === a.course); a.ai = await analyzeAnnouncement(env, a, c ? c.name + ' (' + c.short + ')' : '') || undefined; } catch (e) { dig.errors.ai = String(e.message || e).slice(0, 120); }
  }
}


/* ---------- reading the séries themselves (PDF → text → time estimate) ---------- */
const STUDY_PROMPT = `You estimate homework workload for a first-year EPFL student (Analyse, Algèbre linéaire, Physique, AICC, Programmation).
You get the text of one weekly exercise sheet ("série"). Answer with ONE JSON object only:
{"exercises": number of exercises, "minutes": total minutes a serious first-year student needs to solve the whole sheet without looking at solutions (realistic, usually 90-300), "per": [minutes per exercise, in order], "topics": ["2 to 5 short topics in French"], "hard": [numbers of the 1-2 hardest exercises]}
Count sub-questions as part of their exercise. Optional/bonus exercises (marked "facultatif", "bonus", "*", "optional") count at half time. If the text is not an exercise sheet, answer {"exercises":0}.`;
function cleanEst(o) {
  if (!o || !(o.exercises > 0) || !(o.minutes > 0)) return null;
  const n = Math.min(40, Math.round(o.exercises)), min = Math.max(30, Math.min(480, Math.round(o.minutes / 5) * 5));
  const per = Array.isArray(o.per) ? o.per.slice(0, 40).map(x => Math.max(0, Math.min(240, Math.round(+x || 0)))) : [];
  return { n, minutes: min, per, topics: (Array.isArray(o.topics) ? o.topics : []).slice(0, 5).map(t => String(t).slice(0, 50)), hard: (Array.isArray(o.hard) ? o.hard : []).slice(0, 3).map(x => +x).filter(x => x > 0), at: Date.now() };
}
export async function estimateSerie(env, token, item) {
  if (!env.AI || typeof env.AI.toMarkdown !== 'function') return null;
  const r = await fetch(item.file + (item.file.includes('?') ? '&' : '?') + 'token=' + token, { headers: UA });
  if (!r.ok) return { err: 'HTTP ' + r.status, at: Date.now() };
  const buf = await r.arrayBuffer(); if (buf.byteLength > 12e6) return { err: 'trop gros', at: Date.now() };
  let md = await env.AI.toMarkdown({ name: 'serie.pdf', blob: new Blob([buf], { type: 'application/pdf' }) });
  if (Array.isArray(md)) md = md[0];
  const text = md && md.format !== 'error' ? String(md.data || '') : '';
  if (text.trim().length < 80) return { err: 'PDF illisible (scanné ?)', at: Date.now() };
  const out = await env.AI.run(AI_MODEL, { messages: [{ role: 'system', content: STUDY_PROMPT }, { role: 'user', content: 'Title: ' + item.title + '\n\n' + text.slice(0, 12000) }], max_tokens: 260, temperature: 0 });
  const txt = typeof out === 'string' ? out : out && (typeof out.response === 'string' ? out.response : out.response ? JSON.stringify(out.response) : '');
  const m = /\{[\s\S]*\}/.exec(txt || ''); if (!m) return { err: 'pas de réponse', at: Date.now() };
  try { return cleanEst(JSON.parse(m[0])) || { err: 'pas une série', at: Date.now() }; } catch (e) { return { err: 'réponse illisible', at: Date.now() }; }
}
export async function studySeries(env, k, max = 2) {
  const [cfg, dig] = await Promise.all([env.KV.get('mcfg:' + k, 'json'), env.KV.get('mdig:' + k, 'json')]);
  if (!cfg || !cfg.token || !dig || !env.AI) return 0;
  const todo = (dig.items || []).filter(i => i.kind === 'serie' && i.file && /pdf/i.test((i.mime || '') + i.file) && !i.est && i.time > Date.now() - 35 * 864e5).sort((a, b) => b.time - a.time).slice(0, max);
  for (const it of todo) { try { it.est = await estimateSerie(env, cfg.token, it) || { err: 'indisponible', at: Date.now() }; } catch (e) { it.est = { err: String(e.message || e).slice(0, 80), at: Date.now() }; } }
  if (todo.length) await env.KV.put('mdig:' + k, JSON.stringify(dig));
  return todo.length;
}

const KEY_RE = /^[a-f0-9]{32,64}$/;
export async function refreshMoodle(env, k, force) {
  const cfg = await env.KV.get('mcfg:' + k, 'json'); if (!cfg) return null;
  const old = await env.KV.get('mdig:' + k, 'json');
  if (!force && old && Date.now() - old.at < 55 * 60e3) return old;
  const dig = { at: Date.now(), ok: {}, errors: {}, courses: old ? old.courses : [], items: [], announcements: [], events: [] };
  if (cfg.ical) {
    try {
      const r = await fetch(cfg.ical, { headers: UA });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const text = await r.text();
      if (!/BEGIN:VCALENDAR/.test(text)) throw new Error('Ce lien ne renvoie pas un calendrier');
      dig.events.push(...parseIcs(text)); dig.ok.ical = true;
    } catch (e) { dig.errors.ical = String(e.message || e); }
  }
  if (cfg.token) {
    try {
      const a = await readApi(cfg.token);
      Object.assign(dig, { user: a.user, courses: a.courses, items: a.items, announcements: a.announcements });
      await understand(env, dig, old);
      const ests = {}; for (const i of (old && old.items) || []) if (i.est && i.file) ests[i.file] = i.est;
      for (const i of dig.items || []) if (ests[i.file]) i.est = ests[i.file];
      // API events complete the iCal ones (same deadline may come from both: keep one)
      // events still waiting for you on Moodle (not submitted / not completed) are marked "todo"
      for (const e of a.events) { const same = dig.events.find(x => Math.abs(x.start - e.start) < 60e3 && x.title === e.title); if (same) same.todo = true; else dig.events.push(e); }
      dig.actionOk = a.actionOk;
      dig.ok.api = true;
    } catch (e) { dig.errors.api = e.code === 'invalidtoken' ? 'Clé refusée par Moodle (expirée ou mal copiée)' : String(e.message || e); }
  }
  dig.events.sort((a, b) => a.start - b.start);
  await env.KV.put('mdig:' + k, JSON.stringify(dig));
  return dig;
}

export async function moodleRoute(req, env, url, json) {
  if (url.pathname === '/moodle/file' && req.method === 'GET') {
    // opens a course file (PDF…) with the saved key; only files listed in this user's digest
    const k = url.searchParams.get('k') || '', u = url.searchParams.get('u') || '';
    if (!KEY_RE.test(k)) return json({ error: 'bad key' }, 400);
    const [cfg, dig] = await Promise.all([env.KV.get('mcfg:' + k, 'json'), env.KV.get('mdig:' + k, 'json')]);
    if (!cfg || !cfg.token || !dig || !(dig.items || []).some(i => i.file === u) || !u.startsWith(BASE + '/webservice/pluginfile.php/')) return new Response('Fichier introuvable', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' } });
    const r = await fetch(u + (u.includes('?') ? '&' : '?') + 'token=' + cfg.token, { headers: UA });
    const it = dig.items.find(i => i.file === u), ext = (/\.([a-z0-9]{2,5})(?:\?|$)/i.exec(u) || [, 'pdf'])[1];
    const fname = (String(url.searchParams.get('n') || (it && it.nice) || 'document').replace(/[\\/:*?"<>|\n\r]+/g, ' ').trim().slice(0, 100) || 'document') + '.' + ext;
    const h = new Headers({ 'Content-Type': r.headers.get('Content-Type') || 'application/pdf', 'Content-Disposition': "inline; filename*=UTF-8''" + encodeURIComponent(fname), 'Cache-Control': 'private, max-age=3600', 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Disposition' });
    return new Response(r.body, { status: r.status, headers: h });
  }
  if (url.pathname === '/moodle/study' && req.method === 'POST') {
    const data = await req.json().catch(() => ({})); const k = String(data.k || '');
    if (!KEY_RE.test(k)) return json({ error: 'bad key' }, 400);
    const n = await studySeries(env, k, 2);
    return json({ ok: true, read: n });
  }
  if (url.pathname === '/moodle' && req.method === 'GET') {
    const k = url.searchParams.get('k') || '';
    if (!KEY_RE.test(k)) return json({ error: 'bad key' }, 400);
    const dig = await refreshMoodle(env, k, url.searchParams.get('force') === '1');
    return json(dig || { none: true });
  }
  if (url.pathname === '/moodle' && req.method === 'POST') {
    const data = await req.json().catch(() => ({}));
    const k = String(data.k || '');
    if (!KEY_RE.test(k)) return json({ error: 'bad key' }, 400);
    if (data.remove) { await env.KV.delete('mcfg:' + k); await env.KV.delete('mdig:' + k); const l = (await env.KV.get('mlist', 'json')) || []; await env.KV.put('mlist', JSON.stringify(l.filter(x => x !== k))); return json({ ok: true }); }
    const cur = (await env.KV.get('mcfg:' + k, 'json')) || {};
    if (typeof data.ical === 'string') {
      const ical = data.ical.trim();
      if (ical && !/^https:\/\/moodle\.epfl\.ch\/calendar\/export_execute\.php\?/.test(ical)) return json({ error: 'Le lien doit commencer par https://moodle.epfl.ch/calendar/export_execute.php' }, 400);
      cur.ical = ical || undefined;
    }
    if (typeof data.token === 'string') {
      const token = data.token.trim();
      if (token && !/^[a-f0-9]{32}$/i.test(token)) return json({ error: 'La clé fait 32 caractères (chiffres et lettres a à f)' }, 400);
      cur.token = token || undefined;
    }
    if (Array.isArray(data.tokens)) {
      // several possible readings of the same key: keep the one Moodle accepts
      let good = null, last = '';
      for (const t of data.tokens.slice(0, 8).map(String).filter(t => /^[a-f0-9]{32}$/.test(t))) {
        try { await ws(t, 'core_webservice_get_site_info'); good = t; break; } catch (e) { last = e.code === 'invalidtoken' ? 'Clé refusée par Moodle' : String(e.message || e); }
      }
      if (!good) return json({ error: last || 'Clé illisible : recopie toute l’adresse' }, 400);
      cur.token = good;
    }
    await env.KV.put('mcfg:' + k, JSON.stringify(cur));
    const l = (await env.KV.get('mlist', 'json')) || []; if (!l.includes(k)) { l.push(k); await env.KV.put('mlist', JSON.stringify(l.slice(-10))); }
    const dig = await refreshMoodle(env, k, true);
    return json(dig);
  }
  return null;
}
