const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');

test('simultaneous writes share a token request and keep the write header off reads',async()=>{
  const requests=[];
  const context={directFile:false,TypeError,async fetch(path,options){
    requests.push({path,options});
    return {ok:true,json:async()=>({token:'local-write-token'})};
  }};
  vm.runInNewContext(source.slice(source.indexOf('let writeToken ='),source.indexOf('const palette =')),context);
  await Promise.all([context.apiFetch('/api/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),
    context.apiFetch('/api/broadcasts',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})]);
  await context.apiFetch('/api/catalog');
  assert.equal(requests.filter(r=>r.path==='/api/write-token').length,1);
  assert(requests.filter(r=>r.options?.method==='POST').every(r=>r.options.headers['X-USBtv-Write']==='local-write-token'));
  assert.equal(requests.at(-1).options,undefined);
});

test('queued edits use accepted revisions and a conflict cannot silently retry stale labels',async()=>{
  const requests=[],status={};
  let stored=4;
  const context={state:{catalog:{revision:4,settings:{theme:'satellite'},videos:[]}},
    $:()=>status, showToast(){}, async apiFetch(path,options){
      const body=JSON.parse(options.body);requests.push(body);
      const ok=body.revision===stored;
      if(ok)stored++;
      return {ok,json:async()=>ok?{...body,revision:stored}:{error:'Refresh before saving'}};
    }};
  vm.runInNewContext(source.slice(source.indexOf('let saveQueue ='),source.indexOf('function setPage('))+'saveRevision=4;',context);
  const first=context.saveCatalog();context.state.catalog.settings.theme='goblin';
  const second=context.saveCatalog();await Promise.all([first,second]);
  assert.deepEqual(requests.map(r=>r.revision),[4,5]);
  assert.equal(context.state.catalog.revision,6);
  stored++; // A scanner or another window has saved meanwhile.
  await assert.rejects(context.saveCatalog(),/Refresh before saving/);
  assert.equal(stored,7);assert.equal(status.textContent,'SAVE FAILED');
});

test('failed live media waits for the next segment, then recovers without retuning',()=>{
  const nodes=new Map();const node=id=>{
    if(!nodes.has(id))nodes.set(id,{textContent:'',load(){this.loads=(this.loads||0)+1;}});
    return nodes.get(id);
  };
  const video={id:'good',duration:30,title:'Good clip',file:'Videos/good.mp4'};
  let current={key:'bad',segment:{video,advert:false,start:0},block:{video,index:0,segments:[]},timeline:{blocks:[{video}]}};
  const playback={mode:'channel',channel:'A',key:'bad',failed:true,paused:true};
  const context={state:{playback,catalog:{videos:[video]}},Schedule:{locate:()=>current},
    $:node,timeline(){},displayTitle:v=>v.title,formatDuration:()=>'',videoUrl:file=>'/'+file,window:{}};
  vm.runInNewContext(source.slice(source.indexOf('function syncChannel('),source.indexOf('function seekToLive(')),context);
  context.syncChannel();assert.equal(node('#player').loads,undefined);
  current={...current,key:'good'};context.syncChannel();
  assert.equal(node('#player').loads,1);assert.equal(playback.failed,false);
  assert.equal(playback.paused,false);assert.equal(playback.key,'good');
});

test('rejected edit drafts survive refresh and only the matching successful save clears them',()=>{
  const storage=new Map(),nodes=new Map();
  const context={sessionStorage:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k)||null,removeItem:k=>storage.delete(k)},
    $:id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);}};
  vm.runInNewContext(source.slice(source.indexOf('function rememberEditDraft('),source.indexOf("$('#recover-edit-draft').addEventListener")),context);
  const draft={id:'one',fingerprint:'content',title:'Unsaved title',episodes:[{title:'Part one',start:0,end:30}]};
  assert.equal(context.rememberEditDraft(draft),true);
  assert.deepEqual(JSON.parse(storage.get('usbtv-edit-draft')),draft);
  context.clearEditDraft('other');assert(storage.has('usbtv-edit-draft'));
  context.clearEditDraft('one');assert(!storage.has('usbtv-edit-draft'));
  assert.equal(nodes.get('#recover-edit-draft').hidden,true);
});

test('recovering a draft refuses a replaced media file',()=>{
  const draft={id:'one',fingerprint:'old',duration:30},messages=[];let recover;
  const context={sessionStorage:{getItem:()=>JSON.stringify(draft)},state:{catalog:{videos:[{...draft,fingerprint:'new'}]}},
    $:()=>({addEventListener:(event,handler)=>recover=handler}),showToast:message=>messages.push(message),
    openEditor:()=>assert.fail('A replaced file must not receive old draft labels')};
  vm.runInNewContext(source.slice(source.indexOf("$('#recover-edit-draft').addEventListener"),source.indexOf("try { $('#recover-edit-draft').hidden")),context);
  recover();assert.match(messages[0],/changed or is unavailable/);
});
