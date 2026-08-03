function forecastSavingsTimeline(es,exs,incs,cps,end,nSims,seed,opts){
  opts=opts||{};nSims=nSims||4000;seed=seed||1;
  if(!cps||!cps.length)throw new Error('Добавь хотя бы один чекпоинт баланса.');
  const ref=opts.referenceDate||today();
  const models=opts.incomeModels||[];
  const vacations=opts.vacations||[];
  const actualCps=cps.filter(c=>(c.kind||'actual')==='actual');
  const targetCps=cps.filter(c=>c.kind==='target');
  if(!actualCps.length)throw new Error('Нужен хотя бы один фактический чекпоинт.');
  const past=actualCps.filter(c=>c.date<=ref);
  const anchor=opts.anchorDate
    ?actualCps.find(c=>c.date===opts.anchorDate)||(past.length?past.reduce((a,b)=>a.date>b.date?a:b):actualCps[0])
    :(past.length?past.reduce((a,b)=>a.date>b.date?a:b):actualCps.reduce((a,b)=>a.date<b.date?a:b));
  const start=addDays(anchor.date,1);
  if(end<start)throw new Error('Дата конца должна быть позже стартового чекпоинта.');
  const days=dateRange(start,end);
  const rand=mulberry32(seed);
  const modelStats=new Map();
  for(const model of models)if(model.type==='hourly'){
    const wm=weekdayModel(es,{halfLife:model.halfLife,refDate:ref,vacations});
    modelStats.set(model.id,{
      wm,
      samplers:wm.pools.map((pool,i)=>pool.length?makeWeightedSampler(pool.map((_,j)=>j),wm.poolWeights[i]):null),
      monthly:wm.expH.reduce((a,b)=>a+b,0)*(Number(model.rate)||0)*30.44/7
    });
  }
  const monthlyIncome=model=>model.type==='salary'
    ?Number(model.monthlySalary)||0
    :(modelStats.get(model.id)||{monthly:0}).monthly;
  const fixedExpenses=exs.filter(x=>x.amountMode!=='percent');
  const fixedMap=expandExpenses(fixedExpenses,start,end,{baseDate:ref});
  const percentExpenses=exs.filter(x=>x.amountMode==='percent');
  const expenseSpikeDays=new Set();
  for(const expense of exs)for(const date of days){
    if(!expenseActiveOnDate(expense,date))continue;
    if(expense.kind==='monthly'&&Number(date.slice(8,10))===Number(expense.day))expenseSpikeDays.add(date);
    else if(expense.kind==='once'&&expense.date===date)expenseSpikeDays.add(date);
  }
  const incMap=new Map();
  for(const inc of incs||[])if(inc.date>=start&&inc.date<=end)
    incMap.set(inc.date,(incMap.get(inc.date)||0)+Number(inc.amount));

  const scheduled=new Map();
  let initialUnpaid=0,initialUnpaidHours=0;
  for(const entry of es||[]){
    if(entry.date>anchor.date)continue;
    const model=incomeModelAt(models,entry.date);
    if(model.type!=='hourly')continue;
    const payout=nextModelPaymentDate(entry.date,model);
    if(payout<=anchor.date)continue;
    if(!scheduled.has(payout))scheduled.set(payout,{amount:new Float64Array(nSims),hours:0,seeded:0});
    const lot=scheduled.get(payout);
    const rate=model.effectiveFrom===INCOME_MODEL_ORIGIN&&Number(entry.rate)>0
      ?Number(entry.rate):Number(model.rate)||0;
    const money=Number(entry.hours||0)*rate;
    for(let s=0;s<nSims;s++)lot.amount[s]+=money;
    lot.hours+=Number(entry.hours)||0;lot.seeded+=money;
    initialUnpaid+=money;initialUnpaidHours+=Number(entry.hours)||0;
  }

  const autoRates=opts.autoMonthlyRates||null;
  const autoDurations=opts.autoMonthlyDurations||null;
  const autoRateBySim=autoRates&&autoRates.length?new Float64Array(nSims):null;
  let autoMeanRate=0;
  if(autoRateBySim){
    const durs=autoDurations&&autoDurations.length===autoRates.length?autoDurations:autoRates.map(()=>1);
    const sampler=makeWeightedSampler(autoRates.map((_,i)=>i),durs);
    const total=durs.reduce((a,b)=>a+b,0)||1;
    for(let s=0;s<nSims;s++)autoRateBySim[s]=autoRates[sampler.sample(rand)];
    autoMeanRate=autoRates.reduce((sum,value,i)=>sum+value*durs[i],0)/total;
  }

  const run=new Float64Array(nSims).fill(Number(anchor.balance)||0);
  const minRun=new Float64Array(run);
  const mean=[],p10=[],p90=[],expectedWork=[],expectedExp=[],expectedInc=[];
  const payDayDates=[],vacationDays=[],incomeEvents=[],expenseEvents=[];
  const targetDates=new Set(targetCps.filter(c=>c.date>anchor.date&&c.date<=end).map(c=>c.date));
  const targetSnaps=new Map();
  let nextSalary=null;
  for(let di=0;di<days.length;di++){
    const ds=days[di],model=incomeModelAt(models,ds),w=wd(ds),dim=daysInMonth(ds);
    const isVac=isVacationDay(ds,vacations);if(isVac)vacationDays.push(ds);
    const fixedOut=fixedMap.get(ds)||0,inEvent=incMap.get(ds)||0;
    const salaryIn=salaryPaymentOnDate(model,ds);
    const due=scheduled.get(ds)||null;
    const deposits=new Float64Array(nSims);
    let expectedEarned=salaryIn;
    if(salaryIn)for(let s=0;s<nSims;s++)deposits[s]+=salaryIn;
    if(due)for(let s=0;s<nSims;s++)deposits[s]+=due.amount[s];
    if(model.type==='hourly'&&!isVac){
      const stat=modelStats.get(model.id),sampler=stat.samplers[w];
      const payout=nextModelPaymentDate(ds,model);
      let lot=null;
      if(payout!==ds){
        if(!scheduled.has(payout))scheduled.set(payout,{amount:new Float64Array(nSims),hours:0,seeded:0});
        lot=scheduled.get(payout);
      }
      let hoursSum=0;
      for(let s=0;s<nSims;s++){
        const hours=sampler&&rand()<stat.wm.pWork[w]?stat.wm.pools[w][sampler.sample(rand)]:0;
        const money=hours*(Number(model.rate)||0);hoursSum+=hours;
        if(payout===ds)deposits[s]+=money;else lot.amount[s]+=money;
      }
      const meanHours=hoursSum/nSims;
      expectedEarned=meanHours*(Number(model.rate)||0);
      if(lot)lot.hours+=meanHours;
    }
    const depositMean=deposits.reduce((a,b)=>a+b,0)/nSims;
    if(depositMean){
      const depositType=salaryIn&&due?'mixed':salaryIn?'salary':'hourly';
      payDayDates.push(ds);incomeEvents.push({date:ds,amount:depositMean,type:depositType});
    }
    expectedWork.push(expectedEarned);
    const outSamples=new Float64Array(nSims);
    let outSum=0;
    for(let s=0;s<nSims;s++){
      let out=fixedOut;
      for(const expense of percentExpenses){
        out+=expenseAmountOnDate(expense,ds,ref,{
          payment:deposits[s],monthlyIncome:monthlyIncome(model),balance:run[s]
        });
      }
      const autoOut=autoRateBySim?autoRateBySim[s]/dim:0;
      outSamples[s]=out+autoOut;outSum+=outSamples[s];
      run[s]+=deposits[s]+inEvent-outSamples[s];
      if(run[s]<minRun[s])minRun[s]=run[s];
    }
    const meanOut=outSum/nSims;
    expectedExp.push(meanOut);expectedInc.push(inEvent);
    if(meanOut-autoMeanRate/dim>0)expenseEvents.push({date:ds,amount:meanOut-autoMeanRate/dim});
    if(!nextSalary&&ds>=ref&&depositMean>0){
      const sorted=Float64Array.from(deposits).sort();
      const tax=Math.max(0,Math.min(1,(Number(model.taxRate)||0)/100));
      nextSalary={
        date:ds,mean:depositMean,median:sorted[Math.floor(.5*nSims)],
        p10:sorted[Math.floor(.1*nSims)],p90:sorted[Math.floor(.9*nSims)],
        min:sorted[0],max:sorted[nSims-1],taxMean:depositMean*tax,
        taxP10:sorted[Math.floor(.1*nSims)]*tax,taxP90:sorted[Math.floor(.9*nSims)]*tax,
        expHours:model.type==='hourly'?(due?due.hours:0):0,
        incomeType:salaryIn&&due?'mixed':salaryIn?'salary':'hourly'
      };
    }
    const sortedRun=Float64Array.from(run).sort();
    mean.push(run.reduce((a,b)=>a+b,0)/nSims);
    p10.push(sortedRun[Math.floor(.1*nSims)]);p90.push(sortedRun[Math.floor(.9*nSims)]);
    if(targetDates.has(ds))targetSnaps.set(ds,{di,snap:Float64Array.from(run)});
  }

  const cpMap=new Map(actualCps.filter(c=>c.date>anchor.date&&c.date<=end).map(c=>[c.date,c.balance]));
  const anchors=[{di:-1,shift:0}];let extraWidthSq=0;
  for(let i=0;i<days.length;i++)if(cpMap.has(days[i])){
    const shift=cpMap.get(days[i])-mean[i],delta=shift-anchors[anchors.length-1].shift;
    extraWidthSq+=(delta*.4)*(delta*.4);anchors.push({di:i,shift});
  }
  const shifts=new Float64Array(days.length);let segment=0;
  for(let i=0;i<days.length;i++){
    while(segment+1<anchors.length&&i>anchors[segment+1].di)segment++;
    const a=anchors[segment],b=anchors[segment+1];
    shifts[i]=b?a.shift+(b.shift-a.shift)*(i-a.di)/(b.di-a.di):a.shift;
    mean[i]+=shifts[i];
  }
  const extraWidth=Math.sqrt(extraWidthSq),shiftExtra=new Float64Array(nSims);
  if(extraWidth)for(let s=0;s<nSims;s++){
    let u=0,v=0;while(!u)u=rand();while(!v)v=rand();
    shiftExtra[s]=Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)*extraWidth;
  }
  const finalShift=days.length?shifts[days.length-1]:0;
  for(let s=0;s<nSims;s++){run[s]+=finalShift+shiftExtra[s];minRun[s]+=finalShift+shiftExtra[s]}
  for(let i=0;i<days.length;i++){p10[i]+=shifts[i]-extraWidth;p90[i]+=shifts[i]+extraWidth}
  const targetReachProb=[];
  for(const target of targetCps){
    const item=targetSnaps.get(target.date);if(!item)continue;let count=0;
    for(let s=0;s<nSims;s++)if(item.snap[s]+shifts[item.di]+shiftExtra[s]>=target.balance)count++;
    targetReachProb.push({date:target.date,balance:target.balance,prob:count/nSims});
  }

  const finalSorted=Float64Array.from(run).sort();
  let sum=0,min=run[0],max=run[0],negative=0,midNegative=0;
  for(let s=0;s<nSims;s++){
    sum+=run[s];if(run[s]<min)min=run[s];if(run[s]>max)max=run[s];
    if(run[s]<0)negative++;if(minRun[s]<0)midNegative++;
  }
  const finalMean=sum/nSims;let variance=0;
  for(const value of run)variance+=(value-finalMean)*(value-finalMean);
  let unpaidAtEnd=0;
  for(const [date,lot] of scheduled)if(date>end)
    unpaidAtEnd+=lot.amount.reduce((a,b)=>a+b,0)/nSims;
  const active=incomeModelAt(models,ref);
  return{
    days,mean,p10,p90,startBalance:Number(anchor.balance)||0,startDate:anchor.date,
    rate:active.type==='hourly'?active.rate:0,incomeType:active.type,incomeModels:models,
    expDays:[...expenseSpikeDays],expenseEvents,incomeEvents,
    incomeDays:[...incMap.keys()],checkpointDays:[...cpMap.keys()],payDayDates,
    targetCheckpointDays:targetCps.filter(c=>c.date>anchor.date&&c.date<=end).map(c=>c.date),
    vacationDays,finalMean,finalMedian:finalSorted[Math.floor(.5*nSims)],
    finalStd:Math.sqrt(variance/nSims),finalP10:finalSorted[Math.floor(.1*nSims)],
    finalP90:finalSorted[Math.floor(.9*nSims)],finalMin:min,finalMax:max,
    negativeProb:negative/nSims,midPeriodNegProb:midNegative/nSims,
    totalExpenses:expectedExp.reduce((a,b)=>a+b,0),
    totalAutoExpense:days.reduce((sum,ds)=>sum+autoMeanRate/daysInMonth(ds),0),
    totalIncomes:expectedInc.reduce((a,b)=>a+b,0),
    totalExpectedWork:expectedWork.reduce((a,b)=>a+b,0),
    calibrationShift:finalShift,taxRate:(Number(active.taxRate)||0)/100,
    unpaidAtEnd,initialUnpaid,initialUnpaidHours,
    unpaidNow:initialUnpaid,unpaidNowHours:initialUnpaidHours,pendingNow:null,
    prevSalary:null,nextSalary,targetReachProb,
    model:{timeline:true,activeModel:active,anchorDate:anchor.date,
      calibrationExtraWidth:extraWidth,autoIntervalsUsed:autoRates?autoRates.length:0},
    perDay:{work:expectedWork,exp:expectedExp,inc:expectedInc},finalRuns:[...run]
  };
}
