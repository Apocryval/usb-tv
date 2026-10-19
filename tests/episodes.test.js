const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const S = require('../web/schedule.js');
const context = {USBTvSchedule:S,structuredClone,crypto:require('node:crypto').webcrypto};
vm.runInNewContext(fs.readFileSync(require.resolve('../web/schedule-plans.js'),'utf8'),context);
const P = context.USBTvPlans;
const video = {id:'000001',file:'Videos/season.mp4',title:'Season',fingerprint:'same',duration:3600,
  type:'programme',channels:['A'],episode_review:'multiple',breaks_approved:true,break_points:[600,1800,2500],
  episodes:[{title:'First',start:0,end:1500},{title:'Second',start:1600,end:3600}]};
const catalog = {videos:[video],channels:[{name:'A'}],settings:{ad_length:0}};

test('episodes have separate guide blocks and seek into the unchanged source file',()=>{
  const line = S.buildCycle(catalog,'A','A',0);
  assert.equal(line.duration,3500);
  assert.deepEqual(line.blocks.map(block=>block.video.title),['First','Second']);
  const second = S.locate(line,1500000);
  assert.equal(second.position,1600);
  assert.equal(second.segment.video.file,video.file);
  assert.equal(S.locate(line,3499000).position,3599);
  assert.equal(S.locate(line,3500000).position,0);
});

test('approved advert points are rebased within each episode',()=>{
  const episodes = S.episodeProgrammes(video);
  assert.deepEqual(episodes.map(item=>item.break_points),[[600],[200,900]]);
  const ad = {id:'ad',type:'advert',channels:[],duration:30};
  const line = S.buildCycle({...catalog,videos:[video,ad],settings:{ad_interval:60,ad_length:30}},'A','A',0);
  const second = line.blocks[1];
  assert.equal(second.segments[0].offset,1600);
  assert.equal(second.segments.find(segment=>!segment.advert && segment.offset===1800).duration,700);
});

test('single and unchecked long files remain one whole programme',()=>{
  for(const episode_review of ['single','unchecked',undefined]) {
    const line = S.buildCycle({...catalog,videos:[{...video,episode_review}]},'A','A',0);
    assert.equal(line.blocks.length,1);
    assert.equal(line.duration,3600);
  }
});

test('new markers wait for the pending lineup; frozen old broadcasts remain whole',()=>{
  const now = Date.UTC(2026,9,16,12);
  const original = {...catalog,videos:[{...video,episode_review:'single'}]};
  const stored = P.reconcile(original,{},now);
  const updated = P.reconcile(catalog,stored,now);
  assert(updated.A.pending);
  const line = S.build({...catalog,broadcasts:updated},'A');
  assert.equal(line.active.blocks.length,1);
  assert.equal(line.pending.blocks.length,2);
  assert.equal(S.locate(line,updated.A.pending.anchor).block.video.title,'First');
});

test('admin skip ends the selected episode and lands on the next episode offset',()=>{
  const now = Date.UTC(2026,9,16,12);
  const stored = P.reconcile(catalog,{},now);
  stored.A.active.anchor=now-100000;
  const updated = P.advance(catalog,stored,'A','skip',now);
  const current=S.locate(S.build({...catalog,broadcasts:updated},'A'),now);
  assert.equal(current.block.video.title,'Second');
  assert(Math.abs(current.position-1600)<.01);
});

test('version 4 shuffles individual episodes with other programmes and retains source offsets',()=>{
  const season={...video,duration:800,break_points:[],episodes:Array.from({length:8},(_,i)=>({title:`Episode ${i}`,start:i*100,end:(i+1)*100}))};
  const other={id:'other',type:'programme',channels:['A'],duration:100};
  const c={...catalog,videos:[season,other]};
  const line=S.buildCycle(c,'A','episode-test',0,4);
  const expected=S.shuffled(c.videos.flatMap(S.episodeProgrammes),'episode-test');
  assert.deepEqual(line.blocks.map(b=>[b.video.id,b.video.episode_index]),expected.map(v=>[v.id,v.episode_index]));
  assert.equal(line.blocks.length,9);
  assert.equal(line.duration,900);
  assert.equal(new Set(line.blocks.map(b=>`${b.video.id}:${b.video.episode_index}`)).size,9);
  assert.notDeepEqual(line.blocks.filter(b=>b.video.id===season.id).map(b=>b.video.episode_index),[0,1,2,3,4,5,6,7]);
  const otherIndex=line.blocks.findIndex(b=>b.video.id==='other');
  assert(otherIndex>0 && otherIndex<line.blocks.length-1);
  for(const block of line.blocks.filter(b=>b.video.id===season.id)) {
    const located=S.locate(line,block.start*1000+1000);
    assert.equal(located.position,block.video.episode_index*100+1);
    assert.equal(located.segment.video.file,season.file);
  }
  assert.deepEqual(S.buildCycle(c,'A','episode-test',0,4),line);
});

test('episode shuffle upgrade preserves frozen clocks until a queued boundary or explicit reshuffle',()=>{
  const now=S.ANCHOR+100000;
  const stored=P.reconcile(catalog,{},now);
  stored.A.active.schedule_version=3;
  const original=JSON.stringify(stored.A.active);
  const before=S.locate(S.build({...catalog,broadcasts:stored},'A'),now);
  const updated=P.reconcile(catalog,stored,now);
  assert.equal(JSON.stringify(updated.A.active),original);
  assert.equal(updated.A.pending.schedule_version,4);
  assert.equal(S.locate(S.build({...catalog,broadcasts:updated},'A'),now).position,before.position);
  const shuffled=P.reshuffle(catalog,updated,'A',now);
  assert.equal(shuffled.A.active.schedule_version,4);
  assert.equal(shuffled.A.active.anchor,now);
  assert.equal(shuffled.A.pending,null);
  assert.equal(JSON.stringify(P.reconcile(catalog,JSON.parse(JSON.stringify(shuffled)),now+1)),JSON.stringify(shuffled));
});
