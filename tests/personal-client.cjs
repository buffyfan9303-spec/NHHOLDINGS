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
      reset(){},replaceChildren(){this.innerHTML='';this.textContent='';},
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
    pathname:'/personal',hash:'',search:'',reloads:0,redirect:null,
    assign(path){this.redirect=path;},reload(){this.reloads++;},
  };
  const sandbox = {
    document,location,AbortController,URLSearchParams,
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
 first.element('personal-search-results').innerHTML='Private alice';
 visible(first,'hidden'); visible(first,'visible');
 const stale=first.requests.shift();
 visible(first,'hidden'); visible(first,'visible');
 const current=first.requests.shift();
 assert.equal(stale.options.signal.aborted,true);
 assert.equal(first.element('personal-search-results').innerHTML,'');
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
 // 캘린더 연동: 비밀번호는 생성 응답에서만 보이고, 떠나거나 숨기면 지워지며, 오류·로딩은 '꺼짐'으로 보이지 않는다.
 const cal=fixture();
 answer(cal.requests.shift(),snapshot('alice'));
 await flush();
 cal.sandbox.confirm=()=>true;
 cal.sandbox.window.scrollTo=()=>{};
 cal.element('personal-week-days').contains=()=>false;cal.element('personal-week-days').children=[];
 cal.element('personal-week').querySelector=()=>({disabled:false});
 cal.location.hash='#schedule';
 cal.events.get('hashchange')();
 assert.equal(cal.element('personal-calendar-connect').hidden,false);
 const open=()=>{cal.element('personal-calendar-connect').open=true;cal.events.get('personal-calendar-connect:toggle')();};
 const press=(action)=>cal.events.get('personal-calendar-connect:click')({target:{closest:selector=>selector==='[data-feed-copy]'?null:{dataset:{feedAction:action}}}});
 const take=path=>{const index=cal.requests.findIndex(request=>request.path===path&&request.options.method!=='POST');return cal.requests.splice(index,1)[0];};
 open();
 assert.match(cal.element('personal-feed-state').textContent,/확인하는 중/);
 assert.equal(cal.element('[data-feed-action=create]').disabled,true);
 answer(take('/api/personal/calendar-subscription'),{error:'temporary'},503);
 answer(take('/api/personal/connectors?view=calendar-status'),{error:'x'},500);
 await flush();
 assert.match(cal.element('personal-feed-state').textContent,/temporary/);
 assert.equal(cal.element('[data-feed-action=create]').disabled,true);
 assert.equal(cal.element('[data-feed-action=refresh]').hidden,false);
 assert.equal(cal.element('[data-feed-action=disable]').hidden,true);
 assert.match(cal.element('personal-feed-google').textContent,/확인하지 못했어요/);
 press('refresh');
 answer(take('/api/personal/calendar-subscription'),{active:true,createdAt:'2026-11-25T00:00:00Z'});
 answer(take('/api/personal/connectors?view=calendar-status'),{connected:true});
 await flush();
 assert.match(cal.element('personal-feed-google').textContent,/연결돼 있습니다/);
 assert.equal(cal.element('[data-feed-action=disable]').hidden,false);
 assert.match(cal.element('[data-feed-action=create]').textContent,/다시 만들기/);
 press('create');
 const post=cal.requests.find(request=>request.options.method==='POST');
 assert.equal(post.path,'/api/personal/calendar-subscription');
 assert.deepEqual(JSON.parse(post.options.body),{action:'create'});
 assert.equal(post.options.headers['X-Personal-Account'],'alice');
 cal.requests.splice(cal.requests.indexOf(post),1);
 answer(post,{active:true,url:'https://nuri.test/api/personal/calendar-subscription/feed',username:'nuri',password:'P'.repeat(43)});
 await flush();
 assert.equal(cal.element('personal-feed-password').value,'P'.repeat(43));
 assert.equal(cal.element('personal-feed-user').value,'nuri');
 assert.doesNotMatch(cal.element('personal-feed-url').value,/P{10}/);
 assert.equal(cal.element('personal-feed-link').hidden,false);
 visible(cal,'hidden');
 assert.equal(cal.element('personal-feed-password').value,'');
 assert.equal(cal.element('personal-feed-link').hidden,true);
 assert.equal(cal.element('personal-calendar-connect').open,false);
 visible(cal,'visible');
 answer(cal.requests.splice(cal.requests.findIndex(request=>request.path==='/api/personal'),1)[0],snapshot('alice'));
 await flush();
 // a response that arrives after the panel was closed must not repaint a credential
 cal.requests.length=0;
 open();
 answer(take('/api/personal/calendar-subscription'),{active:false});
 answer(take('/api/personal/connectors?view=calendar-status'),{connected:false});
 await flush();
 assert.match(cal.element('personal-feed-state').textContent,/꺼져 있습니다/);
 assert.equal(cal.element('[data-feed-action=disable]').hidden,true);
 let asked=0;cal.sandbox.confirm=()=>{asked++;return true;};
 press('create');
 assert.equal(asked,0,'no rotation confirm when no subscription is active');
 const late=cal.requests.find(request=>request.options.method==='POST');
 cal.requests.splice(cal.requests.indexOf(late),1);
 cal.element('personal-calendar-connect').open=false;cal.events.get('personal-calendar-connect:toggle')();
 answer(late,{active:true,url:'https://x',username:'nuri',password:'LATE'});
 await flush();
 assert.equal(cal.element('personal-feed-password').value,'');
 assert.equal(cal.element('personal-feed-link').hidden,true);
 assert.equal(cal.element('personal-feed-state').textContent.includes('LATE'),false);
 // Google이 느려도 Apple 구독은 먼저 쓸 수 있고, 변경은 Google 확인을 취소하지 않는다.
 cal.requests.length=0;
 open();
 const gPending=take('/api/personal/connectors?view=calendar-status');
 answer(take('/api/personal/calendar-subscription'),{active:true});
 await flush();
 assert.match(cal.element('personal-feed-state').textContent,/켜져 있습니다/);
 assert.equal(cal.element('[data-feed-action=create]').disabled,false);
 assert.equal(cal.element('[data-feed-action=disable]').hidden,false);
 assert.match(cal.element('personal-feed-google').textContent,/확인하는 중/);
 assert.equal(gPending.options.signal.aborted,false);
 press('disable');
 assert.equal(cal.element('[data-feed-action=create]').disabled,true,'mutation in flight');
 assert.equal(gPending.options.signal.aborted,false,'disable must not cancel the Google check');
 const off=cal.requests.find(request=>request.options.method==='POST');
 cal.requests.splice(cal.requests.indexOf(off),1);
 answer(off,{active:false});
 await flush();
 assert.match(cal.element('personal-feed-state').textContent,/껐습니다/);
 answer(gPending,{connected:true});
 await flush();
 assert.match(cal.element('personal-feed-google').textContent,/연결돼 있습니다/);
 // Google 실패가 Apple을 막지 않고, Apple 오류 뒤 다시 시도가 된다.
 press('create');
 cal.requests.length=0;
 cal.element('personal-calendar-connect').open=false;cal.events.get('personal-calendar-connect:toggle')();
 open();
 answer(take('/api/personal/connectors?view=calendar-status'),{error:'down'},500);
 answer(take('/api/personal/calendar-subscription'),{error:'temporary'},503);
 await flush();
 assert.match(cal.element('personal-feed-google').textContent,/확인하지 못했어요/);
 assert.equal(cal.element('[data-feed-action=refresh]').hidden,false);
 press('refresh');
 answer(take('/api/personal/calendar-subscription'),{active:false});
 const gSlow=take('/api/personal/connectors?view=calendar-status');
 await flush();
 assert.equal(cal.element('[data-feed-action=create]').disabled,false);
 assert.match(cal.element('personal-feed-google').textContent,/확인하는 중/);
 // 닫으면 두 응답 모두 취소되고 늦은 응답은 그려지지 않는다.
 cal.element('personal-calendar-connect').open=false;cal.events.get('personal-calendar-connect:toggle')();
 assert.equal(gSlow.options.signal.aborted,true);
 answer(gSlow,{connected:true});
 await flush();
 assert.doesNotMatch(cal.element('personal-feed-google').textContent,/연결돼 있습니다/);
 // Project names for linked drafts are exposed only for the loaded account and vanish while it is revalidated.
 const named=fixture();
 answer(named.requests.shift(),{...snapshot('alice'),projects:[{id:'p-alice',name:'Alice 프로젝트',rules:'',version:1}]});
 await flush();
 const lookup=named.sandbox.window.NuriPersonalWorkspace.projectName;
 assert.equal(lookup('p-alice'),'Alice 프로젝트');
 assert.equal(lookup('p-other'),'');
 assert.equal(lookup(7),'');
 visible(named,'hidden');
 assert.equal(lookup('p-alice'),'','a masked session reveals no project names');
 console.log('Personal client verified: stale session response blocked, offline modal recovery, and cleared-cookie logout, and calendar-subscription credential lifecycle.');
})().catch(error=>{console.error(error);process.exitCode=1;});
