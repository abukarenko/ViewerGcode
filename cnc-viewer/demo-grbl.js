/* Local GRBL simulator. Serial-compatible byte streams; never accesses a real port. */
(function(root){
 'use strict';
 const parse=typeof module!=='undefined'?require('./parser.js').parseGCode:root.GCode.parse;
 class DemoPort{
  constructor(storage){try{this.storage=storage===undefined?root.localStorage:storage;}catch{this.storage=null;}this.isDemo=true;this.options={speed:10,surface:0,ripple:.2,probeEnabled:true,travel:[200,200,100],sensors:[true,true,true],forced:[false,false,false],probeForced:false};this.settings={7:0,13:0,21:1,22:1,23:0,24:100,25:1000,27:1,100:250,101:250,102:250,110:3000,111:3000,112:1000,130:200,131:200,132:100};this.job=null;this.pos=[50,50,15];this.offset=[50,50,10];this.ov=[100,100,100];this.state='Idle';this.units=1;this.absolute=true;this.motion=0;this.feed=500;this.spindle='M5';this.s=0;this.prb=[0,0,0];this.prbOK=0;this.tool=0;this.activeTool=0;this.toolLengthMode=49;this.restoreSettings();}
  saveSettings(){
   try{this.storage?.setItem('cnc-demo-settings-v1',JSON.stringify({version:1,settings:this.settings,options:this.options}));}catch{}
  }
  restoreSettings(){
   try{
    const saved=JSON.parse(this.storage?.getItem('cnc-demo-settings-v1')||'null');if(saved?.version!==1)return;
    for(const key of Object.keys(this.settings)){const v=saved.settings?.[key];if(typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e6&&(![24,25,27,100,101,102,110,111,112,130,131,132].includes(+key)||v>0))this.settings[key]=v;}
    const o=saved.options||{};
    for(const key of ['speed','surface','ripple']){const v=o[key];if(typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e6&&(key!=='speed'||v>=1&&v<=100)&&(key!=='ripple'||v>=0))this.options[key]=v;}
    for(const key of ['probeEnabled','probeForced'])if(typeof o[key]==='boolean')this.options[key]=o[key];
    for(const key of ['sensors','forced'])if(Array.isArray(o[key])&&o[key].length===3&&o[key].every(v=>typeof v==='boolean'))this.options[key]=o[key].slice();
    this.options.travel=[130,131,132].map(k=>this.settings[k]);
   }catch{}
  }
  placeWorkOrigin(dx,dy){
   if(!this.opened||this.job||this.state!=='Idle'||![dx,dy].every(Number.isFinite))throw Error('Размещение доступно только в Demo Idle');
   this.offset[0]+=dx;this.offset[1]+=dy;this.report();
  }
  getInfo(){return {usbVendorId:0,usbProductId:0};}
  async open(){if(this.opened)throw Error('Demo уже подключён');this.opened=true;this.buffer='';this.readable=new ReadableStream({start:stream=>this.output=stream,cancel:()=>{this.output=null;}});this.writable=new WritableStream({write:bytes=>this.receive(bytes)});this.timer=setInterval(()=>this.tick(),20);}
  async setSignals(){}
  async close(){clearInterval(this.timer);this.job=null;this.state='Idle';this.opened=false;try{this.output?.close();}catch{}this.output=null;}
  send(line){if(this.output)this.output.enqueue(new TextEncoder().encode(line+'\r\n'));}
  pins(){return this.options.forced.map((v,i)=>(v||(this.options.sensors[i]&&(this.pos[i]<=0||this.pos[i]>=this.options.travel[i])))?'XYZ'[i]:'').join('')+(this.options.probeForced?'P':'');}
  report(){const scale=this.settings[13]?25.4:1;const vec=v=>v.map(x=>(x/scale).toFixed(3)).join(',');this.send(`<${this.state}|MPos:${vec(this.pos)}|WCO:${vec(this.offset)}|FS:${this.state==='Run'||this.state==='Jog'?this.feed:0},${this.s}|Ov:${this.ov.join(',')}${this.pins()?'|Pn:'+this.pins():''}>`);}
  alarm(n){this.job=null;this.state='Alarm';this.send('ALARM:'+n);this.report();}
  sensor(axis,value){this.options.forced[axis]=value;this.saveSettings();if(value&&this.settings[21]&&this.state!=='Home')this.alarm(1);else this.report();}
  reset(){this.job=null;this.buffer='';this.state='Alarm';this.units=1;this.absolute=true;this.motion=0;this.spindle='M5';this.s=0;this.toolLengthMode=49;this.send("Grbl 1.1h ['$' for help] (ViewerGcode DEMO)");}
  receive(bytes){for(const b of bytes){
   if(b===63){this.report();continue;}if(b===24){this.reset();continue;}
   if(b===33){if(this.state==='Home'){this.alarm(9);}else if(this.job)this.state='Hold:0';this.report();continue;}
   if(b===126){if(this.state.startsWith('Hold'))this.state=this.job?.kind||'Idle';this.report();continue;}
   if(b===133){if(this.job?.kind==='Jog'){this.job=null;this.state='Idle';}this.report();continue;}
   if(b>=0x90&&b<=0x97){if(b===0x90)this.ov[0]=100;else if(b<=0x94)this.ov[0]=Math.max(10,Math.min(200,this.ov[0]+({145:10,146:-10,147:1,148:-1})[b]));else this.ov[1]=({149:100,150:50,151:25})[b];this.report();continue;}
   if(b===10){const line=this.buffer;this.buffer='';this.command(line.trim());}else if(b!==13)this.buffer+=String.fromCharCode(b);
  }}
  command(raw){
   const code=raw.replace(/\([^)]*\)/g,'').replace(/;.*$/,'').replace(/\s/g,'').toUpperCase();
   if(!code){this.send('ok');return;}
   if(code==='$$'){for(const [k,v] of Object.entries(this.settings))this.send(`$${k}=${v}`);this.send('ok');return;}
   if(code==='$G'){this.send(`[GC:G${this.motion} G54 G17 G${this.units===1?21:20} G${this.absolute?90:91} G94 G${this.toolLengthMode} ${this.spindle} M9 T${this.tool} F${this.feed/(this.settings[13]?25.4:1)} S${this.s}]`);this.send('ok');return;}
   if(code==='$I'){this.send('[VER:1.1h:ViewerGcode DEMO]');this.send('[OPT:V,15,128]');this.send('ok');return;}
   if(code==='$#'){this.send('[G54:'+this.offset.map(v=>v.toFixed(3)).join(',')+']');this.send('[PRB:'+this.prb.map(v=>(v/(this.settings[13]?25.4:1)).toFixed(3)).join(',')+':'+this.prbOK+']');this.send('ok');return;}
   if(code==='$N'){this.send('ok');return;}
   if(code==='$X'){if(this.job){this.send('error:8');return;}this.state='Idle';this.send('ok');this.report();return;}
   if(code==='$H'){this.home();return;}
   const setting=/^\$(\d+)=(-?\d+(?:\.\d+)?)$/.exec(code);
   if(setting){const id=+setting[1],value=+setting[2];if(this.job||!(id in this.settings)||value<0||([130,131,132,24,25,27].includes(id)&&value===0)){this.send('error:3');return;}this.settings[id]=value;if(id>=130&&id<=132)this.options.travel[id-130]=value;this.saveSettings();this.send('ok');return;}
   if(code.startsWith('$')&&!code.startsWith('$J=')){this.send('error:3');return;}
   if(this.state==='Alarm'){this.send('error:9');return;}if(this.job){this.send('error:8');return;}
   const jog=code.startsWith('$J='),body=jog?code.slice(3):code;
   const tokens=[...body.matchAll(/([A-Z])([+-]?(?:\d+(?:\.\d*)?|\.\d+))/g)];
   if(!tokens.length||body.replace(/([A-Z])([+-]?(?:\d+(?:\.\d*)?|\.\d+))/g,'')){this.send('error:2');return;}
   const words={},gs=[],ms=[];for(const t of tokens){if(t[1]==='G')gs.push(+t[2]);else if(t[1]==='M')ms.push(+t[2]);else words[t[1]]=+t[2];}
   if(gs.some(g=>![0,1,2,3,17,20,21,38.2,40,43,49,53,54,80,90,91,91.1,92,94].includes(g))||ms.some(m=>![0,1,2,3,4,5,6,7,8,9,30].includes(m))||Object.keys(words).some(k=>!'XYZIJKRFNSTH'.includes(k))){this.send('error:20');return;}
   if('T'in words&&(!Number.isInteger(words.T)||words.T<0||words.T>255)){this.send('error:3');return;}
   if(gs.includes(43)&&gs.includes(49)){this.send('error:21');return;}
   if('H'in words&&(!Number.isInteger(words.H)||words.H<0||words.H>255)){this.send('error:3');return;}
   if('H'in words&&!gs.includes(43)){this.send('error:20');return;}
   let units=gs.includes(20)?25.4:gs.includes(21)?1:this.units,absolute=gs.includes(90)?true:gs.includes(91)?false:this.absolute;
   const motion=jog?1:(gs.find(g=>[0,1,2,3,80].includes(g))??this.motion);
   if('F'in words&&words.F<=0){this.send('error:22');return;}const feed='F'in words?words.F*units:this.feed;
   if(!jog){this.units=units;this.absolute=absolute;this.motion=motion;this.feed=feed;if('S'in words)this.s=words.S;for(const m of ms)if([3,4,5].includes(m)){this.spindle='M'+m;if(m===5)this.s=0;}}
   if(!jog){if('T'in words)this.tool=words.T;if(ms.includes(6)){this.activeTool=this.tool;this.send(`[MSG:DEMO tool changed: T${this.activeTool}]`);}}
   if(!jog&&gs.includes(43)){this.toolLengthMode=43;this.send(`[MSG:DEMO G43 H${words.H??this.activeTool}: tool length offset = 0 mm (no tool table)]`);}
   if(!jog&&gs.includes(49))this.toolLengthMode=49;
   if(gs.includes(92)){for(let i=0;i<3;i++)if('XYZ'[i]in words)this.offset[i]=this.pos[i]-words['XYZ'[i]]*units;this.send('ok');this.report();return;}
   const target=this.pos.map((v,i)=>'XYZ'[i]in words?(absolute?gs.includes(53)?0:this.offset[i]:v)+words['XYZ'[i]]*units:v);
   if(!'XYZIJKR'.split('').some(k=>k in words)){if(ms.includes(0)||ms.includes(1))this.state='Hold:0';this.send('ok');this.report();return;}
   if(this.settings[21]&&this.options.forced.some(Boolean)){this.alarm(1);return;}
   let points=[this.pos.slice(),target],probe=false,hit=false;
   if(gs.includes(38.2)){
    if(this.settings[7]||this.options.probeForced){this.alarm(4);return;}
    if(target[0]!==this.pos[0]||target[1]!==this.pos[1]){this.send('error:20');return;}
    probe=true;const z=this.offset[2]+this.options.surface+this.options.ripple*Math.sin((this.pos[0]-this.offset[0])/30)*Math.sin((this.pos[1]-this.offset[1])/30);
    hit=this.options.probeEnabled&&this.pos[2]>z&&target[2]<=z;if(hit)target[2]=z;
   }else if(motion===2||motion===3){
    const start=this.pos.map((v,i)=>v-this.offset[i]);
    const text=`G21G90\nG0X${start[0]}Y${start[1]}Z${start[2]}\nG${units===1?21:20}G${absolute?90:91}\nG${motion}`+Object.entries(words).filter(([k])=>'XYZIJKRF'.includes(k)).map(([k,v])=>k+v).join('');
    const parsed=parse(text);if(!parsed.complete){this.send('error:33');return;}points=parsed.segments.at(-1).points.map(p=>p.map((v,i)=>v+this.offset[i]));
   }else if(motion===80){this.send('error:80');return;}
   const kind=jog?'Jog':'Run';this.state=kind;this.job={kind,points,index:1,feed:!jog&&!probe&&motion===0?this.settings[110]:feed,rapid:!jog&&!probe&&motion===0,probe,hit,ack:probe};
   if(!probe)this.send('ok');this.report();
  }
  home(){
   if(!this.settings[22]){this.send('error:5');return;}if(this.job){this.send('error:8');return;}
   if(this.options.forced.some(Boolean)){this.alarm(8);return;}
   this.state='Home';this.homeStage(2,'seek');this.report();
  }
  homeStage(axis,phase){
   const axes=axis===2?[2]:[0,1],target=this.pos.slice();for(const i of axes){const edge=this.settings[23]&(1<<i)?0:this.options.travel[i];target[i]=['seek','latch'].includes(phase)?edge:edge+(edge===0?1:-1)*this.settings[27];}
   const rate=phase==='seek'?this.settings[25]:this.settings[24];
   this.job={kind:'Home',axis,phase,elapsed:0,start:this.pos.slice(),target,duration:Math.max(.02,Math.max(...axes.map(i=>Math.abs(target[i]-this.pos[i])))/rate*60)};
  }
  tick(){
   const job=this.job;if(!job||this.state.startsWith('Hold'))return;const dt=.02*this.options.speed;
   if(job.kind==='Home'){
    job.elapsed+=dt;const axes=job.axis===2?[2]:[0,1];const t=Math.min(1,job.elapsed/job.duration);
    for(const i of axes)this.pos[i]=job.start[i]+(job.target[i]-job.start[i])*t;
    if(t===1){
     if(['seek','latch'].includes(job.phase)){
      if(axes.some(i=>!this.options.sensors[i])){this.alarm(9);return;}
      this.homeStage(job.axis,job.phase==='seek'?'pull':'release');
     }else if(axes.some(i=>this.options.forced[i])){this.alarm(8);return;}
     else if(job.phase==='pull')this.homeStage(job.axis,'latch');
     else if(job.axis===2)this.homeStage(0,'seek');
     else{this.job=null;this.state='Idle';this.send('ok');}
    }
    this.report();return;
   }
   let distance=job.feed/60*dt*(job.rapid?this.ov[1]:this.ov[0])/100;
   while(distance>0&&this.job&&job.index<job.points.length){const end=job.points[job.index],length=Math.hypot(...end.map((v,i)=>v-this.pos[i]));const fraction=length?Math.min(1,distance/length):1;this.pos=this.pos.map((v,i)=>v+(end[i]-v)*fraction);distance-=length*fraction;if(fraction===1)job.index++;else break;}
   if(this.settings[21]&&this.pos.some((v,i)=>this.options.sensors[i]&&(v<=0||v>=this.options.travel[i]))){this.alarm(1);return;}
   if(job.index>=job.points.length){this.job=null;if(job.probe){this.prb=this.pos.slice();this.prbOK=job.hit?1:0;this.send('[PRB:'+this.prb.map(v=>(v/(this.settings[13]?25.4:1)).toFixed(3)).join(',')+':'+this.prbOK+']');if(!job.hit){this.alarm(5);return;}}this.state='Idle';if(job.ack)this.send('ok');}
   this.report();
  }
 }
 if(typeof module!=='undefined')module.exports={DemoPort};else root.DemoGRBL={DemoPort};
})(typeof window!=='undefined'?window:globalThis);
