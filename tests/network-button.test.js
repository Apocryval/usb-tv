const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../web/app.js'),'utf8');
function fixture({advanced=true,admin=false,mode='channel',fail=false}={}) {
  const nodes=new Map(),calls=[],original={A:{clock:'original'}},updated={A:{clock:'advanced'}};
  const get=id=>{
    if(!nodes.has(id))nodes.set(id,{hidden:true,dataset:{},querySelectorAll:()=>[]});
    return nodes.get(id);
  };
  const context={$:get,state:{catalog:{settings:{advanced_mode:advanced,admin_playback:admin}},playback:{mode,channel:'A'}},
    broadcastState:{channels:original},broadcastQueue:Promise.resolve(),
    USBTvPlans:{advance:(catalog,plans,channel,action)=>{calls.push(['advance',channel,action]);return updated;}},
    async persistBroadcasts(plans){calls.push(['save',plans]);if(fail)throw Error('Conflict');},
    invalidateSchedule(){},renderGuide(){},renderChannels(){},closeQuickLabels(){},syncChannel(){calls.push(['sync']);},
    revealPlayerControls(){},updatePlaybackControls(){},showToast:message=>calls.push(['toast',message])};
  vm.runInNewContext(source.slice(source.indexOf('function adminPlaybackEnabled()'),source.indexOf("$('#call-network').addEventListener")),context);
  return {context,calls,get,original,updated};
}
test('network skip needs Advanced mode but does not require the separate Admin toggle',async()=>{
  const f=fixture();await f.context.advanceChannel('network');
  assert.deepEqual(f.calls[0],['advance','A','skip']);
  assert.equal(f.context.broadcastState.channels,f.updated);
  assert(f.calls.find(c=>c[0]==='sync'));
  const ordinary=fixture();await ordinary.context.advanceChannel('skip');assert.equal(ordinary.calls.length,0);
});
test('network button cannot advance ordinary viewing modes or discard open label edits',async()=>{
  for(const options of [{advanced:false},{mode:'preview'},{mode:'replay'},{mode:'chaos'}]) {
    const f=fixture(options);await f.context.advanceChannel('network');assert.equal(f.calls.length,0);
  }
  const f=fixture();f.get('#quick-label-panel').hidden=false;
  await f.context.advanceChannel('network');assert(!f.calls.find(c=>c[0]==='advance'));
});
test('a rejected schedule save does not apply the skip locally',async()=>{
  const f=fixture({fail:true});await f.context.advanceChannel('network');
  assert.equal(f.context.broadcastState.channels,f.original);
  assert(!f.calls.find(c=>c[0]==='sync'));
  assert.equal(f.get('#call-network').disabled,false);
});
test('repeated clicks produce one skip, and disabling Advanced before saving cancels it',async()=>{
  const f=fixture();let release;
  f.context.broadcastQueue=new Promise(resolve=>release=resolve);
  const first=f.context.advanceChannel('network');await f.context.advanceChannel('network');
  release();await first;assert.equal(f.calls.filter(c=>c[0]==='advance').length,1);
  const g=fixture();let finish;g.context.broadcastQueue=new Promise(resolve=>finish=resolve);
  const pending=g.context.advanceChannel('network');g.context.state.catalog.settings.advanced_mode=false;
  finish();await pending;assert.equal(g.calls.length,0);
});
