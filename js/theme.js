const THEME_KEY='money-horizon-theme';
const THEME_CHOICES=['system','light','dark'];
const darkMedia=window.matchMedia('(prefers-color-scheme: dark)');

function loadThemeChoice(){
  try{
    const saved=localStorage.getItem(THEME_KEY);
    return THEME_CHOICES.includes(saved)?saved:'system';
  }catch(e){
    return'system';
  }
}

function resolvedTheme(choice){
  return choice==='system'?(darkMedia.matches?'dark':'light'):choice;
}

function applyTheme(choice,notify){
  const normalized=THEME_CHOICES.includes(choice)?choice:'system';
  const resolved=resolvedTheme(normalized);
  document.documentElement.dataset.theme=resolved;
  document.documentElement.dataset.themeChoice=normalized;
  document.documentElement.style.colorScheme=resolved;
  const meta=document.querySelector('meta[name="theme-color"]');
  if(meta)meta.content=resolved==='dark'?'#171224':'#20523c';
  document.querySelectorAll('[data-theme-choice]').forEach(button=>{
    button.setAttribute('aria-pressed',String(button.dataset.themeChoice===normalized));
  });
  if(notify)document.dispatchEvent(new CustomEvent('app-theme-change',{detail:{choice:normalized,resolved}}));
}

function saveThemeChoice(choice){
  try{localStorage.setItem(THEME_KEY,choice)}catch(e){}
}

applyTheme(loadThemeChoice(),false);

document.addEventListener('DOMContentLoaded',()=>{
  applyTheme(loadThemeChoice(),false);
  document.querySelector('.theme-switcher')?.addEventListener('click',event=>{
    const button=event.target.closest('[data-theme-choice]');
    if(!button)return;
    saveThemeChoice(button.dataset.themeChoice);
    applyTheme(button.dataset.themeChoice,true);
  });
});

darkMedia.addEventListener('change',()=>{
  if(loadThemeChoice()==='system')applyTheme('system',true);
});
