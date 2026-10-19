const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');

function setup({gpu=true}={}) {
  const classes=()=>{const values=new Set();return {add:v=>values.add(v),remove:v=>values.delete(v),contains:v=>values.has(v)};};
  const overlay={style:{}},dialog={open:false},frames=new Map();let sequence=0;
  const gl=new Proxy({}, {get:(_,key)=>key==='getShaderParameter'||key==='getProgramParameter'?()=>true:()=>({})});
  function video(id){return {id,readyState:2,videoWidth:1280,videoHeight:720,offsetLeft:0,offsetTop:0,offsetWidth:320,offsetHeight:180,
    classList:classes(),after(){},closest:()=>dialog,
    getBoundingClientRect:()=>({left:20,top:30,right:340,bottom:210,width:320,height:180})};}
  const preview=video('guide-preview-video'),player=video('player');
  const document={hidden:false,querySelectorAll:()=>[player,preview],
    querySelector:s=>s==='#crt-overlay'?overlay:s==='#player-dialog'?dialog:{classList:{contains:()=>true}},
    createElement:()=>({style:{},classList:classes(),setAttribute(){},addEventListener(){},getContext:()=>gpu?gl:null})};
  const window={};
  vm.runInNewContext(fs.readFileSync('web/crt.js','utf8'),{document,window,innerWidth:1000,innerHeight:800,devicePixelRatio:1,
    matchMedia:()=>({matches:false}),requestAnimationFrame:f=>{frames.set(++sequence,f);return sequence;},cancelAnimationFrame:id=>frames.delete(id)});
  return {overlay,preview,player,dialog,setEnabled:window.USBTvCRT.setEnabled,
    step(now){const [id,fn]=frames.entries().next().value;frames.delete(id);fn(now);}};
}

test('preview excludes the page overlay only while its shader is rendering',()=>{
  const s=setup();s.setEnabled(true);s.step(40);
  assert(s.preview.classList.contains('crt-shader-source'));
  assert(s.overlay.style.clipPath.startsWith('polygon(evenodd,'));
  assert(s.overlay.style.clipPath.includes('20px 30px'));
  s.preview.readyState=0;s.step(80);
  assert.equal(s.overlay.style.clipPath,'');
  assert(!s.preview.classList.contains('crt-shader-source'));
});

test('opening the player and disabling CRT restore the page overlay',()=>{
  const s=setup();s.setEnabled(true);s.step(40);s.dialog.open=true;s.step(80);
  assert.equal(s.overlay.style.clipPath,'');
  assert(s.player.classList.contains('crt-shader-source'));
  s.setEnabled(false);assert(!s.player.classList.contains('crt-shader-source'));
  assert.equal(s.overlay.style.clipPath,'');
});

test('unavailable GPU keeps the CSS fallback intact',()=>{
  const s=setup({gpu:false});s.setEnabled(true);s.step(40);
  assert(!s.preview.classList.contains('crt-shader-source'));
  assert(!s.overlay.style.clipPath);
});
