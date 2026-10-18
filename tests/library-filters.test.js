const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const S=require('../suggestions.js');
const videos=[
  {id:'000001',title:'Quantum physics',file:'Videos/science.mp4',duration:3000,type:'programme',genres:['Education'],channels:['TTTV'],tags:['physics','Science'],enabled:true},
  {id:'000002',title:'Music night',file:'Videos/physics.mp4',duration:60,type:'programme',genres:['Music'],channels:[],tags:['Music'],enabled:false},
  {id:'000003',title:'An advert',duration:30,type:'advert',genres:[],channels:[],tags:[]},
  {id:'000004',title:'Unknown',duration:0,type:'programme',genres:[],channels:[],tags:[]},
  {id:'000005',title:'Long show',duration:3600,type:'programme',genres:[],channels:['A','TTTV'],tags:['physics'],episode_review:'multiple'},
];
const ids=rows=>rows.map(v=>v.id);

test('duration bounds are inclusive, accept decimal minutes and exclude unknown lengths',()=>{
  assert.deepEqual(ids(S.filterMedia(videos,{minMinutes:50,maxMinutes:50})),['000001']);
  assert.deepEqual(ids(S.filterMedia(videos,{maxMinutes:.5})),['000003']);
  assert.deepEqual(ids(S.filterMedia(videos,{minMinutes:0})),['000001','000002','000003','000005']);
  assert.equal(S.filterMedia(videos,{minMinutes:60,maxMinutes:50}).length,0);
  assert.equal(S.filterMedia(videos,{minMinutes:-1}).length,0);
  assert.equal(S.filterMedia(videos,{maxMinutes:'bad'}).length,0);
});

test('sorts numeric durations and IDs without modifying input, with unknown lengths last both ways',()=>{
  const original=JSON.stringify(videos);
  assert.deepEqual(ids(S.filterMedia(videos,{sort:'duration-desc'})),['000005','000001','000002','000003','000004']);
  assert.deepEqual(ids(S.filterMedia(videos,{sort:'duration-asc'})),['000003','000002','000001','000005','000004']);
  assert.equal(S.filterMedia(videos,{sort:'channel-count'})[0].id,'000005');
  assert.deepEqual(ids(S.filterMedia([{id:'10'},{id:'2'}],{sort:'id-asc'})),['2','10']);
  assert.equal(JSON.stringify(videos),original);
});

test('search can target a field; combined type, tags, genre, channel and enabled filters use intersections',()=>{
  assert.deepEqual(ids(S.filterMedia(videos,{search:'physics',searchField:'title'})),['000001']);
  assert.deepEqual(ids(S.filterMedia(videos,{search:'physics',searchField:'file'})),['000002']);
  assert.deepEqual(ids(S.filterMedia(videos,{search:'science',searchField:'tags'})),['000001']);
  assert.deepEqual(ids(S.filterMedia(videos,{tags:'PHYSICS,science',tagMode:'all',genre:'education',channel:'TTTV',type:'programme',enabled:'enabled',minMinutes:45})),['000001']);
  assert.deepEqual(ids(S.filterMedia(videos,{tags:'physics,Music',tagMode:'any'})),['000001','000002','000005']);
  assert.deepEqual(ids(S.filterMedia(videos,{tags:'phys'})),[],'tag filter matches whole names');
  assert.deepEqual(ids(S.filterMedia(videos,{enabled:'disabled'})),['000002']);
  assert.deepEqual(ids(S.filterMedia(videos,{channel:'Interdimensional Customs'})),['000002','000004']);
});

test('metadata status isolates missing copy, labels, unknown lengths and episode reviews',()=>{
  assert.deepEqual(ids(S.filterMedia(videos,{status:'unknown-length'})),['000004']);
  assert.deepEqual(ids(S.filterMedia(videos,{status:'no-channels'})),['000002','000004']);
  assert.deepEqual(ids(S.filterMedia(videos,{status:'multiple-episodes'})),['000005']);
  assert.equal(S.filterMedia(videos,{status:'episode-review'}).length,0);
  assert.equal(S.filterMedia([{duration:3001,type:'programme'}],{status:'episode-review'}).length,1);
  assert.equal(S.filterMedia([{title:' '},{title:'Filled'}],{status:'no-title'}).length,1);
  assert.equal(S.filterMedia([{description:' '},{description:'Filled'}],{status:'no-description'}).length,1);
});

test('bulk add/remove/replace preserves unrelated data and blank fields, with explicit type and enabled changes',()=>{
  const row={...videos[0],selected:true,description:'Keep me'};
  const added=S.assignLabels(row,{tags:'PHYSICS,new',type:'advert',enabled:'disabled'});
  assert.deepEqual(added.tags,['physics','Science','new']);assert.equal(added.type,'advert');assert.equal(added.enabled,false);
  assert.equal(added.description,'Keep me');assert.equal(added.selected,true);
  const removed=S.assignLabels(row,{tags:'SCIENCE',channels:'tttv'},'remove');
  assert.deepEqual(removed.tags,['physics']);assert.deepEqual(removed.channels,[]);assert.deepEqual(removed.genres,row.genres);
  const replaced=S.assignLabels(row,{tags:'one',genres:''},'replace');
  assert.deepEqual(replaced.tags,['one']);assert.deepEqual(replaced.genres,row.genres);
  assert.deepEqual(row.tags,['physics','Science']);
});

test('bulk filters use editable row labels plus catalogue duration and retain original selection objects',()=>{
  const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
  const nodes=new Map();
  const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:''});return nodes.get(id);};
  const rows=[{...videos[0],tags:['edited'],selected:true},{...videos[1],tags:['edited'],selected:false}];
  delete rows[0].duration;delete rows[1].duration;
  const context={state:{catalog:{videos}},bulkRows:rows,USBTvSuggestions:S,$:get};
  vm.runInNewContext(source.slice(source.indexOf('const mediaFilterFields='),source.indexOf('function filteredLibrary()'))+
    source.slice(source.indexOf('function filteredBulkRows()'),source.indexOf('function visibleBulkRows()')),context);
  get('#bulk-tags-filter').value='edited';get('#bulk-min-minutes').value='10';get('#bulk-sort').value='duration-desc';
  const matches=context.filteredBulkRows();
  assert.equal(matches.length,1);assert.strictEqual(matches[0],rows[0]);
  assert.equal(rows[1].selected,false);assert.equal(rows[0].selected,true);
});

test('bulk manipulation updates only selected previews and clears pending controls without writing catalogue data',()=>{
  const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
  const nodes=new Map();
  const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:''});return nodes.get(id);};
  const rows=[{...videos[0],selected:true},{...videos[1],selected:false}];
  const before=JSON.stringify(videos),unselected=JSON.stringify(rows[1]);let rendered=0;
  const context={bulkRows:rows,USBTvSuggestions:S,$:get,renderBulkRows(){rendered++;}};
  vm.runInNewContext(source.slice(source.indexOf('function assignBulk()'),source.indexOf('async function applyBulk(')),context);
  get('#bulk-tags').value='Science';get('#bulk-mode').value='remove';get('#bulk-enabled').value='disabled';
  context.assignBulk();
  assert.deepEqual(rows[0].tags,['physics']);assert.equal(rows[0].enabled,false);
  assert.equal(JSON.stringify(rows[1]),unselected);assert.equal(JSON.stringify(videos),before);
  assert.equal(get('#bulk-tags').value,'');assert.equal(get('#bulk-enabled').value,'');assert.equal(rendered,1);
});
