const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const S=require('../web/schedule.js');
const source=fs.readFileSync(require.resolve('../web/app.js'),'utf8');

test('tuning keys and automatic focus do not reveal controls; mouse, Tab and pause do',()=>{
  const classes=new Set(),listeners=new Map(),windowKeys=[];
  let timer;
  const dialog={open:true,classList:{add:v=>classes.add(v),remove:v=>classes.delete(v),contains:v=>classes.has(v)},
    querySelector(){return null;},addEventListener(name,fn){listeners.set(name,fn);}};
  const player={paused:false,play(){this.paused=false;return Promise.resolve();},pause(){this.paused=true;}};
  const nodes={'#player-dialog':dialog,'#player':player,'#quick-label-panel':{hidden:true}};
  const context={$:id=>nodes[id],state:{playback:{loaded:true}},setTimeout(fn){timer=fn;return 1;},clearTimeout(){timer=null;},
    document:{activeElement:null,addEventListener(){}},window:{addEventListener(name,fn){if(name==='keydown')windowKeys.push(fn);}},
    fullscreenChanged(){},videoFillsScreen(){return true;},exitVideoView(){}};
  vm.runInNewContext('let cinemaHideTimer=null;'+source.slice(source.indexOf('function revealPlayerControls()'),source.indexOf('function exitVideoView()'))+
    source.slice(source.indexOf('for (const name of ["fullscreenchange"'),source.indexOf('function updatePlaybackControls()')),context);
  const key=key=>({key,code:key===' '?'Space':'',preventDefault(){},stopImmediatePropagation(){}});
  for(const name of ['ArrowUp','ArrowDown','1','2','Enter'])for(const fn of windowKeys)fn(key(name));
  assert.equal(classes.has('controls-visible'),false);assert.equal(listeners.has('focusin'),false);
  listeners.get('pointermove')();assert.equal(classes.has('controls-visible'),true);
  timer();assert.equal(classes.has('controls-visible'),false);
  for(const fn of windowKeys)fn(key('Tab'));assert.equal(classes.has('controls-visible'),true);
  context.hidePlayerControls();assert.equal(classes.has('controls-visible'),false);
  for(const fn of windowKeys)fn(key(' '));assert.equal(player.paused,true);assert.equal(classes.has('controls-visible'),true);
  timer();assert.equal(classes.has('controls-visible'),true,'paused playback stays visible');
  let entry;
  context.channelEntry={digits:'',timer:null};context.showChannelOsd=(...args)=>{entry=args;};context.commitChannelNumber=()=>{};
  vm.runInNewContext(source.slice(source.indexOf('function enterChannelDigit('),source.indexOf('// Channel controls also work')),context);
  context.enterChannelDigit('3');assert.equal(classes.has('controls-visible'),false);assert.deepEqual(entry,['3__','TUNING…',false]);
});

test('channel switching opens without controls and still shows the tuning overlay',()=>{
  let revealed,osd;
  const nodes={'#quick-label-panel':{dataset:{}},'#return-live':{},'#channel-down':{},'#channel-up':{}};
  const context={$:id=>nodes[id],state:{},closeQuickLabels(){},stopChaosTransition(){},timeline(){return {duration:60};},
    clearChannelEntry(){},selectGuideChannel(){},showPlayer(value){revealed=value;},syncGuidePreview(){},syncChannel(){},
    playableChannels(){return ['A','B'];},showChannelOsd(...args){osd=args;}};
  vm.runInNewContext(source.slice(source.indexOf('function tuneChannel('),source.indexOf('function previewVideo(')),context);
  context.tuneChannel('B');assert.equal(revealed,false);assert.equal(context.state.playback.mode,'channel');assert.deepEqual(osd,['002','B']);
});

test('episode replay progress uses episode bounds, and seeking crosses scheduled breaks without moving live time',()=>{
  const catalog={videos:[{id:'v',file:'Videos/v.mp4',type:'programme',channels:['A'],duration:240,episode_review:'multiple',episodes:[{title:'First',start:0,end:120},{title:'Second',start:120,end:240}],breaks_approved:true,break_points:[150]},
    {id:'ad',file:'Adverts/ad.mp4',type:'advert',channels:[],duration:10}],channels:[{name:'A',ad_interval:30,ad_length:10}],settings:{}};
  const line=S.buildCycle(catalog,'A','fixed',0);
  const block=line.blocks.find(b=>b.video.episode_index===1);
  const at=(block.start+5)*1000;
  const current=S.locate(line,at),playback={mode:'replay',line,current,cursor:at};
  const player={currentTime:125,duration:240,paused:true};let reloaded,joined=false;
  const context={state:{playback},$:id=>id==='#player'?player:{dataset:{}},Schedule:S,Date:{now:()=>10000000},
    loadChannelReplay(autoplay){reloaded=autoplay;},returnToLive(){joined=true;}};
  vm.runInNewContext(source.slice(source.indexOf('function playerProgress()'),source.indexOf('$("#playback-toggle").addEventListener')),context);
  const progress=context.playerProgress();assert.equal(progress.min,120);assert.equal(progress.max,240);
  context.seekPlayback(140);assert.equal(player.currentTime,140);assert.equal(reloaded,undefined);
  context.seekPlayback(180);assert.equal(reloaded,false,'seek across break preserves pause');
  const target=S.locate(line,playback.cursor);assert.equal(target.segment.advert,false);assert(Math.abs(target.position-180)<.01);assert.equal(joined,false);
});

test('viewer arrows scrub horizontally and tune vertically, including a focused progress bar',()=>{
  const nodes=new Map(),seek=[],tune=[];let handler;
  const get=id=>{if(!nodes.has(id))nodes.set(id,{hidden:true,open:false});return nodes.get(id);};
  get('#player-dialog').open=true;
  const context={$:get,state:{playback:{mode:'channel'}},document:{activeElement:null},window:{addEventListener:(name,fn)=>handler=fn},
    channelEntry:{digits:''},seekRelative:seconds=>seek.push(seconds),changeChannel:dir=>tune.push(dir)};
  vm.runInNewContext(source.slice(source.indexOf('window.addEventListener("keydown", event => {'),source.indexOf('$("#channel-down").addEventListener')),context);
  const press=(key,extra={})=>handler({key,preventDefault(){},stopImmediatePropagation(){},...extra});
  press('ArrowLeft');press('ArrowRight');press('ArrowUp');press('ArrowDown');
  assert.deepEqual(seek,[-10,10]);assert.deepEqual(tune,[1,-1]);
  context.document.activeElement=get('#preview-seek');context.document.activeElement.closest=()=>true;
  press('ArrowRight',{repeat:true});assert.deepEqual(seek,[-10,10,10]);
  context.document.activeElement={closest:()=>true};press('ArrowLeft');assert.equal(seek.length,3);
  context.document.activeElement=null;context.state.playback.mode='preview';press('ArrowLeft');press('ArrowUp');
  assert.deepEqual(seek,[-10,10,10,-10]);assert.deepEqual(tune,[1,-1]);
  get('#quick-label-panel').hidden=false;press('ArrowRight');assert.equal(seek.length,4);
});

function liveSeekFixture(paused=false) {
  const catalog={videos:[{id:'show',file:'Videos/show.mp4',type:'programme',channels:['A'],duration:300}],channels:[{name:'A',ad_length:0}],settings:{}};
  const line=S.buildCycle(catalog,'A','fixed',0),now=100000,current=S.locate(line,now);
  const playback={mode:'channel',channel:'A',current,loaded:true},player={currentTime:100,duration:300,paused};
  const loads=[],toasts=[];let joined=0;
  const context={state:{playback},$:id=>id==='#player'?player:{dataset:{}},Schedule:S,timeline:()=>line,Date:{now:()=>now},
    clearChannelEntry(){},loadChannelReplay:autoplay=>loads.push(autoplay),revealPlayerControls(){},showToast:t=>toasts.push(t),
    updatePlaybackControls(){},returnToLive(){joined++;}};
  vm.runInNewContext(source.slice(source.indexOf('function playerProgress()'),source.indexOf('$("#playback-toggle").addEventListener')),context);
  return {context,line,playback,player,loads,toasts,joined:()=>joined};
}
test('rewinding live starts personal replay without changing the channel clock and preserves pause',()=>{
  for(const paused of [false,true]) {
    const f=liveSeekFixture(paused),before=JSON.stringify(f.line);
    f.context.seekRelative(-10);
    assert.equal(f.context.state.playback.mode,'replay');assert.equal(f.context.state.playback.cursor,90000);
    assert.deepEqual(f.loads,[!paused]);assert.equal(JSON.stringify(f.line),before);
  }
});
test('forward seeking at live never advances the broadcast or restarts its playback',()=>{
  const f=liveSeekFixture();f.context.seekRelative(10);
  assert.equal(f.context.state.playback,f.playback);assert.equal(f.joined(),0);assert.equal(f.loads.length,0);
  assert.match(f.toasts[0],/already watching live/);
});
test('paused live progress and seeking retain the loaded programme across the next loop',()=>{
  const f=liveSeekFixture(true);f.context.Date.now=()=>400000;f.context.timeline=()=>({...f.line,anchor:300000});
  assert.equal(f.context.playerProgress().value,100);
  f.context.seekPlayback(90);assert.equal(f.context.state.playback.cursor,90000);
});
