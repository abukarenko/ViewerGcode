/* GRBL 1.1 send/response transport. No automatic reconnect or command retry. */
(function(root){
  'use strict';
  function prepare(source){
    const blocks=[];
    source.split(/\r\n|\n|\r/).forEach((raw,i)=>{
      const code=raw.replace(/\([^)]*\)/g,'').replace(/;.*$/,'').replace(/\s/g,'').toUpperCase();
      if(!code||code==='%')return;
      if(!/^[A-Z0-9.+\-]+$/.test(code))throw new Error(`Строка ${i+1}: недопустимые символы или незакрытый комментарий`);
      if(code.length>79)throw new Error(`Строка ${i+1}: превышен лимит GRBL 79 символов`);
      blocks.push({code,line:i+1});
    });
    return blocks;
  }
  class Controller{
    constructor(onEvent=()=>{},options={}){this.emit=onEvent;this.timeout=options.timeout||120000;this.statusTimeout=options.statusTimeout||3000;this.interval=options.interval||1000/35;this.pendingStatus=null;this.nextStatusAt=0;this.reportScale=null;this.wco=null;this.connected=false;this.busy=false;this.paused=false;this.fault=false;this.pending=null;this.generation=0;}
    async connect(serial,baudRate,selectedPort){
      if(this.port)throw new Error('Порт уже открыт');
      const port=selectedPort||await serial.requestPort();
      await port.open({baudRate,dataBits:8,stopBits:1,parity:'none',flowControl:'none'});
      this.port=port;this.connected=true;this.fault=false;this.reportScale=null;this.wco=null;this.nextStatusAt=0;
      try{
        await port.setSignals({dataTerminalReady:true,requestToSend:true});
        this.emit({type:'log',direction:'→',text:'DTR=1 RTS=1'});
        this.writer=port.writable.getWriter();this.reader=port.readable.getReader();this.readTask=this.readLoop();
        // Opening USB serial can reboot an Arduino. Let its startup banner drain.
        await new Promise(r=>setTimeout(r,2000));
        if(!this.connected)throw new Error('Соединение потеряно');
        await this.request('ack','$$\n',this.statusTimeout);
        await this.status();this.emit({type:'connection',connected:true});
      }catch(e){await this.disconnect();throw e;}
    }
    async readLoop(){
      const decoder=new TextDecoder();let buffer='';
      try{while(true){const {value,done}=await this.reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});if(buffer.length>16384)throw new Error('Слишком длинный ответ устройства');let pos;while((pos=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,pos).trim();buffer=buffer.slice(pos+1);if(line)this.receive(line);}}
        if(this.connected)this.fail(new Error('Serial-порт закрыт устройством'));
      }catch(e){if(this.connected)this.fail(e);}
      finally{this.reader.releaseLock();}
    }
    receive(line){
      if(!line.startsWith('<'))this.emit({type:'log',direction:'←',text:line});
      if(this.pending?.kind==='reset'){if(/^Grbl\s/.test(line))this.settle(null,line);return;}
      const units=/^\$13=([01])(?:\.0+)?$/.exec(line);if(units){this.reportScale=units[1]==='1'?25.4:1;this.wco=null;}
      if(this.pending?.kind==='ack'&&line!=='ok'&&!line.startsWith('<')&&!/^error:/.test(line))this.pending.lines.push(line);
      if(/^ALARM:|^Grbl\s/.test(line)){if(this.busy||this.pending||this.pendingStatus)this.fail(new Error(line));return;}
      if(line.startsWith('<')&&line.endsWith('>')){
        const parts=line.slice(1,-1).split('|'),state=parts.shift(),fields={};
        for(const part of parts){const i=part.indexOf(':');if(i>=0)fields[part.slice(0,i)]=part.slice(i+1);}
        const vector=value=>{if(!value)return null;const v=value.split(',').slice(0,3).map(Number);return v.length===3&&v.every(Number.isFinite)?v:null;};
        if(fields.WCO)this.wco=vector(fields.WCO);
        const reportedMachine=vector(fields.MPos),reportedWork=vector(fields.WPos);
        const machine=reportedMachine||(reportedWork&&this.wco?reportedWork.map((v,i)=>v+this.wco[i]):null);
        const work=reportedWork||(reportedMachine&&this.wco?reportedMachine.map((v,i)=>v-this.wco[i]):null);
        const position=work&&this.reportScale?work.map(v=>v*this.reportScale):null;
        const machinePosition=machine&&this.reportScale?machine.map(v=>v*this.reportScale):null;
        this.lastStatus={state,fields,raw:line,position,machinePosition};this.emit({type:'status',...this.lastStatus});
        this.settleStatus(null,this.lastStatus);
      }else if(line==='ok'||/^error:/.test(line)){
        if(this.pending?.kind==='ack')this.settle(line==='ok'?null:new Error(line),this.pending.lines);
        else if(this.busy)this.fail(new Error('Неожиданный ответ GRBL: '+line));
      }
    }
    settle(error,value){const pending=this.pending;if(!pending)return;this.pending=null;clearTimeout(pending.timer);error?pending.reject(error):pending.resolve(value);}
    fail(error){this.fault=true;this.generation++;this.settle(error);this.settleStatus(error);this.emit({type:'error',message:error.message});}
    async write(text){if(!this.connected||!this.writer)throw new Error('Нет соединения');if(text!=='?')this.emit({type:'log',direction:'→',text:text==='\x18'?'Ctrl-X':text==='\x85'?'Jog cancel (0x85)':text.trim()});await this.writer.write(text==='\x85'?new Uint8Array([0x85]):new TextEncoder().encode(text));}
    request(kind,text,timeout){
      if(this.pending)return Promise.reject(new Error('Предыдущий запрос ещё не завершён'));
      return new Promise((resolve,reject)=>{
        const pending={kind,resolve,reject,lines:[],timer:setTimeout(()=>{if(this.pending===pending)this.settle(new Error('Тайм-аут ответа GRBL; повторная отправка отключена'));},timeout)};
        this.pending=pending;this.write(text).catch(e=>{if(this.pending===pending)this.settle(e);});
      });
    }
    settleStatus(error,value){const p=this.pendingStatus;if(!p)return;this.pendingStatus=null;clearTimeout(p.timer);clearTimeout(p.sendTimer);error?p.reject(error):p.resolve(value);}
    status(){
      if(this.pendingStatus)return this.pendingStatus.promise;
      const p={};p.promise=new Promise((resolve,reject)=>{p.resolve=resolve;p.reject=reject;});this.pendingStatus=p;
      const send=()=>{if(this.pendingStatus!==p)return;this.nextStatusAt=Date.now()+this.interval;
        p.timer=setTimeout(()=>{if(this.pendingStatus===p)this.settleStatus(new Error('Тайм-аут состояния GRBL'));},this.statusTimeout);
        this.write('?').catch(e=>{if(this.pendingStatus===p)this.settleStatus(e);});};
      const delay=this.nextStatusAt-Date.now();if(delay>0)p.sendTimer=setTimeout(send,delay);else send();return p.promise;
    }
    async systemCommand(command){
      if(!/^(\$\$|\$I|\$G|\$#|\$N|\$\d+=-?\d+(?:\.\d+)?)$/.test(command))throw new Error('Недопустимая команда настроек');
      if(!this.connected||this.busy||this.overrideBusy||this.pending||this.fault)throw new Error('Для настроек нужно свободное соединение без ошибок');
      this.busy=true;this.configuring=true;const generation=this.generation;
      this.emit({type:'settingsBusy'});
      try{
        const status=await this.status();
        if(generation!==this.generation)throw new Error('Соединение изменилось');
        if(!['Idle','Alarm'].includes(status.state))throw new Error('Настройки доступны только в Idle или Alarm');
        const result=await this.request('ack',command+'\n',this.statusTimeout);
        if(/^\$13=/.test(command)){this.reportScale=Number(command.split('=')[1])?25.4:1;this.wco=null;}
        return result;
      }catch(error){
        if(generation===this.generation&&!/^error:|^Настройки доступны/.test(error.message))this.fail(error);
        throw error;
      }finally{if(!this.resetting){this.busy=false;this.configuring=false;this.emit({type:'finished'});}}
    }
    async run(source){
      if(!this.connected||this.busy||this.overrideBusy||this.fault)throw new Error('Нужно свободное соединение без ошибок; после сбоя переподключитесь');
      const blocks=prepare(source);if(!blocks.length)throw new Error('Нет команд для отправки');
      this.busy=true;this.paused=false;const generation=++this.generation;
      const check=()=>{if(generation!==this.generation||!this.connected)throw new Error('Отправка остановлена');};
      this.emit({type:'progress',done:0,total:blocks.length,line:0});
      try{
        const initial=await this.status();check();if(initial.state!=='Idle')throw new Error('Для запуска требуется Idle, получено '+initial.state);
        this.pollTimer=setInterval(()=>{this.status().catch(e=>{if(this.busy&&!this.fault)this.fail(e);});},this.interval);
        for(let i=0;i<blocks.length;i++){
          check();while(this.paused){await new Promise(r=>setTimeout(r,this.interval));check();}
          const block=blocks[i];this.emit({type:'sending',line:block.line});
          await this.request('ack',block.code+'\n',this.timeout);check();
          while(true){
            const status=await this.status();check();
            if(status.state==='Idle'&&!this.paused)break;
            if(!/^(Idle|Run|Hold(?::\d+)?|Door(?::\d+)?)$/.test(status.state))throw new Error('Отправка остановлена: '+status.state);
            await new Promise(r=>setTimeout(r,this.interval));check();
          }
          this.emit({type:'progress',done:i+1,total:blocks.length,line:block.line});
        }
        this.emit({type:'complete'});
      }catch(e){if(generation===this.generation){this.fail(e);try{await this.write('!');}catch{}}throw e;}
      finally{clearInterval(this.pollTimer);this.pollTimer=null;if(!this.resetting){this.busy=false;this.paused=false;this.emit({type:'finished'});}}
    }
    async terminal(command){
      command=command.trim();
      if(!command||command.length>79||!/^[\x20-\x7e]+$/.test(command))throw new Error('Введите одну ASCII-команду, до 79 символов');
      if(!this.connected||this.busy||this.overrideBusy||this.manual||this.fault)throw new Error('Терминал: дождитесь завершения текущей операции');
      if(command==='?'){const report=await this.status();this.emit({type:'log',direction:'←',text:report.raw});return;}
      if(/[?!~]/.test(command))throw new Error('Для паузы и продолжения используйте кнопки управления');
      this.busy=true;this.configuring=true;const generation=this.generation;this.emit({type:'terminalBusy'});
      const check=()=>{if(generation!==this.generation||!this.connected)throw new Error('Команда прервана');};
      try{
        const initial=await this.status();check();if(!['Idle','Alarm','Check'].includes(initial.state))throw new Error('Терминал: устройство занято ('+initial.state+')');
        await this.request('ack',command+'\n',this.timeout);check();
        if(/^\$13=/.test(command)){this.reportScale=Number(command.split('=')[1])?25.4:1;}
        this.wco=null;
        while(true){const report=await this.status();check();if(['Idle','Alarm','Check','Sleep'].includes(report.state)){this.emit({type:'log',direction:'←',text:report.raw});break;}await new Promise(r=>setTimeout(r,this.interval));check();}
      }catch(error){if(generation===this.generation&&!/^error:|^Терминал: устройство/.test(error.message))this.fail(error);throw error;}
      finally{if(!this.resetting){this.busy=false;this.configuring=false;this.emit({type:'finished'});}}
    }
    async setOverride(kind,target){
      if(!['feed','rapid'].includes(kind)||!Number.isInteger(target)||(kind==='feed'?(target<10||target>200):![25,50,100].includes(target)))throw new Error('Недопустимое значение коррекции');
      if(!this.connected||this.fault||this.resetting||this.configuring||this.overrideBusy)throw new Error('Коррекция сейчас недоступна');
      this.overrideBusy=true;const generation=this.generation;const index=kind==='feed'?0:1;
      const check=()=>{if(!this.connected||this.fault||this.resetting||generation!==this.generation)throw new Error('Изменение коррекции прервано');};
      this.emit({type:'overrideBusy'});
      const read=async(expected)=>{
        const deadline=Date.now()+this.statusTimeout;
        while(Date.now()<deadline){check();const report=await this.status();check();const values=report.fields.Ov?.split(',').map(Number);
          if(values?.length===3&&values.every(Number.isFinite)&&(expected===undefined||values[index]===expected))return values[index];
          await new Promise(r=>setTimeout(r,this.interval));
        }
        throw new Error('Нет подтверждения Ov от GRBL; проверьте фактический процент');
      };
      try{
        let current=await read();
        while(current!==target){
          check();let code,next;
          if(kind==='rapid'){code={100:0x95,50:0x96,25:0x97}[target];next=target;}
          else if(target===100){code=0x90;next=100;}
          else{const delta=target-current,step=Math.abs(delta)>=10?10:1;code=delta>0?(step===10?0x91:0x93):(step===10?0x92:0x94);next=current+Math.sign(delta)*step;}
          this.emit({type:'log',direction:'→',text:`Override ${kind}: ${next}% (0x${code.toString(16)})`});
          await this.writer.write(new Uint8Array([code]));current=await read(next);
        }
        return current;
      }finally{this.overrideBusy=false;this.emit({type:'overrideFinished'});}
    }
    async manualCommand(kind){
      if(this.manual||this.busy||this.overrideBusy||!this.connected||this.fault)throw new Error('Нужно свободное соединение без ошибок');
      const commands={zeroXY:'G92X0Y0',zeroZ:'G92Z0',safeZ:'G53G90G0Z0'};
      if(kind!=='probeZ'&&!commands[kind])throw new Error('Неизвестная команда');
      this.manual=true;
      try{
        let source=commands[kind];
        if(kind==='probeZ'){
          const settings=await this.systemCommand('$$');
          if(settings.some(line=>/^\$7=1(?:\.0+)?$/.test(line)))throw new Error('Щуп недоступен при $7=1. Отключите режим продолжения M0 от щупа.');
          const lines=await this.systemCommand('$G');
          const state=lines.find(line=>line.startsWith('[GC:'));
          if(!state)throw new Error('Не удалось прочитать режимы $G');
          const modes=state.slice(4,-1).split(/\s+/);
          const units=modes.find(x=>/^G2[01]$/.test(x)),distance=modes.find(x=>/^G9[01]$/.test(x)),feedMode=modes.find(x=>/^G9[34]$/.test(x)),feed=modes.find(x=>/^F[\d.]+$/.test(x));
          if(!units||!distance||!feedMode||!feed)throw new Error('Неполный ответ $G');
          if(!this.reportScale)throw new Error('Неизвестны единицы отчёта $13');
          const motion=modes.find(x=>/^(G0|G1|G2|G3|G38\.[2345]|G80)$/.test(x));
          if(!['G0','G1','G80'].includes(motion))throw new Error('Перед щупом выберите режим G0 или G1: текущий режим нельзя восстановить без движения');
          const restoredFeed=Number(feed.slice(1))*this.reportScale/(units==='G20'&&feedMode==='G94'?25.4:1);
          source=`G21G91G94\nG38.2Z-30F100\nG0Z1\nG38.2Z-2F10\nG92Z0\nG91G0Z5\n${units}${distance}${feedMode}${motion}F${restoredFeed.toFixed(4)}`;
        }
        this.wco=null;
        await this.run(source);
      }finally{this.manual=false;this.emit({type:'finished'});}
    }
    async jog(axis,distance,feed){
      if(!['X','Y','Z'].includes(axis)||!Number.isFinite(distance)||distance===0||Math.abs(distance)>100||!Number.isFinite(feed)||feed<=0||feed>10000)throw new Error('Jog: шаг 0–100 мм, подача 1–10000 мм/мин');
      if(!this.connected||this.busy||this.overrideBusy||this.pending||this.fault)throw new Error('Jog: нужно свободное соединение без ошибок');
      this.busy=true;this.jogging=true;this.jogCancelled=false;const generation=++this.generation;
      const check=()=>{if(generation!==this.generation||!this.connected)throw new Error('Jog остановлен');};
      this.emit({type:'jogStart'});
      try{
        const initial=await this.status();check();
        if(initial.state!=='Idle')throw new Error('Jog доступен только в Idle, получено '+initial.state);
        if(this.jogCancelled)return;
        this.pollTimer=setInterval(()=>this.status().catch(e=>{if(this.jogging&&!this.fault)this.fail(e);}),this.interval);
        await this.request('ack',`$J=G91 G21 ${axis}${distance.toFixed(3)} F${feed.toFixed(1)}\n`,this.timeout);check();
        while(true){const state=await this.status();check();if(state.state==='Idle')break;
          if(!/^(Jog|Hold(?::\d+)?)$/.test(state.state))throw new Error('Jog: '+state.state);
          await new Promise(r=>setTimeout(r,this.interval));check();
        }
        this.emit({type:'jogComplete',cancelled:this.jogCancelled});
      }catch(error){
        if(generation===this.generation){if(!/^error:|^Jog доступен/.test(error.message)){this.fail(error);try{await this.write('\x85');}catch{}}}
        throw error;
      }finally{clearInterval(this.pollTimer);this.pollTimer=null;this.jogging=false;if(!this.resetting){this.busy=false;this.emit({type:'finished'});}}
    }
    async cancelJog(){if(!this.jogging)return;this.jogCancelled=true;await this.write('\x85');}
    async hold(){this.paused=true;await this.write('!');}
    async resume(){if(this.fault)throw new Error('После сбоя переподключитесь');await this.write('~');this.paused=false;}
    async reset(){
      if(!this.connected||this.resetting)throw new Error('Нет соединения или сброс уже выполняется');
      this.resetting=true;this.busy=true;this.configuring=true;this.paused=false;this.fault=true;this.generation++;
      clearInterval(this.pollTimer);this.pollTimer=null;
      const cancelled=new Error('Программа отменена сбросом GRBL');this.settle(cancelled);this.settleStatus(cancelled);
      this.wco=null;this.nextStatusAt=0;this.emit({type:'resetting'});
      try{
        await this.request('reset','\x18',this.statusTimeout);
        await this.request('ack','$X\n',this.statusTimeout);
        const status=await this.status();
        if(status.state!=='Idle')throw new Error('После сброса и $X состояние: '+status.state);
        this.fault=false;this.emit({type:'resetComplete'});
      }catch(error){this.fail(error);throw error;}
      finally{this.resetting=false;this.busy=false;this.configuring=false;this.emit({type:'finished'});}
    }
    async disconnect(){
      this.connected=false;this.generation++;clearInterval(this.pollTimer);this.settle(new Error('Соединение закрыто'));this.settleStatus(new Error('Соединение закрыто'));
      try{await this.reader?.cancel();await this.readTask;}finally{
        this.writer?.releaseLock();this.writer=null;this.reader=null;
        const port=this.port;this.port=null;try{await port?.close();}finally{this.emit({type:'connection',connected:false});}
      }
    }
  }
  const api={Controller,prepare};if(typeof module!=='undefined')module.exports=api;else root.GRBL=api;
})(typeof window!=='undefined'?window:globalThis);
