const INCOME_MODEL_ORIGIN='0001-01-01';

function normalizePaymentRules(raw,type,fallbackDays){
  const source=Array.isArray(raw)&&raw.length
    ?raw
    :(fallbackDays||[]).map(day=>({day,mode:type==='salary'?'percent':'accrued',value:type==='salary'?100:0}));
  const seen=new Set(),out=[];
  for(const item of source){
    const day=Math.min(28,Math.max(1,parseInt(item&&item.day)||1));
    if(seen.has(day))continue;
    seen.add(day);
    if(type==='salary'){
      const mode=item&&item.mode==='amount'?'amount':'percent';
      out.push({day,mode,value:Math.max(0,Number(item&&item.value)||0)});
    }else out.push({day,mode:'accrued',value:0});
  }
  return out.sort((a,b)=>a.day-b.day).slice(0,4);
}

function normalizeIncomeModels(raw,state){
  const legacy={
    id:'legacy',effectiveFrom:INCOME_MODEL_ORIGIN,type:'hourly',
    rate:Math.max(0,Number(state.rate)||0),monthlySalary:0,
    halfLife:Math.max(7,Math.min(365,Number(state.halfLife)||60)),
    taxRate:Math.max(0,Math.min(100,Number(state.taxRate)||0)),
    payments:normalizePaymentRules(null,'hourly',state.payDays)
  };
  const source=Array.isArray(raw)&&raw.length?raw:[legacy];
  const byDate=new Map();
  for(const item of source){
    if(!item||typeof item!=='object')continue;
    const effectiveFrom=/^\d{4}-\d{2}-\d{2}$/.test(item.effectiveFrom||'')
      ?item.effectiveFrom:INCOME_MODEL_ORIGIN;
    const type=item.type==='salary'?'salary':'hourly';
    byDate.set(effectiveFrom,{
      id:String(item.id||effectiveFrom),effectiveFrom,type,
      rate:Math.max(0,Number(item.rate)||0),
      monthlySalary:Math.max(0,Number(item.monthlySalary)||0),
      halfLife:Math.max(7,Math.min(365,Number(item.halfLife)||60)),
      taxRate:Math.max(0,Math.min(100,Number(item.taxRate)||0)),
      payments:normalizePaymentRules(item.payments,type,
        type==='hourly'&&effectiveFrom===INCOME_MODEL_ORIGIN?state.payDays:null)
    });
  }
  if(!byDate.has(INCOME_MODEL_ORIGIN))byDate.set(INCOME_MODEL_ORIGIN,legacy);
  return [...byDate.values()].sort((a,b)=>a.effectiveFrom<b.effectiveFrom?-1:1);
}

function incomeModelAt(models,date){
  let active=models[0];
  for(const model of models){
    if(model.effectiveFrom>date)break;
    active=model;
  }
  return active;
}

function incomeModelEnd(models,index){
  return index+1<models.length?addDays(models[index+1].effectiveFrom,-1):null;
}

function salaryPaymentAmount(model,rule){
  if(!model||model.type!=='salary'||!rule)return 0;
  return rule.mode==='amount'
    ?Number(rule.value)||0
    :(Number(model.monthlySalary)||0)*(Number(rule.value)||0)/100;
}

function salaryPaymentOnDate(model,date){
  if(!model||model.type!=='salary')return 0;
  const day=Number(date.slice(8,10));
  return model.payments.reduce((sum,rule)=>sum+(rule.day===day?salaryPaymentAmount(model,rule):0),0);
}

function nextModelPaymentDate(date,model){
  if(!model.payments.length)return date;
  for(let offset=0;offset<=62;offset++){
    const candidate=addDays(date,offset);
    if(model.payments.some(rule=>rule.day===Number(candidate.slice(8,10))))return candidate;
  }
  return date;
}

function actualIncomeModel(models,actual){
  const accrual=actual&&typeof actual==='object'?actual.accrual:null;
  const payout=typeof actual==='string'?actual:actual&&actual.payout;
  if(accrual)return incomeModelAt(models,accrual);
  if(!payout)return null;
  const active=incomeModelAt(models,payout);
  if(active.type==='hourly')return active;
  for(let i=models.length-1;i>=0;i--){
    const model=models[i];
    if(model.type!=='hourly'||model.effectiveFrom>payout)continue;
    const end=incomeModelEnd(models,i);
    if(end&&end<=payout&&daysBetween(end,payout)<=MAX_PAYOUT_DELAY)return model;
  }
  return null;
}

function hourlyPaymentEvents(models,actuals,pendingAccrual,start,end){
  const byModel=new Map();
  for(const model of models){
    if(model.type!=='hourly'||!model.payments.length)continue;
    const modelActuals=(actuals||[]).filter(actual=>actualIncomeModel(models,actual)===model);
    const modelPending=pendingAccrual&&incomeModelAt(models,pendingAccrual)===model
      ?pendingAccrual:null;
    const events=effectivePayEvents(
      addDays(start,-45),addDays(end,62),
      paySchedule(model.payments.map(payment=>payment.day)),modelActuals,modelPending
    ).sort((a,b)=>a.accrual<b.accrual?-1:1);
    byModel.set(model.id,events);
  }
  return byModel;
}

function hourlyPaymentEvent(date,model,eventsByModel){
  if(!model.payments.length)return null;
  const events=eventsByModel.get(model.id)||[];
  return events.find(item=>item.accrual>=date)||null;
}

function hourlyPayoutDate(date,model,eventsByModel){
  const event=hourlyPaymentEvent(date,model,eventsByModel);
  return event?event.payout:nextModelPaymentDate(date,model);
}

function incomeModelLabel(model){return model.type==='salary'?'Оклад':'Почасовая'}

function timelineIncomeByDay(entries,models,start,end,actuals,pendingAccrual){
  const result=new Map();
  const firstEntry=(entries||[]).reduce((first,entry)=>!first||entry.date<first?entry.date:first,null);
  const events=hourlyPaymentEvents(models,actuals,pendingAccrual,firstEntry||start,end);
  for(const date of dateRange(start,end)){
    const model=incomeModelAt(models,date),amount=salaryPaymentOnDate(model,date);
    if(amount)result.set(date,(result.get(date)||0)+amount);
  }
  for(const entry of entries||[]){
    const model=incomeModelAt(models,entry.date);
    if(model.type!=='hourly')continue;
    const payout=hourlyPayoutDate(entry.date,model,events);
    if(!payout)continue;
    if(payout<start||payout>end)continue;
    const rate=model.effectiveFrom===INCOME_MODEL_ORIGIN&&Number(entry.rate)>0
      ?Number(entry.rate):Number(model.rate)||0;
    result.set(payout,(result.get(payout)||0)+(Number(entry.hours)||0)*rate);
  }
  return result;
}

function timelineHourlyIncomeByMonth(entries,models){
  const result=new Map();
  for(const entry of entries||[]){
    const model=incomeModelAt(models,entry.date);if(model.type!=='hourly')continue;
    const key=entry.date.slice(0,7),rate=model.effectiveFrom===INCOME_MODEL_ORIGIN&&Number(entry.rate)>0
      ?Number(entry.rate):Number(model.rate)||0;
    result.set(key,(result.get(key)||0)+(Number(entry.hours)||0)*rate);
  }
  return result;
}
