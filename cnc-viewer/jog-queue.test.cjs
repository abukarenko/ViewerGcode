const {test}=require('node:test');const assert=require('node:assert/strict');const {Controller}=require('./grbl.js');
function setup(){const c=new Controller();c.connected=true;const steps=[],pending=[];c.jog=async(...args)=>{steps.push(args);await new Promise((resolve,reject)=>pending.push({resolve,reject}));};return {c,steps,pending};}
test('Jog queues five clicks including active, preserves parameters and sequence',async()=>{
 const {c,steps,pending}=setup();const task=c.enqueueJog('X',10,500);for(let i=1;i<5;i++)c.enqueueJog('Y',i,100+i);await assert.rejects(c.enqueueJog('Z',1,200),/5 нажатий/);assert.equal(steps.length,1);
 for(let i=0;i<5;i++){pending[i].resolve();await new Promise(r=>setImmediate(r));}await task;assert.equal(steps.length,5);assert.deepEqual(steps[4],['Y',4,104]);assert.equal(c.jogQueueActive,false);
});
test('Jog stop clears pending clicks and rejects additions while stopping',async()=>{
 const {c,steps,pending}=setup();const task=c.enqueueJog('X',10,500);c.enqueueJog('X',10,500);await c.cancelJog();await assert.rejects(c.enqueueJog('Y',10,500));pending[0].resolve();await task;assert.equal(steps.length,1);
});
test('Jog failure clears pending movements',async()=>{
 const {c,steps,pending}=setup();const task=c.enqueueJog('X',10,500);c.enqueueJog('X',10,500);const rejected=assert.rejects(task,/fault/);pending[0].reject(Error('fault'));await rejected;assert.equal(steps.length,1);assert.equal(c.jogQueue.length,0);assert.equal(c.jogQueueActive,false);
});
