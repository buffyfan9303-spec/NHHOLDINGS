'use strict';
const assert=require('node:assert/strict');
const {validateSEO,renderMarkdown,preview,repurpose,weight}=require('../src/server/content-tools.cjs');
const {preflight,inspectPublication,defaultPublishingSettings,validatePublishingSettings}=require('../src/server/dashboard.cjs');
async function run(){
 const publishing=defaultPublishingSettings();assert.deepEqual(publishing,{timezone:'Asia/Seoul',dailyCount:5,times:['08:00','12:00','16:00','20:00','22:00'],enabled:false,version:1});
 assert.equal(validatePublishingSettings({timezone:'Asia/Seoul',dailyCount:1,times:['08:30'],enabled:false},null).version,2);
 const saved=validatePublishingSettings({timezone:'Asia/Seoul',dailyCount:2,times:['09:30','18:00'],enabled:false},{version:4});assert.deepEqual({timezone:saved.timezone,dailyCount:saved.dailyCount,times:saved.times,enabled:saved.enabled,version:saved.version},{timezone:'Asia/Seoul',dailyCount:2,times:['09:30','18:00'],enabled:false,version:5});
 for(const invalid of [{dailyCount:0,times:[],timezone:'Asia/Seoul',enabled:false},{dailyCount:2,times:['09:00'],timezone:'Asia/Seoul',enabled:false},{dailyCount:2,times:['09:00','09:00'],timezone:'Asia/Seoul',enabled:false},{dailyCount:1,times:['24:00'],timezone:'Asia/Seoul',enabled:false},{dailyCount:1,times:['09:00'],timezone:'UTC',enabled:false},{dailyCount:1,times:['09:00'],timezone:'Asia/Seoul',enabled:true},{dailyCount:1,times:['09:00'],timezone:'Asia/Seoul',enabled:'false'}])assert.throws(()=>validatePublishingSettings(invalid,null));
 const input={title:'공개 자료로 안내하는 누리 서비스',body:'누리 서비스의 이용 방법을 공개 자료에 따라 명확하고 간결하게 설명합니다.\n\n## 이용 방법\n**안내**를 확인하세요. [공식 자료](https://example.com/guide)\n\n<script>alert(1)</script>\n[위험](javascript:alert(1))\n[상대](/secret)',seo:{title:'누리 서비스 이용 방법',description:'누리 서비스의 이용 방법과 확인할 내용을 공개 자료를 바탕으로 설명합니다.',slug:'누리-서비스',keyword:'누리',cta:'공식 안내를 확인하세요.',url:'https://example.com/article',sources:[{title:'공식 안내',url:'https://example.com/guide'}],affiliate:false}};
 const result=preview(input);assert.match(result.html,/<h2>이용 방법<\/h2>/);assert.match(result.html,/<strong>안내<\/strong>/);assert.match(result.html,/&lt;script&gt;/);assert.doesNotMatch(result.html,/<script|href="javascript:|href="\/secret"/i);assert.match(result.document,/rel="canonical"/);assert.equal(result.analysis.headings[0].text,'이용 방법');assert.equal(result.analysis.links[0].url,'https://example.com/guide');assert.equal(result.analysis.score,100);
 const article=preview({...input,body:'# 본문 소제목\n\n'+input.body+'\n\n| 항목 | 값 |\n| --- | --- |\n| 긴 값 | '+ 'x'.repeat(200)+' |\n\n```\n'+'x'.repeat(200)+'\n```\n\n<style>body{display:none}</style>'});
 assert(article.document.includes(article.html),'preview, clipboard HTML and document must share the exact safe article fragment');
 assert.equal((article.document.match(/<h1(?:\s|>)/g)||[]).length,1);assert.match(article.html,/<h2>본문 소제목<\/h2>/);assert.match(renderMarkdown('# 원본 제목'),/<h1>원본 제목<\/h1>/);
 assert.equal((article.html.match(/<style>/g)||[]).length,1);assert.match(article.html,/&lt;style&gt;body\{display:none\}&lt;\/style&gt;/);assert.doesNotMatch(article.html,/<article|<h1|<script/i);
 const articleCSS=article.html.match(/<style>([\s\S]*?)<\/style>/)[1];
 for(const rule of articleCSS.trim().split('}').filter(s=>s.trim()))for(const selector of rule.split('{')[0].split(','))assert(selector.trim().startsWith('.nuri-article.nuri-article'),'article CSS must not affect dashboard or platform chrome');
 for(const rule of ['font:400 18px/1.85','max-width:860px','max-width:100%','overflow-wrap:anywhere','overflow-x:auto','white-space:pre-wrap','height:auto','a:focus-visible','background:#fff!important','color:#164b99!important'])assert(articleCSS.includes(rule),rule);
 const hostile=preview({...input,title:'<img src=x onerror=alert(1)>',seo:{...input.seo,title:'</title><script>bad</script>',description:'" onload="bad </script><script>bad</script>'}});
 assert.doesNotMatch(hostile.document,/<img|<script>bad|<\/title><script>/i);assert.equal((hostile.document.match(/<\/script>/g)||[]).length,1);assert.match(hostile.document,/\\u003c/);
 const image=renderMarkdown('![대체 텍스트](https://example.com/x.svg "사진")');assert.match(image,/<img src="https:\/\/example\.com\/x\.svg" alt="대체 텍스트" title="사진" loading="lazy" decoding="async" style="max-width:100%;height:auto"\s\/>/);assert.match(preview({...input,body:'![대체 텍스트](https://example.com/x.svg)'}).html,/alt="대체 텍스트" loading="lazy" decoding="async" style="max-width:100%;height:auto"/);assert.match(preview({...input,body:'![대체 텍스트](https://example.com/x.svg)',seo:{...input.seo,description:''}}).document,/<meta name="description" content="대체 텍스트">/);
 for(const url of ['http://example.com/x.png','data:image/png;base64,AAAA','javascript:alert(1)','//evil.test/x.png','https://user:secret@example.com/x.png'])assert.doesNotMatch(renderMarkdown(`![safe alt](${url})`),/<img\s|\ssrc=|\sonerror=/i);
 const rawHTML=renderMarkdown('<img src="https://example.com/x.png" alt="x" onerror="alert(1)">');assert.match(rawHTML,/&lt;img/);assert.doesNotMatch(rawHTML,/<img\s/);
 assert.doesNotMatch(renderMarkdown('[bad](http://example.com) [bad2](//evil.test)'),/href=/);
 for(const seo of [{url:'javascript:alert(1)'},{url:'https://user:secret@example.com'},{sources:Array(11).fill({title:'x',url:'https://example.com'})},{sources:[{title:'x',url:'data:text/html,hi'}]},{affiliate:'true'},{slug:'../bad'}])assert.throws(()=>validateSEO(seo),{status:400});
 assert.throws(()=>preview({...input,body:'x'.repeat(20001)}),{status:400});assert.throws(()=>preview({...input,title:'x'.repeat(301)}),{status:400});
 assert.equal(preview({...input,seo:{...input.seo,affiliate:true}}).analysis.checks.find(c=>c.id==='disclosure').pass,false);
 assert.equal(preview({...input,body:'[광고] 이 글에는 제휴 수수료가 있습니다.\n'+input.body,seo:{...input.seo,affiliate:true}}).analysis.checks.find(c=>c.id==='disclosure').pass,true);
 assert.equal(preview({...input,body:'안'.repeat(301)+'\n제휴 수수료가 있습니다.',seo:{...input.seo,affiliate:true}}).analysis.checks.find(c=>c.id==='disclosure').pass,false);
 const channels=['blog','instagram','threads','x','facebook','linkedin','pinterest','youtube','tiktok'],limits={blog:20000,instagram:2200,threads:500,x:280,facebook:5000,linkedin:3000,pinterest:500,youtube:5000,tiktok:2200};
 for(const draft of repurpose({...input,body:'매우 긴 공개 서비스 안내입니다. '.repeat(500)},channels)){
  assert.match(draft.body,/규칙 기반 홍보 초안/);assert.match(draft.body,/https:\/\/example.com\/article/);assert(weight(draft.body,draft.channel)<=limits[draft.channel]);assert.equal(draft.ai,false);
  if(['blog','instagram','threads','x'].includes(draft.channel))preflight({...draft,service:'tistory',blogTarget:'wordpress',media:'https://example.com/image.jpg'});
  else {assert.throws(()=>preflight({...draft,service:'tistory'}),/자동 게시 API/);assert.deepEqual(await inspectPublication({...draft,externalId:'manual:x'},null,()=>assert.fail('manual posts must not fetch')),{checkStatus:'unavailable'});}
 }
 assert.throws(()=>preflight({service:'crm',channel:'x',body:'과거 기록'}),/독립 운영/);assert.equal(repurpose(input,['x','x']).length,1);assert.throws(()=>repurpose(input,['unknown']),{status:400});
 assert(repurpose({...input,body:'😀'.repeat(9999)},['blog'])[0].body.length<=20000);
 console.log('PASS safe Markdown, SEO metadata/JSON-LD, disclosure checks, validation, nine-channel repurposing and manual-only preflight');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
