let incomePaymentDraft=[];

function incomePaymentText(model,rule){
  if(model.type==='hourly')return `${rule.day} числа · накопленное по часам`;
  const value=rule.mode==='amount'
    ?`${fmt(rule.value)} ${esc(cur())}`
    :`${fmt(rule.value)}% · ${fmt(salaryPaymentAmount(model,rule))} ${esc(cur())}`;
  return `${rule.day} числа · ${value}`;
}

function renderIncomeModels(){
  const list=document.getElementById('im-list');if(!list)return;
  const models=state.incomeModels;
  list.innerHTML=models.map((model,index)=>{
    const end=incomeModelEnd(models,index);
    const period=index===0
      ?`до ${end?dateRu(end,true):'настоящего времени'}`
      :`${dateRu(model.effectiveFrom,true)}${end?` — ${dateRu(end,true)}`:' — дальше'}`;
    const metric=model.type==='salary'
      ?`${fmt(model.monthlySalary)} ${esc(cur())}/мес`
      :`${fmt(model.rate)} ${esc(cur())}/ч`;
    const payments=model.payments.length
      ?model.payments.map(rule=>`<li>${incomePaymentText(model,rule)}</li>`).join('')
      :'<li>Доход поступает ежедневно</li>';
    return `<article class="income-version ${model.type}">
      <div class="income-version-date"><span>${index===0?'База':esc(dateRu(model.effectiveFrom,true))}</span><i></i></div>
      <div class="income-version-body">
        <div class="income-version-heading"><div><span class="pill ${model.type==='salary'?'m':'d'}">${incomeModelLabel(model)}</span><strong>${metric}</strong></div>
          ${itemEditButton('Редактировать версию дохода',`data-im-edit="${index}"`)}</div>
        <small>${period} · налог ${fmt(model.taxRate)}% · вес истории ${model.halfLife} дн.</small>
        <ul>${payments}</ul>
      </div>
    </article>`;
  }).join('');
  list.querySelectorAll('[data-im-edit]').forEach(button=>button.addEventListener('click',()=>{
    const model=state.incomeModels[+button.dataset.imEdit];
    if(model)openIncomeModelEditor(model,button);
  }));
}

function renderIncomePaymentDraft(){
  const model={
    type:document.getElementById('im-type').value,
    monthlySalary:Number(document.getElementById('im-salary').value)||0
  };
  const list=document.getElementById('im-pay-list');
  list.innerHTML=incomePaymentDraft.length?incomePaymentDraft.map((rule,index)=>
    `<span class="payment-chip">${incomePaymentText(model,rule)}<button type="button" data-im-pay-delete="${index}" aria-label="Удалить день выплаты">×</button></span>`
  ).join(''):'<small class="note">Добавь до четырёх дней. Без дней почасовой доход поступает ежедневно.</small>';
  list.querySelectorAll('[data-im-pay-delete]').forEach(button=>button.addEventListener('click',()=>{
    incomePaymentDraft.splice(+button.dataset.imPayDelete,1);renderIncomePaymentDraft();
  }));
  const total=document.getElementById('im-total');
  if(model.type==='salary'){
    const sum=incomePaymentDraft.reduce((value,rule)=>value+salaryPaymentAmount(model,rule),0);
    total.textContent=`План выплат: ${fmt(sum)} ${cur()} за месяц`;
  }else total.textContent='В дни выплаты поступает накопленный почасовой доход.';
}

function syncIncomeFormType(){
  const salary=document.getElementById('im-type').value==='salary';
  document.getElementById('im-rate-field').hidden=salary;
  document.getElementById('im-salary-field').hidden=!salary;
  document.querySelectorAll('.salary-payment-field').forEach(field=>field.hidden=!salary);
  incomePaymentDraft=incomePaymentDraft.map(rule=>salary
    ?{day:rule.day,mode:rule.mode==='amount'?'amount':'percent',value:rule.value||100}
    :{day:rule.day,mode:'accrued',value:0});
  renderIncomePaymentDraft();
}

document.getElementById('im-type').addEventListener('change',syncIncomeFormType);
document.getElementById('im-salary').addEventListener('input',renderIncomePaymentDraft);
document.getElementById('im-pay-add').addEventListener('click',()=>{
  if(incomePaymentDraft.length>=4){toast('Максимум 4 дня выплаты');return}
  const day=Math.min(28,Math.max(1,parseInt(document.getElementById('im-pay-day').value)||1));
  if(incomePaymentDraft.some(rule=>rule.day===day)){toast('Этот день уже добавлен');return}
  const salary=document.getElementById('im-type').value==='salary';
  incomePaymentDraft.push({day,mode:salary?document.getElementById('im-pay-mode').value:'accrued',
    value:salary?Math.max(0,Number(document.getElementById('im-pay-value').value)||0):0});
  incomePaymentDraft.sort((a,b)=>a.day-b.day);renderIncomePaymentDraft();
});

document.getElementById('im-add').addEventListener('click',()=>{
  const date=document.getElementById('im-date').value;
  if(!date){toast('Укажи дату перехода');return}
  if(state.incomeModels.some(model=>model.effectiveFrom===date)){toast('На эту дату уже есть версия дохода');return}
  const type=document.getElementById('im-type').value;
  const rate=Math.max(0,Number(document.getElementById('im-rate').value)||0);
  const monthlySalary=Math.max(0,Number(document.getElementById('im-salary').value)||0);
  if(type==='hourly'&&!rate){toast('Укажи часовую ставку');return}
  if(type==='salary'&&!monthlySalary){toast('Укажи месячный оклад');return}
  if(type==='salary'&&!incomePaymentDraft.length){toast('Добавь хотя бы один день выплаты');return}
  state.incomeModels.push({
    id:`model-${date}-${Date.now()}`,effectiveFrom:date,type,rate,monthlySalary,
    halfLife:Math.max(7,Math.min(365,Number(document.getElementById('im-half-life').value)||60)),
    taxRate:Math.max(0,Math.min(100,Number(document.getElementById('im-tax').value)||0)),
    payments:incomePaymentDraft
  });
  state.incomeModels=normalizeIncomeModels(state.incomeModels,state);
  incomePaymentDraft=[];saveState();renderIncomeModels();renderIncomePaymentDraft();
  document.getElementById('im-form-shell').open=false;
  renderTicker();renderActualExpenses();
  if(document.getElementById('panel-forecast').classList.contains('active'))runForecast(true);
  toast('Переход добавлен — предыдущая модель сохранена');
});

document.getElementById('im-date').value=today();
document.getElementById('im-rate').value=state.rate;
renderIncomeModels();renderIncomePaymentDraft();
