/* Canvas chart rendering. Depends on core.js (fmt/esc/wd/WD/dailyAgg),
   state.js (state/cur), ui.js (bindTip). */

const COL = {
  ink:'#23201a', muted:'#736a58', line:'#ddd0b8',
  green:'#2f6b4f', terra:'#b1462c', gold:'#a9792a',
  past:'#3d6e8e',
  band:'rgba(47,107,79,.16)',
  plot:'rgba(255,255,255,.25)',
  marker:'rgba(35,32,26,.42)',
  reference:'rgba(115,106,88,.7)'
};

function syncChartColors(){
  const styles=getComputedStyle(document.documentElement);
  const read=name=>styles.getPropertyValue(name).trim();
  Object.assign(COL,{
    ink:read('--ink'),muted:read('--muted'),line:read('--line'),
    green:read('--green'),terra:read('--terra'),gold:read('--gold'),
    past:read('--blue'),band:read('--chart-band'),plot:read('--chart-plot'),
    marker:read('--chart-marker'),reference:read('--chart-reference')
  });
}

syncChartColors();
const CHART_HEIGHTS = {
  'ch-daily':220, 'ch-hours':220, 'ch-monthly':220, 'ch-cum':220,
  'ch-proj':240, 'ch-wd':200, 'ch-hist':200, 'ch-bal':240,
  'ch-fc':360, 'ch-fc-monthly':220, 'ch-fc-dist':220
};

let lastFc = null;

function ensureCanvasHost(c,cssH){
  let host=c.parentElement;
  if(!host||!host.classList.contains('canvas-host')){
    host=document.createElement('div');
    host.className='canvas-host';
    c.parentNode.insertBefore(host,c);
    host.appendChild(c);
  }
  /* чистим прошлые инлайн-размеры — теперь канвас занимает 100% хоста через CSS */
  c.style.removeProperty('width');
  c.style.removeProperty('height');
  host.style.height=cssH+'px';
  return host;
}

function dpr(c,h){
  const cssH=Math.max(1,CHART_HEIGHTS[c.id]||Number(c.dataset.chartHeight)||h||220);
  c.dataset.chartHeight=String(cssH);
  const host=ensureCanvasHost(c,cssH);
  /* width идёт от хоста — он всегда правильной ширины (width:100% контейнера),
     не зависит от инлайн-стилей канваса. Высоту хоста жёстко задали выше,
     overflow:hidden гарантирует, что любые выкрутасы канваса не утекут наружу. */
  const w=Math.max(1,Math.floor(host.clientWidth||host.getBoundingClientRect().width||600));
  const r=window.devicePixelRatio||1;
  c.width=Math.max(1,Math.floor(w*r));
  c.height=Math.max(1,Math.floor(cssH*r));
  const x=c.getContext('2d');x.setTransform(r,0,0,r,0,0);
  return{x,w,h:cssH};
}

function chartPad(w,big){
  /* big = wider left for big numbers (cumulative / forecast). */
  if(w<420)return{l:big?44:36, r:6, t:10, b:22};
  return{l:big?60:54, r:10, t:12, b:24};
}
function chartLabelStep(w,n){
  const targets=w<320?4:w<420?6:w<700?8:12;
  return Math.max(1,Math.ceil(n/targets));
}

function niceMax(v){
  if(v<=0)return 1;
  const p=Math.pow(10,Math.floor(Math.log10(v)));
  const n=v/p;const m=n<=1?1:n<=2?2:n<=5?5:10;
  return m*p;
}

function axes(x,w,h,maxV,pad){
  x.strokeStyle=COL.line;x.fillStyle=COL.muted;
  const small=w<420;
  x.font=(small?'10px':'11px')+' Spline Sans Mono, monospace';x.lineWidth=1;
  for(let i=0;i<=4;i++){
    const yy=pad.t+(h-pad.t-pad.b)*i/4;
    const val=maxV*(1-i/4);
    x.beginPath();x.moveTo(pad.l,yy);x.lineTo(w-pad.r,yy);x.stroke();
    x.textAlign='right';x.fillText(small?fmtCompact(val):fmt(val),pad.l-4,yy+3);
  }
}

function drawBars(id,labels,vals,color,tips){
  const c=document.getElementById(id);if(!c)return;
  const{x,w,h}=dpr(c,c.getAttribute('height')*1);
  const pad=chartPad(w,true);
  const mx=niceMax(Math.max(...vals,1));axes(x,w,h,mx,pad);
  const n=vals.length;const bw=(w-pad.l-pad.r)/n;
  const items=[];
  vals.forEach((v,i)=>{
    const bh=(h-pad.t-pad.b)*(v/mx);const bx=pad.l+i*bw;
    x.fillStyle=color;x.fillRect(bx+bw*0.12,h-pad.b-bh,bw*0.76,bh);
    items.push({x:bx,w:bw,cx:bx+bw/2,cy:h-pad.b-bh,html:tips?tips[i]:`<b>${esc(String(labels[i]))}</b><br>${fmt(v)}`});
  });
  x.fillStyle=COL.muted;x.textAlign='center';x.font=(w<420?'9px':'10px')+' Spline Sans Mono, monospace';
  const step=chartLabelStep(w,n);
  labels.forEach((lb,i)=>{if(i%step===0){x.fillText(lb,pad.l+i*bw+bw/2,h-pad.b+13)}});
  bindTip(c,items,'bar');
}

function drawArea(id,labels,vals,tips){
  const c=document.getElementById(id);if(!c)return;
  const{x,w,h}=dpr(c,c.getAttribute('height')*1);
  const pad=chartPad(w,true);
  const mx=niceMax(Math.max(...vals,1));axes(x,w,h,mx,pad);
  const n=vals.length;
  const px=i=>pad.l+(w-pad.l-pad.r)*(n<2?0:i/(n-1));
  const py=v=>h-pad.b-(h-pad.t-pad.b)*(v/mx);
  x.beginPath();x.moveTo(px(0),h-pad.b);
  vals.forEach((v,i)=>x.lineTo(px(i),py(v)));
  x.lineTo(px(n-1),h-pad.b);x.closePath();
  x.fillStyle='rgba(47,107,79,.14)';x.fill();
  x.beginPath();vals.forEach((v,i)=>i?x.lineTo(px(i),py(v)):x.moveTo(px(i),py(v)));
  x.strokeStyle=COL.green;x.lineWidth=2;x.stroke();
  x.fillStyle=COL.muted;x.textAlign='center';x.font=(w<420?'9px':'10px')+' Spline Sans Mono, monospace';
  const step=chartLabelStep(w,n);
  labels.forEach((lb,i)=>{if(i%step===0)x.fillText(lb,px(i),h-pad.b+13)});
  const items=vals.map((v,i)=>({cx:px(i),cy:py(v),html:tips?tips[i]:`<b>${esc(String(labels[i]))}</b><br>${fmt(v)}`}));
  bindTip(c,items,'point');
}

function drawLine(id,labels,vals,tips){
  const c=document.getElementById(id);if(!c)return;
  const{x,w,h}=dpr(c,c.getAttribute('height')*1);
  const pad=chartPad(w,true);
  const mx=niceMax(Math.max(...vals,1));
  const mn=Math.min(...vals,0);
  const span=mx-mn||1;const n=vals.length;
  const px=i=>pad.l+(w-pad.l-pad.r)*(n<2?0:i/(n-1));
  const py=v=>h-pad.b-(h-pad.t-pad.b)*((v-mn)/span);
  const small=w<420;
  x.strokeStyle=COL.line;x.fillStyle=COL.muted;x.font=(small?'10px':'11px')+' Spline Sans Mono, monospace';x.lineWidth=1;
  for(let i=0;i<=4;i++){
    const yy=pad.t+(h-pad.t-pad.b)*i/4;
    const val=mn+span*(1-i/4);
    x.beginPath();x.moveTo(pad.l,yy);x.lineTo(w-pad.r,yy);x.stroke();
    x.textAlign='right';x.fillText(small?fmtCompact(val):fmt(val),pad.l-4,yy+3);
  }
  x.beginPath();vals.forEach((v,i)=>i?x.lineTo(px(i),py(v)):x.moveTo(px(i),py(v)));
  x.strokeStyle=COL.green;x.lineWidth=2.5;x.stroke();
  x.fillStyle=COL.gold;x.strokeStyle=COL.ink;x.lineWidth=1;
  vals.forEach((v,i)=>{x.beginPath();x.arc(px(i),py(v),small?4:5,0,7);x.fill();x.stroke()});
  x.fillStyle=COL.muted;x.textAlign='center';x.font=(small?'9px':'10px')+' Spline Sans Mono, monospace';
  const step=chartLabelStep(w,n);
  labels.forEach((lb,i)=>{if(i%step===0)x.fillText(lb,px(i),h-pad.b+13)});
  const items=vals.map((v,i)=>({cx:px(i),cy:py(v),html:tips?tips[i]:`<b>${esc(String(labels[i]))}</b><br>${fmt(v)}`}));
  bindTip(c,items,'point');
}

function drawBalanceChart(){
  const card=document.getElementById('card-balance');if(!card)return;
  const cps=state.checkpoints
    .filter(cp=>(cp.kind||'actual')==='actual')
    .sort((a,b)=>a.date<b.date?-1:1);
  if(cps.length<2){card.style.display='none';return}
  card.style.display='';
  const c=esc(cur());
  const labels=cps.map(cp=>dateRu(cp.date));
  const vals=cps.map(cp=>cp.balance);
  const tips=cps.map((cp,i)=>{
    let delta='';
    if(i>0){
      const d=cp.balance-cps[i-1].balance;
      const days=(new Date(cp.date)-new Date(cps[i-1].date))/86400000;
      delta=`<br><span class="sub">Δ от ${esc(dateRu(cps[i-1].date))}: ${d>=0?'+':''}${fmt(d)} ${c}${days>0?` за ${days|0} дн.`:''}</span>`;
    }
    return `<b>${esc(dateRu(cp.date,true))}</b><br>Баланс: <b>${fmt(cp.balance)} ${c}</b>${delta}`;
  });
  drawLine('ch-bal',labels,vals,tips);
}

function showChart(id,show){
  const c=document.getElementById(id);if(!c)return;
  const card=c.closest('.chart-card');
  if(card){card.style.display=show?'':'none';return}
  const box=c.closest('.chartbox');if(box)box.style.display=show?'':'none';
}

function setCardEmpty(cardId,msg){
  const card=document.getElementById(cardId);if(!card)return;
  let e=card.querySelector('.card-empty');
  if(msg){
    if(!e){e=document.createElement('div');e.className='card-empty empty';card.appendChild(e)}
    e.innerHTML=`<div class="big">Слишком мало данных</div>${esc(msg)}`;
    e.style.display='';
  }else if(e){e.style.display='none'}
}

function renderMonthlyStats(){
  const card=document.getElementById('card-monthly-stats');if(!card)return;
  const monthly=state.entries.length?monthlyAgg(state.entries,state.incomeModels):[];
  if(!monthly.length){card.style.display='none';return}
  card.style.display='';
  const c=esc(cur());
  const rows=[...monthly].sort((a,b)=>a.month<b.month?1:-1);
  document.querySelector('#monthly-stats-table tbody').innerHTML=rows.map(m=>`<tr>
    <td>${esc(monthRu(m.month))}</td>
    <td class="num">${m.hours.toFixed(1)}</td>
    <td class="num">${fmt(m.amount)} ${c}</td>
    <td class="num">${m.days}</td>
  </tr>`).join('');
}

function drawAllCharts(){
  drawBalanceChart();
  renderMonthlyStats();
  const es=state.entries;
  const daily=es.length?dailyAgg(es,state.incomeModels):[];
  const monthly=es.length?monthlyAgg(es,state.incomeModels):[];
  const projects=es.length?projectAgg(es,8,state.incomeModels):[];
  const c=esc(cur());
  const shortLab=daily.map(d=>dateRu(d.date));
  let timeOn=0,distOn=0;

  // ----- daily income
  const dailyOk=daily.length>=2;
  showChart('ch-daily',dailyOk);
  if(dailyOk){
    const tips=daily.map(d=>{
      const dt=esc(dateRu(d.date,true));const wn=WD[wd(d.date)];
      return `<b>${dt} (${wn})</b><br>Доход: <b>${fmt(d.amount)} ${c}</b><br>Часы: ${d.hours.toFixed(2)}`;
    });
    drawBars('ch-daily',shortLab,daily.map(d=>d.amount),COL.green,tips);timeOn++;
  }

  // ----- daily hours
  showChart('ch-hours',dailyOk);
  if(dailyOk){
    const tips=daily.map(d=>{
      const dt=esc(dateRu(d.date,true));const wn=WD[wd(d.date)];
      return `<b>${dt} (${wn})</b><br>Часы: <b>${d.hours.toFixed(2)}</b><br>Доход: ${fmt(d.amount)} ${c}`;
    });
    drawBars('ch-hours',shortLab,daily.map(d=>d.hours),COL.gold,tips);timeOn++;
  }

  // ----- monthly income
  const monthlyOk=monthly.length>=2;
  showChart('ch-monthly',monthlyOk);
  if(monthlyOk){
    const tips=monthly.map(m=>`<b>${esc(monthRu(m.month))}</b><br>Доход: <b>${fmt(m.amount)} ${c}</b><br>Часы: ${m.hours.toFixed(1)}<br>Рабочих дней: ${m.days}`);
    drawBars('ch-monthly',monthly.map(m=>monthRu(m.month)),monthly.map(m=>m.amount),COL.green,tips);timeOn++;
  }

  // ----- cumulative
  showChart('ch-cum',dailyOk);
  if(dailyOk){
    let cum=0;const cumVals=[];const tips=[];
    daily.forEach(d=>{
      cum+=d.amount;cumVals.push(cum);
      const dt=esc(dateRu(d.date,true));
      tips.push(`<b>${dt}</b><br>Накоплено: <b>${fmt(cum)} ${c}</b><br><span class="sub">+${fmt(d.amount)} ${c} за день</span>`);
    });
    drawArea('ch-cum',shortLab,cumVals,tips);timeOn++;
  }

  // ----- projects
  const projectsOk=projects.length>=2;
  showChart('ch-proj',projectsOk);
  if(projectsOk){
    const total=projects.reduce((s,p)=>s+p.amount,0);
    const labels=projects.map(p=>p.project.length>16?p.project.slice(0,14)+'…':p.project);
    const tips=projects.map(p=>{
      const share=total?(p.amount/total*100).toFixed(1):'0';
      return `<b>${esc(p.project)}</b><br>Доход: <b>${fmt(p.amount)} ${c}</b><br>Часы: ${p.hours.toFixed(1)}<br>Доля: ${share}%`;
    });
    drawBars('ch-proj',labels,projects.map(p=>p.amount),COL.gold,tips);distOn++;
  }

  // ----- weekday avg
  const byWd=Array.from({length:7},()=>[]);
  daily.forEach(d=>byWd[wd(d.date)].push(d.amount));
  const wdAvg=byWd.map(a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0);
  const wdOk=wdAvg.filter(v=>v>0).length>=2;
  showChart('ch-wd',wdOk);
  if(wdOk){
    const tips=byWd.map((a,i)=>{
      const sum=a.reduce((x,y)=>x+y,0);
      return `<b>${WD[i]}</b><br>Среднее: <b>${fmt(wdAvg[i])} ${c}</b><br>Рабочих дней: ${a.length}<br><span class="sub">Сумма: ${fmt(sum)} ${c}</span>`;
    });
    drawBars('ch-wd',WD,wdAvg,COL.gold,tips);distOn++;
  }

  // ----- histogram
  const vals=daily.map(d=>d.amount);
  const mx=Math.max(...vals,1);const bins=10;const hist=Array(bins).fill(0);
  vals.forEach(v=>{const b=Math.min(bins-1,Math.floor(v/mx*bins));hist[b]++});
  const histOk=hist.filter(v=>v>0).length>=2;
  showChart('ch-hist',histOk);
  if(histOk){
    const tips=hist.map((cnt,i)=>{
      const lo=mx/bins*i,hi=mx/bins*(i+1);
      return `<b>${fmt(lo)} — ${fmt(hi)} ${c}</b><br>Дней в диапазоне: <b>${cnt}</b>`;
    });
    drawBars('ch-hist',hist.map((_,i)=>fmt(mx/bins*i)),hist,COL.terra,tips);distOn++;
  }

  setCardEmpty('card-time',timeOn?null:'Импортируй отчёт Clockify или добавь хотя бы 2 рабочих дня.');
  setCardEmpty('card-dist',distOn?null:'Распределение строится по нескольким дням / проектам.');
}

function drawFinalDist(r){
  const runs=r&&r.finalRuns;
  if(!runs||runs.length<20){showChart('ch-fc-dist',false);return}
  const sorted=[...runs].sort((a,b)=>a-b);
  const mn=sorted[0], mx=sorted[sorted.length-1];
  if(mx-mn<1){showChart('ch-fc-dist',false);return}
  showChart('ch-fc-dist',true);
  const bins=24, bw=(mx-mn)/bins;
  const hist=Array(bins).fill(0);
  for(const v of sorted){const b=Math.min(bins-1,Math.floor((v-mn)/bw));hist[b]++}
  const labels=hist.map((_,i)=>fmt(mn+bw*i));
  const c=esc(cur());
  const mean=r.finalMean, p10=r.finalP10, p90=r.finalP90;
  const tips=hist.map((cnt,i)=>{
    const lo=mn+bw*i, hi=mn+bw*(i+1);
    const pct=(cnt/runs.length*100).toFixed(1);
    const mark=(mean>=lo&&mean<hi)?'<br><b>★ среднее</b>':((p10>=lo&&p10<hi)?'<br>↳ p10':((p90>=lo&&p90<hi)?'<br>↳ p90':''));
    return `<b>${fmt(lo)} — ${fmt(hi)} ${c}</b><br>Сценариев: <b>${cnt}</b> · ${pct}%${mark}`;
  });
  drawBars('ch-fc-dist',labels,hist,COL.gold,tips);
}

function drawMonthlyForecast(r){
  if(!r||!r.perDay||r.days.length<30){showChart('ch-fc-monthly',false);return}
  showChart('ch-fc-monthly',true);
  const byMonth=new Map();
  for(let i=0;i<r.days.length;i++){
    const k=r.days[i].slice(0,7);
    const v=byMonth.get(k)||{workFc:0,exp:0,inc:0,daysFc:0};
    v.workFc+=r.perDay.work[i];v.exp+=r.perDay.exp[i];v.inc+=r.perDay.inc[i];v.daysFc++;
    byMonth.set(k,v);
  }
  const months=[...byMonth.keys()].sort();
  for(const k of months){
    const v=byMonth.get(k);
    v.totalDays=daysInMonth(`${k}-01`);
    v.workAct=0;v.daysAct=0;
    if(k<=r.startDate.slice(0,7)){
      const seenDates=new Set();
      for(const e of state.entries){
        if(e.date.slice(0,7)===k&&e.date<=r.startDate){
          seenDates.add(e.date);
        }
      }
      for(const item of dailyAgg(state.entries,state.incomeModels))
        if(item.date.slice(0,7)===k&&item.date<=r.startDate)v.workAct+=item.amount;
      v.daysAct=seenDates.size;
    }
    v.workTotal=v.workAct+v.workFc;
    v.coveredDays=v.daysAct+v.daysFc;
    v.partial=v.coveredDays<v.totalDays;
  }
  const labels=months.map(monthRu);
  const vals=months.map(k=>byMonth.get(k).workTotal);
  const c=esc(cur());
  const tips=months.map(k=>{
    const v=byMonth.get(k);const net=v.workTotal+v.inc-v.exp;
    const wParts=v.workAct>0
      ?`Факт (до якоря, ${v.daysAct} дн.): <b>${fmt(v.workAct)} ${c}</b><br>Прогноз (${v.daysFc} дн.): <b>${fmt(v.workFc)} ${c}</b><br>Σ доход за месяц: <b>${fmt(v.workTotal)} ${c}</b>`
      :`Ожид. доход от работы (${v.daysFc} дн.): <b>${fmt(v.workFc)} ${c}</b>`;
    let extrap='';
    if(v.partial&&v.daysFc>0&&v.workAct===0){
      const full=v.workFc*v.totalDays/v.daysFc;
      extrap=`<br><span class="sub">за полный месяц ≈ ${fmt(full)} ${c} (экстраполяция)</span>`;
    }
    const cover=v.partial
      ?`<br><span class="sub">покрыто ${v.coveredDays} из ${v.totalDays} дней месяца</span>`
      :`<br><span class="sub">полный календарный месяц</span>`;
    return `<b>${esc(monthRu(k))}</b><br>${wParts}${v.inc?`<br>Поступления: +${fmt(v.inc)} ${c}`:''}${v.exp?`<br>Расходы: −${fmt(v.exp)} ${c}`:''}<br>Нетто: <b style="color:${net>=0?COL.green:COL.terra}">${net>=0?'+':''}${fmt(net)} ${c}</b>${cover}${extrap}`;
  });
  drawBars('ch-fc-monthly',labels,vals,COL.green,tips);
}

let _resizeT;
let _lastResizeWidth=window.innerWidth||document.documentElement.clientWidth||0;
window.addEventListener('resize',()=>{
  const width=window.innerWidth||document.documentElement.clientWidth||0;
  if(Math.abs(width-_lastResizeWidth)<2)return;
  _lastResizeWidth=width;
  clearTimeout(_resizeT);
  _resizeT=setTimeout(()=>{
    if(document.getElementById('panel-charts').classList.contains('active'))drawAllCharts();
    if(document.getElementById('panel-forecast').classList.contains('active')&&lastFc){
      drawForecast('ch-fc',lastFc,lastFc.startBalance,true);
      drawMonthlyForecast(lastFc);
      drawFinalDist(lastFc);
    }
  },150);
});

document.addEventListener('app-theme-change',()=>{
  syncChartColors();
  if(document.getElementById('panel-charts').classList.contains('active'))drawAllCharts();
  if(document.getElementById('panel-forecast').classList.contains('active')&&lastFc){
    drawForecast('ch-fc',lastFc,lastFc.startBalance,true);
    drawMonthlyForecast(lastFc);
    drawFinalDist(lastFc);
  }
});
