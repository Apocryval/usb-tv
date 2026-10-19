const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
test('static sound honours mute and volume without requiring loudness levelling',()=>{
  const player={volume:.5,muted:true,addEventListener(){}},ramps=[];
  let starts=0,contexts=0;
  class AudioContext {
    constructor(){contexts++;this.sampleRate=100;this.currentTime=2;this.destination={};}
    createBuffer(){return {getChannelData:()=>new Float32Array(15)};}
    createBufferSource(){return {connect(){},disconnect(){},start(){starts++;},stop(){}};}
    createGain(){return {connect(){},disconnect(){},gain:{setValueAtTime(){},linearRampToValueAtTime(value){ramps.push(value);}}};}
  }
  const context={window:{AudioContext},document:{querySelector:selector=>selector==='#player'?player:null,addEventListener(){}}};
  vm.runInNewContext(fs.readFileSync('web/audio.js','utf8'),context);
  const audio=context.window.USBTvAudio;
  audio.setEnabled(false);audio.playStatic();assert.equal(contexts,0);
  player.muted=false;player.volume=0;audio.playStatic();assert.equal(contexts,0);
  player.volume=.5;audio.playStatic();assert.equal(starts,1);assert.deepEqual(ramps,[.0225,0]);
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
