const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Controller,prepare}=require('./grbl.js');
const wait=()=>new Promise(r=>setTimeout(r,5));
function fake(){const events=[],sent=[];const c=new Controller(e=>events.push(e),{timeout:60,statusTimeout:60,interval:1});c.connected=true;c.writer={write:async bytes=>sent.push(new TextDecoder().decode(bytes))};return {c,events,sent};}
test('prepare preserves source lines, removes comments and rejects realtime injection before sending',()=>{
 assert.deepEqual(prepare('(русский)\r\nG1 X2 ; comment\n%\nM30'),[{code:'G1X2',line:2},{code:'M30',line:4}]);
 for(const text of ['G1X2!','G1X2?','$H','G1(unclosed','G1X'+ '1'.repeat(78)])assert.throws(()=>prepare(text));
});
test('each block waits for acknowledgement and actual Idle; progress includes modal lines',async()=>{
 const {c,sent,events}=fake();const run=c.run('G21\nG1 X2');
 assert.deepEqual(sent,['?']);c.receive('<Idle|MPos:0,0,0>');await wait();
 assert.deepEqual(sent.filter(s=>s!=='?'),['G21\n']);c.receive('<Run|MPos:0,0,0>');await wait();assert.equal(sent.filter(s=>s!=='?').length,1);
 c.receive('ok');await wait();assert.equal(sent.at(-1),'?');
 c.receive('<Run|MPos:1,0,0>');await wait();assert.equal(sent.includes('G1X2\n'),false);
 c.receive('<Idle|MPos:0,0,0>');await wait();assert.equal(sent.filter(s=>s!=='?').at(-1),'G1X2\n');
 c.receive('ok');await wait();c.receive('<Idle|WPos:2,0,0|FS:0,0>');await run;
 assert.equal(events.filter(e=>e.type==='progress').at(-1).done,2);assert.equal(c.busy,false);
});
test('error stops queue and prevents rerun',async()=>{
 const {c,sent}=fake();const run=c.run('G1X1\nG1X2');const rejected=assert.rejects(run,/error:20/);
 c.receive('<Idle>');await wait();c.receive('error:20');await rejected;
 assert.equal(sent.includes('G1X2\n'),false);assert.equal(sent.at(-1),'!');await assert.rejects(c.run('G1X2'));
});
test('timeout does not resend a command',async()=>{
 const {c,sent}=fake();const run=c.run('G1X1');const rejected=assert.rejects(run,/Тайм-аут/);c.receive('<Idle>');await rejected;
 assert.equal(sent.filter(s=>s==='G1X1\n').length,1);assert.equal(c.fault,true);
});
test('pause prevents next block until resume',async()=>{
 const {c,sent}=fake();const run=c.run('G1X1\nG1X2');c.receive('<Idle>');await wait();await c.hold();c.receive('ok');await wait();c.receive('<Idle>');await wait();
 assert.equal(sent.includes('G1X2\n'),false);await c.resume();c.receive('<Idle>');await wait();assert.equal(sent.filter(s=>s!=='?').at(-1),'G1X2\n');
 c.receive('ok');await wait();c.receive('<Idle>');await run;
});
test('alarm and reset abort pending work',async()=>{
 for(const mode of ['alarm','restart']){
 const {c,sent}=fake();const run=c.run('G1X1\nG1X2');const rejected=assert.rejects(run);c.receive('<Idle>');await wait();
 if(mode==='reset')await c.reset();else c.receive(mode==='alarm'?'ALARM:1':"Grbl 1.1h ['$' for help]");
 await rejected;assert.equal(sent.includes('G1X2\n'),false);assert.equal(c.fault,true);
 }
});
test('read loop joins split responses and handles multiple responses per chunk',async()=>{
 const {c,events}=fake();let released=false;const chunks=['<Id','le|MPos:1,2,3>\r\nok\n'];
 c.reader={read:async()=>chunks.length?{value:new TextEncoder().encode(chunks.shift()),done:false}:{done:true},releaseLock(){released=true;}};
 await c.readLoop();assert.equal(events.find(e=>e.type==='status').fields.MPos,'1,2,3');assert.equal(released,true);assert.equal(c.fault,true);
});
test('missing status after ok stops before next line',async()=>{
 const {c,sent}=fake();const run=c.run('G1X1\nG1X2');const rejected=assert.rejects(run,/Тайм-аут/);
 c.receive('<Idle>');await wait();c.receive('ok');await rejected;assert.equal(sent.includes('G1X2\n'),false);
});
test('disconnect aborts pending command and closes port locks',async()=>{
 const {c,sent}=fake();let released=false,closed=false;
 c.writer.releaseLock=()=>released=true;c.reader={cancel:async()=>{}};c.port={close:async()=>closed=true};
 const run=c.run('G1X1\nG1X2');const rejected=assert.rejects(run);c.receive('<Idle>');await wait();await c.disconnect();await rejected;
 assert.equal(sent.includes('G1X2\n'),false);assert.equal(c.connected,false);assert.equal(released&&closed,true);
});
test('non-idle device never receives program blocks',async()=>{
 const {c,sent}=fake();const run=c.run('G1X1');const rejected=assert.rejects(run,/Idle/);c.receive('<Alarm>');await rejected;assert.equal(sent.includes('G1X1\n'),false);
});
test('connect asserts DTR and RTS after opening and before status; reconnect repeats signals',async()=>{
 const calls=[];let stream;
 const port={
  async open(){calls.push('open');this.readable=new ReadableStream({start(c){stream=c;}});this.writable=new WritableStream({write(bytes){calls.push(new TextDecoder().decode(bytes));stream.enqueue(new TextEncoder().encode(new TextDecoder().decode(bytes)==='$$\n'?'$13=0\r\nok\r\n':'<Idle|MPos:0,0,0|WCO:0,0,0>\r\n'));}});},
  async setSignals(signals){calls.push(signals);},async close(){calls.push('close');}
 };
 const c=new Controller();
 for(let i=0;i<2;i++){await c.connect({requestPort:async()=>{assert.equal(i,0,'reconnect must not open picker');return port;}},115200,i===1?port:undefined);assert.equal(c.connected,true);await c.disconnect();}
 assert.deepEqual(calls,['open',{dataTerminalReady:true,requestToSend:true},'$$\n','?','close','open',{dataTerminalReady:true,requestToSend:true},'$$\n','?','close']);
});
test('signal setup failure closes port without sending commands',async()=>{
 let closed=false;const c=new Controller();
 await assert.rejects(c.connect({requestPort:async()=>({open:async()=>{},setSignals:async()=>{throw new Error('signal failure');},close:async()=>{closed=true;}})},115200),/signal failure/);
 assert.equal(closed,true);assert.equal(c.connected,false);assert.equal(c.port,null);
});
const settings=require('./settings.js');
test('settings preserve firmware extensions and reject command injection',()=>{
 const values=settings.parse(['$0=10','$7=0','$103=10.000','ok']);assert.equal(values.get('103'),'10.000');
 assert.match(settings.describe('999')[1],/прошивки/);assert.equal(settings.command('100','400,5'),'$100=400.5');
 for(const value of ['','NaN','10\n$H','1e3','-1'])assert.throws(()=>settings.command('100',value));
});
test('system command collects multiline settings, waits for ok and excludes streaming',async()=>{
 const {c,sent}=fake();const reading=c.systemCommand('$$');
 await assert.rejects(c.run('G1X1'));await assert.rejects(c.systemCommand('$I'));
 c.receive('<Idle>');await wait();assert.equal(sent.at(-1),'$$\n');
 c.receive('$0=10');c.receive('$103=10.000');assert.equal(c.busy,true);c.receive('ok');
 assert.deepEqual(await reading,['$0=10','$103=10.000']);assert.equal(c.busy,false);
});
test('setting write waits for response and reports rejection without losing synchronization',async()=>{
 const {c,sent}=fake();const writing=c.systemCommand('$100=400');const rejected=assert.rejects(writing,/error:3/);
 c.receive('<Idle>');await wait();assert.equal(sent.at(-1),'$100=400\n');c.receive('error:3');await rejected;
 assert.equal(c.fault,false);assert.equal(c.busy,false);
 await assert.rejects(c.systemCommand('$H'));await assert.rejects(c.systemCommand('$0=1\n$H'));
});
test('settings timeout faults connection and motion state blocks writing',async()=>{
 const first=fake();const reading=first.c.systemCommand('$$');const rejected=assert.rejects(reading,/Тайм-аут/);await rejected;assert.equal(first.c.fault,true);
 const {c,sent}=fake();const writing=c.systemCommand('$0=10');const blocked=assert.rejects(writing,/Idle/);c.receive('<Run>');await blocked;assert.deepEqual(sent,['?']);
});
test('settings button follows connection lifecycle and re-enables after settings operation',async()=>{
 const vm=require('node:vm'),fs=require('node:fs');
 const elements=new Map();
 const element=id=>{if(!elements.has(id))elements.set(id,{disabled:true,textContent:'',value:'115200',replaceChildren(){}});return elements.get(id);};
 class UIController{
  constructor(emit){this.emit=emit;this.connected=false;this.busy=false;this.fault=false;}
  async connect(){this.connected=true;this.emit({type:'connection',connected:true});}
  async disconnect(){this.connected=false;this.emit({type:'connection',connected:false});}
 }
 const window={isSecureContext:true,addEventListener(){}};
 vm.runInNewContext(fs.readFileSync(require.resolve('./serial-ui.js'),'utf8'),{document:{getElementById:element,createElement:()=>({})},window,navigator:{serial:{getPorts:async()=>[{getInfo:()=>({usbVendorId:0x0483,usbProductId:0x5740}),connected:true}]}},GRBL:{Controller:UIController}});
 await wait();
 const button=element('serialSettings'),c=window.grblController;
 assert.equal(button.disabled,true);
 await element('serialConnect').onclick();assert.equal(button.disabled,false);
 c.busy=true;c.emit({type:'settingsBusy'});assert.equal(button.disabled,true);
 c.busy=false;c.emit({type:'finished'});assert.equal(button.disabled,false);
 c.fault=true;c.emit({type:'error',message:'fault'});assert.equal(button.disabled,true);
 c.fault=false;c.emit({type:'finished'});assert.equal(button.disabled,false);
 await element('serialConnect').onclick();assert.equal(button.disabled,true);
});

test('status and command acknowledgement are independent and duplicate status calls coalesce',async()=>{
 const {c,sent}=fake();const ack=c.request('ack','G1X5\n',200);const status=c.status();
 assert.equal(c.status(),status);assert.deepEqual(sent,['G1X5\n','?']);
 c.receive('<Run|WPos:1,2,3>');await status;assert.equal(c.pending.kind,'ack');
 c.receive('ok');assert.deepEqual(await ack,[]);
});
test('telemetry converts machine to work coordinates, caches WCO and respects inches',()=>{
 const {c}=fake();c.receive('$13=0');c.receive('<Run|MPos:100,20,30,40>');assert.equal(c.lastStatus.position,null);
 c.receive('<Run|MPos:100,20,30,40|WCO:90,10,5,0>');assert.deepEqual(c.lastStatus.position,[10,10,25]);
 c.receive('<Run|MPos:101,22,33,40>');assert.deepEqual(c.lastStatus.position,[11,12,28]);
 c.receive('$13=1');c.receive('<Run|MPos:1,2,3,40>');assert.equal(c.lastStatus.position,null);
 c.receive('<Run|WPos:1,2,3,40>');assert.deepEqual(c.lastStatus.position,[25.4,50.8,76.19999999999999]);
 c.receive('<Run|WPos:bad,2,3>');assert.equal(c.lastStatus.position,null);
});
test('status requests default to 35 Hz and are limited even when callers request faster',async()=>{
 const c=new Controller(()=>{}, {statusTimeout:300});c.connected=true;const times=[];
 c.writer={write:async()=>{times.push(performance.now());queueMicrotask(()=>c.receive('<Idle|WPos:0,0,0>'));}};
 for(let i=0;i<6;i++)await c.status();
 assert.equal(c.interval,1000/35);assert.ok(times.at(-1)-times[0]>=130);
});
test('reset cancels streaming, waits for banner, unlocks and verifies Idle',async()=>{
 const {c,sent}=fake();const run=c.run('G1X1\nG1X2');const cancelled=assert.rejects(run);c.receive('<Idle>');await wait();
 const resetting=c.reset();await cancelled;assert.equal(sent.at(-1),'\x18');assert.equal(c.busy,true);
 c.receive('ok');c.receive('ALARM:3');assert.equal(sent.includes('$X\n'),false);
 c.receive("Grbl 1.1f ['$' for help]");await wait();assert.equal(sent.at(-1),'$X\n');
 c.receive('ok');await wait();assert.equal(sent.at(-1),'?');c.receive('<Idle|MPos:0,0,0>');await resetting;
 assert.equal(c.fault,false);assert.equal(c.busy,false);assert.equal(c.resetting,false);assert.equal(sent.includes('G1X2\n'),false);assert.equal(sent.includes('!'),false);
});
test('reset does not unlock without startup banner and preserves failure on Alarm',async()=>{
 const first=fake();await assert.rejects(first.c.reset(),/Тайм-аут/);assert.equal(first.sent.includes('$X\n'),false);assert.equal(first.c.fault,true);
 const {c}=fake();const reset=c.reset();const failure=assert.rejects(reset,/Alarm/);c.receive('Grbl 1.1f');await wait();c.receive('ok');await wait();c.receive('<Alarm>');await failure;assert.equal(c.fault,true);
});
test('jog sends relative millimetre command and waits for Idle; no program can overlap',async()=>{
 const {c,sent}=fake();const jog=c.jog('X',-1,500);c.receive('<Idle>');await wait();
 assert.ok(sent.includes('$J=G91 G21 X-1.000 F500.0\n'));
 await assert.rejects(c.run('G1X1'));await assert.rejects(c.jog('Y',1,500));
 c.receive('ok');await wait();c.receive('<Jog|WPos:0.5,0,0>');await wait();assert.equal(c.busy,true);
 c.receive('<Idle|WPos:0,0,0>');await jog;assert.equal(c.busy,false);assert.equal(c.jogging,false);
});
test('jog cancel sends single raw 0x85 byte and still waits for idle',async()=>{
 const {c}=fake();const bytes=[];c.writer={write:async data=>bytes.push([...data])};
 const jog=c.jog('Z',1,100);c.receive('<Idle>');await wait();c.receive('ok');await wait();
 await c.cancelJog();assert.deepEqual(bytes.at(-1),[0x85]);assert.equal(c.busy,true);
 c.receive('<Idle>');await jog;assert.equal(c.busy,false);
});
test('jog validates parameters and rejects Alarm before motion',async()=>{
 const {c,sent}=fake();for(const args of [['A',1,500],['X',0,500],['X',101,500],['X',1,NaN]])await assert.rejects(c.jog(...args));assert.equal(sent.length,0);
 const jog=c.jog('X',1,500);const rejected=assert.rejects(jog,/Idle/);c.receive('<Alarm>');await rejected;assert.deepEqual(sent,['?']);assert.equal(c.fault,false);
});
test('cancel before jog preflight response does not send a movement',async()=>{
 const {c,sent}=fake();const jog=c.jog('Y',1,500);await c.cancelJog();c.receive('<Idle>');await jog;assert.equal(sent.some(s=>s.startsWith('$J=')),false);
});
test('machine DRO is reconstructed from WPos and WCO and converted to millimetres',()=>{
 const {c}=fake();c.receive('$13=0');c.receive('<Idle|WPos:1,2,3>');assert.equal(c.lastStatus.machinePosition,null);
 c.receive('<Idle|WPos:1,2,3|WCO:10,20,30>');assert.deepEqual(c.lastStatus.machinePosition,[11,22,33]);assert.deepEqual(c.lastStatus.position,[1,2,3]);
 c.receive('$13=1');c.receive('<Idle|MPos:1,2,3>');assert.deepEqual(c.lastStatus.machinePosition,[25.4,50.8,76.19999999999999]);assert.equal(c.lastStatus.position,null);
});
test('probe refuses M0 probe-input mode and missing parser state without motion',async()=>{
 const {c}=fake();let moved=false;c.run=async()=>{moved=true;};
 c.systemCommand=async()=>['$7=1'];await assert.rejects(c.manualCommand('probeZ'),/\$7=1/);assert.equal(moved,false);
 c.systemCommand=async()=>[];await assert.rejects(c.manualCommand('probeZ'),/режимы/);assert.equal(moved,false);assert.equal(c.manual,false);
});
test('probe restores feed in original units after millimetre probing',async()=>{
 const {c}=fake();c.reportScale=1;let source;
 c.systemCommand=async command=>command==='$$'?['$7=0','$13=0']:['[GC:G0 G54 G17 G20 G90 G94 M5 M9 T0 F254 S0]'];
 c.run=async value=>{source=value;};await c.manualCommand('probeZ');
 assert.match(source,/G38\.2Z-30F100\nG0Z1\nG38\.2Z-2F10\nG92Z0\nG91G0Z5\nG20G90G94G0F10\.0000$/);assert.equal(c.manual,false);
});
test('second probe error prevents zeroing and retract; no automatic recovery motion',async()=>{
 const {c,sent}=fake();c.reportScale=1;
 c.systemCommand=async command=>command==='$$'?['$7=0','$13=0']:['[GC:G1 G21 G90 G94 F200]'];
 c.writer={write:async bytes=>{const line=new TextDecoder().decode(bytes);sent.push(line);queueMicrotask(()=>{if(line==='?')c.receive('<Idle>');else if(line==='G38.2Z-2F10\n')c.receive('error:9');else if(line.endsWith('\n'))c.receive('ok');});}};
 await assert.rejects(c.manualCommand('probeZ'),/error:9/);
 assert.ok(sent.includes('G38.2Z-2F10\n'));assert.equal(sent.includes('G92Z0\n'),false);assert.equal(sent.includes('G91G0Z5\n'),false);assert.equal(c.manual,false);
});
test('feed overrides send single realtime bytes with status confirmation between increments',async()=>{
 const {c}=fake();let feed=100,rapid=100;const bytes=[];
 c.writer={write:async data=>{bytes.push([...data]);const b=data[0];if(b===0x91)feed+=10;if(b===0x93)feed++;if(b===0x90)feed=100;if(b===0x97)rapid=25;if(b===0x95)rapid=100;if(b===63)queueMicrotask(()=>c.receive(`<Run|Ov:${feed},${rapid},100>`));}};
 c.busy=true;await c.setOverride('feed',122);assert.deepEqual(bytes.filter(x=>x[0]!==63),[[0x91],[0x91],[0x93],[0x93]]);
 await c.setOverride('rapid',25);assert.equal(rapid,25);await c.setOverride('feed',100);assert.equal(feed,100);assert.equal(c.busy,true);assert.equal(c.overrideBusy,false);
});
test('override refuses invalid rapid setting and missing confirmation never retries a byte',async()=>{
 const {c}=fake();await assert.rejects(c.setOverride('rapid',75));const bytes=[];
 c.writer={write:async data=>{bytes.push([...data]);if(data[0]===63)queueMicrotask(()=>c.receive('<Idle|Ov:100,100,100>'));}};
 await assert.rejects(c.setOverride('feed',110),/подтверждения/);assert.equal(bytes.filter(x=>x[0]===0x91).length,1);assert.equal(c.overrideBusy,false);
});
test('terminal sends one command, collects replies and waits for motion to finish',async()=>{
 const {c,sent}=fake();const result=c.terminal('G0 X10');c.receive('<Idle>');await wait();assert.ok(sent.includes('G0 X10\n'));
 await assert.rejects(c.run('G1X1'));c.receive('ok');await wait();c.receive('<Run>');await wait();assert.equal(c.busy,true);c.receive('<Idle>');await result;assert.equal(c.busy,false);
});
test('terminal rejects multiline and realtime injection and accepts dollar queries',async()=>{
 const {c,sent}=fake();await assert.rejects(c.terminal('G0X1\nG0X2'));await assert.rejects(c.terminal('G0X1!'));assert.equal(sent.length,0);
 const result=c.terminal('$$');c.receive('<Idle>');await wait();c.receive('$0=10');c.receive('ok');await wait();c.receive('<Idle>');await result;assert.ok(sent.includes('$$\n'));
});
