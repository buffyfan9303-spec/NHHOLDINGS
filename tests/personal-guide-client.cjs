'use strict';

// Synthetic-only regression for the NURI ONE guide (PR #71). No network, no real account or data.
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');

const html = readFileSync('src/server/personal.html','utf8');
const source = readFileSync('public/one/personal.js','utf8');
const workbench = readFileSync('public/one/workbench.js','utf8');
const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
const tags = (name,from=html) => [...from.matchAll(new RegExp('<a [^>]*'+name+'[^>]*>([^<]*)</a>','g'))]
  .map(m=>({...attrs(m[0]),text:m[1]}));

// 1) Static contract: three guide categories, legacy anchor, real menu names.
const guideStart = html.indexOf('data-personal-view="getting-started"');
const guideEnd = html.indexOf('data-personal-view', guideStart+40);
const guideHtml = html.slice(guideStart, guideEnd<0?undefined:guideEnd);
const guideTabs = tags('data-guide-link', guideHtml);
assert.deepEqual(guideTabs.map(t=>[t['data-guide-link'],t.href,t.text]),[
  ['getting-started','#getting-started','사용 방법'],
  ['guide-connections','#guide-connections','서비스 연결'],
  ['guide-help','#guide-help','문제 해결'],
]);
const panels = [...guideHtml.matchAll(/data-guide-panel="([^"]+)"/g)].map(m=>m[1]);
assert.deepEqual(panels,['getting-started','guide-connections','guide-help']);
const navLinks = tags('data-personal-link');
const menuNames = Object.fromEntries(navLinks.map(l=>[l['data-personal-link'],l.text]));
assert.equal(menuNames['getting-started'],'가이드');
for(const [view,name] of Object.entries({home:'오늘',tasks:'할 일',schedule:'일정',search:'업무 검색',workbench:'업무 작업대',
  notes:'메모',links:'바로가기',sites:'내 웹사이트',social:'내 SNS',mail:'메일 예약',revenue:'수익 대시보드',files:'비공개 저장소','stock-program':'자동 주식 프로그램'}))
  assert.equal(menuNames[view],name,'personal menu preserved: '+view);

// 2) Workbench links from the guide use only panes the workbench accepts, on the existing #workbench route.
const accepted = /\[((?:'[a-z]+',?)+)\]\.includes\(requested\)/.exec(workbench)[1].match(/[a-z]+/g);
const workbenchLinks = tags('href="/personal\\?workbench=', guideHtml);
assert(workbenchLinks.length>=6);
const pane = href => new URL(href,'https://example.invalid').searchParams.get('workbench');
for(const link of workbenchLinks){
  const url = new URL(link.href,'https://example.invalid');
  assert.equal(url.pathname,'/personal');
  assert.equal(url.hash,'#workbench');
  assert(accepted.includes(pane(link.href)),link.href);
}
assert.deepEqual([...new Set(workbenchLinks.map(l=>pane(l.href)))].sort(),['activity','approvals','connect','weekly']);
const known = new Set(Object.keys(menuNames).concat(['website-guide','guide-connections','guide-help']));
for(const link of tags('href="#', guideHtml))assert(known.has(link.href.slice(1)),'internal guide link: '+link.href);

// 3) Runtime: route(), direct open, back/forward, mobile more-menu. Fake DOM, blocked fetch.
function make(hash){
  const events = new Map(), els = new Map(), requests = [];
  const node = (data={}) => ({hidden:false,attrs:{},dataset:data,classList:{add(){},remove(){}},
    setAttribute(k,v){this.attrs[k]=v;},remove(){this.removed=true;}});
  const guideTabNodes = guideTabs.map(t=>node({guideLink:t['data-guide-link']}));
  const panelNodes = panels.map(p=>node({guidePanel:p}));
  const screenNodes = [...html.matchAll(/data-personal-view="([^"]+)"/g)].map(m=>node({personalView:m[1]}));
  const navNodes = [...html.matchAll(/<a [^>]*data-personal-link="([^"]+)"[^>]*>/g)]
    .map(match=>node({personalLink:match[1]}));
  const el = id => els.get(id)||(els.set(id,{...node(),textContent:'',innerHTML:'',open:false,
    addEventListener(t,fn){events.set(id+':'+t,fn);},focus(){},querySelectorAll:()=>[],reset(){},
    replaceChildren(...c){this.children=c;},close(){this.open=false;},showModal(){this.open=true;}}),els.get(id));
  const group = {cloneNode:()=>({querySelector:()=>null,
    querySelectorAll:()=>navNodes.filter(n=>!['home','tasks','schedule'].includes(n.dataset.personalLink))})};
  const bySel = {'[data-guide-link]':guideTabNodes,'[data-guide-panel]':panelNodes,'[data-personal-link]':navNodes,
    '[data-personal-view]':screenNodes,'.personal-nav [data-menu-group]':[group]};
  const document = {visibilityState:'visible',body:node(),getElementById:el,
    querySelectorAll:s=>bySel[s]||[],querySelector:()=>({addEventListener(){}}),addEventListener(){}};
  const location = {pathname:'/personal',hash,search:''};
  const sandbox = {document,location,AbortController,URLSearchParams,requestAnimationFrame:()=>{},
    window:{addEventListener:(t,fn)=>events.set(t,fn),scrollTo(){}},
    fetch:(path,options)=>new Promise(()=>requests.push({path,options}))};
  vm.runInNewContext(source,sandbox);
  const go = next=>{location.hash=next;events.get('hashchange')();};
  return {guideTabNodes,panelNodes,screenNodes,navNodes,el,go,requests,events};
}
const shown = f=>f.panelNodes.filter(p=>!p.hidden).map(p=>p.dataset.guidePanel);
const current = f=>f.guideTabNodes.filter(t=>t.attrs['aria-current']==='page').map(t=>t.dataset.guideLink);
const screen = f=>f.screenNodes.filter(s=>!s.hidden).map(s=>s.dataset.personalView);
const navCurrent = f=>[...new Set(f.navNodes.filter(n=>n.attrs['aria-current']==='page').map(n=>n.dataset.personalLink))];

for(const hash of ['#getting-started','#guide-connections','#guide-help']){  // direct open
  const f = make(hash);
  assert.equal(f.el('personal-title').textContent,'가이드');
  assert.deepEqual(screen(f),['getting-started']);
  assert.deepEqual(shown(f),[hash.slice(1)]);
  assert.deepEqual(current(f),[hash.slice(1)]);
  assert.deepEqual(navCurrent(f),['getting-started']);
  assert.equal(f.el('personal-more').attrs['aria-current'],'true');
}
const f = make('#getting-started');
for(const next of ['#guide-connections','#guide-help','#getting-started']){
  f.go(next);
  assert.deepEqual(shown(f),[next.slice(1)]);
  assert.deepEqual(current(f),[next.slice(1)]);
}
// Existing personal routes stay intact when moving between them and the guide.
for(const [hash,title] of [['#workbench','업무 작업대'],['#tasks','할 일'],['#sites','내 웹사이트'],['#website-guide','구매·연결 가이드'],['#nope','오늘의 업무']]){
  f.go(hash);
  assert.equal(f.el('personal-title').textContent,title);
}
f.go('#website-guide'); assert.deepEqual(navCurrent(f),['sites']);
f.go('#workbench'); assert.deepEqual(screen(f),['workbench']); assert.deepEqual(navCurrent(f),['workbench']);
f.go('#tasks'); assert.deepEqual(navCurrent(f),['tasks']); assert.equal(f.el('personal-more').attrs['aria-current'],'false');
f.go('#guide-help'); f.go('#home'); f.go('#guide-help'); // back/forward = hash restored
assert.deepEqual(shown(f),['guide-help']);

// Mobile more-menu: opens with non-quick links (incl. 가이드) and closes on navigation.
f.events.get('personal-more:click')();
assert.equal(f.el('personal-menu').open,true);
f.go('#getting-started');
assert.equal(f.el('personal-menu').open,false,'menu closes on navigation');

assert(f.requests.every(r=>String(r.path).startsWith('/api/')),'only blocked same-origin fetches');
console.log('Personal guide verified: 3 categories, #getting-started, direct/back routing, workbench targets, mobile menu and legacy routes.');
