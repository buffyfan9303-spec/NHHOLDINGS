import {PGlite} from '@electric-sql/pglite';
import {Pool} from 'pg';
import {readFile,mkdir} from 'node:fs/promises';
import {pool as cloudPool} from '../server/postgres.cjs';
import path from 'node:path';
import {initialSettings,sampleProducts} from './seed';
export interface Queryable {query<T=Record<string,unknown>>(sql:string,params?:unknown[]):Promise<{rows:T[]}>}
export interface Database extends Queryable {transaction<T>(work:(tx:Queryable)=>Promise<T>):Promise<T>;close():Promise<void>}
const state = globalThis as typeof globalThis & {nuriMarketDB?:Promise<Database>};
export async function createDatabase(directory?:string):Promise<Database> {
 let db:Database;
 if(process.env.DATABASE_URL && !directory){
  const pool=cloudPool();
  const wrap=(client:Pick<Pool,'query'>):Queryable=>({query:async <T>(sql:string,params?:unknown[])=>({rows:(await client.query(sql,params)).rows as T[]})});
  db={...wrap(pool),close:()=>pool.end(),transaction:async work=>{const client=await pool.connect();try{await client.query('BEGIN');const result=await work(wrap(client));await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}};
  await db.query('SELECT id FROM mkt_settings LIMIT 1');
 }else{
  if(process.env.MARKET_MODE==='live'&&!directory)throw new Error('운영 모드에는 운영 PostgreSQL 연결이 필요합니다.');
  const location=directory??path.join(process.cwd(),'.data','postgres');await mkdir(location,{recursive:true});
  const local=new PGlite(location);
  await local.exec(await readFile(path.join(process.cwd(),'db','schema.sql'),'utf8'));
  // ponytail: embedded PostgreSQL serializes local writes; managed PostgreSQL is required for multiple workers.
  db={close:()=>local.close(),query:async <T>(sql:string,params?:unknown[])=>({rows:(await local.query(sql,params)).rows as T[]}),transaction:work=>local.transaction(tx=>work({query:async <T>(sql:string,params?:unknown[])=>({rows:(await tx.query(sql,params)).rows as T[]})}))};
 }
 if(!(await db.query('SELECT id FROM mkt_settings WHERE id=$1',['store'])).rows.length){
  await db.transaction(async tx=>{
   await tx.query('INSERT INTO mkt_settings(id,data) VALUES($1,$2) ON CONFLICT DO NOTHING',['store',JSON.stringify(initialSettings)]);
   if(process.env.SEED_DEMO_DATA!=='false' && (directory||!process.env.DATABASE_URL))for(const p of sampleProducts){
    const {variants,...data}=p;
    await tx.query('INSERT INTO mkt_products(id,slug,name,category,price,data) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[p.id,p.slug,p.name,p.category,p.price,JSON.stringify(data)]);
    for(const v of variants)await tx.query('INSERT INTO mkt_variants(id,product_id,label,price_delta,options,on_hand) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[v.id,p.id,v.label,v.priceDelta,JSON.stringify(v.options),v.onHand]);
   }
  });
 }
 return db;
}
export function getDB(){return state.nuriMarketDB??=(createDatabase().catch(error=>{state.nuriMarketDB=undefined;throw error;}));}
