'use strict';

const assert=require('node:assert/strict');
const {validateConfig,request}=require('../src/server/naver.cjs');
const response=payload=>({ok:true,json:async()=>payload});
const config={apiKeyId:'hub-id',apiKey:'hub-secret'};

async function run(){
 assert.deepEqual(validateConfig({apiKeyId:'new-id'},config),{apiKeyId:'new-id',apiKey:'hub-secret'});
 assert.throws(()=>validateConfig({apiKeyId:'bad\r\nInjected: yes',apiKey:'x'}));
 assert.throws(()=>validateConfig({apiKeyId:'x\u0000',apiKey:'y'}));
 assert.throws(()=>validateConfig({apiKeyId:'x'.repeat(501),apiKey:'y'}));
 assert.throws(()=>validateConfig({apiKeyId:'only-id'},{}));

 let call;
 const news=await request(config,{mode:'news',query:'한글 이벤트'},async(url,options)=>{
  call={url:new URL(url),options};return response({items:[{title:'<b>제목</b>',description:'설명',link:'https://news.example/item',pubDate:'Mon, 01 Jan 2026 00:00:00 +0900',originallink:'https://original.example/item'}]});
 });
 assert.equal(call.url.origin,'https://naverapihub.apigw.ntruss.com');
 assert.equal(call.url.pathname,'/search/v1/news');
 assert.equal(call.url.searchParams.get('query'),'한글 이벤트');
 assert.equal(call.url.searchParams.get('display'),'10');assert.equal(call.url.searchParams.get('start'),'1');
 assert.equal(call.url.searchParams.get('format'),'json');assert.equal(call.url.searchParams.get('sort'),'date');
 assert.equal(call.options.method,'GET');assert.equal(call.options.redirect,'error');
 assert.equal(call.options.headers['X-NCP-APIGW-API-KEY-ID'],config.apiKeyId);
 assert.equal(call.options.headers['X-NCP-APIGW-API-KEY'],config.apiKey);
 assert.equal(call.options.signal.aborted,false);assert.equal(call.options.signal instanceof AbortSignal,true);
 assert.equal(news.items.length,1);assert.equal(news.items[0].title,'<b>제목</b>');
 assert.deepEqual(Object.keys(news.items[0]),['title','description','link','originalLink','pubDate']);
 assert.equal(news.items[0].originalLink,'https://original.example/item');
 assert.equal(JSON.stringify(news).includes(config.apiKey),false);

 for(const mode of ['webkr','image']){
  const items=Array.from({length:12},(_,i)=>({title:`T${i}`,description:`D${i}`,link:'https://example.com/a',thumbnail:'https://example.com/i.jpg',size:'640x480',sizewidth:'640',sizeheight:'480',width:640,height:480,extra:'ignored'}));
  const result=await request(config,{mode,query:'test'},async(url,options)=>{assert.equal(new URL(url).pathname,`/search/v1/${mode}`);assert.equal(options.method,'GET');return response({items});});
  assert.equal(result.items.length,10);
  assert(!('extra' in result.items[0]));
  if(mode==='image')assert.deepEqual(result.items[0],{title:'T0',link:'https://example.com/a',thumbnail:'https://example.com/i.jpg',size:'640x480',width:640,height:480});
  else assert.deepEqual(result.items[0],{title:'T0',description:'D0',link:'https://example.com/a'});
 }

 const today=new Date().toISOString().slice(0,10);
 const trend=await request(config,{mode:'trend',query:'한글 검색어',startDate:'2020-02-28',endDate:'2020-03-01'},async(url,options)=>{
  call={url:new URL(url),options};return response({results:[{title:'한글 검색어',keywords:['한글 검색어'],data:[{period:'2020-02-28',ratio:0},{period:'2020-02-29',ratio:4.25},{period:'2020-03-01',ratio:100},{period:'ignored',ratio:101}]}]});
 });
 assert.equal(call.url.href,'https://naverapihub.apigw.ntruss.com/search-trend/v1/search');
 assert.equal(call.options.method,'POST');assert.equal(call.options.redirect,'error');assert.equal(call.options.headers['Content-Type'],'application/json');
 const body=JSON.parse(call.options.body);assert.equal(body.startDate,'2020-02-28');assert.equal(body.endDate,'2020-03-01');assert.equal(body.timeUnit,'date');
 assert.deepEqual(body.keywordGroups,[{groupName:'한글 검색어',keywords:['한글 검색어']}]);
 assert.equal(trend.metric,'relative-index');assert.deepEqual(trend.results[0].data,[{period:'2020-02-28',ratio:0},{period:'2020-02-29',ratio:4.25},{period:'2020-03-01',ratio:100}]);
 assert.equal(trend.results[0].data[0].ratio,0);assert.equal(JSON.stringify(trend).includes(config.apiKey),false);
 assert.deepEqual((await request(config,{mode:'trend',query:'x',startDate:'2016-01-01',endDate:'2016-12-31'},async()=>response({results:[]}))).results,[]);
 assert.deepEqual((await request(config,{mode:'trend',query:'x',startDate:'2020-01-01',endDate:'2020-12-31'},async()=>response({results:[]}))).results,[]);

 for(const input of [
  {mode:'bogus',query:'x'},
  {mode:'news',query:'x'.repeat(201)},
  {mode:'news',query:'bad\r\nheader'},
  {mode:'trend',query:'x',startDate:'2025-02-29',endDate:'2025-03-01'},
  {mode:'trend',query:'x',startDate:'0000-01-01',endDate:'0000-01-02'},
  {mode:'trend',query:'x',startDate:'2025-02-02',endDate:'2025-01-01'},
  {mode:'trend',query:'x',startDate:'2015-12-31',endDate:'2016-01-01'},
  {mode:'trend',query:'x',startDate:'2020-01-01',endDate:'2021-01-01'},
  {mode:'trend',query:'x',startDate:'2020-01-01',endDate:today==='9999-12-31'?'9999-12-31':'2999-01-01'},
  {mode:'trend',startDate:'2020-01-01',endDate:'2020-02-01',keywordGroups:Array.from({length:6},(_,i)=>({groupName:`g${i}`,keywords:['k']}))}
 ])await assert.rejects(request(config,input,async()=>assert.fail('invalid input must not call fetch')));

 for(const [mode,payload] of [['news',{}],['webkr',{items:null}],['image',{items:{}}],['trend',{}],['trend',{results:null}]]){
  const input=mode==='trend'?{mode,query:'x',startDate:'2020-01-01',endDate:'2020-01-02'}:{mode,query:'x'};
  await assert.rejects(request(config,input,async()=>response(payload)),error=>error.status===502&&error.message==='네이버 API 요청을 처리할 수 없습니다. 입력·권한·이용 한도를 확인하세요.');
 }
 assert.deepEqual((await request(config,{mode:'news',query:'x'},async()=>response({items:[]}))).items,[]);
 assert.deepEqual((await request(config,{mode:'trend',query:'x',startDate:'2020-01-01',endDate:'2020-01-02'},async()=>response({results:[]}))).results,[]);

 for(const stub of [
  async(_url,options)=>{assert.equal(options.redirect,'error');assert.equal(options.signal.aborted,false);throw Error(config.apiKey);},
  async()=>({ok:false,status:403,json:async()=>({message:config.apiKey})}),
  async()=>({ok:true,json:async()=>{throw Error(config.apiKey);}})
 ])await assert.rejects(request(config,{mode:'webkr',query:'x'},stub),error=>error.status===502&&error.message==='네이버 API 요청을 처리할 수 없습니다. 입력·권한·이용 한도를 확인하세요.'&&!error.message.includes(config.apiKey));

 console.log('PASS Naver API HUB validation, request shaping, response limits, trend zero preservation and safe errors');
}

run().catch(error=>{console.error(error);process.exitCode=1;});
