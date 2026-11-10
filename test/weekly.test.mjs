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
