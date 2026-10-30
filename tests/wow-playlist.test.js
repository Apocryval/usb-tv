const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function fixture() {
  const nodes=new Map(),timers=[];
  const doc={activeElement:null,querySelector:id=>node(id)};
  function node(id) {
    if(!nodes.has(id)) {
      const classes=new Set();
      nodes.set(id,{hidden:true,inert:true,dataset:{},events:{},attributes:{},html:'',
        classList:{toggle(name,on){on?classes.add(name):classes.delete(name);},contains:name=>classes.has(name)},
        addEventListener(name,fn){this.events[name]=fn;},setAttribute(name,value){this.attributes[name]=value;},
        contains:el=>false,matches:()=>false,focus(){doc.activeElement=this;},scrollIntoView(){},
        querySelector(){return null;},querySelectorAll(){return [];},replaceChildren(){this.html='';},
        set innerHTML(value){this.html=value;},get innerHTML(){return this.html;}});
    }
    return nodes.get(id);
  }
  const playback={mode:'chaos',trailIndex:0,trail:[{id:'one'}],queue:[]};
  const entries=[{id:'one',file:'Videos/one.mp4',title:'<script>Title</script>'},{id:'two',file:'Videos/two.mp4',title:'Second'}];
  const selected=[];
  const context={document:doc,URL,IntersectionObserver:class{observe(){}disconnect(){}},
    setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){}};
  vm.runInNewContext(fs.readFileSync('web/wow-playlist.js','utf8'),context);
  const api=context.USBTvPlaylist;
  api.configure({getPlayback:()=>playback,entries:()=>entries,select:value=>selected.push(value),
    title:v=>v.title,duration:()=> '1:00',url:file=>'/'+file});
  api.sync();
  return {api,node,playback,selected,timers};
}
test('mouse hover followed by clicking the playlist tab keeps the drawer open',()=>{
  const f=fixture(),toggle=f.node('#wow-playlist-toggle');
  toggle.events.pointerenter({pointerType:'mouse'});
  assert.equal(toggle.attributes['aria-expanded'],'true');
  toggle.events.click({detail:1,pointerType:'mouse'});
  assert.equal(toggle.attributes['aria-expanded'],'true');
  assert.equal(f.node('#wow-playlist-panel').inert,false);
});
test('keyboard and touch can toggle the drawer, Escape restores focus, and other modes hide it',()=>{
  const f=fixture(),toggle=f.node('#wow-playlist-toggle');
  toggle.events.click({detail:0});assert.equal(toggle.attributes['aria-expanded'],'true');
  assert.match(f.node('#wow-playlist-items').innerHTML,/&lt;script&gt;Title&lt;\/script&gt;/);
  assert.equal(f.api.closeIfOpen(),true);assert.equal(f.api.closeIfOpen(),false);
  assert.equal(f.node('#wow-playlist-panel').inert,true);
  toggle.events.pointerenter({pointerType:'touch'});assert.equal(toggle.attributes['aria-expanded'],'false');
  toggle.events.click({detail:1,pointerType:'touch'});assert.equal(toggle.attributes['aria-expanded'],'true');
  toggle.events.click({detail:1,pointerType:'touch'});assert.equal(toggle.attributes['aria-expanded'],'false');
  f.playback.mode='channel';f.api.sync();assert.equal(f.node('#wow-playlist').hidden,true);
});
