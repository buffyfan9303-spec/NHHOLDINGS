'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium,webkit}=require('@playwright/test');
const {weight}=require('../src/server/content-tools.cjs');

const source='https://personal-automation.test';
const shell=fs.readFileSync('src/server/personal.html','utf8')
 .replace(/<link [^>]+>/g,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
const css=['public/one/personal.css','public/one/personal-automation.css'].map(path=>fs.readFileSync(path,'utf8'));
const actor='personal-fixture-a',nextActor='personal-fixture-b';
const img='https://media.example.invalid/cover.jpg';
const providers=[
 {id:'instagram',name:'Instagram',configured:true,appSource:'default'},
 {id:'threads',name:'Threads',configured:true,appSource:'default'},
 {id:'youtube',name:'YouTube',configured:false,appSource:null},
 {id:'x',name:'X',configured:true,appSource:'default'},
];
const initialAccounts=[
 {id:'ig-a',provider:'instagram',label:'개인 인스타그램 '+('아주 긴 공식 계정명 '.repeat(12)),username:'my_account',ready:true,paused:false},
 {id:'threads-a',provider:'threads',label:'개인 Threads',ready:true,paused:false},
 {id:'video-a',provider:'youtube',label:'개인 YouTube',ready:true,paused:false},
 {id:'x-a',provider:'x',label:'개인 X',ready:true,paused:false},
];
const initialPosts=[
 {id:'own-review',accountId:'ig-a',provider:'instagram',title:'재승인할 게시물',body:'복구 가능한 검토',status:'review',version:2,uncertain:false},
 {id:'uncertain',accountId:'ig-a',provider:'instagram',title:'확인 필요한 게시물',body:'응답 미확인',status:'review',version:2,uncertain:true},
];

async function scenario(page) {
 let posts=structuredClone(initialPosts),accounts=structuredClone(initialAccounts),mail=[],connection={connected:false,paused:false,configured:false};
 let sequence=0,delayRead=null;
 const mailState=()=>({configured:connection.configured,connection,items:mail});
 const requests=[];
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),kind=url.pathname.split('/').at(-1);
  if(url.origin==='https://threads.com'&&url.pathname==='/oauth/authorize'){
   return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><h1>가상 승인 화면</h1>'});
  }
  if(url.origin!==source)return route.abort();
  if(url.pathname==='/personal')return route.fulfill({contentType:'text/html',body:shell});
  if(!['/api/personal/social','/api/personal/mail'].includes(url.pathname))return route.abort();
  const owner=req.headers()['x-personal-account'];
  assert([actor,nextActor].includes(owner),'request is scoped');
  const body=req.method()==='POST'?req.postDataJSON():null;
  requests.push({owner,kind,body});
  const reply=data=>route.fulfill({json:data});
  if(req.method()==='GET'){
   if(delayRead&&kind==='social'&&owner===actor){
    const wait=delayRead;delayRead=null;
    await wait;
   }
   return reply(owner===nextActor?{providers,accounts:[],posts:[]}:
    kind==='social'?{providers,accounts,posts}:mailState());
  }
  const rows=kind==='social'?posts:mail;
  if(body.action==='configure'){
   assert.equal(body.clientSecret,'synthetic-only');
   connection.configured=true;
   return reply(kind==='mail'?mailState():{ok:true});
  }
  if(body.action==='connect')return reply({url:body.provider==='threads'?'https://threads.com/oauth/authorize?state=mock':'https://forged-consent.invalid/login'});
  if(body.action==='pause'){
   if(kind==='mail')connection.paused=body.paused;
   else accounts.find(a=>a.id===body.accountId).paused=body.paused;
   return reply({ok:true});
  }
  if(body.action==='save'||body.action==='draft'){
   const record={...body,status:'draft',id:body.id||'fixture-'+(++sequence),version:(body.version||0)+1};
   if(kind==='social')record.provider=accounts.find(a=>a.id===body.accountId).provider;
   if(record.provider==='x'&&weight(body.body,'x')>280){
    return route.fulfill({status:400,json:{error:'채널의 본문 글자 수 제한을 확인해 주세요.'}});
   }
   if(body.id){
    if(rows.find(item=>item.id===body.id)?.version!==body.version){
     return route.fulfill({status:409,json:{error:'다른 화면에서 초안이 변경됐습니다.'}});
    }
    rows.splice(rows.findIndex(item=>item.id===body.id),1,record);
   }else rows.unshift(record);
   return reply(kind==='social'?{post:record}:mailState());
  }
  const item=rows.find(row=>row.id===body.id);
  assert.equal(item.version,body.version);
  item.version++;
  if(body.action==='schedule'){
   assert.equal(body.approved,true);
   item.scheduledAt=kind==='social'?body.scheduledAt:body.at;
   item.status='scheduled';
  }else if(body.action==='cancel')item.status='cancelled';
  return reply(kind==='social'?{post:item}:mailState());
 });
 await page.goto(source+'/personal#social');
 await page.evaluate(()=>{
  window.automationChanges=0;
  window.addEventListener('personal-automation-changed',()=>{window.automationChanges++;});
 });
 for(const content of css)await page.addStyleTag({content});
 await page.addScriptTag({path:'public/one/personal-automation.js'});
 const view=kind=>page.evaluate(({kind,actor})=>{
  window.NuriPersonalAccount=actor;
  for(const section of document.querySelectorAll('[data-personal-view]'))section.hidden=!section.querySelector('#personal-'+kind+'-root');
  window.NuriPersonalAutomation.mount(kind);
 },{kind,actor});
 const root=kind=>page.locator('#personal-'+kind+'-root');
 const dialog=page.locator('.auto-dialog[open]');
 const button=(pane,label)=>pane.getByRole('button',{name:label,exact:true});
 const expectText=(pane,text)=>pane.getByText(text,{exact:true}).waitFor();
 const action=(kind,method)=>requests.filter(r=>r.kind===kind&&r.body?.action===method).at(-1)?.body;
 const submit=label=>button(dialog,label).click();
 const dateAndTime=async()=>{
  const day=new Date(Date.now()+48*3600000+9*3600000).toISOString().slice(0,10);
  await dialog.locator('[name="day"]').fill(day);
  await dialog.locator('[name="time"]').fill('00:15');
  assert.equal(await dialog.locator('form').evaluate(form=>form.checkValidity()),false,'keeps explicit approval required');
  await dialog.getByRole('checkbox').check();
  return new Date(day+'T00:15:00+09:00').toISOString();
 };

 await view('social');
 const social=root('social');
 await expectText(social,'재승인할 게시물');
 assert.equal(await social.locator('.auto-row').filter({hasText:'재승인할 게시물'}).getByRole('button',{name:'원고 승인 및 예약'}).count(),1);
 assert.equal(await social.locator('.auto-row').filter({hasText:'확인 필요한 게시물'}).getByRole('button').count(),0);
 await button(social,'새 초안').click();
 await dialog.getByLabel('제목').fill('가상 게시물 <img src=x>');
 await dialog.getByLabel('본문').fill('게시할 모의 본문');
 assert.equal(await dialog.locator('form').evaluate(form=>form.checkValidity()),false,'Instagram requires an image');
 await dialog.getByLabel('공개 이미지 주소').fill(img);
 await submit('초안 저장');
 await expectText(social,'초안을 저장했습니다.');
 assert.equal(action('social','save').mediaUrl,img);
 assert.equal(await social.locator('img').count(),0,'post title remains plain text');
 const socialRow=social.locator('.auto-row').filter({hasText:'가상 게시물 <img src=x>'});
 await button(socialRow,'편집').click();
 await dialog.getByLabel('본문').fill('이전 버전의 수정');
 const openedVersion=posts[0].version;
 posts[0].version++;
 await page.evaluate(()=>{window.NuriPersonalAutomation.suspend();window.NuriPersonalAutomation.mount('social');});
 assert.equal(await dialog.getByLabel('본문').inputValue(),'이전 버전의 수정');
 await submit('초안 저장');
 await expectText(dialog,'다른 화면에서 초안이 변경됐습니다.');
 assert.equal(action('social','save').version,openedVersion,'an older editor cannot overwrite a recent draft');
 await button(dialog,'닫기').click();
 await button(socialRow,'원고 승인 및 예약').click();
 const igStamp=await dateAndTime();
 await submit('게시 예약');
 await expectText(socialRow,'예약됨');
 assert.equal(action('social','schedule').scheduledAt,igStamp);
 assert.equal(Object.hasOwn(action('social','schedule'),'at'),false);
 await button(socialRow,'예약 취소').click();
 await submit('예약 취소');
 await expectText(socialRow,'예약 취소');
 assert(action('social','cancel').version>action('social','schedule').version);
 const igSection=social.getByRole('region',{name:'Instagram'});
 await button(igSection,'게시 일시정지').click();
 await button(igSection,'게시 재개').waitFor();
 assert.equal(action('social','pause').accountId,'ig-a');
 await button(social,'새 초안').click();
 await dialog.locator('[name="accountId"]').selectOption('threads-a');
 assert.equal(await dialog.locator('[name="mediaUrl"]').evaluate(field=>field.required),false);
 await dialog.locator('[name="accountId"]').selectOption('x-a');
 assert.equal(await dialog.getByLabel('공개 이미지 주소').isVisible(),false);
 assert.equal(await dialog.locator('[name="videoId"]').isVisible(),false);
 await dialog.getByLabel('제목').fill('가상 X 원고');
 await dialog.getByLabel('본문').fill('가'.repeat(141));
 await submit('초안 저장');
 await expectText(dialog,'채널의 본문 글자 수 제한을 확인해 주세요.');
 assert.equal(await dialog.getByLabel('본문').inputValue(),'가'.repeat(141));
 await dialog.locator('[name="accountId"]').selectOption('video-a');
 assert.equal(await dialog.getByLabel('공개 이미지 주소').isVisible(),false);
 await dialog.getByLabel('제목').fill('다음 모의 YouTube 영상');
 await dialog.getByLabel('본문').fill('같은 설명 확인');
 await dialog.locator('[name="videoId"]').fill('abcdefghijk');
 await dialog.locator('[name="madeForKids"]').selectOption('false');
 await dialog.locator('[name="synthetic"]').selectOption('true');
 await submit('초안 저장');
 await expectText(social,'다음 모의 YouTube 영상');
 assert.equal(action('social','save').madeForKids,false);
 assert.equal(action('social','save').synthetic,true);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));

 await view('mail');
 const gmail=root('mail');
 await expectText(gmail,'미연결');
 await button(gmail,'새 초안').click();
 await dialog.getByLabel('받는 사람').fill('mock-recipient@example.invalid');
 await dialog.getByLabel('제목').fill('가상 Gmail 초안');
 await dialog.getByLabel('본문').fill('모의 테스트용 본문');
 await submit('초안 저장');
 await expectText(gmail,'가상 Gmail 초안');
 assert.equal(action('mail','draft').to,'mock-recipient@example.invalid');
 const mailRow=gmail.locator('.auto-row').filter({hasText:'가상 Gmail 초안'});
 assert.equal(await button(mailRow,'원고 승인 및 예약').count(),0,'disconnected Gmail may only draft');
 await button(gmail,'Google 앱 설정 추가').click();
 assert.equal(await dialog.locator('code').innerText(),source+'/api/personal/mail/oauth');
 await dialog.getByLabel('Client ID').fill('mock-client');
 await dialog.getByLabel('Client Secret').fill('synthetic-only');
 await submit('설정 저장');
 await expectText(gmail,'앱 설정을 저장했습니다.');
 assert.equal(await gmail.locator('[name="clientSecret"]').count(),0);
 await button(gmail,'Google로 연결').click();
 await expectText(gmail,'처리 결과를 확인하지 못했습니다. 목록을 다시 조회해 주세요.');
 assert.equal(new URL(page.url()).origin,source,'rejects a forged OAuth destination');
 connection.connected=true;
 await button(gmail,'다시 조회').click();
 await expectText(gmail,'연결됨');
 await button(mailRow,'원고 승인 및 예약').click();
 const mailStamp=await dateAndTime();
 await submit('발송 예약');
 await expectText(mailRow,'예약됨');
 assert.equal(action('mail','schedule').at,mailStamp);
 assert.equal(Object.hasOwn(action('mail','schedule'),'scheduledAt'),false);
 assert(await page.evaluate(()=>window.automationChanges>=8),'publishes change notifications for the private agenda');
 await view('social');
 await view('mail');
 await expectText(mailRow,'예약됨');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));

 await view('social');
 let release;
 delayRead=new Promise(resolve=>{release=resolve;});
 const started=page.waitForRequest(request=>request.url()===source+'/api/personal/social'&&request.method()==='GET');
 await button(social,'다시 조회').click();
 await started;
 await page.evaluate(owner=>{
  window.NuriPersonalAutomation.suspend();
  window.NuriPersonalAccount=owner;
  window.NuriPersonalAutomation.mount('social');
 },nextActor);
 release();
 await expectText(social,'작성한 초안이 없습니다.');
 assert.equal(await social.getByText('다음 모의 YouTube 영상',{exact:true}).count(),0);
 assert.equal(await gmail.getByText('가상 Gmail 초안',{exact:true}).count(),0,'a hidden tab cannot retain another account’s records');
 assert(requests.some(request=>request.owner===nextActor&&request.kind==='social'&&request.body===null));
 await button(social.getByRole('region',{name:'Threads'}),'계정 연결').click();
 await dialog.getByLabel('계정 이름').fill('다른 개인 Threads');
 await submit('승인 화면 열기');
 await page.waitForURL('https://threads.com/oauth/authorize?state=mock');
 await page.getByRole('heading',{name:'가상 승인 화면'}).waitFor();
}

(async()=>{
 const engines=[['Chromium',chromium,fs.existsSync(chromium.executablePath())?{}:{channel:'chrome'}],['WebKit',webkit,{}]];
 for(const [name,engine,options] of engines){
  const browser=await engine.launch({headless:true,...options});
  try{
   for(const [width,colorScheme] of [[320,'light'],[390,'dark'],[1440,'light']]){
    const page=await browser.newPage({viewport:{width,height:870},colorScheme,reducedMotion:width===320?'reduce':'no-preference'});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await scenario(page);
    assert.deepEqual(errors,[]);
    console.log(name,width,colorScheme,'passed');
    await page.close();
   }
  } finally{await browser.close();}
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
