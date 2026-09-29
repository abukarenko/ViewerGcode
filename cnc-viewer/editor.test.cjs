const {test}=require('node:test');
const assert=require('node:assert/strict');
const {History}=require('./editor.js');
test('history restores text and caret across insertions, deletion and replacement',()=>{
 const h=new History('G0X0\nG1X1');h.record('G0X0\n\nG1X1',[5,5],[6,6]);h.record('G0X0\nG1X2',[5,10],[9,9]);
 assert.deepEqual(h.move(0),{text:'G0X0\nG1X1',selection:[5,5]});assert.equal(h.move(2).text,'G0X0\nG1X2');assert.equal(h.move(1).text,'G0X0\n\nG1X1');
});
test('new edit after rollback replaces redo branch; reset starts another document history',()=>{
 const h=new History('A');h.record('AB',[1,1],[2,2]);h.record('ABC',[2,2],[3,3]);h.move(1);h.record('ABD',[2,2],[3,3]);assert.equal(h.move(99).text,'ABD');assert.equal(h.entries.length,2);h.reset('new');assert.equal(h.index,0);assert.equal(h.entries.length,0);
});
test('history supports a thousand changes without arbitrary truncation',()=>{
 const h=new History('');for(let i=1;i<=1000;i++)h.record('X'.repeat(i),[i-1,i-1],[i,i]);assert.equal(h.move(0).text,'');assert.equal(h.move(1000).text.length,1000);assert.equal(h.entries.reduce((n,e)=>n+e.added.length,0),1000);
});
