const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const S = require('../web/schedule.js');
const context = {USBTvSchedule:S,structuredClone,crypto:require('node:crypto').webcrypto};
vm.runInNewContext(fs.readFileSync(require.resolve('../web/schedule-plans.js'),'utf8'),context);
const P = context.USBTvPlans;
const now = Date.UTC(2026,9,16,12);
const video = (id,duration=300,extra={})=>({id,duration,fingerprint:id,type:'programme',channels:['A'],enabled:true,...extra});
function fixture(videos=[video('one'),video('two')]) {
  const catalog={settings:{ad_interval:900,ad_length:0},channels:[{name:'A',ad_length:0},{name:'B',ad_length:0}],videos:[...videos,video('other',300,{channels:['B']})]};
  const plans=P.reconcile(catalog,{},now);
  for(const plan of Object.values(plans))plan.active.anchor=now-100000;
  return {catalog,plans};
}
const line=(catalog,plans)=>S.build({...catalog,broadcasts:plans},'A');
test('forward advances the selected channel exactly 30 seconds and keeps other channels unchanged',()=>{
  const {catalog,plans}=fixture(),original=JSON.stringify(plans);
  const before=S.locate(line(catalog,plans),now);
  const updated=P.advance(catalog,plans,'A','forward',now);
  const after=S.locate(line(catalog,updated),now);
  assert.equal(after.segment.video.id,before.segment.video.id);
  assert.equal(after.position-before.position,30);
  assert.equal(JSON.stringify(updated.B),JSON.stringify(plans.B));
  assert.equal(JSON.stringify(plans),original);
});
test('skip moves to the next programme at its start, including a one-programme loop',()=>{
  for(const videos of [[video('one'),video('two')],[video('only')]]) {
    const {catalog,plans}=fixture(videos);
    const current=S.locate(line(catalog,plans),now);
    const expected=S.locate(line(catalog,plans),current.end+.5);
    const updated=P.advance(catalog,plans,'A','skip',now);
    const after=S.locate(line(catalog,updated),now);
    assert.equal(after.segment.video.id,expected.segment.video.id);
    assert(Math.abs(after.position)<.01);
  }
});
test('skipping during an advert skips just that advert',()=>{
  const {catalog,plans}=fixture([
    video('show',300,{breaks_approved:true,break_points:[60]}),
    video('ad1',30,{type:'advert'}),video('ad2',30,{type:'advert'})]);
  catalog.channels[0]={name:'A',ad_interval:60,ad_length:60};
  const initial=P.reconcile(catalog,{},now);initial.A.active.anchor=now-65000;
  const current=S.locate(line(catalog,initial),now);
  assert.equal(current.segment.advert,true);
  const expected=S.locate(line(catalog,initial),current.segmentEnd+.5);
  const updated=P.advance(catalog,initial,'A','skip',now);
  const after=S.locate(line(catalog,updated),now);
  assert.equal(after.segment.video.id,expected.segment.video.id);
  assert(Math.abs(after.position)<.01);
});
test('advancing across a pending lineup boundary adopts the pending lineup',()=>{
  const {catalog,plans}=fixture([video('long',10800)]);
  catalog.videos.push(video('new',300));
  const pending=P.reconcile(catalog,plans,now);
  assert(pending.A.pending);
  const current=S.locate(line(catalog,pending),now);
  const expected=S.locate(line(catalog,pending),current.end+.5);
  const updated=P.advance(catalog,pending,'A','skip',now);
  assert.equal(updated.A.pending,null);
  const after=S.locate(line(catalog,updated),now);
  assert.equal(after.segment.video.id,expected.segment.video.id);
  assert(Math.abs(after.position)<.01);
});
test('saved plan preserves the advanced playhead after reload',()=>{
  const {catalog,plans}=fixture();
  const updated=P.advance(catalog,plans,'A','forward',now);
  const restored=JSON.parse(JSON.stringify(updated));
  assert.equal(S.locate(line(catalog,restored),now+1000).position,S.locate(line(catalog,updated),now).position+1);
});

test('shuffle all restarts every channel together, includes pending labels and survives reload',()=>{
  const {catalog,plans}=fixture();
  catalog.videos.push(video('pending'));
  const pending=P.reconcile(catalog,plans,now), original=JSON.stringify(pending);
  const updated=P.reshuffleAll(catalog,pending,now);
  for(const name of ['A','B']) {
    assert.equal(updated[name].active.anchor,now);
    assert.notEqual(updated[name].active.seed,pending[name].active.seed);
    assert.equal(updated[name].pending,null);
    assert.equal(updated[name].active.schedule_version,2);
    const restored=P.reconcile(catalog,JSON.parse(JSON.stringify(updated)),now+1000);
    assert.equal(JSON.stringify(restored[name]),JSON.stringify(updated[name]));
    assert.equal(S.locate(S.build({...catalog,broadcasts:restored},name),now+1000).position,1);
  }
  assert(updated.A.active.snapshot.videos.some(v=>v.id==='pending'));
  assert.equal(JSON.stringify(pending),original);
});
test('legacy clocks keep their original schedule until a queued full-cycle boundary',()=>{
  const {catalog,plans}=fixture();
  delete plans.A.active.schedule_version;
  const before=S.locate(line(catalog,plans),now);
  const migrated=P.reconcile(catalog,plans,now);
  assert.equal(JSON.stringify(migrated.A.active),JSON.stringify(plans.A.active));
  assert(migrated.A.pending.anchor>=now+3600000);
  assert.equal(migrated.A.pending.schedule_version,2);
  assert.equal(S.locate(line(catalog,migrated),now).position,before.position);
  assert.equal(P.reconcile(catalog,migrated,now+1000).A.pending.anchor,migrated.A.pending.anchor);
});
