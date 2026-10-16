const {test}=require('node:test');
const assert=require('node:assert/strict');
const S=require('../suggestions.js');
const video=(id,file,extra={})=>({id,file,title:'',genres:[],channels:[],tags:[],type:'programme',...extra});
const catalog={genres:['Comedy','Science'],channels:[{name:'Comedy'},{name:'Explore'}],videos:[video('000001','Videos/Comedy/messy_42.mp4'),video('000002','Videos/other.mp4')]};
test('folder genre produces a channel suggestion without using filename as title',()=>{
  const suggestion=S.suggest(catalog.videos[0],catalog);
  assert.deepEqual(suggestion.genres,['Comedy']);
  assert.deepEqual(suggestion.channels,['Comedy']);
  assert.equal(suggestion.title,'');
  assert.equal(suggestion.selected,false);
});
test('existing labels preserved and keywords match complete words',()=>{
  const item=video('1','Videos/Comedy/scientific.mp4',{genres:['History'],channels:['Explore']});
  const result=S.suggest(item,catalog);
  assert.deepEqual(result.genres,['History']);
  assert.deepEqual(result.channels,['Explore']);
  assert.deepEqual(S.suggest(video('2','Videos/scientific.mp4'),catalog).genres,[]);
});
test('custom rules and same-folder consensus offer explainable assignments',()=>{
  const rules=S.parseRules('kurzgesagt => Science, Animation | Explore');
  assert.deepEqual(S.suggest(video('3','Videos/kurzgesagt_foo.mp4'),{...catalog,label_rules:rules}).channels,['Explore']);
  const peers=[video('4','Videos/Moss/a.mp4',{genres:['Nature'],channels:['Explore']}),video('5','Videos/Moss/b.mp4',{genres:['Nature'],channels:['Explore']})];
  const result=S.suggest(video('6','Videos/Moss/c.mp4'),{...catalog,videos:peers});
  assert.deepEqual(result.genres,['Nature']);
  assert(result.reasons.some(reason=>reason.includes('2 files')));
  assert.throws(()=>S.parseRules('not a rule'),/use keyword/);
});
test('CSV supports quotes, commas and multiline cells and roundtrips a template',()=>{
  const row={id:'000001',title:'A "good", title\nSecond line',genres:['Comedy','Science'],channels:['Comedy']};
  const text=S.exportCsv([row],catalog);
  const parsed=S.importText(text,catalog);
  assert.equal(parsed.found.length,1);
  assert.equal(parsed.found[0].title,row.title);
  assert.deepEqual(parsed.found[0].genres,['Comedy','Science']);
  assert.throws(()=>S.parseCsv('id,title\n1,"unterminated'),/unclosed/);
});
test('imports match numeric IDs, keep fields not provided and skip ambiguous files',()=>{
  const data={...catalog,videos:[...catalog.videos,video('000003','Adverts/other.mp4')]};
  const result=S.importText(JSON.stringify([{id:1,genres:['Nature']},{file:'other.mp4',channels:['Explore']},{id:'999',genres:['Nope']},{id:1,title:'Duplicate'}]),data);
  assert.equal(result.found.length,1);
  assert.equal(result.skipped.length,3);
  assert.deepEqual(result.found[0].genres,['Nature']);
  assert.equal(result.found[0].selected,false);
});
test('CSV missing columns, malformed rows and unsupported JSON are rejected',()=>{
  assert.throws(()=>S.importText('title,genres\nHello,Comedy',catalog),/id or file/);
  assert.throws(()=>S.importText('id,genres\n1,Comedy,Nature',catalog),/wrong number/);
  assert.throws(()=>S.importText('{"videos":[]}',catalog),/suggestions array/);
});
test('case variations do not create duplicate suggested genre names',()=>{
  const suggestion=S.suggest(video('1','Videos/Comedy/test.mp4'),{...catalog,genres:['comedy']});
  assert.deepEqual(suggestion.genres,['comedy']);
});
