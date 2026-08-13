const itemEditDialog=document.getElementById('edit-dialog');
const itemEditForm=document.getElementById('edit-dialog-form');
const itemEditBody=document.getElementById('edit-dialog-body');
const itemEditError=document.getElementById('edit-dialog-error');
let itemEditConfig=null;
let itemEditBusy=false;

function itemEditButton(label,attributes){
  return `<button type="button" class="btn ghost sm edit-action" ${attributes||''} aria-label="${label}" title="${label}">✎</button>`;
}

function editDialogError(message){
  itemEditError.textContent=message||'';
  itemEditError.hidden=!message;
}

function closeEditDialog(){
  const trigger=itemEditConfig&&itemEditConfig.trigger;
  const triggerLabel=trigger?.getAttribute('aria-label');
  const triggerData=trigger&&[...trigger.attributes].find(attribute=>attribute.name.startsWith('data-'));
  itemEditConfig=null;
  editDialogError('');
  if(itemEditDialog.open)itemEditDialog.close();
  let focusTarget=trigger?.isConnected?trigger:null;
  if(!focusTarget&&triggerData){
    focusTarget=[...document.querySelectorAll(`[${triggerData.name}]`)]
      .find(button=>button.getAttribute(triggerData.name)===triggerData.value);
  }
  if(!focusTarget&&triggerLabel){
    focusTarget=[...document.querySelectorAll('button[aria-label]')]
      .find(button=>button.getAttribute('aria-label')===triggerLabel);
  }
  focusTarget?.focus();
}

function openEditDialog(config){
  itemEditConfig=config;
  itemEditBusy=false;
  document.getElementById('edit-dialog-eyebrow').textContent=config.eyebrow||'Редактирование';
  document.getElementById('edit-dialog-title').textContent=config.title;
  itemEditBody.innerHTML=config.html;
  editDialogError('');
  const deleteButton=document.getElementById('edit-dialog-delete');
  deleteButton.hidden=!config.onDelete;
  deleteButton.textContent=config.deleteLabel||'Удалить';
  document.getElementById('edit-dialog-save').textContent=config.saveLabel||'Сохранить изменения';
  config.onOpen?.(itemEditBody);
  itemEditDialog.showModal();
  requestAnimationFrame(()=>itemEditBody.querySelector('input,select,textarea,button')?.focus());
}

itemEditForm.addEventListener('submit',event=>{
  event.preventDefault();
  if(!itemEditConfig||itemEditBusy)return;
  itemEditBusy=true;
  const message=itemEditConfig.onSave(itemEditBody);
  itemEditBusy=false;
  if(message){editDialogError(message);return}
  closeEditDialog();
});

document.getElementById('edit-dialog-delete').addEventListener('click',()=>{
  if(!itemEditConfig?.onDelete||itemEditBusy)return;
  if(!confirm(itemEditConfig.deleteConfirm||'Удалить этот элемент?'))return;
  itemEditBusy=true;
  const message=itemEditConfig.onDelete();
  itemEditBusy=false;
  if(message){editDialogError(message);return}
  closeEditDialog();
});

document.getElementById('edit-dialog-close').addEventListener('click',closeEditDialog);
document.getElementById('edit-dialog-cancel').addEventListener('click',closeEditDialog);
itemEditDialog.addEventListener('cancel',event=>{event.preventDefault();closeEditDialog()});
