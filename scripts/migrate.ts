import {loadEnvConfig} from '@next/env';
import {getDB} from '../src/lib/db';
loadEnvConfig(process.cwd());
async function main(){if(process.env.DATABASE_URL)throw new Error('앱 연결 계정에는 DDL 권한이 없습니다. 운영 스키마는 Supabase migration으로 적용해주세요.');const db=await getDB();try{console.log({schema:'ready',settings:(await db.query('SELECT id FROM mkt_settings')).rows.length});}finally{await db.close();}}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
