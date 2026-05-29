/* Pure utilities — no DOM, no global state. Safe to validate in Node. */

const WD = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const MONTH = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
const MONTH_NOM = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
function dateRu(date,withYear){const[y,m,d]=date.split('-').map(Number);const s=`${d} ${MONTH[m-1]}`;return withYear?`${s} ${y}`:s}
function monthRu(yyyymm){const[y,m]=yyyymm.split('-').map(Number);return`${MONTH_NOM[m-1]} ${y}`}

function today(){return new Date().toISOString().slice(0,10)}

function fmt(n){
  const neg=n<0;n=Math.round(Math.abs(n));
  const s=n.toString().replace(/\B(?=(\d{3})+(?!\d))/g,' ');
  return(neg?'−':'')+s;
}

function fmtCompact(n){
  const abs=Math.abs(n);const neg=n<0?'−':'';
  if(abs>=1e6)return neg+(abs/1e6).toFixed(abs>=1e7?0:1).replace(/\.0$/,'')+'M';
  if(abs>=1e4)return neg+(abs/1e3).toFixed(0)+'K';
  return fmt(n);
}

function esc(s){return(s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}

function wd(d){const[y,m,dd]=d.split('-').map(Number);return(new Date(Date.UTC(y,m-1,dd)).getUTCDay()+6)%7}
function addDays(d,n){const[y,m,dd]=d.split('-').map(Number);return new Date(Date.UTC(y,m-1,dd+n)).toISOString().slice(0,10)}
function dateRange(s,e){const a=[];let c=s,guard=0;while(c<=e&&guard++<20000){a.push(c);c=addDays(c,1)}return a}
function daysInMonth(date){const[y,m]=date.split('-').map(Number);return new Date(Date.UTC(y,m,0)).getUTCDate()}

/* ----- CSV import ----- */
function parseCSV(text){
  const rows=[];let f='',row=[],q=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(q){
      if(c==='"'){if(text[i+1]==='"'){f+='"';i++}else q=false}
      else f+=c;
    }else{
      if(c==='"')q=true;
      else if(c===','){row.push(f);f=''}
      else if(c==='\n'){row.push(f);rows.push(row);row=[];f=''}
      else if(c==='\r'){/* skip */}
      else f+=c;
    }
  }
  if(f.length||row.length){row.push(f);rows.push(row)}
  return rows;
}

function rowsToEntries(rows){
  const h=rows[0].map(x=>x.trim());
  const ix=n=>h.indexOf(n);
  const iD=ix('Start Date'),iT=ix('Start Time'),iP=ix('Project'),iDe=ix('Description'),iDu=ix('Duration (decimal)'),iR=ix('Billable Rate (USD)');
  const out=[];
  for(let r=1;r<rows.length;r++){
    const row=rows[r];
    if(!row||row.length<h.length||!row[iD])continue;
    const p=row[iD].split('/');if(p.length<3)continue;
    const date=p[2]+'-'+p[1]+'-'+p[0];
    const time=(iT>=0&&row[iT])?row[iT]:'00:00:00';
    const hours=parseFloat(row[iDu]);if(!isFinite(hours))continue;
    const rate=iR>=0?(parseFloat(row[iR])||0):0;
    out.push({date,start:date+'T'+time,project:(iP>=0?row[iP]:'')||'',description:(iDe>=0?row[iDe]:'')||'',hours,rate});
  }
  out.sort(byStart);
  return out;
}

function entryKey(e){return [e.start,e.project,Math.round(e.hours*1000)/1000,e.rate,e.description].join('|')}
function byStart(a,b){return a.start<b.start?-1:a.start>b.start?1:0}

function mergeEntries(o,n){
  if(!o||!o.length)return{entries:n.slice().sort(byStart),added:n.length};
  const have=new Set(o.map(entryKey));
  let added=0;const c=o.slice();
  for(const e of n){const k=entryKey(e);if(!have.has(k)){have.add(k);c.push(e);added++}}
  c.sort(byStart);
  return{entries:c,added};
}

function detectRate(es){const nz=es.filter(e=>e.rate>0);return nz.length?nz[nz.length-1].rate:0}

/* ----- aggregation & model ----- */
function dailyAgg(es){
  const m=new Map();
  for(const e of es){const c=m.get(e.date)||{hours:0,amount:0};c.hours+=e.hours;c.amount+=e.hours*e.rate;m.set(e.date,c)}
  return[...m.entries()].map(([date,v])=>({date,...v})).sort((a,b)=>a.date<b.date?-1:1);
}

function monthlyAgg(es){
  const m=new Map();
  for(const e of es){
    const key=e.date.slice(0,7);
    const c=m.get(key)||{hours:0,amount:0,days:new Set()};
    c.hours+=e.hours;c.amount+=e.hours*e.rate;c.days.add(e.date);
    m.set(key,c);
  }
  return[...m.entries()].map(([month,v])=>({month,hours:v.hours,amount:v.amount,days:v.days.size})).sort((a,b)=>a.month<b.month?-1:1);
}

function projectAgg(es,cap){
  const m=new Map();
  for(const e of es){
    const k=e.project||'(без проекта)';
    const c=m.get(k)||{hours:0,amount:0};
    c.hours+=e.hours;c.amount+=e.hours*e.rate;
    m.set(k,c);
  }
  const all=[...m.entries()].map(([project,v])=>({project,...v})).sort((a,b)=>b.amount-a.amount);
  if(!cap||all.length<=cap)return all;
  const top=all.slice(0,cap-1);const rest=all.slice(cap-1);
  const other={project:`Прочие (${rest.length})`,hours:0,amount:0};
  rest.forEach(p=>{other.hours+=p.hours;other.amount+=p.amount});
  return[...top,other];
}

function weekdayModel(es){
  const daily=dailyAgg(es);
  if(!daily.length)return{pWork:Array(7).fill(0),pools:Array.from({length:7},()=>[]),expH:Array(7).fill(0)};
  const all=dateRange(daily[0].date,daily[daily.length-1].date);
  const hb=new Map(daily.map(d=>[d.date,d.hours]));
  const b=Array.from({length:7},()=>({t:0,w:[]}));
  for(const ds of all){const w=wd(ds),hh=hb.get(ds)||0;b[w].t++;if(hh>0)b[w].w.push(hh)}
  const pWork=b.map(x=>x.t?x.w.length/x.t:0);
  const pools=b.map(x=>x.w);
  const expH=b.map((x,i)=>pWork[i]*(x.w.length?x.w.reduce((a,c)=>a+c,0)/x.w.length:0));
  return{pWork,pools,expH};
}

function expandExpenses(exs,s,e){
  const m=new Map();
  const range=dateRange(s,e);
  for(const ds of range)m.set(ds,0);
  for(const x of exs){
    if(x.kind==='monthly'){
      for(const ds of range)if(Number(ds.slice(8,10))===Number(x.day))m.set(ds,m.get(ds)+Number(x.amount));
    }else if(x.kind==='daily'){
      const amt=Number(x.amount);
      for(const ds of range)m.set(ds,m.get(ds)+amt/daysInMonth(ds));
    }else{
      if(x.date>=s&&x.date<=e)m.set(x.date,(m.get(x.date)||0)+Number(x.amount));
    }
  }
  return m;
}

/* ----- pay-day helpers ----- */
function pad2(n){return String(n).padStart(2,'0')}

function lastPayDayBefore(date,payDays){
  if(!payDays||!payDays.length)return null;
  const sorted=[...payDays].map(Number).sort((a,b)=>a-b);
  const[y,m,d]=date.split('-').map(Number);
  for(let i=sorted.length-1;i>=0;i--){
    if(sorted[i]<=d)return`${y}-${pad2(m)}-${pad2(sorted[i])}`;
  }
  const prevM=m===1?12:m-1, prevY=m===1?y-1:y;
  return`${prevY}-${pad2(prevM)}-${pad2(sorted[sorted.length-1])}`;
}

function initialUnpaidWork(es,anchorDate,payDays){
  if(!payDays||!payDays.length)return 0;
  const since=addDays(lastPayDayBefore(anchorDate,payDays),1);
  let sum=0;
  for(const e of es){if(e.date>=since&&e.date<=anchorDate)sum+=e.hours*e.rate}
  return sum;
}

/* ----- forecast ----- */
function mulberry32(a){
  return function(){
    a|=0;a=a+0x6D2B79F5|0;
    let t=Math.imul(a^a>>>15,1|a);
    t=t+Math.imul(t^t>>>7,61|t)^t;
    return((t^t>>>14)>>>0)/4294967296;
  };
}

function forecastSavings(es,rate,exs,incs,cps,payDays,end,nSims,seed){
  nSims=nSims||4000;seed=seed||1;
  if(!cps||!cps.length)throw new Error('Добавь хотя бы один чекпоинт баланса.');
  const past=cps.filter(c=>c.date<=today());
  const anchor=past.length?past.reduce((a,b)=>a.date>b.date?a:b):cps.reduce((a,b)=>a.date<b.date?a:b);
  const balance=anchor.balance,balanceDate=anchor.date;
  const{pWork,pools,expH}=weekdayModel(es);
  const start=addDays(balanceDate,1);
  if(end<start)throw new Error('Дата конца должна быть позже стартового чекпоинта.');
  const days=dateRange(start,end);
  const expMap=expandExpenses(exs,start,end);
  const incMap=new Map();
  for(const inc of incs||[])if(inc.date>=start&&inc.date<=end)incMap.set(inc.date,(incMap.get(inc.date)||0)+Number(inc.amount));
  const useDelayed=!!(payDays&&payDays.length);
  const paySet=new Set((payDays||[]).map(Number));
  const isPay=ds=>paySet.has(Number(ds.slice(8,10)));
  const init=useDelayed?initialUnpaidWork(es,balanceDate,payDays):0;
  const rand=mulberry32(seed);
  const run=new Float64Array(nSims).fill(balance);
  const unpaid=new Float64Array(nSims).fill(init);
  const mean=[],p10=[],p90=[];const payDayDates=[];
  const expectedWork=[],expectedExp=[],expectedInc=[];
  let mr=balance, mrUnpaid=init;
  let nextSalary=null;
  for(let di=0;di<days.length;di++){
    const ds=days[di],w=wd(ds),pool=pools[w],out=expMap.get(ds)||0,inEv=incMap.get(ds)||0;
    const payToday=useDelayed&&isPay(ds);
    if(payToday)payDayDates.push(ds);
    expectedWork.push(expH[w]*rate);
    expectedExp.push(out);
    expectedInc.push(inEv);
    const captureNext=payToday&&!nextSalary;
    const todayBonuses=captureNext?new Float64Array(nSims):null;
    for(let s=0;s<nSims;s++){
      let work=0;
      if(rand()<pWork[w]&&pool.length)work=pool[(rand()*pool.length)|0]*rate;
      if(useDelayed){
        unpaid[s]+=work;
        const bonus=payToday?unpaid[s]:0;
        if(captureNext)todayBonuses[s]=bonus;
        if(payToday)unpaid[s]=0;
        run[s]+=bonus+inEv-out;
      }else{
        run[s]+=work+inEv-out;
      }
    }
    if(useDelayed){
      mrUnpaid+=expH[w]*rate;
      const bonus=payToday?mrUnpaid:0;
      if(captureNext){
        const sb=Float64Array.from(todayBonuses).sort();
        nextSalary={
          date:ds,mean:bonus,
          median:sb[Math.floor(.5*nSims)],
          p10:sb[Math.floor(.1*nSims)],
          p90:sb[Math.floor(.9*nSims)],
          min:sb[0],max:sb[nSims-1]
        };
      }
      if(payToday)mrUnpaid=0;
      mr+=bonus+inEv-out;
    }else{
      mr+=expH[w]*rate+inEv-out;
    }
    mean.push(mr);
    const sd=Float64Array.from(run).sort();
    p10.push(sd[Math.floor(.1*nSims)]);p90.push(sd[Math.floor(.9*nSims)]);
  }
  const cpMap=new Map(cps.filter(c=>c.date>balanceDate&&c.date<=end).map(c=>[c.date,c.balance]));
  let shift=0;
  for(let i=0;i<days.length;i++){
    if(cpMap.has(days[i])){shift+=cpMap.get(days[i])-(mean[i]+shift)}
    mean[i]+=shift;p10[i]+=shift;p90[i]+=shift;
  }
  for(let s=0;s<nSims;s++)run[s]+=shift;
  const sf=Float64Array.from(run).sort();
  let te=0;for(const v of expMap.values())te+=v;
  let ti=0;for(const v of incMap.values())ti+=v;
  const unpaidMean=useDelayed?unpaid.reduce((a,c)=>a+c,0)/nSims:0;
  const totalExpectedWork=expectedWork.reduce((a,b)=>a+b,0);
  let minR=run[0],maxR=run[0],sumR=0,negCount=0;
  for(let i=0;i<nSims;i++){const v=run[i];if(v<minR)minR=v;if(v>maxR)maxR=v;sumR+=v;if(v<0)negCount++}
  const meanR=sumR/nSims;
  let varSum=0;for(let i=0;i<nSims;i++){const d=run[i]-meanR;varSum+=d*d}
  const stdR=Math.sqrt(varSum/nSims);
  const medianR=sf[Math.floor(.5*nSims)];
  const spikeSet=new Set();
  for(const x of exs){
    if(x.kind==='monthly'){for(const ds of days)if(Number(ds.slice(8,10))===Number(x.day))spikeSet.add(ds)}
    else if(x.kind==='once'){if(x.date>=start&&x.date<=end)spikeSet.add(x.date)}
  }
  const avgH=pools.map(p=>p.length?p.reduce((s,v)=>s+v,0)/p.length:0);
  const sampleSizes=pools.map(p=>p.length);
  return{
    days,mean,p10,p90,startBalance:balance,startDate:balanceDate,rate,
    expDays:[...spikeSet],
    incomeDays:[...incMap.keys()],checkpointDays:[...cpMap.keys()],payDayDates,
    finalMean:meanR,finalMedian:medianR,finalStd:stdR,
    finalP10:sf[Math.floor(.1*nSims)],finalP90:sf[Math.floor(.9*nSims)],
    finalMin:minR,finalMax:maxR,negativeProb:negCount/nSims,
    totalExpenses:te,totalIncomes:ti,totalExpectedWork,calibrationShift:shift,
    unpaidAtEnd:unpaidMean,initialUnpaid:init,
    nextSalary,
    model:{pWork:[...pWork],avgH,expH:[...expH],sampleSizes},
    perDay:{work:expectedWork,exp:expectedExp,inc:expectedInc},
    finalRuns:[...run]
  };
}
