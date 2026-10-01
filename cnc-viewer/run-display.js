(function(root){
 'use strict';
 class Timer{
  constructor(now=()=>root.performance?.now()??Date.now()){this.now=now;this.started=null;this.elapsed=0;this.kind=null;}
  event(e){
   if(e.type==='programStart'||e.type==='jogStart'&&this.kind!=='program'){this.kind=e.type==='programStart'?'program':'jog';this.elapsed=0;this.started=this.now();}
   if(['programEnd','error','resetting'].includes(e.type)||e.type==='jogComplete'&&this.kind==='jog'||e.type==='connection'&&!e.connected)this.stop();
  }
  stop(){if(this.started!==null)this.elapsed=this.now()-this.started;this.started=null;this.kind=null;}
  text(){const s=Math.max(0,Math.floor((this.started===null?this.elapsed:this.now()-this.started)/1000));return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(v=>String(v).padStart(2,'0')).join(':');}
 }
 function state(raw){const key=raw?.split(':')[0];return ({Idle:['IDLE','idle'],Run:['RUN','run'],Jog:['RUN','run'],Home:['RUN','run'],Hold:['PAUSE','pause'],Door:['PAUSE','pause'],Alarm:['ALARM','alarm']})[key]||[raw?raw.toUpperCase():'ОТКЛЮЧЕНО','unknown'];}
 const api={Timer,state};if(typeof module!=='undefined')module.exports=api;else root.RunDisplay=api;
})(typeof window!=='undefined'?window:globalThis);
