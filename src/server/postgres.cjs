'use strict';
const {Pool}=require('pg'),fs=require('node:fs'),path=require('node:path');
function pool(){
 if(!process.env.DATABASE_URL)throw new Error('운영 PostgreSQL 연결이 필요합니다.');
 // ponytail: one connection per warm instance for the shared transaction pooler; raise only after measuring queue time.
 return globalThis.nhPool??=new Pool({connectionString:process.env.DATABASE_URL,max:1,idleTimeoutMillis:10000,connectionTimeoutMillis:10000,ssl:{rejectUnauthorized:true,ca:fs.readFileSync(path.join(process.cwd(),'db/supabase-ca.crt'),'utf8')}});
}
module.exports={pool};
