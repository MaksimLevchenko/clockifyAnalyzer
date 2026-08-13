function refreshExpenseViews(){
  saveState();renderExpenses();renderActualExpenses();
  if(document.getElementById('panel-forecast').classList.contains('active'))runForecast(true);
}

function expenseEditorHtml(){
  return `<div class="field"><label for="edit-ex-kind">Тип</label><select id="edit-ex-kind"><option value="monthly">Ежемесячный в выбранный день</option><option value="daily">Равномерно в течение месяца</option><option value="once">Разовый</option></select></div>
    <div class="field"><label for="edit-ex-name">Название</label><input type="text" id="edit-ex-name"></div>
    <div class="form-pair"><div class="field"><label for="edit-ex-mode">Расчёт</label><select id="edit-ex-mode"><option value="fixed">Фиксированная сумма</option><option value="percent">Процент</option></select></div><div class="field"><label for="edit-ex-value" id="edit-ex-value-label">Сумма</label><input type="number" min="0" step="0.01" id="edit-ex-value"></div></div>
    <div class="field" id="edit-ex-base-field"><label for="edit-ex-base">База процента</label><select id="edit-ex-base"><option value="monthlyIncome">Месячный доход активной модели</option><option value="payment">Выплата в этот день</option><option value="balance">Баланс перед списанием</option></select></div>
    <div class="form-pair"><div class="field" id="edit-ex-day-field"><label for="edit-ex-day">День месяца</label><input type="number" min="1" max="28" id="edit-ex-day"></div><div class="field" id="edit-ex-date-field"><label for="edit-ex-date">Дата</label><input type="date" id="edit-ex-date"></div></div>
    <div class="form-pair"><div class="field" id="edit-ex-start-field"><label for="edit-ex-start">Действует с</label><input type="date" id="edit-ex-start"></div><div class="field" id="edit-ex-stop-field"><label for="edit-ex-stop">Остановить с</label><input type="date" id="edit-ex-stop"><small>Оставь пустым, чтобы правило продолжало действовать.</small></div></div>
    <div class="field" id="edit-ex-growth-field"><label for="edit-ex-growth">Рост в год, %</label><input type="number" min="-50" max="100" step="0.5" id="edit-ex-growth"></div>`;
}

function syncExpenseEditor(){
  const kind=document.getElementById('edit-ex-kind').value;
  const percent=document.getElementById('edit-ex-mode').value==='percent';
  document.getElementById('edit-ex-base-field').hidden=!percent;
  document.getElementById('edit-ex-value-label').textContent=percent?'Процент, %':'Сумма';
  document.getElementById('edit-ex-day-field').hidden=kind!=='monthly';
  document.getElementById('edit-ex-date-field').hidden=kind!=='once';
  document.getElementById('edit-ex-start-field').hidden=kind==='once';
  document.getElementById('edit-ex-stop-field').hidden=kind==='once';
  document.getElementById('edit-ex-growth-field').hidden=kind==='once';
  const payment=document.querySelector('#edit-ex-base option[value="payment"]');
  payment.disabled=kind==='daily';
  if(payment.disabled&&payment.selected)document.getElementById('edit-ex-base').value='monthlyIncome';
}

function openExpenseEditor(expense,trigger){
  openEditDialog({eyebrow:'Правило расхода',title:'Изменить расход',trigger,
    html:expenseEditorHtml(),
    onOpen:()=>{
      document.getElementById('edit-ex-kind').value=expense.kind;
      document.getElementById('edit-ex-name').value=expense.name||'';
      document.getElementById('edit-ex-mode').value=expense.amountMode||'fixed';
      document.getElementById('edit-ex-value').value=expense.amountMode==='percent'?expense.percent:expense.amount;
      document.getElementById('edit-ex-base').value=expense.percentBase||'monthlyIncome';
      document.getElementById('edit-ex-day').value=expense.day||1;
      document.getElementById('edit-ex-date').value=expense.date||'';
      document.getElementById('edit-ex-start').value=expense.startDate===INCOME_MODEL_ORIGIN?'':expense.startDate||'';
      document.getElementById('edit-ex-stop').value=expense.endDate?addDays(expense.endDate,1):'';
      document.getElementById('edit-ex-growth').value=expense.growthRate||0;
      document.getElementById('edit-ex-kind').addEventListener('change',syncExpenseEditor);
      document.getElementById('edit-ex-mode').addEventListener('change',syncExpenseEditor);
      syncExpenseEditor();
    },
    onSave:()=>saveExpenseEditor(expense),onDelete:()=>{
      const index=state.expenses.indexOf(expense);if(index<0)return'Запись больше не существует';
      state.expenses.splice(index,1);refreshExpenseViews();toast('Правило расхода удалено');
    },deleteConfirm:'Удалить правило целиком? Его прошлое влияние тоже исчезнет из расчётов.'});
}

function saveExpenseEditor(expense){
  if(!state.expenses.includes(expense))return'Запись больше не существует';
  const kind=document.getElementById('edit-ex-kind').value;
  const mode=document.getElementById('edit-ex-mode').value;
  const value=Number(document.getElementById('edit-ex-value').value);
  if(!Number.isFinite(value)||value<0)return mode==='percent'?'Укажи корректный процент':'Укажи корректную сумму';
  const date=document.getElementById('edit-ex-date').value;
  const start=kind==='once'?date:document.getElementById('edit-ex-start').value||INCOME_MODEL_ORIGIN;
  if(kind==='once'&&!date)return'Укажи дату';
  const stop=document.getElementById('edit-ex-stop').value;
  if(kind!=='once'&&stop&&stop<=start)return'Дата остановки должна быть позже даты начала';
  const next={kind,name:document.getElementById('edit-ex-name').value||'Расход',amount:mode==='fixed'?value:0,
    percent:mode==='percent'?value:0,amountMode:mode,percentBase:document.getElementById('edit-ex-base').value,
    growthRate:kind==='once'?0:Math.max(-50,Math.min(100,Number(document.getElementById('edit-ex-growth').value)||0)),
    startDate:start,endDate:kind==='once'?null:(stop?addDays(stop,-1):null)};
  if(kind==='monthly')next.day=Math.min(28,Math.max(1,parseInt(document.getElementById('edit-ex-day').value)||1));
  if(kind==='once')next.date=date;
  Object.keys(expense).forEach(key=>delete expense[key]);Object.assign(expense,next);
  refreshExpenseViews();toast('Правило расхода изменено');
}
