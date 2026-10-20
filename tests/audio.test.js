const {test} = require('node:test');
const assert = require('node:assert/strict');
const {gainFor} = require('../web/audio.js');
const fs = require('node:fs');
const vm = require('node:vm');
const item = gain_db => ({fingerprint:'abc',audio_analysis:{version:1,fingerprint:'abc',status:'ready',gain_db,true_peak_db:-30,integrated_lufs:-24}});
test('measured decibels become playback gain and disabling returns original levels',()=>{
  assert(Math.abs(gainFor(item(6))-1.995262)<.00001);
  assert(Math.abs(gainFor(item(-6))-.501187)<.00001);
  assert.equal(gainFor(item(6),false),1);
});
test('unmeasured, silent, failed and replaced files retain original levels',()=>{
  assert.equal(gainFor(null),1);
  assert.equal(gainFor({}),1);
  assert.equal(gainFor({...item(6),fingerprint:'changed'}),1);
  for(const status of ['silent','no_audio','failed']){
    const video=item(6);video.audio_analysis.status=status;assert.equal(gainFor(video),1);
  }
  assert.equal(gainFor(item(NaN)),1);
});
test('playback gain rejects excessive boosts',()=>{
  assert.equal(gainFor(item(100)),gainFor(item(12)));
});

test('playback rechecks cached gain against true-peak headroom and rejects incomplete measurements',()=>{
  const clip=item(12);clip.audio_analysis.true_peak_db=-2;
  assert(Math.abs(gainFor(clip)-10**(.5/20))<1e-10);
  clip.audio_analysis.true_peak_db=-.5;
  assert(Math.abs(gainFor(clip)-10**(-1/20))<1e-10);
  delete clip.audio_analysis.true_peak_db;assert.equal(gainFor(clip),1);
  clip.audio_analysis.true_peak_db=NaN;assert.equal(gainFor(clip),1);
  assert.equal(gainFor(item(12),false),1);
});

test('balanced trial reduces loud files, boosts quiet files moderately and respects peaks using existing measurements',()=>{
  const loud=item(-9);loud.audio_analysis.integrated_lufs=-9;loud.audio_analysis.true_peak_db=-.5;
  assert(Math.abs(gainFor(loud,true,'balanced')-10**(-11/20))<1e-10);
  const quiet=item(12);quiet.audio_analysis.integrated_lufs=-40;
  assert(Math.abs(gainFor(quiet,true,'balanced')-10**(6/20))<1e-10);
  quiet.audio_analysis.true_peak_db=-2;
  assert(Math.abs(gainFor(quiet,true,'balanced')-10**(.5/20))<1e-10);
  assert.equal(gainFor(quiet,false,'balanced'),1);
  delete quiet.audio_analysis.integrated_lufs;assert.equal(gainFor(quiet,true,'balanced'),1);
  assert.equal(gainFor(loud),gainFor(loud,true,'standard'));
});

test('guide preview and full player share levelling and volume but keep independent tracks and mute',async()=>{
  function video() {
    const listeners=new Map();
    return {volume:1,muted:false,addEventListener(name,fn){listeners.set(name,fn);},emit(name){listeners.get(name)?.();}};
  }
  const player=video(),preview=video(),routes=new Map();
  let contexts=0, sources=0;
  class AudioContext {
    constructor(){contexts++;this.currentTime=0;this.state='suspended';this.destination={};}
    createGain(){return {gain:{value:1,cancelScheduledValues(){},setValueAtTime(value){this.value=value;},linearRampToValueAtTime(value){this.value=value;}},connect(){}};}
    createMediaElementSource(element){sources++;return {connect(gain){routes.set(element,gain);}};}
    resume(){this.state='running';return Promise.resolve();}
  }
  const window={AudioContext};
  const document={querySelector:id=>id==='#player'?player:preview,addEventListener(){}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../web/audio.js'),'utf8'),{window,document});
  const api=window.USBTvAudio,clip=item(-9);
  api.setTrack(clip,preview);api.setTrack(clip);
  assert.equal(sources,0,'suspended audio must not capture either media element');
  api.unlock(); await Promise.resolve();
  assert.equal(contexts,1);assert.equal(sources,2);
  assert.equal(routes.get(player).gain.value,gainFor(clip));
  assert.equal(routes.get(preview).gain.value,gainFor(clip));
  player.volume=.3;player.muted=true;player.emit('volumechange');
  assert.equal(preview.volume,.3);assert.equal(preview.muted,false);
  preview.muted=true;player.muted=false;player.emit('volumechange');assert.equal(preview.muted,true);
  api.setTrack(item(6),preview);
  assert.equal(routes.get(player).gain.value,gainFor(clip));
  assert.equal(routes.get(preview).gain.value,gainFor(item(6)));
  api.setProfile('balanced');
  assert.equal(routes.get(player).gain.value,gainFor(clip,true,'balanced'));
  assert.equal(routes.get(preview).gain.value,gainFor(item(6),true,'balanced'));
  api.setProfile('standard');
  assert.equal(routes.get(player).gain.value,gainFor(clip));
  api.setEnabled(false);
  assert.equal(routes.get(player).gain.value,1);assert.equal(routes.get(preview).gain.value,1);
  api.setEnabled(true);
  assert.equal(routes.get(player).gain.value,gainFor(clip));
  assert.equal(routes.get(preview).gain.value,gainFor(item(6)));
  assert.equal(sources,2,'toggling does not create duplicate media sources');
  assert.equal(api.suspended(),false);preview.emit('play');assert.equal(sources,2);
});

test('live guide supplies saved audio measurements even when its schedule snapshot omits them',()=>{
  const frozen={id:'v',file:'Videos/v.mp4',genres:[]},measured={...frozen,...item(-8)};
  const calls=[],nodes=new Map();
  const get=id=>{
    if(!nodes.has(id))nodes.set(id,{classList:{toggle(){},contains(){return true;}},open:false,load(){}});
    return nodes.get(id);
  };
  const context={$:get,state:{catalog:{videos:[measured]}},guidePreview:{channel:'A',key:null},
    Schedule:{locate:()=>({segment:{video:frozen},block:{video:frozen},key:'segment',start:0,end:60000})},
    timeline(){},document:{hidden:false},displayTitle:()=>'',formatTime:()=>'',videoUrl:file=>'/'+file,
    window:{USBTvAudio:{setTrack:(...args)=>calls.push(args)}}};
  const app=fs.readFileSync(require.resolve('../web/app.js'),'utf8');
  vm.runInNewContext(app.slice(app.indexOf('function syncGuidePreview()'),app.indexOf('const libraryView =')),context);
  context.syncGuidePreview();
  assert.equal(calls[0][0],measured);assert.equal(calls[0][1],get('#guide-preview-video'));
});

test('advanced audio switches mirror the saved setting and change sound without scanning or interrupting playback',async()=>{
  const nodes=new Map(),calls=[],events=new Map();
  const get=id=>{
    if(!nodes.has(id))nodes.set(id,{checked:true,addEventListener:(name,fn)=>events.set(id,fn)});
    return nodes.get(id);
  };
  const context={$:get,state:{catalog:{settings:{volume_levelling:true}}},
    window:{USBTvAudio:{setProfile:value=>calls.push(['profile',value]),setEnabled:value=>calls.push(['audio',value]),unlock:()=>calls.push(['unlock'])}},
    refreshPlaybackAudio(){},async saveCatalog(){calls.push(['save',context.state.catalog.settings.volume_levelling]);},
    async refreshAudioStatus(){},showToast(){},rescan(){throw Error('An audio comparison must not start a scan');}};
  const app=fs.readFileSync(require.resolve('../web/app.js'),'utf8');
  vm.runInNewContext(app.slice(app.indexOf('function applyAudioSetting()'),app.indexOf('function refreshPlaybackAudio()'))+
    app.slice(app.indexOf('async function changeVolumeLevelling('),app.indexOf("$('#auto-imports').addEventListener")),context);
  await events.get('#player-volume-levelling')({target:{checked:false}});
  for(const id of ['volume-levelling','advanced-volume-levelling','player-volume-levelling'])assert.equal(get('#'+id).checked,false);
  await events.get('#advanced-volume-levelling')({target:{checked:true}});
  for(const id of ['volume-levelling','advanced-volume-levelling','player-volume-levelling'])assert.equal(get('#'+id).checked,true);
  assert.deepEqual(calls.filter(call=>call[0]==='audio'),[['audio',false],['audio',true]]);
  assert.deepEqual(calls.filter(call=>call[0]==='save'),[['save',false],['save',true]]);
  await events.get('#player-volume-profile')({target:{value:'balanced'}});
  assert.equal(context.state.catalog.settings.volume_profile,'balanced');
  for(const id of ['volume-profile','advanced-volume-profile','player-volume-profile'])assert.equal(get('#'+id).value,'balanced');
  assert.equal(calls.filter(call=>call[0]==='profile').at(-1)[1],'balanced');
  const html=fs.readFileSync(require.resolve('../web/index.html'),'utf8');
  assert.match(html,/<label[^>]*data-advanced[^>]*hidden[^>]*><input id="player-volume-levelling"/);
  assert.match(html,/<div[^>]*data-advanced[^>]*hidden[^>]*><label[^>]*><input id="advanced-volume-levelling"/);
});

test('audio status distinguishes cached playback from new FFmpeg measurements',()=>{
  const source=fs.readFileSync(require.resolve('../web/app.js'),'utf8'),context={};
  vm.runInNewContext(source.slice(source.indexOf('function audioStatusMessage('),source.indexOf('async function refreshAudioStatus(')),context);
  const status={available:false,checked:6,total:7,enabled:true};
  assert.match(context.audioStatusMessage(status,true),/Saved levels are applied/);
  assert.match(context.audioStatusMessage(status,true),/New measurements need FFmpeg/);
  assert.match(context.audioStatusMessage({...status,enabled:false},true),/Levelling is off/);
  assert.match(context.audioStatusMessage({...status,checked:0},true),/original levels/);
  assert.match(context.audioStatusMessage({...status,total:0,checked:0},true),/No files/);
  assert.match(context.audioStatusMessage(status,false),/browser cannot/);
});
