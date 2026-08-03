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
  /* payDays = дни зп (отсечка часов), числа 1–28, дедуп, сортировка, макс 4.
     День выплаты по умолчанию = день зп; конкретные сдвиги — в payDayActuals. */
  s.payDays=Array.isArray(s.payDays)?[...new Set(s.payDays.filter(d=>Number.isFinite(+d)).map(d=>Math.min(28,Math.max(1,+d))))].sort((a,b)=>a-b).slice(0,4):[];
  delete s.payoutDays;
  /* payDayActuals — пары {payout, accrual}: фактический день прихода денег +
     фактический день учёта часов (accrual опц., null = по расписанию дня зп).
     Старый формат (массив строк-дат прихода) мигрируем в {payout, accrual:null}. */
  {
    const D=/^\d{4}-\d{2}-\d{2}$/;
    const raw=Array.isArray(s.payDayActuals)?s.payDayActuals:[];
    const seen=new Set(),out=[];
    for(const a of raw){
      let payout=null,accrual=null;
      if(typeof a==='string'){if(D.test(a))payout=a}
      else if(a&&typeof a==='object'){if(D.test(a.payout||''))payout=a.payout;if(D.test(a.accrual||''))accrual=a.accrual}
      if(!payout||seen.has(payout))continue;seen.add(payout);
      if(accrual&&accrual>payout)accrual=null;
      out.push({payout,accrual});
    }
    out.sort((x,y)=>x.payout<y.payout?-1:1);
    s.payDayActuals=out;
  }
  {
    const D=/^\d{4}-\d{2}-\d{2}$/;
    const pending=typeof s.pendingPayAccrual==='string'&&D.test(s.pendingPayAccrual)
      &&s.pendingPayAccrual<=today()?s.pendingPayAccrual:null;
    s.pendingPayAccrual=s.payDays.length&&pending
      &&!s.payDayActuals.some(a=>a.accrual===pending)?pending:null;
  }
  if(!Array.isArray(s.checkpoints)){
    s.checkpoints=(s.balance!=null&&s.balanceDate)
      ?[{date:s.balanceDate,balance:Number(s.balance)||0}]
      :[];
  }
  s.rate=s.rate||0;
  s.currency=s.currency||'USD';
  s.halfLife=Number.isFinite(+s.halfLife)?Math.max(7,Math.min(365,+s.halfLife)):60;
  s.taxRate=Number.isFinite(+s.taxRate)?Math.max(0,Math.min(100,+s.taxRate)):0;
  s.incomeModels=normalizeIncomeModels(s.incomeModels,s);
  s.vacations=Array.isArray(s.vacations)?s.vacations.filter(v=>v&&v.from&&v.to):[];
  s.cashflowExcluded=Array.isArray(s.cashflowExcluded)?s.cashflowExcluded.filter(x=>x&&x.from&&x.to):[];
  for(const c of s.checkpoints)if(!c.kind)c.kind='actual';
  for(const e of s.expenses){
    if(e.growthRate==null)e.growthRate=0;
    e.amountMode=e.amountMode==='percent'?'percent':'fixed';
    e.percentBase=['payment','monthlyIncome','balance'].includes(e.percentBase)?e.percentBase:'monthlyIncome';
    e.percent=Math.max(0,Number(e.percent)||0);
    if(!e.startDate)e.startDate=e.kind==='once'?e.date:INCOME_MODEL_ORIGIN;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(e.endDate||''))e.endDate=null;
  }
  if(!s.updatedAt)s.updatedAt=new Date().toISOString();
  delete s.balance;delete s.balanceDate;
  return s;
}

let state = migrate(loadState());

function saveStateRaw(){
  try{localStorage.setItem(LS_KEY,JSON.stringify(state))}
  catch(e){toast('Не удалось сохранить в браузере — используй экспорт в файл')}
}
function syncLegacyIncomeModel(){
  const legacy=state.incomeModels&&state.incomeModels.find(model=>model.effectiveFrom===INCOME_MODEL_ORIGIN);
  if(!legacy)return;
  legacy.type='hourly';legacy.rate=Number(state.rate)||0;
  legacy.halfLife=Number(state.halfLife)||60;legacy.taxRate=Number(state.taxRate)||0;
  legacy.payments=normalizePaymentRules(null,'hourly',state.payDays);
}
function saveState(){
  syncLegacyIncomeModel();
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
