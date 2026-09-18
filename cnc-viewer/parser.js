(function(root){
  'use strict';
  const TAU=Math.PI*2, axes=['X','Y','Z'];
  function parseGCode(source, {ignoreUnsupported=false}={}){
    const lines=String(source).replace(/\r/g,'').split('\n');
    const segments=[],diagnostics=[];
    let pos=[0,0,0],unit=1,absolute=true,arcAbsolute=false,plane=17,motion=0,feed=0,stopped=false;
    let length=0,rapidLength=0,pointsCount=0;
    const min=[0,0,0],max=[0,0,0];
    const fail=(line,message)=>{diagnostics.push({line,severity:'error',message});stopped=true;};
    for(let index=0;index<lines.length&&!stopped;index++){
      const line=index+1;
      let code=lines[index].replace(/\([^)]*\)/g,'').replace(/;.*$/,'').trim().toUpperCase();
      if(!code||code==='%')continue;
      if(/[\[\]#()\/]/.test(code)){fail(line,'Макросы, выражения, пропуск блока или незакрытый комментарий не поддерживаются.');break;}
      const tokens=[...code.matchAll(/([A-Z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/g)];
      if(code.replace(/([A-Z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/g,'').trim()) {fail(line,'Не удалось разобрать строку.');break;}
      const words={},gs=[],ms=[];
      for(const t of tokens){const key=t[1],v=Number(t[2]);if(!Number.isFinite(v)||Math.abs(v)>1e9){fail(line,'Число выходит за допустимый диапазон.');break;}
        if(key==='G')gs.push(v);else if(key==='M')ms.push(v);else {if(key in words){fail(line,`Повтор слова ${key}.`);break;}words[key]=v;}}
      if(stopped)break;
      const allowed=[0,1,2,3,17,18,19,20,21,40,43,49,80,90,91,90.1,91.1,94];
      const unsupported=[...gs.filter(g=>!allowed.includes(g)).map(g=>'G'+g),...ms.filter(m=>![0,1,2,3,4,5,6,7,8,9,30].includes(m)).map(m=>'M'+m)];
      if(ignoreUnsupported&&unsupported.length){
        diagnostics.push({line,severity:'warning',message:`Пропущен весь блок: ${unsupported.join(', ')}. Координаты и режимы этого блока не применены; дальнейшая траектория приблизительная.`});
        if(ms.includes(2)||ms.includes(30))break;
        continue;
      }
      if(Object.keys(words).some(k=>!'XYZIJKRFSTNOH'.includes(k))){fail(line,'Неподдерживаемая ось или параметр.');break;}
      const bad=gs.find(g=>!allowed.includes(g));
      if(bad!==undefined){fail(line,`G${bad} не поддерживается. Построение остановлено до этой строки.`);break;}
      for(const group of [[0,1,2,3,80],[17,18,19],[20,21],[43,49],[90,91],[90.1,91.1]])if(gs.filter(g=>group.includes(g)).length>1)fail(line,'Конфликт команд одной модальной группы.');
      if(stopped)break;
      if('H'in words&&(!Number.isInteger(words.H)||words.H<0)){fail(line,'Номер коррекции H должен быть целым неотрицательным числом.');break;}
      if('H'in words&&!gs.includes(43)){fail(line,'В этом просмотрщике H поддерживается только в блоке G43.');break;}
      if(gs.includes(43))diagnostics.push({line,severity:'warning',message:`G43${'H'in words?' H'+words.H:''}: показана программная траектория. Коррекция длины инструмента из таблицы станка не рассчитывается.`});
      const badM=ms.find(m=>![0,1,2,3,4,5,6,7,8,9,30].includes(m));
      if(badM!==undefined){fail(line,`M${badM} не поддерживается.`);break;}
      for(const g of gs){if(g<=3)motion=g;if(g===80)motion=null;if(g===20)unit=25.4;if(g===21)unit=1;if(g===90)absolute=true;if(g===91)absolute=false;if(g===90.1)arcAbsolute=true;if(g===91.1)arcAbsolute=false;if([17,18,19].includes(g))plane=g;}
      if('F'in words){feed=words.F*unit;if(feed<=0){fail(line,'Подача F должна быть положительной.');break;}}
      const hasAxes=axes.some(k=>k in words),hasArc='R'in words||['I','J','K'].some(k=>k in words);
      if(hasAxes||hasArc){
        if(motion===null){fail(line,'После G80 требуется явная команда движения.');break;}
        if(motion<2&&hasArc){fail(line,'Параметры дуги заданы для линейного движения.');break;}
        const end=axes.map((k,i)=>k in words?(absolute?0:pos[i])+words[k]*unit:pos[i]);
        let points=[pos.slice(),end.slice()],distance=Math.hypot(...end.map((v,i)=>v-pos[i]));
        if(motion===2||motion===3){
          const [u,v,w,ik,jk]=plane===17?[0,1,2,'I','J']:plane===18?[2,0,1,'K','I']:[1,2,0,'J','K'];
          if(['I','J','K'].some(k=>k in words&&k!==ik&&k!==jk)){fail(line,'Центр дуги задан вне выбранной плоскости.');break;}
          const clockwise=motion===2;
          const sweepFor=(cx,cy)=>{const a=Math.atan2(pos[v]-cy,pos[u]-cx),b=Math.atan2(end[v]-cy,end[u]-cx);let s=b-a;if(clockwise){while(s>=-1e-12)s-=TAU;}else{while(s<=1e-12)s+=TAU;}return [a,s];};
          let cx,cy;
          if('R'in words){
            if(ik in words||jk in words){fail(line,'Задайте либо R, либо центр I/J/K.');break;}
            const r=Math.abs(words.R*unit),dx=end[u]-pos[u],dy=end[v]-pos[v],chord=Math.hypot(dx,dy);
            if(chord<1e-9||r<chord/2-1e-8){fail(line,'Невозможная дуга R: проверьте радиус и конечную точку.');break;}
            const h=Math.sqrt(Math.max(0,r*r-chord*chord/4)),mx=(pos[u]+end[u])/2,my=(pos[v]+end[v])/2;
            const candidates=[[mx-dy/chord*h,my+dx/chord*h],[mx+dy/chord*h,my-dx/chord*h]];
            [cx,cy]=candidates.find(c=>words.R<0?Math.abs(sweepFor(...c)[1])>=Math.PI-1e-9:Math.abs(sweepFor(...c)[1])<=Math.PI+1e-9)||candidates[0];
          }else{
            if(!(ik in words)&&!(jk in words)||arcAbsolute&&(!(ik in words)||!(jk in words))){fail(line,'Не задан центр дуги в выбранной плоскости.');break;}
            cx=(arcAbsolute?0:pos[u])+(words[ik]||0)*unit;cy=(arcAbsolute?0:pos[v])+(words[jk]||0)*unit;
          }
          const radius=Math.hypot(pos[u]-cx,pos[v]-cy),rEnd=Math.hypot(end[u]-cx,end[v]-cy);
          if(radius<1e-9||Math.abs(radius-rEnd)>Math.max(.01,radius*.001)){fail(line,'Начальный и конечный радиусы дуги не совпадают.');break;}
          const [a,sweep]=sweepFor(cx,cy);
          const step=2*Math.acos(Math.max(-1,Math.min(1,1-.02/radius)));
          const count=Math.max(8,Math.ceil(Math.abs(sweep)/Math.min(Math.PI/36,step||.001)));
          if(count>50000){fail(line,'Дуга слишком велика для интерактивного просмотра.');break;}
          points=[pos.slice()];for(let j=1;j<=count;j++){const t=j/count,p=pos.slice();p[u]=cx+radius*Math.cos(a+sweep*t);p[v]=cy+radius*Math.sin(a+sweep*t);p[w]=pos[w]+(end[w]-pos[w])*t;points.push(p);}points[points.length-1]=end.slice();
          distance=Math.hypot(radius*sweep,end[w]-pos[w]);
        }
        pointsCount+=points.length;if(pointsCount>500000){fail(line,'Лимит 500 000 точек. Разделите программу на части.');break;}
        for(const p of points)for(let i=0;i<3;i++){min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i]);}
        segments.push({line,type:motion,feed,start:pos.slice(),end:end.slice(),points,length:distance});
        if(motion===0)rapidLength+=distance;else length+=distance;pos=end;
      }
      if(ms.includes(2)||ms.includes(30))break;
    }
    return {lines,segments,diagnostics,bounds:{min,max},length,rapidLength,position:pos,complete:!stopped};
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={parseGCode};
  root.GCode={parse:parseGCode};
})(typeof window!=='undefined'?window:globalThis);
