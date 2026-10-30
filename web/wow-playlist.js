/* The drawer reads the player's queue; thumbnails use one muted decoder at a time. */
(() => {
  const root = document.querySelector('#wow-playlist');
  const toggle = document.querySelector('#wow-playlist-toggle');
  const panel = document.querySelector('#wow-playlist-panel');
  const list = document.querySelector('#wow-playlist-items');
  let config, opened = false, dismissTimer, observer, generation = 0, cancelFrame;
  let renderedPlayback, renderedIndex, renderedLength, renderedQueue;
  const cache = new Map();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function stopThumbnails() {
    generation++;
    observer?.disconnect();
    cancelFrame?.();
  }
  function frame(video) {
    return new Promise(resolve => {
      const decoder = document.createElement('video');
      decoder.muted = true; decoder.playsInline = true; decoder.preload = 'metadata';
      let finished = false;
      const timeout = setTimeout(() => finish(null), 8000);
      function finish(blob) {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        decoder.onloadedmetadata = decoder.onseeked = decoder.onerror = decoder.onloadeddata = null;
        decoder.removeAttribute('src'); decoder.load();
        cancelFrame = null;
        resolve(blob);
      }
      cancelFrame = () => finish(null);
      decoder.onerror = () => finish(null);
      const capture = () => {
        try {
          if (!decoder.videoWidth) return finish(null);
          const canvas = document.createElement('canvas');
          canvas.width = 192; canvas.height = 108;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#111'; ctx.fillRect(0, 0, 192, 108);
          const scale = Math.min(192 / decoder.videoWidth, 108 / decoder.videoHeight);
          const width = decoder.videoWidth * scale, height = decoder.videoHeight * scale;
          ctx.drawImage(decoder, (192-width)/2, (108-height)/2, width, height);
          canvas.toBlob(finish, 'image/jpeg', .75);
        } catch (_) { finish(null); }
      };
      decoder.onloadedmetadata = () => {
        const time = Number.isFinite(decoder.duration) ? Math.min(10, decoder.duration / 4) : 0;
        if (time > 0) { decoder.onseeked = capture; decoder.currentTime = time; }
        else if (decoder.readyState >= 2) capture();
        else decoder.onloadeddata = capture;
      };
      decoder.src = config.url(video.file);
      decoder.load();
    });
  }
  function loadThumbnails(entries) {
    stopThumbnails();
    const version = generation, pending = new Set();
    let busy = false;
    async function pump() {
      if (busy) return;
      busy = true;
      while (pending.size && version === generation && opened) {
        const node = pending.values().next().value; pending.delete(node);
        if (!node.isConnected) continue;
        const video = entries[Number(node.dataset.position)];
        const key = `${video.file}:${video.fingerprint || ''}`;
        let blob = cache.get(key);
        if (!cache.has(key)) {
          blob = await frame(video);
          if (version !== generation) break;
          cache.set(key, blob);
          if (cache.size > 128) cache.delete(cache.keys().next().value);
        }
        if (blob && version === generation) {
          const img = node.querySelector('img'), url = URL.createObjectURL(blob);
          img.onload = img.onerror = () => URL.revokeObjectURL(url);
          img.src = url; img.hidden = false;
        }
      }
      busy = false;
    }
    observer = new IntersectionObserver(records => {
      for (const record of records) {
        if (record.isIntersecting) { pending.add(record.target); observer.unobserve(record.target); }
      }
      void pump();
    }, {root:list, rootMargin:'100px'});
    list.querySelectorAll('[data-position]').forEach(node => observer.observe(node));
  }
  function render() {
    const playback = config?.getPlayback();
    if (!opened || playback?.mode !== 'chaos') return;
    const entries = config.entries(playback);
    renderedPlayback = playback; renderedIndex = playback.trailIndex;
    renderedLength = playback.trail?.length; renderedQueue = playback.queue;
    // Keep focus on the chosen row while it starts playing.
    const focused = list.contains(document.activeElement) ? document.activeElement.dataset.position : null;
    list.innerHTML = entries.map((video, position) => `<li><button type="button" data-position="${position}" ${position === playback.trailIndex ? 'aria-current="true"' : ''}><span class="wow-thumb" aria-hidden="true"><span>▶</span><img alt="" hidden></span><span class="wow-item-copy"><strong>${esc(config.title(video))}</strong><small>${position === playback.trailIndex ? 'PLAYING · ' : ''}${esc(config.duration(video.duration))}</small></span><span class="wow-position">${position+1}</span></button></li>`).join('');
    const target = list.querySelector(focused === null ? '[aria-current="true"]' : `[data-position="${Number(focused)}"]`);
    if (focused !== null) target?.focus({preventScroll:true});
    target?.scrollIntoView({block:'nearest'});
    loadThumbnails(entries);
  }
  function setOpen(value, restoreFocus = false) {
    clearTimeout(dismissTimer);
    if (value && root.hidden) return;
    if (opened === value) return;
    opened = value;
    root.classList.toggle('open', value);
    toggle.setAttribute('aria-expanded', String(value));
    panel.inert = !value;
    if (value) render();
    else { stopThumbnails(); if (restoreFocus) toggle.focus(); }
  }
  toggle.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') setOpen(true); });
  toggle.addEventListener('click', event => setOpen(event.detail > 0 && event.pointerType !== 'touch' ? true : !opened));
  root.addEventListener('pointerenter', () => clearTimeout(dismissTimer));
  root.addEventListener('pointerleave', () => {
    if (!root.contains(document.activeElement)) dismissTimer = setTimeout(() => setOpen(false), 300);
  });
  root.addEventListener('focusout', () => {
    setTimeout(() => { if (!root.contains(document.activeElement) && !root.matches(':hover')) setOpen(false); }, 0);
  });
  document.querySelector('#wow-playlist-close').addEventListener('click', () => setOpen(false, true));
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && opened) { event.preventDefault(); event.stopPropagation(); setOpen(false, true); }
  });
  list.addEventListener('click', event => {
    const button = event.target.closest('[data-position]');
    if (button) config.select(Number(button.dataset.position));
  });
  globalThis.USBTvPlaylist = {
    configure(options) { config = options; },
    closeIfOpen() { if (!opened) return false; setOpen(false, true); return true; },
    sync() {
      const playback = config?.getPlayback();
      const active = playback?.mode === 'chaos';
      root.hidden = !active;
      if (!active) { setOpen(false); list.replaceChildren(); renderedPlayback = null; cache.clear(); return; }
      if (opened && (renderedPlayback !== playback || renderedIndex !== playback.trailIndex || renderedLength !== playback.trail?.length || renderedQueue !== playback.queue)) render();
    }
  };
})();
