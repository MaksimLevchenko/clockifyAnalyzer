function refreshPlanItemViews(kind){
  saveState();
  if(kind==='income'){renderIncomes();renderActualExpenses()}
  if(kind==='vacation')renderVacations();
  if(kind==='checkpoint'){
    pruneStaleExclusions();renderCheckpoints();renderActualExpenses();renderTicker();renderDataStats();
  }
  if(document.getElementById('panel-forecast').classList.contains('active'))runForecast(true);
}

function openPlanItemEditor(kind,item,trigger){
  const configs={
    income:{eyebrow:'Разовое поступление',title:'Изменить поступление',html:`<div class="field"><label for="edit-inc-name">Название</label><input id="edit-inc-name"></div><div class="form-pair"><div class="field"><label for="edit-inc-amount">Сумма</label><input type="number" step="0.01" id="edit-inc-amount"></div><div class="field"><label for="edit-inc-date">Дата</label><input type="date" id="edit-inc-date"></div></div>`},
    vacation:{eyebrow:'Нерабочий период',title:'Изменить период',html:`<div class="field"><label for="edit-vac-name">Название</label><input id="edit-vac-name"></div><div class="form-pair"><div class="field"><label for="edit-vac-from">Начало</label><input type="date" id="edit-vac-from"></div><div class="field"><label for="edit-vac-to">Конец</label><input type="date" id="edit-vac-to"></div></div>`},
    checkpoint:{eyebrow:'Запись баланса',title:'Изменить баланс',html:`<div class="form-pair"><div class="field"><label for="edit-cp-date">Дата</label><input type="date" id="edit-cp-date"></div><div class="field"><label for="edit-cp-amount">Баланс</label><input type="number" step="0.01" id="edit-cp-amount"></div></div><div class="field"><label for="edit-cp-kind">Тип записи</label><select id="edit-cp-kind"><option value="actual">Фактический баланс</option><option value="target">Финансовая цель</option></select></div>`}
  };
  const config=configs[kind];
  openEditDialog({...config,trigger,onOpen:()=>fillPlanEditor(kind,item),
    onSave:()=>savePlanItem(kind,item),onDelete:()=>deletePlanItem(kind,item),
    deleteConfirm:kind==='checkpoint'?'Удалить эту запись баланса? Расчёт прогноза изменится.':
      kind==='vacation'?'Удалить этот нерабочий период?':'Удалить это поступление?'});
}

function fillPlanEditor(kind,item){
  if(kind==='income'){
    document.getElementById('edit-inc-name').value=item.name||'';
    document.getElementById('edit-inc-amount').value=item.amount;
    document.getElementById('edit-inc-date').value=item.date;
  }else if(kind==='vacation'){
    document.getElementById('edit-vac-name').value=item.name||'';
    document.getElementById('edit-vac-from').value=item.from;
    document.getElementById('edit-vac-to').value=item.to;
  }else{
    document.getElementById('edit-cp-date').value=item.date;
    document.getElementById('edit-cp-amount').value=item.balance;
    document.getElementById('edit-cp-kind').value=item.kind||'actual';
  }
}

function planCollection(kind){
  return kind==='income'?state.incomes:kind==='vacation'?state.vacations:state.checkpoints;
}

function savePlanItem(kind,item){
  if(!planCollection(kind).includes(item))return'Запись больше не существует';
  if(kind==='income'){
    const date=document.getElementById('edit-inc-date').value;
    const amount=Number(document.getElementById('edit-inc-amount').value);
    if(!date)return'Укажи дату';if(!Number.isFinite(amount))return'Укажи корректную сумму';
    Object.assign(item,{name:document.getElementById('edit-inc-name').value||'Поступление',amount,date});
  }else if(kind==='vacation'){
    const from=document.getElementById('edit-vac-from').value,to=document.getElementById('edit-vac-to').value;
    if(!from||!to)return'Укажи даты периода';if(from>to)return'Дата начала позже даты конца';
    Object.assign(item,{name:document.getElementById('edit-vac-name').value||'',from,to});
  }else{
    const date=document.getElementById('edit-cp-date').value,amount=Number(document.getElementById('edit-cp-amount').value);
    if(!date)return'Укажи дату';if(!Number.isFinite(amount))return'Укажи корректную сумму';
    if(state.checkpoints.some(point=>point!==item&&point.date===date))return'Чекпоинт на эту дату уже есть';
    Object.assign(item,{date,balance:amount,kind:document.getElementById('edit-cp-kind').value});
  }
  refreshPlanItemViews(kind);toast('Изменения сохранены');
}

function deletePlanItem(kind,item){
  const collection=planCollection(kind),index=collection.indexOf(item);
  if(index<0)return'Запись больше не существует';
  collection.splice(index,1);refreshPlanItemViews(kind);toast('Запись удалена');
}
