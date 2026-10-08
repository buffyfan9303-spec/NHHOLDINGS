'use strict';
const MarkdownIt=require('markdown-it'),sanitize=require('sanitize-html');
const twitterTextModule=require('twitter-text'),twitterText=twitterTextModule.default||twitterTextModule;
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
 allowedTags:['p','br','hr','h1','h2','h3','h4','h5','h6','blockquote','ul','ol','li','strong','em','s','code','pre','a','img','table','thead','tbody','tr','th','td'],
 allowedAttributes:{a:['href','title','rel'],img:['src','alt','title','loading','decoding','style'],ol:['start'],th:['align'],td:['align']},allowedSchemes:['https'],allowProtocolRelative:false,
 transformTags:{a:(tag,attrs)=>{let href='';try{href=httpsURL(attrs.href||'');}catch{}return {tagName:'a',attribs:{...(href?{href}:{}),...(attrs.title?{title:attrs.title}:{}),rel:'noopener noreferrer nofollow'}};},img:(tag,attrs)=>{let src='';try{src=httpsURL(attrs.src||'');}catch{}return {tagName:'img',attribs:{...(src?{src}:{}),alt:attrs.alt||'',...(attrs.title?{title:attrs.title}:{}),loading:'lazy',decoding:'async',style:'max-width:100%;height:auto'}};}},
 exclusiveFilter:frame=>frame.tag==='img'&&!frame.attribs.src
});}
const ARTICLE_STYLE=`
.nuri-article.nuri-article{box-sizing:border-box!important;width:100%!important;max-width:860px!important;min-width:0!important;margin:0 auto!important;padding:clamp(18px,4vw,32px)!important;background:#fff!important;color:#243247!important;font:400 18px/1.85 system-ui,-apple-system,"Segoe UI",sans-serif!important;text-align:left!important;overflow-wrap:anywhere!important;word-break:normal!important;border:1px solid #e2e8f0!important;border-radius:12px!important}
.nuri-article.nuri-article *{box-sizing:border-box!important;min-width:0!important;max-width:100%!important;color:inherit!important;font-family:inherit!important;font-size:inherit!important;line-height:inherit!important;overflow-wrap:anywhere!important}
.nuri-article.nuri-article p,.nuri-article.nuri-article ul,.nuri-article.nuri-article ol{margin:0 0 1em!important}
.nuri-article.nuri-article ul,.nuri-article.nuri-article ol{padding-left:1.5em!important}
.nuri-article.nuri-article ul{list-style:disc!important}.nuri-article.nuri-article ol{list-style:decimal!important}.nuri-article.nuri-article li{margin:.3em 0!important}
.nuri-article.nuri-article h1,.nuri-article.nuri-article h2,.nuri-article.nuri-article h3,.nuri-article.nuri-article h4,.nuri-article.nuri-article h5,.nuri-article.nuri-article h6{color:#142b49!important;font-weight:750!important;line-height:1.45!important;margin:1.6em 0 .65em!important;letter-spacing:-.025em!important}
.nuri-article.nuri-article h1{font-size:1.75em!important}.nuri-article.nuri-article h2{font-size:1.4em!important;border-bottom:1px solid #e2e8f0!important;padding-bottom:.4em!important}.nuri-article.nuri-article h3{font-size:1.2em!important}
.nuri-article.nuri-article a{color:#164b99!important;text-decoration:underline!important;text-underline-offset:.18em!important}.nuri-article.nuri-article a:focus-visible{outline:3px solid #164b99!important;outline-offset:3px!important}
.nuri-article.nuri-article strong{font-weight:750!important}.nuri-article.nuri-article em{font-style:italic!important}
.nuri-article.nuri-article blockquote{margin:1.2em 0!important;padding:16px 20px!important;border-left:4px solid #31577f!important;background:#f1f5f9!important;color:#243247!important}
.nuri-article.nuri-article img{display:block!important;width:auto!important;max-width:100%!important;height:auto!important;margin:1.2em auto!important}
.nuri-article.nuri-article table{display:block!important;width:100%!important;overflow-x:auto!important;border-collapse:collapse!important;margin:1.2em 0!important;white-space:normal!important}.nuri-article.nuri-article th,.nuri-article.nuri-article td{padding:10px 12px!important;border:1px solid #cbd5e1!important;vertical-align:top!important}.nuri-article.nuri-article th{background:#edf2f7!important;font-weight:750!important}
.nuri-article.nuri-article pre,.nuri-article.nuri-article code{font-family:ui-monospace,monospace!important;font-size:.9em!important;white-space:pre-wrap!important;word-break:break-word!important;background:#f1f5f9!important;color:#243247!important;border-radius:4px!important}.nuri-article.nuri-article code{padding:.15em .3em!important}.nuri-article.nuri-article pre{margin:1.2em 0!important;padding:16px!important}.nuri-article.nuri-article pre code{font-size:inherit!important;padding:0!important}
.nuri-article.nuri-article hr{border:0!important;border-top:1px solid #cbd5e1!important;margin:1.5em 0!important}.nuri-article.nuri-article>:first-child{margin-top:0!important}.nuri-article.nuri-article>:last-child{margin-bottom:0!important}
`;
function renderArticle(body){return '<style>'+ARTICLE_STYLE+'</style><div class="nuri-article">'+renderMarkdown(body).replace(/<(\/?)h1>/g,'<$1h2>')+'</div>';}
function inspect(body){
 const tokens=md.parse(body,{}),headings=[],links=[],lines=[];
 for(let i=0;i<tokens.length;i++){
  const t=tokens[i];if(t.type==='heading_open')headings.push({level:Number(t.tag.slice(1)),text:tokens[i+1]?.content||''});
  if(t.type==='inline'){
   lines.push((t.children||[]).filter(t=>['text','code_inline','softbreak','hardbreak','image'].includes(t.type)).map(t=>t.type.includes('break')?' ':t.content).join(''));
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
 const html=renderArticle(body),description=seo.description||plain.slice(0,160),pageTitle=seo.title||title,json=JSON.stringify({'@context':'https://schema.org','@type':'Article',headline:pageTitle,description,...(seo.url?{url:seo.url,mainEntityOfPage:seo.url}:{}),...(seo.sources.length?{citation:seo.sources.map(s=>({'@type':'CreativeWork',name:s.title,url:s.url}))}:{})}).replace(/[<>&\u2028\u2029]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
 const document='<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(pageTitle)+'</title><meta name="description" content="'+escape(description)+'">'+(seo.url?'<link rel="canonical" href="'+escape(seo.url)+'">':'')+'<meta property="og:title" content="'+escape(pageTitle)+'"><meta property="og:description" content="'+escape(description)+'"><script type="application/ld+json">'+json+'</script></head><body><main><h1 style="box-sizing:border-box;max-width:860px;margin:32px auto 20px;padding:0 18px;color:#142b49;font:750 32px/1.45 system-ui,sans-serif;overflow-wrap:anywhere">'+escape(title)+'</h1>'+html+'</main></body></html>';
 return {html,document,analysis:{score:Math.round(checks.filter(c=>c.pass).length/checks.length*100),checks,words:plain.split(/\s+/u).filter(Boolean).length,characters:Array.from(plain).length,readingMinutes:Math.max(1,Math.ceil(Array.from(plain).length/600)),headings,links,notice:'편집 점검용입니다. 검색·AI 답변 노출이나 순위를 보장하지 않습니다.'},seo};
}
function linesFirst(s){return s.split('\n').find(Boolean)||'';}
const xConfig=twitterText.configs.defaults;
const weight=(s,channel)=>channel==='x'?twitterText.parseTweet(s,xConfig).weightedLength:Array.from(s).reduce((n,c)=>n+(channel==='blog'?c.length:1),0);
function fit(s,budget,channel){
 if(channel==='x'){
  const text=s.normalize('NFC'),end=twitterText.parseTweet(text,{...xConfig,maxWeightedTweetLength:budget}).validRangeEnd+1;let safeEnd=0;
  for(const {index,segment} of new Intl.Segmenter('ko',{granularity:'grapheme'}).segment(text)){const next=index+segment.length;if(next>end)break;safeEnd=next;}
  return text.slice(0,safeEnd).trim();
 }
 let out='',n=0;for(const c of s){const k=weight(c,channel);if(n+k>budget)break;out+=c;n+=k;}return out.trim();
}
function repurpose(post,channels){
 if(!Array.isArray(channels)||!channels.length||channels.length>CHANNELS.length||channels.some(c=>!CHANNELS.includes(c)))fail('재가공할 채널을 선택하세요.');
 const title=string(post.title,'제목',300),body=string(post.body,'본문',20000),seo=validateSEO(post.seo),plain=inspect(body).plain,url=httpsURL(seo.url||post.link||''),cta=seo.cta||'원문에서 자세한 내용을 확인하세요.',marker='[규칙 기반 홍보 초안]';
 return [...new Set(channels)].map(channel=>{
  const limit=CHANNEL_LIMITS[channel],suffix='\n\n'+fit(cta,channel==='x'?50:['threads','pinterest'].includes(channel)?100:500,channel)+(url?'\n'+url:'');
  if(weight(marker+suffix,channel)>=limit)fail('원문 링크 또는 다음 행동이 채널 제한보다 깁니다.');
  return {channel,title,body:marker+'\n'+fit(title+'\n\n'+(channel==='blog'?body:plain),limit-weight(marker+'\n'+suffix,channel),channel)+suffix,ruleBased:true,ai:false};
 });
}
module.exports={CHANNELS,CHANNEL_LIMITS,validateSEO,httpsURL,renderMarkdown,renderArticle,preview,repurpose,weight};
