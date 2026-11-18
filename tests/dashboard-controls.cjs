'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium,webkit}=require('@playwright/test');

const document=fs.readFileSync('src/server/dashboard.html','utf8');
const styles=[...document.matchAll(/<link rel="stylesheet" href="(\/one\/[^"]+\.css)">/g)]
 .map(([,url])=>path.join('public',url)).filter(name=>!name.includes('/fonts/'));
const shell=document.replace(/<link [^>]+>/g,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
const home='https://nuri-controls.test/dashboard';
const widths=[320,390,768,900,901,1024,1440,1920];
const engines=[
 ['Chromium',chromium,fs.existsSync(chromium.executablePath())?{}:{channel:'chrome'}],
 ['WebKit',webkit,{}],
];
const sections=String.raw`
 <div class="daily-brand"><label class="field">브랜드<select name="daily-brand"><option>모든 브랜드</option><option>누리마인드</option></select></label></div>
 <form class="approval-form form-grid">
  <label class="field">게시 계정<select name="account"><option>누리홀덤과 누리마인드에서 사용하는 길고 정식인 계정 이름</option><option value="other">다른 계정</option></select></label>
  <label class="field">게시 시각<input type="datetime-local" value="2026-11-19T17:45"></label>
 </form>
 <fieldset class="publication-fields form-grid">
  <label class="field">아동용 콘텐츠<select name="youtubeMadeForKids"><option>선택</option><option>예</option></select></label>
  <label class="field">날짜<input type="date" value="2026-11-19"></label>
 </fieldset>
 <div class="studio-writing-tools"><label>시작 템플릿<select id="studio-template"><option>검색 질문에 답하기</option></select></label></div>
 <div class="studio-library-head"><label class="field">콘텐츠 검색<input type="search" value="누리마인드"></label></div>
 <details class="panel disclosure" id="motion-disclosure"><summary>공개 후 시각</summary><div class="panel-inner">보고서</div></details>
 <select id="native-list" multiple><option>전체 웹사이트</option><option>다른 웹사이트</option></select>
`;

async function createPage(browser,settings={}){
 const page=await browser.newPage(settings);
 await page.route('**/*',route=>route.request().url()===home?
  route.fulfill({contentType:'text/html',body:shell}):route.abort());
 await page.goto(home);
 for(const file of styles)await page.addStyleTag({content:fs.readFileSync(file,'utf8')});
 await page.evaluate(html=>{
  const show=id=>document.getElementById(id).classList.remove('hidden');
  const hide=id=>document.getElementById(id).classList.add('hidden');
  show('app');
  hide('login');
  const heading=document.querySelector('.heading-controls');
  heading.hidden=false;
  const scope=heading.querySelector('#scope'),period=heading.querySelector('#period');
  scope.innerHTML='<option>전체 웹사이트</option><option value="mind">누리마인드 공식 서비스</option>';
  scope.disabled=false;
  period.innerHTML='<option>2026년 11월</option><option>2027년 12월</option>';
  heading.querySelectorAll('.heading-filter').forEach(filter=>filter.hidden=false);
  document.getElementById('content').innerHTML=html;
 },sections);
 return page;
}

async function checkControls(page,width,engine){
 await page.setViewportSize({width,height:850});
 await page.locator('select[name="account"]').selectOption({index:0});
 const result=await page.evaluate(()=>{
  const rect=node=>node.getBoundingClientRect();
  const controls=[...document.querySelectorAll('.main select:not([multiple],[size])')].map(node=>{
   const style=getComputedStyle(node);
   const farthest=style.backgroundPositionX.split(',').at(-1);
   const inset=Number(farthest.match(/(\d+(?:\.\d+)?)px/)?.[1]);
   return {name:node.name||node.id,height:rect(node).height,appearance:style.appearance,
    image:style.backgroundImage,inset,padding:Number.parseFloat(style.paddingInlineEnd)};
  });
  const widthOfFilters=document.querySelector('.heading-controls').clientWidth;
  const filterBoxes=[...document.querySelectorAll('.heading-controls .heading-filter')].map(node=>{
   const {left,top,right,width}=rect(node);
   return {left,top,right,width};
  });
  const clippedFields=[...document.querySelectorAll('.field input')].filter(node=>rect(node).right>rect(node.closest('.field')).right+1)
   .map(node=>({type:node.type,actual:rect(node).width,available:rect(node.closest('.field')).width}));
  const extraArrow=[...document.querySelectorAll('.heading-filter-value,.approval-form .field,.publication-fields .field')]
   .some(node=>['::before','::after'].some(pseudo=>['""',"''"].includes(getComputedStyle(node,pseudo).content)));
  const outside=[...document.querySelectorAll('body,body *')].filter(node=>rect(node).right>innerWidth+1||node.clientWidth>0&&node.scrollWidth>node.clientWidth+1)
   .slice(0,18).map(node=>[node.id||String(node.className)||node.tagName,Math.round(rect(node).right),node.scrollWidth,node.clientWidth]);
  return {controls,clippedFields,extraArrow,widthOfFilters,filterBoxes,outside,
   native:getComputedStyle(document.getElementById('native-list')).backgroundImage,
   overflow:document.documentElement.scrollWidth>innerWidth+1};
 });
 const label=engine+' '+width;
 assert.equal(result.controls.length,6,label);
 assert(result.controls.every(item=>item.height>=44&&item.appearance==='none'&&item.padding>=36&&
  item.inset>=14&&item.inset<=16&&item.image.startsWith('linear-gradient(')),JSON.stringify({label,...result}));
 const [first,second]=result.filterBoxes;
 assert(first.width>=120&&second.width>=120&&Math.abs(first.width-second.width)<=1&&
  Math.abs(first.top-second.top)<=1&&second.left-first.right>=8&&second.right-first.left<=result.widthOfFilters+1,
 label+' aligned header filters: '+JSON.stringify(result.filterBoxes));
 assert(result.clippedFields.length===0&&!result.extraArrow&&!result.overflow,
  label+' '+JSON.stringify({clipped:result.clippedFields,extraArrow:result.extraArrow,overflow:result.overflow,outside:result.outside}));
 assert.equal(result.native,'none',label+' native multiple');
 const field=page.locator('select[name="account"]');
 await field.focus();
 assert.equal(await field.evaluate(node=>document.activeElement===node),true,label+' focus');
 await field.selectOption('other');
 assert.equal(await field.inputValue(),'other',label+' choice');
}

async function verifyMotion(page,reduce){
 const result=await page.evaluate(()=>{
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-scrim').hidden=false;
  document.getElementById('motion-disclosure').open=true;
  return {
   drawer:getComputedStyle(document.getElementById('sidebar')).animationName,
   scrim:getComputedStyle(document.getElementById('sidebar-scrim')).animationName,
   disclosure:getComputedStyle(document.querySelector('#motion-disclosure>.panel-inner')).animationName,
   content:getComputedStyle(document.getElementById('content')).animationName,
  };
 });
 assert.equal(result.content,'none','routine content refresh never replays an entrance');
 assert.equal(result.disclosure,reduce?'none':'one-expand');
 if(reduce)assert.equal(result.drawer,'none');
 else assert(result.drawer==='one-drawer-enter'||result.drawer==='none');
 if(reduce)assert.equal(result.scrim,'none');
}

async function verifyFilterVisibility(page){
 const controls=page.locator('.heading-controls');
 const scope=controls.locator('.heading-filter').first();
 await scope.evaluate(node=>node.hidden=true);
 assert.equal(await scope.isVisible(),false,'the view may hide its fixed website scope');
 assert.equal(await controls.locator('#period').isVisible(),true,'the period stays available when used');
 await controls.evaluate(node=>node.hidden=true);
 assert.equal(await controls.isVisible(),false,'the view may hide its whole filter row');
}

(async()=>{
 const verified=[];
 for(const [name,engine,options] of engines){
  const browser=await engine.launch({headless:true,...options});
  try{
   const page=await createPage(browser);
   for(const width of widths){await checkControls(page,width,name);verified.push(name+' '+width);}
   await page.setViewportSize({width:390,height:850});
   await verifyMotion(page,false);
   await page.emulateMedia({reducedMotion:'reduce'});
   await verifyMotion(page,true);
   await verifyFilterVisibility(page);
   await page.close();
  }finally{await browser.close();}
 }
 console.log('Dashboard controls verified at 100%:',verified.join(', '));
})().catch(error=>{console.error(error);process.exitCode=1;});
