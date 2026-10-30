/* Explicit, reusable AAC playback copies for files with Dolby audio. */
(() => {
  const controls = document.querySelector('#compatible-audio-controls');
  const message = document.querySelector('#compatible-audio-status');
  const button = document.querySelector('#prepare-playback-audio');
  const states = new Map(), ready = new Map(), timers = new Map();
  let config;
  const supported = video => ['ac3','eac3','ac-3','ec-3'].includes(video?.technical?.audio_codec);
  const key = video => video ? `${video.id}:${video.file}:${video.fingerprint}:${video.modified_ns}:${video.scan_source}` : '';
  const isReady = video => video && ready.get(video.file) === key(video);
  function redraw() {
    const video = config?.getVideo();
    controls.hidden = !supported(video);
    if (controls.hidden) return;
    const status = states.get(key(video));
    const preparing = status?.state === 'preparing';
    button.hidden = isReady(video);
    button.disabled = !status || status.state === 'checking' || preparing || status.available === false;
    const bytes = Number(status?.required_bytes) || 0;
    const size = bytes > 0 ? ` About ${bytes >= 1024 ** 3 ? (bytes / 1024 ** 3).toFixed(1) + ' GB' : Math.max(1, Math.ceil(bytes / 1024 ** 2)) + ' MB'} extra space.` : '';
    message.textContent = isReady(video) ? 'Compatible audio ready.'
      : status?.error || (preparing ? 'Preparing compatible audio… You can keep browsing.'
      : status?.available === false ? 'Compatible audio needs FFmpeg and FFprobe on this computer.'
      : 'Dolby audio may be silent in this browser. Prepare a playback copy; the original stays intact.' + size);
    button.textContent = preparing ? 'PREPARING…' : status?.state === 'error' ? 'RETRY AUDIO PREPARATION' : 'PREPARE AUDIO';
  }
  function reloadMedia(file) {
    for (const element of document.querySelectorAll('#player, #guide-preview-video')) {
      if (!element.hasAttribute('src')) continue;
      const current = new URL(element.src, location.href);
      if (decodeURIComponent(current.pathname.slice(1)) !== file || current.searchParams.get('audio') === 'compatible') continue;
      const position = element.currentTime, paused = element.paused;
      const expected = new URL(config.url(file), location.href).href;
      element.addEventListener('loadedmetadata', () => {
        if (element.src !== expected) return;
        if (!config.isLive(element)) element.currentTime = Math.min(position, Number.isFinite(element.duration) ? element.duration : position);
        if (paused) element.pause();
        else element.play().catch(() => {});
      }, {once:true});
      element.src = config.url(file); element.load();
    }
  }
  async function check(video, prepare = false) {
    const identity = key(video);
    clearTimeout(timers.get(identity)); timers.delete(identity);
    try {
      const response = await config.api(prepare ? '/api/playback-audio' : '/api/playback-audio?id=' + encodeURIComponent(video.id),
        prepare ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:video.id})} : {cache:'no-store'});
      if (response.status === 404) throw new Error('Restart USB.tv to enable compatible audio.');
      const status = await response.json();
      if (!response.ok) throw new Error(status.error || 'Restart USB.tv to enable compatible audio.');
      states.set(identity, status);
      if (status.state === 'ready') {
        if (status.file === video.file && key(config.record(video.file)) === identity) ready.set(video.file, identity);
        // A preparation for an old folder must not reload a different source.
        const current = config.getVideo();
        if (current && key(current) === identity) reloadMedia(video.file);
      } else if (status.state === 'preparing') {
        timers.set(identity, setTimeout(() => { void check(video); }, 1500));
      }
    } catch (error) { states.set(identity, {state:'error',error:error.message}); }
    redraw();
  }
  button.addEventListener('click', () => {
    const video = config?.getVideo();
    if (!supported(video) || button.disabled) return;
    states.set(key(video), {state:'preparing'}); redraw(); void check(video, true);
  });
  globalThis.USBTvCompatibleAudio = {
    configure(options) { config = options; },
    query(file) { return isReady(config?.record(file)) ? '?audio=compatible' : ''; },
    sync() {
      const video = config?.getVideo();
      if (supported(video) && !states.has(key(video))) {
        // Invalidate an old source before discovering its current cache state.
        ready.delete(video.file);
        states.set(key(video), {state:'checking'}); void check(video);
      }
      redraw();
    }
  };
})();
