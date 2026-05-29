/* Tab handlers, render functions, init.
   Depends on core.js, state.js, ui.js, charts.js. */

/* ========================= FILE I/O ========================= */
function readFile(input,cb){
  const f=input.files[0];if(!f)return;
  const r=new FileReader();r.onload=()=>cb(r.result);
  r.readAsText(f);input.value='';
}

document.getElementById('file-import').addEventListener('change',function(){readFile(this,txt=>{
  try{
    const es=rowsToEntries(parseCSV(txt));
    state.entries=es;state.rate=detectRate(es);
    syncInputs();afterDataChange();
    toast('Импортировано записей: '+es.length+' (старые заменены)');
  }catch(e){toast('Ошибка импорта: '+e.message)}
})});

document.getElementById('file-merge').addEventListener('change',function(){readFile(this,txt=>{
  try{
    const es=rowsToEntries(parseCSV(txt));
    const res=mergeEntries(state.entries,es);
    state.entries=res.entries;
    if(!state.rate)state.rate=detectRate(state.entries);
    syncInputs();afterDataChange();
    toast('Догружено: +'+res.added+' новых (дубликаты пропущены). Всего: '+state.entries.length);
  }catch(e){toast('Ошибка догрузки: '+e.message)}
})});

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
['rate','currency'].forEach(k=>{
  const el=document.getElementById('in-'+k);
  el.addEventListener('change',()=>{
    if(k==='rate')state.rate=parseFloat(el.value)||0;
    if(k==='currency')state.currency=el.value||'USD';
    saveState();renderTicker();renderDataStats();renderCheckpoints();renderIncomes();renderExpenses();
  });
});

function syncInputs(){
  document.getElementById('in-rate').value=state.rate;
  document.getElementById('in-currency').value=state.currency;
  if(!document.getElementById('fc-end').value)
    document.getElementById('fc-end').value=addDays(anchorDate(),90);
  const cpD=document.getElementById('cp-date');if(!cpD.value)cpD.value=today();
  const incD=document.getElementById('inc-date');if(!incD.value)incD.value=today();
}

function renderDataStats(){
  const box=document.getElementById('data-stats');const es=state.entries;
  if(!es.length){
    box.innerHTML='<div class="empty"><div class="big">Нет данных</div>Импортируй отчёт Clockify (CSV), чтобы начать.</div>';
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
});

document.getElementById('ex-add').addEventListener('click',()=>{
  const kind=document.getElementById('ex-kind').value;
  const name=document.getElementById('ex-name').value||'Расход';
  const amt=parseFloat(document.getElementById('ex-amt').value)||0;
  const e={kind,name,amount:amt};
  if(kind==='monthly'){
    e.day=Math.min(28,Math.max(1,parseInt(document.getElementById('ex-day').value)||1));
  }else if(kind==='daily'){
    /* nothing extra — sum-per-month already in amount */
  }else{
    const d=document.getElementById('ex-date').value;
    if(!d){toast('Укажи дату');return}
    e.date=d;
  }
  state.expenses.push(e);saveState();renderExpenses();toast('Расход добавлен');
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
  tb.innerHTML=ex.map((e,i)=>`<tr>
    <td><span class="pill ${expenseKindPill(e.kind)}">${expenseKindLabel(e.kind)}</span></td>
    <td>${esc(e.name)}</td><td class="num">${fmt(e.amount)} ${c}${e.kind==='daily'?' /мес':''}</td>
    <td>${expenseWhen(e)}</td>
    <td><button class="btn terra sm" data-del="${i}">удалить</button></td></tr>`).join('');
  tb.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click',()=>{
    state.expenses.splice(+b.dataset.del,1);saveState();renderExpenses();
  }));
}

/* ========================= PAY DAYS ========================= */
document.getElementById('pd-add').addEventListener('click',()=>{
  if(state.payDays.length>=4){toast('Максимум 4 дня выплаты');return}
  const last=state.payDays.length?state.payDays[state.payDays.length-1]:0;
  const next=state.payDays.length?Math.min(28,last+10):5;
  state.payDays.push(next);
  saveState();renderPayDays();
});

function renderPayDays(){
  const list=document.getElementById('pd-list');
  const pds=state.payDays.slice().sort((a,b)=>a-b);
  state.payDays=pds;
  if(!pds.length){list.innerHTML='<small class="note">Не настроены — доход начисляется ежедневно (как раньше).</small>';}
  else{
    list.innerHTML=pds.map((d,i)=>`<div class="field"><label>День ${i+1}</label><div style="display:flex;gap:6px;align-items:center"><input type="number" min="1" max="28" value="${d}" data-pdi="${i}" style="width:80px"><button class="btn terra sm" data-pddel="${i}">×</button></div></div>`).join('');
    list.querySelectorAll('[data-pdi]').forEach(inp=>inp.addEventListener('change',()=>{
      const i=+inp.dataset.pdi;
      const v=Math.max(1,Math.min(28,parseInt(inp.value)||1));
      state.payDays[i]=v;
      saveState();renderPayDays();
    }));
    list.querySelectorAll('[data-pddel]').forEach(b=>b.addEventListener('click',()=>{
      state.payDays.splice(+b.dataset.pddel,1);
      saveState();renderPayDays();
    }));
  }
  document.getElementById('pd-add').disabled=pds.length>=4;
}

/* ========================= CHECKPOINTS ========================= */
document.getElementById('cp-add').addEventListener('click',()=>{
  const d=document.getElementById('cp-date').value;if(!d){toast('Укажи дату');return}
  const a=parseFloat(document.getElementById('cp-amt').value);
  if(!isFinite(a)){toast('Укажи сумму');return}
  state.checkpoints=state.checkpoints.filter(c=>c.date!==d);
  state.checkpoints.push({date:d,balance:a});
  saveState();renderCheckpoints();renderTicker();renderDataStats();
  if(!document.getElementById('fc-end').value)
    document.getElementById('fc-end').value=addDays(anchorDate(),90);
  toast('Чекпоинт сохранён');
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
  const an=anchorCp();const calibN=cps.filter(x=>x.date>an.date).length;
  sm.innerHTML=`Старт прогноза: <b>${esc(an.date.split('-').reverse().join('.'))}</b> · <b>${fmt(an.balance)} ${c}</b>`
    +(calibN?` · калибровочных точек: <b>${calibN}</b>`:'');
  tb.innerHTML=cps.map(cp=>{
    const pill=cp.date===an.date?'<span class="pill m">старт</span>'
      :cp.date>an.date?'<span class="pill o">калибр.</span>'
      :'<span class="pill">прошлое</span>';
    return `<tr>
      <td>${esc(cp.date.split('-').reverse().join('.'))} ${pill}</td>
      <td class="num">${fmt(cp.balance)} ${c}</td>
      <td><button class="btn terra sm" data-cpdel="${esc(cp.date)}">удалить</button></td>
    </tr>`;
  }).join('');
  tb.querySelectorAll('[data-cpdel]').forEach(b=>b.addEventListener('click',()=>{
    state.checkpoints=state.checkpoints.filter(c=>c.date!==b.dataset.cpdel);
    saveState();renderCheckpoints();renderTicker();renderDataStats();
  }));
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
    const r=forecastSavings(state.entries,state.rate,state.expenses,state.incomes,state.checkpoints,state.payDays,end,5000,7);
    lastFc=r;
    document.getElementById('card-fc-extras').style.display='';
    document.getElementById('card-fc-model').style.display='';
    drawForecast('ch-fc',r,r.startBalance);
    drawMonthlyForecast(r);
    drawFinalDist(r);
    renderModelTable(r);
    document.getElementById('fc-summary').innerHTML=renderForecastSummary(r,end);
  }catch(e){if(!auto)toast('Ошибка: '+e.message)}
}

function renderForecastSummary(r,end){
  const c=esc(cur());
  const days=r.days.length;
  const monthF=days>0?30.44/days:0;
  const monthlyWork=r.totalExpectedWork*monthF;
  const monthlyExp=r.totalExpenses*monthF;
  const monthlyInc=r.totalIncomes*monthF;
  const monthlyNet=monthlyWork+monthlyInc-monthlyExp;
  const runway=monthlyExp>0?r.startBalance/monthlyExp:Infinity;
  const breakeven=Math.max(0,monthlyExp-monthlyInc);
  const useDelayed=r.payDayDates.length>0;
  const totalGrowth=r.finalMean-r.startBalance;
  const growthClr=totalGrowth>=0?COL.green:COL.terra;
  const netClr=monthlyNet>=0?'green':'terra';

  const bd=[];
  bd.push(`<div class="bd-row"><span>Стартовый баланс на ${esc(dateRu(r.startDate,true))}</span><span><b>${fmt(r.startBalance)} ${c}</b></span></div>`);
  bd.push(`<div class="bd-row income"><span>+ Ожидаемый доход от работы (за ${days} дн.)</span><span>+${fmt(r.totalExpectedWork)} ${c}</span></div>`);
  if(useDelayed){
    if(r.initialUnpaid)bd.push(`<div class="bd-row note"><span>включая выплату долга с прошлого периода</span><span>+${fmt(r.initialUnpaid)} ${c}</span></div>`);
    if(r.unpaidAtEnd)bd.push(`<div class="bd-row note"><span>минус оставшийся непогашенный пул к концу</span><span>−${fmt(r.unpaidAtEnd)} ${c}</span></div>`);
  }
  if(r.totalIncomes)bd.push(`<div class="bd-row income"><span>+ Разовые поступления</span><span>+${fmt(r.totalIncomes)} ${c}</span></div>`);
  if(r.totalExpenses)bd.push(`<div class="bd-row expense"><span>− Расходы (все типы)</span><span>−${fmt(r.totalExpenses)} ${c}</span></div>`);
  if(r.calibrationShift)bd.push(`<div class="bd-row calib"><span>~ Сдвиг калибровки по чекпоинтам</span><span>${r.calibrationShift>=0?'+':''}${fmt(r.calibrationShift)} ${c}</span></div>`);
  bd.push(`<div class="bd-row total"><span>= Ожидаемый баланс на ${esc(dateRu(end,true))}</span><span><b style="color:${growthClr}">${fmt(r.finalMean)} ${c}</b></span></div>`);

  const metrics=[];
  metrics.push(`<div class="fc-metric"><div class="k">Прирост за период</div><div class="v" style="color:${growthClr}">${totalGrowth>=0?'+':''}${fmt(totalGrowth)}</div><div class="sub">${c}</div></div>`);
  if(r.nextSalary){
    const ns=r.nextSalary;
    metrics.push(`<div class="fc-metric"><div class="k">Следующая зарплата</div><div class="v green">+${fmt(ns.mean)}</div><div class="sub">${esc(dateRu(ns.date,true))} · ${c} · 80%: ${fmt(ns.p10)}–${fmt(ns.p90)}</div></div>`);
  }
  metrics.push(`<div class="fc-metric"><div class="k">Интервал 80%</div><div class="v" style="font-size:14px">${fmt(r.finalP10)} — ${fmt(r.finalP90)}</div><div class="sub">${c}</div></div>`);
  metrics.push(`<div class="fc-metric"><div class="k">Доход от работы / мес</div><div class="v green">${fmt(monthlyWork)}</div><div class="sub">${c}/мес в среднем</div></div>`);
  if(monthlyExp)metrics.push(`<div class="fc-metric"><div class="k">Расходы / мес</div><div class="v terra">${fmt(monthlyExp)}</div><div class="sub">${c}/мес в среднем</div></div>`);
  metrics.push(`<div class="fc-metric"><div class="k">Нетто / мес</div><div class="v ${netClr}">${monthlyNet>=0?'+':''}${fmt(monthlyNet)}</div><div class="sub">${c}/мес</div></div>`);
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
  metrics.push(`<div class="fc-metric"><div class="k">P(баланс &lt; 0)</div><div class="v ${npClr}">${(r.negativeProb*100).toFixed(1)}%</div><div class="sub">из ${r.finalRuns.length} симуляций</div></div>`);
  if(r.checkpointDays.length)metrics.push(`<div class="fc-metric"><div class="k">Калибровочных чекпоинтов</div><div class="v gold">${r.checkpointDays.length}</div></div>`);
  if(r.payDayDates.length)metrics.push(`<div class="fc-metric"><div class="k">Выплат в периоде</div><div class="v">${r.payDayDates.length}</div></div>`);

  return `<div class="fc-breakdown">${bd.join('')}</div><div class="fc-metrics">${metrics.join('')}</div>`;
}

function renderModelTable(r){
  const tb=document.querySelector('#model-table tbody');if(!tb)return;
  const c=esc(cur());const m=r.model;
  const totalExp=m.expH.reduce((a,b)=>a+b,0);
  const totalSamples=m.sampleSizes.reduce((a,b)=>a+b,0);
  document.getElementById('model-summary').innerHTML=
    `Ожидаемые часы за неделю: <b>${totalExp.toFixed(2)}</b> · `+
    `ожидаемый доход за неделю: <b>${fmt(totalExp*r.rate)} ${c}</b> · `+
    `всего рабочих дней в истории Clockify: <b>${totalSamples}</b>`;
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

/* ========================= INIT ========================= */
function afterDataChange(){
  saveState();renderTicker();renderDataStats();renderWork();renderExpenses();renderCheckpoints();renderIncomes();renderPayDays();
  if(document.getElementById('panel-charts').classList.contains('active'))drawAllCharts();
  if(document.getElementById('panel-forecast').classList.contains('active'))runForecast(true);
}

syncInputs();renderTicker();renderDataStats();renderWork();renderExpenses();renderCheckpoints();renderIncomes();renderPayDays();
switchTab(location.hash.slice(1));
