const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
function setup(){
 const strokes=[];let points=[];const ctx=new Proxy({beginPath(){points=[];},moveTo(...p){points.push(p);},lineTo(...p){points.push(p);},stroke(){if(this.strokeStyle==='#ce535b')strokes.push(JSON.stringify(points));}}, {get:(o,k)=>k in o?o[k]:()=>{}});
 const make=()=>({value:'',textContent:'',style:{},children:[],classList:{add(){},remove(){},toggle(){}},clientWidth:1000,clientHeight:800,append(n){this.children.push(n);},replaceChildren(...n){this.children=n;},setAttribute(){},addEventListener(){},querySelector(){return null;},getContext(){return ctx;},getBoundingClientRect(){return {left:0,top:0};},setPointerCapture(){}});
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,make());return elements.get(id);};
 const port={isDemo:true,offset:[50,50,10],placeWorkOrigin(x,y){this.offset[0]+=x;this.offset[1]+=y;}};
 const window={dispatchEvent(){},demoPort:port,grblController:{port,connected:true,lastStatus:{state:'Idle'}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('./app.js'),'utf8'),{window,document:{getElementById:get,createElement:make,createDocumentFragment:make,querySelectorAll:()=>[],addEventListener(){}},GCode:{parse:require('./parser.js').parseGCode},CustomEvent:class{},requestAnimationFrame(){},ResizeObserver:class{observe(){}},performance});
 const api=window.CNCViewer;api.load('G21G90\nG0X0Y0\nG1X20Y20F100');api.setMachineCoordinates([50,50,15],[0,0,5]);api.setMachineEnvelope([200,200,100],true);api.setView('xy');
 const canvas=get('canvas');const drag=(x,y,shiftKey=false,button=0)=>{canvas.onpointerdown({button,clientX:372,clientY:528,shiftKey,pointerId:1});canvas.onpointermove({clientX:372+x,clientY:528+y});canvas.onpointerup();};
 return {window,port,api,get,drag,strokes};
}
test('XY drag moves placement, keeps machine table fixed, and clamps at table edge',()=>{
 const {port,drag,strokes,get}=setup(),before=strokes.slice(-12),source=get('editor').value;
 drag(32,-32);assert.deepEqual(port.offset,[60,60,10]);assert.deepEqual(strokes.slice(-12),before);assert.equal(get('editor').value,source);
 // Start the next drag at the original hit point, which remains inside the moved model.
 drag(10000,-10000);assert.deepEqual(port.offset,[180,180,10]);
});
test('Placement requires Demo XY Idle after Home and yields to Shift pan',()=>{
 for(const mode of ['real','iso','xz','yz','busy','alarm','noHome','heightmap','shift']){
  const s=setup();if(mode==='real')s.port.isDemo=false;if(['iso','xz','yz'].includes(mode))s.api.setView(mode);if(mode==='busy')s.window.grblController.busy=true;if(mode==='alarm')s.window.grblController.lastStatus.state='Alarm';if(mode==='noHome')s.api.setMachineEnvelope(null);if(mode==='heightmap')s.window.HeightMapUI={isActive:()=>true};
  s.drag(32,-32,mode==='shift');assert.deepEqual(s.port.offset,[50,50,10],mode);
 }
});
test('Right drag pans the projected table without moving Demo work origin',()=>{for(const view of ['xy','iso']){const s=setup();s.api.setView(view);const before=s.strokes.slice(-12).map(JSON.parse);s.drag(32,20,false,2);const after=s.strokes.slice(-12).map(JSON.parse);assert.deepEqual(s.port.offset,[50,50,10]);before.forEach((edge,i)=>edge.forEach((p,j)=>{assert.ok(Math.abs(after[i][j][0]-p[0]-32)<1e-8);assert.ok(Math.abs(after[i][j][1]-p[1]-20)<1e-8);}));}});
