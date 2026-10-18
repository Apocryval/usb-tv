const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const S=require('../web/schedule.js');
const video=(id,duration,extra={})=>({id,duration,type:'programme',channels:['A'],...extra});
const catalog={videos:[video('one',60),video('two',80),video('three',100)],channels:[{name:'A',ad_length:0}],settings:{}};

test('previous and restart find programme starts; next cannot seek into the future or mutate broadcasts',()=>{
  const line=S.buildCycle(catalog,'A','fixed',0), now=610000;
  const before=JSON.stringify(line),current=S.locate(line,now);
  const previous=S.browseProgramme(line,now,'previous',now);
  assert.equal(S.locate(line,previous).end,current.start);
  assert(Math.abs(S.locate(line,previous).position)<.01);
  assert.equal(S.browseProgramme(line,now,'restart',now),current.start+.5);
  assert.equal(S.browseProgramme(line,now,'next',now),now);
  assert.equal(S.browseProgramme({...line,duration:0},now,'previous',now),null);
  assert.equal(JSON.stringify(line),before);
});

test('replay navigation treats internal adverts as part of their programme and honours episode markers',()=>{
  const c={videos:[video('episodes',120,{episode_review:'multiple',episodes:[{title:'First',start:0,end:60},{title:'Second',start:60,end:120}],breaks_approved:true,break_points:[30,90]}),
    video('ad',10,{type:'advert'})],channels:[{name:'A',ad_interval:30,ad_length:10}],settings:{}};
  const line=S.buildCycle(c,'A','fixed',0),at=100000;
  const current=S.locate(line,at);
  const restarted=S.locate(line,S.browseProgramme(line,at,'restart',at));
  assert.equal(restarted.block.index,current.block.index);
  assert.equal(restarted.segment.advert,false);
  assert(Math.abs(restarted.position-(restarted.block.video.source_offset+.0005))<.000001);
  const prev=S.locate(line,S.browseProgramme(line,at,'previous',at));
  assert.equal(prev.block.video.episode_index,0);
  assert.equal(current.block.video.episode_index,1);
});

test('previous crosses a pending lineup boundary using the earlier broadcast rotation',()=>{
  const active=S.buildCycle(catalog,'A','old',0);
  const pending=S.buildCycle({...catalog,videos:[video('new',120)]},'A','new',720000);
  const line={...active,active,pending,transition:720000};
  const target=S.browseProgramme(line,725000,'previous',725000);
  assert(target<720000);
  assert.notEqual(S.locate(line,target).block.video.id,'new');
  assert.equal(S.locate(line,target).end,720000);
});

test('replay follows its own segment cursor through loading delays and rejoins live at the catch-up point',()=>{
  const source=fs.readFileSync(require.resolve('../web/app.js'),'utf8');
  const nodes=new Map();
  const get=id=>{if(!nodes.has(id))nodes.set(id,{dataset:{},load(){},play(){return Promise.resolve();}});return nodes.get(id);};
  const line=S.buildCycle(catalog,'A','fixed',0),now=610000;
  let clock=now;
  const playback={mode:'replay',channel:'A',line,cursor:500000,current:null,loaded:false};
  let joined=0;
  const context={state:{playback,catalog},Schedule:S,$:get,Date:{now:()=>clock},
    tuneChannel(name){assert.equal(name,'A');joined++;},window:{},displayTitle:v=>v.id,
    videoUrl:f=>f,seekToLive(pos,player){player.currentTime=pos;},updatePlaybackControls(){},showToast(){}};
  vm.runInNewContext(source.slice(source.indexOf('function returnToLive()'),source.indexOf("$('#programme-previous').addEventListener")),context);
  context.loadChannelReplay();clock+=50000;get('#player').onloadedmetadata();
  assert.equal(playback.loaded,true);assert.equal(joined,0);
  assert.equal(get('#player').currentTime,S.locate(line,500000).position);
  const end=playback.current.segmentEnd;
  context.advanceChannelReplay();assert.equal(playback.cursor,end+.5);
  playback.cursor=clock;context.loadChannelReplay();assert.equal(joined,1);
  context.returnToLive();assert.equal(joined,2);
});

test('loading paused replay disables native autoplay and stays paused after metadata arrives',()=>{
  const source=fs.readFileSync(require.resolve('../web/app.js'),'utf8'),nodes=new Map();
  const get=id=>{if(!nodes.has(id))nodes.set(id,{load(){},pause(){this.paused=true;},play(){assert.fail('Paused replay must not play');}});return nodes.get(id);};
  const line=S.buildCycle(catalog,'A','fixed',0),playback={mode:'replay',channel:'A',line,cursor:500000};
  const context={state:{playback,catalog},Schedule:S,$:get,Date:{now:()=>610000},window:{},displayTitle:v=>v.id,
    videoUrl:f=>f,seekToLive(pos,player){player.currentTime=pos;},updatePlaybackControls(){},revealPlayerControls(){}};
  vm.runInNewContext(source.slice(source.indexOf('function returnToLive()'),source.indexOf("$('#programme-previous').addEventListener")),context);
  context.loadChannelReplay(false);assert.equal(get('#player').autoplay,false);
  get('#player').onloadedmetadata();assert.equal(get('#player').paused,true);
});

test('seeking again before metadata loads honours the latest position and autoplay intent',()=>{
  const source=fs.readFileSync(require.resolve('../web/app.js'),'utf8'),nodes=new Map();let plays=0;
  const get=id=>{if(!nodes.has(id))nodes.set(id,{dataset:{},load(){this.currentTime=0;},paused:true,pause(){},play(){plays++;return Promise.resolve();}});return nodes.get(id);};
  const line=S.buildCycle(catalog,'A','fixed',0),playback={mode:'replay',channel:'A',line,cursor:500000};
  const context={state:{playback,catalog},Schedule:S,$:get,Date:{now:()=>610000},window:{},displayTitle:v=>v.id,
    videoUrl:f=>f,seekToLive(pos,player){player.currentTime=pos;},updatePlaybackControls(){},revealPlayerControls(){}};
  vm.runInNewContext(source.slice(source.indexOf('function playerProgress()'),source.indexOf('$("#playback-toggle").addEventListener'))+
    source.slice(source.indexOf('function returnToLive()'),source.indexOf("$('#programme-previous').addEventListener")),context);
  context.loadChannelReplay(true);
  const original=playback.current.position;
  context.seekPlayback(original+10);
  get('#player').onloadedmetadata();assert.equal(get('#player').currentTime,original+10);assert.equal(plays,1);
});
