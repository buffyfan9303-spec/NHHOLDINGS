import {getDB,type Database} from './db';
import {catalog} from './commerce';
export async function collect(source:{id:string}){
 const db=await getDB();
 if(source.id!=='market'){
  const env=process.env[`SOURCE_${source.id.toUpperCase()}_DATABASE_URL`];if(!env)throw new Error('사이트 조회 연결이 필요합니다.');
  const {Pool}=await import('pg'),{readFile}=await import('node:fs/promises');
  const sourcePool=new Pool({connectionString:env,max:1,ssl:{rejectUnauthorized:true,ca:await readFile('db/supabase-ca.crt','utf8')},connectionTimeoutMillis:10000});
  try{return (await sourcePool.query('select nh_private.portfolio_snapshot() as data')).rows[0].data;}finally{await sourcePool.end();}
 }
 return collectMarketDashboard(db);
}

export async function collectMarketDashboard(db:Database){
 return db.transaction(async tx=>{
  await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const counts=(await tx.query<Record<string,string>>(`
   SELECT count(*) AS orders,
    count(*) FILTER(WHERE created_at >= date_trunc('day',now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul') AS today,
    count(*) FILTER(WHERE payment_status='PAID') AS paid,
    count(*) FILTER(WHERE payment_status IN('PENDING','WAITING_FOR_DEPOSIT')) AS pending,
    count(*) FILTER(WHERE payment_status IN('PAID','PARTIALLY_REFUNDED') AND fulfillment_status IN('UNFULFILLED','PREPARING','LABEL_REGISTERED','PARTIALLY_SHIPPED')) AS awaiting_shipping,
    count(*) FILTER(WHERE payment_status IN('REFUNDING','REFUNDED','PARTIALLY_REFUNDED')) AS refunds,
    count(*) FILTER(WHERE is_demo) AS sample_orders
   FROM mkt_orders`)).rows[0];
  const tasks=(await tx.query<Record<string,string>>(`
   SELECT (SELECT count(*) FROM mkt_claims WHERE status='REQUESTED') AS claims,
    (SELECT count(*) FROM mkt_inquiries WHERE reply='') AS unanswered`)).rows[0];
  const months=(await tx.query<{month:string;records:string}>(`
   SELECT to_char(created_at AT TIME ZONE 'Asia/Seoul','YYYY-MM') AS month,count(*) AS records
   FROM mkt_orders WHERE NOT is_demo GROUP BY 1 ORDER BY 1`)).rows;
  const shop=await catalog(tx);
  return {
   observedAt:new Date().toISOString(),mode:shop.mode,orders:Number(counts.orders),today:Number(counts.today),
   paid:Number(counts.paid),pending:Number(counts.pending),excludedOrders:Number(counts.sample_orders),
   realOrders:Number(counts.orders)-Number(counts.sample_orders),products:shop.products.length,
   monthly:months.map(r=>({month:r.month,metric:'market_order_count',records:Number(r.records)})),
   operations:{pendingShipments:Number(counts.awaiting_shipping),refunds:Number(counts.refunds),claims:Number(tasks.claims),unanswered:Number(tasks.unanswered)},
   inventory:shop.products.map(p=>({id:p.id,name:p.name,published:p.published,sample:p.sample,stock:p.variants.reduce((n,v)=>n+v.stock,0)})),
   readiness:shop.readiness.map(({id,label,ready})=>({id,label,ready})),
   shopAdmin:'/nurimarket/admin'
  };
 });
}
