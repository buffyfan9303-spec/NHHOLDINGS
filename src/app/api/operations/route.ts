import {NextRequest,NextResponse} from 'next/server';
import {getDB} from '@/lib/db';
import {catalog,runMaintenance} from '@/lib/commerce';
import {identity,isOwner} from '@/lib/auth';
import {body,requireOrigin,failure,MarketError,textValue,integer,seal} from '@/lib/security';
import {integrationCatalog} from '@/lib/integration-catalog';
export const dynamic='force-dynamic';
async function owner(req:NextRequest){const user=await identity(req);if(!isOwner(user))throw new MarketError('운영자 권한이 필요합니다.',user?403:401);return user!;}
export async function GET(req:NextRequest){try{
 await owner(req);const db=await getDB();
 const tables=(await db.query<{name:string;rls:boolean}>("SELECT relname AS name,relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname='public' AND c.relkind='r' AND (c.relname LIKE 'mkt_%' OR c.relname IN ('nh_documents','nh_money','nh_audit')) ORDER BY relname")).rows;
 const role=(await db.query<{superuser:boolean;bypassRls:boolean}>(`SELECT rolsuper AS superuser,rolbypassrls AS "bypassRls" FROM pg_roles WHERE rolname=current_user`)).rows[0];
 const docs=(await db.query<{kind:string;id:string;data:Record<string,unknown>}>("SELECT kind,id,data FROM nh_documents WHERE workspace='live' AND (kind='source' OR kind='system')")).rows;
 const config=await catalog(db),smtp=docs.find(r=>r.kind==='system'&&r.id==='smtp')?.data;
 let bucket:null|{private:boolean;limit:number}=null;
 if(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY){try{const key=process.env.SUPABASE_SERVICE_ROLE_KEY,r=await fetch(process.env.SUPABASE_URL+'/storage/v1/bucket/nuri-media',{headers:{apikey:key,Authorization:'Bearer '+key},cache:'no-store',signal:AbortSignal.timeout(10000)});if(r.ok){const v=await r.json();bucket={private:v.public===false,limit:Number(v.file_size_limit)};}}catch{}}
 return NextResponse.json({checkedAt:new Date().toISOString(),database:{connected:true,tables:tables.length,rlsProtected:tables.filter(t=>t.rls).length,restricted:!role.superuser&&!role.bypassRls},storage:bucket,auth:{ownerConfigured:!!process.env.OPERATOR_USER_ID,emailVerification:true,smtpApplied:process.env.SMTP_CONFIGURED==='true'},smtp:smtp?{provider:smtp.provider,host:smtp.host,port:smtp.port,username:smtp.username,from:smtp.from,fromName:smtp.fromName,hasPassword:!!smtp.password,updatedAt:smtp.updatedAt,applied:false}:null,cron:docs.find(r=>r.kind==='system'&&r.id==='cron')?.data??null,sources:docs.filter(r=>r.kind==='source').map(r=>({id:r.id,checkedAt:r.data.checkedAt,error:r.data.error})),market:{mode:config.mode,products:config.products.length,readiness:config.readiness},integrations:integrationCatalog},{headers:{'Cache-Control':'private, no-store'}});
 }catch(e){return failure(e);}}
export async function POST(req:NextRequest){try{
 requireOrigin(req);const user=await owner(req),v=await body(req),db=await getDB();
 if(v.action==='maintenance'){const result=await runMaintenance(db);return NextResponse.json({ok:true,...result});}
 if(v.action!=='smtp-draft')throw new MarketError('설정 작업을 확인해주세요.');
 const host=textValue(v.host,'SMTP 호스트',253),from=textValue(v.from,'발신 이메일',254),username=textValue(v.username,'SMTP 사용자 이름',300),provider=textValue(v.provider,'메일 제공자',60),fromName=textValue(v.fromName,'발신자 이름',100);
 if(!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host)||!host.includes('.')||host.includes('..'))throw new MarketError('SMTP 호스트를 확인해주세요.');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from))throw new MarketError('발신 이메일을 확인해주세요.');
 const port=integer(v.port,'SMTP 포트',1,65535),password=typeof v.password==='string'?v.password:'';if(password.length>2000)throw new MarketError('SMTP 비밀번호를 확인해주세요.');
 await db.transaction(async tx=>{const previous=(await tx.query<{data:{password?:string}}> ("SELECT data FROM nh_documents WHERE workspace='live' AND kind='system' AND id='smtp' FOR UPDATE")).rows[0]?.data;if(!password&&!previous?.password)throw new MarketError('SMTP 비밀번호를 입력해주세요.');
 const data={provider,host,port,username,from,fromName,password:password?seal(password):previous?.password,updatedAt:new Date().toISOString(),applied:false};
 await tx.query("INSERT INTO nh_documents(workspace,kind,id,data) VALUES('live','system','smtp',$1) ON CONFLICT(workspace,kind,id) DO UPDATE SET data=excluded.data,updated=now()",[JSON.stringify(data)]);
 await tx.query("INSERT INTO nh_audit(workspace,email,action,target) VALUES('live',$1,'smtp.prepared','smtp')",[user.email]);});
 return NextResponse.json({ok:true,message:'SMTP 연결 정보를 암호화해 보관했습니다. Supabase 인증 설정에 적용·발송 확인하기 전까지는 연결 준비 상태입니다.'});
 }catch(e){return failure(e);}}
