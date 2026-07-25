/* Toast, tab switcher, canvas hover tooltip. */

/* ----- toast ----- */
let _toastT;
function toast(msg,timeoutMs){
  const t=document.getElementById('toast');
  t.textContent=msg;t.classList.add('show');
  clearTimeout(_toastT);
  _toastT=setTimeout(()=>t.classList.remove('show'),timeoutMs||3200);
}

/* ----- tabs (hash-based routing) ----- */
const TABS=['forecast','data','plan','work','charts','settings'];

function switchTab(name){
  if(!TABS.includes(name))name='forecast';
  document.querySelectorAll('#tabs button').forEach(button=>{
    const active=button.dataset.tab===name;
    button.classList.toggle('active',active);
    button.setAttribute('aria-selected',String(active));
    button.tabIndex=active?0:-1;
  });
  document.querySelectorAll('.panel').forEach(panel=>{
    const active=panel.id==='panel-'+name;
    panel.classList.toggle('active',active);
    panel.hidden=!active;
  });
  if(name==='charts')drawAllCharts();
  if(name==='work')renderWork();
  if(name==='plan')renderExpenses();
  if(name==='forecast')runForecast(true);
}

document.getElementById('tabs').addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  location.hash=b.dataset.tab;
});

window.addEventListener('hashchange',()=>switchTab(location.hash.slice(1)));

document.getElementById('tabs').addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  const buttons=[...document.querySelectorAll('#tabs button')];
  const current=buttons.indexOf(document.activeElement);
  if(current<0)return;
  let next=current;
  if(event.key==='ArrowLeft')next=(current-1+buttons.length)%buttons.length;
  if(event.key==='ArrowRight')next=(current+1)%buttons.length;
  if(event.key==='Home')next=0;
  if(event.key==='End')next=buttons.length-1;
  event.preventDefault();
  buttons[next].focus();
  location.hash=buttons[next].dataset.tab;
});

/* ----- chart hover tooltip ----- */
const tipEl = (()=>{const d=document.createElement('div');d.className='chart-tip';document.body.appendChild(d);return d})();

function hideTip(){tipEl.style.opacity='0'}

function showTip(cx,cy,html){
  tipEl.innerHTML=html;tipEl.style.opacity='1';
  const r=tipEl.getBoundingClientRect();
  let left=cx-r.width/2, top=cy-r.height-12;
  if(top<4)top=cy+16;
  left=Math.max(4,Math.min(window.innerWidth-r.width-4,left));
  tipEl.style.left=left+'px';tipEl.style.top=top+'px';
}

function bindTip(canvas,items,kind){
  canvas._items=items;canvas._kind=kind;
  if(canvas._tipBound)return;
  canvas._tipBound=true;
  function handle(clientX,clientY){
    if(canvas._panning)return hideTip();
    const rect=canvas.getBoundingClientRect();
    const mx=clientX-rect.left, my=clientY-rect.top;
    const its=canvas._items;
    if(!its||!its.length)return hideTip();
    let hit=null;
    if(canvas._kind==='bar'){
      hit=its.find(it=>mx>=it.x&&mx<=it.x+it.w)||null;
    }else{
      let best=Infinity;
      for(const it of its){const d=Math.abs(it.cx-mx);if(d<best){best=d;hit=it}}
      if(best>40)hit=null;
    }
    if(!hit)return hideTip();
    const tipY=canvas._kind==='bar'?Math.max(hit.cy,my-10):hit.cy;
    showTip(rect.left+hit.cx,rect.top+tipY,hit.html);
  }
  canvas.addEventListener('mousemove',e=>handle(e.clientX,e.clientY));
  canvas.addEventListener('mouseleave',hideTip);
  canvas.addEventListener('touchstart',e=>{const t=e.touches[0];if(t)handle(t.clientX,t.clientY)},{passive:true});
  canvas.addEventListener('touchmove',e=>{const t=e.touches[0];if(t)handle(t.clientX,t.clientY)},{passive:true});
  canvas.addEventListener('touchend',()=>setTimeout(hideTip,1500));
}
