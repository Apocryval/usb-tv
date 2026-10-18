const {test} = require('node:test');
const assert = require('node:assert/strict');
const S = require('../schedule.js');
const media = (id, duration, extra={}) => ({id, duration, title:id, type:'programme', channels:['Bin TV'], enabled:true, ...extra});
const catalog = videos => ({videos, channels:[{name:'Bin TV'}], settings:{ad_interval:900, ad_length:60}});

test('live guide starts with the current programme even after several short shows in a half-hour', () => {
  const line = S.buildCycle(catalog([media('a',180),media('b',240),media('c',300)]),'Bin TV','test',0);
  for (const now of [1, 600000, 1799999, 1800000, 1800001, 2130000]) {
    const window = S.guideWindow(now,120);
    const slots = S.guide(line,window.start,(window.end-window.start)/1000);
    assert.equal(slots[0].video.id,S.locate(line,now).block.video.id);
    assert(slots.every(slot=>slot.end > now));
    assert.equal(window.start,now);
    assert.equal(window.end-now,7200000);
  }
});

test('live guide advances by elapsed time across a half-hour boundary without jumping a page', () => {
  const before=S.guideWindow(1799999,30), after=S.guideWindow(1800001,30);
  assert.equal(after.start-before.start,2);
  assert.equal(after.end-before.end,2);
});

test('future browsing remains fixed until the live clock reaches it', () => {
  assert.deepEqual(S.guideWindow(1000,60,1800000),{start:1800000,end:5400000,live:false});
  assert.deepEqual(S.guideWindow(50000,60,1800000),{start:1800000,end:5400000,live:false});
  assert.deepEqual(S.guideWindow(1800000,60,1800000),{start:1800000,end:5400000,live:true});
});

test('live ruler starts with Now and retains actual clock-aligned future ticks', () => {
  const start=Date.UTC(2026,9,16,12,17,43),end=start+7200000;
  const ticks=S.guideTicks(start,end,900,true);
  assert.equal(ticks[0].now,true);
  assert.equal(ticks[0].time,start);
  assert.equal(ticks.at(-1).time,end);
  assert(ticks.slice(1,-1).every(tick=>tick.time%1800000===0));
  assert(ticks.every((tick,index)=>index===0 || tick.time>ticks[index-1].time));
});

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

test('advert breaks never end a repeating lineup midway through its programme rotation',()=>{
  const data=catalog([media('p1',90,{break_points:[30,60],breaks_approved:true}),
    media('p2',75,{break_points:[30,60],breaks_approved:true}),media('ad',5,{type:'advert',channels:[]})]);
  data.channels[0].ad_interval=60;data.channels[0].ad_length=5;
  for(const seed of ['Cartoons','A','B']) {
    const line=S.buildCycle(data,'Bin TV',seed,0);
    assert.equal(line.blocks.length%2,0);
    assert.notEqual(line.blocks[0].video.id,line.blocks.at(-1).video.id);
    assert.notEqual(S.locate(line,line.duration*1000-1).block.video.id,S.locate(line,line.duration*1000).block.video.id);
  }
});
