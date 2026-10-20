const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');

function fixture() {
  const timers = new Map(), nodes = new Map(); let next = 0;
  const get = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {dataset:{}, textContent:'', events:{},
      classList:{contains:()=>false,add(){},remove(){}}, contains:()=>false,
      addEventListener(name, fn){this.events[name]=fn;}, querySelector:get, getContext:()=>null});
    return nodes.get(selector);
  };
  const context = {document:{querySelector:get, addEventListener(){},removeEventListener(){}},
    window:{addEventListener(){}}, matchMedia:()=>({matches:true}),
    setTimeout(fn, ms){timers.set(++next,{fn,ms}); return next;},clearTimeout:id=>timers.delete(id),
    requestAnimationFrame:()=>0, cancelAnimationFrame(){}};
  vm.runInNewContext(fs.readFileSync('web/intro.js','utf8'),context);
  return {context,get,timers};
}

test('slow catalogue loading never starts a fallback Satellite ident', () => {
  const f=fixture();
  const [id, timer]=[...f.timers].find(([,timer])=>timer.ms===4000);
  f.timers.delete(id); timer.fn();
  assert.equal(f.get('#startup').dataset.theme, undefined);
  assert.equal(f.get('#startup-sound').textContent,'READING LIBRARY…');
  f.context.window.USBTvIntro.start('goblin');
  assert.equal(f.get('#startup').dataset.theme,'goblin');
  assert.equal(f.get('.startup-wordmark').textContent,'GOBLIN CABLE');
});

test('waiting for a slow catalogue remains skippable', () => {
  const f=fixture();
  f.get('#startup-skip').events.click();
  assert.equal(f.get('.shell').inert,false);
  f.context.window.USBTvIntro.start('goblin');
  assert.equal(f.get('#startup').dataset.theme,undefined);
});
