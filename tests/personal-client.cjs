'use strict';

const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');

const source = readFileSync('public/one/personal.js','utf8');

function fixture() {
  const events = new Map(), elements = new Map(), classes = new Set(), requests = [];
  const element = id => {
    if(!elements.has(id))elements.set(id,{
      innerHTML:'',textContent:'',hidden:false,open:false,
      setAttribute(){},addEventListener(type,fn){events.set(id+':'+type,fn);},
      focus(){},querySelectorAll(){return [];},close(){this.open=false;},showModal(){this.open=true;},
    });
    return elements.get(id);
  };
  const document = {
    visibilityState:'visible',
    body:{classList:{add:kind=>classes.add(kind),remove:kind=>classes.delete(kind)}},
    getElementById:element,querySelectorAll:()=>[],
    querySelector:selector=>element(selector),
    addEventListener:(type,fn)=>events.set(type,fn),
  };
  const location = {
    hash:'',reloads:0,redirect:null,
    assign(path){this.redirect=path;},reload(){this.reloads++;},
  };
  const sandbox = {
    document,location,AbortController,
    window:{addEventListener:(type,fn)=>events.set(type,fn)},
    fetch:(path,options)=>new Promise(resolve=>requests.push({path,options,resolve})),
  };
  vm.runInNewContext(source,sandbox);
  return {document,location,sandbox,events,classes,requests,element};
}

const flush = () => new Promise(resolve=>setImmediate(resolve));
const marker = 'personal-revalidating';
const account = id=>({id,email:id+'@example.invalid',owner:false});
const snapshot = id=>({
 account:account(id),
 items:[{id,kind:'task',title:'Private '+id,detail:'',dueOn:null,done:false,
 createdAt:'2026-11-19T01:00:00Z',updatedAt:'2026-11-19T01:00:00Z'}],
});
const answer = (request,result,status=200)=>request.resolve({ok:status<400,status,json:async()=>result});
const visible = (fixture,state)=>{
 fixture.document.visibilityState=state;
 fixture.events.get('visibilitychange')();
};

(async()=>{
 const first=fixture();
 answer(first.requests.shift(),snapshot('alice'));
 await flush();
 assert.match(first.element('personal-today').innerHTML,/Private alice/);
 visible(first,'hidden'); visible(first,'visible');
 const stale=first.requests.shift();
 visible(first,'hidden'); visible(first,'visible');
 const current=first.requests.shift();
 assert.equal(stale.options.signal.aborted,true);
 answer(stale,snapshot('alice'));
 await flush();
 assert(first.classes.has(marker));
 assert.equal(first.sandbox.window.NuriPersonalAccount,null);
 answer(current,snapshot('bob'));
 await flush();
 assert.equal(first.location.reloads,1);
 assert(first.classes.has(marker));

 const second=fixture();
 answer(second.requests.shift(),snapshot('alice'));
 await flush();
 second.element('personal-editor').open=true;
 visible(second,'hidden'); visible(second,'visible');
 assert.equal(second.element('personal-editor').open,false);
 answer(second.requests.shift(),{error:'temporary'},503);
 await flush();
 assert.equal(second.element('personal-reload').hidden,false);
 second.events.get('personal-reload:click')();
 answer(second.requests.shift(),snapshot('alice'));
 second.element('personal-form').elements={title:{focus(){}}};
 await flush();
 assert.equal(second.element('personal-editor').open,true);
 assert.equal(second.classes.has(marker),false);

 const logout=second.events.get('personal-logout:click')();
 answer(second.requests.shift(),{localCleared:true},503);
 await logout;
 assert.equal(second.location.redirect,'/login');
 assert(second.classes.has(marker));
 assert.doesNotMatch(second.element('personal-today').innerHTML,/Private alice/);
 console.log('Personal client verified: stale session response blocked, offline modal recovery, and cleared-cookie logout.');
})().catch(error=>{console.error(error);process.exitCode=1;});
