/* Constant per-file loudness gain; HTML video retains mute, volume and timing. */
(() => {
  'use strict';
  function gainFor(item, enabled = true, profile = 'standard') {
    const measured = item?.audio_analysis;
    if (!enabled || measured?.status !== 'ready' || measured.version !== 1
        || !item.fingerprint || measured.fingerprint !== item.fingerprint
        || !Number.isFinite(measured.gain_db)) return 1;
    // Recheck peak headroom at playback instead of trusting a cached gain alone.
    if (!Number.isFinite(measured.true_peak_db)) return 1;
    if (profile === 'balanced' && !Number.isFinite(measured.integrated_lufs)) return 1;
    const requested = profile === 'balanced' ? -20-measured.integrated_lufs : measured.gain_db;
    const boost = profile === 'balanced' ? 6 : 12;
    return 10 ** (Math.max(-60,Math.min(boost,requested,-1.5-measured.true_peak_db)) / 20);
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {gainFor};
  if (typeof document === 'undefined') return;
  let context, enabled = true, profile = 'standard', staticVoice = null;
  const player = document.querySelector('#player');
  const preview = document.querySelector('#guide-preview-video');
  player?.addEventListener('volumechange',()=>{
    if (staticVoice) staticVoice.output.gain.setValueAtTime(player.muted ? 0 : player.volume,context.currentTime);
  });
  const displays = [player,preview].filter(Boolean).map(video=>({video,track:null,gain:null,source:null,failed:false,lastKey:''}));
  function ensure(display) {
    if (display.source || display.failed || !enabled) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) { display.failed = true; return; }
    try {
      context ||= new AudioContext();
      display.source = context.createMediaElementSource(display.video);
      display.gain = context.createGain();
      display.source.connect(display.gain);
      display.gain.connect(context.destination);
    } catch (_) {
      display.failed = true;
      display.source?.connect(context.destination);
    }
  }
  function update(display, immediate = false) {
    const {gain,track} = display;
    if (!gain || !context) return;
    const target = gainFor(track,enabled,profile), now = context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value,now);
    if (immediate) gain.gain.setValueAtTime(target,now);
    else gain.gain.linearRampToValueAtTime(target,now + .15);
  }
  function unlock() {
    displays.filter(display=>display.track).forEach(ensure);
    if (context?.state === 'suspended') context.resume().catch(() => {});
  }
  document.addEventListener('pointerdown', () => { if (context) unlock(); },{passive:true});
  document.addEventListener('keydown', () => { if (context) unlock(); });
  displays.forEach(display=>display.video.addEventListener('play', unlock));
  // The player slider controls listening volume in both views; mute stays local.
  if (preview) {
    preview.volume = player.volume;
    player.addEventListener('volumechange',()=>{preview.volume=player.volume;});
  }
  window.USBTvAudio = {
    gainFor, unlock,
    playStatic(durationMs = 320) {
      if (!player || player.muted || player.volume <= 0) return;
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      try {
        context ||= new AudioContext();
        if (context.state === 'suspended') context.resume().catch(() => {});
        const duration = Math.max(.08,Math.min(.4,durationMs/1000));
        const noise = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
        const samples = noise.getChannelData(0);
        let low=0,bass=0,crackle=0;
        const bassRate=1-Math.exp(-2*Math.PI*180/context.sampleRate);
        const crackleDecay=Math.exp(-1/(context.sampleRate*.0015));
        // Band-limited RF hiss with irregular short dropouts and tiny contact
        // crackles. The receiver's bandwidth narrows as the signal settles.
        const flutter=Math.random()*Math.PI*2;
        for (let i=0;i<samples.length;i++) {
          const t=i/context.sampleRate, progress=t/duration;
          const cutoff=6200-4200*progress;
          low+=(1-Math.exp(-2*Math.PI*cutoff/context.sampleRate))*(Math.random()*2-1-low);
          bass+=bassRate*(low-bass);
          crackle*=crackleDecay;
          if (Math.random()<18/context.sampleRate) crackle+=(Math.random()*2-1)*.28*(1-progress);
          const flutterGain=.74+.16*Math.sin(t*97+flutter)+.1*Math.sin(t*231+flutter);
          const contact=.13*Math.exp(-t*180)*Math.sin(2*Math.PI*145*t);
          samples[i]=Math.max(-.9,Math.min(.9,(low-bass)*flutterGain+crackle+contact));
        }
        const source=context.createBufferSource(), gain=context.createGain(), output=context.createGain(), now=context.currentTime;
        if (staticVoice) {
          staticVoice.gain.gain.cancelScheduledValues(now);
          staticVoice.gain.gain.setValueAtTime(staticVoice.gain.gain.value,now);
          staticVoice.gain.gain.linearRampToValueAtTime(0,now+.008);
          staticVoice.source.stop(now+.008);
        }
        source.buffer=noise; source.connect(gain);gain.connect(output);output.connect(context.destination);
        output.gain.setValueAtTime(player.volume,now);
        gain.gain.setValueAtTime(0,now);
        // Filtered noise has much less energy than the old white-noise burst.
        // Keep it audible beside programme audio, with a bounded peak and tail.
        gain.gain.linearRampToValueAtTime(.30,now+.006);
        gain.gain.linearRampToValueAtTime(.22,now+duration*.25);
        gain.gain.linearRampToValueAtTime(.06,now+duration*.72);
        gain.gain.linearRampToValueAtTime(0,now+duration);
        const voice={source,gain,output};staticVoice=voice;
        source.onended=()=>{source.disconnect();gain.disconnect();output.disconnect();if(staticVoice===voice)staticVoice=null;};
        source.start(now); source.stop(now+duration);
      } catch (_) { /* Unsupported audio must never prevent tuning. */ }
    },
    setProfile(value) {
      profile = value === 'balanced' ? 'balanced' : 'standard';
      displays.forEach(display=>update(display));
    },
    setEnabled(value) {
      enabled = Boolean(value);
      displays.forEach(display=>{if(display.track)ensure(display);update(display);});
    },
    setTrack(item, video = player) {
      const display = displays.find(display=>display.video===video);
      if (!display) return;
      const previous = display.track;
      display.track = item;
      const key = `${item?.id}:${item?.fingerprint}:${item?.audio_analysis?.gain_db}:${item?.audio_analysis?.integrated_lufs}:${item?.audio_analysis?.true_peak_db}`;
      const changed = key !== display.lastKey; display.lastKey = key;
      if (item) ensure(display);
      if (changed) update(display, previous?.id !== item?.id || previous?.fingerprint !== item?.fingerprint);
    },
    suspended() { return context?.state === 'suspended'; },
    supported() { return !displays.some(display=>display.failed) && Boolean(window.AudioContext || window.webkitAudioContext); }
  };
})();
