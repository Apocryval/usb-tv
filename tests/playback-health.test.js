const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PlaybackWatch}=require('../web/playback-health.js');
const fs=require('node:fs'),vm=require('node:vm');
test('a stuck playing clock reports a stall after 12 seconds and progress clears it',()=>{
  const watch=new PlaybackWatch(),key={};
  assert.equal(watch.sample({key,position:1,active:true},0),false);
  assert.equal(watch.sample({key,position:1,active:true},11999),false);
  assert.equal(watch.sample({key,position:1,active:true},12000),true);
  assert.equal(watch.sample({key,position:2,active:true},13000),false);
});
test('normal progress, deliberate pause, hidden tabs and changing recordings do not produce false stalls',()=>{
  const watch=new PlaybackWatch(),key={};
  for(let i=0;i<30;i++) assert.equal(watch.sample({key,position:i,active:true},i*1000),false);
  assert.equal(watch.sample({key,position:29,active:false},100000),false);
  assert.equal(watch.sample({key,position:29,active:true},200000),false);
  assert.equal(watch.sample({key:{},position:29,active:true},212000),false);
  assert.equal(watch.sample({key:null,position:0,active:true},300000),false);
});
test('backward seeks and explicit reloads restart the stall timer',()=>{
  const watch=new PlaybackWatch(),key={};
  watch.sample({key,position:20,active:true},0);
  assert.equal(watch.sample({key,position:10,active:true},12000),false);
  assert.equal(watch.sample({key,position:10,active:true},24000),true);
  watch.reset();assert.equal(watch.sample({key,position:10,active:true},25000),false);
});
test('retrying a replay reloads the same file and restores its position without changing modes',()=>{
  const source=fs.readFileSync('web/app.js','utf8');
  let plays=0,loads=0,listener;
  const playback={mode:'replay',loaded:true,failed:true};
  const player={currentTime:73,src:'/Videos/one.mkv',addEventListener(name,fn){listener=fn;},load(){loads++;},play(){plays++;return Promise.resolve();}};
  const context={state:{playback},$:id=>id==='#player'?player:{dataset:{}},revealPlayerControls(){},seekToLive(position,target){target.currentTime=position;},showToast(){}};
  vm.runInNewContext(source.slice(source.indexOf('function retryStalledPlayback('),source.indexOf('globalThis.USBTvPlaybackHealth?.configure')),context);
  context.retryStalledPlayback();assert.equal(loads,1);assert.equal(playback.failed,false);
  player.currentTime=0;listener();assert.equal(player.currentTime,73);assert.equal(plays,1);
  assert.equal(playback.mode,'replay');
  context.state.playback={mode:'preview'};listener();assert.equal(plays,1,'a late retry callback cannot resume a different recording');
});

test('automatic exclusion waits for 30s and is cancelled by progress or deliberate pause',()=>{
  const watch=new PlaybackWatch(), key={};
  watch.sample({key,position:1,active:true},0);
  assert.equal(watch.shouldSkip(29999),false);assert.equal(watch.shouldSkip(30000),true);
  watch.sample({key,position:2,active:true},30000);
  assert.equal(watch.shouldSkip(30001),false);
  watch.sample({key,position:2,active:false},60000);
  assert.equal(watch.shouldSkip(90000),false);
});

test('player source cancellations are ignored but actual decoder failures are excluded',()=>{
  const source=fs.readFileSync('web/app.js','utf8');
  const start=source.indexOf('$("#player").addEventListener("error"');
  const end=source.indexOf('\nupdateFullscreenButtons();',start);
  let handler,reason,excluded;
  const video={id:'one'}, player={error:{code:1},addEventListener(name,fn){handler=fn;}};
  const context={$:()=>player,state:{playback:{mode:'channel'}},currentPlaybackVideo:()=>video,
    excludePlaybackFile(v,r){excluded=v;reason=r;}};
  vm.runInNewContext(source.slice(start,end),context);
  handler();assert.equal(excluded,undefined);
  player.error={code:3};handler();assert.equal(excluded,video);assert.equal(reason,'decode');
  player.error={code:4};handler();assert.equal(reason,'unsupported');
});
