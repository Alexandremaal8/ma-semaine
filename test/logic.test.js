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
// 8. trip to Lebanon + modes per week + mock exam
{const S=L.defaultState();S.since=0;S.trips=[{id:'t',title:'Liban',from:'2026-12-20',to:'2027-01-02',light:60}];
 S.subjects[0].exam='2027-01-25';S.mocks=[{id:'m',subj:'alg',date:'2026-11-18',start:615,end:720}];
 const rec=L.recommendMode(S,new Date(2026,10,30));console.log('reco 30 nov:',rec&&rec.mode,'|',rec&&rec.why);
 const rec2=L.recommendMode(S,new Date(2027,0,4));console.log('reco 4 janv:',rec2&&rec2.mode);
 if(!rec||rec.mode!=='avance')fail('reco before trip'); if(!rec2||rec2.mode!=='exam')fail('reco after trip');
 for(const ws of [new Date(2026,11,14),new Date(2026,11,21),new Date(2026,11,28)]){const d=L.generate(S,ws,new Date(2026,11,1));
   console.log('semaine',L.iso(ws),'cours:',d.meta.cfg.coursesOn,'| étude par jour',d.map(x=>L.hm(x.plan)).join(' '));}
 const d20=L.generate(S,new Date(2026,11,14),new Date(2026,11,1))[6]; if(d20.plan)fail('study on departure day');
 S.weekModes['2026-11-16']='charbon';const w=L.generate(S,new Date(2026,10,16),new Date(2026,10,9));console.log('mode semaine 16 nov:',w.meta.cfg.mode,'| mardi 17 avant exam blanc:',w[1].ev.filter(e=>e.kind==='study').map(e=>(L.subjOf(S,e.subj)||{}).name).join(', '));
 const me=w[2].ev.find(e=>e.title.startsWith('Examen blanc'));console.log('mercredi 18:',me&&me.title,L.fmt(me.start));
 S.noCourseWeeks=['2026-11-16'];const nc=L.generate(S,new Date(2026,10,16),new Date(2026,10,9));console.log('semaine sans cours:',nc.meta.cfg.coursesOn,'cours',nc.flatMap(x=>x.ev).filter(e=>e.kind==='course').length,'étude',L.hm(nc.reduce((a,x)=>a+x.plan,0)));}
console.log(bad?'FAIL '+bad:'OK');
// 9. switching chill → charbon on Wednesday keeps Mon/Tue as they were
{const S=L.defaultState();S.since=0;S.mode='chill';const now=new Date(2026,10,11,12,0);const ws=L.mondayOf(now);
 const before=L.generate(S,ws,now);const monBefore=before[0].ev.filter(e=>e.kind==='study').map(e=>L.fmt(e.start)+e.title).join('|');
 L.freezePast(S,now);S.weekModes[L.iso(ws)]='charbon';
 const after=L.generate(S,ws,now);const monAfter=after[0].ev.filter(e=>e.kind==='study').map(e=>L.fmt(e.start)+e.title).join('|');
 if(monBefore!==monAfter)fail('past changed after mode switch');
 console.log('chill→charbon mercredi: lundi identique',monBefore===monAfter,'| jeudi',L.hm(before[3].plan),'→',L.hm(after[3].plan),'| retard',L.hm(after.meta.lateMin),'| séries pas casées',after.meta.mustLeftAfter);
 // then weekend off
 L.freezePast(S,now);S.offDays.push('2026-11-14','2026-11-15');const wo=L.generate(S,ws,now);console.log('week-end off: sam',L.hm(wo[5].plan),'dim',L.hm(wo[6].plan),'| jeudi',L.hm(wo[3].plan),'| séries pas casées',wo.meta.mustLeftAfter);
 let ov=0;for(const x of wo){const b=x.ev.filter(e=>e.end>e.start).sort((a,b)=>a.start-b.start);for(let i=1;i<b.length;i++)if(b[i].start<b[i-1].end){ov++;console.log('  ov',x.d,b[i-1].title,b[i].title)}}if(ov)fail('overlap after freeze');}
// 10. migration v4 → v5 Saturday laundry
{const S=L.normalize({v:4,routines:[{id:'a',day:5,start:690,end:780,title:'Courses',kind:'other'},{id:'b',day:5,start:600,end:645,title:'Sport',kind:'sport'}]});console.log('samedi:',S.routines.filter(r=>r.day===5).map(r=>L.fmt(r.start)+' '+r.title).join(' / '));}
console.log(bad?'FAIL '+bad:'OK');
// 11. mock exam during exercises + Monday physics prep
{const S=L.defaultState();S.since=0;S.mocks=[{id:'m',subj:'alg',date:'2026-11-13',start:495,end:555}];const d=L.generate(S,new Date(2026,10,9),new Date(2026,10,9,6,0));
 d[4].ev.filter(e=>e.start<720&&e.end>480).forEach(e=>console.log('   ven',L.fmt(e.start),L.fmt(e.end),e.kind,e.title,'·',e.sub||''));
 const pr=d[0].ev.find(e=>e.fixed);console.log('lundi prépa physique:',pr&&L.fmt(pr.start)+'-'+L.fmt(pr.end)+' '+pr.title+' · '+pr.sub);if(!pr)fail('no physics prep');
 const v=L.normalize({v:5,subjects:[{id:'phy',name:'Physique (mécanique)'}],routines:[]});console.log('migration v6:',v.routines.filter(r=>r.kind==='study').length);}
console.log(bad?'FAIL '+bad:'OK');
// 12. backlog: placed within the daily budget, séries still all fit; done blocks count as progress
{const S=L.defaultState();S.since=0;S.backlog=[{id:'b1',subj:'ana',title:'Série 6',minutes:180,created:1},{id:'b2',subj:'phy',title:'Cours 7 à relire',minutes:90,created:2}];
 const now=new Date(2026,10,9,6,0),ws=L.mondayOf(now);let d=L.generate(S,ws,now);
 console.log('retard placé',L.hm(d.meta.blPlaced),'sur',L.hm(d.meta.blTotal),'| séries pas casées',d.meta.mustLeftAfter);
 d.forEach(x=>{const b=x.ev.filter(e=>e.bl);if(b.length)console.log('   ',L.DAYS[x.d],b.map(e=>L.fmt(e.start)+'-'+L.fmt(e.end)+' '+e.title).join(' | '))});
 if(d.meta.mustLeftAfter>0)fail('backlog crowded out séries');
 const cap=S.modes[d.meta.cfg.mode].bl;console.log('   mode',d.meta.cfg.mode,'budget/jour',cap);for(const x of d){const b=x.ev.filter(e=>e.bl).reduce((a,e)=>a+e.end-e.start,0);if(b>cap+20)fail('daily backlog budget exceeded',x.d,b)}
 const e=d.flatMap(x=>x.ev).find(e=>e.bl==='b1');S.done[L.iso(ws)]={[e.id]:{s:'ana',t:e.title,m:e.end-e.start,d:0,a:e.start,b:'b1'}};
 const o=L.backlogOpen(S).find(x=>x.id==='b1');console.log('après 1 bloc coché: reste',L.hm(o.left));if(o.left!==180-(e.end-e.start))fail('credit');
 S.mode='normal';S.backlog.push({id:'b3',subj:'alg',title:'Gros retard',minutes:240,created:3});console.log('auto avec gros retard:',L.weekCfg(S,ws).mode,'·',L.weekCfg(S,ws).why);
 const r=L.generate(S,ws,now);console.log('en rattrapage: retard placé',L.hm(r.meta.blPlaced),'sur',L.hm(r.meta.blTotal),'| séries pas casées',r.meta.mustLeftAfter);}
console.log(bad?'FAIL '+bad:'OK');
