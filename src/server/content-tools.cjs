'use strict';
const MarkdownIt=require('markdown-it'),sanitize=require('sanitize-html');
const md=new MarkdownIt({html:false,linkify:false,typographer:false,breaks:true});
const CHANNELS=['blog','instagram','threads','x','facebook','linkedin','pinterest','youtube','tiktok'];
const CHANNEL_LIMITS={blog:20000,instagram:2200,threads:500,x:280,facebook:5000,linkedin:3000,pinterest:500,youtube:5000,tiktok:2200};
function fail(message){throw Object.assign(new Error(message),{status:400});}
function string(v,label,max,optional=false){if(typeof v!=='string'||v.length>max||(!optional&&!v.trim()))fail(label+'을 확인하세요.');return v.trim();}
function httpsURL(v,label='HTTPS 주소',optional=true){
 const s=string(v,label,2000,optional);if(!s)return '';
 let u;try{u=new URL(s);}catch{fail(label+'을 확인하세요.');}
 if(u.protocol!=='https:'||u.username||u.password||/[\u0000-\u0020\u007f]/.test(s))fail(label+'는 공개 HTTPS 주소로 입력하세요.');return u.href;
}
function validateSEO(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value))fail('SEO 설정을 확인하세요.');
 const seo={};for(const [key,max] of Object.entries({title:300,description:500,slug:200,keyword:200,cta:500}))seo[key]=string(value[key]??'',key,max,true);
 if(seo.slug&&(!/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(seo.slug)))fail('슬러그는 문자·숫자·하이픈으로 입력하세요.');
 seo.url=httpsURL(value.url??'');
 if(value.affiliate!==undefined&&typeof value.affiliate!=='boolean')fail('제휴 여부를 확인하세요.');seo.affiliate=value.affiliate===true;
 if(value.sources!==undefined&&!Array.isArray(value.sources)||value.sources?.length>10)fail('출처는 최대 10개입니다.');
 seo.sources=(value.sources||[]).map(s=>{if(!s||typeof s!=='object'||Array.isArray(s))fail('출처를 확인하세요.');return {title:string(s.title,'출처 제목',300),url:httpsURL(s.url,'출처 주소',false)};});return seo;
}
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function renderMarkdown(body){return sanitize(md.render(string(body,'본문',20000)),{
 allowedTags:['p','br','hr','h1','h2','h3','h4','h5','h6','blockquote','ul','ol','li','strong','em','s','code','pre','a','table','thead','tbody','tr','th','td'],
 allowedAttributes:{a:['href','title','rel'],ol:['start'],th:['align'],td:['align']},allowedSchemes:['https'],allowProtocolRelative:false,
 transformTags:{a:(tag,attrs)=>{let href='';try{href=httpsURL(attrs.href||'');}catch{}return {tagName:'a',attribs:{...(href?{href}:{}),...(attrs.title?{title:attrs.title}:{}),rel:'noopener noreferrer nofollow'}};}}
});}
function inspect(body){
 const tokens=md.parse(body,{}),headings=[],links=[],lines=[];
 for(let i=0;i<tokens.length;i++){
  const t=tokens[i];if(t.type==='heading_open')headings.push({level:Number(t.tag.slice(1)),text:tokens[i+1]?.content||''});
  if(t.type==='inline'){
   lines.push((t.children||[]).filter(t=>['text','code_inline','softbreak','hardbreak'].includes(t.type)).map(t=>t.type.includes('break')?' ':t.content).join(''));
   let current;for(const child of t.children||[]){if(child.type==='link_open'){current={text:'',url:child.attrGet('href')};}else if(child.type==='link_close'){if(current?.url?.startsWith('https://'))links.push(current);current=null;}else if(current)current.text+=child.content||'';}
  }else if(['fence','code_block'].includes(t.type))lines.push(t.content);
 }return {headings,links,plain:lines.join('\n').trim()};
}
function preview(input){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('미리보기 입력을 확인하세요.');
 const title=string(input.title,'제목',300),body=string(input.body,'본문',20000),seo=validateSEO(input.seo),{headings,links,plain}=inspect(body);
 const checks=[
  {id:'title',label:'검색 제목',pass:!!seo.title&&seo.title.length<=70,hint:'검색 제목을 70자 이내로 명확하게 작성하세요.'},
  {id:'description',label:'검색 설명',pass:seo.description.length>=30&&seo.description.length<=160,hint:'30~160자로 핵심 답변을 요약하세요.'},
  {id:'slug',label:'주소 슬러그',pass:!!seo.slug,hint:'내용을 알아볼 수 있는 주소 슬러그를 입력하세요.'},
  {id:'headings',label:'소제목',pass:headings.some(h=>h.level>=2),hint:'긴 설명은 소제목으로 나누세요.'},
  {id:'keyword',label:'핵심 주제',pass:!!seo.keyword&&(title+' '+plain).toLocaleLowerCase().includes(seo.keyword.toLocaleLowerCase()),hint:'핵심 주제를 제목이나 본문에 자연스럽게 포함하세요.'},
  {id:'sources',label:'근거·출처',pass:seo.sources.length>0||links.length>0,hint:'확인 가능한 공개 자료를 링크하고 근거 없는 수치를 피하세요.'},
  {id:'answer',label:'명확한 첫 답변',pass:(linesFirst(plain).length>=20&&linesFirst(plain).length<=300),hint:'첫 문단에서 독자가 찾는 답을 간결하게 설명하세요.'},
  {id:'cta',label:'다음 행동',pass:!!seo.cta,hint:'문의·이용 안내 등 다음 행동을 적으세요.'},
  {id:'disclosure',label:'광고·제휴 표시',pass:!seo.affiliate||/(광고|제휴|협찬|수수료|경제적 대가)/.test(plain.slice(0,300)),hint:'광고·제휴 글은 본문 앞 300자 안에 광고 또는 수수료 관계를 명확히 표시하세요.'}
 ];
 const html=renderMarkdown(body),description=seo.description||plain.slice(0,160),pageTitle=seo.title||title,json=JSON.stringify({'@context':'https://schema.org','@type':'Article',headline:pageTitle,description,...(seo.url?{url:seo.url,mainEntityOfPage:seo.url}:{}),...(seo.sources.length?{citation:seo.sources.map(s=>({'@type':'CreativeWork',name:s.title,url:s.url}))}:{})}).replace(/[<>&\u2028\u2029]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
 const document='<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(pageTitle)+'</title><meta name="description" content="'+escape(description)+'">'+(seo.url?'<link rel="canonical" href="'+escape(seo.url)+'">':'')+'<meta property="og:title" content="'+escape(pageTitle)+'"><meta property="og:description" content="'+escape(description)+'"><script type="application/ld+json">'+json+'</script></head><body><article><h1>'+escape(title)+'</h1>'+html+'</article></body></html>';
 return {html,document,analysis:{score:Math.round(checks.filter(c=>c.pass).length/checks.length*100),checks,words:plain.split(/\s+/u).filter(Boolean).length,characters:Array.from(plain).length,readingMinutes:Math.max(1,Math.ceil(Array.from(plain).length/600)),headings,links,notice:'편집 점검용입니다. 검색·AI 답변 노출이나 순위를 보장하지 않습니다.'},seo};
}
function linesFirst(s){return s.split('\n').find(Boolean)||'';}
const weight=(s,channel)=>Array.from(s).reduce((n,c)=>n+(channel==='blog'?c.length:channel==='x'&&c.codePointAt(0)>0x10ff?2:1),0);
function fit(s,budget,channel){let out='',n=0;for(const c of s){const k=weight(c,channel);if(n+k>budget)break;out+=c;n+=k;}return out.trim();}
function repurpose(post,channels){
 if(!Array.isArray(channels)||!channels.length||channels.length>CHANNELS.length||channels.some(c=>!CHANNELS.includes(c)))fail('재가공할 채널을 선택하세요.');
 const title=string(post.title,'제목',300),body=string(post.body,'본문',20000),seo=validateSEO(post.seo),plain=inspect(body).plain,url=httpsURL(seo.url||post.link||''),cta=seo.cta||'원문에서 자세한 내용을 확인하세요.',marker='[규칙 기반 홍보 초안]';
 return [...new Set(channels)].map(channel=>{
  const limit=CHANNEL_LIMITS[channel],suffix='\n\n'+fit(cta,channel==='x'?50:['threads','pinterest'].includes(channel)?100:500,channel)+(url?'\n'+url:'');
  if(weight(marker+suffix,channel)>=limit)fail('원문 링크 또는 다음 행동이 채널 제한보다 깁니다.');
  return {channel,title,body:marker+'\n'+fit(title+'\n\n'+(channel==='blog'?body:plain),limit-weight(marker+'\n'+suffix,channel),channel)+suffix,ruleBased:true,ai:false};
 });
}
module.exports={CHANNELS,CHANNEL_LIMITS,validateSEO,httpsURL,renderMarkdown,preview,repurpose,weight};
