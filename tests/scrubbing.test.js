const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const S=require('../web/schedule.js');
const source=fs.readFileSync(require.resolve('../web/app.js'),'utf8');

function fixture(catalog,choose,mode='channel') {
  const line=S.buildCycle(catalog,'A','fixed',1792520000123);
  const block=line.blocks.find(choose);
  const at=line.anchor+(block.start+.5)*1000;
  const current=S.locate(line,at);
  const player={currentTime:current.position,duration:999,paused:false};
  const playback={mode,channel:'A',line,current,cursor:at,loaded:true};
  const state={playback};
  const context={state,$:id=>id==='#player'?player:{dataset:{}},Schedule:S,timeline:()=>line,Date:{now:()=>at+1000000},
    clearChannelEntry(){},revealPlayerControls(){},showToast(){},updatePlaybackControls(){},
    returnToLive(){assert.fail('Seeking to programme start must not return to live');},
    loadChannelReplay(){state.playback.current=S.locate(line,state.playback.cursor);state.playback.loaded=false;}};
  vm.runInNewContext(source.slice(source.indexOf('function playerProgress()'),source.indexOf('$("#playback-toggle").addEventListener')),context);
  return {context,state,line,block,player};
}
const programme=(id,duration,extra={})=>({id,file:`Videos/${id}.mp4`,duration,type:'programme',channels:['A'],...extra});
const catalog={videos:[programme('a',1+3/37),programme('b',1+4/37),programme('c',1+5/37)],channels:[{name:'A',ad_length:0}],settings:{}};

for(const mode of ['channel','replay'])test(`${mode}: dragging repeatedly to zero stays in the selected video`,()=>{
  const f=fixture(catalog,b=>b.video.id==='b',mode);
  // This exact boundary used to locate the final instant of video a.
  assert.equal(S.locate(f.line,f.state.playback.current.start).block.video.id,'a');
  const original=JSON.stringify(f.line);
  for(let index=0;index<10;index++) {
    f.context.seekPlayback(0);
    const located=S.locate(f.line,f.state.playback.cursor);
    assert.equal(located.block.video.id,'b');assert(located.position>=0 && located.position<.001);
    assert.equal(f.context.playerProgress().min,0);
  }
  assert.equal(JSON.stringify(f.line),original);
});

test('episode start clamps to the current episode rather than the preceding episode',()=>{
  const c={...catalog,videos:[programme('episodes',240.3,{episode_review:'multiple',episodes:[
    {title:'First',start:0,end:120.1},{title:'Second',start:120.1,end:240.3}]})]};
  const f=fixture(c,b=>b.video.episode_index===1,'replay');
  f.context.seekPlayback(0);
  const located=S.locate(f.line,f.state.playback.cursor);
  assert.equal(located.block.video.episode_index,1);assert(Math.abs(located.position-120.1)<.001);
});

test('scrubbing to a programme segment after a break does not land in the advert',()=>{
  const c={videos:[programme('show',100,{breaks_approved:true,break_points:[30.1]}),programme('ad',10.3,{type:'advert',channels:[]})],
    channels:[{name:'A',ad_interval:30,ad_length:10}],settings:{}};
  const f=fixture(c,()=>true,'replay');
  f.context.seekPlayback(30.1);
  const located=S.locate(f.line,f.state.playback.cursor);
  assert.equal(located.segment.advert,false);assert.equal(located.segment.video.id,'show');
  assert(Math.abs(located.position-30.1)<.001);
});
