(() => {
  'use strict';
  const $=id=>document.getElementById(id),HM=window.HeightMap,c=window.grblController;
  const fields={x:'X',y:'Y',width:'Width',height:'Height',nx:'Nx',ny:'Ny',originX:'OriginX',originY:'OriginY',safeZ:'SafeZ',bottomZ:'BottomZ',feed:'Feed'};
  let map=null,active=null,internal=false,measuring=false,operation=false,current=null;
  const message=text=>$('hmMessage').textContent=text;
  const config=()=>HM.validate(Object.fromEntries(Object.entries(fields).map(([k,id])=>[k,$('hm'+id).value.trim()===''?NaN:Number($('hm'+id).value)])));
  function fill(m){for(const [k,id] of Object.entries(fields))$('hm'+id).value=m[k];}
  function save(name,text,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
  function update(){
    const busy=c.busy||operation,ready=!!map&&map.values.every(Number.isFinite);
    $('hmParameters').disabled=busy||!!active;$('hmStep').disabled=busy||!!active;
    $('hmStart').disabled=busy||!c.connected||c.fault||!!active;
    $('hmStop').disabled=!measuring||!c.mapping||c.fault;
    $('hmApply').disabled=busy||!ready||!!active||!$('hmBindingConfirmed').checked;
    $('hmRestore').disabled=busy||!active;$('hmExport').disabled=busy||!active;
    $('hmSave').disabled=busy||!map;$('hmLoad').disabled=$('hmDemo').disabled=busy||!!active;
    $('hmCurrent').disabled=busy||!c.lastStatus?.position||!!active;
    $('hmGo').disabled=busy||!c.connected||c.fault||!!active;
    $('hmClose').disabled=measuring;
    $('heightMapBadge').textContent=active?'Коррекция Z включена':'';
    try{const p=config();$('hmSpacing').textContent=`${p.nx*p.ny} точек + опорная · шаг ${(p.width/(p.nx-1)).toFixed(2)} × ${(p.height/(p.ny-1)).toFixed(2)} мм`;}catch(e){$('hmSpacing').textContent=e.message;}
  }
  function draw(){
    const canvas=$('hmCanvas'),ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);
    let m=map;try{m ||= {...config(),values:[]};}catch{return;}
    const vals=m.values.filter(Number.isFinite),min=vals.length?Math.min(...vals):0,max=vals.length?Math.max(...vals):0;
    const scale=Math.min((w-100)/m.width,(h-90)/m.height),ox=(w-m.width*scale)/2,oy=(h-m.height*scale)/2;
    const xy=(x,y)=>[ox+(x-m.x)*scale,h-oy-(y-m.y)*scale];
    if(vals.length===m.nx*m.ny){for(let j=0;j<60;j++)for(let i=0;i<80;i++){const x=m.x+(i+.5)*m.width/80,y=m.y+(j+.5)*m.height/60,z=HM.height(m,x,y);ctx.fillStyle=`hsl(${190-150*(max===min?.5:(z-min)/(max-min))} 65% 35%)`;const [px,py]=xy(x-m.width/160,y+m.height/120);ctx.fillRect(px,py,m.width*scale/80+1,m.height*scale/60+1);}}
    ctx.strokeStyle='#64829b';ctx.strokeRect(ox,oy,m.width*scale,m.height*scale);ctx.font='12px Consolas';ctx.fillStyle='#d8e9fa';ctx.fillText(`X ${m.x} … ${m.x+m.width}`,ox,h-12);ctx.fillText(`Y ${m.y} … ${m.y+m.height}`,ox,18);
    for(const p of HM.points(m)){const [x,y]=xy(p.x,p.y);ctx.beginPath();ctx.arc(x,y,current===p.index?6:3,0,Math.PI*2);ctx.fillStyle=current===p.index?'#ffdd88':Number.isFinite(m.values[p.index])?'#67f5ce':'#637588';ctx.fill();}
    const [rx,ry]=xy(m.originX,m.originY);ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.strokeRect(rx-6,ry-6,12,12);ctx.lineWidth=1;
    $('hmSummary').textContent=vals.length?`${vals.length} / ${m.nx*m.ny} · минимум ${min.toFixed(4)} · максимум ${max.toFixed(4)} · перепад ${(max-min).toFixed(4)} мм`:'Пустая сетка · квадрат — опорная точка';
    $('hmProgress').max=m.nx*m.ny;$('hmProgress').value=vals.length;
  }
  async function action(fn){if(operation)return;operation=true;update();try{await fn();}catch(e){message(e.message);}finally{operation=false;update();draw();}}
  $('heightMapOpen').onclick=()=>{$('heightMapDialog').showModal();update();draw();};
  $('hmClose').onclick=()=>$('heightMapDialog').close();
  $('heightMapDialog').addEventListener('cancel',e=>{if(measuring)e.preventDefault();});
  $('hmParameters').addEventListener('change',()=>{if(map){map=null;$('hmBindingConfirmed').checked=false;message('Параметры изменены. Требуется новое измерение.');}update();draw();});
  $('hmBindingConfirmed').onchange=update;
  $('hmBounds').onclick=()=>{try{const m=GCode.parse($('editor').value);if(!m.complete||!m.segments.length)throw Error('Сначала загрузите корректную программу');const p=config();for(const [i,k] of ['x','y'].entries()){p[k]=m.bounds.min[i];p[i?'height':'width']=Math.max(.1,m.bounds.max[i]-m.bounds.min[i]);}p.originX=p.x;p.originY=p.y;fill(p);map=null;update();draw();}catch(e){message(e.message);}};
  $('hmCurrent').onclick=()=>{const p=c.lastStatus?.position;if(p){$('hmOriginX').value=p[0];$('hmOriginY').value=p[1];map=null;update();draw();}};
  $('hmGo').onclick=()=>action(async()=>{const p=config();await c.run(`G21G90\nG0Z${p.safeZ}\nG0X${p.originX}Y${p.originY}`);message('Инструмент в опорной точке на верхнем Z.');});
  $('hmStart').onclick=()=>action(async()=>{
    const p=config();map=null;active=null;current=null;$('hmBindingConfirmed').checked=false;measuring=true;message('Измеряется опорная точка…');
    try{map=await c.probeHeightMap(p,(partial,point,done)=>{map=structuredClone(partial);current=point?.index??null;message(`Измерено ${done} / ${p.nx*p.ny}. Остановить — прекращает цикл; затем нужен сброс GRBL.`);draw();update();});$('hmBindingConfirmed').checked=false;message('Карта измерена. Перед отправкой установите Z0 касанием в опорной точке (кнопка «Щуп Z» после перехода к ней). Затем примените коррекцию.');}
    finally{measuring=false;current=null;}
  });
  $('hmStop').onclick=async()=>{try{await c.stopHeightMap();}catch(e){message(e.message);}update();};
  $('hmSave').onclick=()=>save('surface.heightmap',JSON.stringify(map,null,2),'application/json');
  $('hmDemo').onclick=()=>{map={format:'ViewerGcode-heightmap',version:1,x:0,y:0,width:80,height:60,nx:5,ny:5,originX:0,originY:0,safeZ:5,bottomZ:-1,feed:50,simulated:true,values:[]};for(let j=0;j<5;j++)for(let i=0;i<5;i++)map.values.push(.015*i+.025*j+.12*Math.sin(i*Math.PI/4)*Math.sin(j*Math.PI/4));fill(map);$('hmBindingConfirmed').checked=true;message('Демонстрационная поверхность: можно применить к примеру программы и посмотреть траекторию. Отправка на станок заблокирована.');update();draw();};
  $('hmLoad').onclick=()=>$('hmFile').click();
  $('hmFile').onchange=()=>action(async()=>{const file=$('hmFile').files[0];if(!file)return;map=HM.load(await file.text());fill(map);$('hmBindingConfirmed').checked=false;message('Карта загружена. Подтвердите закрепление заготовки и рабочий ноль.');$('hmFile').value='';});
  function replace(text,name){internal=true;try{CNCViewer.load(text,name);}finally{internal=false;}}
  $('hmApply').onclick=()=>action(async()=>{
    if(!$('hmBindingConfirmed').checked)throw Error('Подтвердите рабочий ноль и положение заготовки');
    const source=$('editor').value,name=CNCViewer.getState().filename;
    const transformed=HM.transform(source,map,Number($('hmStep').value));GRBL.prepare(transformed);if(!GCode.parse(transformed).complete)throw Error('Исправленная траектория слишком велика для просмотра. Увеличьте шаг разбиения.');
    replace(transformed,name.replace(/\.[^.]+$/,'')+'-heightmap.nc');active={source,name,correctedName:CNCViewer.getState().filename,transformed,map:structuredClone(map)};message('Коррекция применена к редактору и траектории. Перед отправкой проверяется привязка карты; демо-карта не отправляется.');
  });
  $('hmRestore').onclick=()=>action(async()=>{const original=active;replace(original.source,original.name);active=null;message('Исходная программа восстановлена.');});
  $('hmExport').onclick=()=>{if($('editor').value!==active.transformed){message('Программа изменена после коррекции. Верните исходник и примените карту заново.');return;}save(CNCViewer.getState().filename,active.transformed,'text/plain');};
  window.addEventListener('cnc:loaded',event=>{if(!internal&&active&&event.detail.name!==active.correctedName){active=null;update();}});
  window.HeightMapUI={isActive:()=>!!active,async beforeSend(source){
    if(!active)return;
    if(source!==active.transformed)throw Error('Исправленная программа изменена. Верните исходник и примените карту заново.');
    if(active.map.simulated)throw Error('Демонстрационная карта: отправка на станок запрещена. Верните исходник и измерьте настоящую карту.');
    const binding=active.map.binding;if(!binding||!Array.isArray(binding.offset)||binding.offset.length!==3||!binding.offset.every(Number.isFinite))throw Error('В карте отсутствует привязка рабочих координат. Выполните измерение заново.');
    const modes=(await c.systemCommand('$G')).find(s=>s.startsWith('[GC:'))||'';
    if(/(?:^| )G43(?:\.1)?(?: |$)/.test(modes.slice(4,-1)))throw Error('Перед отправкой отключите коррекцию длины инструмента и проверьте рабочий ноль');
    if(!modes.slice(4,-1).split(/\s+/).includes(binding.wcs))throw Error('Рабочая система координат отличается от карты');
    const r=await c.status();if(r.state!=='Idle'||!r.position||!r.machinePosition||r.machinePosition.some((v,i)=>Math.abs(v-r.position[i]-binding.offset[i])>.005))throw Error('Рабочий ноль изменился. Проверьте привязку и измерьте карту заново.');
  }};
  setInterval(()=>{if($('heightMapDialog').open)update();},250);
  update();draw();
})();
