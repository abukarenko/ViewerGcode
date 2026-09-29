(() => {
 'use strict';
 const $=id=>document.getElementById(id),dialog=$('settingsDialog'),controller=window.grblController;
 let baseline=new Map(),inputs=new Map(),working=false;
 function changed(){return [...inputs].filter(([id,input])=>input.value.trim()!==baseline.get(id));}
 function update(){
  const changes=changed();$('settingsApply').disabled=working||!changes.length||!controller.connected||controller.fault;
  $('settingsRead').disabled=working||!controller.connected||controller.fault;
  $('settingsClose').disabled=working;
  for(const input of inputs.values())input.disabled=working;
  for(const button of dialog.querySelectorAll('[data-query]'))button.disabled=working||!controller.connected||controller.fault;
  $('settingsPreview').textContent=changes.map(([id,input])=>`$${id}: ${baseline.get(id)} → ${input.value}    ($${id}=${input.value.trim().replace(',','.')})`).join('\n')||'Нет изменений';
 }
 function render(){
  inputs=new Map();$('settingsRows').replaceChildren();
  for(const [id,value] of baseline){
   const [title,description]=GRBLSettings.describe(id),row=document.createElement('div');row.className='setting-row';
   const label=document.createElement('label');label.htmlFor='setting-'+id;
   const name=document.createElement('strong');name.textContent=`$${id} · ${title}`;
   const help=document.createElement('small');help.textContent=description;label.append(name,help);
   const input=document.createElement('input');input.id='setting-'+id;input.value=value;input.inputMode='decimal';input.autocomplete='off';input.oninput=update;
   row.append(label,input);$('settingsRows').append(row);inputs.set(id,input);
  }
  update();
 }
 async function read(){
  const values=GRBLSettings.parse(await controller.systemCommand('$$'));
  if(!values.size)throw new Error('Плата не вернула параметры $номер=значение');
  baseline=values;render();$('settingsMessage').textContent=`Прочитано параметров: ${values.size}`;
 }
 async function action(fn){working=true;update();try{await fn();}catch(error){$('settingsMessage').textContent=error.message;}finally{working=false;update();}}
 $('serialSettings').onclick=()=>{
  baseline=new Map();render();$('settingsOutput').textContent='';$('settingsMessage').textContent='Чтение $$…';dialog.showModal();action(read);
 };
 $('settingsRead').onclick=()=>action(read);
 $('settingsClose').onclick=()=>dialog.close();
 dialog.addEventListener('cancel',e=>{if(working)e.preventDefault();});
 $('settingsApply').onclick=()=>action(async()=>{
  // Validate the entire batch before sending anything. Preserve unsaved values on partial failure.
  const commands=changed().map(([id,input])=>({id,command:GRBLSettings.command(id,input.value)}));
  let saved=0;
  try{
   for(const item of commands){
    $('settingsMessage').textContent=`Запись ${item.command}…`;
    await controller.systemCommand(item.command);
    baseline.set(item.id,item.command.split('=')[1]);inputs.get(item.id).value=baseline.get(item.id);saved++;update();
   }
   const actual=GRBLSettings.parse(await controller.systemCommand('$$'));
   if(!actual.size)throw new Error('Не удалось перечитать параметры после записи');
   const mismatch=commands.filter(item=>!actual.has(item.id)||Number(actual.get(item.id))!==Number(baseline.get(item.id)));
   baseline=actual;render();
   $('settingsMessage').textContent=mismatch.length?`Значения на плате отличаются: ${mismatch.map(x=>'$'+x.id).join(', ')}. Показаны фактические.`:`Сохранено и проверено: ${saved}`;
  }catch(error){throw new Error(`Подтверждено записей: ${saved} из ${commands.length}. ${error.message}`);}
 });
 for(const button of dialog.querySelectorAll('[data-query]'))button.onclick=()=>action(async()=>{
  const lines=await controller.systemCommand(button.dataset.query);$('settingsOutput').textContent=lines.join('\n')||'ok';$('settingsMessage').textContent=`${button.dataset.query}: ответ получен`;
 });
})();
