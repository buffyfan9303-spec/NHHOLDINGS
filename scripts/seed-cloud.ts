import {loadEnvConfig} from '@next/env';
import {readFile} from 'node:fs/promises';
import {getDB} from '../src/lib/db';
import {sampleProducts,initialSettings} from '../src/lib/seed';
import {createCipheriv,createHash,randomBytes} from 'node:crypto';
loadEnvConfig(process.cwd());
async function main(){if(process.env.ALLOW_CLOUD_SEED!=='true')throw new Error('명시적으로 승인한 초기 샘플 입력에만 실행합니다.');const db=await getDB(),sample=JSON.parse(await readFile('db/dashboard-sample.json','utf8'));await db.transaction(async tx=>{
 await tx.query('INSERT INTO mkt_settings(id,data) VALUES($1,$2) ON CONFLICT DO NOTHING',['store',JSON.stringify(initialSettings)]);
 for(const p of sampleProducts){const {variants,...data}=p;await tx.query('INSERT INTO mkt_products(id,slug,name,category,price,data) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[p.id,p.slug,p.name,p.category,p.price,JSON.stringify(data)]);for(const v of variants)await tx.query('INSERT INTO mkt_variants(id,product_id,label,price_delta,options,on_hand) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[v.id,p.id,v.label,v.priceDelta,JSON.stringify(v.options),v.onHand]);}
 for(const r of sample.documents){if(r.data.sampleCredentials){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',createHash('sha256').update(process.env.SESSION_SECRET!).digest(),iv);r.data.secret=Buffer.concat([iv,cipher.update(JSON.stringify(r.data.sampleCredentials)),cipher.final(),cipher.getAuthTag()]).toString('base64');delete r.data.sampleCredentials;}await tx.query('INSERT INTO nh_documents(workspace,kind,id,data,updated) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',['sample',r.kind,r.id,JSON.stringify(r.data),r.updated]);}
 for(const m of sample.money)await tx.query('INSERT INTO nh_money(workspace,id,day,service,business,kind,amount,category,partner,reference,note,voided) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING',['sample',m.id,m.day,m.service,m.business,m.kind,m.amount,m.category,m.partner,m.reference,m.note,m.voided]);
 });console.log('Cloud sample seeded; live finance untouched.');await db.close();}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
