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
