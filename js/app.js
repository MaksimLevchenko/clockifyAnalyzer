/* Tab handlers, render functions, init.
   Depends on core.js, state.js, ui.js, charts.js. */

/* ========================= FILE I/O ========================= */
function readFile(input,cb){
  const f=input.files[0];if(!f)return;
  const r=new FileReader();r.onload=()=>cb(r.result);
  r.readAsText(f);input.value='';
}

const PDFJS_URL='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER_URL='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
let pdfJsPromise=null;

function loadPdfJs(){
  if(window.pdfjsLib){
    window.pdfjsLib.GlobalWorkerOptions.workerSrc=PDFJS_WORKER_URL;
    return Promise.resolve(window.pdfjsLib);
  }
  if(pdfJsPromise)return pdfJsPromise;
  pdfJsPromise=new Promise((resolve,reject)=>{
    const s=document.createElement('script');
    s.src=PDFJS_URL;s.async=true;
    s.onload=()=>{
      if(!window.pdfjsLib){reject(new Error('PDF.js не загрузился'));return}
      window.pdfjsLib.GlobalWorkerOptions.workerSrc=PDFJS_WORKER_URL;
      resolve(window.pdfjsLib);
    };
    s.onerror=()=>{pdfJsPromise=null;reject(new Error('не удалось загрузить PDF.js для чтения PDF'))};
    document.head.appendChild(s);
  });
  return pdfJsPromise;
}

function readBlob(file,kind){
  return new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onload=()=>resolve(r.result);
    r.onerror=()=>reject(new Error('не удалось прочитать файл'));
    if(kind==='arrayBuffer')r.readAsArrayBuffer(file);
    else r.readAsText(file);
  });
}

function isPdfFile(file){
  const name=String(file.name||'').toLowerCase();
  return file.type==='application/pdf'||name.endsWith('.pdf');
}

async function reportFileToEntries(file){
  if(!isPdfFile(file))return rowsToEntries(parseCSV(await readBlob(file,'text')));
  const pdfjs=await loadPdfJs();
  const doc=await pdfjs.getDocument({data:new Uint8Array(await readBlob(file,'arrayBuffer'))}).promise;
  const pages=[];
  for(let p=1;p<=doc.numPages;p++){
    const page=await doc.getPage(p);
    const text=await page.getTextContent();
    pages.push(text.items);
  }
  const es=clockifyPdfPagesToEntries(pages,{fallbackRate:state.rate});
  if(!es.length)throw new Error('в PDF не найдены записи Clockify');
  return es;
}

async function handleReportImport(input,mode){
  const f=input.files[0];if(!f)return;
  input.value='';
  try{
    const es=await reportFileToEntries(f);
    if(mode==='replace'){
      const oldRate=state.rate;
      state.entries=es;state.rate=detectRate(es)||oldRate;
      syncInputs();afterDataChange();
      toast('Импортировано записей: '+es.length+' (старые заменены)');
      return;
    }
    const res=mergeEntries(state.entries,es);
    state.entries=res.entries;
    if(!state.rate)state.rate=detectRate(state.entries);
    syncInputs();afterDataChange();
    let msg='Догружено: +'+res.added+' новых';
    if(res.replaced)msg+=', заменено '+res.replaced+' (сдвиг времени)';
    msg+='. Всего: '+state.entries.length;
    if(res.missing)msg+='. Вне экспорта оставлено: '+res.missing;
    toast(msg);
  }catch(e){toast((mode==='replace'?'Ошибка импорта: ':'Ошибка догрузки: ')+e.message)}
}

document.getElementById('file-import').addEventListener('change',function(){handleReportImport(this,'replace')});
document.getElementById('file-merge').addEventListener('change',function(){handleReportImport(this,'merge')});

document.getElementById('btn-export').addEventListener('click',()=>{
  const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download='finance_state.json';a.click();
  toast('Файл finance_state.json сохранён');
});

document.getElementById('file-state').addEventListener('change',function(){readFile(this,txt=>{
  try{state=migrate(JSON.parse(txt));syncInputs();afterDataChange();toast('Состояние загружено из файла')}
  catch(e){toast('Ошибка: '+e.message)}
})});

document.getElementById('btn-reset').addEventListener('click',()=>{
  if(!confirm('Удалить все данные безвозвратно?'))return;
  state=migrate(null);
  syncInputs();afterDataChange();toast('Данные сброшены');
});

/* ========================= DATA TAB (params + stats + ticker) ========================= */
['rate','currency','halfLife','taxRate'].forEach(k=>{
  const el=document.getElementById('in-'+k);
  if(!el)return;
  el.addEventListener('change',()=>{
    if(k==='rate')state.rate=parseFloat(el.value)||0;
    if(k==='currency')state.currency=el.value||'USD';
    if(k==='halfLife')state.halfLife=Math.max(7,Math.min(365,parseInt(el.value)||60));
    if(k==='taxRate')state.taxRate=Math.max(0,Math.min(100,parseFloat(el.value)||0));
    saveState();renderTicker();renderDataStats();renderCheckpoints();renderIncomes();renderExpenses();renderActualExpenses();
    if(document.getElementById('panel-forecast').classList.contains('active'))runForecast(true);
  });
});

function syncInputs(){
  document.getElementById('in-rate').value=state.rate;
  document.getElementById('in-currency').value=state.currency;
  const hl=document.getElementById('in-halfLife');if(hl)hl.value=state.halfLife;
  const tr=document.getElementById('in-taxRate');if(tr)tr.value=state.taxRate;
  if(!document.getElementById('fc-end').value)
    document.getElementById('fc-end').value=addDays(anchorDate(),90);
  const cpD=document.getElementById('cp-date');if(!cpD.value)cpD.value=today();
  const incD=document.getElementById('inc-date');if(!incD.value)incD.value=today();
}

function renderDataStats(){
  const box=document.getElementById('data-stats');const es=state.entries;
  if(!es.length){
    box.innerHTML='<div class="empty"><div class="big">Нет данных</div>Импортируй отчёт Clockify (CSV или PDF), чтобы начать.</div>';
    return;
  }
  const daily=dailyAgg(es);
  const totalH=es.reduce((a,e)=>a+e.hours,0);
  const totalA=es.reduce((a,e)=>a+e.hours*e.rate,0);
  box.innerHTML=`
    <div class="stat"><div class="k">Записей</div><div class="v">${es.length}</div></div>
    <div class="stat"><div class="k">Рабочих дней</div><div class="v">${daily.length}</div></div>
    <div class="stat"><div class="k">Всего часов</div><div class="v">${totalH.toFixed(1)}</div></div>
    <div class="stat"><div class="k">Доход всего</div><div class="v green">${fmt(totalA)} ${esc(cur())}</div></div>
    <div class="stat"><div class="k">Период</div><div class="v" style="font-size:14px">${esc(es[0].date)} → ${esc(es[es.length-1].date)}</div></div>`;
}

function renderTicker(){
  const es=state.entries;const t=document.getElementById('ticker');
  if(!es.length&&!state.checkpoints.length){t.textContent='нет данных';return}
  const totalA=es.reduce((a,e)=>a+e.hours*e.rate,0);
  const c=esc(cur());const bal=currentBalance();const ad=anchorDate();
  t.innerHTML=`баланс <b>${fmt(bal)} ${c}</b> <span style="color:var(--faint)">на ${esc(ad.split('-').reverse().join('.'))}</span> · доход <b>${fmt(totalA)} ${c}</b> · ставка <b>${fmt(state.rate)}</b>`;
}

/* ========================= WORK TAB ========================= */
(function initWeekdayPicker(){
  const box=document.getElementById('ge-wd');
  WD.forEach((n,i)=>{
    const l=document.createElement('label');
    l.innerHTML=`<input type="checkbox" value="${i}">${n}`;
    l.querySelector('input').addEventListener('change',e=>l.classList.toggle('on',e.target.checked));
    box.appendChild(l);
  });
})();

function geWeekdays(){return[...document.querySelectorAll('#ge-wd input:checked')].map(x=>+x.value)}

function geFilterMask(es){
  const from=document.getElementById('ge-from').value,to=document.getElementById('ge-to').value;
  const wds=geWeekdays(),proj=document.getElementById('ge-proj').value.trim();
  return es.map(e=>{
    if(from&&e.date<from)return false;
    if(to&&e.date>to)return false;
    if(wds.length&&!wds.includes(wd(e.date)))return false;
    if(proj&&e.project!==proj)return false;
    return true;
  });
}

document.getElementById('ge-preview').addEventListener('click',()=>{
  const n=geFilterMask(state.entries).filter(Boolean).length;
  toast('Под фильтр попадает записей: '+n);
});

document.getElementById('ge-apply').addEventListener('click',()=>{
  const act=document.getElementById('ge-act').value;
  const val=parseFloat(document.getElementById('ge-val').value)||0;
  const mask=geFilterMask(state.entries);let n=0;
  if(act==='delete'){
    state.entries=state.entries.filter((e,i)=>{if(mask[i]){n++;return false}return true});
  }else{
    state.entries.forEach((e,i)=>{
      if(!mask[i])return;n++;
      if(act==='set_rate')e.rate=val;
      else if(act==='set_hours')e.hours=val;
      else if(act==='scale_hours')e.hours=e.hours*val;
    });
  }
  if(act==='set_rate')state.rate=detectRate(state.entries);
  syncInputs();afterDataChange();toast('Изменено записей: '+n);
});

document.getElementById('ad-add').addEventListener('click',()=>{
  const d=document.getElementById('ad-date').value;if(!d){toast('Укажи дату');return}
  state.entries.push({
    date:d,start:d+'T00:00:00',
    project:document.getElementById('ad-proj').value,description:'',
    hours:parseFloat(document.getElementById('ad-hours').value)||0,
    rate:parseFloat(document.getElementById('ad-rate').value)||0
  });
  state.entries.sort(byStart);afterDataChange();toast('Запись добавлена');
});

function renderWork(){
  const es=state.entries;const tb=document.querySelector('#work-table tbody');
  const totalH=es.reduce((a,e)=>a+e.hours,0),totalA=es.reduce((a,e)=>a+e.hours*e.rate,0);
  document.getElementById('work-summary').innerHTML=es.length
    ?`Всего ${es.length} записей · ${totalH.toFixed(1)} ч · <b>${fmt(totalA)} ${esc(cur())}</b>. Показаны последние 50.`
    :'Записей нет.';
  const N=es.length, visible=Math.min(50,N);
  const html=[];
  for(let i=N-1;i>=N-visible;i--){
    const e=es[i];
    html.push(`<tr>
      <td>${esc(e.date.split('-').reverse().join('.'))}</td>
      <td>${esc(e.project)}</td>
      <td class="num">${e.hours.toFixed(2)}</td>
      <td class="num">${fmt(e.rate)}</td>
      <td class="num">${fmt(e.hours*e.rate)}</td>
      <td><button class="btn ghost sm" data-eidx="${i}" title="Редактировать / удалить">✎</button></td>
    </tr>`);
  }
  tb.innerHTML=html.join('');
  tb.querySelectorAll('[data-eidx]').forEach(b=>b.addEventListener('click',()=>openEntryDialog(+b.dataset.eidx)));
  if(!document.getElementById('ad-date').value)document.getElementById('ad-date').value=today();
  if(!document.getElementById('ad-rate').value||+document.getElementById('ad-rate').value===0)
    document.getElementById('ad-rate').value=state.rate;
}

/* ----- entry edit/delete dialog ----- */
let _editIdx=-1;
const _edDlg=document.getElementById('entry-dialog');

function openEntryDialog(idx){
  const e=state.entries[idx];if(!e){toast('Запись не найдена');return}
  _editIdx=idx;
  document.getElementById('ed-meta').textContent=`Создано ${e.start||''}`;
  document.getElementById('ed-date').value=e.date;
  document.getElementById('ed-proj').value=e.project||'';
  document.getElementById('ed-hours').value=e.hours;
  document.getElementById('ed-rate').value=e.rate;
  document.getElementById('ed-desc').value=e.description||'';
  _edDlg.showModal();
}

document.getElementById('ed-cancel').addEventListener('click',()=>_edDlg.close());

document.getElementById('ed-save').addEventListener('click',()=>{
  if(_editIdx<0)return;
  const e=state.entries[_editIdx];if(!e){_edDlg.close();return}
  const newDate=document.getElementById('ed-date').value;
  if(!newDate){toast('Укажи дату');return}
  const origTime=(e.start||'').split('T')[1]||'00:00:00';
  e.date=newDate;
  e.start=newDate+'T'+origTime;
  e.project=document.getElementById('ed-proj').value;
  e.hours=parseFloat(document.getElementById('ed-hours').value)||0;
  e.rate=parseFloat(document.getElementById('ed-rate').value)||0;
  e.description=document.getElementById('ed-desc').value;
  state.entries.sort(byStart);
  _editIdx=-1;_edDlg.close();
  afterDataChange();
  toast('Запись изменена');
});

document.getElementById('ed-delete').addEventListener('click',()=>{
  if(_editIdx<0)return;
  if(!confirm('Удалить эту запись?'))return;
  state.entries.splice(_editIdx,1);
  _editIdx=-1;_edDlg.close();
  afterDataChange();
  toast('Запись удалена');
});

/* ========================= EXPENSES TAB ========================= */
document.getElementById('ex-kind').addEventListener('change',function(){
  const k=this.value;
  document.getElementById('ex-day-field').style.display=k==='monthly'?'':'none';
  document.getElementById('ex-date-field').style.display=k==='once'?'':'none';
  /* Growth rate is meaningless for ONCE — known amount on known date.
     Hide the input to avoid user confusion. */
  const grField=document.getElementById('ex-grow-field');
  if(grField)grField.style.display=k==='once'?'none':'';
});

document.getElementById('ex-add').addEventListener('click',()=>{
  const kind=document.getElementById('ex-kind').value;
  const name=document.getElementById('ex-name').value||'Расход';
  const amt=parseFloat(document.getElementById('ex-amt').value)||0;
  const grEl=document.getElementById('ex-grow');
  const growthRate=grEl?Math.max(-50,Math.min(100,parseFloat(grEl.value)||0)):0;
  const e={kind,name,amount:amt,growthRate};
  if(kind==='monthly'){
    e.day=Math.min(28,Math.max(1,parseInt(document.getElementById('ex-day').value)||1));
  }else if(kind==='daily'){
    /* nothing extra — sum-per-month already in amount */
  }else{
    const d=document.getElementById('ex-date').value;
    if(!d){toast('Укажи дату');return}
    e.date=d;
  }
  state.expenses.push(e);saveState();renderExpenses();renderActualExpenses();
  if(document.getElementById('panel-forecast').classList.contains('active'))runForecast(true);
  toast('Расход добавлен');
});

function expenseKindLabel(k){return k==='monthly'?'ежемес.':k==='daily'?'ежедн.':'разовый'}
function expenseKindPill(k){return k==='monthly'?'m':k==='daily'?'d':'o'}
function expenseWhen(e){
  if(e.kind==='monthly')return e.day+' число';
  if(e.kind==='daily')return `каждый день · ≈${fmt(Number(e.amount)/30)} ${esc(cur())}/день`;
  return esc(e.date.split('-').reverse().join('.'));
}

function renderExpenses(){
  const tb=document.querySelector('#ex-table tbody');const ex=state.expenses;const c=esc(cur());
  let mo=0,dl=0;
  ex.forEach(e=>{
    if(e.kind==='monthly')mo+=Number(e.amount);
    else if(e.kind==='daily')dl+=Number(e.amount);
  });
  const total=mo+dl;
  document.getElementById('ex-summary').innerHTML=ex.length
    ?`Ежемесячные расходы: <b>${fmt(total)} ${c}/мес</b>`+(dl?` <small class="note">(из них ${fmt(dl)} равномерно по дням)</small>`:'')
    :'Расходов пока нет.';
  tb.innerHTML=ex.map((e,i)=>{
    const g=Number(e.growthRate||0);
    const isOnce=e.kind==='once';
    const grLabel=!isOnce&&g!==0?` <span class="note">· ${g>0?'+':''}${g.toFixed(1)}%/год</span>`:'';
    const grCell=isOnce
      ?`<span class="note" title="Разовая трата не индексируется">—</span>`
      :`<input type="number" step="0.5" value="${g}" data-exgrow="${i}" style="width:70px" title="Годовой рост, %">`;
    return `<tr>
      <td><span class="pill ${expenseKindPill(e.kind)}">${expenseKindLabel(e.kind)}</span></td>
      <td>${esc(e.name)}${grLabel}</td>
      <td class="num">${fmt(e.amount)} ${c}${e.kind==='daily'?' /мес':''}</td>
      <td>${expenseWhen(e)}</td>
      <td>${grCell}</td>
      <td><button class="btn terra sm" data-del="${i}">удалить</button></td>
    </tr>`;
  }).join('');
  tb.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click',()=>{
    state.expenses.splice(+b.dataset.del,1);saveState();renderExpenses();renderActualExpenses();
    if(document.getElementById('panel-forecast').classList.contains('active'))runForecast(true);
  }));
  tb.querySelectorAll('[data-exgrow]').forEach(inp=>inp.addEventListener('change',()=>{
    const i=+inp.dataset.exgrow;
    state.expenses[i].growthRate=Math.max(-50,Math.min(100,parseFloat(inp.value)||0));
    saveState();renderExpenses();
    if(document.getElementById('panel-forecast').classList.contains('active'))runForecast(true);
  }));
}

function renderActualExpenses(){
  const card=document.getElementById('card-actual-expenses');
  if(!card)return;
  const cf=cashFlowFromCheckpoints(state.entries,state.expenses,state.incomes,state.checkpoints,{
    excluded:state.cashflowExcluded,taxRate:state.taxRate,fallbackRate:state.rate,
    payDays:state.payDays,payDayActuals:state.payDayActuals
  });
  if(!cf){card.style.display='none';return}
  card.style.display='';
  const c=esc(cur());
  const ae=autoExpenseEstimate(cf);
  const manualMonthly=state.expenses.reduce((s,e)=>{
    if(e.kind==='monthly')return s+Number(e.amount);
    if(e.kind==='daily')return s+Number(e.amount);
    return s;
  },0);
  const sm=document.getElementById('actual-expenses-summary');
  const used=cf.intervalsUsed||0;
  const rec=cf.monthlyRecent;
  const weak=used<3;
  let est='';
  if(ae){
    const srcLbl=ae.source==='recent90'?'по последним 90 дн.':ae.source==='robust'?'устойчивая (винзоризация)':'среднее';
    est=` · авто-оценка для прогноза: <b>${fmt(ae.value)} ${c}/мес</b> ±${fmt(ae.sigma)} σ <span class="note">(${srcLbl})</span>`;
  }
  const cmp=manualMonthly>0
    ?` · введено вручную: <b>${fmt(manualMonthly)} ${c}/мес</b>`
    :``;
  const taxNote=cf.taxRate?` · доход в расчёте net после ${(cf.taxRate*100).toFixed(0)}% налога`:'';
  const warn=weak
    ?`<div class="hint" style="color:#b1462c;margin-top:6px"><b>⚠ Слабый сигнал:</b> всего ${used} интервал(ов). Авто-оценка ненадёжна — добавь хотя бы 3 чекпоинта с разрывом в неделю-месяц, чтобы получить устойчивую статистику.</div>`
    :'';
  const hasEntries=state.entries.length>0;
  const noPdWarn=hasEntries&&(!state.payDays||!state.payDays.length)
    ?`<div class="hint" style="color:#b1462c;margin-top:6px"><b>⚠ Не настроены дни выплаты:</b> расчёт считает, что доход начисляется ежедневно. Если зарплата приходит раз в месяц/полмесяца, неоплаченная работа в Clockify ошибочно засчитывается как «потрачено» — авто-расход завышен. Настрой <b>Дни выплаты</b> выше, чтобы получить корректную оценку.</div>`
    :'';
  sm.innerHTML=`Реальный отток: <b>${fmt(cf.monthlyNetOut||0)} ${c}/мес</b> по ${used} интервалу(ам)`
    +(rec!=null?` · последние 90 дн.: <b>${fmt(rec)} ${c}/мес</b>`:'')+cmp+taxNote+est+warn+noPdWarn;
  const tb=document.querySelector('#actual-expenses-table tbody');
  tb.innerHTML=cf.intervals.map(it=>{
    const exKey=it.from+'|'+it.to;
    const exTitle=it.excluded?'Включить интервал в расчёт':'Исключить интервал (например, разовая большая покупка)';
    const exBtn=`<button class="btn ${it.excluded?'green':'ghost'} sm" data-exintv="${esc(exKey)}" title="${exTitle}">${it.excluded?'✓ вкл':'×'}</button>`;
    const rowOpacity=it.excluded?'opacity:0.45':'';
    return `<tr style="${rowOpacity}">
      <td>${esc(dateRu(it.from))} → ${esc(dateRu(it.to))}</td>
      <td class="num">${it.days}</td>
      <td class="num">${fmt(it.earned)}</td>
      <td class="num">${fmt(it.explicitIn)}</td>
      <td class="num">${fmt(it.explicitOut)}</td>
      <td class="num" style="color:${it.delta>=0?'#2f6b4f':'#b1462c'}">${it.delta>=0?'+':''}${fmt(it.delta)}</td>
      <td class="num"><b>${fmt(it.netOut)}</b></td>
      <td class="num" style="color:${it.implicitOut>0?'#a9792a':'#736a58'}">${it.implicitOut>=0?'':'−'}${fmt(Math.abs(it.implicitOut))}</td>
      <td>${exBtn}</td>
    </tr>`;
  }).join('');
  tb.querySelectorAll('[data-exintv]').forEach(b=>b.addEventListener('click',()=>{
    const key=b.dataset.exintv;const[from,to]=key.split('|');
    const idx=state.cashflowExcluded.findIndex(x=>x.from===from&&x.to===to);
    if(idx>=0)state.cashflowExcluded.splice(idx,1);
    else state.cashflowExcluded.push({from,to});
    saveState();renderActualExpenses();
    if(document.getElementById('panel-forecast').classList.contains('active'))runForecast(true);
  }));
  const clearBtn=document.getElementById('clear-excluded');
  if(clearBtn){
    clearBtn.style.display=state.cashflowExcluded.length?'':'none';
    clearBtn.onclick=()=>{
      state.cashflowExcluded=[];saveState();renderActualExpenses();
      if(document.getElementById('panel-forecast').classList.contains('active'))runForecast(true);
      toast('Все исключения сняты');
    };
  }
}

function renderVacations(){
  const list=document.getElementById('vac-list');
  if(!list)return;
  const vs=[...state.vacations].sort((a,b)=>a.from<b.from?-1:1);
  if(!vs.length){
    list.innerHTML='<small class="note">Нет добавленных отпусков — модель считает, что ты работаешь по обычному графику. Добавь даты отпуска, чтобы прогноз не завышал доход в эти дни.</small>';
    return;
  }
  const c=esc(cur());
  list.innerHTML=vs.map((v,i)=>`<div class="vac-row">
    <span><b>${esc(dateRu(v.from,true))} → ${esc(dateRu(v.to,true))}</b>${v.name?` · ${esc(v.name)}`:''}</span>
    <button class="btn terra sm" data-vacdel="${i}">×</button>
  </div>`).join('');
  list.querySelectorAll('[data-vacdel]').forEach(b=>b.addEventListener('click',()=>{
    state.vacations.splice(+b.dataset.vacdel,1);
    saveState();renderVacations();
    if(document.getElementById('panel-forecast').classList.contains('active'))runForecast(true);
  }));
}

/* ========================= PAY DAYS ========================= */
function afterPayDaysChange(){
  renderActualExpenses();
  if(document.getElementById('panel-forecast').classList.contains('active'))runForecast(true);
}

document.getElementById('pd-add').addEventListener('click',()=>{
  if(state.payDays.length>=4){toast('Максимум 4 дня зарплаты');return}
  const last=state.payDays.length?state.payDays[state.payDays.length-1]:0;
  const next=state.payDays.length?Math.min(28,last+10):5;
  state.payDays.push(next);
  saveState();renderPayDays();renderPayDayActuals();afterPayDaysChange();
});

function renderPayDays(){
  const list=document.getElementById('pd-list');
  const pds=state.payDays.slice().sort((a,b)=>a-b);
  state.payDays=pds;
  if(!pds.length){list.innerHTML='<small class="note">Не настроены — доход начисляется ежедневно (как раньше).</small>';}
  else{
    list.innerHTML=pds.map((d,i)=>`<div class="field"><label>День зп ${i+1}</label><div style="display:flex;gap:6px;align-items:center"><input type="number" min="1" max="28" value="${d}" data-pdi="${i}" style="width:80px" title="День зп — отсечка часов; деньги по умолчанию приходят в этот же день"><button class="btn terra sm" data-pddel="${i}">×</button></div></div>`).join('');
    list.querySelectorAll('[data-pdi]').forEach(inp=>inp.addEventListener('change',()=>{
      const i=+inp.dataset.pdi;
      state.payDays[i]=Math.max(1,Math.min(28,parseInt(inp.value)||1));
      saveState();renderPayDays();afterPayDaysChange();
    }));
    list.querySelectorAll('[data-pddel]').forEach(b=>b.addEventListener('click',()=>{
      state.payDays.splice(+b.dataset.pddel,1);
      saveState();renderPayDays();renderPayDayActuals();afterPayDaysChange();
    }));
  }
  document.getElementById('pd-add').disabled=pds.length>=4;
}

/* ----- actual pay dates (overrides for early/late salary) ----- */
document.getElementById('pda-add').addEventListener('click',()=>{
  if(!state.payDays.length){toast('Сначала задай дни зп');return}
  const pInp=document.getElementById('pda-payout'),aInp=document.getElementById('pda-accrual');
  const payout=pInp.value,accrual=aInp.value||null;
  if(!payout){toast('Укажи день выплаты (приход денег)');return}
  if(accrual&&accrual>payout){toast('День учёта часов не может быть позже дня выплаты');return}
  if(state.payDayActuals.some(a=>a.payout===payout)){toast('Эта дата выплаты уже отмечена');return}
  state.payDayActuals.push({payout,accrual});
  pInp.value='';aInp.value='';
  saveState();renderPayDayActuals();renderActualExpenses();
  if(document.getElementById('panel-forecast').classList.contains('active'))runForecast(true);
});

function renderPayDayActuals(){
  const list=document.getElementById('pda-list');
  if(!list)return;
  const pInp=document.getElementById('pda-payout'),aInp=document.getElementById('pda-accrual'),addBtn=document.getElementById('pda-add');
  const hasSchedule=state.payDays.length>0;
  if(pInp)pInp.disabled=!hasSchedule;
  if(aInp)aInp.disabled=!hasSchedule;
  if(addBtn)addBtn.disabled=!hasSchedule;
  if(!hasSchedule){list.innerHTML='<small class="note">Сначала задай <b>дни зп</b> выше — без расписания отметить фактическую дату нельзя.</small>';return}
  const acts=[...state.payDayActuals].sort((x,y)=>x.payout<y.payout?-1:1);
  state.payDayActuals=acts;
  if(!acts.length){list.innerHTML='<small class="note">Нет отмеченных дат — выплаты считаются по дням зп выше.</small>';return}
  list.innerHTML=acts.map((a,i)=>`<div class="field"><label>Выплата ${i+1}: приход → учёт часов</label><div style="display:flex;gap:6px;align-items:center"><input type="date" value="${esc(a.payout)}" data-pdaip="${i}" style="width:150px" title="День прихода денег (может быть в будущем)"><span class="note">→</span><input type="date" value="${esc(a.accrual||'')}" data-pdaia="${i}" style="width:150px" title="День учёта часов (опц., пусто = по дню зп)"><button class="btn terra sm" data-pdadel="${i}">×</button></div></div>`).join('');
  /* deps() обновляет состояние и зависимые виды, но НЕ перерисовывает список —
     иначе при посегментном вводе даты поле пересоздаётся и ввод сбрасывается. */
  const deps=()=>{saveState();renderActualExpenses();if(document.getElementById('panel-forecast').classList.contains('active'))runForecast(true)};
  list.querySelectorAll('[data-pdaip]').forEach(inp=>inp.addEventListener('change',()=>{
    const i=+inp.dataset.pdaip,v=inp.value;
    if(!v)return; // дату ещё вводят
    state.payDayActuals[i].payout=v;deps();
  }));
  list.querySelectorAll('[data-pdaia]').forEach(inp=>inp.addEventListener('change',()=>{
    const i=+inp.dataset.pdaia;
    state.payDayActuals[i].accrual=inp.value||null;deps();
  }));
  list.querySelectorAll('[data-pdadel]').forEach(b=>b.addEventListener('click',()=>{
    state.payDayActuals.splice(+b.dataset.pdadel,1);deps();renderPayDayActuals();
  }));
}

/* ========================= CHECKPOINTS ========================= */
document.getElementById('cp-add').addEventListener('click',()=>{
  const d=document.getElementById('cp-date').value;if(!d){toast('Укажи дату');return}
  const a=parseFloat(document.getElementById('cp-amt').value);
  if(!isFinite(a)){toast('Укажи сумму');return}
  const kindEl=document.getElementById('cp-kind');
  const kind=kindEl?kindEl.value:(d>today()?'target':'actual');
  state.checkpoints=state.checkpoints.filter(c=>c.date!==d);
  state.checkpoints.push({date:d,balance:a,kind});
  saveState();renderCheckpoints();renderActualExpenses();renderTicker();renderDataStats();
  if(!document.getElementById('fc-end').value)
    document.getElementById('fc-end').value=addDays(anchorDate(),90);
  if(document.getElementById('panel-forecast').classList.contains('active'))runForecast(true);
  toast('Чекпоинт сохранён ('+(kind==='target'?'целевой':'фактический')+')');
});

function renderCheckpoints(){
  const tb=document.querySelector('#cp-table tbody');
  const sm=document.getElementById('cp-summary');
  const cps=[...state.checkpoints].sort((a,b)=>a.date<b.date?-1:1);
  const c=esc(cur());
  if(!cps.length){
    sm.innerHTML='Чекпоинтов пока нет. Добавь хотя бы один — это стартовая точка прогноза.';
    tb.innerHTML='';return;
  }
  const an=anchorCp();
  const calibActual=cps.filter(x=>x.date>an.date&&(x.kind||'actual')==='actual').length;
  const targets=cps.filter(x=>x.kind==='target').length;
  sm.innerHTML=`Старт прогноза: <b>${esc(an.date.split('-').reverse().join('.'))}</b> · <b>${fmt(an.balance)} ${c}</b>`
    +(calibActual?` · калибровочных факт. точек: <b>${calibActual}</b>`:'')
    +(targets?` · целевых: <b>${targets}</b> <span class="note">(только маркер, не калибруют)</span>`:'');
  tb.innerHTML=cps.map(cp=>{
    const k=cp.kind||'actual';
    const pill=cp.date===an.date?'<span class="pill m">старт</span>'
      :k==='target'?'<span class="pill o">цель</span>'
      :cp.date>an.date?'<span class="pill o">калибр.</span>'
      :'<span class="pill">прошлое</span>';
    const id=esc(cp.date);
    const balVal=Number(cp.balance)||0;
    const dateInp=`<input type="date" value="${id}" data-cpdate="${id}" style="font-size:12px;padding:2px 4px">`;
    const balInp=`<input type="number" step="0.01" value="${balVal}" data-cpbal="${id}" style="width:110px;text-align:right">`;
    const kindOpt=`<select class="cp-kind-sel" data-cpkind="${id}" style="font-size:11px;padding:2px 4px"><option value="actual"${k==='actual'?' selected':''}>факт</option><option value="target"${k==='target'?' selected':''}>цель</option></select>`;
    return `<tr>
      <td>${dateInp} ${pill}</td>
      <td class="num">${balInp} ${c}</td>
      <td>${kindOpt}</td>
      <td><button class="btn terra sm" data-cpdel="${id}">удалить</button></td>
    </tr>`;
  }).join('');
  tb.querySelectorAll('[data-cpdel]').forEach(b=>b.addEventListener('click',()=>{
    const d=b.dataset.cpdel;
    state.checkpoints=state.checkpoints.filter(c=>c.date!==d);
    pruneStaleExclusions();
    saveState();renderCheckpoints();renderActualExpenses();renderTicker();renderDataStats();
    if(document.getElementById('panel-forecast').classList.contains('active'))runForecast(true);
  }));
  tb.querySelectorAll('[data-cpkind]').forEach(s=>s.addEventListener('change',()=>{
    const d=s.dataset.cpkind;const cp=state.checkpoints.find(c=>c.date===d);
    if(cp){cp.kind=s.value;pruneStaleExclusions();saveState();renderCheckpoints();renderActualExpenses();
      if(document.getElementById('panel-forecast').classList.contains('active'))runForecast(true);}
  }));
  tb.querySelectorAll('[data-cpdate]').forEach(inp=>inp.addEventListener('change',()=>{
    const oldD=inp.dataset.cpdate, newD=inp.value;
    if(!newD||newD===oldD)return; // дату ещё вводят
    if(state.checkpoints.some(c=>c.date===newD)){
      toast('Чекпоинт на эту дату уже есть');inp.value=oldD;return;
    }
    const cp=state.checkpoints.find(c=>c.date===oldD);if(!cp)return;
    cp.date=newD;inp.dataset.cpdate=newD;
    /* НЕ перерисовываем таблицу здесь — иначе посегментный ввод даты сбрасывается.
       Синхронизируем ключи соседних контролов строки (они ключуются по дате). */
    const tr=inp.closest('tr');
    if(tr){
      tr.querySelectorAll('[data-cpbal]').forEach(x=>x.dataset.cpbal=newD);
      tr.querySelectorAll('[data-cpdel]').forEach(x=>x.dataset.cpdel=newD);
      tr.querySelectorAll('[data-cpkind]').forEach(x=>x.dataset.cpkind=newD);
    }
    pruneStaleExclusions();
    saveState();renderActualExpenses();renderTicker();renderDataStats();
    if(document.getElementById('panel-forecast').classList.contains('active'))runForecast(true);
  }));
  tb.querySelectorAll('[data-cpbal]').forEach(inp=>inp.addEventListener('change',()=>{
    const d=inp.dataset.cpbal;
    const cp=state.checkpoints.find(c=>c.date===d);if(!cp)return;
    const v=parseFloat(inp.value);
    if(!isFinite(v)){inp.value=cp.balance;return}
    cp.balance=v;
    saveState();renderCheckpoints();renderActualExpenses();renderTicker();renderDataStats();
    if(document.getElementById('panel-forecast').classList.contains('active'))runForecast(true);
  }));
}

/* Strip excluded-interval entries that no longer match any pair of
   consecutive ACTUAL checkpoints (after delete / kind toggle). */
function pruneStaleExclusions(){
  if(!state.cashflowExcluded.length)return;
  const actual=state.checkpoints.filter(c=>(c.kind||'actual')==='actual')
    .map(c=>c.date).sort();
  const valid=new Set();
  for(let i=1;i<actual.length;i++)valid.add(actual[i-1]+'|'+actual[i]);
  const before=state.cashflowExcluded.length;
  state.cashflowExcluded=state.cashflowExcluded.filter(x=>valid.has(x.from+'|'+x.to));
  if(state.cashflowExcluded.length<before)saveState();
}

/* ========================= ONE-TIME INCOMES ========================= */
document.getElementById('inc-add').addEventListener('click',()=>{
  const d=document.getElementById('inc-date').value;if(!d){toast('Укажи дату');return}
  const a=parseFloat(document.getElementById('inc-amt').value)||0;
  const n=document.getElementById('inc-name').value||'Поступление';
  state.incomes.push({date:d,name:n,amount:a});
  saveState();renderIncomes();toast('Поступление добавлено');
});

function renderIncomes(){
  const tb=document.querySelector('#inc-table tbody');
  const inc=state.incomes;const c=esc(cur());
  document.getElementById('inc-summary').innerHTML=inc.length
    ?`Всего поступлений: <b>${inc.length}</b> на <b>${fmt(inc.reduce((s,e)=>s+Number(e.amount),0))} ${c}</b>`
    :'Поступлений пока нет.';
  tb.innerHTML=inc.map((e,i)=>`<tr>
    <td>${esc(e.name)}</td>
    <td class="num">${fmt(e.amount)} ${c}</td>
    <td>${esc(e.date.split('-').reverse().join('.'))}</td>
    <td><button class="btn terra sm" data-idel="${i}">удалить</button></td>
  </tr>`).join('');
  tb.querySelectorAll('[data-idel]').forEach(b=>b.addEventListener('click',()=>{
    state.incomes.splice(+b.dataset.idel,1);saveState();renderIncomes();
  }));
}

/* ========================= FORECAST TAB ========================= */
function runForecast(auto){
  const end=document.getElementById('fc-end').value;
  if(!end){if(!auto)toast('Укажи дату прогноза');return}
  if(!state.entries.length){if(!auto)toast('Сначала импортируй данные');return}
  if(!state.checkpoints.length){if(!auto)toast('Добавь хотя бы один чекпоинт баланса');return}
  try{
    const cf=cashFlowFromCheckpoints(state.entries,state.expenses,state.incomes,state.checkpoints,{
      excluded:state.cashflowExcluded,taxRate:state.taxRate,fallbackRate:state.rate,
      payDays:state.payDays,payDayActuals:state.payDayActuals
    });
    const ae=autoExpenseEstimate(cf);
    const anchorEl=document.getElementById('fc-anchor');
    const anchorDate=anchorEl&&anchorEl.value?anchorEl.value:null;
    const r=forecastSavings(state.entries,state.rate,state.expenses,state.incomes,state.checkpoints,state.payDays,end,5000,7,{
      halfLife:state.halfLife,
      taxRate:state.taxRate,
      vacations:state.vacations,
      payDayActuals:state.payDayActuals,
      anchorDate,
      autoMonthlyRates:ae?ae.sampleRates:null,
      autoMonthlyDurations:ae?ae.sampleDurations:null
    });
    r.cashFlow=cf;r.autoEstimate=ae;
    r.past=reconstructPastBalance(state.entries,state.expenses,state.incomes,state.checkpoints,{
      taxRate:state.taxRate,fallbackRate:state.rate,anchorDate:r.startDate,
      payDays:state.payDays,payDayActuals:state.payDayActuals
    });
    lastFc=r;
    document.getElementById('card-fc-extras').style.display='';
    document.getElementById('card-fc-model').style.display='';
    drawForecast('ch-fc',r,r.startBalance);
    drawMonthlyForecast(r);
    drawFinalDist(r);
    renderModelTable(r);
    renderAnchorSelector(r);
    document.getElementById('fc-summary').innerHTML=renderForecastSummary(r,end);
  }catch(e){if(!auto)toast('Ошибка: '+e.message)}
}

function renderAnchorSelector(r){
  const sel=document.getElementById('fc-anchor');if(!sel)return;
  const actual=state.checkpoints.filter(c=>(c.kind||'actual')==='actual')
    .sort((a,b)=>a.date<b.date?-1:1);
  const prev=sel.value;
  sel.innerHTML='<option value="">Авто (последний фактический)</option>'
    +actual.map(c=>`<option value="${esc(c.date)}"${c.date===prev?' selected':''}>${esc(dateRu(c.date,true))} · ${fmt(c.balance)} ${esc(cur())}</option>`).join('');
}

function renderForecastSummary(r,end){
  const c=esc(cur());
  const days=r.days.length;
  const monthF=days>0?30.44/days:0;
  const autoTotal=r.totalAutoExpense||0;
  const manualExpenses=Math.max(0,r.totalExpenses-autoTotal);
  const monthlyWork=r.totalExpectedWork*monthF;
  const monthlyExp=r.totalExpenses*monthF;
  const monthlyManualExp=manualExpenses*monthF;
  const monthlyAutoExp=autoTotal*monthF;
  const monthlyInc=r.totalIncomes*monthF;
  const monthlyNet=monthlyWork+monthlyInc-monthlyExp;
  const runway=monthlyExp>0?r.startBalance/monthlyExp:Infinity;
  const breakeven=Math.max(0,monthlyExp-monthlyInc);
  const useDelayed=r.payDayDates.length>0;
  const totalGrowth=r.finalMean-r.startBalance;
  const growthClr=totalGrowth>=0?COL.green:COL.terra;
  const netClr=monthlyNet>=0?'green':'terra';
  const ae=r.autoEstimate;
  const taxPct=(r.taxRate||0)*100;

  const bd=[];
  bd.push(`<div class="bd-row"><span>Стартовый баланс на ${esc(dateRu(r.startDate,true))}</span><span><b>${fmt(r.startBalance)} ${c}</b></span></div>`);
  const workLbl=taxPct>0?`+ Чистый доход от работы (после налога ${taxPct.toFixed(0)}%, за ${days} дн.)`:`+ Ожидаемый доход от работы (за ${days} дн.)`;
  bd.push(`<div class="bd-row income"><span>${workLbl}</span><span>+${fmt(r.totalExpectedWork)} ${c}</span></div>`);
  if(useDelayed){
    if(r.initialUnpaid)bd.push(`<div class="bd-row note"><span>включая выплату долга с прошлого периода</span><span>+${fmt(r.initialUnpaid)} ${c}</span></div>`);
    if(r.unpaidAtEnd)bd.push(`<div class="bd-row note"><span>минус оставшийся непогашенный пул к концу</span><span>−${fmt(r.unpaidAtEnd)} ${c}</span></div>`);
  }
  if(r.totalIncomes)bd.push(`<div class="bd-row income"><span>+ Разовые поступления</span><span>+${fmt(r.totalIncomes)} ${c}</span></div>`);
  if(manualExpenses)bd.push(`<div class="bd-row expense"><span>− Введённые расходы</span><span>−${fmt(manualExpenses)} ${c}</span></div>`);
  if(autoTotal){
    const sourceLbl=ae&&ae.source==='recent90'?'последние 90 дн.':ae&&ae.source==='robust'?'устойчивая оценка':'среднее';
    bd.push(`<div class="bd-row expense"><span>− Авто-расходы по чекпоинтам <small class="note">(≈${fmt(monthlyAutoExp)} ${c}/мес · ${sourceLbl})</small></span><span>−${fmt(autoTotal)} ${c}</span></div>`);
  }
  if(r.model.vacationDayCount)bd.push(`<div class="bd-row note"><span>учтено отпускных/нерабочих дней в горизонте</span><span>${r.model.vacationDayCount}</span></div>`);
  if(r.calibrationShift){
    bd.push(`<div class="bd-row calib"><span>~ Сдвиг калибровки по чекпоинтам</span><span>${r.calibrationShift>=0?'+':''}${fmt(r.calibrationShift)} ${c}</span></div>`);
    if(r.model.calibrationExtraWidth)bd.push(`<div class="bd-row note"><span>добавочная неопределённость после калибровки (±${fmt(r.model.calibrationExtraWidth)})</span><span class="note">модель промахнулась — полоса и распределение расширены</span></div>`);
  }
  bd.push(`<div class="bd-row total"><span>= Ожидаемый баланс на ${esc(dateRu(end,true))}</span><span><b style="color:${growthClr}">${fmt(r.finalMean)} ${c}</b></span></div>`);
  if(r.targetReachProb&&r.targetReachProb.length){
    bd.push(`<div class="bd-row" style="margin-top:8px;border-top:1px solid var(--line2);padding-top:6px"><b>Достижимость целей:</b><span></span></div>`);
    for(const t of r.targetReachProb){
      const pClr=t.prob>=0.7?'green':t.prob>=0.3?'gold':'terra';
      bd.push(`<div class="bd-row"><span>◇ ${fmt(t.balance)} ${c} к ${esc(dateRu(t.date,true))}</span><span><b style="color:${COL[pClr]}">${(t.prob*100).toFixed(0)}%</b></span></div>`);
    }
  }

  let payout='';
  if(r.nextSalary||r.prevSalary){
    const po=[];
    if(r.prevSalary){
      const ps=r.prevSalary;
      po.push(`<div class="po"><div class="k">Предыдущая зарплата</div><div class="v green">${fmt(ps.money)} ${c}</div><div class="sub">${esc(dateRu(ps.date,true))} · после налога</div></div>`);
      po.push(`<div class="po"><div class="k">Часы в прошлой выплате</div><div class="v">${(ps.hours||0).toFixed(1)} ч</div><div class="sub">за ${esc(dateRu(ps.periodFrom))} – ${esc(dateRu(ps.periodTo||ps.date))}</div></div>`);
    }
    po.push(`<div class="po"><div class="k">Заработано и не выплачено сейчас</div><div class="v green">${fmt(r.unpaidNow||0)} ${c}</div><div class="sub">после налога · ещё не на карте</div></div>`);
    po.push(`<div class="po"><div class="k">Часов невыплачено сейчас</div><div class="v">${(r.unpaidNowHours||0).toFixed(1)} ч</div><div class="sub">отработано, но ещё не оплачено</div></div>`);
    if(r.pendingNow&&r.pendingNow.money>0){
      const pn=r.pendingNow;
      po.push(`<div class="po"><div class="k">Начислено, ждёт выплаты</div><div class="v green">${fmt(pn.money)} ${c}</div><div class="sub">${(pn.hours||0).toFixed(1)} ч · придёт ${esc(dateRu(pn.nextPayout,true))}</div></div>`);
    }
    if(r.nextSalary){
      const ns=r.nextSalary;
      po.push(`<div class="po"><div class="k">Ожидаемая зарплата</div><div class="v green">+${fmt(ns.mean)} ${c}</div><div class="sub">${esc(dateRu(ns.date,true))} · 80%: ${fmt(ns.p10)}–${fmt(ns.p90)}</div></div>`);
      po.push(`<div class="po"><div class="k">Ожидаемые часы</div><div class="v">${(ns.expHours||0).toFixed(1)} ч</div><div class="sub">войдут в ближайшую выплату</div></div>`);
    }
    payout=`<div class="fc-payout">
      <div class="fc-payout-head">💵 Зарплата и невыплаченное</div>
      <div class="fc-payout-grid">${po.join('')}</div>
    </div>`;
  }

  const metrics=[];
  metrics.push(`<div class="fc-metric"><div class="k">Прирост за период</div><div class="v" style="color:${growthClr}">${totalGrowth>=0?'+':''}${fmt(totalGrowth)}</div><div class="sub">${c}</div></div>`);
  metrics.push(`<div class="fc-metric"><div class="k">Интервал 80%</div><div class="v" style="font-size:14px">${fmt(r.finalP10)} — ${fmt(r.finalP90)}</div><div class="sub">${c}</div></div>`);
  metrics.push(`<div class="fc-metric"><div class="k">Доход от работы / мес</div><div class="v green">${fmt(monthlyWork)}</div><div class="sub">${c}/мес${taxPct>0?` · после ${taxPct.toFixed(0)}% налога`:''}</div></div>`);
  if(monthlyExp)metrics.push(`<div class="fc-metric"><div class="k">Расходы / мес</div><div class="v terra">${fmt(monthlyExp)}</div><div class="sub">${c}/мес${monthlyManualExp&&monthlyAutoExp?` · ${fmt(monthlyManualExp)} введ. + ${fmt(monthlyAutoExp)} авто`:''}</div></div>`);
  metrics.push(`<div class="fc-metric"><div class="k">Нетто / мес</div><div class="v ${netClr}">${monthlyNet>=0?'+':''}${fmt(monthlyNet)}</div><div class="sub">${c}/мес</div></div>`);
  if(ae){
    const srcLbl=ae.source==='recent90'?'последние 90 дн.':ae.source==='robust'?'устойчивая (винзоризация)':'среднее по чекп.';
    const weak=ae.intervalsUsed<3?' <span style="color:#b1462c">⚠ слабый сигнал</span>':'';
    metrics.push(`<div class="fc-metric"><div class="k">Авто-расход / мес</div><div class="v gold">${fmt(ae.value)}</div><div class="sub">${c}/мес · ±${fmt(ae.sigma)} (σ) · ${srcLbl}${weak}</div></div>`);
    if(r.cashFlow&&r.cashFlow.intervalsUsed){
      metrics.push(`<div class="fc-metric"><div class="k">Факт. отток (все) / мес</div><div class="v terra">${fmt(r.cashFlow.monthlyNetOut)}</div><div class="sub">${c}/мес · по ${r.cashFlow.intervalsUsed} интервалу(ам)</div></div>`);
    }
  }
  if(monthlyExp){
    const rwTxt=isFinite(runway)?(runway>=99?'>99':runway.toFixed(1)):'∞';
    metrics.push(`<div class="fc-metric"><div class="k">Запас прочности</div><div class="v gold">${rwTxt}</div><div class="sub">мес. расходов в текущем балансе</div></div>`);
    metrics.push(`<div class="fc-metric"><div class="k">Безубыточный доход</div><div class="v">${fmt(breakeven)}</div><div class="sub">${c}/мес от работы</div></div>`);
  }
  metrics.push(`<div class="fc-metric"><div class="k">Медиана сценария</div><div class="v">${fmt(r.finalMedian)}</div><div class="sub">${c}</div></div>`);
  metrics.push(`<div class="fc-metric"><div class="k">Разброс (σ)</div><div class="v">${fmt(r.finalStd)}</div><div class="sub">${c}</div></div>`);
  metrics.push(`<div class="fc-metric"><div class="k">Худший сценарий</div><div class="v terra">${fmt(r.finalMin)}</div><div class="sub">${c}</div></div>`);
  metrics.push(`<div class="fc-metric"><div class="k">Лучший сценарий</div><div class="v green">${fmt(r.finalMax)}</div><div class="sub">${c}</div></div>`);
  const npClr=r.negativeProb>0.1?'terra':r.negativeProb>0?'gold':'green';
  metrics.push(`<div class="fc-metric"><div class="k">P(баланс &lt; 0 в конце)</div><div class="v ${npClr}">${(r.negativeProb*100).toFixed(1)}%</div><div class="sub">из ${r.finalRuns.length} симуляций</div></div>`);
  if(r.midPeriodNegProb!=null){
    const mpClr=r.midPeriodNegProb>0.2?'terra':r.midPeriodNegProb>0.05?'gold':'green';
    metrics.push(`<div class="fc-metric"><div class="k">P(кассовый разрыв в пути)</div><div class="v ${mpClr}">${(r.midPeriodNegProb*100).toFixed(1)}%</div><div class="sub">баланс падает &lt; 0 хотя бы раз</div></div>`);
  }
  if(r.checkpointDays.length)metrics.push(`<div class="fc-metric"><div class="k">Калибровочных чекпоинтов</div><div class="v gold">${r.checkpointDays.length}</div></div>`);
  if(r.payDayDates.length)metrics.push(`<div class="fc-metric"><div class="k">Выплат в периоде</div><div class="v">${r.payDayDates.length}</div></div>`);

  return `<div class="fc-breakdown">${bd.join('')}</div>${payout}<div class="fc-metrics">${metrics.join('')}</div>`;
}

function renderModelTable(r){
  const tb=document.querySelector('#model-table tbody');if(!tb)return;
  const c=esc(cur());const m=r.model;
  const totalExp=m.expH.reduce((a,b)=>a+b,0);
  const totalSamples=m.sampleSizes.reduce((a,b)=>a+b,0);
  const taxPct=(r.taxRate||0)*100;
  const bootInfo=m.weekBootstrap
    ?`<b>бутстрап по неделям</b> (${m.historicalWeeks} полн. нед.)`
    :`<b>fallback per-day</b> (${m.historicalWeeks} нед. &lt; порог 8)`;
  const autoLine=m.autoIntervalsUsed
    ?` · авто-расход по ${m.autoIntervalsUsed} интервалу(ам)`
    :'';
  document.getElementById('model-summary').innerHTML=
    `<div>Параметры: T½ = <b>${m.halfLife}</b> дн. · налог = <b>${taxPct.toFixed(1)}%</b> · якорь = <b>${esc(dateRu(m.anchorDate,true))}</b> · ${bootInfo}${autoLine}</div>`+
    `<div style="margin-top:4px">Ожидаемые часы за неделю: <b>${totalExp.toFixed(2)}</b> · `+
    `ожидаемый доход (после налога): <b>${fmt(totalExp*r.rate*(1-(r.taxRate||0)))} ${c}/нед</b> · `+
    `рабочих дней в истории: <b>${totalSamples}</b>${m.vacationDayCount?` · отпусков в горизонте: <b>${m.vacationDayCount}</b>`:''}</div>`;
  tb.innerHTML=WD.map((name,i)=>{
    const p=(m.pWork[i]*100).toFixed(0);
    return `<tr>
      <td><b>${name}</b></td>
      <td class="num">${p}%</td>
      <td class="num">${m.avgH[i].toFixed(2)}</td>
      <td class="num">${m.expH[i].toFixed(2)}</td>
      <td class="num">${fmt(m.expH[i]*r.rate)} ${c}</td>
      <td class="num">${m.sampleSizes[i]}</td>
    </tr>`;
  }).join('');
}

document.getElementById('fc-run').addEventListener('click',()=>runForecast(false));
document.getElementById('fc-end').addEventListener('change',()=>runForecast(true));
const fcAnchor=document.getElementById('fc-anchor');
if(fcAnchor)fcAnchor.addEventListener('change',()=>runForecast(true));

/* ========================= GIST SYNC ========================= */
const AUTOPUSH_DEBOUNCE=5000;
const AUTOPULL_MIN_INTERVAL=10000;
const ERROR_BACKOFF=60000;

let pushTimer=null;
let pushInFlight=false;
let pullInFlight=false;
let nextAllowedPushAt=0;
let lastAutoPullAt=0;

function syncIsDirty(){
  const cfg=loadGistCfg();
  if(!cfg.lastSyncedLocalAt)return true;
  return state.updatedAt!==cfg.lastSyncedLocalAt;
}

function clearAutoPush(){if(pushTimer){clearTimeout(pushTimer);pushTimer=null}}

function schedulePush(){
  const cfg=loadGistCfg();
  if(!cfg.token||!cfg.gistId)return;
  if(pushInFlight)return;
  const delay=Math.max(AUTOPUSH_DEBOUNCE,nextAllowedPushAt-Date.now());
  clearAutoPush();
  pushTimer=setTimeout(doAutoPush,delay);
  renderSync();
}

async function pushNow(silent){
  if(pushInFlight){if(!silent)toast('Push уже идёт');return}
  if(pullInFlight){if(!silent)toast('Pull в процессе, попробуй через секунду');return}
  const cfg=loadGistCfg();
  if(!cfg.token||!cfg.gistId){if(!silent)toast('Сначала настрой синхронизацию');return}
  pushInFlight=true;clearAutoPush();renderSync();
  const snapAt=state.updatedAt;
  try{
    const res=await gistPush(cfg.token,cfg.gistId,state);
    const cfg2=loadGistCfg();
    saveGistCfg(Object.assign({},cfg2,{gistUrl:res.url||cfg2.gistUrl,
      lastSyncedRemoteAt:res.updatedAt,lastSyncedLocalAt:snapAt,lastError:''}));
    nextAllowedPushAt=0;
    if(!silent)toast('Push успешен');
  }catch(e){
    const cfg2=loadGistCfg();
    saveGistCfg(Object.assign({},cfg2,{lastError:e.message}));
    if(silent)nextAllowedPushAt=Date.now()+ERROR_BACKOFF;
    toast((silent?'Авто-push: ':'Ошибка: ')+e.message);
  }finally{
    pushInFlight=false;renderSync();
    if(silent&&syncIsDirty())schedulePush();
  }
}

async function doAutoPush(){
  pushTimer=null;
  if(!syncIsDirty()){renderSync();return}
  await pushNow(true);
}

async function pullNow(silent){
  if(pushInFlight){if(!silent)toast('Push в процессе, попробуй через секунду');return}
  if(pullInFlight){if(!silent)toast('Pull уже идёт');return}
  const cfg=loadGistCfg();
  if(!cfg.token||!cfg.gistId){if(!silent)toast('Сначала настрой синхронизацию');return}
  pullInFlight=true;renderSync();
  try{
    const res=await gistPull(cfg.token,cfg.gistId);
    if(silent&&res.updatedAt===cfg.lastSyncedRemoteAt)return;
    if(silent&&syncIsDirty()){
      toast('В gist есть свежие данные, но локально есть несинхр. изменения — выбери Push или Pull вручную');
      return;
    }
    if(!silent&&syncIsDirty()&&!confirm('Локально есть несинхр. изменения — перезаписать их данными из gist?'))return;
    state=migrate(res.state);
    afterDataChange({silent:true});
    const cfg2=loadGistCfg();
    saveGistCfg(Object.assign({},cfg2,{gistUrl:res.url||cfg2.gistUrl,
      lastSyncedRemoteAt:res.updatedAt,lastSyncedLocalAt:state.updatedAt,lastError:''}));
    syncInputs();renderSync();
    toast(silent?'Загружены свежие данные из gist':'Pull успешен');
  }catch(e){
    const cfg2=loadGistCfg();
    saveGistCfg(Object.assign({},cfg2,{lastError:e.message}));
    if(!silent)toast('Ошибка: '+e.message);
  }finally{
    pullInFlight=false;renderSync();
  }
}

function maybeAutoPull(){
  const cfg=loadGistCfg();
  if(!cfg.token||!cfg.gistId)return;
  const now=Date.now();
  if(now-lastAutoPullAt<AUTOPULL_MIN_INTERVAL)return;
  lastAutoPullAt=now;
  pullNow(true);
}

function updateSyncButtons(){
  const cfg=loadGistCfg();
  const token=document.getElementById('gist-token').value.trim();
  const idRaw=document.getElementById('gist-id').value.trim();
  const id=parseGistId(idRaw);
  const busy=pushInFlight||pullInFlight;
  const configured=!!(cfg.token&&cfg.gistId);
  const set=(elId,disabled,title)=>{
    const b=document.getElementById(elId);
    b.disabled=disabled;
    if(disabled)b.setAttribute('title',title||'');
    else b.removeAttribute('title');
  };
  const busyT='Идёт синхронизация — подожди';
  set('gist-create',!token||busy,busy?busyT:'Сначала вставь токен в поле выше');
  set('gist-link',!token||!id||busy,busy?busyT:!token?'Вставь токен':!id?'Вставь Gist ID или URL':'');
  set('gist-push',!configured||busy,busy?busyT:'Сначала создай или свяжи gist');
  set('gist-pull',!configured||busy,busy?busyT:'Сначала создай или свяжи gist');
  set('gist-disconnect',!configured||busy,busy?busyT:'Нечего отключать');
}

function renderSync(){
  const cfg=loadGistCfg();
  const tokInp=document.getElementById('gist-token');
  const idInp=document.getElementById('gist-id');
  if(cfg.token&&!tokInp.value)tokInp.value=cfg.token;
  if(cfg.gistId&&!idInp.value)idInp.value=cfg.gistId;
  updateSyncButtons();
  const s=document.getElementById('gist-status');
  if(!cfg.token||!cfg.gistId){
    s.innerHTML='Не настроено. Вставь токен и нажми <b>«Создать новый gist»</b>, либо вставь токен + ID существующего gist и нажми <b>«Связать»</b>.';
    return;
  }
  const linkHtml=cfg.gistUrl?` · <a href="${esc(cfg.gistUrl)}" target="_blank" rel="noopener">открыть на GitHub</a>`:'';
  const last=cfg.lastSyncedRemoteAt?esc(cfg.lastSyncedRemoteAt.replace('T',' ').slice(0,19))+' UTC':'—';
  let line;
  if(pushInFlight)line='<b style="color:#a9792a">🔄 push…</b>';
  else if(pullInFlight)line='<b style="color:#a9792a">🔄 pull…</b>';
  else if(syncIsDirty()){
    line=pushTimer
      ?'<b style="color:#a9792a">⏱ авто-push через несколько сек…</b>'
      :'<b style="color:#b1462c">⚠ есть локальные изменения</b>';
  }else line='<b style="color:#2f6b4f">✓ синхронизировано · авто-push/pull активны</b>';
  const errLine=cfg.lastError?`<br><span style="color:#b1462c">Последняя ошибка: ${esc(cfg.lastError)}</span>`:'';
  s.innerHTML=`Gist: <code>${esc(cfg.gistId)}</code>${linkHtml}<br>Последняя синхронизация: <b>${last}</b> · ${line}${errLine}`;
}

async function doSync(action){
  const token=document.getElementById('gist-token').value.trim();
  const idRaw=document.getElementById('gist-id').value.trim();
  try{
    if(action==='create'){
      if(!token){toast('Сначала вставь токен');return}
      if(!confirm('Создать новый приватный gist и загрузить туда текущее состояние?'))return;
      const res=await gistCreate(token,state);
      saveGistCfg({token,gistId:res.id,gistUrl:res.url,
        lastSyncedRemoteAt:res.updatedAt,lastSyncedLocalAt:state.updatedAt,lastError:''});
      nextAllowedPushAt=0;renderSync();toast('Gist создан · '+res.id);
    }else if(action==='link'){
      if(!token){toast('Сначала вставь токен');return}
      const id=parseGistId(idRaw);
      if(!id){toast('Вставь ID или URL gist в поле «Gist ID или URL»');return}
      if(pushInFlight||pullInFlight){toast('Подожди, синхронизация уже идёт');return}
      const hasLocal=state.entries.length||state.checkpoints.length||state.expenses.length;
      if(hasLocal&&!confirm('Скачать состояние из gist и заменить локальные данные? Локальное состояние будет потеряно.')){
        toast('Отменено');return;
      }
      pullInFlight=true;clearAutoPush();renderSync();
      try{
        const res=await gistPull(token,id);
        state=migrate(res.state);
        afterDataChange({silent:true});
        saveGistCfg({token,gistId:id,gistUrl:res.url,
          lastSyncedRemoteAt:res.updatedAt,lastSyncedLocalAt:state.updatedAt,lastError:''});
        nextAllowedPushAt=0;syncInputs();renderSync();
        toast('Связано · данные из gist загружены ('+state.entries.length+' записей)');
      }catch(e){
        saveGistCfg(Object.assign({},loadGistCfg(),{lastError:e.message}));
        toast('Ошибка: '+e.message);
      }finally{
        pullInFlight=false;renderSync();
      }
    }else if(action==='push'){await pushNow(false);
    }else if(action==='pull'){await pullNow(false);
    }else if(action==='disconnect'){
      if(!confirm('Отключить синхронизацию? Токен и Gist ID будут удалены из браузера (сам gist на GitHub останется).'))return;
      clearAutoPush();clearGistCfg();
      document.getElementById('gist-token').value='';
      document.getElementById('gist-id').value='';
      renderSync();toast('Синхронизация отключена');
    }
  }catch(e){toast('Ошибка: '+e.message)}
}

['create','link','push','pull','disconnect'].forEach(a=>{
  document.getElementById('gist-'+a).addEventListener('click',()=>doSync(a));
});
['gist-token','gist-id'].forEach(id=>{
  document.getElementById(id).addEventListener('input',updateSyncButtons);
});

document.addEventListener('visibilitychange',()=>{if(!document.hidden)maybeAutoPull()});
window.addEventListener('focus',maybeAutoPull);

/* ========================= INIT ========================= */
document.addEventListener('click',e=>{
  const b=e.target.closest('#vac-add');if(!b)return;
  const from=document.getElementById('vac-from').value;
  const to=document.getElementById('vac-to').value;
  if(!from||!to){toast('Укажи даты отпуска');return}
  if(from>to){toast('Дата начала позже даты конца');return}
  const name=document.getElementById('vac-name').value||'';
  state.vacations.push({from,to,name});
  document.getElementById('vac-from').value='';
  document.getElementById('vac-to').value='';
  document.getElementById('vac-name').value='';
  saveState();renderVacations();
  if(document.getElementById('panel-forecast').classList.contains('active'))runForecast(true);
});

function afterDataChange(opts){
  if(opts&&opts.silent)saveStateRaw();
  else saveState();
  renderTicker();renderDataStats();renderWork();renderExpenses();renderActualExpenses();renderVacations();renderCheckpoints();renderIncomes();renderPayDays();renderPayDayActuals();renderSync();
  if(document.getElementById('panel-charts').classList.contains('active'))drawAllCharts();
  if(document.getElementById('panel-forecast').classList.contains('active'))runForecast(true);
}

syncInputs();renderTicker();renderDataStats();renderWork();renderExpenses();renderActualExpenses();renderVacations();renderCheckpoints();renderIncomes();renderPayDays();renderPayDayActuals();renderSync();
switchTab(location.hash.slice(1));
maybeAutoPull();

/* ========================= DATE INPUT UX ========================= */
/* Кнопки «сегодня» статические (в разметке, data-for). Ничего не двигаем, не
   перехватываем фокус и не открываем календарь программно — ручной ввод и
   нативный календарь (по иконке) работают как обычно. */
document.addEventListener('click',e=>{
  const b=e.target.closest&&e.target.closest('.date-today[data-for]');
  if(!b)return;
  const inp=document.getElementById(b.dataset.for);
  if(inp&&!inp.disabled){inp.value=today();inp.dispatchEvent(new Event('change',{bubbles:true}))}
});
