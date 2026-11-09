// Random usage: checks, missed blocks, mode switches, days off, events, backlog, mock exams.
// Invariants: no overlapping blocks, no duplicated ids, past never changes after freezePast, séries fit when room allows.
const L=require('../site/logic.js');
let seed=42;const rnd=()=>{seed=(seed*1103515245+12345)%2147483648;return seed/2147483648};
const pick=a=>a[Math.floor(rnd()*a.length)];
let bad=0;const fail=(...a)=>{bad++;if(bad<15)console.log('FAIL',...a)};
for(let run=0;run<120;run++){
  const S=L.defaultState();S.since=new Date(2026,10,9,6,0).getTime();
  const ws=new Date(2026,10,9);
  if(rnd()<.3)S.backlog.push({id:'b'+run,subj:pick(['ana','alg','phy']),title:'Série X',minutes:pick([60,120,240]),created:1});
  if(rnd()<.3)S.mocks.push({id:'m',subj:'alg',date:'2026-11-13',start:495,end:555});
  if(rnd()<.2)S.trips.push({id:'t',title:'Liban',from:'2026-11-14',to:'2026-11-20',light:60});
  let t=new Date(2026,10,9,7,0).getTime();
  for(let step=0;step<14;step++){
    t+=Math.floor(rnd()*14*3600e3);
    const now=new Date(Math.min(t,new Date(2026,10,15,23,0).getTime()));
    let days;try{days=L.generate(S,ws,now)}catch(e){fail('crash',run,step,e.message);break}
    for(const x of days){const b=x.ev.filter(e=>e.end>e.start).sort((a,b)=>a.start-b.start);
      for(let i=1;i<b.length;i++)if(b[i].start<b[i-1].end&&!(b[i].kind==='event'&&b[i-1].kind==='event')){fail('overlap run',run,'step',step,L.DAYS[x.d],L.fmt(b[i-1].start),b[i-1].title,'/',L.fmt(b[i].start),b[i].title);break}
      if(new Set(x.ev.map(e=>e.id)).size!==x.ev.length){const c={};x.ev.forEach(e=>c[e.id]=(c[e.id]||[]).concat([e.kind+':'+e.title+':'+L.fmt(e.start)+':'+(e.state||'')]));fail('dup id',run,step,x.d,JSON.stringify(Object.values(c).filter(v=>v.length>1)))}}
    // check some blocks that are due
    const key=L.iso(ws);S.done[key]=S.done[key]||{};
    for(const x of days)for(const e of x.ev)if(e.kind==='study'&&e.state!=='done'&&x.date.getTime()+e.start*6e4<now.getTime()&&rnd()<.5)
      {const f=pick([1,1,.75,.5,.25]);S.done[key][e.id]={s:e.subj,t:e.title,m:Math.round((e.end-e.start)*f),d:x.d,a:e.start,serie:e.serie,c:e.corr||undefined,fx:!!e.fixed,b:e.bl||undefined,p:f<1?f:undefined};}
    if(rnd()<.1){S.serieDone=S.serieDone||{};(S.serieDone[key]=S.serieDone[key]||{})[pick(['ana','alg','phy','aicc','prog'])]=1;}
    // a change: freeze first, then mutate; the past must not move
    const r=rnd();
    if(r<.5){
      const cur=L.generate(S,ws,now);const past=JSON.stringify(cur.map(x=>x.ev.filter(e=>e.kind==='study'&&!e.fixed&&x.date.getTime()+e.end*6e4<=now.getTime()).map(e=>[e.start,e.title,e.state])));
      L.freezePast(S,now);
      if(r<.15)S.weekModes[key]=pick(L.MODE_ORDER);
      else if(r<.25)S.offDays.push(L.iso(L.addDays(ws,Math.floor(rnd()*7))));
      else if(r<.35)S.events.push({id:'e'+step,date:L.iso(L.addDays(ws,Math.min(6,Math.floor((now-ws)/864e5)+1+Math.floor(rnd()*3)))),start:pick([600,840,1080]),end:pick([660,960,1200]),title:'Ev'});
      else if(r<.45)S.backlog.push({id:'bb'+step,subj:pick(['aicc','prog']),title:'R',minutes:pick([30,90]),created:2});
      else S.noCourseWeeks.push(key);
      const after=L.generate(S,ws,now);
      const past2=JSON.stringify(after.map(x=>x.ev.filter(e=>e.kind==='study'&&!e.fixed&&x.date.getTime()+e.end*6e4<=now.getTime()).map(e=>[e.start,e.title,e.state])));
      if(past!==past2){const A=JSON.parse(past),B=JSON.parse(past2);for(let i=0;i<7;i++)if(JSON.stringify(A[i])!==JSON.stringify(B[i]))fail('past changed run',run,'step',step,'r',r.toFixed(2),L.DAYS[i],JSON.stringify(A[i].filter(x=>!B[i].some(y=>JSON.stringify(y)===JSON.stringify(x)))),'→',JSON.stringify(B[i].filter(x=>!A[i].some(y=>JSON.stringify(y)===JSON.stringify(x)))))}
    }
  }
}
console.log(bad?'FAIL '+bad:'OK');
