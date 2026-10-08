'use strict';

const BASE_URL='https://naverapihub.apigw.ntruss.com';
const PROVIDER='Naver API HUB';
const MAX_ITEMS=10;
const MAX_TREND_GROUPS=5;
const MAX_TREND_POINTS=366;
const MIN_TREND_DATE='2016-01-01';
const MAX_TEXT=2000;
const SAFE_ERROR='네이버 API 요청을 처리할 수 없습니다. 입력·권한·이용 한도를 확인하세요.';

function fail(message,status=400){throw Object.assign(new Error(message),{status});}
function plainObject(value){return !!value&&typeof value==='object'&&!Array.isArray(value);}
function boundedString(value,label,max,optional=false){
 if(value===undefined||value===null){if(optional)return '';fail(`${label}을 확인하세요.`);}
 if(typeof value!=='string'||value.length>max||/[\r\n\0]/.test(value)||(!optional&&!value.trim()))fail(`${label}을 확인하세요.`);
 return value.trim();
}
function credential(value,label,optional=false){
 const result=boundedString(value,label,500,optional);
 if(result&&/[\u0000-\u001f\u007f]/.test(result))fail(`${label}을 확인하세요.`);
 return result;
}
function validateConfig(input,old={}){
 if(!plainObject(input)||!plainObject(old))fail('네이버 연결 설정을 확인하세요.');
 const apiKeyId=credential(input.apiKeyId,'API Key ID',true)||credential(old.apiKeyId,'API Key ID',true);
 const apiKey=credential(input.apiKey,'API Key',true)||credential(old.apiKey,'API Key',true);
 if(!apiKeyId||!apiKey)fail('네이버 API HUB의 Key ID와 Key를 입력하세요.');
 return {apiKeyId,apiKey};
}
function realDate(value,label){
 const date=boundedString(value,label,10);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date.startsWith('0000-'))fail(`${label}을 확인하세요.`);
 const parsed=new Date(`${date}T00:00:00.000Z`);
 if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)fail(`${label}을 확인하세요.`);
 return date;
}
function todayKst(){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));
 return `${values.year}-${values.month}-${values.day}`;
}
function normalizeTrendGroups(input){
 let groups=input.keywordGroups;
 if(groups===undefined){
  const query=boundedString(input.query,'검색어',100);
  groups=[{groupName:query,keywords:[query]}];
 }
 if(!Array.isArray(groups)||groups.length<1||groups.length>MAX_TREND_GROUPS)fail('검색어 그룹은 1~5개로 입력하세요.');
 return groups.map(group=>{
  if(!plainObject(group))fail('검색어 그룹을 확인하세요.');
  const groupName=boundedString(group.groupName,'그룹 이름',100);
  if(!Array.isArray(group.keywords)||group.keywords.length<1||group.keywords.length>20)fail('그룹별 검색어는 1~20개로 입력하세요.');
  return {groupName,keywords:group.keywords.map(value=>boundedString(value,'검색어',100))};
 });
}
function normalizeInput(input){
 if(!plainObject(input))fail('네이버 검색 요청을 확인하세요.');
 const mode=boundedString(input.mode,'검색 종류',20);
 if(!['news','webkr','image','trend'].includes(mode))fail('지원하지 않는 네이버 검색 종류입니다.');
 if(mode==='trend'){
  const startDate=realDate(input.startDate,'시작 날짜'),endDate=realDate(input.endDate,'종료 날짜');
  if(startDate<MIN_TREND_DATE||startDate>endDate)fail('검색 기간을 확인하세요.');
  if(endDate>todayKst())fail('미래 날짜는 조회할 수 없습니다.');
  const span=(Date.parse(`${endDate}T00:00:00.000Z`)-Date.parse(`${startDate}T00:00:00.000Z`))/86_400_000;
  if(span>=MAX_TREND_POINTS)fail('검색 기간은 최대 366일입니다.');
  return {mode,startDate,endDate,keywordGroups:normalizeTrendGroups(input)};
 }
 return {mode,query:boundedString(input.query,'검색어',200)};
}
function safeUrl(value){
 if(typeof value!=='string'||value.length>2048||/[\r\n\0]/.test(value))return '';
 try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:'';}catch{return '';}
}
function text(value,max=MAX_TEXT){return typeof value==='string'?value.slice(0,max):'';}
function numberOrNull(value){return Number.isSafeInteger(value)&&value>=0?value:null;}
function trendData(input){
 if(!Array.isArray(input))return [];
 return input.slice(0,MAX_TREND_POINTS).flatMap(point=>{
  if(!plainObject(point)||typeof point.period!=='string'||point.period.length>40||typeof point.ratio!=='number'||!Number.isFinite(point.ratio)||point.ratio<0||point.ratio>100)return [];
  return [{period:point.period,ratio:point.ratio}];
 });
}
function sourceFor(mode){return mode==='trend'?`${BASE_URL}/search-trend/v1/search`:`${BASE_URL}/search/v1/${mode}`;}
function responseItems(mode,payload){
 const items=payload.items.slice(0,MAX_ITEMS);
 if(mode==='news')return items.filter(plainObject).map(item=>({title:text(item.title),description:text(item.description),link:safeUrl(item.link),originalLink:safeUrl(item.originallink),pubDate:text(item.pubDate,100)}));
 if(mode==='webkr')return items.filter(plainObject).map(item=>({title:text(item.title),description:text(item.description),link:safeUrl(item.link)}));
 return items.filter(plainObject).map(item=>({title:text(item.title),link:safeUrl(item.link),thumbnail:safeUrl(item.thumbnail),size:text(item.size,80),width:numberOrNull(item.width??item.sizewidth),height:numberOrNull(item.height??item.sizeheight)}));
}
function trendResults(payload){
 const results=Array.isArray(payload?.results)?payload.results.slice(0,MAX_TREND_GROUPS):[];
 return results.filter(plainObject).map(result=>({title:text(result.title,100),keywords:Array.isArray(result.keywords)?result.keywords.slice(0,20).filter(v=>typeof v==='string').map(v=>text(v,100)):[],data:trendData(result.data)}));
}
async function request(config,input,fetchFn=fetch){
 if(!plainObject(config)||typeof fetchFn!=='function')fail('네이버 연결 설정을 확인하세요.');
 const apiKeyId=credential(config.apiKeyId,'API Key ID');
 const apiKey=credential(config.apiKey,'API Key');
 const normalized=normalizeInput(input),url=new URL(sourceFor(normalized.mode));
 const headers={'X-NCP-APIGW-API-KEY-ID':apiKeyId,'X-NCP-APIGW-API-KEY':apiKey,'Accept':'application/json'};
 let options;
 if(normalized.mode==='trend'){
  options={method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({startDate:normalized.startDate,endDate:normalized.endDate,timeUnit:'date',keywordGroups:normalized.keywordGroups})};
 }else{
  url.searchParams.set('query',normalized.query);
  url.searchParams.set('display',String(MAX_ITEMS));
  url.searchParams.set('start','1');
  url.searchParams.set('format','json');
  if(normalized.mode==='news')url.searchParams.set('sort','date');
  options={method:'GET',headers};
 }
 try{
  const response=await fetchFn(url.href,{...options,redirect:'error',signal:AbortSignal.timeout(10_000)});
  if(!response?.ok)throw new Error('provider response');
  const payload=await response.json();
  if(!plainObject(payload))throw new Error('invalid response');
  if(normalized.mode==='trend'?!Array.isArray(payload.results):!Array.isArray(payload.items))throw new Error('invalid result shape');
  const common={provider:PROVIDER,source:sourceFor(normalized.mode),checkedAt:new Date().toISOString(),mode:normalized.mode};
  if(normalized.mode==='trend')return {...common,metric:'relative-index',startDate:normalized.startDate,endDate:normalized.endDate,results:trendResults(payload)};
  return {...common,query:normalized.query,items:responseItems(normalized.mode,payload)};
 }catch{
  throw Object.assign(new Error(SAFE_ERROR),{status:502});
 }
}

module.exports={validateConfig,request};
