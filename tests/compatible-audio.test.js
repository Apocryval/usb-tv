const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/compatible-audio.js','utf8');
function fixture() {
  const nodes=new Map();
  const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,addEventListener(name,fn){this[name]=fn;}});return nodes.get(id);};
  let video={id:'one',file:'Videos/movie.mkv',fingerprint:'original',technical:{audio_codec:'eac3'}};
  const media={id:'player',src:'http://localhost/Videos/movie.mkv',currentTime:22,paused:true,duration:60,
    hasAttribute:()=>true,addEventListener(name,fn){this[name]=fn;},load(){this.loads=(this.loads||0)+1;},pause(){this.paused=true;},play(){this.paused=false;return Promise.resolve();}};
  let sourceUrl=media.src;
  Object.defineProperty(media,'src',{get:()=>sourceUrl,set:value=>{sourceUrl=new URL(value,'http://localhost/').href;}});
  const calls=[],timers=[],responses=[];
  const context={URL,location:{href:'http://localhost/'},document:{querySelector:node,querySelectorAll:()=>[media]},
    setTimeout(fn){timers.push(fn);return timers.length;},clearTimeout(){}};
  vm.runInNewContext(source,context);
  const api=context.USBTvCompatibleAudio;
  api.configure({getVideo:()=>video,record:()=>video,isLive:()=>false,url:file=>'/'+file+api.query(file),
    async api(path,options){calls.push({path,options});return {ok:true,status:200,json:async()=>responses.shift()};}});
  return {api,node,media,calls,timers,responses,setVideo:v=>{video=v;},video};
}
const flush=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
test('prepares once, polls, reloads ready audio at the same paused position, and reuses it',async()=>{
  const f=fixture();f.responses.push({state:'idle',file:f.video.file,available:true,required_bytes:1000});
  f.api.sync();await flush();assert.equal(f.node('#prepare-playback-audio').disabled,false);
  assert.match(f.node('#compatible-audio-status').textContent,/1 MB extra space/);
  f.responses.push({state:'preparing',file:f.video.file,available:true});
  f.node('#prepare-playback-audio').click();await flush();
  assert.equal(f.calls[1].options.method,'POST');assert.equal(f.node('#prepare-playback-audio').disabled,true);
  f.responses.push({state:'ready',file:f.video.file,available:true});f.timers.shift()();await flush();
  assert.equal(f.api.query(f.video.file),'?audio=compatible');assert.equal(f.media.loads,1);
  f.media.currentTime=0;f.media.loadedmetadata();assert.equal(f.media.currentTime,22);assert.equal(f.media.paused,true);
  f.api.sync();assert.equal(f.calls.length,3);assert.equal(f.node('#prepare-playback-audio').hidden,true);
});
test('a result for a replaced source cannot switch or mark the replacement ready',async()=>{
  const f=fixture();f.responses.push({state:'ready',file:f.video.file,available:true});
  f.api.sync();f.setVideo({...f.video,fingerprint:'replacement'});await flush();
  assert.equal(f.api.query(f.video.file),'');assert.equal(f.media.loads,undefined);
});
test('normal audio is left alone and missing tools give an actionable disabled control',async()=>{
  const f=fixture();f.setVideo({...f.video,technical:{audio_codec:'aac'}});f.api.sync();
  assert.equal(f.calls.length,0);assert.equal(f.node('#compatible-audio-controls').hidden,true);
  f.setVideo(f.video);f.responses.push({state:'idle',file:f.video.file,available:false});f.api.sync();await flush();
  assert.equal(f.node('#prepare-playback-audio').disabled,true);
  assert.match(f.node('#compatible-audio-status').textContent,/FFmpeg/);
});

test('moving to another source folder invalidates ready audio even when catalogue metadata matches',async()=>{
  const f=fixture();f.responses.push({state:'ready',file:f.video.file,available:true});
  f.api.sync();await flush();assert.equal(f.api.query(f.video.file),'?audio=compatible');
  f.setVideo({...f.video,scan_source:'/another/library/movie.mkv'});
  assert.equal(f.api.query(f.video.file),'','the same relative filename can refer to a different source');
});
