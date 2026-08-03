function afterPayDaysChange(){
  renderActualExpenses();
  renderIncomeModels();
  if(document.getElementById('panel-forecast').classList.contains('active'))runForecast(true);
}

document.getElementById('pd-add').addEventListener('click',()=>{
  if(state.payDays.length>=4){toast('Максимум 4 дня зарплаты');return}
  const last=state.payDays.length?state.payDays[state.payDays.length-1]:0;
  state.payDays.push(state.payDays.length?Math.min(28,last+10):5);
  saveState();renderPaydayViews();afterPayDaysChange();
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
      saveState();renderPaydayViews();afterPayDaysChange();
    }));
    list.querySelectorAll('[data-pddel]').forEach(button=>button.addEventListener('click',()=>{
      if(state.pendingPayAccrual&&state.payDays.length===1){
        toast('Сначала укажи выплату или удали ожидание');return;
      }
      state.payDays.splice(+button.dataset.pddel,1);
      saveState();renderPaydayViews();afterPayDaysChange();
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

function startPendingPayAccrual(accrual){
  if(!state.payDays.length){toast('Сначала задай дни зп');return false}
  if(state.pendingPayAccrual){toast('Сначала укажи выплату для уже учтённых часов');return false}
  if(!accrual||accrual>today()){toast('День учёта часов не может быть в будущем');return false}
  if(state.payDayActuals.some(actual=>actual.accrual===accrual)){
    toast('Часы за эту дату уже учтены');return false;
  }
  state.pendingPayAccrual=accrual;
  return true;
}

function refreshPayActuals(){
  saveState();renderPayDayActuals();renderHomePayday();renderActualExpenses();
  if(document.getElementById('panel-forecast').classList.contains('active'))runForecast(true);
}

function clearPendingPayAccrual(){
  state.pendingPayAccrual=null;
  refreshPayActuals();
}

const todayAccrualDialog=document.getElementById('today-accrual-dialog');

function openTodayAccrualDialog(){
  document.getElementById('today-accrual-meta').textContent=`Включить часы за ${dateRu(today(),true)} в закрываемый период?`;
  todayAccrualDialog.showModal();
}

function accrueThrough(date){
  if(!startPendingPayAccrual(date))return;
  document.getElementById('pda-payout').value='';
  document.getElementById('pda-accrual').value='';
  todayAccrualDialog.close();
  refreshPayActuals();
}

document.getElementById('today-accrual-cancel').addEventListener('click',()=>todayAccrualDialog.close());
document.getElementById('today-accrual-exclusive').addEventListener('click',()=>accrueThrough(addDays(today(),-1)));
document.getElementById('today-accrual-inclusive').addEventListener('click',()=>accrueThrough(today()));

document.getElementById('pda-accrue-today').addEventListener('click',()=>{
  openTodayAccrualDialog();
});

document.getElementById('pda-add').addEventListener('click',()=>{
  if(!state.payDays.length){toast('Сначала задай дни зп');return}
  const payoutInput=document.getElementById('pda-payout');
  const accrualInput=document.getElementById('pda-accrual');
  const payout=payoutInput.value||null,accrual=accrualInput.value||null;
  if(state.pendingPayAccrual){
    if(!completePendingPayAccrual(payout))return;
  }else if(accrual&&!payout){
    if(!startPendingPayAccrual(accrual))return;
  }else{
    if(!payout){toast('Укажи день учёта часов или день выплаты');return}
    if(accrual&&accrual>payout){toast('День учёта часов не может быть позже дня выплаты');return}
    if(state.payDayActuals.some(actual=>actual.payout===payout)){toast('Эта дата выплаты уже отмечена');return}
    state.payDayActuals.push({payout,accrual});
  }
  payoutInput.value='';accrualInput.value='';
  refreshPayActuals();
});

function pendingPayInfo(){
  if(!state.pendingPayAccrual)return null;
  const end=today();
  const events=effectivePayEvents(
    payEventHistoryStart(state.entries,end),end,paySchedule(state.payDays),
    state.payDayActuals,state.pendingPayAccrual
  );
  const period=payPeriodEarned(state.entries,events,state.rate).get(state.pendingPayAccrual);
  const currency=esc(cur());
  const taxRate=Math.max(0,Math.min(1,(Number(state.taxRate)||0)/100));
  const roundedGross=period?forecastMoneyForRoundedHours(period.gross,period.hours,state.rate):0;
  const detail=period
    ?`${fmt(forecastRoundedHours(period.hours))} ч · ${forecastMoney(roundedGross,currency)}`
    :'Сумма появится после импорта часов';
  const taxDetail=period&&taxRate>0
    ?`<span class="tax-inclusive">К выставлению с налогом: <b>${forecastMoney(roundedGross*(1+taxRate),currency)}</b></span>`
    :'';
  return{date:state.pendingPayAccrual,detail,taxDetail};
}

function pendingPayHtml(info){
  if(!info)return'';
  return `<div class="pending-pay-row">
    <div class="pending-pay-heading"><strong>Ждёт выплаты · часы учтены по ${esc(dateRu(info.date,true))}</strong><span>${info.detail}${info.taxDetail}</span></div>
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
  list.innerHTML=pendingPayHtml(pendingPayInfo())+actualHtml
    ||'<small class="note">Нет отмеченных дат — выплаты считаются по дням зп выше.</small>';
  list.querySelector('[data-pda-complete]')?.addEventListener('click',()=>{
    const payout=document.getElementById('pda-pending-payout').value;
    if(completePendingPayAccrual(payout)){
      payoutInput.value='';accrualInput.value='';refreshPayActuals();
    }
  });
  list.querySelector('[data-pda-pending-delete]')?.addEventListener('click',()=>{
    clearPendingPayAccrual();
  });
  const update=()=>refreshPayActuals();
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
    state.payDayActuals.splice(+button.dataset.pdadel,1);update();
  }));
}

function renderHomePayday(){
  const box=document.getElementById('home-payday');
  if(!box)return;
  if(!state.payDays.length){
    box.innerHTML=`<div class="home-payday-layout"><div class="home-payday-copy">
      <span class="home-payday-kicker">Учёт зарплаты</span>
      <strong class="home-payday-title">Сначала настрой день зарплаты</strong>
      <span class="home-payday-detail">После этого часы можно будет закрывать прямо здесь.</span>
    </div><a class="btn quiet sm" href="#settings">Открыть настройки</a></div>`;
    return;
  }
  const info=pendingPayInfo();
  if(!info){
    const todayAccrued=state.payDayActuals.some(actual=>actual.accrual===today());
    if(todayAccrued){
      box.innerHTML=`<div class="home-payday-layout"><div class="home-payday-copy">
        <span class="home-payday-kicker">Расчётный период закрыт</span>
        <strong class="home-payday-title">Часы по сегодня уже учтены</strong>
        <span class="home-payday-detail">Следующий период можно закрыть позднее или указать вручную в настройках.</span>
      </div><a class="btn quiet sm" href="#settings">Открыть настройки</a></div>`;
      return;
    }
    box.innerHTML=`<div class="home-payday-layout"><div class="home-payday-copy">
      <span class="home-payday-kicker">Расчётный период открыт</span>
      <strong class="home-payday-title">Зафиксировать часы по сегодня</strong>
      <span class="home-payday-detail">Выплату можно указать позже, когда деньги придут.</span>
      <span class="home-pay-route" aria-hidden="true"><span class="done"></span><i></i><span></span></span>
    </div><div class="home-payday-actions"><button class="btn primary" data-home-accrue>Учесть часы сегодня</button></div></div>`;
    box.querySelector('[data-home-accrue]').addEventListener('click',()=>{
      openTodayAccrualDialog();
    });
    return;
  }
  box.innerHTML=`<div class="home-payday-layout"><div class="home-payday-copy">
    <span class="home-payday-kicker">Ждёт выплаты</span>
    <strong class="home-payday-title">Часы учтены по ${esc(dateRu(info.date,true))}</strong>
    <span class="home-payday-detail">${info.detail} · дата прихода пока не указана${info.taxDetail}</span>
    <span class="home-pay-route" aria-hidden="true"><span class="done"></span><i></i><span></span></span>
  </div><div class="home-payday-actions">
    <div class="field"><label for="home-payout-date">День выплаты</label><input type="date" id="home-payout-date"></div>
    <button class="btn primary sm" data-home-complete>Указать выплату</button>
    <button class="btn quiet sm" data-home-clear>Удалить ожидание</button>
  </div></div>`;
  box.querySelector('[data-home-complete]').addEventListener('click',()=>{
    if(completePendingPayAccrual(document.getElementById('home-payout-date').value))refreshPayActuals();
  });
  box.querySelector('[data-home-clear]').addEventListener('click',()=>{
    clearPendingPayAccrual();
  });
}

function renderPaydayViews(){
  renderPayDays();renderPayDayActuals();renderHomePayday();
}
