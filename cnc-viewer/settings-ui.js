(() => {
 'use strict';
 const $=id=>document.getElementById(id),dialog=$('settingsDialog'),controller=window.grblController;
 let baseline=new Map(),inputs=new Map(),working=false;
 function selectTab(name){for(const key of ['grbl','port','theme'])$('settings-'+key).hidden=key!==name;$('settingsGrblActions').hidden=name!=='grbl';for(const button of dialog.querySelectorAll('[data-settings-tab]'))button.setAttribute('aria-pressed',String(button.dataset.settingsTab===name));}
 for(const button of dialog.querySelectorAll('[data-settings-tab]'))button.onclick=()=>selectTab(button.dataset.settingsTab);
 window.syncPortSettings=()=>{const source=$('serialPort'),target=$('settingsPort');target.replaceChildren(...Array.from(source.options,option=>option.cloneNode(true)));target.value=source.value;target.disabled=source.disabled;$('settingsBaud').value=$('baudRate').value;$('settingsBaud').disabled=$('baudRate').disabled;$('portSettingsState').textContent=$('demoMode').checked?'Demo: используется виртуальный порт.':controller.connected?'Порт открыт. Для изменения параметров разъедините соединение.':'Выберите порт и скорость, затем нажмите «Соединить» в главном окне.';};
 $('settingsPort').onchange=async()=>{$('serialPort').value=$('settingsPort').value;await $('serialPort').onchange();window.syncPortSettings();};
 $('settingsBaud').onchange=()=>{$('baudRate').value=$('settingsBaud').value;$('baudRate').onchange();};
 function changed(){return [...inputs].filter(([id,input])=>input.value.trim()!==baseline.get(id));}
 function update(){
  $('settingsExport').disabled=working||controller.busy||(!$('demoMode').checked&&(!controller.connected||controller.fault));
  const changes=changed();$('settingsApply').disabled=working||controller.busy||!changes.length||!controller.connected||controller.fault;
  $('settingsRead').disabled=working||controller.busy||!controller.connected||controller.fault;
  $('settingsClose').disabled=working;
  for(const input of inputs.values())input.disabled=working;
  for(const button of dialog.querySelectorAll('[data-query]'))button.disabled=working||controller.busy||!controller.connected||controller.fault;
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
 const demo=window.demoPort;
 for(const [id,key] of [['demoSpeed','speed'],['demoSurface','surface'],['demoRipple','ripple']])$(id).value=demo.options[key];
 $('demoProbe').checked=demo.options.probeEnabled;$('demoProbeForced').checked=demo.options.probeForced;
 for(const [id,key] of [['demoSpeed','speed'],['demoSurface','surface'],['demoRipple','ripple']])$(id).onchange=()=>{const value=Number($(id).value);if(!Number.isFinite(value)||(key==='speed'&&(value<1||value>100))||(key==='ripple'&&value<0)){ $(id).value=demo.options[key];return;}demo.options[key]=value;demo.saveSettings();};
 $('demoProbe').onchange=()=>{demo.options.probeEnabled=$('demoProbe').checked;demo.saveSettings();};
 $('demoProbeForced').onchange=()=>{demo.options.probeForced=$('demoProbeForced').checked;demo.saveSettings();demo.report();};
 for(const [i,axis] of [...'XYZ'].entries()){
  const row=document.createElement('div');row.className='demo-sensor-row';
  for(const forced of [false,true]){const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=demo.options[forced?'forced':'sensors'][i];input.onchange=()=>{if(forced)demo.sensor(i,input.checked);else{demo.options.sensors[i]=input.checked;demo.saveSettings();}};label.append(input,document.createTextNode(forced?axis+' — сработал':axis+' — датчик исправен'));row.append(label);}
  $('demoSensors').append(row);
 }
 setInterval(()=>{if(dialog.open){if($('demoMode').checked)$('demoStatus').textContent=`${demo.opened?'Подключён':'Отключён'} · ${demo.state} · датчики: ${demo.pins()||'нет'} · MPos ${demo.pos.map(v=>v.toFixed(2)).join(', ')}`;update();}},200);
 $('serialSettings').onclick=()=>{
  window.syncPortSettings();selectTab('grbl');
  baseline=new Map();render();$('settingsOutput').textContent='';$('settingsMessage').textContent='Чтение $$…';dialog.showModal();if(controller.connected&&!controller.busy&&!controller.fault)action(read);else $('settingsMessage').textContent='Для чтения и записи GRBL подключитесь и дождитесь завершения операции. Порт и тема доступны в соседних разделах.';
 };
 $('settingsExport').onclick=()=>action(async()=>{
  const isDemo=$('demoMode').checked;
  const values=isDemo?new Map(Object.entries(demo.settings).map(([k,v])=>[k,String(v)])):GRBLSettings.parse(await controller.systemCommand('$$'));
  const text=GRBLSettings.exportNC(values),a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));a.download=`grbl-${isDemo?'demo':'settings'}-${new Date().toISOString().slice(0,10)}.nc`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  $('settingsMessage').textContent=`Экспортировано ${values.size} фактических параметров. Несохранённые правки не включены.`;
 });
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
