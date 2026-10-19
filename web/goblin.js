/* Offline cave atmosphere, isolated from playback and schedule state. */
(() => {
  'use strict';
  const layer=document.createElement('div');
  layer.className='goblin-atmosphere';layer.setAttribute('aria-hidden','true');
  document.body.prepend(layer);
  const positions=[[3,18],[96,22],[6,43],[93,48],[3,74],[96,80],[12,93],[85,94],[20,8],[74,10],[42,5],[61,94],[10,60],[89,64]];
  positions.forEach(([x,y],i)=>{
    const fly=document.createElement('span');fly.className='goblin-firefly';
    fly.style.cssText=`--x:${x}%;--y:${y}%;--duration:${7+i%7}s;--delay:-${i*1.7}s`;
    layer.append(fly);
  });
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let timer=null, bat=null, disposed=false;
  const active=()=>!disposed && document.body.dataset.theme==='goblin' && !document.hidden && !reduced.matches;
  function clear() {clearTimeout(timer);timer=null;bat?.remove();bat=null;}
  function schedule() {
    if (!active()) return;
    timer=setTimeout(flyBat,45000+Math.random()*45000);
  }
  function flyBat() {
    timer=null;
    if(!active())return;
    // Never start a fly-by while the intro or a player/editor dialog is open.
    if(document.querySelector('dialog[open]') || !document.querySelector('#startup')?.hidden) {schedule();return;}
    bat=document.createElement('div');bat.className='goblin-flock';
    const flock=bat, reverse=Math.random()<.5, count=4+Math.floor(Math.random()*4);
    let remaining=count;
    for(let i=0;i<count;i++) {
      const member=document.createElement('div');
      member.className='goblin-bat'+(reverse?' reverse':'');
      member.style.cssText=`--height:${8+Math.random()*15}%;--flight:${7+Math.random()*3}s;--stagger:${i*.18+Math.random()*.25}s;--rise-a:${-35+Math.random()*55}px;--rise-b:${-30+Math.random()*65}px;--tilt:${-9+Math.random()*18}deg;--size:${.65+Math.random()*.45};--flap:${.17+Math.random()*.12}s`;
      member.innerHTML='<span></span><i></i><span></span>';flock.append(member);
      member.addEventListener('animationend',event=>{
        if(event.target!==member)return;
        member.remove();
        if(--remaining===0 && bat===flock) {flock.remove();bat=null;schedule();}
      });
    }
    layer.append(flock);
  }
  function update() {clear();layer.classList.toggle('paused',document.hidden);schedule();}
  let observedTheme=document.body.dataset.theme;
  const observer=new MutationObserver(()=>{
    // Reapplying the same theme during a catalogue refresh must not restart
    // the long ambient timer, otherwise bats may never appear.
    if(document.body.dataset.theme===observedTheme)return;
    observedTheme=document.body.dataset.theme;update();
  });
  observer.observe(document.body,{attributes:true,attributeFilter:['data-theme']});
  document.addEventListener('visibilitychange',update);
  reduced.addEventListener('change',update);
  window.addEventListener('pagehide',()=>{disposed=true;clear();observer.disconnect();});
  window.addEventListener('pageshow',()=>{if(disposed){disposed=false;observer.observe(document.body,{attributes:true,attributeFilter:['data-theme']});update();}});
  update();
})();

/* Enhanced fireflies only; independent of playback and the painted sign styles. */
(() => {
  'use strict';
  const canvas=document.createElement('canvas');
  const ctx=canvas.getContext?.('2d');
  if(!ctx) return;
  canvas.className='goblin-firefly-canvas';canvas.setAttribute('aria-hidden','true');
  document.body.prepend(canvas);
  document.body.classList.add('goblin-fireflies-enhanced');
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  let frame=0,last=0,width=0,height=0,disposed=false,elapsed=0;
  const pointer={x:-1000,y:-1000};
  const flies=Array.from({length:24},(_,i)=>({x:Math.random(),y:Math.random(),phase:i*2.399,size:.7+Math.random()*1.4}));
  function resize(){width=innerWidth;height=innerHeight;const ratio=Math.min(devicePixelRatio||1,1.5);canvas.width=width*ratio;canvas.height=height*ratio;ctx.setTransform(ratio,0,0,ratio,0,0);}
  function glow(x,y,r,color){const g=ctx.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,color);g.addColorStop(1,'transparent');ctx.fillStyle=g;ctx.fillRect(x-r,y-r,r*2,r*2);}
  function draw(now){
    frame=0;
    if(disposed || document.hidden || document.body.dataset.theme!=='goblin')return;
    const dt=Math.min((now-last)/1000||0,.05);last=now;
    if(!motion.matches)elapsed+=dt;
    const t=motion.matches?12:elapsed;
    ctx.clearRect(0,0,width,height);
    const dialog=document.querySelector('dialog[open]') || !document.querySelector('#startup')?.hidden;
    if(!dialog){
      flies.forEach((fly,i)=>{
        const rest=Math.sin(t*.18+fly.phase)>.7;
        let x=fly.x*width+Math.sin(t*.23+fly.phase)*(rest?3:32);
        let y=fly.y*height+Math.cos(t*.31+fly.phase)*(rest?2:22);
        const dx=x-pointer.x,dy=y-pointer.y,distance=Math.hypot(dx,dy);
        if(!motion.matches && distance<100){x+=dx/(distance||1)*(100-distance)*.35;y+=dy/(distance||1)*(100-distance)*.35;}
        const alpha=.28+.36*(.5+.5*Math.sin(t*1.3+fly.phase));
        glow(x,y,fly.size*7,`rgba(183,210,107,${alpha*.45})`);
        ctx.fillStyle=`rgba(225,237,163,${alpha})`;ctx.beginPath();ctx.arc(x,y,fly.size,0,Math.PI*2);ctx.fill();
      });
    }
    if(!motion.matches){
      frame=requestAnimationFrame(tick);
    }
  }
  function tick(now){if(now-last<40){frame=requestAnimationFrame(tick);return;}draw(now);}
  function update(){cancelAnimationFrame(frame);frame=0;last=0;resize();
    ctx.clearRect(0,0,width,height);if(!disposed && !document.hidden && document.body.dataset.theme==='goblin')frame=requestAnimationFrame(draw);}
  window.addEventListener('pointermove',event=>{pointer.x=event.clientX;pointer.y=event.clientY;},{passive:true});
  window.addEventListener('resize',update);document.addEventListener('visibilitychange',update);motion.addEventListener('change',update);
  const observer=new MutationObserver(update);observer.observe(document.body,{attributes:true,attributeFilter:['data-theme']});
  window.addEventListener('pagehide',()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();});
  window.addEventListener('pageshow',()=>{if(disposed){disposed=false;observer.observe(document.body,{attributes:true,attributeFilter:['data-theme']});update();}});
  update();
})();
