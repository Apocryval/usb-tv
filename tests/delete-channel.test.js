const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/app.js','utf8');
function fixture({confirm=true,fail=false,scanning=false}={}) {
  const messages=[],saved=[];
  const original={channels:[{name:'A'},{name:'B'},{name:'Interdimensional Customs'}],settings:{},
    label_rules:[{keyword:'test',channels:['A','B']}],videos:[
      {id:'1',type:'programme',channels:['A'],enabled:true,file:'one.mp4'},
      {id:'2',type:'programme',channels:['A','B'],enabled:true},
      {id:'3',type:'advert',channels:['A'],enabled:true},
      {id:'4',type:'bumper',channels:['A','B'],enabled:true},
      {id:'5',type:'advert',channels:[],enabled:true},
      {id:'6',type:'programme',channels:['A'],missing:true}]};
  let closed=0;
  const context={state:{catalog:original,scanning,playback:{mode:'channel',channel:'A'}},
    CUSTOMS_CHANNEL:'Interdimensional Customs',reshuffling:false,
    window:{confirm:message=>{messages.push(message);return confirm;}},
    saveQueue:Promise.resolve(),broadcastQueue:Promise.resolve(),guideNavigation:{channel:'A'},
    $:()=>({close(){closed++;}}),renderChannels(){},renderAll(){},showToast:m=>messages.push(m),
    async saveCatalog(){if(fail)throw Error('Save conflict');saved.push(context.state.catalog);return context.state.catalog;}};
  vm.runInNewContext(source.slice(source.indexOf('let deletingChannel ='),source.indexOf('async function reshuffleChannels')),context);
  return {context,original,messages,saved,closed:()=>closed};
}
test('cancelled deletion makes no changes and protected automatic channel cannot be deleted',async()=>{
  const f=fixture({confirm:false});await f.context.deleteChannel('A');
  assert.equal(f.saved.length,0);assert.equal(f.context.state.catalog,f.original);
  assert(f.messages[0].includes('Delete channel “A”?'));assert(f.messages[0].includes('cannot be undone'));
  assert(f.messages[0].includes('1 advert(s)/bumper(s)'));
  const g=fixture();await g.context.deleteChannel('Interdimensional Customs');assert.equal(g.messages.length,0);
});
test('confirmed deletion removes assignments and rules without deleting files or broadening adverts',async()=>{
  const f=fixture();await f.context.deleteChannel('A');
  const result=f.context.state.catalog;
  assert.equal(f.saved.length,1);assert(!result.channels.some(c=>c.name==='A'));
  assert(result.videos.every(v=>!v.channels.includes('A')));
  assert.equal(result.videos[0].file,'one.mp4');assert.equal(result.videos[0].enabled,true);
  assert.equal(result.videos[2].enabled,false);assert.equal(result.videos[3].enabled,true);
  assert.equal(result.videos[4].enabled,true);assert.deepEqual(Array.from(result.label_rules[0].channels),['B']);
  assert.equal(f.closed(),1);assert.equal(f.context.guideNavigation.channel,null);
  assert.equal(f.original.videos[2].enabled,true);
});
test('save failure restores the channel and assignments; scans block deletion',async()=>{
  const f=fixture({fail:true});await f.context.deleteChannel('A');
  assert.equal(f.context.state.catalog,f.original);assert.equal(f.closed(),0);
  assert(f.messages.at(-1).includes('not deleted'));
  const g=fixture({scanning:true});await g.context.deleteChannel('A');assert.equal(g.saved.length,0);
  assert(!g.messages.some(m=>m.startsWith('Delete channel')));
});
test('repeated clicks cannot schedule more than one deletion',async()=>{
  const f=fixture();let release;f.context.saveQueue=new Promise(resolve=>release=resolve);
  const first=f.context.deleteChannel('A');await f.context.deleteChannel('A');release();await first;
  assert.equal(f.saved.length,1);assert.equal(f.messages.filter(m=>m.startsWith('Delete channel')).length,1);
});
