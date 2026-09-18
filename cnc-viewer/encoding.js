(function(root){
  'use strict';
  // BOM takes precedence; otherwise prefer valid UTF-8, then legacy Cyrillic.
  function decode(bytes){
    const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
    if(data[0]===0xff&&data[1]===0xfe)return {text:new TextDecoder('utf-16le',{fatal:true}).decode(data),encoding:'UTF-16 LE'};
    if(data[0]===0xfe&&data[1]===0xff)return {text:new TextDecoder('utf-16be',{fatal:true}).decode(data),encoding:'UTF-16 BE'};
    try{return {text:new TextDecoder('utf-8',{fatal:true}).decode(data),encoding:'UTF-8'};}
    catch{return {text:new TextDecoder('windows-1251').decode(data),encoding:'Windows-1251'};}
  }
  root.GCodeEncoding={decode};
  if(typeof module!=='undefined'&&module.exports)module.exports={decode};
})(typeof window!=='undefined'?window:globalThis);
