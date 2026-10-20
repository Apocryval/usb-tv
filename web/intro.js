// Self-contained station ident. No network assets or audio files required.
(() => {
  const screen = document.querySelector('#startup');
  const shell = document.querySelector('.shell');
  const canvas = document.querySelector('#startup-noise');
  const soundButton = document.querySelector('#startup-sound');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let frame, revealTimer, endTimer, audio, finished = false, lastFrame = 0, booted = false, theme = 'satellite';
  const identities = {
    satellite: {title: 'USB.tv', tagline: 'YOUR PERSONAL BROADCAST', caption: 'TRANSMITTING FROM SOMEWHERE ELSE'},
    teletext: {title: 'USB TEXT', tagline: 'P100 · YOUR PERSONAL BROADCAST', caption: 'PLEASE WAIT · ACQUIRING PAGE 100'},
    goblin: {title: 'GOBLIN CABLE', tagline: 'BROADCASTING UNDER THE FLOORBOARDS', caption: 'A SIGNAL FROM THE MOSS AND MURK'},
  };
  screen.hidden = false;
  shell.inert = true;
  soundButton.disabled = true;
  soundButton.textContent = 'TUNING IN…';
  // The catalogue is loaded by app.js, once, before selecting this ident.
  // A slow USB must not play a Satellite ident before its saved theme arrives.
  // Skip/Escape stay available; load failures are handled by app.js.
  const themeTimeout = setTimeout(() => { soundButton.textContent = 'READING LIBRARY…'; }, 4000);
  const context = canvas.getContext('2d');
  canvas.width = 240; canvas.height = 150;
  const pixels = context?.createImageData(canvas.width, canvas.height);
  function noise(time) {
    if (finished || screen.classList.contains('reveal')) return;
    if (pixels && time - lastFrame > 80) {
      for (let i = 0; i < pixels.data.length; i += 4) {
        const level = 45 + Math.random() * 150;
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = level;
        pixels.data[i + 3] = 255;
      }
      context.putImageData(pixels, 0, 0); lastFrame = time;
    }
    frame = requestAnimationFrame(noise);
  }
  function closeAudio() {
    if (audio) { audio.close().catch(() => {}); audio = null; }
  }
  function finish() {
    if (finished) return;
    finished = true;
    clearTimeout(themeTimeout);
    clearTimeout(revealTimer); clearTimeout(endTimer); cancelAnimationFrame(frame);
    closeAudio(); shell.inert = false;
    const restoreFocus = screen.contains(document.activeElement);
    screen.classList.add('leaving');
    screen.inert = true;
    if (restoreFocus) document.querySelector('.tab.active')?.focus({preventScroll:true});
    setTimeout(() => { screen.hidden = true; }, reducedMotion ? 0 : 800);
    document.removeEventListener('keydown', onKey);
  }
  function onKey(event) {
    if (event.key === 'Escape') { event.preventDefault(); finish(); }
  }
  function start(withSound = false) {
    clearTimeout(revealTimer); clearTimeout(endTimer); cancelAnimationFrame(frame);
    screen.classList.remove('reveal');
    if (!reducedMotion) frame = requestAnimationFrame(noise);
    revealTimer = setTimeout(() => screen.classList.add('reveal'), reducedMotion ? 0 : 1250);
    endTimer = setTimeout(finish, reducedMotion && !withSound ? 1800 : 6300);
  }
  // Original low swell and rising major-add-nine chime, inspired by broadcast idents.
  // Try sound by default; browsers that require a gesture keep the click fallback.
  async function playSound(automatic = false) {
    soundButton.disabled = true;
    try {
      const AudioEngine = window.AudioContext || window.webkitAudioContext;
      audio = new AudioEngine();
      // A blocked resume may stay pending indefinitely. Keep the intro skippable
      // and release that context before offering a fresh attempt on click.
      await Promise.race([
        audio.resume(),
        new Promise(resolve => setTimeout(resolve, 400)),
      ]);
      if (finished) { closeAudio(); return; }
      if (audio.state !== 'running') {
        closeAudio();
        soundButton.disabled = false;
        soundButton.textContent = '▶ ENABLE INTRO SOUND';
        return;
      }
      start(true);
      const now = audio.currentTime;
      const master = audio.createGain(); master.gain.value = .2; master.connect(audio.destination);
      const lowpass = audio.createBiquadFilter(); lowpass.type = 'lowpass';
      lowpass.frequency.setValueAtTime(theme === 'teletext' ? 2200 : 500, now);
      lowpass.frequency.exponentialRampToValueAtTime(theme === 'goblin' ? 1600 : 2800, now + 2);
      lowpass.connect(master);
      const staticBuffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * 1.25), audio.sampleRate);
      const samples = staticBuffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * .15;
      const hiss = audio.createBufferSource(), hissEnvelope = audio.createGain();
      hiss.buffer = staticBuffer; hissEnvelope.gain.setValueAtTime(.4, now);
      hissEnvelope.gain.linearRampToValueAtTime(0, now + 1.25);
      hiss.connect(hissEnvelope); hissEnvelope.connect(master); hiss.start(now);
      function tone(frequency, delay, duration, volume, type) {
        const oscillator = audio.createOscillator(), envelope = audio.createGain();
        oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, now + delay);
        envelope.gain.setValueAtTime(0, now + delay);
        envelope.gain.linearRampToValueAtTime(volume, now + delay + (theme === 'teletext' ? .012 : theme === 'goblin' ? .035 : .18));
        envelope.gain.exponentialRampToValueAtTime(.0001, now + delay + duration);
        oscillator.connect(envelope); envelope.connect(lowpass);
        oscillator.start(now + delay); oscillator.stop(now + delay + duration);
      }
      if (theme === 'goblin') {
        // A low dungeon hum, woody minor-key plucks and a tiny bell flourish.
        tone(73.416, 0, 4.8, .5, 'triangle');
        [146.832, 174.614, 220, 293.665, 440, 349.228].forEach((frequency, i) => {
          tone(frequency, 1.25 + i * .24, 1.8, .35, 'triangle');
          tone(frequency * 2.004, 1.25 + i * .24, 1.4, .08, 'sine');
        });
      } else if (theme === 'teletext') {
        // Short terminal bleeps resolve into a simple electronic station chord.
        [523.251, 659.255, 783.991, 1046.502].forEach((frequency, i) => {
          tone(frequency, .25 + i * .2, .18, .14, 'square');
          tone(frequency / 2, 1.25 + i * .12, 2.2, .18, 'triangle');
        });
      } else {
        tone(65.406, 0, 4.7, .65, 'triangle');
        [261.626, 329.628, 391.995, 587.33].forEach((frequency, i) => {
          tone(frequency, 1.25 + i * .15, 3.4, .28, 'sine');
          tone(frequency * 1.003, 1.25 + i * .15, 3.1, .1, 'triangle');
        });
      }
      soundButton.textContent = '♪ INTRO SOUND ON';
    } catch (_) {
      closeAudio();
      soundButton.disabled = !automatic;
      soundButton.textContent = automatic ? '▶ ENABLE INTRO SOUND' : 'SOUND UNAVAILABLE';
    }
  }
  soundButton.addEventListener('click', () => playSound());
  document.querySelector('#startup-skip').addEventListener('click', finish);
  document.addEventListener('keydown', onKey);
  window.addEventListener('pagehide', finish, {once:true});
  function begin(savedTheme) {
    if (booted || finished) return;
    booted = true;
    clearTimeout(themeTimeout);
    theme = Object.hasOwn(identities, savedTheme) ? savedTheme : 'satellite';
    const identity = identities[theme];
    screen.dataset.theme = theme;
    screen.querySelector('.startup-wordmark').textContent = identity.title;
    screen.querySelector('.startup-logo p').textContent = identity.tagline;
    screen.querySelector('.startup-logo small').textContent = identity.caption;
    start();
    playSound(true);
  }
  window.USBTvIntro = {start: begin};
})();
