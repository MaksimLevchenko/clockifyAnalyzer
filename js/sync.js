/* Gist sync — config + GitHub API client. No DOM. */

const GIST_KEY = 'finance_app_gist_v1';
const GIST_FILENAME = 'finance_state.json';

function loadGistCfg(){
  try{const s=localStorage.getItem(GIST_KEY);return s?JSON.parse(s):{}}
  catch(e){return{}}
}
function saveGistCfg(cfg){
  try{localStorage.setItem(GIST_KEY,JSON.stringify(cfg||{}))}catch(e){}
}
function clearGistCfg(){try{localStorage.removeItem(GIST_KEY)}catch(e){}}

function parseGistId(input){
  if(!input)return '';
  const s=String(input).trim();
  const m=s.match(/gist\.github\.com\/(?:[^/]+\/)?([0-9a-fA-F]{6,})/);
  if(m)return m[1];
  const m2=s.match(/^([0-9a-fA-F]{6,})$/);
  return m2?m2[1]:'';
}

async function gistApi(path,opts,token){
  const headers={
    'Accept':'application/vnd.github+json',
    'X-GitHub-Api-Version':'2022-11-28'
  };
  if(token)headers['Authorization']='Bearer '+token;
  if(opts&&opts.body)headers['Content-Type']='application/json';
  const r=await fetch('https://api.github.com'+path,Object.assign({},opts,{headers}));
  if(!r.ok){
    let msg='HTTP '+r.status;
    if(r.status===401)msg='Неверный или просроченный токен';
    else if(r.status===404)msg='Gist не найден';
    else if(r.status===403)msg='Доступ запрещён (нет scope gist или rate limit)';
    try{const j=await r.json();if(j&&j.message)msg+=' · '+j.message}catch(e){}
    throw new Error(msg);
  }
  return r.json();
}

async function gistCreate(token,payload){
  const d=await gistApi('/gists',{
    method:'POST',
    body:JSON.stringify({
      description:'Финансовый помощник — состояние',
      public:false,
      files:{[GIST_FILENAME]:{content:JSON.stringify(payload,null,2)}}
    })
  },token);
  return{id:d.id,updatedAt:d.updated_at,url:d.html_url};
}

async function gistPull(token,gistId){
  const d=await gistApi('/gists/'+encodeURIComponent(gistId),{method:'GET'},token);
  const f=d.files&&d.files[GIST_FILENAME];
  if(!f)throw new Error('В gist нет файла '+GIST_FILENAME);
  let content=f.content;
  if(f.truncated&&f.raw_url){
    const r=await fetch(f.raw_url);
    if(!r.ok)throw new Error('Не удалось скачать содержимое gist');
    content=await r.text();
  }
  let parsed;
  try{parsed=JSON.parse(content)}
  catch(e){throw new Error('Содержимое gist не JSON: '+e.message)}
  return{state:parsed,updatedAt:d.updated_at,url:d.html_url};
}

async function gistPush(token,gistId,payload){
  const d=await gistApi('/gists/'+encodeURIComponent(gistId),{
    method:'PATCH',
    body:JSON.stringify({
      files:{[GIST_FILENAME]:{content:JSON.stringify(payload,null,2)}}
    })
  },token);
  return{updatedAt:d.updated_at,url:d.html_url};
}
