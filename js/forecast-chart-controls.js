const fcLayers=new Set(Object.keys(FC_EVENT_COLORS));
/* Day offsets keep the selected dates stable when the canvas width changes. */
let fcView=null;
let fcDrawFrame=0;

function clampValue(value,min,max){
  return Math.max(min,Math.min(max,value));
}

function updateForecastViewMeta(){
  if(!fcView)return;
  const from=addDays(fcView.leftLimit,Math.round(fcView.leftDn));
  const to=addDays(fcView.leftLimit,Math.round(fcView.leftDn+fcView.windowDays));
  const output=document.getElementById('fc-view-range');
  if(output)output.textContent=`${dateRu(from,true)} — ${dateRu(to,true)} · ${Math.round(fcView.windowDays)} дн.`;
  document.querySelectorAll('[data-fc-range]').forEach(button=>{
    const requested=button.dataset.fcRange==='all'
      ?fcView.totalDays
      :Number(button.dataset.fcRange);
    button.classList.toggle('active',Math.abs(fcView.windowDays-requested)<2);
  });
}

function clampForecastView(){
  if(!fcView)return;
  const minWindow=Math.min(7,fcView.totalDays);
  fcView.windowDays=clampValue(fcView.windowDays,minWindow,fcView.totalDays);
  fcView.leftDn=clampValue(fcView.leftDn,0,Math.max(0,fcView.totalDays-fcView.windowDays));
}

function setForecastWindow(windowDays,focusDn,focusRatio){
  if(!fcView)return;
  const ratio=focusRatio==null?.5:clampValue(focusRatio,0,1);
  const focus=focusDn==null?fcView.leftDn+fcView.windowDays/2:focusDn;
  fcView.windowDays=windowDays;
  clampForecastView();
  fcView.leftDn=focus-ratio*fcView.windowDays;
  clampForecastView();
  queueForecastDraw();
}

function focusForecastToday(windowDays){
  if(!fcView)return;
  fcView.windowDays=windowDays==null?fcView.windowDays:windowDays;
  clampForecastView();
  fcView.leftDn=fcView.todayDn-fcView.windowDays*.08;
  clampForecastView();
  queueForecastDraw();
}

function queueForecastDraw(){
  if(fcDrawFrame)return;
  fcDrawFrame=requestAnimationFrame(()=>{
    fcDrawFrame=0;
    if(lastFc)drawForecast('ch-fc',lastFc,lastFc.startBalance,true);
  });
}

function bindForecastControls(canvas){
  if(canvas._forecastControlsBound)return;
  canvas._forecastControlsBound=true;
  const shell=document.getElementById('fc-chart-shell');
  shell.addEventListener('click',event=>{
    const rangeButton=event.target.closest('[data-fc-range]');
    if(rangeButton&&fcView){
      const days=rangeButton.dataset.fcRange==='all'?fcView.totalDays:Number(rangeButton.dataset.fcRange);
      focusForecastToday(days);
      return;
    }
    const actionButton=event.target.closest('[data-fc-action]');
    if(actionButton&&fcView){
      const action=actionButton.dataset.fcAction;
      if(action==='today')focusForecastToday();
      else setForecastWindow(fcView.windowDays*(action==='zoom-in'?.72:1.38));
      return;
    }
    const layerButton=event.target.closest('[data-fc-layer]');
    if(layerButton){
      const layer=layerButton.dataset.fcLayer;
      if(fcLayers.has(layer))fcLayers.delete(layer);else fcLayers.add(layer);
      layerButton.setAttribute('aria-pressed',String(fcLayers.has(layer)));
      queueForecastDraw();
    }
  });

  canvas.addEventListener('wheel',event=>{
    if(!fcView)return;
    event.preventDefault();hideTip();
    const rect=canvas.getBoundingClientRect();
    const ratio=clampValue((event.clientX-rect.left-fcView.plotLeft)/fcView.plotWidth,0,1);
    const focus=fcView.leftDn+fcView.windowDays*ratio;
    setForecastWindow(fcView.windowDays*(event.deltaY<0?.82:1.22),focus,ratio);
  },{passive:false});

  canvas.addEventListener('keydown',event=>{
    if(!fcView)return;
    const step=Math.max(1,fcView.windowDays*.08);
    if(event.key==='ArrowLeft'||event.key==='ArrowRight'){
      fcView.leftDn+=event.key==='ArrowLeft'?-step:step;
      clampForecastView();queueForecastDraw();event.preventDefault();
    }else if(event.key==='+'||event.key==='='){
      setForecastWindow(fcView.windowDays*.72);event.preventDefault();
    }else if(event.key==='-'){
      setForecastWindow(fcView.windowDays*1.38);event.preventDefault();
    }else if(event.key==='Home'){
      focusForecastToday();event.preventDefault();
    }
  });

  let dragging=false,startX=0,startLeft=0;
  canvas.addEventListener('mousedown',event=>{
    if(event.button!==0||!fcView)return;
    dragging=true;startX=event.clientX;startLeft=fcView.leftDn;canvas.style.cursor='grabbing';
  });
  window.addEventListener('mousemove',event=>{
    if(!dragging||!fcView)return;
    const dx=event.clientX-startX;
    if(Math.abs(dx)>2){canvas._panning=true;hideTip()}
    fcView.leftDn=startLeft-dx/fcView.pxPerDay;
    clampForecastView();queueForecastDraw();
  });
  window.addEventListener('mouseup',()=>{
    if(!dragging)return;
    dragging=false;canvas.style.cursor='grab';
    setTimeout(()=>{canvas._panning=false},0);
  });

  let touchMode=null,touchStart=null;
  canvas.addEventListener('touchstart',event=>{
    if(!fcView)return;
    if(event.touches.length===2){
      const a=event.touches[0],b=event.touches[1];
      const midpoint=(a.clientX+b.clientX)/2-canvas.getBoundingClientRect().left;
      const ratio=clampValue((midpoint-fcView.plotLeft)/fcView.plotWidth,0,1);
      touchMode='pinch';
      touchStart={
        distance:Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY),
        windowDays:fcView.windowDays,
        focusDn:fcView.leftDn+fcView.windowDays*ratio,
        ratio
      };
      canvas._panning=true;hideTip();
    }else if(event.touches.length===1){
      const touch=event.touches[0];
      touchMode='pending';
      touchStart={x:touch.clientX,y:touch.clientY,leftDn:fcView.leftDn};
    }
  },{passive:true});
  canvas.addEventListener('touchmove',event=>{
    if(!fcView||!touchStart)return;
    if(touchMode==='pinch'&&event.touches.length===2){
      event.preventDefault();
      const a=event.touches[0],b=event.touches[1];
      const distance=Math.max(1,Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY));
      setForecastWindow(touchStart.windowDays*touchStart.distance/distance,touchStart.focusDn,touchStart.ratio);
      return;
    }
    if(event.touches.length!==1)return;
    const touch=event.touches[0];
    const dx=touch.clientX-touchStart.x,dy=touch.clientY-touchStart.y;
    if(touchMode==='pending'){
      if(Math.abs(dx)<6&&Math.abs(dy)<6)return;
      if(Math.abs(dx)<=Math.abs(dy)){touchMode='scroll';return}
      touchMode='pan';canvas._panning=true;hideTip();
    }
    if(touchMode==='pan'){
      event.preventDefault();
      fcView.leftDn=touchStart.leftDn-dx/fcView.pxPerDay;
      clampForecastView();queueForecastDraw();
    }
  },{passive:false});
  const endTouch=()=>{
    touchMode=null;touchStart=null;
    setTimeout(()=>{canvas._panning=false},50);
  };
  canvas.addEventListener('touchend',endTouch);
  canvas.addEventListener('touchcancel',endTouch);
  canvas.style.cursor='grab';
}
