import { parseIcs, kindOf, refreshMoodle, moodleRoute } from '../worker/src/moodle.js';
import assert from 'assert';
const ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:1@moodle\r\nSUMMARY:Quiz 3 is due\r\nDTSTART:20261113T225900Z\r\nDTEND:20261113T225900Z\r\nCATEGORIES:Analyse I\r\nDESCRIPTION:long\r\n  text\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:2\r\nSUMMARY:Examen blanc\\, salle CO1\r\nDTSTART;VALUE=DATE:20261120\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
const ev = parseIcs(ics);
assert.equal(ev.length, 2); assert.equal(ev[0].course, 'Analyse I'); assert.equal(ev[0].start, Date.UTC(2026,10,13,22,59)); assert.equal(ev[1].title, 'Examen blanc, salle CO1'); assert.equal(ev[0].desc, 'long text');
assert.equal(kindOf('Corrigé série 9'), 'correction'); assert.equal(kindOf('Série 10'), 'serie'); assert.equal(kindOf('Slides cours 4'), 'other');
// fake KV + fake Moodle
const store = new Map(); const KV = { get: async (k, t) => { const v = store.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => store.set(k, v), delete: async k => store.delete(k) };
const now = Math.floor(Date.now()/1000);
globalThis.fetch = async (u, o) => {
  if (String(u).includes('export_execute')) return new Response(ics);
  const f = new URLSearchParams(o.body).get('wsfunction');
  const R = {
    core_webservice_get_site_info: { userid: 5, firstname: 'Alex' },
    core_enrol_get_users_courses: [{ id: 11, fullname: 'Analyse I', shortname: 'MATH-101' }],
    core_course_get_contents: [{ name: 'Semaine 9', modules: [{ name: 'Série 9', added: now-3600, url: 'u', contents: [{ type: 'file', filename: 'serie9.pdf', timemodified: now-3600 }] }, { name: 'Corrigé série 8', added: now-100, contents: [] }] }],
    mod_forum_get_forums_by_courses: [{ id: 3, course: 11, type: 'news' }],
    mod_forum_get_forum_discussions: { discussions: [{ name: 'Salle changée', message: '<p>CO1 &amp; CO2</p>', timemodified: now-50 }] },
    core_calendar_get_action_events_by_timesort: { events: [{ id: 9, name: 'Quiz 3 is due', timestart: Date.UTC(2026,10,13,22,59)/1000, course: { id: 11, fullname: 'Analyse I' } }, { id: 10, name: 'Devoir 2', timestart: now+86400, course: { id: 11, fullname: 'Analyse I' } }] }
  }[f];
  return new Response(JSON.stringify(R));
};
const json = (o, s=200) => new Response(JSON.stringify(o), { status: s });
const k = 'a'.repeat(32);
let r = await moodleRoute(new Request('https://x/moodle', { method: 'POST', body: JSON.stringify({ k, ical: 'https://evil.com/x' }) }), { KV }, new URL('https://x/moodle'), json);
assert.equal(r.status, 400);
r = await moodleRoute(new Request('https://x/moodle', { method: 'POST', body: JSON.stringify({ k, ical: 'https://moodle.epfl.ch/calendar/export_execute.php?userid=1&authtoken=abc', token: 'ab'.repeat(16) }) }), { KV }, new URL('https://x/moodle'), json);
const d = await r.json();
assert.ok(d.ok.ical && d.ok.api, JSON.stringify(d.errors));
assert.equal(d.events.length, 3, 'dedup ical/api'); assert.equal(d.items.length, 2); assert.equal(d.items[0].kind, 'correction'); assert.equal(d.announcements[0].text, 'CO1 & CO2'); assert.equal(d.user, 'Alex');
console.log('moodle OK');
// several candidate keys: the one Moodle accepts is kept
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, o) => { const b = o && o.body ? new URLSearchParams(o.body) : null; if (b && b.get('wstoken') !== 'cd'.repeat(16)) return new Response(JSON.stringify({ exception: 'x', errorcode: 'invalidtoken' })); return realFetch(u, o); };
  const k2 = 'b'.repeat(32);
  let r2 = await moodleRoute(new Request('https://x/moodle', { method: 'POST', body: JSON.stringify({ k: k2, tokens: ['ef'.repeat(16), 'cd'.repeat(16)] }) }), { KV }, new URL('https://x/moodle'), json);
  const d2 = await r2.json(); assert.ok(d2.ok.api, 'token candidates');
  assert.equal(JSON.parse(store.get('mcfg:' + k2)).token, 'cd'.repeat(16));
  r2 = await moodleRoute(new Request('https://x/moodle', { method: 'POST', body: JSON.stringify({ k: k2, tokens: ['ef'.repeat(16)] }) }), { KV }, new URL('https://x/moodle'), json);
  assert.equal(r2.status, 400);
  console.log('moodle tokens OK');
}
{
  const { createRequire } = await import('module'); const L = createRequire(import.meta.url)('../site/logic.js');
  const tok = '0123456789abcdef0123456789abcdef', b = Buffer.from('a1b2c3d4e5f60718293a4b5c6d7e8f90:::' + tok + ':::AbCdEf123').toString('base64');
  assert.ok(L.moodleTokens('https://token=' + b).includes(tok)); assert.ok(L.moodleTokens('https://token=' + b.toLowerCase()).includes(tok)); assert.deepEqual(L.moodleTokens('nope'), []);
  console.log('moodle launch OK');
}
{
  const { niceName, kindOf: k, numOf: n } = await import('../worker/src/moodle.js');
  const nn = x => niceName(x, k(x), n(x));
  assert.equal(nn('MATH101_sol_ex09_v2_final.pdf'), 'Corrigé série 9');
  assert.equal(nn('CS101-Chap4-Graphs (1).pdf'), 'Chapitre 4 Graphs');
  assert.equal(nn('a8f3e9b2c1d4e5f6a7b8_scan.pdf'), 'Scan');
  console.log('moodle names OK');
}
{
  const { createRequire } = await import('module'); const L = createRequire(import.meta.url)('../site/logic.js');
  const ref = new Date(2026, 10, 10, 9);
  const P = (a, b) => L.parseAnnounce(a, b, ref);
  assert.deepEqual(P('Examen blanc', 'L’examen blanc aura lieu le mercredi 25 novembre de 8h15 à 10h en CO1.'), { kind: 'mock', type: '', date: '2026-11-25', start: 495, end: 600 });
  assert.deepEqual(P('Midterm', 'on November 27th, 2:15pm-4pm in CE1'), { kind: 'mock', type: '', date: '2026-11-27', start: 855, end: 960 });
  assert.equal(P('Pas de cours jeudi', 'Il n’y aura pas de séance d’exercices ce jeudi.').date, '2026-11-12');
  assert.equal(P('Info', 'Le cours du 12.11 est annulé.').type, 'Cours');
  assert.equal(P('Exam date', 'The final exam is on January 26, 2027 at 9:00.').date, '2027-01-26');
  assert.equal(P('Bonne semaine', 'Voici les slides du cours 5.'), null);
  // a cancelled session disappears from the plan
  const S = L.defaultState(); const ws = L.mondayOf(new Date(2026, 10, 9));
  S.cancel = [{ date: '2026-11-11', subj: 'phy', type: 'Exercices' }];
  const wed = L.generate(L.normalize(S), ws, new Date(2026, 10, 9, 6))[2].ev.filter(e => e.kind === 'course');
  assert.ok(!wed.some(e => e.subj === 'phy') && wed.some(e => e.subj === 'ana'));
  console.log('moodle announce OK');
}
{
  const { analyzeAnnouncement } = await import('../worker/src/moodle.js');
  const mk = resp => ({ AI: { run: async () => ({ response: resp }) } });
  const an = { title: 'x', text: 'y', time: Date.now() };
  assert.equal((await analyzeAnnouncement(mk('{"action":"add_mock","date":"2026-12-02","start":"08:15","end":"10:00","summary":"ok"}'), an, 'c')).start, 495);
  assert.equal((await analyzeAnnouncement(mk('{"action":"add_mock","date":null}'), an, 'c')).action, 'info');   // no date → nothing to plan
  assert.equal(await analyzeAnnouncement(mk('sorry, I cannot'), an, 'c'), null);
  assert.equal(await analyzeAnnouncement(mk('{"action":"delete_everything"}'), an, 'c'), null);
  assert.equal(await analyzeAnnouncement({}, an, 'c'), null);   // no AI: the app falls back to its own reading
  console.log('moodle ai OK');
}
