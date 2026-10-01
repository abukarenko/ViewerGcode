const {test}=require('node:test');const assert=require('node:assert/strict');const {DemoPort}=require('./demo-grbl.js');const {Controller}=require('./grbl.js');
function fixture(){const p=new DemoPort(),lines=[];p.send=s=>lines.push(s);p.options.speed=100;return {p,lines};}
function finish(p){for(let i=0;i<10000&&p.job;i++)p.tick();assert.equal(p.job,null);}

test('Dollar commands write persistent Demo memory, reject invalid values, and change status format and limits',()=>{
 const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)},p=new DemoPort(storage),lines=[];p.send=s=>lines.push(s);
 for(const code of ['$100=345.5','$120=80','$130=300','$10=0','$20=1']){p.command(code);assert.equal(lines.at(-1),'ok');}
 p.command('$$');assert.ok(lines.includes('$100=345.5'));p.report();assert.match(lines.at(-1),/WPos:/);
 for(const code of ['$100=0','$13=2','$23=8','$120=0','$999=1']){p.command(code);assert.equal(lines.at(-1),'error:3');}
 const restored=new DemoPort(storage);assert.equal(restored.settings[100],345.5);assert.equal(restored.settings[120],80);assert.equal(restored.options.travel[0],300);
 p.command('G0X400');assert.equal(p.state,'Alarm');assert.equal(p.job,null);assert.ok(lines.includes('ALARM:2'));
});

test('Probe pin remains active at contact and clears after retract',()=>{const {p}=fixture();p.command('G38.2Z-1F500');finish(p);assert.ok(p.pins().includes('P'));p.command('G91G0Z1');finish(p);assert.equal(p.pins().includes('P'),false);});

test('CAM G43 H1 executes same-block Z and reports explicit zero-length simulation; G49 cancels',()=>{
 const {p,lines}=fixture();p.command('G92Z0');p.command('G017G21G49G80G90G91.1');p.command('M6T1');p.command('G43H1G0Z5.0000');finish(p);
 assert.equal(p.pos[2],20);assert.equal(p.toolLengthMode,43);assert.ok(lines.some(l=>l.includes('offset = 0 mm')));assert.equal(lines.some(l=>l.startsWith('error:')),false);
 p.command('$G');assert.ok(lines.some(l=>l.startsWith('[GC:')&&l.includes(' G43 ')));
 p.command('G49');assert.equal(p.toolLengthMode,49);assert.equal(p.pos[2],20);
 for(const code of ['G43H-1G0Z50','G43H1.5G0Z50','G43G49Z50','H1G0Z50','G43.1Z50']){p.command(code);assert.match(lines.at(-1),/^error:/);assert.equal(p.pos[2],20);assert.equal(p.job,null);}
 p.command('G43H1');p.reset();assert.equal(p.toolLengthMode,49);
});

test('Center lifts before XY at selected feed, preserves units, and never lowers an already higher Z',async()=>{
 const p=new DemoPort();p.options.speed=100;const outgoing=[];const c=new Controller(e=>{if(e.type==='log'&&e.direction==='→')outgoing.push({code:e.text,pos:p.pos.slice()});},{statusTimeout:1000,timeout:3000,interval:2});
 try{
  await c.connect(null,115200,p);p.pos=[70,80,15];await c.terminal('G20G91');
  await c.manualCommand('center',{height:10,feed:123});assert.deepEqual(p.pos,[50,50,20]);assert.equal(p.units,25.4);assert.equal(p.absolute,false);
  const xy=outgoing.find(e=>e.code==='G1X0Y0F123');assert.deepEqual(xy.pos,[70,80,20]);assert.ok(outgoing.some(e=>e.code==='G1Z10.0000F123'));
  await c.manualCommand('center',{height:1,feed:200});assert.equal(p.pos[2],20);
  await assert.rejects(c.manualCommand('center',{height:7,feed:200}));await assert.rejects(c.manualCommand('center',{height:10,feed:0}));
 }finally{await c.disconnect();}
});

test('DEMO accepts tool selection and M6 without moving axes',()=>{
 const {p,lines}=fixture(),pos=p.pos.slice();p.command('G017G21G49G80G90G91.1');p.command('M6T1');
 assert.equal(p.activeTool,1);assert.deepEqual(p.pos,pos);assert.equal(lines.filter(l=>l==='ok').length,2);
 p.command('$G');assert.ok(lines.some(l=>l.startsWith('[GC:')&&l.includes(' T1 ')));
 p.command('T2');assert.equal(p.activeTool,1);p.command('M6');assert.equal(p.activeTool,2);
 p.command('G0X10');finish(p);assert.equal(p.pos[0],60);
 for(const t of ['T-1','T1.5','T256']){p.command(t);assert.equal(lines.at(-1),'error:3');}assert.equal(p.tool,2);
});

test('G92 memory restores work zero after reset and jog without moving tool, including inch mode',async()=>{
 const p=new DemoPort();p.options.speed=100;const c=new Controller(()=>{},{statusTimeout:1000,timeout:3000,interval:2});
 try{
  await c.connect(null,115200,p);await c.terminal('G92X0Y0Z0');assert.deepEqual(c.savedWorkOffset,[50,50,15]);
  await c.reset();p.offset=[0,0,0];await c.enqueueJog('X',10,1000);await c.terminal('G20');
  const pos=p.pos.slice();await c.restoreWorkZero();assert.deepEqual(p.pos,pos);assert.ok(p.offset.every((v,i)=>Math.abs(v-[50,50,15][i])<.00002));assert.equal(p.units,25.4);
 }finally{await c.disconnect();}
});

test('Placement changes work origin without moving tool and subsequent motion follows it',()=>{
 const {p}=fixture();assert.throws(()=>p.placeWorkOrigin(10,20));p.opened=true;
 const pos=p.pos.slice();p.placeWorkOrigin(10,20);assert.deepEqual(p.pos,pos);assert.deepEqual(p.offset,[60,70,10]);
 p.command('G90G0X5Y6');finish(p);assert.deepEqual(p.pos,[65,76,15]);
 p.state='Alarm';assert.throws(()=>p.placeWorkOrigin(1,1));p.state='Idle';assert.throws(()=>p.placeWorkOrigin(NaN,0));
 p.command('G1X10F100');assert.throws(()=>p.placeWorkOrigin(1,1));
});
test('DEMO uses serial transport for run, Jog, overrides and reset',async()=>{
 const p=new DemoPort();p.options.speed=100;const c=new Controller(()=>{},{statusTimeout:1000,timeout:3000,interval:2});
 try{await c.connect(null,115200,p);await c.run('G21G90\nG0Z5\nG1X10F600');assert.ok(Math.abs(c.lastStatus.position[0]-10)<.001);await c.enqueueJog('X',10,1000);assert.equal(p.pos[0],70);await c.setOverride('feed',110);assert.equal(p.ov[0],110);await c.reset();assert.equal(p.state,'Idle');}finally{await c.disconnect();}
});
test('Home seeks Z then XY, releases sensors and acknowledges',()=>{const {p,lines}=fixture();p.command('$H');assert.equal(p.state,'Home');finish(p);assert.deepEqual(p.pos,[199,199,99]);assert.equal(p.pins(),'');assert.ok(lines.includes('ok'));});
test('Home missing, stuck and disabled sensors give explicit failures',()=>{
 for(const mode of ['missing','stuck','disabled']){const {p,lines}=fixture();if(mode==='missing')p.options.sensors[2]=false;if(mode==='stuck')p.options.forced[0]=true;if(mode==='disabled')p.settings[22]=0;p.command('$H');finish(p);assert.ok(lines.some(l=>/ALARM:9|ALARM:8|error:5/.test(l)));}
});
test('Hard limit interrupts movement and holds prevent position changes',()=>{const {p,lines}=fixture();p.command('G1X100F100');p.receive(new Uint8Array([33]));const pos=p.pos.slice();p.tick();assert.deepEqual(p.pos,pos);p.receive(new Uint8Array([126]));p.tick();assert.notDeepEqual(p.pos,pos);p.sensor(0,true);assert.equal(p.state,'Alarm');assert.equal(p.job,null);assert.ok(lines.includes('ALARM:1'));});
test('Probe produces successful PRB; missing and closed probes alarm',()=>{
 for(const mode of ['ok','missing','closed']){const {p,lines}=fixture();if(mode==='missing')p.options.probeEnabled=false;if(mode==='closed')p.options.probeForced=true;p.command('G38.2Z-1F500');finish(p);if(mode==='ok'){assert.ok(lines.includes('[PRB:50.000,50.000,10.000:1]'));assert.equal(p.state,'Idle');}else assert.ok(lines.some(l=>l==='ALARM:5'||l==='ALARM:4'));}
});
test('Simulator rejects unsupported commands instead of silent success',()=>{const {p,lines}=fixture();p.command('G10L20P1X0');assert.ok(lines.includes('error:20'));});

test('Jog is independent of modal arc and probing uses its programmed feed',()=>{
 const {p}=fixture();p.motion=2;p.command('$J=G91G21X1F250');assert.equal(p.job.kind,'Jog');finish(p);p.motion=0;p.command('G38.2Z-1F50');assert.equal(p.job.feed,50);assert.equal(p.job.rapid,false);
});
test('DEMO persists GRBL and simulator settings across new instances',()=>{
 const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};
 const p=new DemoPort(storage);p.command('$130=350');p.options.speed=25;p.options.surface=1.5;p.options.sensors[1]=false;p.options.probeEnabled=false;p.sensor(2,true);p.saveSettings();
 const restored=new DemoPort(storage);assert.equal(restored.settings[130],350);assert.equal(restored.options.travel[0],350);assert.equal(restored.options.speed,25);assert.equal(restored.options.surface,1.5);assert.equal(restored.options.sensors[1],false);assert.equal(restored.options.forced[2],true);assert.equal(restored.options.probeEnabled,false);
});
test('DEMO tolerates unavailable or malformed storage',()=>{
 for(const storage of [{getItem:()=>'{broken'}, {getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}}]){const p=new DemoPort(storage);assert.equal(p.options.speed,10);assert.doesNotThrow(()=>p.saveSettings());}
});
test('NC export sorts and preserves actual parameter values with CRLF',()=>{
 const {exportNC}=require('./settings.js');assert.equal(exportNC(new Map([['130','350'],['13','0'],['7','1']])), '$7=1\r\n$13=0\r\n$130=350\r\n');assert.throws(()=>exportNC(new Map()));assert.throws(()=>exportNC(new Map([['13','0\n$21=0']])));
});
