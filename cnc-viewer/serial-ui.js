(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  function showCoordinates(work,machine){for(const [i,axis] of [...'XYZ'].entries()){for(const [prefix,values] of [['work',work],['machine',machine]])$(prefix+axis).textContent=Number.isFinite(values?.[i])?values[i].toFixed(3):'—';}}
  let opening=false,ports=[],selectedPort=null;
  const storage={get(key){try{return localStorage.getItem(key);}catch{return null;}},set(key,value){try{localStorage.setItem(key,value);}catch{}}};
  const portKey=port=>JSON.stringify(port.getInfo());
  const controller=new GRBL.Controller(event=>{
    if(event.type==='log'){
      const row=document.createElement('div');row.textContent=`${event.direction} ${event.text}`;$('serialLog').append(row);
      while($('serialLog').childElementCount>200)$('serialLog').firstChild.remove();
      $('serialLog').scrollTop=$('serialLog').scrollHeight;
    }
    if(event.type==='status'){
      showCoordinates(event.position,event.machinePosition);
      if(event.fields.Ov){const values=event.fields.Ov.split(',').map(Number);if(values.length===3&&values.every(Number.isFinite)){
        $('overrideFeedValue').textContent=values[0]+'%';$('overrideRapidValue').textContent=values[1]+'%';
        if(!controller.overrideBusy){$('overrideFeed').value=values[0];$('overrideRapid').value=[25,50,100].indexOf(values[1]);}
      }}
      window.CNCViewer?.setDevicePosition(event.position);
      if(controller.busy&&!controller.configuring)window.CNCViewer?.setLiveTool(true);
      $('deviceState').textContent=event.state;
      $('devicePosition').textContent=['MPos','WPos','FS'].filter(k=>event.fields[k]).map(k=>`${k}: ${event.fields[k]}`).join(' · ')||event.raw;
    }
    if(event.type==='connection'){$('deviceState').textContent=event.connected?controller.lastStatus?.state||'Подключено':'Отключено';if(!event.connected){$('overrideFeedValue').textContent=$('overrideRapidValue').textContent='—';showCoordinates(null,null);$('devicePosition').textContent='';window.CNCViewer?.setDevicePosition(null);}}
    if(event.type==='progress'&&!controller.manual){if(!event.done)window.CNCViewer?.setLiveTool(true);$('serialProgress').textContent=`Выполнено ${event.done} / ${event.total} · строка ${event.line}`;if(event.line)window.CNCViewer.selectLine(event.line);}
    if(event.type==='jogStart')$('jogMessage').textContent='Перемещение… Стоп: ⊘ или Esc';
    if(event.type==='jogComplete')$('jogMessage').textContent=event.cancelled?'Jog остановлен · Idle':'Перемещение завершено · Idle';
    if(event.type==='sending'&&!controller.manual){window.SmartEditor?.follow(event.line);$('serialMessage').textContent=`Отправлена строка ${event.line}; ожидание ok и Idle…`;}
    if(event.type==='resetting'){showCoordinates(null,null);$('serialMessage').textContent='Сброс GRBL → ожидание перезапуска → $X…';}
    if(event.type==='resetComplete')$('serialMessage').textContent='Сброс и разблокировка выполнены · Idle';
    if(event.type==='complete'&&!controller.manual)$('serialMessage').textContent='Программа выполнена · Idle';
    if(event.type==='error')$('serialMessage').textContent=event.message;
    if(event.type!=='status'&&event.type!=='log')update();
  });
  window.grblController=controller;
  function update(){
    const busy=controller.busy,connected=controller.connected;
    $('serialConnect').disabled=opening||busy||(!connected&&!selectedPort);
    $('serialPort').disabled=opening||connected;
    $('serialConnect').textContent=connected?'Разъединить':'Соединить';
    $('baudRate').disabled=opening||connected;
    $('serialSettings').disabled=opening||!connected||busy||controller.overrideBusy||controller.fault;
    $('serialSend').disabled=opening||!connected||busy||controller.overrideBusy||controller.fault;
    $('serialHold').disabled=!connected||!busy||controller.configuring||controller.jogging||controller.paused||controller.fault;
    $('serialResume').disabled=!connected||!busy||!controller.paused||controller.fault;
    $('serialReset').disabled=opening||!connected||controller.resetting;
    for(const id of ['jogXMinus','jogXPlus','jogYMinus','jogYPlus','jogZMinus','jogZPlus','jogStep','jogFeed'])$(id).disabled=opening||!connected||busy||controller.overrideBusy||controller.fault;
    $('jogStop').disabled=!connected||!controller.jogging||controller.resetting;
    for(const id of ['zeroXY','zeroZ','probeZ','safeZ'])$(id).disabled=opening||!connected||busy||controller.overrideBusy||controller.manual||controller.fault;
    const overrideDisabled=opening||!connected||controller.fault||controller.resetting||controller.configuring||controller.overrideBusy;
    for(const kind of ['Feed','Rapid']){$('override'+kind+'Enabled').disabled=overrideDisabled;$('override'+kind).disabled=overrideDisabled||!$('override'+kind+'Enabled').checked;}
    $('terminalSend').disabled=opening||!connected||busy||controller.overrideBusy||controller.manual||controller.fault;
    $('editor').readOnly=busy;
    for(const id of ['open','demo','process','ignoreUnsupported','play','prev','next','scrub'])$(id).disabled=busy;
  }
  async function action(fn){try{await fn();}catch(e){$('serialMessage').textContent=e.message;}finally{update();}}
  $('serialConnect').onclick=()=>action(async()=>{
    if(controller.connected){await controller.disconnect();return;}
    if(!navigator.serial||!window.isSecureContext)throw new Error('Web Serial недоступен. Откройте приложение в Chrome/Edge через http://127.0.0.1:4173 или HTTPS.');
    if(!selectedPort)throw new Error('Выберите доступный порт');
    opening=true;update();$('serialMessage').textContent='Открытие выбранного порта; ожидание запуска контроллера…';
    try{await controller.connect(navigator.serial,Number($('baudRate').value),selectedPort);$('serialMessage').textContent='Соединение установлено. Запуск отправит команды на станок.';}finally{opening=false;}
  });
  async function refreshPorts(preferred=selectedPort){
    if(!navigator.serial?.getPorts)return;
    ports=(await navigator.serial.getPorts()).filter(port=>port.connected!==false);
    selectedPort=ports.includes(preferred)?preferred:null;
    if(!selectedPort){const matches=ports.filter(p=>portKey(p)===storage.get('cnc-port'));if(matches.length===1)selectedPort=matches[0];else if(ports.length===1)selectedPort=ports[0];}
    const options=[];
    function option(value,text){const o=document.createElement('option');o.value=value;o.textContent=text;options.push(o);}
    if(!selectedPort)option('',ports.length?'Выберите порт':'Нет доступных портов');
    ports.forEach((port,i)=>{const info=port.getInfo();const hex=n=>n?.toString(16).padStart(4,'0')||'—';
      const name=storage.get('cnc-port-name:'+portKey(port))||(info.usbVendorId===0x0483?'STM32':'Serial');
      option(String(i),`${name} · ${hex(info.usbVendorId)}:${hex(info.usbProductId)}${ports.filter(p=>portKey(p)===portKey(port)).length>1?' · '+(i+1):''}`);
    });
    option('add','Изменить порт…');$('serialPort').replaceChildren(...options);$('serialPort').value=selectedPort?String(ports.indexOf(selectedPort)):'';update();
  }
  $('serialPort').onchange=()=>action(async()=>{
    if($('serialPort').value==='add'){
      opening=true;update();
      try{const port=await navigator.serial.requestPort();storage.set('cnc-port',portKey(port));await refreshPorts(port);}
      finally{opening=false;await refreshPorts();}
    }else{selectedPort=$('serialPort').value===''?null:ports[Number($('serialPort').value)]||null;if(selectedPort)storage.set('cnc-port',portKey(selectedPort));update();}
  });
  navigator.serial?.addEventListener?.('connect',()=>action(()=>refreshPorts()));
  navigator.serial?.addEventListener?.('disconnect',event=>action(async()=>{
    const port=event.port||event.target;
    if(port===controller.port)await controller.disconnect();
    await refreshPorts();
  }));
  action(()=>refreshPorts());
  $('serialSend').onclick=()=>action(async()=>{
    // Freeze the exact editor contents; visualization filtering never changes transmitted blocks.
    const source=$('editor').value;GRBL.prepare(source);$('process').click();
    await controller.run(source);
  });
  for(const [id,axis,sign] of [['jogXMinus','X',-1],['jogXPlus','X',1],['jogYMinus','Y',-1],['jogYPlus','Y',1],['jogZMinus','Z',-1],['jogZPlus','Z',1]])$(id).onclick=()=>action(async()=>{try{await controller.jog(axis,sign*Number($('jogStep').value),Number($('jogFeed').value));}catch(e){$('jogMessage').textContent=e.message;throw e;}});
  $('jogStop').onclick=()=>action(()=>controller.cancelJog());
  window.addEventListener('keydown',e=>{if(e.key==='Escape'&&controller.jogging){e.preventDefault();action(()=>controller.cancelJog());}});
  for(const id of ['zeroXY','zeroZ','probeZ','safeZ'])$(id).onclick=()=>action(async()=>{const label=$(id).textContent;$('machineMessage').textContent=label+'…';try{await controller.manualCommand(id);$('machineMessage').textContent=label+' · выполнено';}catch(e){$('machineMessage').textContent=label+': '+e.message;throw e;}});
  for(const kind of ['Feed','Rapid']){
    $('override'+kind+'Enabled').onchange=()=>action(async()=>{if(!$('override'+kind+'Enabled').checked)await controller.setOverride(kind.toLowerCase(),100);});
    $('override'+kind).onchange=()=>action(()=>controller.setOverride(kind.toLowerCase(),kind==='Feed'?Number($('overrideFeed').value):[25,50,100][Number($('overrideRapid').value)]));
  }
  const terminalHistory=[];let terminalIndex=0,terminalDraft='';
  $('terminalClear').onclick=()=>$('serialLog').replaceChildren();
  $('terminalForm').onsubmit=e=>{e.preventDefault();if($('terminalSend').disabled)return;const command=$('terminalInput').value.trim();if(!command)return;
    terminalHistory.push(command);terminalIndex=terminalHistory.length;terminalDraft='';$('terminalInput').value='';
    action(async()=>{try{await controller.terminal(command);}catch(error){const row=document.createElement('div');row.textContent='Ошибка: '+error.message;$('serialLog').append(row);throw error;}});
  };
  $('terminalInput').onkeydown=e=>{if(!['ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();if(terminalIndex===terminalHistory.length)terminalDraft=e.target.value;terminalIndex=Math.max(0,Math.min(terminalHistory.length,terminalIndex+(e.key==='ArrowUp'?-1:1)));e.target.value=terminalHistory[terminalIndex]??terminalDraft;};
  $('serialHold').onclick=()=>action(()=>controller.hold());
  $('serialResume').onclick=()=>action(()=>controller.resume());
  $('serialReset').onclick=()=>action(()=>controller.reset());
  window.addEventListener('beforeunload',e=>{if(controller.busy){e.preventDefault();e.returnValue='';}});
  update();
})();

