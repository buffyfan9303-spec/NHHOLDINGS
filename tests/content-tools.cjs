'use strict';
const assert=require('node:assert/strict');
const {validateSEO,renderMarkdown,preview,repurpose,weight}=require('../src/server/content-tools.cjs');
const {preflight,inspectPublication}=require('../src/server/dashboard.cjs');
async function run(){
 const input={title:'공개 자료로 안내하는 누리 서비스',body:'누리 서비스의 이용 방법을 공개 자료에 따라 명확하고 간결하게 설명합니다.\n\n## 이용 방법\n**안내**를 확인하세요. [공식 자료](https://example.com/guide)\n\n<script>alert(1)</script>\n[위험](javascript:alert(1))\n[상대](/secret)',seo:{title:'누리 서비스 이용 방법',description:'누리 서비스의 이용 방법과 확인할 내용을 공개 자료를 바탕으로 설명합니다.',slug:'누리-서비스',keyword:'누리',cta:'공식 안내를 확인하세요.',url:'https://example.com/article',sources:[{title:'공식 안내',url:'https://example.com/guide'}],affiliate:false}};
 const result=preview(input);assert.match(result.html,/<h2>이용 방법<\/h2>/);assert.match(result.html,/<strong>안내<\/strong>/);assert.match(result.html,/&lt;script&gt;/);assert.doesNotMatch(result.html,/<script|href="javascript:|href="\/secret"/i);assert.match(result.document,/rel="canonical"/);assert.equal(result.analysis.headings[0].text,'이용 방법');assert.equal(result.analysis.links[0].url,'https://example.com/guide');assert.equal(result.analysis.score,100);
 const hostile=preview({...input,title:'<img src=x onerror=alert(1)>',seo:{...input.seo,title:'</title><script>bad</script>',description:'" onload="bad </script><script>bad</script>'}});
 assert.doesNotMatch(hostile.document,/<img|<script>bad|<\/title><script>/i);assert.equal((hostile.document.match(/<\/script>/g)||[]).length,1);assert.match(hostile.document,/\\u003c/);
 assert.doesNotMatch(renderMarkdown('[bad](http://example.com) [bad2](//evil.test) ![image](https://example.com/x.svg)'),/href=|<img/);
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
