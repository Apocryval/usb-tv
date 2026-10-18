const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../web/app.js'),'utf8');
function fixture(playback={mode:'channel',channel:'A',mediaId:'ad'}) {
  const nodes=new Map(),choices=[{value:'A',checked:true},{value:'B',checked:true}];
  const get=id=>{
    if(!nodes.has(id)) nodes.set(id,{hidden:true,dataset:{},value:'',checked:false,events:{},
      addEventListener(event,handler){this.events[event]=handler;},setAttribute(){},focus(){},
      querySelectorAll(selector){return id==='#quick-label-channels' ? choices.filter(c=>selector==='input:checked'?c.checked:true) : [];}});
    return nodes.get(id);
  };
  choices.forEach(c=>{c.addEventListener=(event,fn)=>c.change=fn;});
  const ad={id:'ad',title:'Actual advert',type:'advert',enabled:true,channels:[],tags:[],genres:[],file:'Adverts/ad.mp4'};
  const programme={...ad,id:'show',title:'Programme containing the break',type:'programme',channels:['A'],file:'Videos/show.mp4'};
  let current={block:{video:programme},segment:{video:ad}},saves=0;
  const context={$:get,state:{playback,catalog:{videos:[ad,programme]}},structuredClone,
    Schedule:{locate:()=>current},timeline(){},showToast(){},displayTitle:v=>v.title,
    assignableChannelNames:()=>['A','B'],esc:String,USBTvSuggestions:{list:t=>t.split(',').map(s=>s.trim()).filter(Boolean)},
    async saveCatalog(){saves++;return context.state.catalog;},clearEditDraft(){},renderAll(){},broadcastQueue:Promise.resolve()};
  vm.runInNewContext(source.slice(source.indexOf('let quickLabelId ='),source.indexOf("$('#retry-media').addEventListener")),context);
  return {context,get,choices,ad,programme,setCurrent:value=>current=value,saves:()=>saves,
    submit:()=>get('#quick-label-form').events.submit({preventDefault(){}})};
}
test('live and replay labellers select the advert segment rather than its parent programme',()=>{
  for(const playback of [{mode:'channel',channel:'A'}, {mode:'replay',current:{segment:{video:{id:'ad'}},block:{video:{id:'show'}}}}]) {
    const f=fixture(playback);f.context.openQuickLabels();
    assert.equal(f.get('#quick-label-title').value,'Actual advert');
    assert.equal(f.get('#quick-label-type').value,'advert');
    assert.equal(f.get('#quick-label-all-channels').checked,true);
    assert.match(f.get('#quick-label-channels').innerHTML,/value="A" checked/);
    assert.match(f.get('#quick-label-channels').innerHTML,/value="B" checked/);
  }
});
test('paused live labelling uses the loaded file even if the station clock moves on',()=>{
  const f=fixture({mode:'channel',channel:'A',mediaId:'ad',paused:true});
  f.setCurrent({segment:{video:f.programme},block:{video:f.programme}});
  f.context.openQuickLabels();assert.equal(f.get('#quick-label-title').value,'Actual advert');
});
test('excluding the current channel saves the advert restriction without touching the programme',async()=>{
  const f=fixture();f.context.openQuickLabels();
  f.choices[0].checked=false;f.choices[0].change();
  f.setCurrent({segment:{video:f.programme},block:{video:f.programme}});
  await f.submit();
  assert.deepEqual(Array.from(f.ad.channels),['B']);assert.equal(f.ad.type,'advert');
  assert.deepEqual(f.programme.channels,['A']);assert.equal(f.saves(),1);
});
test('saving an unrestricted advert preserves eligibility on future channels',async()=>{
  const f=fixture();f.context.openQuickLabels();await f.submit();assert.equal(f.ad.channels.length,0);
});
test('clearing all advert channels cannot accidentally re-enable it everywhere',async()=>{
  const f=fixture();f.context.openQuickLabels();
  f.choices.forEach(c=>{c.checked=false;c.change();});await f.submit();
  assert.equal(f.saves(),0);assert.match(f.get('#quick-label-error').textContent,/at least one/);
  f.get('#quick-label-enabled').checked=false;await f.submit();
  assert.equal(f.saves(),1);assert.equal(f.ad.enabled,false);
});
test('converting an unrestricted advert to a programme requires reviewing its destinations',async()=>{
  const f=fixture();f.context.openQuickLabels();f.get('#quick-label-type').value='programme';
  f.get('#quick-label-type').events.change();
  assert(f.choices.every(c=>!c.checked));
  f.choices[1].checked=true;await f.submit();
  assert.equal(f.ad.type,'programme');assert.deepEqual(Array.from(f.ad.channels),['B']);
});
