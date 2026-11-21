import {createHash,randomBytes} from 'node:crypto';
import type {NextRequest} from 'next/server';
import {accessStatus,canUsePersonalWorkspace,identity} from '@/lib/auth';
import {canRunPersonalAutomation} from '@/lib/personal-automation-access';
import {equal,hash,MarketError,marketOrigin,seal,unseal} from '@/lib/security';
import {pool} from '@/server/postgres.cjs';
import {uuidPattern} from '@/server/personal-workspace.cjs';

const scope='nuri.workbench';
const expiresIn=3600;
const grantDays=30;
const credentials="workspace='live' AND kind='personal-connector' AND id=$1 AND data->>'ownerId'=$2";
export const privateHeaders={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
const digest=(value:string)=>createHash('sha256').update(value).digest('base64url');
const nonce=()=>randomBytes(32).toString('base64url');
type Client={redirect:string; provider:'chatgpt'|'claude'|'gemini'};
type Grant={client:Client; clientId:string; challenge:string; state:string};
type Flow={ownerId:string; provider:Client['provider']; email:string; updatedAt:string; tokenHash?:string; expires?:number; refreshHash?:string; refreshUntil?:number; pending?:{hash:string; challenge:string; clientHash:string; expires:number}};
const invalid=()=>new MarketError('연결 요청을 확인해 주세요.',400);
const invalidGrant=()=>new MarketError('연결 승인이 만료되었습니다.',400);
export const issuer=()=>marketOrigin();
export const resource=()=>issuer()+'/api/one/mcp';
const protectedURL=()=>issuer()+'/.well-known/oauth-protected-resource/api/one/mcp';

export function protectedMetadata() {
  return {resource:resource(),authorization_servers:[issuer()],scopes_supported:[scope],bearer_methods_supported:['header']};
}

export function authorizationMetadata() {
  const url=issuer()+'/api/one/connect/';
  return {issuer:issuer(),authorization_endpoint:url+'authorize',token_endpoint:url+'token',
    registration_endpoint:url+'register',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],
    code_challenge_methods_supported:['S256'],scopes_supported:[scope],token_endpoint_auth_methods_supported:['none'],
    authorization_response_iss_parameter_supported:true};
}

export function connectorChallenge() {
  return Response.json({error:'invalid_token'},{status:401,headers:{...privateHeaders,'WWW-Authenticate':'Bearer resource_metadata="'+protectedURL()+'", scope="'+scope+'"'}});
}

function clientFor(redirect:unknown):Client {
  if(typeof redirect!=='string'||redirect.length>320)throw invalid();
  if(redirect==='https://chatgpt.com/connector_platform_oauth_redirect'||/^https:\/\/chatgpt\.com\/connector\/oauth\/[A-Za-z0-9_-]+$/.test(redirect)) return {redirect,provider:'chatgpt'};
  if(redirect==='https://claude.ai/api/mcp/auth_callback') return {redirect,provider:'claude'};
  if(/^https:\/\/oauth-redirect(?:-sandbox|-test)?\.googleusercontent\.com\/[ar]\/[A-Za-z0-9_-]+$/.test(redirect))return {redirect,provider:'gemini'};
  throw invalid();
}

export function registerClient(input:Record<string,unknown>) {
  if(!Array.isArray(input.redirect_uris)||input.redirect_uris.length!==1)throw invalid();
  if(input.token_endpoint_auth_method!==undefined&&input.token_endpoint_auth_method!=='none')throw invalid();
  const client=clientFor(input.redirect_uris[0]);
  return {client_id:seal(JSON.stringify({...client,kind:'nuri-client'})),redirect_uris:[client.redirect],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code'],scope};
}

function readClient(clientId:string|null,redirect:string|null):Client {
  if(!clientId||clientId.length>1400)throw invalid();
  let candidate:Record<string,unknown>;
  try{candidate=JSON.parse(unseal(clientId));}catch{throw invalid();}
  if(candidate.kind!=='nuri-client'||candidate.redirect!==redirect)throw invalid();
  return clientFor(candidate.redirect);
}

export function readGrant(form:URLSearchParams):Grant {
  const clientId=form.get('client_id')??'', client=readClient(clientId,form.get('redirect_uri'));
  const challenge=form.get('code_challenge')??'',state=form.get('state')??'';
  if(form.get('response_type')!=='code'||form.get('code_challenge_method')!=='S256'||
    !/^[A-Za-z0-9_-]{43}$/.test(challenge)||!state||state.length>600||
    (form.has('scope')&&form.get('scope')!==scope)||(form.has('resource')&&form.get('resource')!==resource()))throw invalid();
  return {client,clientId,challenge,state};
}

export async function connectorUser(req:NextRequest) {
  const user=await identity(req);
  if (!user) throw new MarketError('누리원에 로그인해 주세요.',401);
  if (!uuidPattern.test(user.id)||!canUsePersonalWorkspace(await accessStatus(user))) throw new MarketError('누리원 사용 승인이 필요합니다.',403);
  return {id:user.id,email:user.email!.toLowerCase()};
}

export function consentTicket(owner:string,grant:Grant) {
  return seal(JSON.stringify({kind:'nuri-consent',owner,grant,expires:Date.now()+600_000}));
}

function credential(raw:string|null,prefix:string) {
  if(!raw||raw.length>150) return null;
  const [tag,owner,provider,value,...rest]=raw.split('.');
  if(tag!==prefix||!owner||!uuidPattern.test(owner)||!['chatgpt','claude','gemini'].includes(provider)||!value||!/^[A-Za-z0-9_-]{43}$/.test(value)||rest.length)return null;
  return {key:owner+':'+provider,owner,provider};
}

export async function authorizeConnector(user:{id:string;email:string},ticket:string,approved:boolean) {
  let request:{kind:string;owner:string;grant:Grant;expires:number};
  try{request=JSON.parse(unseal(ticket));}catch{throw invalid();}
  if(request.kind!=='nuri-consent'||request.owner!==user.id||request.expires<Date.now())throw invalid();
  const {client,clientId,challenge,state}=request.grant;
  const target=new URL(client.redirect);
  target.searchParams.set('state',state);
  target.searchParams.set('iss',issuer());
  if(!approved){target.searchParams.set('error','access_denied');return target;}
  const code=['nuri_code',user.id,client.provider,nonce()].join('.');
  const details={ownerId:user.id,email:user.email,provider:client.provider,updatedAt:new Date().toISOString(),
    pending:{hash:hash(code),clientHash:hash(clientId),challenge,expires:Date.now()+180_000}};
  await pool().query("INSERT INTO nh_documents(workspace,kind,id,data) VALUES('live','personal-connector',$1,$2) ON CONFLICT(workspace,kind,id) DO UPDATE SET data=nh_documents.data||excluded.data,updated=clock_timestamp() WHERE nh_documents.data->>'ownerId'=$3",
    [user.id+':'+client.provider,JSON.stringify(details),user.id]);
  target.searchParams.set('code',code);
  return target;
}

function tokenPair(owner:string,provider:string,refreshUntil:number) {
  const access=['nuri_access',owner,provider,nonce()].join('.');
  const refresh=['nuri_refresh',owner,provider,nonce()].join('.');
  const now=Date.now();
  return {
    public:{access_token:access,refresh_token:refresh,token_type:'Bearer',expires_in:expiresIn,scope},
    store:{tokenHash:hash(access),expires:now+expiresIn*1000,refreshHash:hash(refresh),refreshUntil,updatedAt:new Date(now).toISOString()},
  };
}

async function refreshConnector(form:URLSearchParams) {
  const refresh=form.get('refresh_token'), key=credential(refresh,'nuri_refresh');
  if(!key)throw invalidGrant();
  const clientId=form.get('client_id')??'';
  if(!clientId||clientId.length>1400)throw invalidGrant();
  const {rows}=await pool().query<{data:Flow & {clientHash?:string}}>('SELECT data FROM nh_documents WHERE '+credentials,[key.key,key.owner]);
  const saved=rows[0]?.data, refreshHash=hash(refresh!);
  if(!saved?.refreshHash||!saved.refreshUntil||saved.refreshUntil<Date.now()||!equal(saved.refreshHash,refreshHash)||
    !saved.clientHash||!equal(saved.clientHash,hash(clientId))||!await canRunPersonalAutomation(key.owner,saved.email))throw invalidGrant();
  const tokens=tokenPair(key.owner,key.provider,saved.refreshUntil);
  const result=await pool().query("UPDATE nh_documents SET data=data||$3::jsonb,updated=clock_timestamp() WHERE "+credentials+
    " AND data->>'refreshHash'=$4 RETURNING id",[key.key,key.owner,JSON.stringify(tokens.store),refreshHash]);
  if(!result.rowCount)throw invalidGrant();
  return tokens.public;
}

export async function exchangeConnector(form:URLSearchParams) {
  if((form.has('resource')&&form.get('resource')!==resource())||(form.has('scope')&&form.get('scope')!==scope))throw invalidGrant();
  if(form.get('grant_type')==='refresh_token')return refreshConnector(form);
  const clientId=form.get('client_id'), client=readClient(clientId,form.get('redirect_uri'));
  const code=form.get('code'), key=credential(code,'nuri_code'), verify=form.get('code_verifier')??'';
  if(!key||key.provider!==client.provider||form.get('grant_type')!=='authorization_code'||
    !/^[A-Za-z0-9._~-]{43,128}$/.test(verify)||(form.has('resource')&&form.get('resource')!==resource()))throw invalidGrant();
  const {rows}=await pool().query<{data:Flow}>('SELECT data FROM nh_documents WHERE '+credentials,[key.key,key.owner]);
  const saved=rows[0]?.data, pending=saved?.pending, codeHash=hash(code!);
  if(!pending||!equal(codeHash,pending.hash)||!equal(digest(verify),pending.challenge)||
    !equal(hash(clientId!),pending.clientHash)||pending.expires<Date.now()||!await canRunPersonalAutomation(key.owner,saved.email))throw invalidGrant();
  const tokens=tokenPair(key.owner,key.provider,Date.now()+grantDays*86400_000);
  const next={...tokens.store,clientHash:pending.clientHash};
  const result=await pool().query("UPDATE nh_documents SET data=(data-'pending')||$3::jsonb,updated=clock_timestamp() WHERE "+credentials+
    " AND data->'pending'->>'hash'=$4 RETURNING id",[key.key,key.owner,JSON.stringify(next),codeHash]);
  if(!result.rowCount)throw invalidGrant();
  return tokens.public;
}

export async function connectorActor(request:Request) {
  const token=/^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization')??'')?.[1]??null;
  const key=credential(token,'nuri_access');
  if(!key)return null;
  const {rows}=await pool().query<{data:Flow}>('SELECT data FROM nh_documents WHERE '+credentials,[key.key,key.owner]);
  const saved=rows[0]?.data;
  if(!saved?.tokenHash||!saved.expires||saved.expires<Date.now()||!equal(hash(token!),saved.tokenHash)||
    !await canRunPersonalAutomation(key.owner,saved.email)) return null;
  return {id:key.owner,provider:saved.provider};
}

export async function connectorStatus(owner:string) {
  const {rows}=await pool().query<{provider:string; expires:number; updatedAt:string}>(
    "SELECT data->>'provider' AS provider, (data->>'refreshUntil')::bigint AS expires, data->>'updatedAt' AS \"updatedAt\" FROM nh_documents WHERE workspace='live' AND kind='personal-connector' AND id LIKE $1||':%' AND data->>'ownerId'=$1 AND data ? 'tokenHash'",[owner]);
  return rows.map(row=>({provider:row.provider,expires:Number(row.expires),updatedAt:row.updatedAt,active:Number(row.expires)>Date.now()}));
}

export async function disconnectConnector(owner:string,provider:unknown) {
  if(typeof provider!=='string'||!['chatgpt','claude','gemini'].includes(provider))throw invalid();
  await pool().query('DELETE FROM nh_documents WHERE '+credentials,[owner+':'+provider,owner]);
}
