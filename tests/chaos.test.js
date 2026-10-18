const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../web/app.js'),'utf8');
const functions=source.slice(source.indexOf('function chaosRandomInt'),source.indexOf('let chaosTransitionTimer'));

test('Chaos includes disabled files and adverts once each, excluding missing files, without modifying library order',()=>{
  const context={crypto:require('node:crypto').webcrypto};vm.runInNewContext(functions,context);
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
  const context={crypto:require('node:crypto').webcrypto};vm.runInNewContext(functions,context);
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
  const context={state:{playback},$:get,closeQuickLabels(){},updatePlaybackControls(){},
    displayTitle:v=>v.id,formatDuration:()=>'',videoUrl:f=>'/'+f,showToast(){},
    window:{USBTvAudio:{setTrack(v){track=v;}}},crypto:require('node:crypto').webcrypto};
  vm.runInNewContext(functions+source.slice(source.indexOf('function advanceChaos('),source.indexOf("$('#chaos-button').addEventListener")),context);
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
