'use strict';

// Approved workbench mail/SNS decisions open the automation editor with the same owner-scoped project payload
// that AI answers use. Mocked API only: nothing is saved, sent or published.
const assert=require('node:assert/strict');
const {chromium,webkit}=require('@playwright/test');
const fs=require('node:fs');

const source='https://workbench-handoff.test';
const owner='workbench-fixture-a';
const project={id:'7a1e2b3c-4d5e-4f60-8a9b-0c1d2e3f4a01',name:'고객 안내 프로젝트 '+'긴 이름 '.repeat(10),rules:'',version:2};
const decisions=[
 {id:'d-mail',category:'mail',title:'승인된 메일 초안',text:'승인된 메일 본문',status:'applied',projectId:project.id,projectVersion:2,revision:1,source:'Claude'},
 {id:'d-social',category:'content',title:'승인된 게시 초안',text:'승인된 게시 본문',status:'applied',projectId:project.id,projectVersion:2,revision:1,source:'Claude'},
 {id:'d-gone',category:'mail',title:'삭제된 프로젝트의 메일',text:'본문',status:'applied',projectId:'7a1e2b3c-4d5e-4f60-8a9b-0c1d2e3f4a99',revision:1,source:'Claude'},
 {id:'d-free',category:'mail',title:'프로젝트 없는 메일',text:'본문',status:'applied',revision:1,source:'Claude'},
];

async function scenario(page){
 const posts=[];
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin!==source)return route.abort();
  if(url.pathname==='/personal')return route.fulfill({contentType:'text/html',body:'<!doctype html><main><section id="workbench"></section></main>'});
  if(url.pathname==='/api/personal/workbench'){
   assert.equal(req.headers()['x-personal-account'],owner);
   if(req.method()!=='GET'){posts.push(req.postDataJSON());return route.fulfill({status:400,json:{error:'mock is read-only'}});}
   if(url.search)return route.fulfill({json:{activity:[],channels:[]}});
   return route.fulfill({json:{projects:[project],decisions}});
  }
  return route.fulfill({status:404,json:{error:'not mocked'}});
 });
 await page.goto(source+'/personal#workbench');
 await page.evaluate(owner=>{
  window.NuriPersonalAccount=owner;
  window.handoffs=[];
  window.NuriPersonalAutomation={reviewApprovedDraft(...args){window.handoffs.push(args);return true;},selectSocialCard(){}};
  window.NuriPersonalWorkspace={reviewDraft(kind,draft){window.handoffs.push(['note',draft]);return true;}};
 },owner);
 await page.addScriptTag({path:'public/one/workbench.js'});
 const open=async(id,label)=>{
  await page.evaluate(id=>{history.replaceState(null,'','/personal#workbench?pane=approvals&review='+id);window.NuriWorkbench.mount();},id);
  await page.getByRole('button',{name:label,exact:true}).click();
  return page.evaluate(()=>window.handoffs.at(-1));
 };
 await page.evaluate(()=>window.NuriWorkbench.mount());
 await page.getByRole('heading').first().waitFor();
 assert.deepEqual(await open('d-mail','메일 초안 열기'),['mail','승인된 메일 초안','승인된 메일 본문',null,{id:project.id,name:project.name}]);
 assert.deepEqual(await open('d-social','게시 초안 열기'),['social','승인된 게시 초안','승인된 게시 본문',null,{id:project.id,name:project.name}]);
 assert.deepEqual(await open('d-gone','메일 초안 열기'),['mail','삭제된 프로젝트의 메일','본문',null,null],'a removed project is not linked');
 assert.deepEqual(await open('d-free','메일 초안 열기'),['mail','프로젝트 없는 메일','본문',null,null]);
 assert.deepEqual(posts,[],'opening a draft never writes');
}

(async()=>{
 const engines=[['Chromium',chromium,fs.existsSync(chromium.executablePath())?{}:{channel:'chrome'}],['WebKit',webkit,{}]];
 for(const [name,engine,options] of engines){
  const browser=await engine.launch({headless:true,...options});
  try{
   for(const [width,colorScheme] of [[390,'dark'],[1440,'light']]){
    const page=await browser.newPage({viewport:{width,height:870},colorScheme});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await scenario(page);
    assert.deepEqual(errors,[]);
    console.log(name,width,colorScheme,'passed');
    await page.close();
   }
  }finally{await browser.close();}
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
