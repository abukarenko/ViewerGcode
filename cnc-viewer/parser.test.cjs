const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseGCode:parse}=require('./parser.js');
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
test('optional unsupported block skipping preserves preceding modes and reports lines',()=>{
 const source='G1 X10 F100\nG91 G28 X0 F200\nX20\nM98 P100\nX30';
 assert.equal(parse(source).complete,false);
 const m=parse(source,{ignoreUnsupported:true});
 assert.equal(m.complete,true);assert.deepEqual(m.position,[30,0,0]);
 assert.deepEqual(m.segments.map(s=>s.line),[1,3,5]);
 assert.ok(m.segments.every(s=>s.type===1&&s.feed===100));
 assert.deepEqual(m.diagnostics.map(d=>[d.line,d.severity]),[[2,'warning'],[4,'warning']]);
 assert.equal(parse('G2 X1 R0.1',{ignoreUnsupported:true}).complete,false);
 assert.equal(parse('G1 X#1',{ignoreUnsupported:true}).complete,false);
 assert.deepEqual(parse('G1 X1\nG999 M30\nX2',{ignoreUnsupported:true}).position,[1,0,0]);
});
test('file encoding: Windows-1251 Cyrillic, UTF-8 and UTF-16 BOM',()=>{
 const {decode}=require('./encoding.js');
 const cp=decode(Uint8Array.from([40,212,240,229,231,224,32,184,41]));
 assert.equal(cp.text,'(Фреза ё)');assert.equal(cp.encoding,'Windows-1251');
 const text='(Фреза ё)\nG1 X10';
 assert.equal(decode(Buffer.from(text,'utf8')).text,text);
 assert.equal(decode(Buffer.from('\ufeff'+text,'utf8')).text,text);
 assert.equal(decode(Buffer.from('\ufeff'+text,'utf16le')).text,text);
 assert.equal(decode(Uint8Array.from([254,255,0,40,4,36,0,41])).text,'(Ф)');
 assert.equal(decode(Buffer.from('G1 X10')).text,'G1 X10');
 assert.equal(decode(Buffer.from('(�)','utf8')).text,'(�)');
});
test('modal motion, comments, absolute and relative coordinates',()=>{const m=parse('G21 G90\nG1X10Y20F100 ; note\nG91\nX-5 Z2 (cut)');assert.equal(m.complete,true);assert.deepEqual(m.position,[5,20,2]);assert.equal(m.segments[1].line,4);});
test('inches convert both feed and positions to millimetres',()=>{const m=parse('G20 G1 X1 F2\nG21 G91 X1');assert.deepEqual(m.position,[26.4,0,0]);close(m.segments[0].feed,50.8);});
test('quarter circle has correct length and endpoints',()=>{const m=parse('G0 X10\nG3 X0 Y10 I-10 J0');assert.equal(m.complete,true);close(m.segments[1].length,5*Math.PI);assert.deepEqual(m.position,[0,10,0]);assert.ok(m.segments[1].points[3][1]>0);});
test('full circle and helical interpolation',()=>{const m=parse('G0 X10\nG2 I-10 Z-5');assert.equal(m.complete,true);close(m.segments[1].length,Math.hypot(20*Math.PI,5));assert.deepEqual(m.position,[10,0,-5]);assert.ok(m.segments[1].points[1][1]<0);});
test('signed R chooses minor or major arc',()=>{const small=parse('G0 X10\nG3 X0 Y10 R10'),large=parse('G0 X10\nG3 X0 Y10 R-10');close(small.segments[1].length,5*Math.PI);close(large.segments[1].length,15*Math.PI);});
test('G18 uses oriented ZX plane',()=>{const m=parse('G18 G0 Z10\nG3 Z0 X10 K-10 I0');assert.equal(m.complete,true);close(m.segments[1].length,5*Math.PI);assert.ok(m.segments[1].points[1][0]>0);});
test('G19 uses YZ plane',()=>{const m=parse('G19 G0 Y10\nG3 Y0 Z10 J-10 K0');assert.equal(m.complete,true);close(m.segments[1].length,5*Math.PI);});
test('absolute arc centre is independent of endpoint distance mode',()=>{const m=parse('G0 X20 Y10\nG90.1 G3 X10 Y20 I10 J10');assert.equal(m.complete,true);close(m.segments[1].length,5*Math.PI);});
test('invalid radius stops without inventing later motion',()=>{const m=parse('G0 X10\nG3 X0 Y10 R1\nG1 X200');assert.equal(m.complete,false);assert.equal(m.diagnostics[0].line,2);assert.equal(m.segments.length,1);});
test('unsupported modes, macro and axes stop at the affected block',()=>{for(const code of ['G54','G92 X1','G81 X1','G93','G1 A20','G1 X#1','M98 P100']){const m=parse('G0 X2\n'+code+'\nG1 X100');assert.equal(m.complete,false,code);assert.equal(m.segments.length,1,code);}});
test('end program stops subsequent blocks',()=>{assert.deepEqual(parse('G1 X5\nM30\nX100').position,[5,0,0]);});
test('conflicting modes, missing centre and duplicate words report errors',()=>{for(const code of ['G90 G91','G2 X1','G1 X1 X2','G80 X1','G1 X1 I2'])assert.equal(parse(code).complete,false,code);});
test('empty source is valid and has no moves',()=>assert.equal(parse('; empty').segments.length,0));
test('user star9 file: complete two-depth contour with modal G1',()=>{
 const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'examples/star9.nc'),'utf8');
 const m=parse(source);assert.equal(m.complete,true);assert.equal(m.segments.length,44);
 assert.equal(m.diagnostics.length,1);assert.equal(m.diagnostics[0].severity,'warning');assert.equal(m.diagnostics[0].line,6);
 assert.deepEqual(m.segments[0].end,[0,0,5]);assert.equal(m.segments[0].type,0);
 const cuts=m.segments.filter(s=>s.type===1);assert.equal(cuts.length,38);
 for(const z of [-.5,-1]){
   const pass=cuts.filter(s=>s.end[2]===z);assert.equal(pass.length,19);
   assert.deepEqual(pass.at(-1).end,[22.7044,25.9929,z]);
   assert.ok(pass.slice(1).every(s=>s.feed===600));assert.equal(pass[0].feed,240);
 }
 assert.deepEqual(m.bounds.min,[-34.7851,-34.2567,-1]);assert.deepEqual(m.bounds.max,[34.7851,34.2567,5]);assert.deepEqual(m.position,[0,0,5]);
});
test('G43 does not create motion or replace modal G1; G49 cancels without movement',()=>{
 const m=parse('G1 X1 F100\nG43 H1\nX2\nG49\nX3');assert.equal(m.complete,true);assert.equal(m.segments.length,3);assert.ok(m.segments.every(s=>s.type===1));assert.deepEqual(m.position,[3,0,0]);
 assert.equal(parse('T1 M6\nG43\nG0 Z5').complete,true);
});
test('invalid H and unsupported compensation variants remain errors',()=>{
 for(const code of ['G43 H-1','G43 H1.5','G43 G49','G1 X1 H2','G43.1 Z2','G43.2 H1','G41 X2'])assert.equal(parse(code).complete,false,code);
});
