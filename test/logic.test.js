const L=require('../site/logic.js');
const now=new Date(2026,10,9,11,40);
let bad=0;
for(const mode of L.MODE_ORDER){
  const S=L.defaultState(); S.mode=mode; S.events=[{id:'e1',date:'2026-11-11',start:1230,end:1320,title:'Concert',place:'Les Docks'}];
  S.deadlines=[{id:'d1',subj:'phy',title:'Série 9 physique',due:'2026-11-13T18:00',hours:2}];
  const ws=L.mondayOf(now); const days=L.generate(S,ws); const sm=L.summarize(S,days,L.iso(ws));
  console.log(mode.padEnd(8),'study',L.hm(sm.plan),'sleep',L.hm(sm.sleepAvg),'short',days.map(d=>d.shortfall).join(','));
  for(const d of days){const b=d.ev.filter(e=>e.end>e.start).sort((a,b)=>a.start-b.start);
    for(let i=1;i<b.length;i++)if(b[i].start<b[i-1].end){bad++;console.log('  OVERLAP',mode,L.DAYS[d.d],L.fmt(b[i-1].start),b[i-1].title,'/',L.fmt(b[i].start),b[i].title)}
    if(new Set(d.ev.map(e=>e.id)).size!==d.ev.length){bad++;console.log('  DUPID',mode,d.d)}}
  if(mode==='normal'){for(const i of [0,2]){console.log(' --',L.DAYS[i]);days[i].ev.forEach(e=>console.log('   ',L.fmt(e.start),L.fmt(e.end),e.kind.padEnd(7),e.title,e.sub?'· '+e.sub:'',e.dueLbl||''))}
    S.notif.on=true; const n=L.buildNotifications(S,now,14); console.log(' notifs',n.length); n.slice(0,8).forEach(x=>console.log('   ',new Date(x.at).toString().slice(0,21),'|',x.title,'|',x.body));}
}
console.log(bad?'FAIL '+bad:'OK');
