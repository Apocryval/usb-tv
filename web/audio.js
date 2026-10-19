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
  let context, enabled = true, profile = 'standard';
  const player = document.querySelector('#player');
  const preview = document.querySelector('#guide-preview-video');
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
    playStatic() {
      if (!player || player.muted || player.volume <= 0) return;
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      try {
        context ||= new AudioContext();
        if (context.state === 'suspended') context.resume().catch(() => {});
        const duration = .15, noise = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
        const samples = noise.getChannelData(0);
        for (let i=0;i<samples.length;i++) samples[i]=Math.random()*2-1;
        const source=context.createBufferSource(), gain=context.createGain(), now=context.currentTime;
        source.buffer=noise; source.connect(gain); gain.connect(context.destination);
        gain.gain.setValueAtTime(0,now);
        gain.gain.linearRampToValueAtTime(.045*player.volume,now+.01);
        gain.gain.linearRampToValueAtTime(0,now+duration);
        source.onended=()=>{source.disconnect();gain.disconnect();};
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
