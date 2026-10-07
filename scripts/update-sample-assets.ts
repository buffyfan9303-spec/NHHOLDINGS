import {loadEnvConfig} from '@next/env';
import {getDB} from '../src/lib/db';
import {sampleProducts} from '../src/lib/seed';
loadEnvConfig(process.cwd());
async function main(){if(process.env.DATABASE_URL)throw new Error('로컬 샘플 DB 전용입니다.');const db=await getDB();try{let updated=0,audioUpdated=0;for(const p of sampleProducts){const prior=p.images[0].replace('.webp','.svg');const result=await db.query("UPDATE mkt_products SET data=jsonb_set(jsonb_set(data,'{images}',$1::jsonb),'{specs}',$2::jsonb) WHERE id=$3 AND data->>'sample'='true' AND data->'images'=$4::jsonb RETURNING id",[JSON.stringify(p.images),JSON.stringify(p.specs),p.id,JSON.stringify([prior])]);updated+=result.rows.length;if(p.soundUrl){const audio=await db.query("UPDATE mkt_products SET data=jsonb_set(data,'{soundUrl}',$1::jsonb) WHERE id=$2 AND data->>'sample'='true' AND data->>'soundUrl' IS NULL AND data->'images'=$3::jsonb RETURNING id",[JSON.stringify(p.soundUrl),p.id,JSON.stringify(p.images)]);audioUpdated+=audio.rows.length;}}console.log({updated,audioUpdated});}finally{await db.close();}}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
