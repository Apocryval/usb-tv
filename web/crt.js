/* GPU CRT pass. The original video remains the audio, timing and input source. */
(() => {
  'use strict';
  const vertex = `attribute vec2 position; varying vec2 uv;
    void main() { uv = position * .5 + .5; gl_Position = vec4(position, 0., 1.); }`;
  const fragment = `precision mediump float;
    varying vec2 uv;
    uniform sampler2D picture;
    uniform vec2 resolution;
    uniform vec2 videoSize;
    uniform float clock;
    vec3 sampleAt(vec2 p) { return texture2D(picture, clamp(p, .001, .999)).rgb; }
    void main() {
      // Preserve contain-style letterboxing before curving the picture.
      vec2 fit = vec2(1.);
      float screenAspect = resolution.x / resolution.y;
      float videoAspect = videoSize.x / videoSize.y;
      if (screenAspect > videoAspect) fit.x = videoAspect / screenAspect;
      else fit.y = screenAspect / videoAspect;
      vec2 p = (uv - .5) / fit * 2.;
      p *= 1. + .055 * dot(p, p);
      vec2 q = p * .5 + .5;
      if (max(abs(p.x), abs(p.y)) > 1.) { gl_FragColor = vec4(0.,0.,0.,1.); return; }
      vec2 pixel = 1. / videoSize;
      // Slightly misaligned RGB guns, horizontal bleed and broad phosphor glow.
      vec3 sharp = vec3(sampleAt(q + vec2(pixel.x * .65,0.)).r,
                        sampleAt(q).g, sampleAt(q - vec2(pixel.x * .65,0.)).b);
      vec3 glow = (sampleAt(q + vec2(pixel.x*2.,0.)) + sampleAt(q - vec2(pixel.x*2.,0.))
                 + sampleAt(q + vec2(0.,pixel.y*1.5)) + sampleAt(q - vec2(0.,pixel.y*1.5))) * .25;
      vec3 color = sharp * .88 + glow * .20;
      // Keep at least three rendered pixels per scanline cycle. Small previews
      // cannot resolve the source's full line count without aliasing.
      vec2 pictureSize = resolution * fit;
      float lines = min(min(videoSize.y, 480.), pictureSize.y / 3.);
      float detail = smoothstep(180., 600., pictureSize.y);
      float scan = .88 + mix(.025, .12, detail) * cos(q.y * lines * 6.283185);
      float column = mod(floor(gl_FragCoord.x), 3.);
      vec3 mask = column < 1. ? vec3(1.,.82,.82) : column < 2. ? vec3(.82,1.,.82) : vec3(.82,.82,1.);
      mask = mix(vec3(.88), mask, smoothstep(240., 900., pictureSize.x));
      float vignette = 1. - .24 * pow(length(p) / 1.4142, 2.);
      float grain = fract(sin(dot(floor(q * resolution),vec2(12.9898,78.233)) + clock) * 437.);
      color = pow(max(color, vec3(0.)), vec3(.96)) * scan * mask * vignette * 1.12;
      color += (grain - .5) * .012;
      gl_FragColor = vec4(color,1.);
    }`;
  let enabled = false, frame = 0, last = 0;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const displays = [...document.querySelectorAll('#player, #guide-preview-video')].map(video => ({video}));
  const overlay = document.querySelector('#crt-overlay');

  function clear(display) {
    if (display.video.id === 'guide-preview-video' && overlay) overlay.style.clipPath = '';
    display.canvas?.classList.remove('crt-rendering');
    display.video.classList.remove('crt-shader-source');
  }
  function initialise(display) {
    const canvas = document.createElement('canvas');
    canvas.className = 'crt-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    display.video.after(canvas);
    display.canvas = canvas;
    const gl = canvas.getContext('webgl', {alpha:false, antialias:false, depth:false, powerPreference:'low-power'});
    if (!gl) throw new Error('WebGL unavailable');
    display.gl = gl;
    function compile(type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    }
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('CRT shader link failed');
    gl.useProgram(program);
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program,'position');
    gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
    const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
    display.uniforms = Object.fromEntries(['resolution','videoSize','clock'].map(name => [name,gl.getUniformLocation(program,name)]));
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault(); display.failed = true; clear(display);
    });
    canvas.addEventListener('webglcontextrestored', () => {
      canvas.remove(); display.canvas = null; display.gl = null; display.failed = false;
    });
  }

  function render(display, now) {
    const {video} = display;
    const bounds = video.getBoundingClientRect();
    const visible = bounds.width && bounds.height && bounds.bottom > 0 && bounds.top < innerHeight
      && bounds.right > 0 && bounds.left < innerWidth
      && (video.id === 'player' ? video.closest('dialog').open
        : document.querySelector('#page-guide').classList.contains('active') && !document.querySelector('#player-dialog').open);
    if (!visible || video.readyState < 2 || display.failed) { clear(display); return; }
    try {
      if (!display.gl) initialise(display);
      const {canvas,gl,uniforms} = display;
      // Keep layout on the real video; position its GPU image over that exact box.
      canvas.style.left = `${video.offsetLeft}px`; canvas.style.top = `${video.offsetTop}px`;
      canvas.style.width = `${video.offsetWidth}px`; canvas.style.height = `${video.offsetHeight}px`;
      const scale = Math.min(devicePixelRatio || 1, 1440 / bounds.width, 1080 / bounds.height);
      const width = Math.max(1, Math.round(bounds.width * scale));
      const height = Math.max(1, Math.round(bounds.height * scale));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      gl.viewport(0,0,width,height);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,video);
      gl.uniform2f(uniforms.resolution,width,height);
      gl.uniform2f(uniforms.videoSize,video.videoWidth,video.videoHeight);
      gl.uniform1f(uniforms.clock,reducedMotion.matches ? 0 : Math.floor(now / 80) % 1000);
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
      canvas.classList.add('crt-rendering'); video.classList.add('crt-shader-source');
      if (video.id === 'guide-preview-video' && overlay) {
        // Cut the shader-rendered picture out of the page-wide CSS pass. The
        // rest of the interface retains its CRT treatment, including the cabinet.
        const {left:x,top:y,right:r,bottom:b} = bounds;
        overlay.style.clipPath = `polygon(evenodd, 0px 0px, ${innerWidth}px 0px, ${innerWidth}px ${innerHeight}px, 0px ${innerHeight}px, 0px 0px, ${x}px ${y}px, ${x}px ${b}px, ${r}px ${b}px, ${r}px ${y}px, ${x}px ${y}px)`;
      }
    } catch (_) {
      display.failed = true; clear(display); // CSS CRT remains usable on unsupported GPUs/codecs.
    }
  }
  function tick(now) {
    if (!enabled) return;
    // Cap GPU work at 30fps; hidden pages do no texture uploads.
    if (now - last >= 32) {
      last = now;
      if (document.hidden) displays.forEach(clear);
      else displays.forEach(display => render(display,now));
    }
    frame = requestAnimationFrame(tick);
  }
  window.USBTvCRT = {setEnabled(value) {
    enabled = Boolean(value); cancelAnimationFrame(frame);
    displays.forEach(clear);
    if (enabled) { last = 0; frame = requestAnimationFrame(tick); }
  }};
})();
