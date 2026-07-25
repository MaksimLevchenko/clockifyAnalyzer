function forecastMoney(value,currency,sign){
  const number=Number(value)||0;
  const prefix=sign&&number>0?'+':'';
  return `${prefix}${fmt(number)} ${currency}`;
}

function forecastFixed(value,digits){
  const number=Number(value)||0;
  const sign=number<0?'−':'';
  const parts=Math.abs(number).toFixed(digits).split('.');
  parts[0]=parts[0].replace(/\B(?=(\d{3})+(?!\d))/g,' ');
  return `${sign}${parts.join('.')}`;
}

function forecastOptionalCents(value){
  const number=Number(value)||0;
  return Math.abs(number-Math.round(number))<.005?fmt(number):forecastFixed(number,2);
}

function forecastRoundedHours(value){
  return Math.ceil(Number(value)||0);
}

function forecastMoneyForRoundedHours(money,hours,fallbackRate){
  const amount=Number(money)||0;
  const worked=Number(hours)||0;
  const rate=worked>0?amount/worked:Number(fallbackRate)||0;
  return rate>0?forecastRoundedHours(worked||amount/rate)*rate:forecastRoundedHours(amount);
}

function forecastMoneyForRoundedRate(money,rate){
  const amount=Number(money)||0;
  const hourlyRate=Number(rate)||0;
  return hourlyRate>0?forecastRoundedHours(amount/hourlyRate)*hourlyRate:forecastRoundedHours(amount);
}

function forecastMoneyForRoundedRateHours(hours,rate){
  const hourlyRate=Number(rate)||0;
  return hourlyRate>0?forecastRoundedHours(hours)*hourlyRate:0;
}

function forecastRoundedMoney(value,roundedValue,currency,sign){
  const number=Number(value)||0;
  const prefix=sign&&number>0?'+':'';
  return `${prefix}${forecastFixed(number,2)} (${forecastOptionalCents(roundedValue)}) ${currency}`;
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
  const roundedSalary=nextSalary
    ?forecastMoneyForRoundedRateHours(nextSalary.expHours,r.rate)
    :0;
  const salaryValue=nextSalary
    ?forecastRoundedMoney(nextSalary.mean,roundedSalary,currency,true)
    :'Нет в периоде';
  const taxRate=Math.max(0,Number(r.taxRate)||0);
  const salaryWithTax=nextSalary?nextSalary.mean*(1+taxRate):0;
  const roundedSalaryWithTax=roundedSalary*(1+taxRate);
  const salaryTax=nextSalary&&taxRate>0
    ?`<span class="salary-tax">К выставлению с налогом: <b>${forecastRoundedMoney(salaryWithTax,roundedSalaryWithTax,currency)}</b></span>`
    :'';
  const salarySub=nextSalary
    ?`${esc(dateRu(nextSalary.date,true))}${salaryTax}<span>Коридор ${forecastRoundedMoney(nextSalary.p10,forecastMoneyForRoundedRate(nextSalary.p10,r.rate),currency)}–${forecastRoundedMoney(nextSalary.p90,forecastMoneyForRoundedRate(nextSalary.p90,r.rate),currency)}</span>`
    :(r.payDayDates.length?'Увеличь горизонт прогноза':'Добавь расписание в настройках');
  const unpaidSub=r.unpaidNowHours
    ?`${fmt(r.unpaidNowHours)} ч уже отработано`
    :'Нет неоплаченных часов';
  const roundedUnpaid=forecastMoneyForRoundedHours(r.unpaidNow,r.unpaidNowHours,r.rate);
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
        <div class="v green precise">${salaryValue}</div>
        <div class="sub">${salarySub}</div>
      </article>
      <article class="money-card">
        <div class="k">Заработано, но не выплачено</div>
        <div class="v green precise">${forecastRoundedMoney(r.unpaidNow||0,roundedUnpaid,currency)}</div>
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
