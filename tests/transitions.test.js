const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');

test('analogue tuning follows live mute and replaces a previous burst without stacking',()=>{
  const events={},sources=[],gains=[],buffers=[];
  const player={volume:.4,muted:false,addEventListener:(n,f)=>events[n]=f};
  class AudioContext {
    constructor(){this.sampleRate=48000;this.currentTime=1;this.destination={};}
    createBuffer(channels,length){const data=new Float32Array(length);buffers.push(data);return {getChannelData:()=>data};}
    createBufferSource(){const source={stops:[],connect(){},disconnect(){},start(){},stop(t){this.stops.push(t);}};sources.push(source);return source;}
    createGain(){const node={connect(){},disconnect(){},gain:{value:0,cancelScheduledValues(){},setValueAtTime(v){this.value=v;},linearRampToValueAtTime(){}}};gains.push(node);return node;}
  }
  const context={window:{AudioContext},document:{querySelector:s=>s==='#player'?player:null,addEventListener(){}}};
  vm.runInNewContext(fs.readFileSync('web/audio.js','utf8'),context);
  context.window.USBTvAudio.playStatic(320);
  assert.equal(buffers[0].length,15360);assert(buffers[0].every(v=>Number.isFinite(v)&&Math.abs(v)<=.9));
  assert.equal(gains[1].gain.value,.4);
  player.muted=true;events.volumechange();assert.equal(gains[1].gain.value,0);
  player.muted=false;player.volume=.2;events.volumechange();assert.equal(gains[1].gain.value,.2);
  context.window.USBTvAudio.playStatic(150);
  assert.equal(buffers[1].length,7200);assert.equal(sources[0].stops.at(-1),1.008);
  sources[0].onended();player.muted=true;events.volumechange();assert.equal(gains[3].gain.value,0);
  sources[1].onended();
});
test('static sound honours mute and volume without requiring loudness levelling',()=>{
  const player={volume:.5,muted:true,addEventListener(){}},ramps=[];
  let starts=0,contexts=0;
  class AudioContext {
    constructor(){contexts++;this.sampleRate=100;this.currentTime=2;this.destination={};}
    createBuffer(channels,length){return {getChannelData:()=>new Float32Array(length)};}
    createBufferSource(){return {connect(){},disconnect(){},start(){starts++;},stop(){}};}
    createGain(){return {connect(){},disconnect(){},gain:{value:0,cancelScheduledValues(){},setValueAtTime(){},linearRampToValueAtTime(value){ramps.push(value);}}};}
  }
  const context={window:{AudioContext},document:{querySelector:selector=>selector==='#player'?player:null,addEventListener(){}}};
  vm.runInNewContext(fs.readFileSync('web/audio.js','utf8'),context);
  const audio=context.window.USBTvAudio;
  audio.setEnabled(false);audio.playStatic();assert.equal(contexts,0);
  player.muted=false;player.volume=0;audio.playStatic();assert.equal(contexts,0);
  player.volume=.5;audio.playStatic();assert.equal(starts,1);assert(ramps.every(v=>v>=0&&v<=.30));assert.equal(ramps.at(-1),0);
  audio.playStatic();assert.equal(contexts,1);
});
test('static visual is brief, throttled and respects reduced motion',()=>{
  let now=0,sounds=0,frames=0,callback;
  const canvas={hidden:true,getContext:()=>({createImageData:()=>({data:new Uint8Array(160*90*4)}),putImageData(){}})};
  const context={window:{USBTvAudio:{playStatic(){sounds++;}}},document:{querySelector:()=>canvas},
    performance:{now:()=>now},matchMedia:()=>({matches:true}),setTimeout:fn=>{callback=fn;return 1;},clearTimeout(){},
    cancelAnimationFrame(){},requestAnimationFrame(){frames++;}};
  vm.runInNewContext(fs.readFileSync('web/transitions.js','utf8'),context);
  context.window.USBTvTransition.play();assert.equal(canvas.hidden,false);assert.equal(sounds,1);assert.equal(frames,0);
  now=50;context.window.USBTvTransition.play();assert.equal(sounds,1);
  callback();assert.equal(canvas.hidden,true);
  now=200;context.window.USBTvTransition.play();assert.equal(sounds,2);
});

test('GPU tuning replaces Canvas snow and stops after its brief lock-on interval',()=>{
  let duration=0,stops=0,sounds=0,finish;
  const canvas={hidden:true,getContext(){throw new Error('Canvas fallback should not run');}};
  const context={window:{USBTvCRT:{startTuning(ms){duration=ms;return true;},stopTuning(){stops++;}},USBTvAudio:{playStatic(){sounds++;}}},
    document:{querySelector:()=>canvas},performance:{now:()=>100},matchMedia:()=>({matches:false}),
    setTimeout:(fn,ms)=>{assert.equal(ms,320);finish=fn;},clearTimeout(){},cancelAnimationFrame(){}};
  vm.runInNewContext(fs.readFileSync('web/transitions.js','utf8'),context);
  context.window.USBTvTransition.play();assert.equal(duration,320);assert.equal(canvas.hidden,true);assert.equal(sounds,1);
  finish();assert.equal(stops,2);
});
