const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function setup({reduced=false,theme='goblin'}={}) {
  const events={},timers=new Map();let next=0,observer,open=false;
  const element=()=>({children:[],className:'',style:{setProperty(){}},classList:{toggle(){}},setAttribute(){},
    append(child){this.children.push(child);child.parent=this;},remove(){this.parent.children=this.parent.children.filter(c=>c!==this);},
    addEventListener(name,fn){this[name]=fn;}});
  const body={dataset:{theme},prepend(layer){this.layer=layer;}};
  const document={body,hidden:false,createElement:element,addEventListener:(name,fn)=>events[name]=fn,
    querySelector:selector=>selector==='dialog[open]'?(open?{}:null):{hidden:true}};
  const media={matches:reduced,addEventListener:(name,fn)=>events.motion=fn};
  const context={document,matchMedia:()=>media,window:{addEventListener:(name,fn)=>events[name]=fn},
    MutationObserver:class{constructor(fn){observer=fn;}observe(){}disconnect(){}},
    setTimeout:(fn,ms)=>{timers.set(++next,{fn,ms});return next;},clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(fs.readFileSync('web/goblin.js','utf8'),context);
  return {body,document,media,timers,events,observer,setOpen:value=>open=value};
}
test('cave atmosphere has 14 fireflies and only schedules bats in visible Goblin mode',()=>{
  const s=setup();assert.equal(s.body.layer.children.length,14);
  assert.equal(s.timers.size,1);
  const timerId=[...s.timers.keys()][0];s.observer();assert.equal([...s.timers.keys()][0],timerId);
  assert([...s.timers.values()].every(t=>t.ms>=45000&&t.ms<90000));
  s.document.hidden=true;s.events.visibilitychange();assert.equal(s.timers.size,0);
  s.document.hidden=false;s.events.visibilitychange();assert.equal(s.timers.size,1);
  s.body.dataset.theme='satellite';s.observer();assert.equal(s.timers.size,0);
  assert.equal(setup({reduced:true}).timers.size,0);
});
test('open dialogs suppress bats and theme changes remove a bat already in flight',()=>{
  const s=setup();let entry=[...s.timers.entries()][0];s.timers.delete(entry[0]);s.setOpen(true);entry[1].fn();
  assert.equal(s.body.layer.children.length,14);assert.equal(s.timers.size,1);
  s.setOpen(false);entry=[...s.timers.entries()][0];s.timers.delete(entry[0]);entry[1].fn();
  assert.equal(s.body.layer.children.length,15);
  const flock=s.body.layer.children.at(-1);
  assert(flock.children.length>=4 && flock.children.length<=7);
  assert.equal(new Set(flock.children.map(b=>b.style.cssText)).size,flock.children.length);
  const members=[...flock.children];
  for(const member of members.slice(0,-1)) member.animationend({target:member});
  assert.equal(s.timers.size,0); // Wait for the last member before scheduling another flock.
  members.at(-1).animationend({target:members.at(-1)});
  assert.equal(s.body.layer.children.length,14);assert.equal(s.timers.size,1);
  const pending=[...s.timers.entries()][0];s.timers.delete(pending[0]);pending[1].fn();
  assert.equal(s.body.layer.children.length,15);
  s.body.dataset.theme='teletext';s.observer();assert.equal(s.body.layer.children.length,14);assert.equal(s.timers.size,0);
});

function livingSetup({reduced=false,theme='goblin',disabled=false}={}) {
  const callbacks={},frames=new Map();let sequence=0,observer;
  const draws=[],clips=[];
  const paint=new Proxy({}, {get:(_,key)=>key==='createRadialGradient'?()=>({addColorStop(){}}):key==='drawImage'?(...args)=>draws.push(args):key==='rect'?(...args)=>clips.push(args):()=>{}});
  const classes=new Set();
  const canvas={className:'',setAttribute(){},getContext:()=>paint};
  const body={dataset:{theme},classList:{add:v=>classes.add(v)},style:{setProperty(){}},prepend(){}};
  let creates=0;
  const document={body,hidden:false,createElement:()=>++creates===1?{className:'',setAttribute(){},append(){}}:canvas,
    querySelector:s=>s==='dialog[open]'?null:s==='#startup'?{hidden:true}:s==='.channel-preview-screen'?{getClientRects:()=>[{}],getBoundingClientRect:()=>({left:0,top:0,bottom:400,width:600,height:400})}:null,
    addEventListener:(n,f)=>callbacks[n]=f};
  const media={matches:reduced,addEventListener:(n,f)=>callbacks.motion=f};
  const context={Image:class{complete=true;naturalWidth=2172;naturalHeight=724;addEventListener(){}},document,localStorage:{getItem:()=>disabled?'off':null},innerWidth:1000,innerHeight:800,devicePixelRatio:2,
    matchMedia:()=>media,window:{addEventListener:(n,f)=>callbacks[n]=f},
    MutationObserver:class{constructor(f){observer=f;}observe(){}disconnect(){}},
    requestAnimationFrame:f=>{frames.set(++sequence,f);return sequence;},cancelAnimationFrame:id=>frames.delete(id),setTimeout:()=>0,clearTimeout(){}};
  // Evaluate only the independent study; original bats are covered above.
  const source=fs.readFileSync('web/goblin.js','utf8').split('/* Enhanced fireflies only;')[1];
  document.createElement=()=>canvas;
  vm.runInNewContext('/* Enhanced fireflies only;'+source,context);
  return {draws,clips,frames,document,body,media,callbacks,classes,observer,canvas,step(now=100){const [id,fn]=frames.entries().next().value;frames.delete(id);fn(now);}};
}
test('living study caps resolution and stops rendering outside visible Goblin mode',()=>{
  const s=livingSetup();assert(s.classes.has('goblin-fireflies-enhanced'));assert.equal(s.canvas.width,1500);assert.equal(s.frames.size,1);
  s.step();assert.equal(s.frames.size,1);
  s.document.hidden=true;s.callbacks.visibilitychange();assert.equal(s.frames.size,0);
  s.document.hidden=false;s.callbacks.visibilitychange();assert.equal(s.frames.size,1);
  s.body.dataset.theme='satellite';s.observer();assert.equal(s.frames.size,0);
  s.body.dataset.theme='goblin';s.observer();assert.equal(s.frames.size,1);
  s.callbacks.pagehide();assert.equal(s.frames.size,0);
  s.callbacks.pageshow();assert.equal(s.frames.size,1);
});
test('fireflies respect reduced motion and resume on preference changes',()=>{
  const still=livingSetup({reduced:true});still.step();assert.equal(still.frames.size,0);
  still.media.matches=false;still.callbacks.motion();assert.equal(still.frames.size,1);
});
