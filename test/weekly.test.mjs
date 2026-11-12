import assert from 'assert';
import { createRequire } from 'module';
const L = createRequire(import.meta.url)('../site/logic.js');
const S = L.normalize(L.defaultState()); S.since = new Date(2026, 10, 1).getTime();
const ws = L.mondayOf(new Date(2026, 10, 9));
const mooc = g => g.flatMap(x => x.ev.filter(e => /MOOC/.test(e.title)).map(e => ({ d: x.d, s: e.start, e: e.end, t: e.title, st: e.state })));
let m = mooc(L.generate(S, ws, new Date(2026, 10, 9, 6)));
const first = m.filter(x => /1re/.test(x.t)), second = m.filter(x => /2e/.test(x.t));
assert.ok(first.every(x => x.d < 2), 'MOOC 1re heure before Wednesday');
assert.equal(first.reduce((a, x) => a + x.e - x.s, 0), 60);
assert.deepEqual(second.map(x => [x.d, x.s, x.e]), [[2, 795, 840]]);
const wed = L.generate(S, ws, new Date(2026, 10, 9, 6))[2].ev.find(e => e.kind === 'course' && e.subj === 'prog');
assert.deepEqual([wed.start, wed.end], [855, 900]);
// Monday missed: the hour moves to Tuesday, still before Wednesday
m = mooc(L.generate(S, ws, new Date(2026, 10, 10, 15, 30))).filter(x => /1re/.test(x.t) && x.st === 'todo');
assert.ok(m.length && m.every(x => x.d === 1), 'rescheduled on Tuesday');
// done on Monday: nothing more to place
const g0 = L.generate(S, ws, new Date(2026, 10, 9, 6)); S.done[L.iso(ws)] = {};
for (const e of g0[0].ev.filter(e => /1re/.test(e.title))) S.done[L.iso(ws)][e.id] = { t: e.title, s: 'prog', m: e.end - e.start };
m = mooc(L.generate(S, ws, new Date(2026, 10, 10, 9))).filter(x => /1re/.test(x.t) && x.st === 'todo');
assert.equal(m.length, 0);
console.log('weekly OK');
{
  // the prog "exam" of 25 Nov becomes Mini-projet 2 (25 Nov → 17 Dec)
  const old = L.defaultState(); old.v = 9; delete old.projects; old.subjects.find(x => x.id === 'prog').exam = '2026-11-25';
  const S2 = L.normalize(JSON.parse(JSON.stringify(old))); S2.since = new Date(2026, 10, 1).getTime();
  assert.equal(S2.subjects.find(x => x.id === 'prog').exam, '');
  assert.deepEqual(S2.projects.map(p => [p.title, p.from, p.to]), [['Mini-projet 2', '2026-11-25', '2026-12-17']]);
  S2.projects[0].sessions = [{ date: '2026-11-27', start: 975, end: 1080, weekly: true }];
  let total = 0;
  for (const w of [new Date(2026, 10, 23), new Date(2026, 10, 30), new Date(2026, 11, 7), new Date(2026, 11, 14), new Date(2026, 11, 21)]) {
    const ws2 = L.mondayOf(w), key = L.iso(ws2);
    const g = L.generate(S2, ws2, ws2);
    assert.equal(g.meta.mustLeftAfter, 0, 'séries still fit in week ' + key);
    S2.done[key] = {};
    for (const x of g) for (const e of x.ev) if (/Mini-projet/.test(e.title)) {
      assert.ok(x.date >= new Date(2026, 10, 25) && x.date <= new Date(2026, 11, 17), 'inside the project dates');
      S2.done[key][e.id] = { t: e.title, s: 'prog', m: e.end - e.start }; total += e.end - e.start;
    }
    if (key === '2026-11-23') assert.ok(g[4].ev.some(e => e.fixed && /binôme/.test(e.title) && e.start === 975), 'Friday session');
  }
  assert.ok(total >= 19 * 60 && total <= 21 * 60, 'about 20h in total: ' + total);
}
console.log('projects OK');
{
  // sport: double progression
  const S3 = {};
  assert.deepEqual(L.sportLevel(S3, 'a1'), { lvl: 1, target: 8, fails: 0 });          // push-ups start "classiques", 8 reps
  L.sportProgress(S3, 'a1', [8, 8, 8, 8]); assert.equal(S3.sportProg.a1.target, 9);    // all sets hit → +1
  L.sportProgress(S3, 'a1', [9, 9, 7, 6]); assert.equal(S3.sportProg.a1.target, 9);    // missed one → same
  L.sportProgress(S3, 'a1', [15, 15, 15, 15]); assert.equal(S3.sportProg.a1.target, 15);
  const up = L.sportProgress(S3, 'a1', [15, 15, 15, 15]); assert.equal(up.lvl, 2); assert.equal(S3.sportProg.a1.target, 8);   // next variant
  L.sportProgress(S3, 'a1', [4, 4, 3, 3]); L.sportProgress(S3, 'a1', [5, 4, 4, 3]); assert.equal(S3.sportProg.a1.lvl, 1);      // twice far below → easier variant
  L.sportProgress(S3, 'a6', [30, 30, 30]); assert.equal(S3.sportProg.a6.target, 35);   // timed: +5 s
  // revision time before a mock depends on how much the subject matters
  assert.equal(L.mockPrepBudget({ prio: 3 }), 210); assert.equal(L.mockPrepBudget({ prio: 2 }), 150);
}
console.log('sport OK');
{
  // a série read on Moodle replaces the usual time; no courses after the last day of the semester; exam passes
  const S4 = L.normalize(L.defaultState()); S4.since = new Date(2026, 10, 1).getTime();
  const ws4 = L.mondayOf(new Date(2026, 10, 9)), k4 = L.iso(ws4);
  const before = L.generate(S4, ws4, ws4).meta.mustTotal;
  S4.serieEst = { [k4]: { ana: 90 } };
  assert.ok(L.generate(S4, ws4, ws4).meta.mustTotal < before);   // analyse: 3h → 1h30 (minus the exercise session)
  assert.equal(S4.semEnd, '2026-12-18');
  assert.equal(L.coursesOnFor(S4, L.mondayOf(new Date(2026, 11, 14))), true);
  assert.equal(L.coursesOnFor(S4, L.mondayOf(new Date(2027, 0, 4))), false);
  S4.trips = [{ id: 't', title: 'Liban', from: '2026-12-20', to: '2027-01-02', light: 60 }];
  S4.subjects[0].exam = '2027-01-26';
  assert.deepEqual(['2026-12-16', '2027-01-12', '2027-01-25'].map(d => L.examPass(S4, '2027-01-26', L.fromIso(d))), [0, 1, 2]);
  assert.ok(!L.examDays(S4, '2027-01-26').includes('2026-12-25'), 'trip days are not campaign days');
  const g = L.generate(S4, L.mondayOf(new Date(2027, 0, 11)), L.mondayOf(new Date(2027, 0, 11)));
  assert.ok(g.some(x => x.ev.some(e => /^Examen du 26 janv\. · passe/.test(e.title))), 'exam revision blocks named by pass');
  assert.ok(!g.some(x => x.ev.some(e => /^Série/.test(e.title))), 'no séries after the semester');
}
console.log('exams OK');
{
  // exercise sessions are série blocks
  const S5 = L.normalize(L.defaultState()); S5.since = new Date(2026, 10, 1).getTime();
  const ws5 = L.mondayOf(new Date(2026, 10, 9)), k5 = L.iso(ws5);
  const out = (g, subj) => g.flatMap(x => x.ev.filter(e => e.kind === 'study' && e.subj === subj && e.serie && !e.corr && !e.fixed)).reduce((a, e) => a + e.end - e.start, 0);
  let g = L.generate(S5, ws5, ws5);
  const exo = g.flatMap(x => x.ev.filter(e => e.subj === 'ana' && /séance d’exercices/.test(e.title)).map(e => ({ d: x.d, e })));
  assert.ok(exo.length && exo.every(z => z.e.kind === 'study' && z.e.serie && z.e.fixed && /^Série \d+ · séance d’exercices$/.test(z.e.title)), 'exercise session = série block');
  const exoLen = exo.reduce((a, z) => a + z.e.end - z.e.start, 0), su = S5.subjects.find(x => x.id === 'ana');
  assert.ok(Math.abs(out(g, 'ana') - (su.serie - exoLen)) <= 20, 'série time outside the session = série − session (' + out(g, 'ana') + ')');
  // session missed → its time comes back in the blocks ahead
  const z = exo[0], after = new Date(z.e.end * 6e4 + L.addDays(ws5, z.d).getTime() + 60e3);
  const g2 = L.generate(S5, ws5, after);
  const futureAna = g2.flatMap(x => x.ev.filter(e => e.kind === 'study' && e.subj === 'ana' && e.serie && !e.corr && e.state === 'todo')).reduce((a, e) => a + e.end - e.start, 0);
  assert.ok(futureAna >= exoLen - 20, 'missed session replanned (' + futureAna + ')');
  // série ticked "finie": the session is a plain class again
  S5.serieDone = { [k5]: { ana: true } };
  g = L.generate(S5, ws5, ws5);
  assert.ok(g.some(x => x.ev.some(e => e.kind === 'course' && e.subj === 'ana' && /Exercices/.test(e.sub))));
}
console.log('exo OK');
{
  // a focus running: notification when the planned time is up, or at each pomodoro phase; nothing while paused
  const S6 = L.normalize(L.defaultState()); const t0 = new Date(2026, 10, 10, 11, 0).getTime();
  S6.focus = { run: { title: 'Série 9', start: t0, paused: 5 * 6e4, pauseAt: null, plan: 50 }, log: [] };
  let n = L.buildNotifications(S6, new Date(t0 + 60e3), 1).filter(x => x.tag === 'focus');
  assert.deepEqual(n.map(x => [x.title, (x.at - t0) / 6e4]), [['Temps prévu écoulé', 55]]);
  S6.focus.run.pomo = true; S6.focus.run.paused = 0;
  n = L.buildNotifications(S6, new Date(t0 + 60e3), 1).filter(x => x.tag === 'focus');
  assert.deepEqual(n.slice(0, 3).map(x => (x.at - t0) / 6e4), [25, 30, 55]);
  S6.focus.run.pauseAt = t0 + 10 * 6e4;
  assert.equal(L.buildNotifications(S6, new Date(t0 + 11 * 6e4), 1).filter(x => x.tag === 'focus').length, 0);
}
console.log('focus OK');
{
  // where you are in a série: your pace on the exercises done predicts the rest
  const S3 = L.normalize(L.defaultState()); S3.since = new Date(2026, 10, 9).getTime();
  const w3 = L.mondayOf(new Date(2026, 10, 9)), k3 = L.iso(w3), now3 = new Date(2026, 10, 12, 13);
  S3.done[k3] = { x1: { s: 'ana', t: 'Série 9', m: 60, d: 3, a: 600, serie: true } };
  const r = L.serieReport(S3, w3, 'ana', 2, 4);
  assert.ok(!r.done && r.rem >= 60 && r.rem <= 150, 'rest of the série from your pace: ' + r.rem);
  let left = 0; for (const x of L.generate(S3, w3, now3)) for (const e of x.ev) if (e.subj === 'ana' && e.serie && e.state === 'todo') left += e.end - e.start;
  assert.ok(Math.abs(left - r.rem - 30) <= 25, 'planner keeps what is left (+ correction): ' + left + ' vs ' + r.rem);
  assert.ok(L.serieReport(S3, w3, 'ana', 4, 4).done && S3.serieDone[k3].ana, 'last exo → série finished');
  // a done exercise session counts for the série (it used to put its time back)
  const S4 = L.normalize(L.defaultState()); S4.since = new Date(2026, 10, 9).getTime();
  const g4 = L.generate(S4, w3, new Date(2026, 10, 13, 16)), ex = g4[4].ev.find(e => e.exo !== undefined && e.subj === 'prog' && e.serie);
  S4.done[k3] = { [ex.id]: { s: 'prog', t: ex.title, m: 105, d: 4, a: ex.start, serie: true, fx: true } };
  let pl = 0; for (const x of L.generate(S4, w3, new Date(2026, 10, 13, 16))) for (const e of x.ev) if (e.subj === 'prog' && e.kind === 'study' && e.state === 'todo' && !e.fixed && !/retard/i.test(e.title)) pl += e.end - e.start;
  assert.ok(pl <= 60, 'after the session only the end of the série + correction: ' + pl);
  // a corrigé spotted before the exercise session never puts the correction before it
  S4.done = {}; S4.corrSeen = { [k3]: { prog: '2026-11-10' } };
  const cd = L.generate(S4, w3, new Date(2026, 10, 12, 8)).flatMap(x => x.ev.filter(e => e.subj === 'prog' && e.corr).map(() => x.d));
  assert.ok(cd.length && Math.min(...cd) >= 5, 'correction after Friday: ' + cd);
  console.log('serie progress OK');
}
{
  // a timed exam: a campus morning, calm before it, nothing planned on top
  const S = L.normalize(L.defaultState()); S.since = new Date(2026, 10, 1).getTime();
  Object.assign(S.subjects.find(s => s.id === 'ana'), { exam: '2027-01-11', examStart: 555, examEnd: 750, examRoom: 'INM 200' });
  const day = L.generate(S, L.mondayOf(new Date(2027, 0, 11)), new Date(2027, 0, 4))[0];
  const ex = day.ev.find(e => e.exam);
  assert.ok(ex && ex.start === 555 && ex.end === 750 && /INM 200/.test(ex.sub), 'exam on the day with its room');
  assert.ok(day.ev.some(e => e.kind === 'move' && e.end <= 555), 'commute to the exam');
  assert.ok(!day.ev.some(e => e.kind === 'study' && e.start < 555), 'no study before the exam');
  assert.ok(!day.ev.some(e => e !== ex && e.end > e.start && e.start < ex.end && e.end > ex.start), 'nothing on top of the exam');
  console.log('exam day OK');
}
{
  // the sport program: board + body weight, one cable exercise at most, every move illustrated, real rests
  const all = L.SPORT.workouts.flatMap(w => w.ex);
  assert.ok(all.filter(e => e.gear === 'câbles').length <= 1, 'cables minimized');
  assert.ok(all.every(e => e.pose && e.q && e.rest >= 30), 'every exercise has a figure, a demo search and a real rest');
  assert.ok(!all.some(e => e.levels.some(l => /pause/i.test(l[0]))), 'no "pause" variant that reads like a rest');
  console.log('sport v2 OK');
}
{
  // the chrono is the proof, at the END of the block; late start and overtime adapt
  const S = L.normalize(L.defaultState()); S.since = new Date(2026, 10, 9).getTime();
  const ws = L.mondayOf(new Date(2026, 10, 9)), wk = L.iso(ws);
  const b = L.generate(S, ws, new Date(2026, 10, 14, 9, 0))[5].ev.find(e => e.kind === 'study' && !e.fixed && e.start >= 600);
  const at = m => new Date(2026, 10, 14, Math.floor(m / 60), m % 60);
  const day = (m) => L.generate(S, ws, at(m))[5].ev.filter(e => e.kind === 'study');
  const st = m => day(m).find(e => e.id === b.id);
  assert.equal(st(b.start + 30).state, 'todo', 'no chrono yet but the block is not over');
  assert.equal(st(b.end + 1).state, 'missed', 'over without chrono → not done');
  // chrono started 10 min late, running over into the next block
  S.focus = { run: { id: b.id, start: at(b.start + 10).getTime() } };
  const nxt = day(b.start).find(e => e.start >= b.end && !e.fixed);
  const during = day(nxt.end + 1).find(e => e.id === nxt.id);
  assert.ok(during && during.state === 'todo', 'the next block waits for the running chrono');
  // stopped after 95 min: shows its real times, the next block makes room
  S.focus = {}; S.done[wk] = { [b.id]: { s: b.subj, t: b.title, m: 95, d: 5, a: b.start, rs: b.start + 10, focus: true, serie: b.serie } };
  const after = day(b.start + 120);
  const me = after.find(e => e.id === b.id);
  assert.ok(me.start === b.start + 10 && me.end === b.start + 105, 'real times: ' + me.start + '-' + me.end);
  assert.ok(!after.some(e => e !== me && e.state !== 'done' && e.start < me.end && e.end > me.start), 'nothing overlaps the real block');
  console.log('chrono truth OK');
}
{
  // January: only subjects with an exam still ahead get revision time; one notification per study block
  const S = L.normalize(L.defaultState()); S.since = new Date(2026, 10, 1).getTime();
  const ex = { ana: '2027-01-11', phy: '2027-01-15', alg: '2027-01-18', aicc: '2027-01-22' };
  for (const su of S.subjects) if (ex[su.id]) su.exam = ex[su.id];
  const g = L.generate(S, L.mondayOf(new Date(2027, 0, 18)), new Date(2027, 0, 17, 20));
  const by = {}; for (const x of g) for (const e of x.ev) if (e.kind === 'study') by[e.subj] = (by[e.subj] || 0) + e.end - e.start;
  assert.ok(!by.prog && !by.ana && !by.phy, 'no time for prog (no exam) nor passed exams: ' + JSON.stringify(by));
  assert.ok(by.aicc > 600, 'the last exam gets the week');
  S.notif.on = true;
  const n = L.buildNotifications(S, new Date(2026, 10, 21, 6), 1), tags = n.map(x => x.tag);
  assert.equal(new Set(tags).size, tags.length, 'one notification per block');
  console.log('january OK');
}
