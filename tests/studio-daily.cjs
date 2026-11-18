'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const handlers={}, downloads=[], alerts=[], fields=[], stored=new Map();
const loads={focus:0,navigations:0};
const data={contents:[],accounts:[
 {id:'mind-account',label:'누리마인드 <공식>'},
 {id:'holdem-account',label:'누리홀덤 공식'},
]};
const state={page:'calendar',scope:'tistory',month:'2026-11'};
const session={email:'operator@example.invalid',readOnly:false,owner:true};
const window={addEventListener(){},NuriDaily:{matchesBrand:p=>selectedBrand==='all'||selectedBrand===p.brand}};
let selectedBrand='all';
let now=Date.parse('2026-11-30T15:05:00Z');
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const context={
 state,data,session,window,esc,URL,TextEncoder,
 labels:{instagram:'Instagram',youtube:'YouTube',blog:'블로그'},
 statusLabels:{scheduled:'예약',paused:'중지',published:'게시 완료',draft:'초안'},
 serviceName:value=>value,render(){},toast:text=>alerts.push(text),won:String,
 Date:class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}},
 document:{
  addEventListener:(type,fn)=>handlers[type]=fn,
  getElementById:()=>null,
  querySelector(selector){return selector.includes('[name="title"]')?{focus(){loads.focus++;}}:null;},
 },
 sessionStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},
 navigate(page){state.page=page;window.NuriStudio.mount();loads.navigations++;},
 selectField:(text,name,options,value)=>'['+name+' '+value+']',
 formField:(text,name,value)=>'['+name+'='+esc(value)+']',
 publicationFields:value=>{fields.push(value);return '';},
 requiresApproval:()=>false,
 manualBlog:()=>false,
 download:(...args)=>downloads.push(args),
};
vm.createContext(context);
const app=fs.readFileSync('public/one/app.js','utf8');
vm.runInContext(app.split(/\r?\n/).filter(line=>/^const (effectiveAt|today|dt|platformExcluded)=/.test(line)).join('\n'),context);
vm.runInContext(fs.readFileSync('public/one/studio.js','utf8'),context);
const render=page=>window.NuriStudio.render(page);
const click=(action,id='')=>handlers.click({preventDefault(){},target:{closest:()=>({dataset:{studio:action,id},isConnected:true})}});
const post=(id,attrs={})=>({id,service:'tistory',business:'platform',channel:'instagram',brand:'mind',status:'scheduled',title:id,createdAt:'2026-11-01T00:00:00Z',...attrs});

async function calendar(){
 data.contents=[
  post('previous-kst-date',{scheduledAt:'2026-11-30T14:59:59Z'}),
  post('night-kst',{scheduledAt:'2026-11-30T15:00:00Z',account:'holdem-account',brand:'holdem'}),
  post('early-kst',{scheduledAt:'2026-11-30T15:15:00Z',account:'mind-account'}),
  post('later-kst',{scheduledAt:'2026-11-30T15:45:00Z',account:'holdem-account',brand:'holdem'}),
  post('final-week-day',{scheduledAt:'2026-12-07T14:59:59Z'}),
  post('after-week',{scheduledAt:'2026-12-07T15:00:00Z'}),
  post('draft-without-time',{status:'draft'}),
  post('legacy-day-only',{scheduledAt:'2026-12-01'}),
  post('manual-time-missing',{status:'published',manual:true,publishedAt:'2026-12-01T12:00:00Z'}),
  post('manual-registration',{status:'published',manual:true,registeredAt:'2026-12-01T00:00:00Z'}),
  post('confirmed-manual',{status:'published',manual:true,registeredAt:'2026-12-15T00:00:00Z'}),
  post('excluded-post',{status:'published',publishedAt:'2026-11-30T15:01:00Z',platformExclusion:{status:'excluded'}}),
  post('foreign-business',{scheduledAt:'2026-11-30T15:01:00Z',business:'other'}),
 ];
 data.postPublications=[
  {contentId:'confirmed-manual',service:'crm',channel:'instagram',publishedAt:'2026-12-15T00:00:00Z'},
  {contentId:'confirmed-manual',service:'tistory',channel:'instagram',publishedAt:'2026-11-30T15:01:00Z'},
  {contentId:'confirmed-manual',service:'tistory',channel:'youtube',publishedAt:'2026-12-15T00:00:00Z'},
 ];
 let html=render('calendar');
 assert.match(html,/data-id="today" aria-pressed="true"/);
 assert.match(html,/datetime="2026-12-01"/);
 assert.doesNotMatch(html,/previous-kst-date|after-week|final-week-day|excluded-post|foreign-business/);
 assert.match(html,/night-kst[\s\S]*00:00/);
 const chronological=html.match(/class="studio-day-list studio-day-chronology">([\s\S]*?)<\/ul>/)[1];
 assert(chronological.indexOf('night-kst')<chronological.indexOf('early-kst'));
 assert(chronological.indexOf('early-kst')<chronological.indexOf('later-kst'));
 assert.match(chronological,/confirmed-manual[\s\S]*00:01/);
 assert.match(chronological,/manual-registration[\s\S]*URL 등록/);
 assert.match(html,/studio-account-lanes[\s\S]*누리홀덤 공식[\s\S]*later-kst[\s\S]*누리마인드 &lt;공식&gt;[\s\S]*early-kst/);
 const pending=html.slice(html.indexOf('studio-day-untimed'));
 assert.match(pending,/draft-without-time/);
 assert.match(pending,/legacy-day-only/);
 assert.match(pending,/manual-time-missing[\s\S]*게시 시각 미확인/);
 assert.equal((html.match(/data-id="draft-without-time"/g)||[]).length,1);
 await click('calendar-view','week');
 html=render('calendar');
 assert.equal((html.match(/<h3><time datetime="2026-12-/g)||[]).length,7);
 assert.match(html,/final-week-day[\s\S]*23:59/);
 assert.doesNotMatch(html,/after-week|previous-kst-date/);
 handlers.change({target:{name:'calendarStatus',value:'draft',closest:()=>null}});
 html=render('calendar');
 assert.match(html,/draft-without-time/);
 assert.doesNotMatch(html,/night-kst|early-kst|final-week-day|legacy-day-only/);
 handlers.change({target:{name:'calendarStatus',value:'all',closest:()=>null}});
 selectedBrand='holdem';
 html=render('calendar');
 assert.match(html,/night-kst/);
 assert.doesNotMatch(html,/early-kst|draft-without-time/);
 selectedBrand='all';
 await click('calendar-view','month');
 html=render('calendar');
 assert.match(html,/data-id="month" aria-pressed="true"/);
 assert.match(html,/previous-kst-date/);
 assert.doesNotMatch(html,/night-kst|final-week-day/);
 await click('ics');
 const [filename,ics]=downloads.pop();
 assert.equal(filename,'NURI-calendar-2026-11.ics');
 assert.match(ics,/DTSTART:20261130T145959Z\r\nSUMMARY:previous-kst-date/);
 assert.doesNotMatch(ics,/night-kst/);
 state.month='2026-12';
 await click('ics');
 assert.match(downloads.at(-1)[1],/SUMMARY:night-kst/);
 assert.doesNotMatch(downloads.at(-1)[1],/legacy-day-only/);
 await click('calendar-view','week');
 now=Date.parse('2026-12-31T15:00:00Z');
 assert.match(render('calendar'),/datetime="2027-01-07"/);
}

const hour=3600000;
const source=(id,date,attrs={})=>post(id,{status:'published',externalId:id,publishedAt:date,videoUrl:'https://media.example.invalid/reel',...attrs});
const apiSample=(p,views,age=25,hours=24,state='observed')=>({id:p.id,metrics:[
 {hours,state,sample:{views,observedAt:new Date(Date.parse(p.publishedAt)+age*hour).toISOString()}},
]});

async function baseline(){
 const main=source('릴스 <원본>','2026-10-09T00:00:00Z',{brand:'mind',campaignId:'reference-campaign',growthCampaign:'growth-campaign',link:'https://www.instagram.com/reel/sample/',youtubeVideoId:'discard-me',body:'복사하지 않는 원본 본문'});
 const examples=[
  [main,200],
  [source('동일 게시 시각','2026-10-09T00:00:00Z'),9000],
  [source('릴스 이전 1','2026-10-08T00:00:00Z'),0,24],
  [source('릴스 이전 2','2026-10-07T00:00:00Z'),100,26],
  [source('릴스 이전 3','2026-10-06T00:00:00Z'),300],
  [source('다른 브랜드','2026-10-08T00:00:00Z',{brand:'holdem'}),8000],
  [source('캐러셀','2026-10-08T00:00:00Z',{videoUrl:'',media:'https://media.example.invalid/image',slides:['second']}),8000],
  [source('확인된 쇼츠','2026-10-08T00:00:00Z',{channel:'youtube',link:'https://www.youtube.com/shorts/abcdefghijk'}),8500],
  [source('쇼츠 형식 미확인','2026-10-07T00:00:00Z',{channel:'youtube',link:'https://www.youtube.com/watch?v=abcdefghijk'}),1234],
  [source('너무 이른 집계','2026-10-07T00:00:00Z'),125,23.99],
  [source('너무 늦은 집계','2026-10-06T00:00:00Z'),125,26.01],
  [source('7일 집계','2026-10-06T00:00:00Z'),125,168,168],
  [source('조회 수 미확인','2026-10-06T00:00:00Z'),null],
  [source('수기 기록','2026-10-06T00:00:00Z',{manual:true}),200],
  [source('삭제 제외','2026-10-06T00:00:00Z',{platformExclusion:{status:'excluded'}}),200],
  [source('다른 사업장의 게시물','2026-10-06T00:00:00Z',{business:'other'}),200],
 ];
 data.contents=examples.map(([p])=>p);
 data.snsFollowups=examples.map(args=>apiSample(...args));
 let html=render('growth').match(/<section class="panel studio-tools section-gap studio-baseline">[\s\S]*?<\/section>/)[0];
 assert.match(html,/릴스 &lt;원본&gt;[\s\S]*조회 200회[\s\S]*이전 3건 중앙값 100회 · \+100회/);
 assert.match(html,/릴스 이전 1[\s\S]*조회 0회/);
 assert.match(html,/쇼츠 형식 미확인[\s\S]*조회 1,234회[\s\S]*콘텐츠 형식 미확인/);
 assert.match(html,/캐러셀[\s\S]*비교 표본 0건/);
 assert.doesNotMatch(html,/너무 이른 집계|너무 늦은 집계|7일 집계|조회 수 미확인|수기 기록|삭제 제외|다른 사업장의 게시물/);
 selectedBrand='mind';
 assert.doesNotMatch(render('growth'),/다른 브랜드/);
 session.readOnly=true;
 assert.doesNotMatch(render('growth'),/data-studio="baseline-draft"/);
 await click('baseline-draft',main.id);
 assert.equal(loads.navigations,0);
 session.readOnly=false;
 await click('baseline-draft',main.id);
 assert.equal(loads.navigations,1);
 assert.equal(loads.focus,1);
 html=render('studio');
 assert.match(html,/이전 게시물 관찰[\s\S]*릴스 &lt;원본&gt;[\s\S]*200회/);
 assert.doesNotMatch(html,/복사하지 않는 원본 본문|discard-me/);
 const draft=fields.at(-1);
 for(const [key,value] of Object.entries({brand:'mind',campaignId:'reference-campaign',channel:'instagram',title:'',body:'',media:'',videoUrl:'',youtubeVideoId:''})){
  assert.equal(draft[key],value);
 }
 assert.equal(draft.id,'');
 assert.equal(draft.scheduledAt,undefined);
 assert.equal(draft.approval,undefined);
 const ordinaryKey='nuri-studio:live:operator@example.invalid:new';
 stored.set(ordinaryKey,'{"title":"별도 초안"}');
 stored.set('nuri-studio:live:operator@example.invalid:next:'+main.id,'{"title":"관찰에서 이어온 초안"}');
 await click('baseline-draft',main.id);
 render('studio');
 assert.equal(fields.at(-1).title,'관찰에서 이어온 초안');
 assert.equal(stored.get(ordinaryKey),'{"title":"별도 초안"}');
 let submits=0;
 context.document.getElementById=()=>({requestSubmit(){submits++;}});
 const keydown=insideLibrary=>handlers.keydown({ctrlKey:true,key:'s',target:{closest:()=>insideLibrary},preventDefault(){}});
 keydown(true);
 assert.equal(submits,0);
 keydown(false);
 assert.equal(submits,1);
}

calendar().then(baseline).then(()=>{
 console.log('Studio daily: KST midnight/year/week bounds, desktop account lanes, chronological view, untimed items, brand/filter isolation, monthly ICS, observed-only 24h baselines, next-draft handoff and read-only checks passed');
}).catch(error=>{console.error(error);process.exitCode=1;});
