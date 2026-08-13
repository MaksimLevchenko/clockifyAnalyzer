let incomeModelEditPayments=[];

function incomeModelEditorHtml(base){
  return `${base?'':`<div class="form-pair"><div class="field"><label for="edit-im-date">Действует с</label><input type="date" id="edit-im-date"></div><div class="field"><label for="edit-im-type">Тип дохода</label><select id="edit-im-type"><option value="hourly">Почасовой</option><option value="salary">Окладный</option></select></div></div>`}
    <div class="settings-grid"><div class="field" id="edit-im-rate-field"><label for="edit-im-rate">Ставка в час</label><input type="number" min="0" step="0.01" id="edit-im-rate"></div><div class="field" id="edit-im-salary-field"><label for="edit-im-salary">Месячный оклад</label><input type="number" min="0" step="0.01" id="edit-im-salary"></div><div class="field"><label for="edit-im-half-life">Вес свежей истории, дней</label><input type="number" min="7" max="365" id="edit-im-half-life"></div><div class="field"><label for="edit-im-tax">Налог работодателя, %</label><input type="number" min="0" max="100" step="0.5" id="edit-im-tax"></div></div>
    ${base?'':`<fieldset class="payment-builder"><legend>Выплаты версии</legend><div class="form-strip"><div class="field"><label for="edit-im-pay-day">День месяца</label><input type="number" min="1" max="28" value="1" id="edit-im-pay-day"></div><div class="field" id="edit-im-pay-mode-field"><label for="edit-im-pay-mode">Как задать</label><select id="edit-im-pay-mode"><option value="percent">Процент оклада</option><option value="amount">Фиксированная сумма</option></select></div><div class="field" id="edit-im-pay-value-field"><label for="edit-im-pay-value">Значение</label><input type="number" min="0" step="0.01" value="100" id="edit-im-pay-value"></div><button type="button" class="btn secondary" id="edit-im-pay-add">Добавить день</button></div><div class="payment-draft" id="edit-im-pay-list"></div></fieldset>`}`;
}

function renderIncomeModelEditPayments(){
  const list=document.getElementById('edit-im-pay-list');if(!list)return;
  const type=document.getElementById('edit-im-type').value;
  const model={type,monthlySalary:Number(document.getElementById('edit-im-salary').value)||0};
  list.innerHTML=incomeModelEditPayments.length?incomeModelEditPayments.map((rule,index)=>
    `<span class="payment-chip">${incomePaymentText(model,rule)}<button type="button" data-edit-im-pay-delete="${index}" aria-label="Удалить день выплаты">×</button></span>`
  ).join(''):'<small class="note">Без дней почасовой доход поступает ежедневно.</small>';
  list.querySelectorAll('[data-edit-im-pay-delete]').forEach(button=>button.addEventListener('click',()=>{
    incomeModelEditPayments.splice(+button.dataset.editImPayDelete,1);renderIncomeModelEditPayments();
  }));
}

function syncIncomeModelEditorType(){
  const salary=document.getElementById('edit-im-type')?.value==='salary';
  document.getElementById('edit-im-rate-field').hidden=salary;
  document.getElementById('edit-im-salary-field').hidden=!salary;
  document.getElementById('edit-im-pay-mode-field')?.toggleAttribute('hidden',!salary);
  document.getElementById('edit-im-pay-value-field')?.toggleAttribute('hidden',!salary);
  incomeModelEditPayments=incomeModelEditPayments.map(rule=>salary
    ?{day:rule.day,mode:rule.mode==='amount'?'amount':'percent',
      value:rule.mode==='accrued'?100:Math.max(0,Number(rule.value)||0)}
    :{day:rule.day,mode:'accrued',value:0});
  renderIncomeModelEditPayments();
}

function refreshIncomeModelEditorViews(){
  saveState();renderIncomeModels();renderTicker();renderActualExpenses();renderHomePayday();
  if(document.getElementById('panel-forecast').classList.contains('active'))runForecast(true);
}

function openIncomeModelEditor(model,trigger){
  const base=model.effectiveFrom===INCOME_MODEL_ORIGIN;
  openEditDialog({eyebrow:base?'Базовая версия':'Версия дохода',title:'Изменить модель дохода',trigger,
    html:incomeModelEditorHtml(base),onOpen:()=>{
      if(!base){
        document.getElementById('edit-im-date').value=model.effectiveFrom;
        document.getElementById('edit-im-type').value=model.type;
        incomeModelEditPayments=model.payments.map(rule=>({...rule}));
        document.getElementById('edit-im-type').addEventListener('change',syncIncomeModelEditorType);
        document.getElementById('edit-im-salary').addEventListener('input',renderIncomeModelEditPayments);
        document.getElementById('edit-im-pay-add').addEventListener('click',addIncomeModelEditPayment);
      }
      document.getElementById('edit-im-rate').value=model.rate;
      document.getElementById('edit-im-salary').value=model.monthlySalary;
      document.getElementById('edit-im-half-life').value=model.halfLife;
      document.getElementById('edit-im-tax').value=model.taxRate;
      if(base){document.getElementById('edit-im-salary-field').hidden=true}
      else syncIncomeModelEditorType();
    },onSave:()=>saveIncomeModelEditor(model,base),onDelete:base?null:()=>{
      const index=state.incomeModels.indexOf(model);if(index<0)return'Запись больше не существует';
      state.incomeModels.splice(index,1);refreshIncomeModelEditorViews();toast('Версия дохода удалена');
    },deleteConfirm:'Удалить эту версию? Предыдущая модель продолжит действовать до следующего перехода.'});
}

function addIncomeModelEditPayment(){
  if(incomeModelEditPayments.length>=4){editDialogError('Максимум 4 дня выплаты');return}
  const day=Math.min(28,Math.max(1,parseInt(document.getElementById('edit-im-pay-day').value)||1));
  if(incomeModelEditPayments.some(rule=>rule.day===day)){editDialogError('Этот день уже добавлен');return}
  const salary=document.getElementById('edit-im-type').value==='salary';
  incomeModelEditPayments.push({day,mode:salary?document.getElementById('edit-im-pay-mode').value:'accrued',
    value:salary?Math.max(0,Number(document.getElementById('edit-im-pay-value').value)||0):0});
  incomeModelEditPayments.sort((a,b)=>a.day-b.day);editDialogError('');renderIncomeModelEditPayments();
}

function saveIncomeModelEditor(model,base){
  if(!state.incomeModels.includes(model))return'Запись больше не существует';
  const rate=Math.max(0,Number(document.getElementById('edit-im-rate').value)||0);
  const halfLife=Math.max(7,Math.min(365,Number(document.getElementById('edit-im-half-life').value)||60));
  const taxRate=Math.max(0,Math.min(100,Number(document.getElementById('edit-im-tax').value)||0));
  if(base){
    state.rate=rate;state.halfLife=halfLife;state.taxRate=taxRate;
  }else{
    const effectiveFrom=document.getElementById('edit-im-date').value;
    const type=document.getElementById('edit-im-type').value;
    const monthlySalary=Math.max(0,Number(document.getElementById('edit-im-salary').value)||0);
    if(!effectiveFrom)return'Укажи дату перехода';
    if(state.incomeModels.some(item=>item!==model&&item.effectiveFrom===effectiveFrom))return'На эту дату уже есть версия дохода';
    if(type==='hourly'&&!rate)return'Укажи часовую ставку';
    if(type==='salary'&&!monthlySalary)return'Укажи месячный оклад';
    if(type==='salary'&&!incomeModelEditPayments.length)return'Добавь хотя бы один день выплаты';
    Object.assign(model,{effectiveFrom,type,rate,monthlySalary,halfLife,taxRate,
      payments:normalizePaymentRules(incomeModelEditPayments,type)});
    state.incomeModels=normalizeIncomeModels(state.incomeModels,state);
  }
  refreshIncomeModelEditorViews();toast('Модель дохода изменена');
}
