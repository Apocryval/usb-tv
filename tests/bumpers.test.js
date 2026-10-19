const {test}=require('node:test');
const assert=require('node:assert/strict');
const S=require('../web/schedule.js');
global.USBTvSchedule=S;require('../web/schedule-plans.js');
const clip=(id,type,duration,extra={})=>({id,type,duration,enabled:true,channels:['A'],...extra});
const catalog=()=>({settings:{ad_interval:60,ad_length:15},channels:[{name:'A'}],videos:[
  clip('show','programme',120,{breaks_approved:true,break_points:[60]}),
  clip('ad','advert',15),clip('out','bumper',3,{bumper_role:'to_ads'}),clip('in','bumper',4,{bumper_role:'from_ads'})]});
test('bumpers surround each whole break and are included in clock positions',()=>{
  const line=S.buildCycle(catalog(),'A','test',0);
  const segments=line.blocks[0].segments;
  assert.deepEqual(segments.map(s=>s.video.id),['show','out','ad','in','show','out','ad','in']);
  assert.equal(line.blocks[0].duration,164);
  assert.equal(S.locate(line,61000).segment.video.id,'out');
  assert.equal(S.locate(line,64000).segment.video.id,'ad');
  assert.equal(S.locate(line,79000).segment.video.id,'in');
  assert.equal(S.locate(line,83000).position,61);
  assert.deepEqual(S.buildCycle(catalog(),'A','test',0),line);
});
test('legacy clocks ignore bumpers and absent adverts never produce bumper breaks',()=>{
  const c=catalog();
  assert(!S.buildCycle(c,'A','test',0,2).blocks.flatMap(b=>b.segments).some(s=>s.bumper));
  c.videos=c.videos.filter(v=>v.type!=='advert');
  assert.equal(S.buildCycle(c,'A','test',0).duration,120);
});
test('missing, disabled and other-channel bumpers are excluded',()=>{
  const c=catalog();c.videos.find(v=>v.id==='out').enabled=false;c.videos.find(v=>v.id==='in').channels=['B'];
  assert(!S.buildCycle(c,'A','test',0).blocks.flatMap(b=>b.segments).some(s=>s.bumper));
  c.videos.find(v=>v.id==='out').enabled=true;c.videos.find(v=>v.id==='out').missing=true;
  assert(!S.buildCycle(c,'A','test',0).blocks.flatMap(b=>b.segments).some(s=>s.bumper));
});
test('saved bumper plans use version 3 and network skip advances only this bumper',()=>{
  const c=catalog(), now=S.ANCHOR+61000;
  const plans=USBTvPlans.reconcile(c,{},now);
  assert.equal(plans.A.active.schedule_version,3);
  const before=S.locate(S.build({...c,broadcasts:plans},'A'),now);
  assert(before.segment.bumper);
  const advanced=USBTvPlans.advance(c,plans,'A','skip',now);
  assert.equal(S.locate(S.build({...c,broadcasts:advanced},'A'),now).segment.video.type,'advert');
});

test('bumper classification exports and imports preserve the return-to-programmes role',()=>{
  const suggestions=require('../web/suggestions.js'), c=catalog();
  const video=c.videos.find(v=>v.id==='in');Object.assign(video,{genres:[],tags:[],title:'Back soon',file:'Videos/in.mp4'});
  const rows=suggestions.importText(JSON.stringify([{id:'in',type:'bumper',bumper_role:'from_ads'}]),c,{mode:'replace'}).found;
  const csv=suggestions.exportCsv(rows,c);
  const imported=suggestions.importText(csv,c,{mode:'replace'});
  assert.equal(imported.found[0].type,'bumper');assert.equal(imported.found[0].bumper_role,'from_ads');
  assert.equal(suggestions.importText(JSON.stringify([{id:'in',bumper_role:'bad'}]),c).skipped.length,1);
});

test('Both bumpers are eligible at each end and multiple opening bumpers rotate',()=>{
  const c=catalog();c.videos=c.videos.filter(v=>v.type!=="bumper");
  c.videos.push(clip('both','bumper',2,{bumper_role:'both'}));
  let line=S.buildCycle(c,'A','test',0);
  assert.deepEqual(line.blocks[0].segments.filter(s=>s.bumper).map(s=>s.video.id),['both','both','both','both']);
  c.videos.push(clip('opening','bumper',3,{bumper_role:'to_ads'}));
  line=S.buildCycle(c,'A','test',0);
  const bumpers=line.blocks[0].segments.filter(s=>s.bumper);
  assert.notEqual(bumpers[0].video.id,bumpers[2].video.id);
  assert.equal(bumpers[1].video.id,'both');assert.equal(bumpers[3].video.id,'both');
  const suggestions=require('../web/suggestions.js');
  assert.equal(suggestions.importText(JSON.stringify([{id:'both',type:'bumper',bumper_role:'both'}]),c,{mode:'replace'}).found[0].bumper_role,'both');
});
