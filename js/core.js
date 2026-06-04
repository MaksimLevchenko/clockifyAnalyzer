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
  if(text.charCodeAt(0)===0xFEFF)text=text.slice(1);
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

/* Identity of a "logical record" ignoring time-of-day. When the user
   redistributes hours onto old dates in Clockify the day stays the same but
   the start time (and sometimes the duration) shifts — so two entries are the
   same record if date/project/description/rate match. */
function entryGroupKey(e){return [e.date,e.project,e.rate,e.description].join('|')}
function startSecs(s){const t=(String(s).split('T')[1]||'00:00:00').split(':').map(Number);return(t[0]||0)*3600+(t[1]||0)*60+(t[2]||0)}
const MERGE_HOURS_TOLERANCE=2.5;

/* Догрузка: помимо пропуска точных дублей, распознаёт записи, у которых из-за
   перераспределения сместилось время суток (и, в пределах ±2.5 ч, длительность),
   и заменяет ими старые версии. Сопоставление пер-запись, 1-к-1, в рамках одной
   группы entryGroupKey. Несопоставленные локальные записи не удаляются;
   попавшие в диапазон дат экспорта считаются в `missing` для предупреждения. */
function mergeEntries(o,n){
  if(!o||!o.length)return{entries:(n||[]).slice().sort(byStart),added:(n||[]).length,replaced:0,missing:0};
  if(!n||!n.length)return{entries:o.slice().sort(byStart),added:0,replaced:0,missing:0};
  let lo=n[0].date,hi=n[0].date;
  for(const e of n){if(e.date<lo)lo=e.date;if(e.date>hi)hi=e.date}
  const gOld=new Map(),gNew=new Map();
  const group=(m,e)=>{const k=entryGroupKey(e);let a=m.get(k);if(!a){a=[];m.set(k,a)}a.push(e)};
  for(const e of o)group(gOld,e);
  for(const e of n)group(gNew,e);
  const result=[],seen=new Set();
  let added=0,replaced=0,missing=0;
  const keep=e=>{result.push(e);seen.add(entryKey(e))};
  for(const k of new Set([...gOld.keys(),...gNew.keys()])){
    const OLD=gOld.get(k)||[],NEW=gNew.get(k)||[];
    const oUsed=OLD.map(()=>false),nUsed=NEW.map(()=>false);
    /* 1) точные дубли (полный ключ, включая время) — оставляем имеющуюся копию */
    for(let j=0;j<NEW.length;j++){
      const kj=entryKey(NEW[j]);
      for(let i=0;i<OLD.length;i++)if(!oUsed[i]&&entryKey(OLD[i])===kj){oUsed[i]=true;nUsed[j]=true;keep(OLD[i]);break}
    }
    /* 2) остаток сопоставляем 1-к-1: ближайшая длительность (≤ допуск), затем
       ближайшее время начала, затем стабильный порядок */
    const cands=[];
    for(let i=0;i<OLD.length;i++){if(oUsed[i])continue;
      for(let j=0;j<NEW.length;j++){if(nUsed[j])continue;
        const dh=Math.abs(OLD[i].hours-NEW[j].hours);
        if(dh<=MERGE_HOURS_TOLERANCE+1e-9)cands.push({i,j,dh,dt:Math.abs(startSecs(OLD[i].start)-startSecs(NEW[j].start))});
      }
    }
    cands.sort((a,b)=>a.dh-b.dh||a.dt-b.dt||a.i-b.i||a.j-b.j);
    for(const c of cands){if(oUsed[c.i]||nUsed[c.j])continue;oUsed[c.i]=true;nUsed[c.j]=true;keep(NEW[c.j]);replaced++}
    /* 3) несопоставленные новые — добавляем (без точного дубля) */
    for(let j=0;j<NEW.length;j++)if(!nUsed[j]){if(seen.has(entryKey(NEW[j])))continue;keep(NEW[j]);added++}
    /* 4) несопоставленные старые — оставляем; попавшие в диапазон экспорта считаем */
    for(let i=0;i<OLD.length;i++)if(!oUsed[i]){keep(OLD[i]);if(OLD[i].date>=lo&&OLD[i].date<=hi)missing++}
  }
  result.sort(byStart);
  return{entries:result,added,replaced,missing};
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

const DEFAULT_HALF_LIFE_DAYS = 60;
const MIN_WEEKS_FOR_BOOTSTRAP = 8;

function daysBetween(a,b){
  const ad=new Date(a+'T00:00:00Z').getTime();
  const bd=new Date(b+'T00:00:00Z').getTime();
  return Math.round((bd-ad)/86400000);
}

function inDateRange(date,from,to){return date>=from&&date<=to}
function isVacationDay(ds,vacations){
  if(!vacations||!vacations.length)return false;
  for(const v of vacations)if(inDateRange(ds,v.from,v.to))return true;
  return false;
}

function weekdayModel(es,opts){
  /* Recency-weighted: weight of a day = 2^(-days_ago / halfLife).
     Caller MUST pass opts.refDate explicitly — keeping this function pure
     (no implicit today() call). Vacation days are excluded from the
     denominator AND from pools. */
  opts=opts||{};
  const halfLife=opts.halfLife||DEFAULT_HALF_LIFE_DAYS;
  if(!opts.refDate)throw new Error('weekdayModel: refDate is required');
  const refDate=opts.refDate;
  const vacations=opts.vacations||[];
  const lambda=Math.log(2)/Math.max(1,halfLife);
  const daily=dailyAgg(es);
  if(!daily.length){
    return{pWork:Array(7).fill(0),pools:Array.from({length:7},()=>[]),
      poolWeights:Array.from({length:7},()=>[]),expH:Array(7).fill(0),
      avgH:Array(7).fill(0),sampleSizes:Array(7).fill(0)};
  }
  const all=dateRange(daily[0].date,daily[daily.length-1].date);
  const hb=new Map(daily.map(d=>[d.date,d.hours]));
  const wWork=Array(7).fill(0),wTotal=Array(7).fill(0);
  const pools=Array.from({length:7},()=>[]);
  const poolWeights=Array.from({length:7},()=>[]);
  for(const ds of all){
    if(isVacationDay(ds,vacations))continue;
    const w=wd(ds),hh=hb.get(ds)||0;
    const daysAgo=Math.max(0,daysBetween(ds,refDate));
    const weight=Math.exp(-lambda*daysAgo);
    wTotal[w]+=weight;
    if(hh>0){wWork[w]+=weight;pools[w].push(hh);poolWeights[w].push(weight)}
  }
  const pWork=wTotal.map((t,i)=>t>0?wWork[i]/t:0);
  const avgH=pools.map((p,i)=>{
    if(!p.length)return 0;
    let num=0,den=0;
    for(let j=0;j<p.length;j++){num+=p[j]*poolWeights[i][j];den+=poolWeights[i][j]}
    return den>0?num/den:0;
  });
  const expH=pWork.map((p,i)=>p*avgH[i]);
  const sampleSizes=pools.map(p=>p.length);
  return{pWork,pools,poolWeights,expH,avgH,sampleSizes};
}

function historicalWeeks(es,refDate,halfLife,vacations){
  /* Only weeks FULLY inside [first_work_day, last_work_day] are kept —
     fixes the "fake zeros" bias at partial boundary weeks. Weeks that
     contain ANY vacation day are DROPPED ENTIRELY — otherwise the
     bootstrap would resample a "vacation week" as if it were a normal
     work-pattern. refDate is required (purity). */
  if(!es.length)return[];
  if(!refDate)throw new Error('historicalWeeks: refDate is required');
  halfLife=halfLife||DEFAULT_HALF_LIFE_DAYS;
  vacations=vacations||[];
  const lambda=Math.log(2)/Math.max(1,halfLife);
  const hb=new Map();
  for(const e of es)hb.set(e.date,(hb.get(e.date)||0)+e.hours);
  const first=es[0].date,last=es[es.length-1].date;
  const firstMonday=addDays(first,-wd(first));
  const dataFirstMonday=wd(first)===0?first:addDays(firstMonday,7);
  const lastFullSunday=wd(last)===6?last:addDays(addDays(last,-wd(last)),-1);
  if(dataFirstMonday>lastFullSunday)return[];
  const all=dateRange(dataFirstMonday,lastFullSunday);
  const weeks=new Map();
  for(const ds of all){
    const w=wd(ds);
    const weekStart=addDays(ds,-w);
    if(!weeks.has(weekStart))weeks.set(weekStart,{hours:[0,0,0,0,0,0,0],hasVac:false});
    const wk=weeks.get(weekStart);
    if(isVacationDay(ds,vacations)){wk.hasVac=true;continue}
    wk.hours[w]=hb.get(ds)||0;
  }
  const result=[];
  let droppedCount=0;
  for(const[weekStart,wk]of weeks){
    if(wk.hasVac){droppedCount++;continue}
    const dom=Number(weekStart.slice(8,10));
    const weekOfMonth=Math.min(5,Math.floor((dom-1)/7)+1);
    const midDaysAgo=Math.max(0,daysBetween(addDays(weekStart,3),refDate));
    const weight=Math.exp(-lambda*midDaysAgo);
    result.push({weekStart,hours:wk.hours,weekOfMonth,weight});
  }
  result.sort((a,b)=>a.weekStart<b.weekStart?-1:1);
  result.droppedCount=droppedCount;
  return result;
}

function makeWeightedSampler(indices,weights){
  if(!indices.length)return null;
  const cum=new Float64Array(indices.length);
  let s=0;
  for(let i=0;i<indices.length;i++){const w=Math.max(0,weights[i]||0);s+=w;cum[i]=s}
  if(s<=0)return{sample:rand=>indices[Math.min(indices.length-1,(rand()*indices.length)|0)]};
  return{
    sample:rand=>{
      const r=rand()*s;
      let lo=0,hi=cum.length-1;
      while(lo<hi){const m=(lo+hi)>>1;if(cum[m]<r)lo=m+1;else hi=m}
      return indices[lo];
    }
  };
}

function expandExpenses(exs,s,e,opts){
  /* opts.baseDate — if set, recurring (monthly/daily) expense amounts are
     scaled by (1+growthRate/100)^years between baseDate and each spend
     date. Used in forecast to model inflation/indexation, and in cashflow
     to recover the historical equivalent of today's entered values.
     ONCE expenses are NOT scaled — they represent a concrete known
     amount on a known date. */
  opts=opts||{};
  const baseDate=opts.baseDate;
  const m=new Map();
  const range=dateRange(s,e);
  for(const ds of range)m.set(ds,0);
  for(const x of exs){
    const isRecurring=x.kind==='monthly'||x.kind==='daily';
    const g=isRecurring&&x.growthRate?Number(x.growthRate)/100:0;
    const baseAmt=Number(x.amount);
    const f=ds=>{
      if(!g||!baseDate)return 1;
      const yr=daysBetween(baseDate,ds)/365.25;
      return Math.pow(1+g,yr);
    };
    if(x.kind==='monthly'){
      for(const ds of range)if(Number(ds.slice(8,10))===Number(x.day))m.set(ds,m.get(ds)+baseAmt*f(ds));
    }else if(x.kind==='daily'){
      for(const ds of range)m.set(ds,m.get(ds)+baseAmt*f(ds)/daysInMonth(ds));
    }else{
      if(x.date>=s&&x.date<=e)m.set(x.date,(m.get(x.date)||0)+baseAmt);
    }
  }
  return m;
}

/* ----- pay-day helpers ----- */
function pad2(n){return String(n).padStart(2,'0')}

const PAYDAY_MATCH_WINDOW=7;

/* Effective payday dates (YYYY-MM-DD) within [start,end]. The monthly
   schedule (payDays = month-days) is projected onto concrete dates; each
   recorded actual date replaces the nearest scheduled occurrence within
   PAYDAY_MATCH_WINDOW days, so a salary that arrived a couple days early/late
   relocates that period's boundary instead of adding a second payday. Actuals
   with no nearby scheduled occurrence — or when no schedule is set — act as
   standalone paydays. */
function effectivePayDays(start,end,payDays,actuals){
  const days=[...new Set((payDays||[]).map(Number).filter(d=>Number.isFinite(d)))].sort((a,b)=>a-b);
  const acts=[...new Set((actuals||[]).filter(Boolean))].sort();
  const sched=[];
  if(days.length){
    /* project one extra month on each side so an actual near a window edge can
       still claim its scheduled occurrence. */
    const pStart=addDays(start,-40),pEnd=addDays(end,40);
    let[y,m]=pStart.split('-').map(Number);
    const[ey,em]=pEnd.split('-').map(Number);
    while(y<ey||(y===ey&&m<=em)){
      for(const d of days){
        const ds=`${y}-${pad2(m)}-${pad2(d)}`;
        if(ds>=pStart&&ds<=pEnd)sched.push({date:ds,eff:ds});
      }
      m++;if(m>12){m=1;y++;}
    }
    sched.sort((a,b)=>a.date<b.date?-1:1);
  }
  const claimed=new Array(sched.length).fill(false);
  const standalone=[];
  for(const a of acts){
    let best=-1,bestDist=Infinity;
    for(let i=0;i<sched.length;i++){
      if(claimed[i])continue;
      const dist=Math.abs(daysBetween(sched[i].date,a));
      if(dist<bestDist){bestDist=dist;best=i;}
    }
    if(best>=0&&bestDist<=PAYDAY_MATCH_WINDOW){claimed[best]=true;sched[best].eff=a;}
    else standalone.push(a);
  }
  const eff=sched.map(s=>s.eff).concat(standalone).filter(ds=>ds>=start&&ds<=end);
  return[...new Set(eff)].sort();
}

function lastPayDayBefore(date,payDays,actuals){
  if((!payDays||!payDays.length)&&(!actuals||!actuals.length))return null;
  const eff=effectivePayDays(addDays(date,-80),date,payDays,actuals);
  return eff.length?eff[eff.length-1]:null;
}

function initialUnpaidWork(es,anchorDate,payDays,actuals,fallbackRate){
  const boundary=lastPayDayBefore(anchorDate,payDays,actuals);
  if(!boundary)return{money:0,hours:0};
  const since=addDays(boundary,1);
  const fb=Number(fallbackRate)||0;
  let money=0,hours=0;
  for(const e of es){
    if(e.date>=since&&e.date<=anchorDate){
      const r=e.rate>0?e.rate:fb;money+=e.hours*r;hours+=e.hours;
    }
  }
  return{money,hours};
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

function forecastSavings(es,rate,exs,incs,cps,payDays,end,nSims,seed,opts){
  nSims=nSims||4000;seed=seed||1;opts=opts||{};
  if(!cps||!cps.length)throw new Error('Добавь хотя бы один чекпоинт баланса.');
  const halfLife=opts.halfLife||DEFAULT_HALF_LIFE_DAYS;
  const taxRate=Math.max(0,Math.min(1,(opts.taxRate||0)/100));
  const vacations=opts.vacations||[];
  const autoRates=opts.autoMonthlyRates||null;
  const autoDurations=opts.autoMonthlyDurations||null;
  const ref=opts.referenceDate||today();
  const actualCps=cps.filter(c=>(c.kind||'actual')==='actual');
  const targetCps=cps.filter(c=>c.kind==='target');
  if(!actualCps.length)throw new Error('Нужен хотя бы один фактический чекпоинт.');
  const past=actualCps.filter(c=>c.date<=ref);
  let anchor;
  if(opts.anchorDate){
    anchor=actualCps.find(c=>c.date===opts.anchorDate)||
      (past.length?past.reduce((a,b)=>a.date>b.date?a:b):actualCps.reduce((a,b)=>a.date<b.date?a:b));
  }else{
    anchor=past.length?past.reduce((a,b)=>a.date>b.date?a:b):actualCps.reduce((a,b)=>a.date<b.date?a:b);
  }
  const balance=anchor.balance,balanceDate=anchor.date;
  const wm=weekdayModel(es,{halfLife,refDate:ref,vacations});
  const start=addDays(balanceDate,1);
  if(end<start)throw new Error('Дата конца должна быть позже стартового чекпоинта.');
  const days=dateRange(start,end);
  const expMap=expandExpenses(exs,start,end,{baseDate:ref});
  const incMap=new Map();
  for(const inc of incs||[])if(inc.date>=start&&inc.date<=end)incMap.set(inc.date,(incMap.get(inc.date)||0)+Number(inc.amount));
  const useDelayed=!!(payDays&&payDays.length);
  const paySet=new Set((payDays||[]).map(Number));
  const isPay=ds=>paySet.has(Number(ds.slice(8,10)));
  /* Initial unpaid pool is also net-of-tax — the user's checkpoint balance
     is post-tax, and pending salary will also arrive post-tax. */
  const initPool=useDelayed?initialUnpaidWork(es,balanceDate,payDays,opts.payDayActuals,rate):{money:0,hours:0};
  const init=initPool.money*(1-taxRate);
  const initHours=initPool.hours;
  const rand=mulberry32(seed);

  /* ----- week-block bootstrap setup -----
     - Each forecast week picks a historical FULL week (Mon..Sun) as a block.
     - WoM (week-of-month) is taken from the Monday of the week, so partial
       first weeks of the forecast align with the right historical bucket.
     - Picks are weighted by recency (same halfLife as weekdayModel).
     - If history has fewer than MIN_WEEKS_FOR_BOOTSTRAP full weeks, fall back
       to weighted per-day sampling. */
  const histWeeks=historicalWeeks(es,ref,halfLife,vacations);
  const allWeekIdx=histWeeks.map((_,i)=>i);
  const allWeekW=histWeeks.map(w=>w.weight);
  const samplerAll=histWeeks.length>=MIN_WEEKS_FOR_BOOTSTRAP?makeWeightedSampler(allWeekIdx,allWeekW):null;
  const samplerByWom=new Map();
  if(samplerAll){
    const wkByWom=new Map();
    for(let i=0;i<histWeeks.length;i++){
      const k=histWeeks[i].weekOfMonth;
      if(!wkByWom.has(k))wkByWom.set(k,{idx:[],w:[]});
      const b=wkByWom.get(k);b.idx.push(i);b.w.push(histWeeks[i].weight);
    }
    for(const[k,b]of wkByWom){
      /* WoM matching only triggers with ≥3 historical weeks in the bucket —
         with 2 the choice is essentially deterministic and adds noise. */
      if(b.idx.length>=3)samplerByWom.set(k,makeWeightedSampler(b.idx,b.w));
    }
  }
  const poolSamplers=wm.pools.map((p,i)=>p.length?makeWeightedSampler(p.map((_,j)=>j),wm.poolWeights[i]):null);
  const fcWeeks=[];
  let cur=0;
  while(cur<days.length){
    const ds=days[cur],dow=wd(ds);
    const len=Math.min(7-dow,days.length-cur);
    const monday=addDays(ds,-dow);
    const dom=Number(monday.slice(8,10));
    const wom=Math.min(5,Math.floor((dom-1)/7)+1);
    fcWeeks.push({startIdx:cur,length:len,wom});
    cur+=len;
  }
  const dayToFcWeek=new Int32Array(days.length);
  for(let wi=0;wi<fcWeeks.length;wi++)
    for(let d=0;d<fcWeeks[wi].length;d++)
      dayToFcWeek[fcWeeks[wi].startIdx+d]=wi;
  const useWeekBoot=samplerAll!==null;
  const pickW=useWeekBoot?new Int32Array(nSims*fcWeeks.length):null;
  if(useWeekBoot){
    for(let s=0;s<nSims;s++){
      for(let wi=0;wi<fcWeeks.length;wi++){
        const sampler=samplerByWom.get(fcWeeks[wi].wom)||samplerAll;
        pickW[s*fcWeeks.length+wi]=sampler.sample(rand);
      }
    }
  }

  /* Per-sim auto-expense rate sampled from historical interval rates,
     weighted by interval duration so a 60-day interval counts ~20x more
     than a 3-day one. */
  const autoRateBySim=autoRates&&autoRates.length
    ?new Float64Array(nSims)
    :null;
  let autoMeanRate=0;
  if(autoRateBySim){
    const durs=autoDurations&&autoDurations.length===autoRates.length
      ?autoDurations:autoRates.map(()=>1);
    const totDur=durs.reduce((a,b)=>a+b,0)||1;
    const autoSampler=makeWeightedSampler(autoRates.map((_,i)=>i),durs);
    for(let s=0;s<nSims;s++)autoRateBySim[s]=autoRates[autoSampler.sample(rand)];
    autoMeanRate=autoRates.reduce((sum,r,i)=>sum+r*durs[i],0)/totDur;
  }

  const run=new Float64Array(nSims).fill(balance);
  const minRun=new Float64Array(nSims).fill(balance);
  const unpaid=new Float64Array(nSims).fill(init);
  const mean=[],p10=[],p90=[];const payDayDates=[];
  const expectedWork=[],expectedExp=[],expectedInc=[];
  const vacationDays=[];
  let nextSalary=null;
  let cumGrossExpH=0;
  /* Snapshots of per-sim run[] at each TARGET checkpoint date — used
     to compute P(reaching) for that target after calibration. */
  const targetDateSet=new Set(targetCps.filter(c=>c.date>balanceDate&&c.date<=end).map(c=>c.date));
  const targetSnaps=new Map();
  for(let di=0;di<days.length;di++){
    const ds=days[di],w=wd(ds),inEv=incMap.get(ds)||0;
    let out=expMap.get(ds)||0;
    const isVac=isVacationDay(ds,vacations);
    if(isVac)vacationDays.push(ds);
    const payToday=useDelayed&&isPay(ds);
    if(payToday)payDayDates.push(ds);
    const grossExpH=isVac?0:wm.expH[w];
    cumGrossExpH+=grossExpH;
    expectedWork.push(grossExpH*rate*(1-taxRate));
    /* Auto-expense is normalized per CALENDAR month, matching the
       `daily` expense kind: amount/daysInMonth(ds) so monthly total
       stays constant across Feb (28) and Jan (31). */
    const dim=daysInMonth(ds);
    const expectedAutoOut=autoMeanRate/dim;
    expectedExp.push(out+expectedAutoOut);
    expectedInc.push(inEv);
    const captureNext=payToday&&!nextSalary;
    const todayBonuses=captureNext?new Float64Array(nSims):null;
    const fcWi=dayToFcWeek[di];
    let runSum=0;
    for(let s=0;s<nSims;s++){
      let hours=0;
      if(!isVac){
        if(useWeekBoot){
          hours=histWeeks[pickW[s*fcWeeks.length+fcWi]].hours[w];
        }else if(poolSamplers[w]&&rand()<wm.pWork[w]){
          hours=wm.pools[w][poolSamplers[w].sample(rand)];
        }
      }
      const work=hours*rate*(1-taxRate);
      const autoOut=autoRateBySim?autoRateBySim[s]/dim:0;
      if(useDelayed){
        unpaid[s]+=work;
        const bonus=payToday?unpaid[s]:0;
        if(captureNext)todayBonuses[s]=bonus;
        if(payToday)unpaid[s]=0;
        run[s]+=bonus+inEv-out-autoOut;
      }else{
        run[s]+=work+inEv-out-autoOut;
      }
      if(run[s]<minRun[s])minRun[s]=run[s];
      runSum+=run[s];
    }
    if(useDelayed&&captureNext){
      const sb=Float64Array.from(todayBonuses).sort();
      nextSalary={
        date:ds,mean:sb.reduce((a,b)=>a+b,0)/nSims,
        median:sb[Math.floor(.5*nSims)],
        p10:sb[Math.floor(.1*nSims)],
        p90:sb[Math.floor(.9*nSims)],
        min:sb[0],max:sb[nSims-1],
        expHours:initHours+cumGrossExpH
      };
    }
    /* Mean track is the EMPIRICAL mean of the simulation runs (was
       previously an analytical track that drifted from sim mean due to
       per-day vs per-week weighting in the bootstrap). */
    mean.push(runSum/nSims);
    const sd=Float64Array.from(run).sort();
    p10.push(sd[Math.floor(.1*nSims)]);p90.push(sd[Math.floor(.9*nSims)]);
    if(targetDateSet.has(ds))targetSnaps.set(ds,{di,snap:Float64Array.from(run)});
  }
  /* Calibration uses ONLY actual checkpoints. Two design choices:
     1) Shift is LINEARLY INTERPOLATED between consecutive actual cps
        (virtual anchor at di=-1, sh=0 represents the start balance).
        Step-shift caused the trajectory to look "ignorant" between cps
        and jump at the cp itself — interpolation gradually nudges it
        toward the next known balance.
     2) extraWidth is the QUADRATIC sum of per-calibration residuals
        (independent-error addition) — 3 small misses don't pile up
        the same way as one big miss. Widening is per-sim Gaussian noise. */
  const cpMap=new Map(actualCps.filter(c=>c.date>balanceDate&&c.date<=end).map(c=>[c.date,c.balance]));
  const CALIB_WIDEN_K=0.4;
  const anchors=[{di:-1,sh:0}];
  let extraWidthSq=0;
  for(let i=0;i<days.length;i++){
    if(cpMap.has(days[i])){
      const reqShift=cpMap.get(days[i])-mean[i];
      const dCal=reqShift-anchors[anchors.length-1].sh;
      extraWidthSq+=(dCal*CALIB_WIDEN_K)*(dCal*CALIB_WIDEN_K);
      anchors.push({di:i,sh:reqShift});
    }
  }
  const shiftHistory=new Float64Array(days.length);
  {
    let segIdx=0;
    for(let i=0;i<days.length;i++){
      while(segIdx+1<anchors.length&&i>anchors[segIdx+1].di)segIdx++;
      const a=anchors[segIdx];
      const b=segIdx+1<anchors.length?anchors[segIdx+1]:null;
      const sh=b?a.sh+(b.sh-a.sh)*(i-a.di)/(b.di-a.di):a.sh;
      shiftHistory[i]=sh;
      mean[i]+=sh;
    }
  }
  const finalShift=days.length?shiftHistory[days.length-1]:0;
  const extraWidth=Math.sqrt(extraWidthSq);
  const shiftExtra=new Float64Array(nSims);
  if(extraWidth>0){
    for(let s=0;s<nSims;s++){
      let u=0,v=0;while(u===0)u=rand();while(v===0)v=rand();
      shiftExtra[s]=Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)*extraWidth;
    }
  }
  for(let s=0;s<nSims;s++){
    run[s]+=finalShift+shiftExtra[s];
    minRun[s]+=finalShift+shiftExtra[s];
  }
  for(let i=0;i<days.length;i++){
    p10[i]+=shiftHistory[i]-extraWidth;
    p90[i]+=shiftHistory[i]+extraWidth;
  }
  /* Compute P(target reached) at each target date using snapshots,
     applying the per-day shift and per-sim widening noise. */
  const targetReachProb=[];
  for(const t of targetCps.filter(c=>c.date>balanceDate&&c.date<=end)){
    const item=targetSnaps.get(t.date);if(!item)continue;
    const sh=shiftHistory[item.di];
    let count=0;
    for(let s=0;s<nSims;s++){
      const val=item.snap[s]+sh+shiftExtra[s];
      if(val>=t.balance)count++;
    }
    targetReachProb.push({date:t.date,balance:t.balance,prob:count/nSims});
  }
  const sf=Float64Array.from(run).sort();
  let te=0;for(const v of expMap.values())te+=v;
  let autoTotal=0;
  if(autoMeanRate)for(const ds of days)autoTotal+=autoMeanRate/daysInMonth(ds);
  te+=autoTotal;
  let ti=0;for(const v of incMap.values())ti+=v;
  const unpaidMean=useDelayed?unpaid.reduce((a,c)=>a+c,0)/nSims:0;
  const totalExpectedWork=expectedWork.reduce((a,b)=>a+b,0);
  let minR=run[0],maxR=run[0],sumR=0,negCount=0,midNegCount=0;
  for(let i=0;i<nSims;i++){
    const v=run[i];if(v<minR)minR=v;if(v>maxR)maxR=v;sumR+=v;
    if(v<0)negCount++;if(minRun[i]<0)midNegCount++;
  }
  const meanR=sumR/nSims;
  let varSum=0;for(let i=0;i<nSims;i++){const d=run[i]-meanR;varSum+=d*d}
  const stdR=Math.sqrt(varSum/nSims);
  const medianR=sf[Math.floor(.5*nSims)];
  const spikeSet=new Set();
  for(const x of exs){
    if(x.kind==='monthly'){for(const ds of days)if(Number(ds.slice(8,10))===Number(x.day))spikeSet.add(ds)}
    else if(x.kind==='once'){if(x.date>=start&&x.date<=end)spikeSet.add(x.date)}
  }
  return{
    days,mean,p10,p90,startBalance:balance,startDate:balanceDate,rate,
    expDays:[...spikeSet],
    incomeDays:[...incMap.keys()],checkpointDays:[...cpMap.keys()],payDayDates,
    targetCheckpointDays:targetCps.filter(c=>c.date>balanceDate&&c.date<=end).map(c=>c.date),
    vacationDays,
    finalMean:meanR,finalMedian:medianR,finalStd:stdR,
    finalP10:sf[Math.floor(.1*nSims)],finalP90:sf[Math.floor(.9*nSims)],
    finalMin:minR,finalMax:maxR,negativeProb:negCount/nSims,
    midPeriodNegProb:midNegCount/nSims,
    totalExpenses:te,totalAutoExpense:autoTotal,totalIncomes:ti,
    totalExpectedWork,calibrationShift:finalShift,taxRate,
    unpaidAtEnd:unpaidMean,initialUnpaid:init,initialUnpaidHours:initHours,
    nextSalary,
    targetReachProb,
    model:{pWork:[...wm.pWork],avgH:[...wm.avgH],expH:[...wm.expH],
      sampleSizes:wm.sampleSizes,halfLife,weekBootstrap:useWeekBoot,
      historicalWeeks:histWeeks.length,vacationDayCount:vacationDays.length,
      droppedHistoryWeeks:histWeeks.droppedCount||0,
      anchorDate:balanceDate,calibrationExtraWidth:extraWidth,
      autoIntervalsUsed:autoRates?autoRates.length:0},
    perDay:{work:expectedWork,exp:expectedExp,inc:expectedInc},
    finalRuns:[...run]
  };
}

/* ----- cash flow from checkpoints -----
   Между двумя соседними фактическими чекпоинтами A→B наблюдаемый cash-out =
   заработано(A,B] + поступления(A,B] − Δбаланса. Из него вычитаем введённые
   расходы — остаётся «неучтённый» поток. Считаются и устойчивые статистики
   (median, robust mean, σ), чтобы один разовый интервал не перекосил оценку.
   opts.excluded — массив {from,to}: интервалы с такой парой пропускаются. */
function cashFlowFromCheckpoints(es,exs,incs,cps,opts){
  /* opts.taxRate (% of gross) — if set, earned is netted before computing
     netOut. The user's recorded balance reflects post-tax cash, so gross
     earnings would otherwise inflate the "implicit" estimate by exactly
     the tax amount.
     opts.fallbackRate — when an entry has rate=0 (e.g., Clockify CSV
     without billable rate configured), use this rate instead.
     opts.payDays — month-day numbers of salary deposits. When set,
     `earned` counts only work that was actually paid into the balance
     during (A,B] (= work in (lastPay≤A, lastPay≤B]), not work performed
     in the interval. Without this, unpaid Clockify hours get charged as
     "implicit outflow" which is the dominant source of bogus auto-expense.
     opts.referenceDate — "now" for the recent-90 window (defaults to
     today()). Pass for deterministic tests. */
  opts=opts||{};
  if(!cps||cps.length<2)return null;
  const taxRate=Math.max(0,Math.min(1,(opts.taxRate||0)/100));
  const fallbackRate=Number(opts.fallbackRate)||0;
  const refDate=opts.referenceDate||today();
  const payDays=opts.payDays&&opts.payDays.length?opts.payDays:null;
  const payActuals=opts.payDayActuals&&opts.payDayActuals.length?opts.payDayActuals:null;
  const useDelayed=!!(payDays||payActuals);
  const excluded=new Set((opts.excluded||[]).map(x=>x.from+'|'+x.to));
  const sorted=[...cps].filter(c=>(c.kind||'actual')==='actual')
    .sort((a,b)=>a.date<b.date?-1:1);
  if(sorted.length<2)return null;
  const intervals=[],usedRates=[];
  let totalNetOut=0,totalImplicit=0,totalEarned=0,totalDays=0;
  for(let i=1;i<sorted.length;i++){
    const A=sorted[i-1],B=sorted[i];
    const dur=daysBetween(A.date,B.date);
    if(dur<=0)continue;
    const earnFrom=useDelayed?(lastPayDayBefore(A.date,payDays,payActuals)||A.date):A.date;
    const earnTo=useDelayed?(lastPayDayBefore(B.date,payDays,payActuals)||B.date):B.date;
    let earnedGross=0;
    if(earnTo>earnFrom)for(const e of es||[])if(e.date>earnFrom&&e.date<=earnTo){
      const r=e.rate>0?e.rate:fallbackRate;
      earnedGross+=e.hours*r;
    }
    const earned=earnedGross*(1-taxRate);
    let inIn=0;
    for(const inc of incs||[])if(inc.date>A.date&&inc.date<=B.date)inIn+=Number(inc.amount);
    /* Use baseDate=refDate so growthRate scales DOWN for past dates —
       historical equivalent of today's entered rent/etc. */
    const exMap=expandExpenses(exs||[],addDays(A.date,1),B.date,{baseDate:refDate});
    let exOut=0;for(const v of exMap.values())exOut+=v;
    const delta=B.balance-A.balance;
    const netOut=earned+inIn-delta;
    const implicit=netOut-exOut;
    const isExcluded=excluded.has(A.date+'|'+B.date);
    const it={from:A.date,to:B.date,days:dur,earned,earnedGross,taxWithheld:earnedGross-earned,explicitIn:inIn,explicitOut:exOut,delta,netOut,implicitOut:implicit,excluded:isExcluded};
    intervals.push(it);
    if(isExcluded)continue;
    totalNetOut+=netOut;totalImplicit+=implicit;totalEarned+=earned;totalDays+=dur;
    usedRates.push({days:dur,monthlyImplicit:implicit/dur*30.44,monthlyNetOut:netOut/dur*30.44});
  }
  if(!usedRates.length)return{intervals,intervalsUsed:0};
  const M=30.44;
  const monthlyNetOut=totalDays>0?totalNetOut/totalDays*M:0;
  const monthlyImplicit=totalDays>0?totalImplicit/totalDays*M:0;
  const monthlyEarned=totalDays>0?totalEarned/totalDays*M:0;
  const cutoff=addDays(refDate,-90);
  let rN=0,rI=0,rD=0;
  for(const it of intervals){
    if(it.excluded||it.to<=cutoff)continue;
    const startEff=it.from>cutoff?it.from:cutoff;
    /* dur2 = number of days in interval (A,B] that fall after cutoff =
       (B − max(A,cutoff)). The earlier `addDays(startEff,-1)` shifted the
       anchor and caused an off-by-one. */
    const dur2=daysBetween(startEff,it.to);
    if(dur2<=0)continue;
    const frac=it.days>0?Math.min(1,dur2/it.days):0;
    rN+=it.netOut*frac;rI+=it.implicitOut*frac;rD+=dur2;
  }
  const monthlyRecent=rD>0?rN/rD*M:null;
  const monthlyRecentImplicit=rD>0?rI/rD*M:null;
  /* Robust monthly-implicit estimate (B2):
     - sort interval implicit rates
     - drop one outlier on each side if ≥4 intervals (winsorize)
     - take duration-weighted mean of the kept set
     This dampens the effect of a single car-purchase month. */
  const implicitRates=usedRates.map(r=>r.monthlyImplicit);
  const sortedRates=[...implicitRates].sort((a,b)=>a-b);
  const medianImplicit=sortedRates[Math.floor(sortedRates.length/2)];
  let robust=monthlyImplicit;
  if(usedRates.length>=4){
    const sortedByRate=[...usedRates].sort((a,b)=>a.monthlyImplicit-b.monthlyImplicit);
    const trimmed=sortedByRate.slice(1,-1);
    const tDays=trimmed.reduce((s,r)=>s+r.days,0);
    const tSum=trimmed.reduce((s,r)=>s+r.monthlyImplicit*r.days,0);
    if(tDays>0)robust=tSum/tDays;
  }
  /* Per-source σ — each estimate has its own dispersion measure:
     - σ_overall: classic sample std of all interval rates (unbiased)
     - σ_robust: std of trimmed set (matches the robust mean)
     - σ_recent: std of the recent-90 contributing rates */
  let varSum=0;
  for(const r of usedRates)varSum+=(r.monthlyImplicit-monthlyImplicit)*(r.monthlyImplicit-monthlyImplicit);
  const sigmaOverall=usedRates.length>1?Math.sqrt(varSum/(usedRates.length-1)):0;
  let sigmaRobust=sigmaOverall;
  if(usedRates.length>=4){
    const trimmed=[...usedRates].sort((a,b)=>a.monthlyImplicit-b.monthlyImplicit).slice(1,-1);
    const tMean=trimmed.reduce((s,r)=>s+r.monthlyImplicit,0)/trimmed.length;
    let tVar=0;for(const r of trimmed)tVar+=(r.monthlyImplicit-tMean)*(r.monthlyImplicit-tMean);
    sigmaRobust=trimmed.length>1?Math.sqrt(tVar/(trimmed.length-1)):sigmaOverall;
  }
  const recentSet=intervals.filter(it=>!it.excluded&&it.to>cutoff)
    .map(it=>it.implicitOut/it.days*M);
  let sigmaRecent=sigmaOverall;
  if(recentSet.length>1){
    const rMean=recentSet.reduce((a,b)=>a+b,0)/recentSet.length;
    let rVar=0;for(const r of recentSet)rVar+=(r-rMean)*(r-rMean);
    sigmaRecent=Math.sqrt(rVar/(recentSet.length-1));
  }
  return{
    intervals,intervalsUsed:usedRates.length,
    totalNetOut,totalImplicit,totalEarned,totalDays,
    monthlyNetOut,monthlyImplicit,monthlyEarned,
    monthlyRecent,monthlyRecentImplicit,recentDays:rD,
    monthlyImplicitMedian:medianImplicit,
    monthlyImplicitRobust:robust,
    monthlyImplicitSigma:sigmaOverall,
    sigmaOverall,sigmaRobust,sigmaRecent,
    implicitRates,
    intervalDurations:usedRates.map(r=>r.days),
    taxRate
  };
}

/* Best single-number estimate of recurring monthly outflow beyond explicit
   expenses. The returned sampleRates are CENTERED around `value` so the
   simulation mean matches the displayed estimate, while preserving the
   variance observed across past intervals. */
function autoExpenseEstimate(cf){
  if(!cf||!cf.intervalsUsed)return null;
  let value=0,source='none',sigma=cf.sigmaOverall||cf.monthlyImplicitSigma||0;
  if(cf.monthlyRecentImplicit!=null&&cf.recentDays>=30){
    value=cf.monthlyRecentImplicit;source='recent90';sigma=cf.sigmaRecent||sigma;
  }else if(cf.intervalsUsed>=4){
    value=cf.monthlyImplicitRobust;source='robust';sigma=cf.sigmaRobust||sigma;
  }else{
    value=cf.monthlyImplicit;source='mean';
  }
  const v=Math.max(0,value);
  /* Center sample rates around `value` (so sim mean matches displayed
     estimate) WITHOUT clipping — preserves the empirical variance.
     A "negative auto-rate" in a sim means that historical interval showed
     UNEXPLAINED INCOME (balance grew faster than tracked), which is a
     legitimate scenario the model carries forward. Weight = interval days,
     so a 60-day interval counts 20x more than a 3-day one in the sampler. */
  const durs=cf.intervalDurations||cf.implicitRates.map(()=>1);
  const totDur=durs.reduce((a,b)=>a+b,0)||1;
  const rawMean=cf.implicitRates.length
    ?cf.implicitRates.reduce((s,r,i)=>s+r*durs[i],0)/totDur:0;
  const sampleRates=cf.implicitRates.map(r=>r-rawMean+v);
  return{value:v,sigma,source,sampleRates,sampleDurations:durs,intervalsUsed:cf.intervalsUsed};
}
