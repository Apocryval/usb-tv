const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../web/app.js'),'utf8');
const Schedule=require('../web/schedule.js');
const prune=source.slice(source.indexOf('function pruneChaos('),source.indexOf('function chaosPlaylist('));
const functions=source.slice(source.indexOf('function chaosRandomInt'),source.indexOf('let chaosTransitionTimer'));

test('Chaos includes disabled files and adverts once each, excluding missing files, without modifying library order',()=>{
  const context={Schedule,crypto:require('node:crypto').webcrypto};vm.runInNewContext(functions,context);
  const library=[{id:'a',file:'Videos/a.mp4',enabled:false},{id:'b',file:'Adverts/b.mp4',type:'advert'},
    {id:'c',file:'Videos/c.mp4',missing:true},{id:'d',file:'Videos/d.mp4',break_points:[30]}, {id:'bad'}];
  const before=JSON.stringify(library);
  const queue=context.shuffleChaos(library,null,()=>0);
  assert.deepEqual(Array.from(queue,v=>v.id).sort(),['a','b','d']);
  assert.equal(JSON.stringify(library),before);
  assert.equal(context.shuffleChaos([],null).length,0);
  assert.equal(context.shuffleChaos([library[0]],'a').length,1);
});

test('Fisher-Yates can produce all permutations, and the next cycle avoids an immediate repeat',()=>{
  const context={Schedule,crypto:require('node:crypto').webcrypto};vm.runInNewContext(functions,context);
  const videos=['a','b','c'].map(id=>({id,file:`Videos/${id}.mp4`}));
  const permutations=new Set();
  for(let first=0;first<3;first++)for(let second=0;second<2;second++) {
    const picks=[first,second];permutations.add(context.shuffleChaos(videos,null,()=>picks.shift()).map(v=>v.id).join(''));
  }
  assert.equal(permutations.size,6);
  for(let i=0;i<100;i++)assert.notEqual(context.shuffleChaos(videos,'a')[0].id,'a');
});

test('Chaos advances whole files independently of the schedule and stops after all fail',()=>{
  const nodes=new Map();
  const get=key=>{if(!nodes.has(key))nodes.set(key,{hidden:true,dataset:{},load(){this.loads=(this.loads||0)+1;},play(){return Promise.resolve();}});return nodes.get(key);};
  const videos=['a','b'].map(id=>({id,file:`Videos/${id}.mp4`,duration:60}));
  const playback={mode:'chaos',queue:videos,index:-1,id:null,failures:0};
  let track;
  const context={Schedule,state:{playback,catalog:{videos}},$:get,closeQuickLabels(){},updatePlaybackControls(){},
    displayTitle:v=>v.id,formatDuration:()=>'',videoUrl:f=>'/'+f,showToast(){},
    window:{USBTvAudio:{setTrack(v){track=v;}}},crypto:require('node:crypto').webcrypto};
  vm.runInNewContext(functions+prune+source.slice(source.indexOf('function advanceChaos('),source.indexOf("$('#chaos-button').addEventListener")),context);
  context.advanceChaos();
  assert.equal(playback.id,'a');assert.equal(track.id,'a');
  get('#player').onloadedmetadata();assert.equal(get('#player').currentTime,0);
  context.advanceChaos();assert.equal(playback.id,'b');
  context.previousChaos();assert.equal(playback.id,'a');
  const queueIndex=playback.index;
  context.advanceChaos();assert.equal(playback.id,'b');
  assert.equal(playback.index,queueIndex,'forward after previous reuses history without consuming another shuffled item');
  context.advanceChaos();assert.equal(playback.id,'a');
  context.advanceChaos(true);assert.equal(playback.id,'b');
  const loads=get('#player').loads;
  context.advanceChaos(true);assert.equal(get('#player').loads,loads);
  assert.match(get('#player-meta').textContent,/None of these files/);
  context.state.playback={mode:'channel'};context.advanceChaos();assert.equal(get('#player').loads,loads);
});

test('playlist jumps retain the exact queue, skipped entries, and backward/forward navigation',()=>{
  const videos=['a','b','c','d','e'].map(id=>({id,file:`Videos/${id}.mp4`,duration:60}));
  const playback={mode:'chaos',queue:videos.slice(),index:-1,id:null,trail:[],trailIndex:-1,failures:0};
  const nodes=new Map();
  const get=key=>{if(!nodes.has(key))nodes.set(key,{dataset:{},load(){},play(){return Promise.resolve();}});return nodes.get(key);};
  const context={Schedule,state:{playback,catalog:{videos}},$:get,closeQuickLabels(){},updatePlaybackControls(){},displayTitle:v=>v.id,
    formatDuration:()=>'',videoUrl:f=>f,showToast(){},window:{},crypto:require('node:crypto').webcrypto};
  vm.runInNewContext(functions+prune+source.slice(source.indexOf('function chaosPlaylist('),source.indexOf("$('#chaos-button').addEventListener")),context);
  const ids=()=>Array.from(context.chaosPlaylist(playback),v=>v.id);
  context.advanceChaos();
  assert.deepEqual(ids(),['a','b','c','d','e']);
  context.jumpChaos(3);
  assert.equal(playback.id,'d');assert.equal(playback.index,3);
  assert.deepEqual(Array.from(playback.trail,v=>v.id),['a','b','c','d']);
  assert.deepEqual(ids(),['a','b','c','d','e']);
  context.previousChaos();assert.equal(playback.id,'c');
  context.jumpChaos(0);assert.equal(playback.id,'a');assert.equal(playback.index,3);
  context.advanceChaos();assert.equal(playback.id,'b');
  context.jumpChaos(4);assert.equal(playback.id,'e');
  assert.deepEqual(ids(),['a','b','c','d','e']);
  for(const invalid of [-1,5,NaN,1.5,'2'])context.jumpChaos(invalid);
  assert.equal(playback.id,'e');
  get('#quick-label-panel').dataset.saving='true';context.jumpChaos(0);assert.equal(playback.id,'e');
  get('#quick-label-panel').dataset.saving='false';
  context.advanceChaos();
  assert.equal(context.chaosPlaylist(playback).length,10,'completed history remains available alongside the new cycle');
  const queueOrder=playback.queue.map(v=>v.id).join();
  context.jumpChaos(2);assert.equal(playback.id,'c');
  context.jumpChaos(9);assert.equal(playback.index,4);
  assert.equal(playback.queue.map(v=>v.id).join(),queueOrder,'jumping never reshuffles');
  context.state.playback={mode:'channel'};context.jumpChaos(0);
  assert.equal(context.chaosPlaylist(context.state.playback).length,0);
});

test('Wow excludes scan failures even when broadcast-disabled media remains allowed',()=>{
  const context={Schedule,crypto:require('node:crypto').webcrypto};vm.runInNewContext(functions,context);
  const videos=[{id:'healthy',file:'Videos/good.mp4',enabled:false},
    {id:'bad',file:'Videos/bad.mp4',playback_check:{status:'error'}},
    {id:'incomplete',file:'Videos/partial.mp4',playback_check:{status:'warning',issues:[{code:'zero_filled_regions'}]}}];
  assert.deepEqual(Array.from(context.shuffleChaos(videos),v=>v.id),['healthy']);
});

test('a later scan removes failed files from both Wow history and the remaining queue',()=>{
  const videos=['a','b','c','d'].map(id=>({id,file:`Videos/${id}.mp4`}));
  const playback={mode:'chaos',queue:videos.slice(),index:1,trail:videos.slice(0,2),trailIndex:1,id:'b'};
  const context={Schedule,state:{playback,catalog:{videos:videos.map(v=>({...v,playback_check:['a','c'].includes(v.id)?{status:'error'}:undefined}))}}};
  vm.runInNewContext(prune+source.slice(source.indexOf('function chaosPlaylist('),source.indexOf('function jumpChaos(')),context);
  assert.deepEqual(Array.from(context.chaosPlaylist(playback),v=>v.id),['b','d']);
  assert.equal(playback.index,0);assert.equal(playback.trailIndex,0);
});

test('Wow stops cleanly if a running queue loses every file to exclusions',()=>{
  const videos=[{id:'bad',file:'Videos/bad.mp4',playback_check:{status:'error'}}];
  const playback={mode:'chaos',queue:videos.slice(),index:0,trail:videos.slice(),trailIndex:0,id:'bad',loaded:true};
  const nodes=new Map();
  const get=id=>{if(!nodes.has(id))nodes.set(id,{dataset:{},pause(){this.paused=true;},removeAttribute(){},load(){this.loads=(this.loads||0)+1;}});return nodes.get(id);};
  const context={Schedule,state:{playback,catalog:{videos}},$:get,revealPlayerControls(){},updatePlaybackControls(){}};
  vm.runInNewContext(prune+source.slice(source.indexOf('function advanceChaos('),source.indexOf('function previousChaos(')),context);
  context.advanceChaos();
  assert.equal(playback.id,null);assert.equal(playback.loaded,false);assert.equal(get('#player').paused,true);
  assert.match(get('#player-title').textContent,/No playable files/);assert.equal(get('#player').loads,1);
});
