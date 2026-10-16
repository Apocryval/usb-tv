const {test} = require('node:test');
const assert = require('node:assert/strict');
const S = require('../schedule.js');
const media = (id, duration, extra={}) => ({id, duration, title:id, type:'programme', channels:['Bin TV'], enabled:true, ...extra});
const catalog = videos => ({videos, channels:[{name:'Bin TV'}], settings:{ad_interval:900, ad_length:60}});

test('tuning five minutes in resolves a media position of exactly 300 seconds', () => {
  const timeline = S.build(catalog([media('p',1800)]),'Bin TV');
  const current = S.locate(timeline,timeline.anchor+300000);
  assert.equal(current.position,300);
  assert.equal(current.segment.video.id,'p');
  assert.equal(current.start,timeline.anchor);
});
test('approved internal break includes ads in guide and resumes content at its break point', () => {
  const timeline = S.build(catalog([media('p',1800,{break_points:[900],breaks_approved:true}),media('a',30,{type:'advert',channels:[]}),media('b',30,{type:'advert',channels:[]})]),'Bin TV');
  assert.equal(S.locate(timeline,timeline.anchor+915000).segment.advert,true);
  assert.equal(S.locate(timeline,timeline.anchor+915000).position,15);
  const resumed = S.locate(timeline,timeline.anchor+960000);
  assert.equal(resumed.segment.advert,false);
  assert.equal(resumed.position,900);
  const guide = S.guide(timeline,timeline.anchor+915000);
  assert.equal(guide[0].video.id,'p');
  assert.equal(guide[0].end,timeline.anchor+1920000);
  assert(guide.every(slot => slot.video.type !== 'advert'));
  assert.notEqual(timeline.blocks[0].segments[1].video.id,timeline.blocks[0].segments[2].video.id);
});
test('unapproved points are not used and ads wait for the ending', () => {
  const timeline = S.build(catalog([media('p',1800,{break_points:[900],breaks_approved:false}),media('a',60,{type:'advert',channels:[]})]),'Bin TV');
  assert.equal(S.locate(timeline,timeline.anchor+1000000).position,1000);
  assert.equal(S.locate(timeline,timeline.anchor+1810000).segment.advert,true);
});
test('short library accumulates interval across programme rotations', () => {
  const timeline = S.build(catalog([media('p',300),media('a',60,{type:'advert',channels:[]})]),'Bin TV');
  assert.equal(S.locate(timeline,timeline.anchor+899000).segment.advert,false);
  assert.equal(S.locate(timeline,timeline.anchor+900000).segment.advert,true);
});
test('missing, disabled and unmeasured media excluded; ad eligibility respected', () => {
  const timeline = S.build(catalog([media('p',1800),media('missing',50,{missing:true}),media('disabled',50,{enabled:false}),media('unknown',0),media('other-ad',60,{type:'advert',channels:['Other']})]),'Bin TV');
  assert.equal(timeline.blocks.length,1);
  assert.equal(timeline.duration,1800);
  assert.equal(S.locate(S.build(catalog([]),'Bin TV')),null);
});
test('zero ad length disables ads; timeline continues across midnight and cycles', () => {
  const data = catalog([media('p',1800),media('a',30,{type:'advert',channels:[]})]);
  data.channels[0].ad_length=0;
  const timeline=S.build(data,'Bin TV');
  assert.equal(timeline.duration,1800);
  assert.equal(S.locate(timeline,timeline.anchor+1800000).position,0);
  assert.equal(S.locate(timeline,timeline.anchor+86400000+300000).position,300);
  assert.equal(S.locate(timeline,timeline.anchor-1000).position,1799);
});
test('advert sequence avoids immediate repeats across rotation boundaries', () => {
  const data=catalog([media('p',900),...['a','b','c'].map(id=>media(id,60,{type:'advert',channels:[]}))]);
  const timeline=S.build(data,'Bin TV');
  const ads=timeline.blocks.flatMap(block=>block.segments.filter(segment=>segment.advert));
  assert(ads.length >= 4);
  for(let i=1;i<ads.length;i++) assert.notEqual(ads[i].video.id,ads[i-1].video.id);
  assert.notEqual(ads[0].video.id,ads.at(-1).video.id);
});
