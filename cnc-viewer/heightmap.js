/* Height map geometry and conservative G-code transformation; millimetres. */
(function(root){
  'use strict';
  const parse=typeof module!=='undefined'?require('./parser.js').parseGCode:root.GCode.parse;
  function validate(c){
    for(const k of ['x','y','width','height','nx','ny','originX','originY','safeZ','bottomZ','feed'])if(!Number.isFinite(c[k])||Math.abs(c[k])>1e6)throw Error('Некорректный параметр: '+k);
    if(c.width<=0||c.height<=0||!Number.isInteger(c.nx)||!Number.isInteger(c.ny)||c.nx<2||c.ny<2||c.nx*c.ny>10000)throw Error('Сетка: минимум 2 × 2, максимум 10 000 точек');
    if(c.safeZ<=c.bottomZ||c.feed<=0||c.feed>10000)throw Error('Проверьте верхний Z, нижний Z и подачу');
    if(c.originX<c.x||c.originX>c.x+c.width||c.originY<c.y||c.originY>c.y+c.height)throw Error('Опорная точка должна находиться внутри карты');
    return c;
  }
  function points(c){validate(c);const result=[];for(let j=0;j<c.ny;j++)for(let t=0;t<c.nx;t++){const i=j%2?c.nx-1-t:t;result.push({x:c.x+i*c.width/(c.nx-1),y:c.y+j*c.height/(c.ny-1),index:j*c.nx+i});}return result;}
  function complete(m){validate(m);if(!Array.isArray(m.values)||m.values.length!==m.nx*m.ny||!m.values.every(Number.isFinite))throw Error('Карта не заполнена: нужны все успешные касания');return m;}
  function height(m,x,y){
    if(x<m.x-1e-7||y<m.y-1e-7||x>m.x+m.width+1e-7||y>m.y+m.height+1e-7)throw Error(`Траектория вне карты: X${x.toFixed(3)} Y${y.toFixed(3)}`);
    const u=Math.max(0,Math.min(m.nx-1,(x-m.x)/m.width*(m.nx-1))),v=Math.max(0,Math.min(m.ny-1,(y-m.y)/m.height*(m.ny-1)));
    const i=Math.min(m.nx-2,Math.floor(u)),j=Math.min(m.ny-2,Math.floor(v)),a=u-i,b=v-j;
    return m.values[j*m.nx+i]*(1-a)*(1-b)+m.values[j*m.nx+i+1]*a*(1-b)+m.values[(j+1)*m.nx+i]*(1-a)*b+m.values[(j+1)*m.nx+i+1]*a*b;
  }
  function transform(source,m,step=1){
    if(source.includes('(Height map compensation - mm, absolute)'))throw Error('К программе уже применена карта. Загрузите исходник');
    complete(m);if(!Number.isFinite(step)||step<.01||step>10)throw Error('Шаг разбиения: 0.01–10 мм');
    const model=parse(source);if(!model.complete||model.diagnostics.length)throw Error('Для коррекции нужна программа без ошибок и неподдерживаемых режимов');
    if(m.safeZ<=Math.max(...m.values)+.01)throw Error('Верхний Z должен быть выше всей измеренной поверхности');
    const byLine=new Map(model.segments.map(s=>[s.line,s]));const out=['(Height map compensation - mm, absolute)','G21 G90 G17 G91.1 G94'];
    let metric=false,absolute=false,knownX=false,knownY=false,safe=false;
    const fmt=n=>n.toFixed(4);
    for(let i=0;i<model.lines.length;i++){
      const raw=model.lines[i],code=raw.replace(/\([^)]*\)/g,'').replace(/;.*$/,'').toUpperCase();
      const tokens=[...code.matchAll(/([A-Z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/g)];
      const gs=tokens.filter(t=>t[1]==='G').map(t=>Number(t[2]));
      if(gs.some(g=>![0,1,2,3,17,21,40,49,80,90,91.1,94].includes(g))||tokens.some(t=>'HTO'.includes(t[1])||t[1]==='M'&&![0,1,2,3,4,5,7,8,9,30].includes(Number(t[2]))))throw Error(`Строка ${i+1}: коррекция поддерживает G21 G90, плоскость XY, без смены инструмента и смещений`);
      if(gs.includes(21))metric=true;if(gs.includes(90))absolute=true;
      const seg=byLine.get(i+1);
      if(!seg){out.push(raw);if(tokens.some(t=>t[1]==='M'&&[2,30].includes(Number(t[2]))))break;continue;}
      if(!metric||!absolute)throw Error('Перед перемещениями явно задайте G21 G90');
      if(tokens.some(t=>t[1]==='M'||t[1]==='S'))throw Error(`Строка ${i+1}: вынесите M/S-команды в отдельную строку`);
      const has=k=>tokens.some(t=>t[1]===k);
      if(seg.type===0){
        // Establish a safe initial position; never compensate rapid traverses.
        if(!safe&&(has('X')||has('Y')))throw Error('Первым перемещением задайте G0 Z на высоту не ниже верхнего Z карты');
        if(seg.end[2]<m.safeZ-1e-7)throw Error(`Строка ${i+1}: быстрый ход ниже верхнего Z карты; используйте G1 для подхода`);
        safe=true;knownX ||= has('X');knownY ||= has('Y');
        out.push('G0 Z'+fmt(seg.end[2]));
        if(has('X')||has('Y'))out.push('G0'+(has('X')?' X'+fmt(seg.end[0]):'')+(has('Y')?' Y'+fmt(seg.end[1]):''));
        continue;
      }
      if(!safe||!knownX||!knownY)throw Error('До обработки задайте G0 Z и G0 X… Y…');
      if(seg.feed<=0)throw Error('Для обработки нужна подача F');
      const extra=tokens.filter(t=>t[1]==='G'&&![0,1,2,3].includes(Number(t[2]))).map(t=>'G'+t[2]).join(' ');if(extra)out.push(extra);
      for(let p=1;p<seg.points.length;p++){
        const a=seg.points[p-1],b=seg.points[p];height(m,a[0],a[1]);height(m,b[0],b[1]);
        const count=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/Math.min(step,m.width/(m.nx-1),m.height/(m.ny-1))));
        for(let n=1;n<=count;n++){const q=a.map((v,k)=>v+(b[k]-v)*n/count);out.push(`G1 X${fmt(q[0])} Y${fmt(q[1])} Z${fmt(q[2]+height(m,q[0],q[1]))} F${fmt(seg.feed)}`);}
      }
    }
    return out.join('\n');
  }
  function load(text){const m=JSON.parse(text);if(m.format!=='ViewerGcode-heightmap'||m.version!==1)throw Error('Неизвестный формат карты');validate(m);if(!Array.isArray(m.values)||m.values.length!==m.nx*m.ny||m.values.some(v=>v!==null&&!Number.isFinite(v)))throw Error('Повреждены значения карты');return m;}
  const api={validate,points,complete,height,transform,load};if(typeof module!=='undefined')module.exports=api;else root.HeightMap=api;
})(typeof window!=='undefined'?window:globalThis);
