function forecastMoney(value,currency,sign){
  const number=Number(value)||0;
  const prefix=sign&&number>0?'+':'';
  return `${prefix}${fmt(number)} ${currency}`;
}

function forecastDetail(label,value,extraClass){
  return `<div class="detail-metric${extraClass?` ${extraClass}`:''}">
    <div class="k">${label}</div>
    <div class="v">${value}</div>
  </div>`;
}

function forecastBreakdownLine(label,value,kind){
  return `<div class="line${kind?` ${kind}`:''}"><span>${label}</span><span>${value}</span></div>`;
}

function renderForecastSummary(r,end){
  const currency=esc(cur());
  const days=Math.max(1,r.days.length);
  const monthFactor=30.44/days;
  const monthlyWork=r.totalExpectedWork*monthFactor;
  const monthlyExpenses=r.totalExpenses*monthFactor;
  const monthlyIncomes=r.totalIncomes*monthFactor;
  const monthlyNet=monthlyWork+monthlyIncomes-monthlyExpenses;
  const runway=monthlyExpenses>0?r.startBalance/monthlyExpenses:Infinity;
  const nextSalary=r.nextSalary;
  const salaryValue=nextSalary
    ?forecastMoney(nextSalary.mean,currency,true)
    :'Нет в периоде';
  const salarySub=nextSalary
    ?`${esc(dateRu(nextSalary.date,true))} · коридор ${forecastMoney(nextSalary.p10,currency)}–${forecastMoney(nextSalary.p90,currency)}`
    :(r.payDayDates.length?'Увеличь горизонт прогноза':'Добавь расписание в настройках');
  const unpaidSub=r.unpaidNowHours
    ?`${fmt(r.unpaidNowHours)} ч уже отработано`
    :'Нет неоплаченных часов';
  const scenarioDate=esc(dateRu(end,true));

  const details=[];
  details.push(forecastDetail('Доход от работы в месяц',forecastMoney(monthlyWork,currency)));
  if(monthlyExpenses)details.push(forecastDetail('Расходы в месяц',forecastMoney(monthlyExpenses,currency)));
  details.push(forecastDetail('Изменение за месяц',forecastMoney(monthlyNet,currency,true)));
  if(monthlyExpenses){
    const runwayText=isFinite(runway)?`${runway>=99?'>99':runway.toFixed(1)} мес.`:'∞';
    details.push(forecastDetail('Запас текущего баланса',runwayText));
  }
  details.push(forecastDetail('Абсолютный минимум симуляций',forecastMoney(r.finalMin,currency)));
  details.push(forecastDetail('Абсолютный максимум симуляций',forecastMoney(r.finalMax,currency)));
  details.push(forecastDetail('Риск минуса к дате',`${(r.negativeProb*100).toFixed(1)}%`));
  if(r.midPeriodNegProb!=null){
    details.push(forecastDetail('Риск минуса внутри периода',`${(r.midPeriodNegProb*100).toFixed(1)}%`));
  }

  const breakdown=[];
  breakdown.push(forecastBreakdownLine(`Баланс на ${esc(dateRu(r.startDate,true))}`,forecastMoney(r.startBalance,currency)));
  breakdown.push(forecastBreakdownLine('Ожидаемый доход от работы',forecastMoney(r.totalExpectedWork,currency,true)));
  if(r.initialUnpaid)breakdown.push(forecastBreakdownLine('Ранее заработано и придёт в периоде',forecastMoney(r.initialUnpaid,currency,true)));
  if(r.unpaidAtEnd)breakdown.push(forecastBreakdownLine('Останется невыплаченным к концу',`−${forecastMoney(Math.abs(r.unpaidAtEnd),currency)}`));
  if(r.totalIncomes)breakdown.push(forecastBreakdownLine('Разовые поступления',forecastMoney(r.totalIncomes,currency,true)));
  if(r.totalExpenses)breakdown.push(forecastBreakdownLine('Расходы',`−${forecastMoney(Math.abs(r.totalExpenses),currency)}`));
  if(r.calibrationShift)breakdown.push(forecastBreakdownLine('Калибровка по фактическому балансу',forecastMoney(r.calibrationShift,currency,true)));
  breakdown.push(forecastBreakdownLine(`Ожидаемый баланс на ${scenarioDate}`,forecastMoney(r.finalMedian,currency),'total'));

  let targets='';
  if(r.targetReachProb&&r.targetReachProb.length){
    targets=`<div class="forecast-detail-grid">${r.targetReachProb.map(target=>
      forecastDetail(
        `Цель ${forecastMoney(target.balance,currency)} к ${esc(dateRu(target.date,true))}`,
        `${(target.prob*100).toFixed(0)}%`
      )
    ).join('')}</div>`;
  }

  return `
    <div class="money-rail">
      <article class="money-card balance">
        <div class="k">Баланс по данным</div>
        <div class="v">${forecastMoney(r.startBalance,currency)}</div>
        <div class="sub">${esc(dateRu(r.startDate,true))} · старт прогноза</div>
      </article>
      <article class="money-card">
        <div class="k">Ближайшая зарплата</div>
        <div class="v green">${salaryValue}</div>
        <div class="sub">${salarySub}</div>
      </article>
      <article class="money-card">
        <div class="k">Заработано, но не выплачено</div>
        <div class="v green">${forecastMoney(r.unpaidNow||0,currency)}</div>
        <div class="sub">${unpaidSub}</div>
      </article>
    </div>
    <div class="scenario-panel" aria-label="Три сценария баланса">
      <div class="scenario-intro">
        <strong>Баланс к ${scenarioDate}</strong>
        <span>Коридор 80% без случайных экстремумов</span>
      </div>
      <div class="scenario low"><div class="k">Пессимистичный</div><div class="v">${forecastMoney(r.finalP10,currency)}</div></div>
      <div class="scenario mid"><div class="k">Ожидаемый</div><div class="v">${forecastMoney(r.finalMedian,currency)}</div></div>
      <div class="scenario high"><div class="k">Оптимистичный</div><div class="v">${forecastMoney(r.finalP90,currency)}</div></div>
    </div>
    <details class="forecast-details">
      <summary>Из чего сложился прогноз</summary>
      <div class="forecast-breakdown">${breakdown.join('')}</div>
      <div class="forecast-detail-grid">${details.join('')}</div>
      ${targets}
    </details>`;
}
