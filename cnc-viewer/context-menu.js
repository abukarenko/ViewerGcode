(() => {
 'use strict';
 const $=id=>document.getElementById(id),menu=document.createElement('div');
 menu.id='contextMenu';menu.setAttribute('role','menu');menu.setAttribute('popover','manual');menu.hidden=true;document.body.append(menu);
 let origin=null;
 function close(restore=false){if(!menu.hidden){if(menu.matches(':popover-open'))menu.hidePopover();menu.hidden=true;if(restore&&origin?.isConnected)origin.focus({preventScroll:true});}}
 const editLocked=()=>$('editor').readOnly||window.grblController?.busy;
 function buttonAction(id){return ()=>{if(!$(id).disabled)$(id).click();};}
 function add(label,action,disabled=false,hint=''){
  const button=document.createElement('button');button.type='button';button.setAttribute('role','menuitem');button.disabled=typeof disabled==='function'?disabled():disabled;
  const text=document.createElement('span');text.textContent=label;button.append(text);
  if(hint){const key=document.createElement('small');key.textContent=hint;button.append(key);}
  button.onclick=async()=>{if(typeof disabled==='function'&&disabled())return;try{await action();close();}catch(error){let note=menu.querySelector('.context-error');if(!note){note=document.createElement('div');note.className='context-error';note.setAttribute('role','status');menu.append(note);}note.textContent='Буфер обмена недоступен. Используйте Ctrl+C / Ctrl+X / Ctrl+V.';}};
  menu.append(button);
 }
 function divider(){const d=document.createElement('div');d.className='context-separator';d.setAttribute('role','separator');menu.append(d);}
 function clipboard(field){
  const start=field.selectionStart,end=field.selectionEnd,value=field.value;
  const selected=value.slice(start,end),locked=()=>field.disabled||field.readOnly||(field===$('editor')&&editLocked());
  const unchanged=()=>{if(field.value!==value)throw new Error('Текст изменился');field.focus();field.setSelectionRange(start,end);};
  const replace=text=>{if(locked())return;unchanged();if(field===$('editor'))window.SmartEditor.replaceSelection(text);else{field.setRangeText(text,start,end,'end');field.dispatchEvent(new Event('input',{bubbles:true}));}};
  add('Вырезать',async()=>{await navigator.clipboard.writeText(selected);replace('');},()=>!selected||locked(),'Ctrl+X');
  add('Копировать',()=>navigator.clipboard.writeText(selected),!selected,'Ctrl+C');
  add('Вставить',async()=>replace(await navigator.clipboard.readText()),locked,'Ctrl+V');
  add('Выделить всё',()=>{field.focus();field.select();},false,'Ctrl+A');
 }
 function show(event){
  event.preventDefault();close();origin=document.activeElement;menu.replaceChildren();
  const target=event.target instanceof Element?event.target:document.body;
  (target.closest('dialog')||document.body).append(menu);
  const editorContext=target.closest('.editor-wrap');
  if(editorContext){
   const editor=$('editor');origin=editor;
   // Right-clicking a gutter line selects it; text selection inside the editor is preserved.
   const gutter=target.closest('#numbers>div');if(gutter)window.SmartEditor.goLine([...$('numbers').children].indexOf(gutter)+1);
   add('Отменить',buttonAction('editUndo'),()=>$('editUndo').disabled,'Ctrl+Z');add('Вернуть',buttonAction('editRedo'),()=>$('editRedo').disabled,'Ctrl+Y');divider();
   clipboard(editor);divider();
   add('Вставить строку выше',()=>window.SmartEditor.insertAbove(),editLocked,'Alt+Shift+Enter');
   add('Вставить строку ниже',buttonAction('editInsert'),editLocked,'Alt+Enter');add('Дублировать строки',buttonAction('editDuplicate'),editLocked,'Ctrl+D');add('Удалить строки',buttonAction('editDelete'),editLocked,'Ctrl+Shift+K');add('Комментарий / убрать комментарий',buttonAction('editComment'),editLocked,'Ctrl+/');divider();
   add('Найти в программе',()=>$('editFind').focus(),false,'Ctrl+F');add('Перейти к строке',()=>$('editGoto').focus(),false,'Ctrl+G');add('Построить траекторию',buttonAction('process'),()=>$('process').disabled,'Ctrl+Enter');
  }else if(target.matches('textarea,input[type=text],input[type=search],input:not([type])')){
   origin=target;clipboard(target);
  }else if(target.closest('.terminal-panel')){
   const selected=window.getSelection()?.toString()||'';
   add('Копировать выделенное',()=>navigator.clipboard.writeText(selected),!selected);add('Копировать журнал',()=>navigator.clipboard.writeText($('serialLog').innerText));add('Очистить журнал',buttonAction('terminalClear'));divider();add('Ввести команду',()=>$('terminalInput').focus());add('Редактор программы',buttonAction('editorOpen'));
  }else if(target.closest('.workspace')){
   add('Вписать траекторию',()=>window.CNCViewer.fit());divider();for(const [value,label] of [['iso','3D · изометрия'],['xy','XY · сверху'],['xz','XZ · спереди'],['yz','YZ · сбоку']])add(label,()=>window.CNCViewer.setView(value));divider();add($('grid').checked?'Скрыть сетку':'Показать сетку',()=>$('grid').click());add($('rapid').checked?'Скрыть быстрые ходы':'Показать быстрые ходы',()=>$('rapid').click());
  }else if(target.closest('dialog')){
   const text=window.getSelection()?.toString()||'';add('Копировать выделенное',()=>navigator.clipboard.writeText(text),!text);add('Закрыть окно',()=>{const dialog=target.closest('dialog');dialog.dispatchEvent(new Event('cancel',{cancelable:true}))&&dialog.close();});
  }else{
   add('Редактор программы',buttonAction('editorOpen'));add('Открыть G-code',buttonAction('open'),()=>$('open').disabled);add('Сохранить G-code',buttonAction('save'));add('Параметры GRBL',buttonAction('serialSettings'),()=>$('serialSettings').disabled);
  }
  menu.hidden=false;menu.style.left='0px';menu.style.top='0px';menu.showPopover();
  const rect=menu.getBoundingClientRect(),keyboard=event.clientX===0&&event.clientY===0,anchor=target.getBoundingClientRect();
  menu.style.left=Math.max(8,Math.min(keyboard?anchor.left:event.clientX,innerWidth-rect.width-8))+'px';menu.style.top=Math.max(8,Math.min(keyboard?anchor.top:event.clientY,innerHeight-rect.height-8))+'px';menu.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
 }
 document.addEventListener('contextmenu',show);
 document.addEventListener('pointerdown',e=>{if(!menu.contains(e.target))close();},true);
 window.addEventListener('resize',()=>close());document.addEventListener('scroll',e=>{if(!menu.contains(e.target))close();},true);
 document.addEventListener('keydown',e=>{
  if(menu.hidden)return;
  if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close(true);return;}
  if(e.key==='Tab'){close();return;}
  const buttons=[...menu.querySelectorAll('button:not(:disabled)')],i=buttons.indexOf(document.activeElement);
  if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}
 },true);
 document.querySelectorAll('dialog').forEach(d=>d.addEventListener('close',()=>close()));
})();
