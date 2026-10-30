const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/app.js','utf8');
function fixture() {
  const context={syncRemovalData:{videos:{old:{excluded:true}}},displayTitle:v=>v.title};
  vm.runInNewContext(source.slice(source.indexOf('function removalFor('),source.indexOf('function renderCollection(')),context);
  return context;
}
const videos=[
  {id:'1',title:'Science night',file:'Videos/one.mp4',fingerprint:'old',genres:['Science'],tags:['space'],duration:120},
  {id:'2',title:'Cartoon hour',file:'Videos/two.mp4',fingerprint:'new',genres:['Animation'],description:'A moon adventure',duration:60},
  {id:'3',title:'Lost reel',file:'Videos/three.mp4',fingerprint:'lost',missing:true,duration:180},
];
test('browsing keeps missing files out of available and searches descriptive metadata',()=>{
  const c=fixture();
  assert.deepEqual(Array.from(c.collectionMatches(videos),v=>v.id),['2','1']);
  assert.deepEqual(Array.from(c.collectionMatches(videos,{query:'MOON'}),v=>v.id),['2']);
  assert.deepEqual(Array.from(c.collectionMatches(videos,{query:'space'}),v=>v.id),['1']);
  assert.deepEqual(Array.from(c.collectionMatches(videos,{filter:'missing'}),v=>v.id),['3']);
});
test('USB marks follow content and undo updates the marked filter immediately',()=>{
  const c=fixture();
  assert.deepEqual(Array.from(c.collectionMatches(videos,{filter:'marked'}),v=>v.id),['1']);
  const replaced={...videos[0],fingerprint:'replacement'};
  assert.equal(c.removalFor(replaced),undefined);
  c.syncRemovalData.videos.old.excluded=false;
  assert.equal(c.collectionMatches(videos,{filter:'marked'}).length,0);
});
test('genre, text and sorting compose without mutating the catalogue',()=>{
  const c=fixture();
  assert.deepEqual(Array.from(c.collectionMatches(videos,{filter:'all',genre:'Science',query:'night'}),v=>v.id),['1']);
  assert.deepEqual(Array.from(c.collectionMatches(videos,{filter:'all',sort:'duration'}),v=>v.id),['3','1','2']);
  assert.deepEqual(videos.map(v=>v.id),['1','2','3']);
});

test('playback issue filter includes scan warnings and decode failures, excluding checked and missing files',()=>{
  const c=fixture();
  const items=[...videos,{id:'bad',title:'Incomplete',file:'Videos/bad.mkv',playback_check:{status:'error',issues:[{message:'Decode failed'}]}},
    {id:'codec',title:'Dolby',file:'Videos/dolby.mkv',playback_check:{status:'warning',issues:[{message:'Dolby audio may be silent'}]}},
    {id:'good',title:'Checked',file:'Videos/checked.mp4',playback_check:{status:'checked',issues:[]}},
    {id:'missing',title:'Missing',missing:true,playback_check:{status:'error',issues:[{message:'Decode failed'}]}}];
  assert.deepEqual(Array.from(c.collectionMatches(items,{filter:'playback'}),v=>v.id),['codec','bad']);
  assert.deepEqual(Array.from(c.collectionMatches(items,{filter:'failed-playback'}),v=>v.id),['bad']);
});
