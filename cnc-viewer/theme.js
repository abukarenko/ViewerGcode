(() => {
 'use strict';
 const choice=document.getElementById('themeChoice'),system=window.matchMedia('(prefers-color-scheme: light)');
 let selected='dark';try{const saved=localStorage.getItem('cnc-theme');if(['dark','light','amber','system'].includes(saved))selected=saved;}catch{}
 function apply(){document.documentElement.dataset.theme=selected==='system'?(system.matches?'light':'dark'):selected;window.dispatchEvent?.(new Event('cnc:theme'));}
 choice.value=selected;choice.onchange=()=>{selected=choice.value;try{localStorage.setItem('cnc-theme',selected);}catch{}apply();};
 system.addEventListener?.('change',()=>{if(selected==='system')apply();});apply();
})();
