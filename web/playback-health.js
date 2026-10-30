/* Detect a media clock stuck while playback is requested, without treating pause as a fault. */
(() => {
  class PlaybackWatch {
    constructor(delay = 12000) { this.delay = delay; this.reset(); }
    reset() { this.key = null; this.position = 0; this.progressAt = null; }
    shouldSkip(now) { return this.progressAt !== null && now - this.progressAt >= 30000; }
    sample({key, position, active}, now) {
      if (!active || !key || !Number.isFinite(position)) { this.reset(); return false; }
      if (key !== this.key || this.progressAt === null || Math.abs(position - this.position) >= .1) {
        this.key = key; this.position = position; this.progressAt = now; return false;
      }
      return now - this.progressAt >= this.delay;
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {PlaybackWatch};
  if (typeof document === 'undefined') return;
  const player = document.querySelector('#player');
  const dialog = document.querySelector('#player-dialog');
  const notice = document.querySelector('#playback-notice');
  const watch = new PlaybackWatch();
  let config;
  function tick() {
    const playback = config?.getPlayback();
    const now = Date.now();
    const stalled = watch.sample({key:playback,
      position:player.currentTime,
      active:dialog.open && !document.hidden && Boolean(player.currentSrc) && !player.paused && !player.ended && !player.error}, now);
    if (stalled && watch.shouldSkip(now) && config?.skip) {
      watch.reset(); notice.hidden = true; config.skip(); return;
    }
    notice.hidden = !stalled;
    if (stalled) config?.reveal();
  }
  player.addEventListener('loadstart', () => { watch.reset(); notice.hidden = true; });
  document.querySelector('#retry-stalled-playback').addEventListener('click', () => {
    watch.reset(); notice.hidden = true; config?.retry();
  });
  document.querySelector('#skip-stalled-playback').addEventListener('click', () => {
    watch.reset(); notice.hidden = true; config?.skip();
  });
  document.addEventListener('visibilitychange', () => { watch.reset(); notice.hidden = true; });
  setInterval(tick, 1000);
  globalThis.USBTvPlaybackHealth = {configure(options) { config = options; }};
})();
