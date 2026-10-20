const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../web/app.js'),'utf8');
const settle=()=>new Promise(resolve=>setImmediate(resolve));

function fixture(play) {
  const nodes=new Map(),seeks=[];let attempts=0,position=12;
  const get=id=>{
    if(!nodes.has(id))nodes.set(id,{hidden:true,open:false,classList:{toggle(){},contains:()=>true},
      setAttribute(){},querySelector:()=>({toggleAttribute(){}}),events:{},addEventListener(name,fn){this.events[name]=fn;}});
    return nodes.get(id);
  };
  const player=get('#guide-preview-video');
  Object.assign(player,{paused:true,muted:false,currentTime:0,seeking:false,play(){attempts++;return play(player,attempts);}});
  const video={id:'v',file:'Videos/v.mp4',genres:[]};
  const context={$:get,guidePreview:{channel:'A',key:'A:segment',loaded:true,blocked:false},
    state:{catalog:{videos:[video]}},document:{hidden:false},window:{USBTvAudio:{setTrack(){},suspended:()=>false,unlock(){}}},
    Schedule:{locate:()=>({segment:{video},block:{video},key:'segment',position,start:0,end:60000})},
    timeline(){},displayTitle:()=>'',formatTime:()=>'',videoUrl:String,seekToLive(value){seeks.push(value);player.currentTime=value;}};
  vm.runInNewContext(source.slice(source.indexOf('function updateGuideAudioControls()'),source.indexOf('const libraryView =')),context);
  vm.runInNewContext(source.slice(source.indexOf('$("#preview-watch").addEventListener'),source.indexOf('$("#guide-preview-video").addEventListener("error"')),context);
  return {context,player,get,seeks,attempts:()=>attempts,setPosition:value=>position=value};
}

test('blocked audible autoplay falls back to smooth muted playback, then enables sound on click',async()=>{
  const f=fixture((player)=>{
    if(!player.muted)return Promise.reject(Object.assign(new Error('gesture required'),{name:'NotAllowedError'}));
    player.paused=false;return Promise.resolve();
  });
  f.context.syncGuidePreview();await settle();
  assert.equal(f.attempts(),2);assert.equal(f.player.muted,true);assert.equal(f.player.paused,false);
  assert.equal(f.get('#preview-play').hidden,false);assert.equal(f.get('#preview-play').textContent,'ENABLE SOUND');
  for(let i=0;i<8;i++)f.context.syncGuidePreview();
  assert.equal(f.seeks.length,1);assert.equal(f.attempts(),2);
  f.get('#preview-play').events.click();
  assert.equal(f.player.muted,false);assert.equal(f.get('#preview-play').hidden,true);
  f.get('#preview-mute').events.click();
  assert.equal(f.player.muted,true);assert.equal(f.player.paused,false);assert.equal(f.attempts(),2);
});

test('fully blocked playback stays still instead of seeking every sync tick',async()=>{
  const f=fixture(()=>Promise.reject(Object.assign(new Error('blocked'),{name:'NotAllowedError'})));
  f.context.syncGuidePreview();await settle();
  for(let i=0;i<8;i++){f.setPosition(20+i);f.context.syncGuidePreview();}
  assert.equal(f.context.guidePreview.blocked,true);assert.equal(f.seeks.length,1);assert.equal(f.attempts(),2);
});

test('pending startup playback is not restarted or repeatedly sought',async()=>{
  let resolve;
  const f=fixture(player=>new Promise(done=>{resolve=()=>{player.paused=false;done();};}));
  f.context.syncGuidePreview();
  for(let i=0;i<8;i++){f.setPosition(20+i);f.context.syncGuidePreview();}
  assert.equal(f.attempts(),1);assert.equal(f.seeks.length,1);
  resolve();await settle();assert.equal(f.context.guidePreview.starting,false);
});
