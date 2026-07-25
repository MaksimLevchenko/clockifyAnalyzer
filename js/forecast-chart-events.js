const FC_EVENT_COLORS={
  expense:'#b1462c',
  income:'#2f6b4f',
  payout:'#a9792a',
  accrual:'#74588f',
  checkpoint:'#d09a32',
  target:'#c96c4c',
  vacation:'#66859a'
};

let fcEventCache=null;

function addForecastEvent(map,date,event,leftLimit,endDate){
  if(!date||date<leftLimit||date>endDate)return;
  if(!map.has(date))map.set(date,[]);
  map.get(date).push(event);
}

function buildForecastEvents(r,leftLimit,endDate){
  if(fcEventCache&&fcEventCache.result===r&&fcEventCache.leftLimit===leftLimit&&fcEventCache.endDate===endDate)
    return fcEventCache.events;
  const events=new Map();
  const range=dateRange(leftLimit,endDate);
  for(const expense of state.expenses){
    if(expense.kind==='once'){
      addForecastEvent(events,expense.date,{
        type:'expense',title:expense.name||'Разовый расход',
        amount:expenseAmountOnDate(expense,expense.date,today())
      },leftLimit,endDate);
      continue;
    }
    for(const date of range){
      const amount=expenseAmountOnDate(expense,date,today());
      if(!amount)continue;
      /* Daily background costs stay in tooltips without turning the event rail into a solid bar. */
      addForecastEvent(events,date,{
        type:'expense',title:expense.name||'Расход',amount,
        background:expense.kind==='daily'
      },leftLimit,endDate);
    }
  }
  if(r.autoEstimate&&r.autoEstimate.value){
    for(const date of range)addForecastEvent(events,date,{
      type:'expense',title:'Авто-расход по чекпоинтам',
      amount:Number(r.autoEstimate.value)/daysInMonth(date),background:true
    },leftLimit,endDate);
  }
  for(const income of state.incomes)addForecastEvent(events,income.date,{
    type:'income',title:income.name||'Пополнение',amount:Number(income.amount)||0
  },leftLimit,endDate);

  const schedule=paySchedule(state.payDays);
  const payEvents=schedule.length
    ?effectivePayEvents(leftLimit,endDate,schedule,state.payDayActuals)
    :[];
  const earned=payPeriodEarned(state.entries,payEvents,state.rate);
  for(const event of payEvents){
    const period=earned.get(event.accrual);
    const known=event.accrual<=today()&&period;
    addForecastEvent(events,event.accrual,{
      type:'accrual',title:'Дата учёта часов',
      meta:known?`${Number(period.hours||0).toFixed(1)} ч`:'Закрытие расчётного периода'
    },leftLimit,endDate);
    addForecastEvent(events,event.payout,{
      type:'payout',title:'Выплата зарплаты',
      amount:known?Number(period.gross)||0:null
    },leftLimit,endDate);
  }

  const targetProb=new Map((r.targetReachProb||[]).map(item=>[item.date,item.prob]));
  for(const checkpoint of state.checkpoints){
    const target=checkpoint.kind==='target';
    addForecastEvent(events,checkpoint.date,{
      type:target?'target':'checkpoint',
      title:target?'Целевой баланс':'Фактический чекпоинт',
      amount:Number(checkpoint.balance)||0,
      meta:targetProb.has(checkpoint.date)
        ?`Достижимость ${(targetProb.get(checkpoint.date)*100).toFixed(0)}%`
        :null
    },leftLimit,endDate);
  }
  for(const vacation of state.vacations||[]){
    const start=vacation.from||vacation.date;
    const end=vacation.to||start;
    if(!start||!end)continue;
    const visibleStart=start<leftLimit?leftLimit:start;
    const visibleEnd=end>endDate?endDate:end;
    if(visibleStart>visibleEnd)continue;
    for(const date of dateRange(visibleStart,visibleEnd))addForecastEvent(events,date,{
      type:'vacation',title:vacation.name||'Нерабочий день',background:true
    },leftLimit,endDate);
  }
  fcEventCache={result:r,leftLimit,endDate,events};
  return events;
}

function forecastEventHtml(event,currency){
  const amount=event.amount==null?'':`${fmt(event.amount)} ${currency}`;
  const detail=event.meta||amount;
  return `<span class="tip-event" style="--event-color:${FC_EVENT_COLORS[event.type]}"><span>${esc(event.title)}</span>${detail?`<span class="amount">${esc(detail)}</span>`:''}</span>`;
}

function forecastTooltip(date,balance,events,currency){
  const header=`<b class="tip-date">${esc(dateRu(date,true))} · ${WD[wd(date)]}</b>`;
  const value=balance.kind==='past'
    ?`Фактический баланс: <b>${fmt(balance.value)} ${currency}</b>`
    :`Средний баланс: <b>${fmt(balance.value)} ${currency}</b><br><span class="sub">80%: ${fmt(balance.low)} — ${fmt(balance.high)} ${currency}</span>`;
  const visibleEvents=events.filter(event=>fcLayers.has(event.type));
  return header+value+(visibleEvents.length
    ?`<span class="tip-events">${visibleEvents.map(event=>forecastEventHtml(event,currency)).join('')}</span>`
    :'');
}
