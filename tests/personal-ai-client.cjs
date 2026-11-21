'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium,webkit}=require('@playwright/test');

const origin='https://personal-ai.test';
const shell=fs.readFileSync('src/server/personal.html','utf8')
 .replace(/<link [^>]+>/g,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
const css=['public/one/personal.css','public/one/personal-ai.css'].map(path=>fs.readFileSync(path,'utf8'));
const a='actor-a',b='actor-b';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4/8/wHwAF/gL+9gfnUwAAAABJRU5ErkJggg==','base64');
const events=(type,data)=>'event: '+type+'\r\ndata: '+JSON.stringify(data)+'\r\n\r\n';

async function run(page,width){
 const requests=[];
 const profiles=new Map();
 let providers=[{id:'openai',configured:true,model:'mock-gpt'},{id:'anthropic',configured:false,model:null},{id:'gemini',configured:true,model:'mock-gemini'}];
 const history=[{id:'old',provider:'openai',mode:'chat',prompt:'첫 계정의 이전 요청',response:'<img src=attacker>',createdAt:'2026-11-19T04:00:00Z'}];
 await page.route('**/*',route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin!==origin)return route.abort();
  if(url.pathname==='/one/ai-skills.json')return route.fulfill({json:require('../public/one/ai-skills.json')});
  if(url.pathname==='/personal')return route.fulfill({contentType:'text/html; charset=utf-8',body:shell});
  if(url.pathname.startsWith('/api/personal/ai/cards/'))return route.fulfill({contentType:'image/png',body:png});
  if(!['/api/personal/ai/providers','/api/personal/ai/chat','/api/personal/ai/profile'].includes(url.pathname))return route.abort();
  const owner=req.headers()['x-personal-account'];
  assert([a,b].includes(owner),'per-user API header');
  const body=req.method()==='POST'?req.postDataJSON():null;
  const endpoint=url.pathname.split('/').at(-1);
  requests.push({owner,body,endpoint,method:req.method()});
  if(endpoint==='profile'){
   if(url.searchParams.has('today'))return route.fulfill({json:{today:{items:[{title:'모의 오늘 일정'}]}}});
   if(req.method()==='GET')return route.fulfill({json:profiles.get(owner)||{instructions:'',version:0}});
   const saved={instructions:body.instructions,version:body.version+1};
   profiles.set(owner,saved);
   return route.fulfill({json:saved});
  }
  if(req.method()==='GET'){
   if(endpoint==='providers')return route.fulfill({json:{providers:owner===a?providers:providers.map(p=>({...p,configured:false,model:null}))}});
   return route.fulfill({json:{messages:owner===a?history:[]}});
  }
  if(endpoint==='providers'){
   if(body.action==='verify'){
    assert.deepEqual(body,{action:'verify',provider:'anthropic'});
    return route.fulfill({json:{verified:true,model:'mock-claude'}});
   }
   assert.equal(body.apiKey,'synthetic-test-only');
   providers=providers.map(p=>p.id===body.provider?{...p,configured:true,model:body.model}:p);
   return route.fulfill({json:{providers}});
  }
  const {prompt,provider,mode}=body;
  if(prompt==='stream error')return route.fulfill({contentType:'text/event-stream; charset=utf-8',
   body:events('error',{message:'모의 제공자 응답 오류'})});
  const action=mode==='task'?{kind:'task',id:'task-a',title:'새로운 할 일',href:'https://evil.invalid/untrusted'}:
   mode==='cards'?{kind:'cards',id:'card-a',title:'회의용 카드뉴스',slides:2}:
   mode==='social'?{kind:'social',id:'draft-a',title:'내 SNS 초안'}:null;
  const message={id:'row-'+(history.length+1),provider,mode,prompt,response:'한글 첫 조각과 나머지 답변',createdAt:new Date().toISOString(),action};
  history.push(message);
  return route.fulfill({contentType:'text/event-stream; charset=utf-8',
   body:events('delta',{text:'한글 첫 조각'})+events('delta',{text:'과 나머지 답변'})+events('done',{message})});
 });
 await page.goto(origin+'/personal');
 for(const content of css)await page.addStyleTag({content});
 await page.evaluate(owner=>{
  window.NuriPersonalAccount=owner;
  window.aiWrites=[];
  window.NuriPersonalWorkspace={reviewDraft(kind,draft){window.aiDraft={kind,...draft};return true;}};
  window.NuriPersonalAutomation={selectSocialCard(id,slide){window.aiSelectedCard={id,slide};location.hash='social';}};
  window.addEventListener('personal-automation-changed',event=>window.aiWrites.push(event.detail?.kind));
  const network=window.fetch.bind(window);
  window.fetch=async (input,init)=>{
   const response=await network(input,init);
   if(input!=='/api/personal/ai/chat'||init.method!=='POST'||JSON.parse(init.body).prompt!=='분할 응답')return response;
   const text=await response.text();
   const split=text.indexOf('\r\n\r\n')+4,encoded=new TextEncoder(),first=encoded.encode(text.slice(0,split));
   return new Response(new ReadableStream({start(controller){
    for(let i=0;i<first.length;i+=3)controller.enqueue(first.slice(i,i+3));
    window.releaseAIResponse=()=>{controller.enqueue(encoded.encode(text.slice(split)));controller.close();};
   }}),{headers:{'Content-Type':'text/event-stream; charset=utf-8'}});
  };
 },a);
 await page.addScriptTag({path:'public/one/personal-ai.js'});
 await page.evaluate(()=>window.NuriPersonalAI.mount());
 const toggle=page.locator('#personal-ai-open');
 const dock=page.getByRole('dialog',{name:'AI 도우미'});
 const button=(name)=>dock.getByRole('button',{name,exact:true});
 const field=(name)=>dock.locator('[data-ai-compose] [name="'+name+'"]');
 const ready=()=>field('prompt').waitFor();
 await toggle.click();
 await dock.getByText('첫 계정의 이전 요청',{exact:true}).waitFor();
 assert.equal(await field('prompt').getAttribute('maxlength'),'6000');
 assert.equal(await dock.evaluate(el=>el.matches(':modal')),width<1200);
 assert.equal(await toggle.getAttribute('aria-expanded'),'true');
 assert.equal(await dock.locator('img').count(),0);
 assert.equal(await dock.getByText('<img src=attacker>',{exact:true}).count(),1);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 if(width>=1200){
  const layout=await page.evaluate(()=>{
   const dock=document.getElementById('personal-ai-dock').getBoundingClientRect();
   const main=document.getElementById('personal-main').getBoundingClientRect();
   return {dock:Math.floor(dock.left),main:Math.floor(main.right)};
  });
  assert(layout.dock>layout.main,'desktop dock does not cover the workspace');
 }

 await button('API 설정').click();
 const setup=dock.locator('[data-ai-settings]');
 await setup.locator('[name="provider"]').selectOption('anthropic');
 assert.equal(await button('저장된 모델 확인').isVisible(),false);
 await setup.getByLabel('모델 ID').fill('mock-claude');
 await setup.getByLabel('API 키').fill('synthetic-test-only');
 assert.equal(await setup.getByLabel('API 키').getAttribute('type'),'password');
 await button('설정 저장').click();
 await dock.getByText('모델 설정을 저장했습니다.',{exact:true}).waitFor();
 assert.equal(await setup.getByLabel('API 키').inputValue(),'');
 await setup.getByLabel('API 키').fill('unsaved-fixture');
 await button('저장된 모델 확인').click();
 await dock.getByText('mock-claude 조회에 성공했습니다. 답변은 채팅에서 확인할 수 있습니다.',{exact:true}).waitFor();
 assert.equal(await setup.getByLabel('API 키').inputValue(),'unsaved-fixture');
 await button('API 설정').click();
 assert.equal(await setup.getByLabel('API 키').inputValue(),'');
 assert.equal(await field('provider').inputValue(),'anthropic');
 await field('mode').selectOption('task');
 await field('skill').getByText('자동 · 실행 계획',{exact:true}).waitFor({state:'attached'});
 await field('prompt').fill('분할 응답');
 await button('보내기').click();
 await dock.getByText('한글 첫 조각',{exact:true}).waitFor();
 assert.equal(await dock.getByText('나머지 답변',{exact:false}).count(),0);
 assert.equal(await button('응답 중지').isVisible(),true);
 await page.evaluate(()=>window.releaseAIResponse());
 await dock.getByText('한글 첫 조각과 나머지 답변',{exact:true}).waitFor();
 const taskLink=dock.getByRole('link',{name:'할 일 열기',exact:true});
 assert.equal(requests.at(-1).body.skill,'auto');
 assert.equal(await taskLink.getAttribute('href'),'#tasks','server-provided external URL is ignored');
 await taskLink.click();
 assert.equal(new URL(page.url()).hash,'#tasks');
 assert.equal(await toggle.getAttribute('aria-expanded'),'false');

 await toggle.click();
 await ready();
 await field('provider').selectOption('gemini');
 await field('mode').selectOption('social');
 await field('socialProvider').selectOption('x');
 await field('prompt').fill('SNS 모의 원고');
 await button('보내기').click();
 await dock.getByRole('link',{name:'SNS 초안 열기',exact:true}).waitFor();
 assert.equal(requests.at(-1).body.socialProvider,'x');
 assert.equal(requests.at(-1).body.provider,'gemini');
 await field('mode').selectOption('cards');
 await field('prompt').fill('회의 카드');
 await button('보내기').click();
 const card=dock.locator('.personal-ai-card');
 await card.getByText('회의용 카드뉴스',{exact:true}).waitFor();
 await card.getByRole('button',{name:'다음 장',exact:true}).click();
 assert.equal(await card.getByRole('link',{name:'PNG 저장'}).getAttribute('href'),'/api/personal/ai/cards/card-a?slide=1&download=1');
 assert.equal(await card.getByRole('button',{name:'다음 장',exact:true}).isDisabled(),true);
 assert.deepEqual(await page.evaluate(()=>window.aiWrites),['task','social','cards']);
 await card.getByRole('button',{name:'카드뉴스를 SNS에 첨부',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>window.aiSelectedCard),{id:'card-a',slide:1});
 assert.equal(new URL(page.url()).hash,'#social');
 await toggle.click();

 await field('mode').selectOption('chat');
 await field('prompt').fill('stream error');
 await button('보내기').click();
 await dock.getByText('모의 제공자 응답 오류',{exact:true}).waitFor();
 assert.equal(await field('prompt').inputValue(),'stream error');
 if(width<1200){
  await page.keyboard.press('Escape');
  assert.equal(await toggle.evaluate(el=>document.activeElement===el),true);
 }else await button('AI 도우미 닫기').click();
 await toggle.click();
 await dock.getByText('첫 계정의 이전 요청',{exact:true}).waitFor();
 await page.evaluate(owner=>{
  window.NuriPersonalAI.suspend();
  window.NuriPersonalAccount=owner;
  window.NuriPersonalAI.mount();
 },b);
 assert.equal(await dock.count(),0,'drawer opens only for the actor who last opened it');
 await toggle.click();
 await dock.getByText('첫 요청을 보내면 답변이 여기에 표시됩니다.',{exact:true}).waitFor();
 assert.equal(await dock.getByText('첫 계정의 이전 요청',{exact:true}).count(),0);
 assert.equal(await button('보내기').isDisabled(),true);
 assert(requests.some(request=>request.owner===b&&request.endpoint==='chat'&&request.method==='GET'));
 await button('구독 AI').click();
 const handoff=dock.locator('#personal-ai-handoff');
 const transfer=handoff.locator('[data-ai-handoff-form]');
 await handoff.getByRole('button',{name:'업무 방식',exact:true}).click();
 const workStyle=handoff.locator('[data-ai-profile-form]');
 await workStyle.getByLabel('업무 원칙').fill('내 일정은 오전부터 정리해 줘');
 await handoff.getByRole('button',{name:'업무 원칙 저장',exact:true}).click();
 await handoff.getByText('내 업무 원칙을 저장했습니다.',{exact:true}).waitFor();
 await handoff.getByRole('button',{name:'요청 준비',exact:true}).click();
 await handoff.getByText('AI 사용 가이드',{exact:true}).click();
 await handoff.getByText('목표와 결과물 형식을 적고 보낼 내용을',{exact:false}).waitFor();
 await handoff.getByText('AI 사용 가이드',{exact:true}).click();
 await transfer.getByLabel('목적').selectOption('review');
 await transfer.getByLabel('사용할 AI').selectOption('gemini');
 await transfer.getByLabel('요청',{exact:true}).fill('오늘 무엇부터 해야 할지 정리');
 await transfer.getByRole('button',{name:'요청 미리보기',exact:true}).click();
 const preview=handoff.locator('[data-ai-handoff-text]');
 await preview.waitFor();
 assert.match(await preview.inputValue(),/프리셋: 주간 리뷰/);
 assert.doesNotMatch(await preview.inputValue(),/모의 오늘 일정|내 일정은 오전부터/);
 for(const [provider,label,url] of [['openai','ChatGPT','https://chatgpt.com/'],['anthropic','Claude','https://claude.ai/']]){
  await handoff.getByRole('button',{name:'요청 수정',exact:true}).click();
  await transfer.getByLabel('사용할 AI').selectOption(provider);
  await transfer.getByLabel('프리셋').selectOption('decision');
  await transfer.getByRole('button',{name:'요청 미리보기',exact:true}).click();
  await preview.waitFor();
  assert.match(await preview.inputValue(),/프리셋: 의사결정/);
  assert.equal(await handoff.getByRole('link',{name:label+' 열기 ↗'}).getAttribute('href'),url);
 }

 await handoff.getByRole('button',{name:'요청 수정',exact:true}).click();
 await transfer.getByLabel('사용할 AI').selectOption('gemini');
 await transfer.getByLabel('프리셋').selectOption('none');
 await transfer.getByLabel('오늘 할 일과 일정 포함').check();
 await transfer.getByLabel('저장된 일하는 방식 포함').check();
 await transfer.getByRole('button',{name:'요청 미리보기',exact:true}).click();
 await preview.waitFor();
 assert.doesNotMatch(await preview.inputValue(),/프리셋:/);
 assert.match(await preview.inputValue(),/모의 오늘 일정/);
 assert.match(await preview.inputValue(),/내 일정은 오전부터/);
 assert.equal(await handoff.getByRole('link',{name:'Gemini 열기 ↗'}).getAttribute('href'),'https://gemini.google.com/app');
 assert.equal(requests.filter(request=>request.owner===b&&request.endpoint==='chat'&&request.method==='POST').length,0);
 await handoff.getByRole('button',{name:'답변 가져오기',exact:true}).click();
 const imported=handoff.locator('[data-ai-import]');
 await imported.getByLabel('업무 종류').selectOption('task');
 await imported.getByLabel('제목').fill('회의 요약');
 await imported.getByLabel('답변').fill('내일 합의한 안건을 정리한다.');
 await imported.getByRole('button',{name:'내 업무에서 검토',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>window.aiDraft),{kind:'task',title:'회의 요약',detail:'내일 합의한 안건을 정리한다.'});

}

(async()=>{
 const engines=[['Chromium',chromium,fs.existsSync(chromium.executablePath())?{}:{channel:'chrome'}],['WebKit',webkit,{}]];
 for(const [name,engine,options] of engines){
  const browser=await engine.launch({headless:true,...options});
  try{
   for(const [width,colorScheme] of [[320,'light'],[390,'dark'],[440,'light'],[1440,'light'],[1440,'dark']]){
    const page=await browser.newPage({viewport:{width,height:896},colorScheme,reducedMotion:width===320?'reduce':'no-preference'});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await run(page,width);
    assert.deepEqual(errors,[]);
    console.log(name,width,colorScheme,'passed');
    await page.close();
   }
  }finally{await browser.close();}
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
