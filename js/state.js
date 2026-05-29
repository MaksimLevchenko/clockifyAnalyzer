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
  s.payDays=Array.isArray(s.payDays)?s.payDays.filter(d=>Number.isFinite(+d)).map(d=>Math.min(28,Math.max(1,+d))):[];
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
  delete s.balance;delete s.balanceDate;
  return s;
}

let state = migrate(loadState());

function saveState(){
  try{localStorage.setItem(LS_KEY,JSON.stringify(state))}
  catch(e){toast('Не удалось сохранить в браузере — используй экспорт в файл')}
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
