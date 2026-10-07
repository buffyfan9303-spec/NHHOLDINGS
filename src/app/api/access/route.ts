import {NextRequest,NextResponse} from 'next/server';
import {identity,isOwner,confirmedIdentity,type Identity,type AccessRecord} from '@/lib/auth';
import {body,requireOrigin,failure,MarketError,textValue} from '@/lib/security';
import {pool} from '@/server/postgres.cjs';
export const dynamic='force-dynamic';
const noStore={'Cache-Control':'private, no-store'};
async function owner(req:NextRequest){const user=await identity(req);if(!isOwner(user))throw new MarketError('운영자 권한이 필요합니다.',user?403:401);return user!;}
export async function GET(req:NextRequest){try{await owner(req);const {rows}=await pool().query<{id:string;data:AccessRecord;version:string}>("SELECT id,data,updated::text AS version FROM nh_documents WHERE workspace='live' AND kind='access' ORDER BY updated DESC LIMIT 500");return NextResponse.json({requests:rows.map(({id,data,version})=>({id,...data,version})),smtpConfigured:false},{headers:noStore});}catch(error){return failure(error);}}
export async function POST(req:NextRequest){try{
 requireOrigin(req);const reviewer=await owner(req),input=await body(req),id=textValue(input.id,'계정 ID',36),version=textValue(input.version,'요청 버전',80);
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)||!['approve','deny','revoke'].includes(String(input.action)))throw new MarketError('계정과 승인 작업을 확인해주세요.');
 if(id===reviewer.id)throw new MarketError('소유자 권한은 승인 목록에서 변경할 수 없습니다.',403);
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw new MarketError('인증 관리자 연결 설정이 필요합니다.',503);
 const verified=await fetch(`${url}/auth/v1/admin/users/${id}`,{headers:{apikey:key,Authorization:`Bearer ${key}`},cache:'no-store',signal:AbortSignal.timeout(10000)});
 if(!verified.ok)throw new MarketError('실제 인증 계정을 확인하지 못했습니다.',verified.status===404?404:503);
 const user:Identity=await verified.json();if(user.id!==id||!confirmedIdentity(user))throw new MarketError('이메일 인증이 완료된 실제 계정만 처리할 수 있습니다.',409);
 const client=await pool().connect();try{
  await client.query('BEGIN');const row=(await client.query<{data:AccessRecord;version:string}>("SELECT data,updated::text AS version FROM nh_documents WHERE workspace='live' AND kind='access' AND id=$1 FOR UPDATE",[id])).rows[0];
  if(!row)throw new MarketError('승인 요청을 찾을 수 없습니다.',404);
  if(row.version!==version)throw new MarketError('승인 상태가 변경됐습니다. 새로고침 후 다시 시도해주세요.',409);
  if(row.data.email!==user.email!.toLowerCase())throw new MarketError('요청 당시 이메일과 현재 인증 이메일이 다릅니다.',409);
  const status=({approve:'approved',deny:'denied',revoke:'revoked'} as const)[input.action as 'approve'|'deny'|'revoke'],at=new Date().toISOString(),data:AccessRecord={...row.data,status,updatedAt:at,reviewedAt:at,reviewer:reviewer.email!.toLowerCase()};
  const saved=await client.query<{version:string}>("UPDATE nh_documents SET data=$2,updated=clock_timestamp() WHERE workspace='live' AND kind='access' AND id=$1 RETURNING updated::text AS version",[id,JSON.stringify(data)]);
  await client.query("INSERT INTO nh_audit(workspace,email,action,target) VALUES('live',$1,$2,$3)",[reviewer.email!.toLowerCase(),'access.'+status,id+':'+row.data.status+'→'+status]);await client.query('COMMIT');
  return NextResponse.json({request:{id,...data,version:saved.rows[0].version}},{headers:noStore});
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }catch(error){return failure(error);}}
