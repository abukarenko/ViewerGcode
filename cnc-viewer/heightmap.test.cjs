const {test}=require('node:test');
const assert=require('node:assert/strict');
const HM=require('./heightmap.js');
const {Controller}=require('./grbl.js');
const base={x:0,y:0,width:10,height:10,nx:2,ny:2,originX:0,originY:0,safeZ:5,bottomZ:-1,feed:50};
const map={...base,format:'ViewerGcode-heightmap',version:1,values:[0,.1,.2,.3]};
const source='G21 G90 G17\nG0 Z5\nG0 X0 Y0\nM3 S1000\nG1 Z-0.1 F50\nG1 X10 Y10 F100\nG0 Z5\nM5\nM30';
test('serpentine grid, reference and boundaries',()=>{
 assert.deepEqual(HM.points(base).map(p=>p.index),[0,1,3,2]);
 assert.equal(HM.height(map,0,0),0);assert.equal(HM.height(map,10,10),.3);
 assert.ok(Math.abs(HM.height(map,5,5)-.15)<1e-12);
 assert.throws(()=>HM.height(map,-.1,0),/вне карты/);
});
test('map loading validates dimensions, values, schema and incomplete maps',()=>{
 assert.deepEqual(HM.load(JSON.stringify(map)),map);
 for(const m of [{...map,nx:1},{...map,values:[0]},{...map,version:2},{...map,values:[0,0,0,'bad']}])assert.throws(()=>HM.load(JSON.stringify(m)));
 assert.throws(()=>HM.transform(source,{...map,values:[null,0,0,0]}),/не заполнена/);
});
test('correction preserves spindle commands and safe rapid, splits cutting path',()=>{
 const text=HM.transform(source,map,1);
 assert.match(text,/M3 S1000/);assert.match(text,/G0 Z5/);assert.match(text,/X10.0000 Y10.0000 Z0.2000/);
 assert.ok(text.split('\n').length>source.split('\n').length);
 assert.match(text,/M5\nM30$/);
});
test('rejects unsupported units, offsets, relative moves, tool change and unsafe rapids',()=>{
 for(const text of [source.replace('G21','G20'),source.replace('G90','G91'),source.replace('M3 S1000','G92 Z0'),source.replace('M3 S1000','M6'),source.replace('G0 Z5','G0 Z0'),source.replace('G21 G90 G17','G17'),source.replace('G0 X0 Y0','G0 X0'),source.replace('G1 X10 Y10','G1 X11 Y10')])assert.throws(()=>HM.transform(text,map));
});
test('arcs are converted to corrected G1 and source remains unchanged',()=>{
 const arc='G21 G90 G17\nG0 Z5\nG0 X0 Y5\nG1 Z0 F100\nG2 X10 Y5 I5 J0';
 const result=HM.transform(arc,map,.5);assert.doesNotMatch(result,/G2 X/);assert.match(result,/X10.0000 Y5.0000 Z0.2000/);assert.match(arc,/G2 X/);
});
function fake(options={}){
 const sent=[];let pos=[0,0,5],probeCount=0;
 const c=new Controller(()=>{},{timeout:100,statusTimeout:100,interval:1});c.connected=true;c.reportScale=1;
 c.writer={async write(bytes){const code=new TextDecoder().decode(bytes).trim();sent.push(code);queueMicrotask(()=>{
   if(code==='?'){c.receive(`<Idle|MPos:${pos.join(',')}|WCO:0,0,0${options.stuck?'|Pn:P':''}>`);return;}
   if(code==='!')return;
   if(code==='$$'){c.receive('$13=0');if(options.mash)c.receive('$7=1');}
   else if(code==='$G')c.receive('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F100 S0]');
   else if(code.startsWith('G38.2')){probeCount++;pos[2]=pos[0]*.01+pos[1]*.02;if(!options.missing)c.receive(`[PRB:${pos.join(',')}:${options.failed?0:1}]`);}
   else for(const [i,axis] of [...'XYZ'].entries()){const m=new RegExp(axis+'(-?[0-9.]+)').exec(code);if(m)pos[i]=Number(m[1]);}
   c.receive('ok');
 });}};
 return {c,sent,get probes(){return probeCount;}};
}
test('measuring lifts before XY, collects successful PRB relative to reference and restores modes',async()=>{
 const f=fake();const result=await f.c.probeHeightMap(base);
 assert.deepEqual(result.values.map(v=>+v.toFixed(4)),map.values);
 assert.equal(f.probes,5);assert.ok(f.sent.indexOf('G0Z5.0000')<f.sent.indexOf('G0X0.0000Y0.0000'));
 assert.deepEqual(result.binding,{wcs:'G54',offset:[0,0,0]});
 assert.ok(f.sent.includes('G21G90G94G0F100.0000'));assert.equal(f.c.busy,false);
});
test('missing/failed PRB stops queue, sets fault and never retracts after failure',async()=>{
 for(const opt of [{missing:true},{failed:true}]){const f=fake(opt);await assert.rejects(f.c.probeHeightMap(base),/PRB/);assert.equal(f.probes,1);assert.equal(f.c.fault,true);assert.equal(f.sent.at(-1),'!');}
});
test('closed probe and Mash3 probe mode block motion',async()=>{
 for(const opt of [{stuck:true},{mash:true}]){const f=fake(opt);await assert.rejects(f.c.probeHeightMap(base));assert.equal(f.probes,0);assert.ok(!f.sent.some(s=>s.startsWith('G0Z')));}
});
test('user stop prevents the next probing command and leaves a partial map',async()=>{
 const f=fake();let partial;
 await assert.rejects(f.c.probeHeightMap(base,(m,p,n)=>{partial=structuredClone(m);if(n===1)f.c.stopHeightMap();}),/остановлено/);
 assert.equal(f.probes,2);assert.equal(partial.values.filter(Number.isFinite).length,1);assert.equal(f.c.busy,false);assert.equal(f.c.fault,true);
});

test('rapid XY always retracts first after a compensated move',()=>{
 const m={...map,values:[-10,0,0,0]};
 const code=HM.transform('G21G90\nG0Z5\nG0X0Y0\nG1Z5F100\nG0X10Y10',m);
 assert.match(code,/G1 X0.0000 Y0.0000 Z-5.0000 F100.0000\nG0 Z5.0000\nG0 X10.0000 Y10.0000/);
});
test('double correction and inadequate clearance are rejected',()=>{
 assert.throws(()=>HM.transform(HM.transform(source,map),map),/уже применена/);
 assert.throws(()=>HM.transform(source,{...map,values:[0,1,2,6]}),/Верхний Z/);
});
