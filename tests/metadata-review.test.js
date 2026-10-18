const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const S=require('../web/suggestions.js');

test('legacy review drafts lose generated taglines without losing approvals or edits',()=>{
  const html=fs.readFileSync(require.resolve('../metadata-studio/review.html'),'utf8');
  const source=html.match(/^function withoutTaglines\(value\).+$/m)[0];
  const context={};vm.runInNewContext(source,context);
  const original={version:1,suggestions:[{id:'000001',title:'Edited title',description:'Human edit',approved:true,
    channels:['A'],tags:['Disney'],tagline:'AI slogan',tagline_goblin:'AI goblin slogan'}]};
  const cleaned=JSON.parse(JSON.stringify(context.withoutTaglines(original)));
  assert.equal(cleaned.suggestions[0].approved,true);
  assert.equal(cleaned.suggestions[0].description,'Human edit');
  assert.deepEqual(cleaned.suggestions[0].tags,['Disney']);
  assert(!Object.hasOwn(cleaned.suggestions[0],'tagline'));
  assert(!Object.hasOwn(cleaned.suggestions[0],'tagline_goblin'));
  const imported=S.importText(JSON.stringify(cleaned),{videos:[{id:'000001',file:'Videos/test.mp4',type:'programme',
    tagline:'Existing manually written hook',tagline_goblin:'Existing manual goblin hook'}]});
  assert.equal(imported.found[0].tagline,'Existing manually written hook');
  assert.equal(imported.found[0].tagline_goblin,'Existing manual goblin hook');
});

test('approve all preserves edits, updates checkboxes and exports; later edits unapprove only that row',async()=>{
  const html=fs.readFileSync(require.resolve('../metadata-studio/review.html'),'utf8');
  const nodes=new Map();
  const element=tag=>({tag,children:[],style:{},append(...items){this.children.push(...items);},
    replaceChildren(...items){this.children=items;},click(){}});
  const get=id=>{if(!nodes.has(id))nodes.set(id,element(id));return nodes.get(id);};
  const fixture={suggestions:[{id:'000001',title:'Edited title',description:'User copy',approved:true,tagline:'Old hook'},
    {id:'000002',title:'Second',approved:false}]};
  let downloaded;
  const context={document:{getElementById:get,createElement:element},Blob,
    URL:{createObjectURL(blob){downloaded=blob;return 'blob:test';},revokeObjectURL(){}},setTimeout(){}};
  const script=html.match(/<script>([\s\S]*?)<\/script>/)[1].replace('/*REPORT_DATA*/null',JSON.stringify(fixture));
  vm.runInNewContext(script,context);
  get('approve-all').onclick();
  assert.equal(get('status').textContent,'2 approved / 2 suggestions');
  assert.equal(get('approve-all').disabled,true);
  const articles=get('rows').children;
  assert(articles.every(article=>article.children[0].children[0].checked));
  get('export').onclick();
  const exported=JSON.parse(await downloaded.text());
  assert.equal(exported.suggestions.length,2);
  assert.equal(exported.suggestions[0].description,'User copy');
  assert.equal(exported.suggestions[0].title,'Edited title');
  assert(!Object.hasOwn(exported.suggestions[0],'tagline'));
  const titleInput=articles[0].children[3].children[0].children[0];
  titleInput.value='Changed again';titleInput.oninput();
  assert.equal(get('status').textContent,'1 approved / 2 suggestions');
  assert.equal(get('approve-all').disabled,false);
  assert.equal(articles[0].children[0].children[0].checked,false);
  assert.equal(articles[1].children[0].children[0].checked,true);
  get('export').onclick();
  assert.equal(JSON.parse(await downloaded.text()).suggestions[0].id,'000002');
  get('load').onchange({target:{files:[{async text(){return '{"suggestions":[]}';}}],value:'draft'}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(get('approve-all').disabled,true);
  assert.equal(get('export').disabled,true);
});
