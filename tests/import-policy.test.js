const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const S=require('../web/suggestions.js');
const video={id:'000001',file:'Videos/test.mp4',fingerprint:'same',title:'My title',type:'programme',
  genres:['Comedy'],channels:['TTTV'],tags:['My tag'],description:'My description',tagline:'My hook',tagline_goblin:'My goblin hook'};
const incoming={id:'000001',file:video.file,fingerprint:'same',title:'AI title',type:'advert',
  genres:['Music'],channels:[],tags:[],description:'AI description',tagline:'',tagline_goblin:''};

test('imports protect all assigned fields by default without merging arrays or changing type',()=>{
  const original=JSON.stringify(video);
  const result=S.importText(JSON.stringify([incoming]),{videos:[video]});
  assert.equal(result.found.length,1);assert.equal(result.protectedRows.length,1);
  for(const field of ['title','type','genres','channels','tags','description','tagline','tagline_goblin'])assert.deepEqual(result.found[0][field],video[field]);
  assert.equal(result.found[0].selected,false);assert.equal(JSON.stringify(video),original);
  assert(result.found[0].reasons.some(r=>r.startsWith('Kept existing fields:')));
});

test('safe imports fill genuinely empty fields but keep unrestricted advert channels',()=>{
  const empty={id:'000001',file:video.file,fingerprint:'same',title:'Existing scanned title',type:'programme',genres:[],channels:[],tags:[],description:''};
  const result=S.importText(JSON.stringify([{...incoming,tags:['physics'],channels:['TTTV']}]),{videos:[empty]}).found[0];
  assert.equal(result.title,empty.title);assert.equal(result.type,'programme');
  assert.deepEqual(result.genres,['Music']);assert.deepEqual(result.channels,['TTTV']);assert.deepEqual(result.tags,['physics']);assert.equal(result.description,'AI description');
  const ad=S.importText(JSON.stringify([{...incoming,channels:['TTTV']}]),{videos:[{...empty,type:'advert'}]}).found[0];
  assert.deepEqual(ad.channels,[]);
});

test('skip categorised ignores labelled rows, while replacement requires an explicit option',()=>{
  const skip=S.importText(JSON.stringify([incoming]),{videos:[video]},{mode:'skip-labelled'});
  assert.equal(skip.found.length,0);assert.equal(skip.skipped.length,0);assert.equal(skip.protectedRows[0].skipped,true);
  const replaced=S.importText(JSON.stringify([incoming]),{videos:[video]},{mode:'replace'}).found[0];
  assert.equal(replaced.title,'AI title');assert.equal(replaced.type,'advert');assert.deepEqual(replaced.channels,[]);assert.equal(replaced.tagline,'');assert.equal(replaced.selected,false);
  const omitted=S.importText(JSON.stringify([{id:video.id,description:'New description'}]),{videos:[video]},{mode:'replace'}).found[0];
  assert.equal(omitted.title,video.title);assert.deepEqual(omitted.channels,video.channels);
  assert.throws(()=>S.importText('[]',{videos:[]},{mode:'invalid'}),/conflict policy/);
});

test('all import policies retain content identity validation',()=>{
  for(const mode of ['preserve','skip-labelled','replace']) {
    const result=S.importText(JSON.stringify([{...incoming,fingerprint:'changed'}]),{videos:[video]},{mode});
    assert.equal(result.found.length,0);assert.equal(result.skipped.length,1);
  }
});

test('UI import protects edited drafts while leaving saved catalogue unchanged and imported rows unselected',async()=>{
  const source=fs.readFileSync(require.resolve('../web/app.js'),'utf8');
  const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:''});return nodes.get(id);};
  get('#bulk-import-policy').value='preserve';
  const original=JSON.stringify(video);
  const context={state:{catalog:{videos:[video]}},bulkRows:[{...video,title:'Unsaved manual edit',selected:false,edited:true}],
    bulkView:{page:0},USBTvSuggestions:S,$:get,resetMediaFilters(){},renderBulkRows(){},updateBulkSummary(){}};
  vm.runInNewContext(source.slice(source.indexOf('async function importBulkFile('),source.indexOf('function updateImportPolicyNote()')),context);
  await context.importBulkFile({target:{files:[{size:100,async text(){return JSON.stringify([incoming]);}}],value:'file'}});
  assert.equal(context.bulkRows[0].title,'Unsaved manual edit');
  assert.equal(context.bulkRows[0].selected,false);assert.equal(JSON.stringify(video),original);
  assert.equal(get('#bulk-error').textContent,'');
  context.bulkRows=[{...video,title:'',channels:[],selected:false,edited:true,editedFields:['title','channels']}];
  await context.importBulkFile({target:{files:[{size:100,async text(){return JSON.stringify([{...incoming,channels:['AI channel']}]);}}],value:'file'}});
  assert.equal(context.bulkRows[0].title,'');assert.deepEqual(context.bulkRows[0].channels,[]);
  await context.importBulkFile({target:{files:[{size:100,async text(){return JSON.stringify([incoming]);}}],value:'file'}});
  assert.equal(context.bulkRows[0].title,'');assert.deepEqual(context.bulkRows[0].channels,[]);
});
