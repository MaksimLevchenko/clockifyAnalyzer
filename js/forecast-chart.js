function niceForecastStep(span){
  const rough=span/4;
  const power=Math.pow(10,Math.floor(Math.log10(Math.max(rough,1))));
  const normalized=rough/power;
  return(normalized<=1?1:normalized<=2?2:normalized<=5?5:10)*power;
}

function drawEventMarker(ctx,cx,cy,events,width){
  const types=[...new Set(events.filter(event=>!event.background&&fcLayers.has(event.type)).map(event=>event.type))];
  if(!types.length)return false;
  const markerW=clampValue(width*.58,5,10);
  const markerH=13;
  ctx.save();
  ctx.beginPath();
  if(ctx.roundRect)ctx.roundRect(cx-markerW/2,cy-markerH/2,markerW,markerH,markerW/2);
  else ctx.rect(cx-markerW/2,cy-markerH/2,markerW,markerH);
  ctx.clip();
  types.forEach((type,index)=>{
    const y=cy-markerH/2+markerH*index/types.length;
    ctx.fillStyle=FC_EVENT_COLORS[type];
    ctx.fillRect(cx-markerW/2,y,markerW,markerH/types.length+.5);
  });
  ctx.restore();
  ctx.strokeStyle=COL.marker;ctx.lineWidth=.7;
  ctx.beginPath();
  if(ctx.roundRect)ctx.roundRect(cx-markerW/2,cy-markerH/2,markerW,markerH,markerW/2);
  else ctx.rect(cx-markerW/2,cy-markerH/2,markerW,markerH);
  ctx.stroke();
  return true;
}

function drawForecast(id,r,startBal,keepView){
  const canvas=document.getElementById(id);if(!canvas||!r.days.length)return;
  const{x,w,h}=dpr(canvas,360);
  const pad=chartPad(w,true);pad.t=24;pad.b=54;
  const plotW=w-pad.l-pad.r,plotH=h-pad.t-pad.b;
  const past=r.past&&r.past.dates.length?r.past:null;
  const leftLimit=past?past.dates[0]:r.startDate;
  const endDate=r.days[r.days.length-1];
  const totalDays=Math.max(1,daysBetween(leftLimit,endDate));
  const todayDn=daysBetween(leftLimit,today());
  const sameView=keepView&&fcView&&fcView.leftLimit===leftLimit&&fcView.endDate===endDate;
  if(!sameView){
    const futureDays=Math.max(1,totalDays-clampValue(todayDn,0,totalDays));
    fcView={leftDn:clampValue(todayDn,0,totalDays),windowDays:futureDays,totalDays,todayDn,leftLimit,endDate};
  }else{
    Object.assign(fcView,{totalDays,todayDn,leftLimit,endDate});
  }
  clampForecastView();
  fcView.plotLeft=pad.l;fcView.plotWidth=plotW;fcView.pxPerDay=plotW/fcView.windowDays;

  const dnOf=date=>daysBetween(leftLimit,date);
  const X=date=>pad.l+(dnOf(date)-fcView.leftDn)*fcView.pxPerDay;
  const inView=date=>{
    const day=dnOf(date);
    return day>=fcView.leftDn-1&&day<=fcView.leftDn+fcView.windowDays+1;
  };
  const values=[];
  /* Horizontal panning must not rescale Y; use the complete accessible timeline. */
  for(let i=0;i<r.days.length;i++)values.push(r.p10[i],r.p90[i]);
  if(past)for(const balance of past.balance)values.push(balance);
  for(const cp of state.checkpoints){
    const layer=cp.kind==='target'?'target':'checkpoint';
    if(cp.date>=leftLimit&&cp.date<=endDate&&fcLayers.has(layer))values.push(Number(cp.balance)||0);
  }
  if(!values.length)values.push(startBal);
  let minValue=Math.min(...values),maxValue=Math.max(...values);
  const rawSpan=maxValue-minValue;
  const margin=Math.max(rawSpan*.1,Math.max(Math.abs(minValue),Math.abs(maxValue),1)*.035,1);
  minValue-=margin;maxValue+=margin;
  const tickStep=niceForecastStep(maxValue-minValue);
  minValue=Math.floor(minValue/tickStep)*tickStep;
  maxValue=Math.ceil(maxValue/tickStep)*tickStep;
  const valueSpan=maxValue-minValue||tickStep;
  const Y=value=>h-pad.b-plotH*(value-minValue)/valueSpan;
  const small=w<420;

  x.fillStyle=COL.plot;x.fillRect(pad.l,pad.t,plotW,plotH);
  x.strokeStyle=COL.line;x.fillStyle=COL.muted;x.lineWidth=1;
  x.font=(small?'10px':'11px')+' Spline Sans Mono, monospace';
  const tickCount=Math.round(valueSpan/tickStep);
  for(let index=0;index<=tickCount;index++){
    const value=maxValue-tickStep*index;
    const cy=Y(value);
    x.beginPath();x.moveTo(pad.l,cy);x.lineTo(w-pad.r,cy);x.stroke();
    x.textAlign='right';x.fillText(small?fmtCompact(value):fmt(value),pad.l-5,cy+3);
  }

  const events=buildForecastEvents(r,leftLimit,endDate);
  x.save();x.beginPath();x.rect(pad.l,pad.t,plotW,plotH);x.clip();
  if(fcLayers.has('vacation')){
    x.fillStyle='rgba(102,133,154,.08)';
    for(const[date,items]of events)if(inView(date)&&items.some(item=>item.type==='vacation'))
      x.fillRect(X(date)-fcView.pxPerDay/2,pad.t,Math.max(1,fcView.pxPerDay),plotH);
  }

  const forecastIndices=[];
  for(let i=0;i<r.days.length;i++)if(inView(r.days[i]))forecastIndices.push(i);
  if(forecastIndices.length){
    x.beginPath();
    forecastIndices.forEach((index,position)=>{
      const cx=X(r.days[index]),cy=Y(r.p90[index]);
      position?x.lineTo(cx,cy):x.moveTo(cx,cy);
    });
    for(let position=forecastIndices.length-1;position>=0;position--){
      const index=forecastIndices[position];
      x.lineTo(X(r.days[index]),Y(r.p10[index]));
    }
    x.closePath();x.fillStyle=COL.band;x.fill();
  }

  if(minValue<=0&&maxValue>=0){
    x.setLineDash([3,4]);x.strokeStyle=COL.terra;x.lineWidth=1.2;
    x.beginPath();x.moveTo(pad.l,Y(0));x.lineTo(w-pad.r,Y(0));x.stroke();x.setLineDash([]);
  }
  if(startBal>=minValue&&startBal<=maxValue){
    x.setLineDash([4,5]);x.strokeStyle=COL.reference;x.lineWidth=1;
    x.beginPath();x.moveTo(pad.l,Y(startBal));x.lineTo(w-pad.r,Y(startBal));x.stroke();x.setLineDash([]);
  }
  if(past){
    const indices=[];
    for(let i=0;i<past.dates.length;i++)if(inView(past.dates[i]))indices.push(i);
    x.beginPath();indices.forEach((index,position)=>{
      const cx=X(past.dates[index]),cy=Y(past.balance[index]);
      position?x.lineTo(cx,cy):x.moveTo(cx,cy);
    });
    x.strokeStyle=COL.past;x.lineWidth=2.2;x.stroke();
  }
  x.beginPath();forecastIndices.forEach((index,position)=>{
    const cx=X(r.days[index]),cy=Y(r.mean[index]);
    position?x.lineTo(cx,cy):x.moveTo(cx,cy);
  });
  x.strokeStyle=COL.green;x.lineWidth=2.6;x.stroke();

  const meanByDate=new Map(r.days.map((date,index)=>[date,r.mean[index]]));
  /* Targets use the requested balance; the guide shows its distance from the modeled mean. */
  for(const cp of state.checkpoints){
    if(!inView(cp.date))continue;
    const target=cp.kind==='target';
    const type=target?'target':'checkpoint';
    if(!fcLayers.has(type))continue;
    const cx=X(cp.date),cy=Y(Number(cp.balance)||0);
    if(target&&meanByDate.has(cp.date)){
      x.strokeStyle=FC_EVENT_COLORS.target;x.setLineDash([2,3]);x.lineWidth=1;
      x.beginPath();x.moveTo(cx,cy);x.lineTo(cx,Y(meanByDate.get(cp.date)));x.stroke();x.setLineDash([]);
    }
    x.fillStyle=target?FC_EVENT_COLORS.target:FC_EVENT_COLORS.checkpoint;
    x.strokeStyle=COL.ink;x.lineWidth=1;
    x.beginPath();x.arc(cx,cy,target?5:4.5,0,Math.PI*2);x.fill();x.stroke();
  }

  const todayVisible=todayDn>=fcView.leftDn&&todayDn<=fcView.leftDn+fcView.windowDays;
  if(todayVisible){
    const cx=pad.l+(todayDn-fcView.leftDn)*fcView.pxPerDay;
    x.setLineDash([3,3]);x.strokeStyle=COL.ink;x.lineWidth=1;
    x.beginPath();x.moveTo(cx,pad.t);x.lineTo(cx,h-pad.b);x.stroke();x.setLineDash([]);
  }
  x.restore();

  if(todayVisible){
    const cx=pad.l+(todayDn-fcView.leftDn)*fcView.pxPerDay;
    x.fillStyle=COL.ink;x.textAlign='center';x.font=(small?'9px':'10px')+' Spline Sans Mono, monospace';
    x.fillText('сегодня',clampValue(cx,pad.l+24,w-pad.r-24),pad.t-7);
  }

  const railY=h-36;
  x.strokeStyle=COL.line;x.lineWidth=1;
  x.beginPath();x.moveTo(pad.l,railY);x.lineTo(w-pad.r,railY);x.stroke();
  x.fillStyle=COL.muted;x.textAlign='right';x.font='9px Spline Sans Mono, monospace';
  x.fillText('события',pad.l-5,railY+3);
  for(const[date,items]of events){
    if(!inView(date))continue;
    drawEventMarker(x,X(date),railY,items,fcView.pxPerDay);
  }

  x.fillStyle=COL.muted;x.textAlign='center';x.font=(small?'9px':'10px')+' Spline Sans Mono, monospace';
  const labelStep=chartLabelStep(w,Math.ceil(fcView.windowDays)+1);
  const firstDay=Math.ceil(fcView.leftDn);
  for(let day=firstDay;day<=fcView.leftDn+fcView.windowDays;day++){
    if((day-firstDay)%labelStep)continue;
    const cx=pad.l+(day-fcView.leftDn)*fcView.pxPerDay;
    x.fillText(dateRu(addDays(leftLimit,day)),cx,h-10);
  }

  const currency=esc(cur());
  const balanceByDate=new Map();
  if(past)for(let i=0;i<past.dates.length;i++)balanceByDate.set(past.dates[i],{
    kind:'past',value:past.balance[i],cy:Y(past.balance[i])
  });
  for(let i=0;i<r.days.length;i++)balanceByDate.set(r.days[i],{
    kind:'forecast',value:r.mean[i],low:r.p10[i],high:r.p90[i],cy:Y(r.mean[i])
  });
  const tipItems=[];
  for(const[date,balance]of balanceByDate){
    if(!inView(date))continue;
    tipItems.push({
      cx:X(date),cy:clampValue(balance.cy,pad.t,h-pad.b),
      html:forecastTooltip(date,balance,events.get(date)||[],currency)
    });
  }
  bindTip(canvas,tipItems,'point');
  bindForecastControls(canvas);
  updateForecastViewMeta();
}
