const L=require('../site/logic.js');
let bad=0; const fail=(...a)=>{bad++;console.log('  FAIL',...a)};
const mon=new Date(2026,10,9);
function check(S,now,label){
  const ws=L.mondayOf(now), days=L.generate(S,ws,now), sm=L.summarize(S,days,L.iso(ws));
  for(const d of days){const b=d.ev.filter(e=>e.end>e.start).sort((a,b)=>a.start-b.start);
    for(let i=1;i<b.length;i++)if(b[i].start<b[i-1].end)fail(label,'overlap',L.DAYS[d.d],L.fmt(b[i-1].start),b[i-1].title,'/',L.fmt(b[i].start),b[i].title);
    if(new Set(d.ev.map(e=>e.id)).size!==d.ev.length)fail(label,'dup id',d.d);
    if(d.d<5&&d.wake!==390)fail(label,'wake',d.d,d.wake); if(d.d<5&&d.sleep!==1380)fail(label,'sleep',d.d);}
  return {days,sm,meta:days.meta};
}
// 1. every mode, fresh week
for(const mode of L.MODE_ORDER){const S=L.defaultState();S.mode=mode;S.since=0;const r=check(S,new Date(2026,10,9,6,0),mode);
  console.log(mode.padEnd(10),'cible',L.hm(r.meta.T),'prévu',L.hm(r.sm.plan),'séries',L.hm(r.meta.mustTotal),'non placé',r.meta.unplaced,'sport',L.hm(r.meta.sportMin),
   '| par jour',r.days.map(d=>L.hm(d.plan)).join(' '));
  if(mode!=='recup'&&r.meta.mustLeftAfter>15)fail(mode,'séries pas toutes placées',r.meta.mustLeftAfter);}
// 2. day off on Saturday → its study goes elsewhere, total unchanged
{const S=L.defaultState();S.since=0;const a=check(S,new Date(2026,10,9,6,0),'base');S.offDays=['2026-11-14'];const b=check(S,new Date(2026,10,9,6,0),'off');
 console.log('jour off samedi:',L.hm(a.days[5].plan),'→',L.hm(b.days[5].plan),'| total',L.hm(a.sm.plan),'→',L.hm(b.sm.plan));
 if(b.days[5].plan!==0)fail('off day has study'); if(Math.abs(a.sm.plan-b.sm.plan)>60)fail('total changed a lot');}
// 3. missed blocks Monday → moved later in the week, séries still all placed
{const S=L.defaultState();S.since=0;const now=new Date(2026,10,9,23,30);const r=check(S,now,'missed');
 console.log('lundi rien coché: retard',L.hm(r.meta.lateMin),'rattrapage ajouté',L.hm(r.meta.extended),'séries restantes non placées',r.meta.mustLeftAfter);
 r.days[1].ev.filter(e=>e.kind==='study').forEach(e=>console.log('   mardi',L.fmt(e.start),e.title,'·',e.sub));
 if(r.meta.mustLeftAfter>15)fail('missed not absorbed');}
// 4. check a block done → it stays done, budgets go down
{const S=L.defaultState();S.since=0;const now=new Date(2026,10,9,9,0);let r=check(S,now,'d1');const e=r.days[0].ev.find(x=>x.kind==='study'&&x.state==='todo');
 S.done[L.iso(L.mondayOf(now))]={[e.id]:{s:e.subj,t:e.title,m:e.end-e.start,d:0,a:e.start,serie:e.serie}};
 r=check(S,now,'d2');const e2=r.days[0].ev.find(x=>x.id===e.id);if(!e2||e2.state!=='done')fail('done not kept');else console.log('coché:',e2.title,e2.state);}
// 5. carry from last week
{const S=L.defaultState();S.since=0;S.done['2026-11-02']={x:{s:'ana',m:60,t:'',d:0,a:0}};const r=check(S,new Date(2026,10,9,6,0),'carry');
 console.log('report semaine passée:',JSON.stringify(r.meta.carry));const lates=r.days.flatMap(d=>d.ev).filter(e=>e.late);console.log('   1er bloc en retard:',lates[0]&&lates[0].title,L.DAYS[0]);}
// 6. notifications + agenda
{const S=L.defaultState();S.since=0;S.notif.on=true;const n=L.buildNotifications(S,new Date(2026,10,9,11,0),14);const a=L.buildAgenda(S,new Date(2026,10,9,11,0),3);console.log('notifs',n.length,'agenda',a.length);if(!n.length||!a.length)fail('notif/agenda');}
// 7. migration from v2
{const old={v:2,mode:'charbon',subjects:[{id:'ana',name:'Analyse I',color:'#C2410C',prio:3,exam:''}],routines:[{id:'r',day:5,start:570,end:660,title:'Courses'}],done:{'2026-11-09':{'0-480-study':1}}};
 const S=L.normalize(old);console.log('migration:',S.v,S.wake,S.sleep,S.routines.map(r=>r.kind).join(','),S.subjects[0].serie);check(S,new Date(2026,10,10,12,0),'migr');}
console.log(bad?'FAIL '+bad:'OK');
