function refreshPayDayEditorViews(){
  saveState();renderPaydayViews();afterPayDaysChange();
}

function openPayDayEditor(day,trigger){
  openEditDialog({eyebrow:'Базовое расписание',title:'Изменить день зарплаты',trigger,
    html:`<div class="field"><label for="edit-pd-day">День месяца</label><input type="number" min="1" max="28" id="edit-pd-day" value="${day}"><small>День закрывает период часов; деньги по умолчанию приходят в этот же день.</small></div>`,
    onSave:()=>{
      const index=state.payDays.indexOf(day);if(index<0)return'Запись больше не существует';
      const value=parseInt(document.getElementById('edit-pd-day').value);
      if(!Number.isInteger(value)||value<1||value>28)return'Укажи день от 1 до 28';
      if(state.payDays.some((item,itemIndex)=>itemIndex!==index&&item===value))return'Этот день уже добавлен';
      state.payDays[index]=value;refreshPayDayEditorViews();toast('День зарплаты изменён');
    },onDelete:()=>{
      const index=state.payDays.indexOf(day);if(index<0)return'Запись больше не существует';
      if(state.pendingPayAccrual&&state.payDays.length===1)return'Сначала укажи выплату или удали ожидание';
      state.payDays.splice(index,1);refreshPayDayEditorViews();toast('День зарплаты удалён');
    },deleteConfirm:'Удалить этот день зарплаты из базового расписания?'});
}

function openPayDayActualEditor(actual,trigger){
  openEditDialog({eyebrow:'Исключение из расписания',title:'Изменить фактическую выплату',trigger,
    html:`<div class="form-pair"><div class="field"><label for="edit-pda-payout">День выплаты</label><input type="date" id="edit-pda-payout" value="${esc(actual.payout)}"></div><div class="field"><label for="edit-pda-accrual">Учтены часы по</label><input type="date" id="edit-pda-accrual" value="${esc(actual.accrual||'')}"><small>Пусто — по базовому расписанию.</small></div></div>`,
    onSave:()=>{
      if(!state.payDayActuals.includes(actual))return'Запись больше не существует';
      const payout=document.getElementById('edit-pda-payout').value;
      const accrual=document.getElementById('edit-pda-accrual').value||null;
      if(!payout)return'Укажи день выплаты';if(accrual&&accrual>payout)return'День учёта часов не может быть позже дня выплаты';
      if(accrual&&accrual===state.pendingPayAccrual)return'Эта дата уже ждёт выплаты';
      if(state.payDayActuals.some(item=>item!==actual&&item.payout===payout))return'Эта дата выплаты уже отмечена';
      Object.assign(actual,{payout,accrual});refreshPayActuals();toast('Фактическая выплата изменена');
    },onDelete:()=>{
      const index=state.payDayActuals.indexOf(actual);if(index<0)return'Запись больше не существует';
      state.payDayActuals.splice(index,1);refreshPayActuals();toast('Фактическая выплата удалена');
    },deleteConfirm:'Удалить эту фактическую выплату? Расчёт прошлых периодов изменится.'});
}

function openPendingPayEditor(trigger){
  const original=state.pendingPayAccrual;if(!original)return;
  openEditDialog({eyebrow:'Ожидание выплаты',title:'Изменить ожидание',trigger,
    html:`<div class="form-pair"><div class="field"><label for="edit-pending-accrual">Учтены часы по</label><input type="date" id="edit-pending-accrual" value="${esc(original)}"></div><div class="field"><label for="edit-pending-payout">День выплаты</label><input type="date" id="edit-pending-payout"><small>Оставь пустым, если деньги ещё не пришли.</small></div></div>`,
    onSave:()=>{
      if(state.pendingPayAccrual!==original)return'Запись больше не существует';
      const accrual=document.getElementById('edit-pending-accrual').value;
      const payout=document.getElementById('edit-pending-payout').value||null;
      if(!accrual)return'Укажи день учёта часов';if(accrual>today())return'День учёта часов не может быть в будущем';
      if(state.payDayActuals.some(item=>item.accrual===accrual))return'Часы за эту дату уже учтены';
      if(payout&&payout<accrual)return'День выплаты не может быть раньше дня учёта часов';
      if(payout&&state.payDayActuals.some(item=>item.payout===payout))return'Эта дата выплаты уже отмечена';
      state.pendingPayAccrual=accrual;
      if(payout){state.payDayActuals.push({payout,accrual});state.pendingPayAccrual=null}
      refreshPayActuals();toast(payout?'Выплата указана':'Ожидание изменено');
    },onDelete:()=>{
      if(state.pendingPayAccrual!==original)return'Запись больше не существует';
      clearPendingPayAccrual();toast('Ожидание удалено');
    },deleteConfirm:'Удалить ожидание выплаты? Учтённые часы снова станут открытыми.'});
}
