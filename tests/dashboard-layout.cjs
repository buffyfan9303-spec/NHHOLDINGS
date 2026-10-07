'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs');
const {chromium} = require('@playwright/test');
require('@next/env').loadEnvConfig(process.cwd());
const base = process.env.TEST_ORIGIN || 'http://127.0.0.1:3120';
const widths = [320,390,768,1024,1440,1920];
const pages = {overview:'SNS·웹사이트 전체 현황',finance:'매출 · 비용 · 손익',businesses:'사업장 관리',tasks:'업무 관리',partners:'거래처',servers:'서버 · 연결 상태',reports:'리포트',content:'콘텐츠 작성 · 자동 업로드',prompts:'프롬프트 · 반복 설정',history:'콘텐츠 · 실행 내역'};
const services = {mind:'NURI MIND',holdem:'NURI HOLDEM',crm:'NURI CRM',market:'NURI MARKET',tistory:'SNS'};
const channels = {all:'',blog:'블로그',instagram:'인스타그램',threads:'Threads',x:'X',youtube:'YouTube',tiktok:'TikTok'};
async function main(){
 const password = process.env.TEST_OWNER_PASSWORD;
 assert(password,'TEST_OWNER_PASSWORD is required');
 const browser = await chromium.launch({headless:true}), page = await browser.newPage({viewport:{width:1440,height:960}}), errors=[], results=[];
 page.on('pageerror',error=>errors.push(error.message));
 fs.mkdirSync('artifacts/layout',{recursive:true});
 try {
  const login = await page.request.post(base+'/api/auth',{headers:{Origin:base},data:{action:'login',portal:'one',email:process.env.OPERATOR_EMAIL,password}});
  assert.equal(login.status(),200,'Owner login');
  const routes = Object.entries(pages).map(([hash,title])=>({hash,title}));
  for(const [id,title] of Object.entries(services))for(const tab of ['overview','finance','operations','tasks','partners','content','connections'])routes.push({hash:'site/'+id+'/'+tab,title,site:id,tab});
  for(const [channel,label] of Object.entries(channels))routes.push({hash:'publish/'+channel,title:label?label+' · 업로드 현황':'SNS 업로드 현황',channel});
  for(const width of widths){
   await page.setViewportSize({width,height:960});
   for(const route of routes){
    await page.goto(base+'/dashboard?sample=1#'+route.hash);
    await page.locator('#app:not(.hidden)').waitFor();
    await page.waitForFunction(title=>document.querySelector('#page-title')?.textContent===title,width<=760&&route.hash==='overview'?'게시 현황':route.title);
    if(route.site&&width>760)await page.locator('#site-tab-'+route.tab+'[aria-selected="true"]').waitFor();
    if(route.channel&&width>760)await page.locator('#channel-tab-'+route.channel+'[aria-selected="true"]').waitFor();
    await page.evaluate(async()=>{scrollTo(0,0);await Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getTiming().iterations)).map(a=>a.finished.catch(()=>{})));});
    const layout = await page.evaluate(()=>{
     const rect=e=>e.getBoundingClientRect(),collisions=[];
     for(const parent of document.querySelectorAll('#content,#site-panel,.publishing-layout')){
      const children=[...parent.children].filter(e=>rect(e).width&&rect(e).height);
      for(let i=1;i<children.length;i++){
       const a=rect(children[i-1]),b=rect(children[i]);
       if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>8&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>2)collisions.push([children[i-1].className,children[i].className]);
      }
     }
     const gaps=[...document.querySelectorAll('.channel-summary+.publishing-board')].map(e=>rect(e).top-rect(e.previousElementSibling).bottom);
     const actions=[...document.querySelectorAll('.section-heading')].filter(e=>e.children.length===2).map(e=>{const a=rect(e.children[0]),b=rect(e.children[1]);return b.top<a.bottom?b.left-a.right:null;}).filter(v=>v!==null);
     const firstCard=document.querySelector('.mobile-post-card');
     return {overflow:document.documentElement.scrollWidth>innerWidth+1,collisions,gaps,actions,firstCardTop:firstCard?rect(firstCard).top+scrollY:null,activeMode:document.querySelector('.view-switch [aria-current="page"]')?.textContent};
    });
    assert(!layout.overflow,`${width} ${route.hash}: horizontal overflow`);
    assert.deepEqual(layout.collisions,[],`${width} ${route.hash}: block overlap`);
    assert(layout.gaps.every(gap=>gap>=21),`${width} ${route.hash}: card/table gap`);
    assert(layout.actions.every(gap=>gap>=0&&gap<=25),`${width} ${route.hash}: disconnected section action`);
    assert.equal(layout.activeMode,'샘플');
    if(width<=760&&route.hash==='site/tistory/overview')assert(layout.firstCardTop<590,`${width}: first mobile post too far down: ${layout.firstCardTop}`);
    if(route.hash==='overview'&&width>760)assert.equal(await page.locator('.publishing-board tbody tr').count(),4,'Overview shows recent four campaigns');
    results.push({width,route:route.hash,...layout});
    if((width===1440&&['overview','site/tistory/overview','finance','content','publish/all'].includes(route.hash))||(width===390&&route.hash==='site/tistory/overview')||(width===1920&&route.hash==='site/tistory/overview'))await page.screenshot({path:'artifacts/layout/'+width+'-'+route.hash.replaceAll('/','-')+'.png',fullPage:false});
   }
  }
  await page.setViewportSize({width:1440,height:960});
  await page.goto(base+'/dashboard?sample=1#site/tistory/overview');
  await page.getByRole('button',{name:'업로드 상세 보기',exact:true}).click();
  await page.waitForURL('**#publish/all');
  assert.equal(await page.locator('#scope').inputValue(),'all');
  await page.locator('.board-cell[data-action="inspect-content"]').first().click();
  await page.locator('#post-inspector[open]').waitFor();
  const detail=await page.locator('.inspector-meta').textContent();
  for(const label of ['게시 형식','게시 계정','최근 확인'])assert(detail.includes(label));
  await page.getByRole('button',{name:'상세 닫기',exact:true}).click();
  await page.goto(base+'/dashboard#connections');
  await page.locator('.setup-health').waitFor();
  for(const label of ['계정 승인','쇼핑몰 운영','API · 게시 계정','시스템 · 보안']){
   await page.getByRole('button',{name:label,exact:true}).click();
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Settings overflow: '+label);
   await page.screenshot({path:'artifacts/layout/settings-'+label.replaceAll(' · ','-')+'.png',fullPage:false});
  }
  await page.setViewportSize({width:390,height:960});
  await page.goto(base+'/dashboard?sample=1#overview');
  await page.getByRole('button',{name:'메뉴 열기',exact:true}).click();
  await page.locator('.sidebar.open').waitFor();
  const group=page.locator('#category-status');
  if(await group.getAttribute('open')===null)await group.locator('summary').click();
  await page.locator('.nav-item[data-publish="instagram"]').click();
  await page.waitForURL('**#publish/instagram');
  assert.equal(await page.locator('.sidebar.open').count(),0,'Mobile navigation closes');
  assert.deepEqual(errors,[]);
  const report={at:new Date().toISOString(),base,screens:results.length,consoleErrors:errors.length,pass:true,results};
  fs.writeFileSync('artifacts/layout/report.json',JSON.stringify(report,null,2));
  console.log({base,screens:results.length,consoleErrors:errors.length,pass:true});
 } finally {await browser.close();}
}
main().catch(error=>{console.error(error.name+': '+error.message);process.exitCode=1;});
