/* App state, persistence, anchor helpers. Depends on core.js (today). */

const LS_KEY = 'finance_app_state_v1';

function loadState(){
  try{const s=localStorage.getItem(LS_KEY);return s?JSON.parse(s):null}
  catch(e){return null}
}

function migrate(s){
  s=s||{};
  s.entries=s.entries||[];
  s.expenses=s.expenses||[];
  s.incomes=s.incomes||[];
  /* payDays = дни зп (отсечка часов); payoutDays — выровненный по индексу
     массив дней выплаты (день прихода денег), null = совпадает с днём зп.
     Нормализуем через пары: клампим 1–28, дедуп по дню зп, сортируем, макс 4. */
  {
    const pdRaw=Array.isArray(s.payDays)?s.payDays:[];
    const poRaw=Array.isArray(s.payoutDays)?s.payoutDays:[];
    const clamp=d=>Math.min(28,Math.max(1,+d));
    const seen=new Set(),pairs=[];
    for(let i=0;i<pdRaw.length;i++){
      if(!Number.isFinite(+pdRaw[i]))continue;
      const a=clamp(pdRaw[i]);
      if(seen.has(a))continue;seen.add(a);
      const pv=poRaw[i];
      const p=(pv==null||pv==='')?null:(Number.isFinite(+pv)?clamp(pv):null);
      pairs.push({accrual:a,payout:p});
    }
    pairs.sort((x,y)=>x.accrual-y.accrual);
    const trimmed=pairs.slice(0,4);
    s.payDays=trimmed.map(pr=>pr.accrual);
    s.payoutDays=trimmed.map(pr=>pr.payout);
  }
  s.payDayActuals=Array.isArray(s.payDayActuals)?[...new Set(s.payDayActuals.filter(d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)))].sort():[];
  if(!Array.isArray(s.checkpoints)){
    s.checkpoints=(s.balance!=null&&s.balanceDate)
      ?[{date:s.balanceDate,balance:Number(s.balance)||0}]
      :[];
  }
  s.rate=s.rate||0;
  s.currency=s.currency||'USD';
  s.halfLife=Number.isFinite(+s.halfLife)?Math.max(7,Math.min(365,+s.halfLife)):60;
  s.taxRate=Number.isFinite(+s.taxRate)?Math.max(0,Math.min(100,+s.taxRate)):0;
  s.vacations=Array.isArray(s.vacations)?s.vacations.filter(v=>v&&v.from&&v.to):[];
  s.cashflowExcluded=Array.isArray(s.cashflowExcluded)?s.cashflowExcluded.filter(x=>x&&x.from&&x.to):[];
  for(const c of s.checkpoints)if(!c.kind)c.kind='actual';
  for(const e of s.expenses)if(e.growthRate==null)e.growthRate=0;
  if(!s.updatedAt)s.updatedAt=new Date().toISOString();
  delete s.balance;delete s.balanceDate;
  return s;
}

let state = migrate(loadState());

function saveStateRaw(){
  try{localStorage.setItem(LS_KEY,JSON.stringify(state))}
  catch(e){toast('Не удалось сохранить в браузере — используй экспорт в файл')}
}
function saveState(){
  state.updatedAt=new Date().toISOString();
  saveStateRaw();
  if(typeof schedulePush==='function')schedulePush();
}

function cur(){return state.currency||'USD'}

function anchorCp(){
  if(!state.checkpoints.length)return null;
  const past=state.checkpoints.filter(c=>c.date<=today());
  if(past.length)return past.reduce((a,b)=>a.date>b.date?a:b);
  return state.checkpoints.reduce((a,b)=>a.date<b.date?a:b);
}
function currentBalance(){const c=anchorCp();return c?c.balance:0}
function anchorDate(){const c=anchorCp();return c?c.date:today()}
