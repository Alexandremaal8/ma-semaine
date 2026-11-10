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
          items.push({ ...base, title: name.slice(0, 160), time: t * 1000, kind: kindOf(name), num: numOf(name) });
          continue;
        }
        for (const f of files) {
          const t = f.timemodified || f.timecreated || mod.added || 0; if (!t || t < now - 150 * 86400) continue;
          const label = files.length === 1 ? name : name + ' · ' + strip(f.filename).replace(/\.pdf$/i, '');
          items.push({ ...base, title: label.slice(0, 160), time: t * 1000, kind: kindOf(name + ' ' + f.filename), num: numOf(name + ' ' + f.filename), file: f.fileurl.slice(0, 400), mime: (f.mimetype || '').slice(0, 60) });
        }
      }
    } catch (e) { /* one course failing must not break the others */ }
  }
  // announcements (news forums)
  try {
    const forums = await ws(token, 'mod_forum_get_forums_by_courses', Object.fromEntries(courses.slice(0, 15).map((c, i) => ['courseids[' + i + ']', c.id])));
    for (const f of (forums || []).filter(f => f.type === 'news').slice(0, 15)) {
      try {
        const d = await ws(token, 'mod_forum_get_forum_discussions', { forumid: f.id, sortorder: 1, page: 0, perpage: 5 });
        for (const x of (d.discussions || [])) {
          const t = (x.timemodified || x.created || 0) * 1000;
          if (t < Date.now() - 21 * 864e5) continue;
          announcements.push({ course: f.course, title: strip(x.name || x.subject).slice(0, 160), text: strip(x.message).slice(0, 400), time: t });
        }
      } catch (e) { }
    }
  } catch (e) { }
  // upcoming events (deadlines, quizzes) for the next 70 days
  let events = [];
  try {
    const ev = await ws(token, 'core_calendar_get_action_events_by_timesort', { timesortfrom: Math.floor(now - 86400), timesortto: Math.floor(now + 70 * 86400), limitnum: 50 });
    events = (ev.events || []).map(e => ({ uid: 'api-' + e.id, title: strip(e.name).slice(0, 160), course: e.course ? e.course.fullname : '', courseId: e.course ? e.course.id : null, start: (e.timestart || e.timesort) * 1000, end: ((e.timestart || e.timesort) + (e.timeduration || 0)) * 1000, src: 'api', url: e.url || '' }));
  } catch (e) { }
  return {
    user: (site.firstname || '').slice(0, 40),
    courses: courses.slice(0, 15).map(c => ({ id: c.id, name: strip(c.fullname).slice(0, 120), short: strip(c.shortname).slice(0, 60) })),
    items: items.sort((a, b) => b.time - a.time).slice(0, 400),
    announcements: announcements.sort((a, b) => b.time - a.time).slice(0, 30),
    events
  };
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
      // API events complete the iCal ones (same deadline may come from both: keep one)
      for (const e of a.events) if (!dig.events.some(x => Math.abs(x.start - e.start) < 60e3 && x.title === e.title)) dig.events.push(e);
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
    const h = new Headers({ 'Content-Type': r.headers.get('Content-Type') || 'application/pdf', 'Content-Disposition': 'inline', 'Cache-Control': 'private, max-age=3600', 'Access-Control-Allow-Origin': '*' });
    return new Response(r.body, { status: r.status, headers: h });
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
