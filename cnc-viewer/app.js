/* Public host API: window.CNCViewer. All geometry uses millimetres. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id),canvas=$('canvas'),ctx=canvas.getContext('2d');
  const toolCanvas=document.createElement('canvas');toolCanvas.className='tool-overlay';toolCanvas.setAttribute('aria-hidden','true');$('viewport').append(toolCanvas);const toolCtx=toolCanvas.getContext('2d');
  let liveTool=false,devicePosition=null;
  function setDevicePosition(position){devicePosition=Array.isArray(position)&&position.length===3&&position.every(Number.isFinite)?position.slice():null;if(liveTool)drawTool();}
  function setLiveTool(active){if(liveTool===active)return;liveTool=active;if(active)pause();drawTool();}
  function drawTool(){
    const dpr=window.devicePixelRatio||1,w=canvas.clientWidth,h=canvas.clientHeight;
    if(toolCanvas.width!==Math.round(w*dpr)||toolCanvas.height!==Math.round(h*dpr)){toolCanvas.width=Math.round(w*dpr);toolCanvas.height=Math.round(h*dpr);}
    toolCtx.setTransform(dpr,0,0,dpr,0,0);toolCtx.clearRect(0,0,w,h);
    const p=liveTool?devicePosition:model?.segments[selected]?.end;
    $('positionSource').textContent=liveTool?(p?'Устройство · рабочие координаты · мм':'Устройство · ожидание координат / WCO'):'Координаты программы · мм';
    'xyz'.split('').forEach((id,i)=>$(id).textContent=p?p[i].toFixed(3):'—');
    if(!p)return;const q=project(p);toolCtx.beginPath();toolCtx.arc(...q,11,0,Math.PI*2);toolCtx.fillStyle='#ffce7325';toolCtx.fill();toolCtx.beginPath();toolCtx.arc(...q,4,0,Math.PI*2);toolCtx.fillStyle='#ffe5b2';toolCtx.fill();toolCtx.strokeStyle='#111925';toolCtx.lineWidth=1;toolCtx.stroke();
  }
  const demo=`(CNC PATH VIEWER - DEMO)
(Rounded pocket / millimetres)
G21 G90 G17 G91.1
G0 Z8
G0 X10 Y0
G1 Z-2 F180
G1 X70 Y0 F650
G3 X80 Y10 I0 J10
G1 Y50
G3 X70 Y60 I-10 J0
G1 X10
G3 X0 Y50 I0 J-10
G1 Y10
G3 X10 Y0 I10 J0
G0 Z8
G0 X20 Y10
G1 Z-2 F180
G1 X60 F650
G3 X70 Y20 I0 J10
G1 Y40
G3 X60 Y50 I-10 J0
G1 X20
G3 X10 Y40 I0 J-10
G1 Y20
G3 X20 Y10 I10 J0
G0 Z8
G0 X50 Y30
G1 Z-2 F180
G2 X50 Y30 I-10 J0 F450
G0 Z8
G0 X0 Y0
M30`;
  let model,selected=-1,filename='demo.nc',view='iso',yaw=-.65,pitch=.88,scale=1,pan=[0,0],center=[0,0,0],playing=false,last=0,dirty=false,drag=null;
  function emit(type,payload){const message={type,...payload};window.dispatchEvent(new CustomEvent('cnc:'+type,{detail:message}));window.chrome?.webview?.postMessage(message);}
  function pause(){playing=false;$('play').textContent='▶';$('play').setAttribute('aria-label','Воспроизвести');}
  function lineNumbers(){const n=$('editor').value.split('\n').length;if($('numbers').children.length!==n)$('numbers').replaceChildren(...Array.from({length:n},(_,i)=>{const el=document.createElement('div');el.textContent=i+1;return el;}));$('lineCount').textContent=n+' строк';syncScroll();}
  function syncScroll(){$('numbers').scrollTop=$('editor').scrollTop;}
  function load(source,name='program.nc'){
    if(window.grblController?.busy)throw new Error('Дождитесь завершения отправки на станок');
    if(typeof source!=='string')throw new TypeError('source must be a string');
    if(source.length>2e6||source.split('\n').length>50000)throw new Error('Лимит: 2 МБ или 50 000 строк.');
    pause();$('editor').value=source;filename=String(name);$('filename').textContent=filename;lineNumbers();process();window.SmartEditor?.reset();return model;
  }
  function process(){pause();dirty=false;model=GCode.parse($('editor').value,{ignoreUnsupported:$('ignoreUnsupported').checked});$('scrub').max=Math.max(0,model.segments.length-1);$('scrub').disabled=!model.segments.length;
    $('distance').textContent=model.length.toFixed(1)+' мм';$('rapidDistance').textContent=model.rapidLength.toFixed(1)+' мм';$('bounds').textContent=model.bounds.max.map((v,i)=>(v-model.bounds.min[i]).toFixed(1)).join(' × ')+' мм';$('moves').textContent=model.segments.length;
    $('diagnostics').replaceChildren();if(model.diagnostics.length){for(const d of model.diagnostics){const b=document.createElement('button');b.textContent=`${d.severity==='warning'?'Примечание':'Ошибка'} · строка ${d.line}: ${d.message}`;b.onclick=()=>focusLine(d.line);$('diagnostics').append(b);}}
    else $('diagnostics').textContent='Ошибок в поддерживаемых командах нет. Воспроизведение — по кадрам, без расчёта времени станка.';
    $('statusBadge').textContent=model.complete?(model.diagnostics.length?'С ПРИМЕЧАНИЕМ':'ГОТОВО'):'НЕПОЛНАЯ ТРАЕКТОРИЯ';$('statusBadge').style.color=model.diagnostics.length?'#ffb88d':'';$('footerState').textContent=model.complete?'Программа разобрана':'Построение остановлено на ошибке';
    $('play').disabled=$('next').disabled=$('prev').disabled=!model.segments.length;
    setFrame(model.segments.length?0:-1);fit();emit('loaded',{name:filename,segments:model.segments.length,complete:model.complete,diagnostics:model.diagnostics});
  }
  function focusLine(line){if(window.SmartEditor){window.SmartEditor.goLine(line);return;}const lines=$('editor').value.split('\n');const start=lines.slice(0,line-1).reduce((n,s)=>n+s.length+1,0);$('editor').focus();$('editor').setSelectionRange(start,start+(lines[line-1]?.length||0));$('editor').scrollTop=Math.max(0,(line-4)*24);syncScroll();}
  function setFrame(index){if(!window.grblController?.busy)liveTool=false;selected=model?.segments.length?Math.max(0,Math.min(model.segments.length-1,Math.trunc(index))):-1;const seg=model?.segments[selected];$('scrub').value=Math.max(0,selected);$('frame').textContent=seg?`Кадр ${selected+1} / ${model.segments.length} · строка ${seg.line}`:'Нет перемещений';$('command').textContent=seg?`G${seg.type}  F${seg.feed.toFixed(0)}`:'—';
    (seg?.end||[0,0,0]).forEach((v,i)=>$(('xyz')[i]).textContent=v.toFixed(3));$('numbers').querySelector('.selected')?.classList.remove('selected');if(seg)$('numbers').children[seg.line-1]?.classList.add('selected');draw();if(seg)emit('selection',{line:seg.line,index:selected,position:{x:seg.end[0],y:seg.end[1],z:seg.end[2]}});
  }
  function rotate(p){const [x,y,z]=p.map((v,i)=>v-center[i]);if(view==='xy')return[x,-y];if(view==='xz')return[x,-z];if(view==='yz')return[y,-z];const a=x*Math.cos(yaw)-y*Math.sin(yaw),b=x*Math.sin(yaw)+y*Math.cos(yaw);return[a,-b*Math.cos(pitch)-z*Math.sin(pitch)];}
  function project(p){const q=rotate(p);return [canvas.clientWidth/2+q[0]*scale+pan[0],canvas.clientHeight/2+q[1]*scale+pan[1]];}
  function fit(){if(!model)return;center=model.bounds.min.map((v,i)=>(v+model.bounds.max[i])/2);pan=[0,0];const corners=[];for(let a=0;a<8;a++)corners.push(rotate(center.map((_,i)=>(a&(1<<i))?model.bounds.max[i]:model.bounds.min[i])));const xs=corners.map(p=>p[0]),ys=corners.map(p=>p[1]);scale=Math.min(Math.max(50,canvas.clientWidth-150)/Math.max(10,Math.max(...xs)-Math.min(...xs)),Math.max(50,canvas.clientHeight-160)/Math.max(10,Math.max(...ys)-Math.min(...ys)));draw();}
  function path(points,color,width=1,dash=[]){ctx.beginPath();points.forEach((p,i)=>{const q=project(p);i?ctx.lineTo(...q):ctx.moveTo(...q);});ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.stroke();ctx.setLineDash([]);}
  function draw(){if(!model)return;const dpr=window.devicePixelRatio||1,w=canvas.clientWidth,h=canvas.clientHeight;if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
    if($('grid').checked){const [u,v]=view==='xz'?[0,2]:view==='yz'?[1,2]:[0,1];const span=Math.max(20,...model.bounds.max.map((n,i)=>n-model.bounds.min[i]));const step=10**Math.floor(Math.log10(span/6));const size=Math.ceil(span/step)*step;const c=center.map(n=>Math.round(n/step)*step);
      for(let n=-size;n<=size;n+=step){let a=[0,0,0],b=[0,0,0];a[u]=c[u]+n;b[u]=a[u];a[v]=c[v]-size;b[v]=c[v]+size;path([a,b],'#26374a',.65);a=[0,0,0];b=[0,0,0];a[v]=c[v]+n;b[v]=a[v];a[u]=c[u]-size;b[u]=c[u]+size;path([a,b],'#26374a',.65);}
    }
    const extent=Math.max(10,...model.bounds.max.map((v,i)=>v-model.bounds.min[i]))*.25;
    [[0,'#eb7b83','X'],[1,'#79bd8e','Y'],[2,'#7ca8ff','Z']].forEach(([i,color,label])=>{const p=[0,0,0];p[i]=extent;path([[0,0,0],p],color,1);const q=project(p);ctx.font='12px Consolas';ctx.fillStyle=color;ctx.fillText(label,q[0]+5,q[1]-5);});
    model.segments.forEach((s,i)=>{if(s.type===0&&!$('rapid').checked)return;path(s.points,i<=selected?'#87919e':s.type===0?'#647b9e':'#45debb',i===selected?3:s.type===0?1:1.7,s.type===0?[5,5]:[]);});
    drawTool();
  }
  function setView(value){if(!['iso','xy','xz','yz'].includes(value))throw new Error('Unknown view');view=value;document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));$('viewName').textContent=({iso:'ИЗОМЕТРИЯ',xy:'ВИД СВЕРХУ · XY',xz:'ВИД СПЕРЕДИ · XZ',yz:'ВИД СБОКУ · YZ'})[view];fit();}
  function selectLine(line){if(!Number.isInteger(line)||line<1)throw new Error('line must be a positive integer');pause();let index=-1;model.segments.forEach((s,i)=>{if(s.line<=line)index=i;});if(index>=0)setFrame(index);return index;}
  $('ignoreUnsupported').onchange=()=>{lineNumbers();process();};
  $('process').onclick=()=>{lineNumbers();process();};$('demo').onclick=()=>load(demo,'demo.nc');$('open').onclick=()=>$('file').click();
  async function readFile(file){if(!file)return;if(file.size>2e6){alert('Лимит размера файла — 2 МБ.');return;}try{const decoded=GCodeEncoding.decode(await file.arrayBuffer());load(decoded.text,file.name);$('filename').title=`${file.name} · ${decoded.encoding}`;$('footerState').textContent+=` · ${decoded.encoding}`;}catch(e){alert(e.message);}}
  $('file').onchange=async e=>{await readFile(e.target.files[0]);e.target.value='';};
  $('save').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([$ ('editor').value],{type:'text/plain;charset=utf-8'}));a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
  $('editor').onscroll=syncScroll;$('editor').oninput=()=>{dirty=true;pause();lineNumbers();$('footerState').textContent='Изменено — нажмите «Построить»';$('statusBadge').textContent='НЕ ПЕРЕСТРОЕНО';};
  $('editor').addEventListener('click',()=>{if(!dirty)selectLine($('editor').value.slice(0,$('editor').selectionStart).split('\n').length);});
  document.addEventListener('keydown',e=>{if(e.ctrlKey&&e.key==='Enter'){e.preventDefault();$('process').click();}});
  $('fit').onclick=fit;document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view));$('grid').onchange=$('rapid').onchange=draw;
  $('scrub').oninput=e=>{pause();setFrame(Number(e.target.value));};$('prev').onclick=()=>{pause();setFrame(selected-1);};$('next').onclick=()=>{pause();setFrame(selected+1);};
  $('play').onclick=()=>{if(playing){pause();return;}if(selected>=model.segments.length-1)setFrame(0);playing=true;last=performance.now();$('play').textContent='Ⅱ';$('play').setAttribute('aria-label','Пауза');};
  function tick(now){if(playing&&now-last>1000/Number($('speed').value)){last=now;if(selected>=model.segments.length-1)pause();else setFrame(selected+1);}requestAnimationFrame(tick);}requestAnimationFrame(tick);
  canvas.onpointerdown=e=>{if(e.button===2)return;drag={x:e.clientX,y:e.clientY,pan:e.shiftKey||e.button===1};canvas.setPointerCapture(e.pointerId);};canvas.onpointerup=canvas.onpointercancel=()=>drag=null;canvas.onpointermove=e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.x=e.clientX;drag.y=e.clientY;if(drag.pan||view!=='iso'){pan[0]+=dx;pan[1]+=dy;}else{yaw+=dx*.008;pitch=Math.max(.05,Math.min(Math.PI-.05,pitch+dy*.008));}draw();};
  canvas.addEventListener('wheel',e=>{e.preventDefault();scale=Math.max(.00001,Math.min(1e5,scale*Math.exp(-e.deltaY*.001)));draw();},{passive:false});canvas.ondblclick=fit;
  document.addEventListener('dragover',e=>{e.preventDefault();document.body.classList.add('dragging');});document.addEventListener('dragleave',e=>{if(!e.relatedTarget)document.body.classList.remove('dragging');});document.addEventListener('drop',e=>{e.preventDefault();document.body.classList.remove('dragging');readFile(e.dataTransfer.files[0]);});
  new ResizeObserver(draw).observe(canvas);
  window.CNCViewer={setDevicePosition,setLiveTool,load,selectLine,setView,fit,getState:()=>({filename,selectedLine:model.segments[selected]?.line??null,dirty,complete:model.complete,diagnostics:model.diagnostics.map(d=>({...d})),segments:model.segments.length})};
  window.chrome?.webview?.addEventListener('message',e=>{try{const m=e.data;if(m?.type==='load')load(m.source,m.name);else if(m?.type==='selectLine')selectLine(m.line);else if(m?.type==='setView')setView(m.view);else if(m?.type==='fit')fit();else throw new Error('Unknown message type');}catch(error){emit('error',{message:error.message});}});
  load(demo);emit('ready',{version:'0.2.0'});
})();
