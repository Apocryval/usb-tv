/* Brief, local tuning noise. No media downloads or schedule time required. */
(() => {
  'use strict';
  const canvas = document.querySelector('#tuning-static');
  let timer, frame, last = -Infinity;
  function stop() {
    clearTimeout(timer); cancelAnimationFrame(frame); canvas.hidden = true;
    window.USBTvCRT?.stopTuning();
  }
  function play() {
    if (performance.now() - last < 180) return;
    last = performance.now(); stop();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduced && window.USBTvCRT?.startTuning(320)) {
      window.USBTvAudio?.playStatic(320); timer=setTimeout(stop,320); return;
    }
    const context = canvas.getContext('2d');
    if (!context) return;
    canvas.width = 160; canvas.height = 90; canvas.hidden = false;
    function paint() {
      const pixels = context.createImageData(160,90);
      for (let i=0;i<pixels.data.length;i+=4) {
        const grey = 40 + Math.random()*95;
        pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=grey; pixels.data[i+3]=255;
      }
      context.putImageData(pixels,0,0);
      if (!reduced) frame=requestAnimationFrame(paint);
    }
    paint(); window.USBTvAudio?.playStatic(150); timer=setTimeout(stop,150);
  }
  window.USBTvTransition={play,stop};
})();
