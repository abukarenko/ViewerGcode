(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  function showCoordinates(work,machine){for(const [i,axis] of [...'XYZ'].entries()){for(const [prefix,values] of [['work',work],['machine',machine]])$(prefix+axis).textContent=Number.isFinite(values?.[i])?values[i].toFixed(3):'—';}}
  let opening=false,ports=[],selectedPort=null,pendingLogRow=null;
  const demoPort=new DemoGRBL.DemoPort();window.demoPort=demoPort;
  const storage={get(key){try{return localStorage.getItem(key);}catch{return null;}},set(key,value){try{localStorage.setItem(key,value);}catch{}}};
  const savedFeed=Number(storage.get('cnc-jog-feed'));
  if(Number.isFinite(savedFeed)&&savedFeed>0&&savedFeed<=10000)$('jogFeed').value=String(savedFeed);
  $('jogFeed').oninput=()=>{const feed=Number($('jogFeed').value);if(Number.isFinite(feed)&&feed>0&&feed<=10000)storage.set('cnc-jog-feed',String(feed));};
  $('jogStep').oninput=()=>{$('jogStep').value=$('jogStep').value.replace(/[^0-9]/g,'.');};
  const portKey=port=>JSON.stringify(port.getInfo());
  const controller=new GRBL.Controller(event=>{
    if(event.type==='log'){
      if(event.direction==='←'&&(event.text==='ok'||/^error:/.test(event.text))&&pendingLogRow?.parentNode===$('serialLog')){
        pendingLogRow.textContent+='  ← '+event.text;pendingLogRow=null;
      }else{
        const row=document.createElement('div');row.textContent=`${event.direction} ${event.text}`;$('serialLog').append(row);
        if(event.direction==='→'&&event.ackExpected)pendingLogRow=row;
      }
      if(/^ALARM:|^Grbl\s/.test(event.text)||event.text==='Ctrl-X')pendingLogRow=null;
      while($('serialLog').childElementCount>200)$('serialLog').firstChild.remove();
      $('serialLog').scrollTop=$('serialLog').scrollHeight;
    }
    if(event.type==='status'){
      window.CNCViewer?.setDeviceState(event.state);
      window.CNCViewer?.setMachineCoordinates?.(event.machinePosition,event.position);
      showCoordinates(event.position,event.machinePosition);
      if(event.fields.Ov){const values=event.fields.Ov.split(',').map(Number);if(values.length===3&&values.every(Number.isFinite)){
        $('overrideFeedValue').textContent=values[0]+'%';$('overrideRapidValue').textContent=values[1]+'%';
        if(!controller.overrideBusy){$('overrideFeed').value=values[0];$('overrideRapid').value=[25,50,100].indexOf(values[1]);}
      }}
      window.CNCViewer?.setDevicePosition(event.position);
      if(controller.busy&&(!controller.configuring||/^(Home|Run|Jog)/.test(event.state)))window.CNCViewer?.setLiveTool(true);
      $('deviceState').textContent=event.state;
      $('devicePosition').textContent=['MPos','WPos','FS'].filter(k=>event.fields[k]).map(k=>`${k}: ${event.fields[k]}`).join(' · ')||event.raw;
    }
    if(event.type==='connection'){pendingLogRow=null;$('deviceState').textContent=event.connected?controller.lastStatus?.state||'Подключено':'Отключено';if(!event.connected){window.CNCViewer?.setDeviceState(null);window.CNCViewer?.setMachineEnvelope?.(null);$('overrideFeedValue').textContent=$('overrideRapidValue').textContent='—';showCoordinates(null,null);$('devicePosition').textContent='';window.CNCViewer?.setDevicePosition(null);}}
    if(event.type==='progress'&&!controller.manual){if(!event.done)window.CNCViewer?.setLiveTool(true);$('serialProgress').textContent=`Выполнено ${event.done} / ${event.total} · строка ${event.line}`;if(event.line)window.CNCViewer.selectLine(event.line);}
    if(event.type==='jogQueue')$('jogMessage').textContent=event.count?`Jog: ${event.count} / 5 нажатий · Стоп очищает очередь`:'Очередь Jog пуста';
    if(event.type==='jogStart')$('jogMessage').textContent='Перемещение… Стоп: ⊘ или Esc';
    if(event.type==='jogComplete')$('jogMessage').textContent=event.cancelled?'Jog остановлен · Idle':'Перемещение завершено · Idle';
    if(event.type==='sending'&&!controller.manual){window.SmartEditor?.follow(event.line);$('serialMessage').textContent=`Отправлена строка ${event.line}; ожидание ok и Idle…`;}
    if(event.type==='resetting'){window.CNCViewer?.setMachineEnvelope?.(null);showCoordinates(null,null);$('serialMessage').textContent='Сброс GRBL → ожидание перезапуска → $X…';}
    if(event.type==='resetComplete')$('serialMessage').textContent='Сброс и разблокировка выполнены · Idle';
    if(event.type==='complete'&&!controller.manual)$('serialMessage').textContent='Программа выполнена · Idle';
    if(event.type==='error'){pendingLogRow=null;$('serialMessage').textContent=event.message;if(/^ALARM:/.test(event.message))window.CNCViewer?.setDeviceState('Alarm');}
    if(event.type!=='status'&&event.type!=='log')update();
  });
  window.grblController=controller;
  function update(){
    const busy=controller.busy||controller.jogQueueActive,connected=controller.connected;
    $('serialConnect').disabled=opening||busy||(!connected&&!selectedPort&&!$('demoMode').checked);
    $('demoMode').disabled=opening||connected;
    $('demoSettings').hidden=!$('demoMode').checked;
    $('serialPort').disabled=opening||connected||$('demoMode').checked;
    $('serialConnect').textContent=connected?'Разъединить':'Соединить';
    $('baudRate').disabled=opening||connected;
    $('serialSettings').disabled=opening||(!$('demoMode').checked&&(!connected||busy||controller.overrideBusy||controller.fault));
    $('serialSend').disabled=opening||!connected||busy||controller.overrideBusy||controller.fault;
    $('serialHold').disabled=!connected||!busy||controller.configuring||controller.jogging||controller.paused||controller.fault;
    $('serialResume').disabled=!connected||!busy||!controller.paused||controller.fault;
    $('serialReset').disabled=opening||!connected||controller.resetting;
    for(const id of ['jogXMinus','jogXPlus','jogYMinus','jogYPlus','jogZMinus','jogZPlus','jogStep','jogFeed'])$(id).disabled=opening||!connected||(busy&&!controller.jogQueueActive)||controller.jogQueueStopping||controller.overrideBusy||controller.fault||((controller.jogQueue?.length||0)+(controller.jogQueueActive?1:0)>=5);
    $('jogStop').disabled=!connected||!controller.jogging||controller.resetting;
    for(const id of ['zeroXY','zeroZ','probeZ','safeZ'])$(id).disabled=opening||!connected||busy||controller.overrideBusy||controller.manual||controller.fault;
    for(const id of ['center','centerZ'])$(id).disabled=opening||!connected||busy||controller.overrideBusy||controller.manual||controller.fault;
    $('restoreZero').disabled=opening||!connected||busy||controller.overrideBusy||controller.manual||controller.fault||!controller.savedWorkOffset;
    const overrideDisabled=opening||!connected||controller.fault||controller.resetting||controller.configuring||controller.overrideBusy;
    for(const kind of ['Feed','Rapid']){$('override'+kind+'Enabled').disabled=overrideDisabled;$('override'+kind).disabled=overrideDisabled||!$('override'+kind+'Enabled').checked;}
    $('home').disabled=opening||!connected||busy||controller.overrideBusy||controller.manual||controller.fault;
    $('terminalSend').disabled=opening||!connected||busy||controller.overrideBusy||controller.manual||controller.fault;
    $('editor').readOnly=busy;
    for(const id of ['open','demo','process','ignoreUnsupported','play','prev','next','scrub'])$(id).disabled=busy;
  }
  async function action(fn){try{await fn();}catch(e){$('serialMessage').textContent=e.message;}finally{update();}}
  $('serialConnect').onclick=()=>action(async()=>{
    if(controller.connected){await controller.disconnect();return;}
    if($('demoMode').checked){opening=true;update();try{await controller.connect(null,115200,demoPort);$('serialMessage').textContent='DEMO · подключён имитатор станка';}finally{opening=false;}return;}
    if(!navigator.serial||!window.isSecureContext)throw new Error('Web Serial недоступен. Откройте приложение в Chrome/Edge через http://127.0.0.1:4173 или HTTPS.');
    if(!selectedPort)throw new Error('Выберите доступный порт');
    opening=true;update();$('serialMessage').textContent='Открытие выбранного порта; ожидание запуска контроллера…';
    try{await controller.connect(navigator.serial,Number($('baudRate').value),selectedPort);$('serialMessage').textContent='Соединение установлено. Запуск отправит команды на станок.';}finally{opening=false;}
  });
  $('demoMode').onchange=()=>{$('serialMessage').textContent=$('demoMode').checked?'DEMO · нажмите «Соединить»; параметры имитатора — в настройках GRBL':'Выбран реальный Serial-порт';update();};
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
    const source=$('editor').value;GRBL.prepare(source);await window.HeightMapUI?.beforeSend(source);$('process').click();
    await controller.run(source);
  });
  for(const [id,axis,sign] of [['jogXMinus','X',-1],['jogXPlus','X',1],['jogYMinus','Y',-1],['jogYPlus','Y',1],['jogZMinus','Z',-1],['jogZPlus','Z',1]])$(id).onclick=()=>action(async()=>{try{await controller.enqueueJog(axis,sign*Number($('jogStep').value),Number($('jogFeed').value));}catch(e){$('jogMessage').textContent=e.message;throw e;}});
  async function home(){
    window.CNCViewer?.setMachineEnvelope?.(null);$('machineMessage').textContent='Поиск машинного нуля…';
    await controller.terminal('$H');
    if(controller.lastStatus?.state!=='Idle')throw new Error('Home не завершён в Idle');
    const settings=GRBLSettings.parse(await controller.systemCommand('$$'));
    const size=[130,131,132].map(id=>Number(settings.get(String(id))));
    if(!size.every(v=>Number.isFinite(v)&&v>0))throw new Error('Home выполнен, но $130–$132 не содержат размеры рабочего объёма');
    let report;const deadline=Date.now()+controller.statusTimeout;
    do{report=await controller.status();if(report.position&&report.machinePosition)break;}while(Date.now()<deadline);
    if(!report.position||!report.machinePosition)throw new Error('Home выполнен; нет WCO для отображения стола');
    window.CNCViewer?.setMachineCoordinates?.(report.machinePosition,report.position);
    window.CNCViewer?.setMachineEnvelope?.(size,!!controller.port?.isDemo);
    $('machineMessage').textContent='Home · стол '+size.join(' × ')+' мм';
  }
  $('home').onclick=()=>action(home);
  $('jogStop').onclick=()=>action(()=>controller.cancelJog());
  $('center').onclick=()=>action(async()=>{await controller.manualCommand('center',{height:Number($('centerZ').value),feed:Number($('jogFeed').value)});$('machineMessage').textContent='Переход к рабочему X0 Y0 завершён';});
  window.addEventListener('keydown',e=>{if(e.key==='Escape'&&controller.jogging){e.preventDefault();action(()=>controller.cancelJog());}});
  for(const id of ['zeroXY','zeroZ','probeZ','safeZ'])$(id).onclick=()=>action(async()=>{const label=$(id).textContent;$('machineMessage').textContent=label+'…';try{await controller.manualCommand(id);$('machineMessage').textContent=label+' · выполнено';}catch(e){$('machineMessage').textContent=label+': '+e.message;throw e;}});
  for(const kind of ['Feed','Rapid']){
    $('override'+kind+'Enabled').onchange=()=>action(async()=>{if(!$('override'+kind+'Enabled').checked)await controller.setOverride(kind.toLowerCase(),100);});
    $('override'+kind).onchange=()=>action(()=>controller.setOverride(kind.toLowerCase(),kind==='Feed'?Number($('overrideFeed').value):[25,50,100][Number($('overrideRapid').value)]));
  }
  const terminalHistory=[];let terminalIndex=0,terminalDraft='';
  $('terminalClear').onclick=()=>{pendingLogRow=null;$('serialLog').replaceChildren();};
  $('terminalForm').onsubmit=e=>{e.preventDefault();if($('terminalSend').disabled)return;const command=$('terminalInput').value.trim();if(!command)return;
    terminalHistory.push(command);terminalIndex=terminalHistory.length;terminalDraft='';$('terminalInput').value='';
    action(async()=>{try{if(command.toUpperCase()==='$H')await home();else await controller.terminal(command);}catch(error){const row=document.createElement('div');row.textContent='Ошибка: '+error.message;$('serialLog').append(row);throw error;}});
  };
  $('terminalInput').onkeydown=e=>{if(!['ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();if(terminalIndex===terminalHistory.length)terminalDraft=e.target.value;terminalIndex=Math.max(0,Math.min(terminalHistory.length,terminalIndex+(e.key==='ArrowUp'?-1:1)));e.target.value=terminalHistory[terminalIndex]??terminalDraft;};
  $('serialHold').onclick=()=>action(()=>controller.hold());
  $('serialResume').onclick=()=>action(()=>controller.resume());
  $('serialReset').onclick=()=>action(()=>controller.reset());
  $('restoreZero').onclick=()=>action(async()=>{await controller.restoreWorkZero();$('machineMessage').textContent='Рабочий ноль восстановлен без перемещения';});
  window.addEventListener('beforeunload',e=>{if(controller.busy){e.preventDefault();e.returnValue='';}});
  update();
})();

