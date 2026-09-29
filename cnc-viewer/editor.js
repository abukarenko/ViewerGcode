(function(root){
 'use strict';
 class History{
  constructor(text=''){this.reset(text);}
  reset(text){this.text=text;this.entries=[];this.index=0;}
  record(text,before,after){if(text===this.text)return;let start=0,endOld=this.text.length,endNew=text.length;while(start<endOld&&start<endNew&&this.text[start]===text[start])start++;while(endOld>start&&endNew>start&&this.text[endOld-1]===text[endNew-1]){endOld--;endNew--;}
   this.entries.splice(this.index);this.entries.push({start,removed:this.text.slice(start,endOld),added:text.slice(start,endNew),before,after});this.index++;this.text=text;
  }
  move(target){target=Math.max(0,Math.min(this.entries.length,target));let selection;
   while(this.index>target){const e=this.entries[--this.index];this.text=this.text.slice(0,e.start)+e.removed+this.text.slice(e.start+e.added.length);selection=e.before;}
   while(this.index<target){const e=this.entries[this.index++];this.text=this.text.slice(0,e.start)+e.added+this.text.slice(e.start+e.removed.length);selection=e.after;}
   return {text:this.text,selection};
  }
 }
 if(typeof module!=='undefined'){module.exports={History};return;}
 const $=id=>document.getElementById(id),editor=$('editor'),history=new History(editor.value);let restoring=false,before=[0,0];
 const locked=()=>editor.readOnly||window.grblController?.busy;
 const selection=()=>[editor.selectionStart,editor.selectionEnd];
 function update(){
  $('editUndo').disabled=locked()||history.index===0;$('editRedo').disabled=locked()||history.index===history.entries.length;
  for(const id of ['editInsert','editDelete','editDuplicate','editComment','historyIndex'])$(id).disabled=!!locked();
  $('historyIndex').max=history.entries.length;$('historyIndex').value=history.index;$('historyTotal').textContent='/ '+history.entries.length;
 }
 function caret(visible=false){
  const offset=editor.selectionDirection==='backward'?editor.selectionStart:editor.selectionEnd;
  const prefix=editor.value.slice(0,offset),line=prefix.split('\n').length,col=offset-prefix.lastIndexOf('\n');
  $('editorPosition').textContent=`Стр ${line} · Стлб ${col}`;
  $('numbers').querySelector('.caret-line')?.classList.remove('caret-line');$('numbers').children[line-1]?.classList.add('caret-line');
  if(visible){const top=12+(line-1)*24;if(top<editor.scrollTop+24)editor.scrollTop=Math.max(0,top-24);else if(top+24>editor.scrollTop+editor.clientHeight-24)editor.scrollTop=top+48-editor.clientHeight;}
  editor.style.setProperty('--active-line-y',(12+(line-1)*24-editor.scrollTop)+'px');
  $('numbers').scrollTop=editor.scrollTop;update();
 }
 function notify(){editor.dispatchEvent(new Event('input',{bubbles:true}));caret(true);}
 function change(start,end,text,position=start+text.length){if(locked())return;before=selection();editor.value=editor.value.slice(0,start)+text+editor.value.slice(end);editor.focus();editor.setSelectionRange(position,position);notify();}
 function bounds(){const start=editor.value.lastIndexOf('\n',Math.max(0,editor.selectionStart-1))+1;let end=editor.selectionEnd;if(end>editor.selectionStart&&editor.value[end-1]==='\n')end--;end=editor.value.indexOf('\n',end);return [editor.selectionStart===0?0:start,end<0?editor.value.length:end];}
 function jumpHistory(target){if(locked())return;const result=history.move(target);restoring=true;editor.value=result.text;editor.focus();editor.setSelectionRange(...(result.selection||selection()));notify();restoring=false;update();}
 function goLine(line,focus=true){line=Math.max(1,Math.min(editor.value.split('\n').length,Math.trunc(line)||1));const lines=editor.value.split('\n'),start=lines.slice(0,line-1).reduce((n,l)=>n+l.length+1,0);if(focus)editor.focus();editor.setSelectionRange(start,start+lines[line-1].length);caret(true);}
 function insert(above=false){const [start,end]=bounds();change(above?start:end,above?start:end,'\n',above?start:end+1);}
 function remove(){let [start,end]=bounds();if(end<editor.value.length)end++;else if(start>0)start--;change(start,end,'',start);}
 function duplicate(){const [start,end]=bounds(),text=editor.value.slice(start,end);change(end,end,'\n'+text,end+1);}
 function comment(){const [start,end]=bounds(),lines=editor.value.slice(start,end).split('\n'),uncomment=lines.every(l=>/^\s*;/.test(l));change(start,end,lines.map(l=>uncomment?l.replace(/^(\s*); ?/,'$1'):'; '+l).join('\n'),start);}
 editor.addEventListener('beforeinput',e=>{before=selection();if(e.inputType==='historyUndo'||e.inputType==='historyRedo'){e.preventDefault();jumpHistory(history.index+(e.inputType==='historyUndo'?-1:1));}});
 editor.addEventListener('input',()=>{if(!restoring)history.record(editor.value,before,selection());caret(true);});
 editor.addEventListener('keyup',()=>caret(true));editor.addEventListener('click',()=>caret(false));editor.addEventListener('select',()=>caret(false));editor.addEventListener('scroll',()=>caret(false));
 editor.addEventListener('keydown',e=>{
  if(e.isComposing)return;const mod=e.ctrlKey||e.metaKey,key=e.key.toLowerCase();
  if(mod&&['z','y','d','/','g','f'].includes(key)||mod&&e.shiftKey&&key==='k'||e.altKey&&e.key==='Enter'||e.key==='Tab'){
   e.preventDefault();e.stopPropagation();
   if(key==='z')jumpHistory(history.index+(e.shiftKey?1:-1));else if(key==='y')jumpHistory(history.index+1);else if(key==='d')duplicate();else if(key==='k')remove();else if(key==='/')comment();else if(key==='g')$('editGoto').focus();else if(key==='f')$('editFind').focus();else if(e.key==='Enter')insert(e.shiftKey);else if(e.key==='Tab')change(editor.selectionStart,editor.selectionEnd,'  ');
  }
 });
 $('editUndo').onclick=()=>jumpHistory(history.index-1);$('editRedo').onclick=()=>jumpHistory(history.index+1);$('historyIndex').onchange=e=>jumpHistory(Number(e.target.value));
 $('editInsert').onclick=()=>insert();$('editDelete').onclick=remove;$('editDuplicate').onclick=duplicate;$('editComment').onclick=comment;
 $('editGoto').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();goLine(Number(e.target.value));}};
 function find(){const query=$('editFind').value;if(!query)return;let index=editor.value.toLowerCase().indexOf(query.toLowerCase(),editor.selectionEnd);if(index<0)index=editor.value.toLowerCase().indexOf(query.toLowerCase());if(index>=0){editor.focus();editor.setSelectionRange(index,index+query.length);caret(true);$('editFind').setCustomValidity('');}else{$('editFind').setCustomValidity('Текст не найден');$('editFind').reportValidity();}}
 $('editFindNext').onclick=find;$('editFind').oninput=()=>$('editFind').setCustomValidity('');$('editFind').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();find();}};
 window.addEventListener('cnc:selection',e=>{if(document.activeElement!==editor&&!locked())goLine(e.detail.line,false);});
 new MutationObserver(()=>{update();caret(false);}).observe(editor,{attributes:true,attributeFilter:['readonly']});
 $('editorOpen').onclick=()=>{$('editorDialog').showModal();editor.focus();caret(true);};
 $('editorClose').onclick=()=>$('editorDialog').close();
 window.SmartEditor={insertAbove:()=>insert(true),replaceSelection:text=>change(editor.selectionStart,editor.selectionEnd,text),reset(){history.reset(editor.value);before=selection();caret(false);},follow:line=>goLine(line,false),goLine};caret(false);
})(typeof window!=='undefined'?window:globalThis);
