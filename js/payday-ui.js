function afterPayDaysChange(){
  renderActualExpenses();
  if(document.getElementById('panel-forecast').classList.contains('active'))runForecast(true);
}

document.getElementById('pd-add').addEventListener('click',()=>{
  if(state.payDays.length>=4){toast('Максимум 4 дня зарплаты');return}
  const last=state.payDays.length?state.payDays[state.payDays.length-1]:0;
  state.payDays.push(state.payDays.length?Math.min(28,last+10):5);
  saveState();renderPayDays();renderPayDayActuals();afterPayDaysChange();
});

function renderPayDays(){
  const list=document.getElementById('pd-list');
  const pds=state.payDays.slice().sort((a,b)=>a-b);
  state.payDays=pds;
  if(!pds.length)list.innerHTML='<small class="note">Не настроены — доход начисляется ежедневно (как раньше).</small>';
  else{
    list.innerHTML=pds.map((d,i)=>`<div class="field"><label>День зп ${i+1}</label><div style="display:flex;gap:6px;align-items:center"><input type="number" min="1" max="28" value="${d}" data-pdi="${i}" style="width:80px" title="День зп — отсечка часов; деньги по умолчанию приходят в этот же день"><button class="btn terra sm" data-pddel="${i}">×</button></div></div>`).join('');
    list.querySelectorAll('[data-pdi]').forEach(inp=>inp.addEventListener('change',()=>{
      const i=+inp.dataset.pdi;
      state.payDays[i]=Math.max(1,Math.min(28,parseInt(inp.value)||1));
      saveState();renderPayDays();afterPayDaysChange();
    }));
    list.querySelectorAll('[data-pddel]').forEach(button=>button.addEventListener('click',()=>{
      if(state.pendingPayAccrual&&state.payDays.length===1){
        toast('Сначала укажи выплату или удали ожидание');return;
      }
      state.payDays.splice(+button.dataset.pddel,1);
      saveState();renderPayDays();renderPayDayActuals();afterPayDaysChange();
    }));
  }
  document.getElementById('pd-add').disabled=pds.length>=4;
}

function completePendingPayAccrual(payout){
  const accrual=state.pendingPayAccrual;
  if(!accrual){toast('Нет часов, ожидающих выплаты');return false}
  if(!payout){toast('Укажи день выплаты (приход денег)');return false}
  if(payout<accrual){toast('День выплаты не может быть раньше дня учёта часов');return false}
  if(state.payDayActuals.some(actual=>actual.payout===payout)){toast('Эта дата выплаты уже отмечена');return false}
  state.payDayActuals.push({payout,accrual});
  state.pendingPayAccrual=null;
  return true;
}

function refreshPayActuals(){
  saveState();renderPayDayActuals();renderActualExpenses();
  if(document.getElementById('panel-forecast').classList.contains('active'))runForecast(true);
}

document.getElementById('pda-accrue-today').addEventListener('click',()=>{
  if(!state.payDays.length){toast('Сначала задай дни зп');return}
  if(state.pendingPayAccrual){toast('Сначала укажи выплату для уже учтённых часов');return}
  state.pendingPayAccrual=today();
  document.getElementById('pda-payout').value='';
  document.getElementById('pda-accrual').value='';
  refreshPayActuals();
});

document.getElementById('pda-add').addEventListener('click',()=>{
  if(!state.payDays.length){toast('Сначала задай дни зп');return}
  const payoutInput=document.getElementById('pda-payout');
  const accrualInput=document.getElementById('pda-accrual');
  const payout=payoutInput.value||null,accrual=accrualInput.value||null;
  if(state.pendingPayAccrual){
    if(!completePendingPayAccrual(payout))return;
  }else if(accrual&&!payout){
    if(accrual>today()){toast('День учёта часов не может быть в будущем');return}
    state.pendingPayAccrual=accrual;
  }else{
    if(!payout){toast('Укажи день учёта часов или день выплаты');return}
    if(accrual&&accrual>payout){toast('День учёта часов не может быть позже дня выплаты');return}
    if(state.payDayActuals.some(actual=>actual.payout===payout)){toast('Эта дата выплаты уже отмечена');return}
    state.payDayActuals.push({payout,accrual});
  }
  payoutInput.value='';accrualInput.value='';
  refreshPayActuals();
});

function pendingPayHtml(){
  if(!state.pendingPayAccrual)return'';
  const end=today();
  const events=effectivePayEvents(
    payEventHistoryStart(state.entries,end),end,paySchedule(state.payDays),
    state.payDayActuals,state.pendingPayAccrual
  );
  const period=payPeriodEarned(state.entries,events,state.rate).get(state.pendingPayAccrual);
  const detail=period
    ?`${fmt(period.hours)} ч · ${fmt(period.gross)} ${esc(cur())}`
    :'Сумма появится после импорта часов';
  return `<div class="pending-pay-row">
    <div class="pending-pay-heading"><strong>Ждёт выплаты · часы учтены по ${esc(dateRu(state.pendingPayAccrual,true))}</strong><span>${detail}</span></div>
    <div class="pending-pay-actions">
      <div class="field"><label for="pda-pending-payout">День выплаты</label><input type="date" id="pda-pending-payout"></div>
      <button class="btn secondary sm" data-pda-complete>Указать выплату</button>
      <button class="btn terra sm" data-pda-pending-delete>Удалить ожидание</button>
    </div>
  </div>`;
}

function renderPayDayActuals(){
  const list=document.getElementById('pda-list');
  if(!list)return;
  const payoutInput=document.getElementById('pda-payout');
  const accrualInput=document.getElementById('pda-accrual');
  const addButton=document.getElementById('pda-add');
  const todayButton=document.getElementById('pda-accrue-today');
  const hasSchedule=state.payDays.length>0;
  payoutInput.disabled=!hasSchedule;
  accrualInput.disabled=!hasSchedule||!!state.pendingPayAccrual;
  addButton.disabled=!hasSchedule;
  todayButton.disabled=!hasSchedule||!!state.pendingPayAccrual;
  addButton.textContent=state.pendingPayAccrual?'Указать выплату':'Сохранить';
  if(!hasSchedule){
    list.innerHTML='<small class="note">Сначала задай <b>дни зп</b> выше — без расписания отметить фактическую дату нельзя.</small>';
    return;
  }
  const actuals=[...state.payDayActuals].sort((a,b)=>a.payout<b.payout?-1:1);
  state.payDayActuals=actuals;
  const actualHtml=actuals.map((actual,i)=>`<div class="field"><label>Выплата ${i+1}: приход → учёт часов</label><div style="display:flex;gap:6px;align-items:center"><input type="date" value="${esc(actual.payout)}" data-pdaip="${i}" style="width:150px" title="День прихода денег (может быть в будущем)"><span class="note">→</span><input type="date" value="${esc(actual.accrual||'')}" data-pdaia="${i}" style="width:150px" title="День учёта часов (опц., пусто = по дню зп)"><button class="btn terra sm" data-pdadel="${i}">×</button></div></div>`).join('');
  list.innerHTML=pendingPayHtml()+actualHtml
    ||'<small class="note">Нет отмеченных дат — выплаты считаются по дням зп выше.</small>';
  list.querySelector('[data-pda-complete]')?.addEventListener('click',()=>{
    const payout=document.getElementById('pda-pending-payout').value;
    if(completePendingPayAccrual(payout)){
      payoutInput.value='';accrualInput.value='';refreshPayActuals();
    }
  });
  list.querySelector('[data-pda-pending-delete]')?.addEventListener('click',()=>{
    state.pendingPayAccrual=null;refreshPayActuals();
  });
  const update=()=>{saveState();renderActualExpenses();if(document.getElementById('panel-forecast').classList.contains('active'))runForecast(true)};
  list.querySelectorAll('[data-pdaip]').forEach(input=>input.addEventListener('change',()=>{
    const i=+input.dataset.pdaip;
    if(input.value){state.payDayActuals[i].payout=input.value;update()}
  }));
  list.querySelectorAll('[data-pdaia]').forEach(input=>input.addEventListener('change',()=>{
    const i=+input.dataset.pdaia;
    if(input.value&&input.value===state.pendingPayAccrual){
      toast('Эта дата уже ждёт выплаты');input.value=state.payDayActuals[i].accrual||'';return;
    }
    state.payDayActuals[i].accrual=input.value||null;update();
  }));
  list.querySelectorAll('[data-pdadel]').forEach(button=>button.addEventListener('click',()=>{
    state.payDayActuals.splice(+button.dataset.pdadel,1);update();renderPayDayActuals();
  }));
}
