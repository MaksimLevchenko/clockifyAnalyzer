/* Canvas chart rendering. Depends on core.js (fmt/esc/wd/WD/dailyAgg),
   state.js (state/cur), ui.js (bindTip). */

const COL = {
  ink:'#23201a', muted:'#736a58', line:'#ddd0b8',
  green:'#2f6b4f', terra:'#b1462c', gold:'#a9792a',
  past:'#3d6e8e',
  band:'rgba(47,107,79,.16)'
};
const CHART_HEIGHTS = {
  'ch-daily':220, 'ch-hours':220, 'ch-monthly':220, 'ch-cum':220,
  'ch-proj':240, 'ch-wd':200, 'ch-hist':200, 'ch-bal':240,
  'ch-fc':280, 'ch-fc-monthly':220, 'ch-fc-dist':220
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

/* Forecast viewport state. Pinned by left-edge day-offset (in days from the
   timeline's leftmost date) so it survives resizes — px-per-day is recomputed
   from width each draw, but the day-offset is width-independent. Reset to the
   default ([today..end]) on every fresh forecast (keepView falsy). */
let fcView=null;

function drawForecast(id,r,startBal,keepView){
  const c=document.getElementById(id);if(!c)return;
  const{x,w,h}=dpr(c,c.getAttribute('height')*1);
  const pad=chartPad(w,true);
  const plotW=w-pad.l-pad.r, plotH=h-pad.t-pad.b;
  const small=w<420;
  const past=(r.past&&r.past.dates.length)?r.past:null;
  const n=r.days.length;
  const leftLimit=past?past.dates[0]:r.startDate;
  const endDate=r.days[n-1];
  const endDn=Math.max(0,daysBetween(leftLimit,endDate));
  const todayDn=daysBetween(leftLimit,today());
  /* default window = [today..end]; if the whole horizon is in the past
     (today>end) fall back to the last ~30 days so the view is never empty. */
  let windowDays=endDn-todayDn;
  if(windowDays<1)windowDays=Math.min(endDn||1,30);
  const defaultLeftDn=Math.max(0,endDn-windowDays);
  const pxPerDay=plotW/Math.max(1,windowDays);
  let leftDn=(keepView&&fcView)?fcView.leftDn:defaultLeftDn;
  leftDn=Math.max(0,Math.min(leftDn,defaultLeftDn));
  fcView={leftDn,pxPerDay,leftLimit,defaultLeftDn,windowDays};
  const dnOf=d=>daysBetween(leftLimit,d);
  const X=d=>pad.l+(dnOf(d)-leftDn)*pxPerDay;

  /* Y range over the VISIBLE window (so the default today→end view frames the
     forecast even when a far-past balance is very different) — with 0 and the
     start balance always kept as floors/references. */
  const inWin=dn=>dn>=leftDn-1e-6&&dn<=leftDn+windowDays+1e-6;
  let mn=Math.min(startBal,0),mx=startBal;
  for(let i=0;i<n;i++){if(!inWin(dnOf(r.days[i])))continue;if(r.p90[i]>mx)mx=r.p90[i];if(r.p10[i]<mn)mn=r.p10[i]}
  if(past)for(let i=0;i<past.dates.length;i++){if(!inWin(dnOf(past.dates[i])))continue;const v=past.balance[i];if(v>mx)mx=v;if(v<mn)mn=v}
  mx=niceMax(mx);const span=(mx-mn)||1;
  const Y=v=>h-pad.b-plotH*((v-mn)/span);

  // Y axis grid + labels
  x.strokeStyle=COL.line;x.fillStyle=COL.muted;x.font=(small?'10px':'11px')+' Spline Sans Mono, monospace';x.lineWidth=1;
  for(let i=0;i<=4;i++){
    const yy=pad.t+plotH*i/4;const val=mn+span*(1-i/4);
    x.beginPath();x.moveTo(pad.l,yy);x.lineTo(w-pad.r,yy);x.stroke();
    x.textAlign='right';x.fillText(small?fmtCompact(val):fmt(val),pad.l-4,yy+3);
  }

  x.save();x.beginPath();x.rect(pad.l,pad.t,plotW,plotH);x.clip();
  // band
  x.beginPath();for(let i=0;i<n;i++){const cx=X(r.days[i]);i?x.lineTo(cx,Y(r.p90[i])):x.moveTo(cx,Y(r.p90[i]))}
  for(let i=n-1;i>=0;i--)x.lineTo(X(r.days[i]),Y(r.p10[i]));
  x.closePath();x.fillStyle=COL.band;x.fill();
  // start balance line
  x.setLineDash([4,4]);x.strokeStyle=COL.muted;
  x.beginPath();x.moveTo(pad.l,Y(startBal));x.lineTo(w-pad.r,Y(startBal));x.stroke();
  x.setLineDash([]);
  // zero line — visible only when the chart's Y range crosses 0
  if(mn<=0&&mx>=0){
    const zy=Y(0);
    x.setLineDash([2,3]);x.strokeStyle=COL.terra;x.lineWidth=1.5;
    x.beginPath();x.moveTo(pad.l,zy);x.lineTo(w-pad.r,zy);x.stroke();
    x.setLineDash([]);x.lineWidth=1;
  }
  // past reconstruction (real balance, no band)
  if(past){
    x.beginPath();for(let i=0;i<past.dates.length;i++){const cx=X(past.dates[i]);i?x.lineTo(cx,Y(past.balance[i])):x.moveTo(cx,Y(past.balance[i]))}
    x.strokeStyle=COL.past;x.lineWidth=2;x.stroke();
  }
  // mean
  x.beginPath();for(let i=0;i<n;i++){const cx=X(r.days[i]);i?x.lineTo(cx,Y(r.mean[i])):x.moveTo(cx,Y(r.mean[i]))}
  x.strokeStyle=COL.green;x.lineWidth=2.5;x.stroke();
  // event markers (forecast side)
  const dmap=new Map(r.days.map((d,i)=>[d,i]));
  x.fillStyle=COL.terra;(r.expDays||[]).forEach(d=>{const i=dmap.get(d);if(i!=null){x.beginPath();x.arc(X(d),Y(r.mean[i]),3,0,7);x.fill()}});
  x.fillStyle=COL.green;(r.incomeDays||[]).forEach(d=>{const i=dmap.get(d);if(i!=null){x.beginPath();x.arc(X(d),Y(r.mean[i]),3,0,7);x.fill()}});
  x.fillStyle=COL.gold;x.strokeStyle=COL.ink;x.lineWidth=1;
  (r.checkpointDays||[]).forEach(d=>{const i=dmap.get(d);if(i!=null){x.beginPath();x.arc(X(d),Y(r.mean[i]),5,0,7);x.fill();x.stroke()}});
  // past checkpoints — gold dots pinned to the reconstruction line
  if(past){
    x.fillStyle=COL.gold;x.strokeStyle=COL.ink;x.lineWidth=1;
    past.checkpoints.forEach(cp=>{x.beginPath();x.arc(X(cp.date),Y(cp.balance),5,0,7);x.fill();x.stroke()});
  }
  /* Target checkpoints — solid terra-coloured dot drawn at the user's
     TARGET balance (not the modeled mean), so the user can see "where I
     want to be" vs "where the model predicts". A small vertical guide
     line connects the dot to the mean curve at the same date. */
  const tcps=(r.targetReachProb||[]).filter(t=>dmap.has(t.date));
  tcps.forEach(t=>{
    const i=dmap.get(t.date);if(i==null)return;
    const tx=X(t.date),ty=Y(t.balance),my=Y(r.mean[i]);
    x.strokeStyle=COL.terra;x.lineWidth=1;x.setLineDash([2,3]);
    x.beginPath();x.moveTo(tx,Math.min(ty,my));x.lineTo(tx,Math.max(ty,my));x.stroke();
    x.setLineDash([]);
    x.fillStyle=COL.terra;x.strokeStyle=COL.ink;x.lineWidth=1;
    x.beginPath();x.arc(tx,ty,5,0,7);x.fill();x.stroke();
  });
  // pay-day ticks at top of chart
  x.strokeStyle=COL.muted;x.lineWidth=1.5;
  (r.payDayDates||[]).forEach(d=>{const i=dmap.get(d);if(i!=null){const cx=X(d);x.beginPath();x.moveTo(cx,pad.t);x.lineTo(cx,pad.t+8);x.stroke()}});
  // today marker
  const todayVisible=todayDn>=leftDn-1e-6&&todayDn<=leftDn+windowDays+1e-6;
  if(todayVisible){
    const tx=pad.l+(todayDn-leftDn)*pxPerDay;
    x.setLineDash([3,3]);x.strokeStyle=COL.ink;x.lineWidth=1;
    x.beginPath();x.moveTo(tx,pad.t);x.lineTo(tx,h-pad.b);x.stroke();x.setLineDash([]);
  }
  x.restore(); // end clip

  if(todayVisible){
    const tx=pad.l+(todayDn-leftDn)*pxPerDay;
    x.fillStyle=COL.ink;x.textAlign='center';x.font=(small?'9px':'10px')+' Spline Sans Mono, monospace';
    x.fillText('сегодня',Math.max(pad.l+22,Math.min(w-pad.r-22,tx)),pad.t-1);
  }
  if(mn<=0&&mx>=0){
    x.fillStyle=COL.terra;x.textAlign='right';x.font=(small?'9px':'10px')+' Spline Sans Mono, monospace';
    x.fillText('0',pad.l-4,Y(0)+3);
  }
  // x labels (only within the visible window)
  x.fillStyle=COL.muted;x.textAlign='center';x.font=(small?'9px':'10px')+' Spline Sans Mono, monospace';
  const stepDays=chartLabelStep(w,Math.round(windowDays)+1);
  const startK=Math.ceil(leftDn);
  for(let dn=startK;dn<=leftDn+windowDays+1e-6;dn++){
    if((dn-startK)%stepDays!==0)continue;
    const cx=pad.l+(dn-leftDn)*pxPerDay;
    if(cx>=pad.l-1&&cx<=w-pad.r+1)x.fillText(dateRu(addDays(leftLimit,dn)),cx,h-pad.b+13);
  }

  // hover tooltips — only points currently within the viewport
  const ccy=esc(cur());
  const expSet=new Set(r.expDays||[]);
  const incSet=new Set(r.incomeDays||[]);
  const cpSet=new Set(r.checkpointDays||[]);
  const paySet=new Set(r.payDayDates||[]);
  const tgtByDate=new Map((r.targetReachProb||[]).map(t=>[t.date,t]));
  const pastCpSet=new Set(past?past.checkpoints.map(cp=>cp.date):[]);
  const visible=cx=>cx>=pad.l-pxPerDay&&cx<=w-pad.r+pxPerDay;
  const items=[];
  for(let i=0;i<n;i++){
    const d=r.days[i],cx=X(d);if(!visible(cx))continue;
    const dt=dateRu(d,true);const wn=WD[wd(d)];
    let html=`<b>${esc(dt)} (${wn})</b><br>Среднее: <b>${fmt(r.mean[i])} ${ccy}</b><br>Интервал 80%: ${fmt(r.p10[i])} — ${fmt(r.p90[i])} ${ccy}`;
    if(paySet.has(d))html+=`<br><span class="sub">💵 день выплаты</span>`;
    if(cpSet.has(d))html+=`<br><span style="color:#e6c982">★ чекпоинт</span>`;
    if(tgtByDate.has(d)){
      const t=tgtByDate.get(d);
      html+=`<br><span style="color:#a9792a">◇ цель ${fmt(t.balance)} ${ccy} — достижимость ${(t.prob*100).toFixed(0)}%</span>`;
    }
    if(expSet.has(d))html+=`<br><span style="color:#e89a85">● расход</span>`;
    if(incSet.has(d))html+=`<br><span style="color:#88c5a8">● поступление</span>`;
    items.push({cx,cy:Y(r.mean[i]),html});
  }
  if(past)for(let i=0;i<past.dates.length;i++){
    const d=past.dates[i],cx=X(d);if(!visible(cx))continue;
    const dt=dateRu(d,true);const wn=WD[wd(d)];
    let html=`<b>${esc(dt)} (${wn})</b><br>Факт (реконструкция): <b>${fmt(past.balance[i])} ${ccy}</b>`;
    if(pastCpSet.has(d))html+=`<br><span style="color:#e6c982">★ чекпоинт</span>`;
    items.push({cx,cy:Y(past.balance[i]),html});
  }
  bindTip(c,items,'point');
  bindForecastPan(c);
}

/* Drag-to-pan for the forecast chart. Pins the viewport by day-offset and
   redraws on rAF. Sets canvas._panning during an active drag so bindTip
   (ui.js) suppresses the hover tooltip. Bound once per canvas. */
function bindForecastPan(c){
  if(c._panBound)return;c._panBound=true;
  c.style.cursor='grab';
  let dragging=false,startX=0,startLeftDn=0,raf=0,startY=0,decided=false;
  const redraw=()=>{raf=0;if(lastFc)drawForecast('ch-fc',lastFc,lastFc.startBalance,true)};
  const schedule=()=>{if(!raf)raf=requestAnimationFrame(redraw)};
  const apply=dx=>{
    if(!fcView)return;
    let nd=startLeftDn-dx/fcView.pxPerDay;
    fcView.leftDn=Math.max(0,Math.min(nd,fcView.defaultLeftDn));
    schedule();
  };
  const canPan=()=>fcView&&fcView.defaultLeftDn>0;
  c.addEventListener('mousedown',e=>{
    if(!canPan())return;
    dragging=true;startX=e.clientX;startLeftDn=fcView.leftDn;c.style.cursor='grabbing';
  });
  window.addEventListener('mousemove',e=>{
    if(!dragging)return;
    const dx=e.clientX-startX;
    if(Math.abs(dx)>2){c._panning=true;hideTip()}
    apply(dx);
  });
  window.addEventListener('mouseup',()=>{
    if(!dragging)return;dragging=false;c.style.cursor='grab';
    setTimeout(()=>{c._panning=false},0);
  });
  c.addEventListener('touchstart',e=>{
    if(!canPan())return;const t=e.touches[0];if(!t)return;
    dragging=true;decided=false;startX=t.clientX;startY=t.clientY;startLeftDn=fcView.leftDn;
  },{passive:true});
  c.addEventListener('touchmove',e=>{
    if(!dragging)return;const t=e.touches[0];if(!t)return;
    const dx=t.clientX-startX,dy=t.clientY-startY;
    if(!decided){
      if(Math.abs(dx)<6&&Math.abs(dy)<6)return;
      decided=true;
      if(Math.abs(dx)<=Math.abs(dy)){dragging=false;return}
      c._panning=true;hideTip();
    }
    e.preventDefault();
    apply(dx);
  },{passive:false});
  const end=()=>{dragging=false;setTimeout(()=>{c._panning=false},50)};
  c.addEventListener('touchend',end);
  c.addEventListener('touchcancel',end);
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
  const cps=[...state.checkpoints].sort((a,b)=>a.date<b.date?-1:1);
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
  const monthly=state.entries.length?monthlyAgg(state.entries):[];
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
  const daily=es.length?dailyAgg(es):[];
  const monthly=es.length?monthlyAgg(es):[];
  const projects=es.length?projectAgg(es,8):[];
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
          v.workAct+=e.hours*e.rate;seenDates.add(e.date);
        }
      }
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
