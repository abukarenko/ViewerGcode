const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('Theme restores saved choice and follows system changes only in system mode',()=>{
 const storage=new Map([['cnc-theme','light']]),choice={},root={dataset:{}},system={matches:false,addEventListener(_,fn){this.changed=fn;}};
 vm.runInNewContext(fs.readFileSync(require.resolve('./theme.js'),'utf8'),{document:{getElementById:()=>choice,documentElement:root},window:{matchMedia:()=>system},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}});
 assert.equal(root.dataset.theme,'light');choice.value='system';choice.onchange();assert.equal(root.dataset.theme,'dark');system.matches=true;system.changed();assert.equal(root.dataset.theme,'light');assert.equal(storage.get('cnc-theme'),'system');choice.value='dark';choice.onchange();system.changed();assert.equal(root.dataset.theme,'dark');
 choice.value='amber';choice.onchange();system.changed();assert.equal(root.dataset.theme,'amber');assert.equal(storage.get('cnc-theme'),'amber');
});
