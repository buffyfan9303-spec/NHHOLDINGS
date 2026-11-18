import {randomUUID} from 'node:crypto';
import type {Database,Queryable} from './db';
import type {Product,Settings,CatalogResponse,Order,OrderItem,Shipment,Claim,AdminResponse,Customer,PaymentMethod,Coupon,OrderPage,Inquiry,InquiryPage} from './types';
import {paymentLabels,fulfillmentLabels} from './types';
import {MarketError,hash,equal,orderToken,textValue,integer} from './security';
type Row=Record<string,any>;
const iso=(v:unknown)=>v?new Date(v as string).toISOString():null;
export function mode():CatalogResponse['mode'] {const value=process.env.NODE_ENV==='production'?'live':process.env.MARKET_MODE??'preview';if(!['preview','test','live'].includes(value))throw new MarketError('잘못된 운영 모드입니다.',503);return value as CatalogResponse['mode'];}
export async function audit(tx:Queryable,action:string,detail:string){await tx.query('INSERT INTO mkt_audit(id,action,detail) VALUES($1,$2,$3)',[randomUUID(),action,detail]);}
async function job(tx:Queryable,orderId:string,kind:string){await tx.query('INSERT INTO mkt_jobs(id,order_id,kind,payload) VALUES($1,$2,$3,$4)',[randomUUID(),orderId,kind,JSON.stringify({orderId})]);}
export async function settings(tx:Queryable){return (await tx.query<{data:Settings}>('SELECT data FROM mkt_settings WHERE id=$1',['store'])).rows[0].data;}
export async function products(tx:Queryable):Promise<Product[]>{
 const p=(await tx.query<Row>('SELECT * FROM mkt_products ORDER BY id')).rows;
 const v=(await tx.query<Row>('SELECT * FROM mkt_variants ORDER BY id')).rows;
 return p.map(p=>({...p.data,id:p.id,slug:p.slug,name:p.name,category:p.category,price:p.price,variants:v.filter(v=>v.product_id===p.id).map(v=>({id:v.id,label:v.label,options:v.options,priceDelta:v.price_delta,onHand:v.on_hand,reserved:v.reserved,allocated:v.allocated,stock:Math.max(0,v.on_hand-v.reserved-v.allocated-v.safety_stock)}))}));
}
function saleReady(p:Product){return !p.sample&&p.safety.audience!=='unknown'&&p.safety.certification!=='pending'&&(p.safety.audience!=='child'||(p.safety.certification==='verified'&&!!p.safety.certificateNumber&&!!p.safety.certificateUrl))&&p.safety.license!=='pending'&&!!p.safety.licenseReference;}
export async function catalog(tx:Queryable):Promise<CatalogResponse>{
 const all=await products(tx),s=await settings(tx),m=mode();
 const key=process.env.TOSS_CLIENT_KEY??'',sk=process.env.TOSS_SECRET_KEY??'';
 const pg=key.startsWith(m==='live'?'live_':'test_')&&sk.startsWith(m==='live'?'live_':'test_');
 const seller=Object.values(s.seller).every(x=>!!x.trim());
 const readiness=[
  {id:'seller',label:'판매자·통신판매·고객센터',ready:seller,detail:'사업자 기본 정보 외에 통신판매번호, 연락처, 호스팅 및 구매안전서비스 링크가 필요합니다.'},
  {id:'policies',label:'약관·개인정보·반품 정책',ready:s.policiesApproved,detail:'실제 운영 조건으로 문서를 검토하고 승인해주세요.'},
  {id:'products',label:'실제 상품·안전·권리 자료',ready:all.some(p=>p.published&&saleReady(p)),detail:'시안은 판매하지 않습니다. 대상 연령, 해당 완제품 인증 및 권리 증빙을 확인해주세요.'},
  {id:'shipping',label:'배송·반품 운영',ready:s.shippingReady&&!!s.shipping.returnAddress&&s.shipping.remoteFee===0,detail:'초기 버전은 전국 동일 배송비를 지원합니다. 출고 절차와 반품 주소 확인이 필요합니다.'},
  {id:'pg',label:'토스페이먼츠 키',ready:pg,detail:'모드와 일치하는 클라이언트/시크릿 키와 계약된 결제수단이 필요합니다.'},
  {id:'paymentOperations',label:'실결제 운영 검증',ready:false,detail:'실 PG 승인·환불·현금영수증·입금 대사 검증이 필요합니다. 계약과 실제 검증을 마치기 전까지 운영 결제는 차단됩니다.'},
  {id:'database',label:'운영 PostgreSQL',ready:!!process.env.DATABASE_URL,detail:'다중 서버 운영에는 외부 PostgreSQL 연결과 마이그레이션 검증이 필요합니다.'},
  {id:'launch',label:'운영 개시 승인',ready:process.env.LIVE_APPROVED==='true',detail:'실결제 개시는 운영 검증 후 명시적으로 승인해야 합니다.'}
 ];
 return {products:all,settings:s,mode:m,readiness,pgClientKey:m!=='preview'&&pg?key:null};
}
function mapItem(r:Row):OrderItem{return {id:r.id,productId:r.product_id,variantId:r.variant_id,name:r.name,variantLabel:r.variant_label,quantity:r.quantity,unitPrice:r.unit_price,discount:r.discount,total:r.total,refundedQty:r.refunded_qty,shippedQty:r.shipped_qty};}
function mapShipment(r:Row):Shipment{return {id:r.id,orderId:r.order_id,carrier:r.carrier,trackingNumber:r.tracking_number,status:r.status,shippedAt:iso(r.shipped_at),deliveredAt:iso(r.delivered_at),createdAt:iso(r.created_at)!};}
function mapInquiry(r:Row):Inquiry{return {id:r.id,orderId:r.order_id,subject:r.subject,content:r.content,reply:r.reply,repliedAt:iso(r.replied_at),createdAt:iso(r.created_at)!};}
function mapClaim(r:Row):Claim{return {id:r.id,orderId:r.order_id,type:r.type,status:r.status,reason:r.reason,resolution:r.resolution,items:r.items,createdAt:iso(r.created_at)!};}
export async function getOrder(tx:Queryable,id:string,token?:string):Promise<Order>{
 if('transaction' in tx)return (tx as Database).transaction(async connection=>{await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');return getOrder(connection,id,token);});
 const r=(await tx.query<Row>('SELECT * FROM mkt_orders WHERE id=$1 OR number=$1',[id])).rows[0];
 if(!r||token!==undefined&&!equal(hash(token),r.access_hash))throw new MarketError('주문 조회 권한을 확인해주세요.',404);
 id=r.id;
 const [items,shipments,claims,payments,inquiries,reviews]=[
  await tx.query<Row>('SELECT * FROM mkt_order_items WHERE order_id=$1 ORDER BY id',[id]),await tx.query<Row>('SELECT * FROM mkt_shipments WHERE order_id=$1 ORDER BY created_at',[id]),await tx.query<Row>('SELECT * FROM mkt_claims WHERE order_id=$1 ORDER BY created_at',[id]),await tx.query<Row>('SELECT data FROM mkt_payments WHERE order_id=$1',[id]),await tx.query<Row>('SELECT * FROM mkt_inquiries WHERE order_id=$1 ORDER BY created_at',[id]),await tx.query<Row>('SELECT * FROM mkt_reviews WHERE order_id=$1 ORDER BY created_at',[id])
 ];
 return {id:r.id,number:r.number,createdAt:iso(r.created_at)!,paymentStatus:r.payment_status,fulfillmentStatus:r.fulfillment_status,purchaseStatus:r.purchase_status,method:r.method,subtotal:r.subtotal,discount:r.discount,shipping:r.shipping,total:r.total,refundTotal:r.refund_total,customer:r.customer,items:items.rows.map(mapItem),shipments:shipments.rows.map(mapShipment),claims:claims.rows.map(mapClaim),isDemo:r.is_demo,dueAt:iso(r.due_at),deliveredAt:iso(r.delivered_at),virtualAccount:payments.rows[0]?.data?.virtualAccount??null,inquiries:inquiries.rows.map(mapInquiry),reviews:reviews.rows.map(i=>({id:i.id,orderId:i.order_id,productId:i.product_id,rating:i.rating,content:i.content,status:i.status,createdAt:iso(i.created_at)!}))};
}
function customerInput(v:unknown):Customer {if(!v||typeof v!=='object')throw new MarketError('배송지를 입력해주세요.');const c=v as Record<string,unknown>;const result={name:textValue(c.name,'수취인',40),phone:textValue(c.phone,'연락처',20),email:textValue(c.email??'','이메일',100,true),postcode:textValue(c.postcode,'우편번호',5),address:textValue(c.address,'주소',200),addressDetail:textValue(c.addressDetail??'','상세주소',100,true),note:textValue(c.note??'','배송메모',200,true)};if(!/^0\d{8,10}$/.test(result.phone.replace(/[- ]/g,''))||!/^\d{5}$/.test(result.postcode)||result.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email))throw new MarketError('연락처, 우편번호, 이메일을 확인해주세요.');return result;}
export async function createOrder(db:Database,input:Record<string,unknown>){
 const requestId=textValue(input.requestId,'주문 요청번호',80);if(!/^[a-zA-Z0-9_-]{24,80}$/.test(requestId))throw new MarketError('주문 요청번호를 다시 생성해주세요.');
 const c=customerInput(input.customer),method=input.method as PaymentMethod;
 if(!['CARD','NAVERPAY','KAKAOPAY','VIRTUAL_ACCOUNT'].includes(method))throw new MarketError('결제수단을 선택해주세요.');
 const consent=input.consent as Row;if(!consent||consent.terms!==true||consent.privacy!==true||typeof consent.marketing!=='boolean'||consent.version!=='2026-10-07')throw new MarketError('필수 주문 안내에 동의해주세요.');
 if(!Array.isArray(input.lines)||!input.lines.length||input.lines.length>20)throw new MarketError('주문 상품을 확인해주세요.');
 const lines=input.lines.map((v:Row)=>({variantId:textValue(v?.variantId,'옵션',100),quantity:integer(v?.quantity,'수량',1,10)})).sort((a,b)=>a.variantId.localeCompare(b.variantId));
 if(new Set(lines.map(v=>v.variantId)).size!==lines.length)throw new MarketError('중복 옵션 수량을 합쳐주세요.');
 const checkoutToken=textValue(input.checkoutToken,'주문 재시도 보안키',128);if(!/^[a-zA-Z0-9_-]{32,128}$/.test(checkoutToken))throw new MarketError('주문 보안키를 다시 생성해주세요.');
 const requestHash=hash(JSON.stringify({lines,customer:c,method,couponCode:input.couponCode??'',consent})),accessToken=orderToken(`${requestId}:${checkoutToken}`),configuration=await catalog(db);
 if(configuration.mode==='live'&&configuration.readiness.some(x=>!x.ready))throw new MarketError('판매 개시 준비가 완료되지 않았습니다.',503);
 if(configuration.mode==='test'&&!configuration.pgClientKey)throw new MarketError('테스트 결제 키를 설정해주세요.',503);
 const id=await db.transaction(async tx=>{
  // PostgreSQL advisory lock serializes retries of the same client-generated idempotency key.
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[requestId]);
  const prior=(await tx.query<Row>('SELECT id,request_hash,access_hash FROM mkt_orders WHERE request_id=$1',[requestId])).rows[0];
  if(prior){if(!equal(prior.access_hash,hash(accessToken)))throw new MarketError('주문 재시도 권한을 확인해주세요.',403);if(prior.request_hash!==requestHash)throw new MarketError('재시도 요청의 주문 내용이 다릅니다.',409);return prior.id as string;}
  const snapshots:{variant:Row;quantity:number;gross:number}[]=[];
  for(const line of lines){const v=(await tx.query<Row>('SELECT v.*,p.name,p.price,p.data FROM mkt_variants v JOIN mkt_products p ON p.id=v.product_id WHERE v.id=$1 FOR UPDATE OF v',[line.variantId])).rows[0];
   if(!v||!v.data.published||v.data.dropAt&&new Date(v.data.dropAt).getTime()>Date.now())throw new MarketError('현재 주문할 수 없는 상품입니다.',409);
   if(configuration.mode!=='preview'&&!saleReady({...v.data,price:v.price} as Product))throw new MarketError('안전·권리 자료 확인 전에는 판매할 수 없습니다.',409);
   if(v.on_hand-v.reserved-v.allocated-v.safety_stock<line.quantity)throw new MarketError(`${v.name}의 재고가 부족합니다.`,409);
   const price=integer(v.price+v.price_delta,'판매가',1,10_000_000);snapshots.push({variant:v,quantity:line.quantity,gross:price*line.quantity});
  }
  const subtotal=snapshots.reduce((s,l)=>s+l.gross,0);integer(subtotal,'주문금액',1);
  let discount=0,couponCode='';if(input.couponCode){couponCode=textValue(input.couponCode,'쿠폰',40).toUpperCase();const cp=(await tx.query<Row>('SELECT * FROM mkt_coupons WHERE code=$1 AND active=true FOR UPDATE',[couponCode])).rows[0];if(!cp||cp.expires_at&&new Date(cp.expires_at).getTime()<Date.now()||subtotal<cp.min_amount)throw new MarketError('쿠폰 사용 조건을 확인해주세요.');discount=Math.min(Math.floor(subtotal*cp.percent/100),cp.max_discount,subtotal-1);}
  const s=configuration.settings.shipping,shipping=subtotal-discount>=s.freeThreshold?0:s.fee,total=subtotal-discount+shipping;
  const orderId=randomUUID(),number=`NM${new Date(Date.now()+9*3600000).toISOString().slice(0,10).replaceAll('-','')}${randomUUID().slice(0,8).toUpperCase()}`,due=new Date(Date.now()+30*60_000).toISOString();
  await tx.query('INSERT INTO mkt_orders(id,number,request_id,request_hash,access_hash,customer,method,subtotal,discount,shipping,total,payment_status,is_demo,coupon_code,consent,due_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',[orderId,number,requestId,requestHash,hash(accessToken),JSON.stringify(c),method,subtotal,discount,shipping,total,'PENDING',configuration.mode==='preview',couponCode||null,JSON.stringify(consent),due]);
  let assigned=0,cumulativeGross=0;for(const l of snapshots){cumulativeGross+=l.gross;const cumulativeDiscount=Number(BigInt(discount)*BigInt(cumulativeGross)/BigInt(subtotal)),d=cumulativeDiscount-assigned;assigned=cumulativeDiscount;
   await tx.query('INSERT INTO mkt_order_items(id,order_id,product_id,variant_id,name,variant_label,quantity,unit_price,discount,total) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[randomUUID(),orderId,l.variant.product_id,l.variant.id,l.variant.name,l.variant.label,l.quantity,l.gross/l.quantity,d,l.gross-d]);
   await tx.query('UPDATE mkt_variants SET reserved=reserved+$1 WHERE id=$2',[l.quantity,l.variant.id]);
   await tx.query('INSERT INTO mkt_reservations(order_id,variant_id,quantity,status) VALUES($1,$2,$3,$4)',[orderId,l.variant.id,l.quantity,'HELD']);
   await stockLog(tx,l.variant.id,0,l.quantity,0,'주문 재고 점유',orderId);
  }
  await audit(tx,'order.created',`${number} / ${total}원 / ${configuration.mode}`);return orderId;
 });
 return {order:await getOrder(db,id),accessToken,mode:configuration.mode,pgClientKey:configuration.pgClientKey};
}
export async function stockLog(tx:Queryable,variantId:string,onHand:number,reserved:number,allocated:number,reason:string,orderId:string|null=null){await tx.query('INSERT INTO mkt_stock_ledger(id,variant_id,on_hand_delta,reserved_delta,allocated_delta,reason,order_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),variantId,onHand,reserved,allocated,reason,orderId]);}
async function release(tx:Queryable,orderId:string){const r=(await tx.query<Row>("SELECT * FROM mkt_reservations WHERE order_id=$1 AND status IN ('HELD','ALLOCATED') ORDER BY variant_id FOR UPDATE",[orderId])).rows;for(const v of r){const held=v.status==='HELD'?v.quantity:0,alloc=v.status==='ALLOCATED'?v.quantity:0;await tx.query('UPDATE mkt_variants SET reserved=reserved-$1,allocated=allocated-$2 WHERE id=$3',[held,alloc,v.variant_id]);await tx.query("UPDATE mkt_reservations SET status='RELEASED',quantity=0 WHERE order_id=$1 AND variant_id=$2",[orderId,v.variant_id]);await stockLog(tx,v.variant_id,0,-held,-alloc,'주문 점유 해제',orderId);}}
export async function applyPayment(db:Database,id:string,status:'PAID'|'WAITING_FOR_DEPOSIT'|'EXPIRED'|'FAILED',eventKey:string,dueDate?:string){return db.transaction(tx=>applyPaymentTx(tx,id,status,eventKey,dueDate));}
export async function applyPaymentTx(tx:Queryable,id:string,status:'PAID'|'WAITING_FOR_DEPOSIT'|'EXPIRED'|'FAILED',eventKey:string,dueDate?:string){
 const order=(await tx.query<Row>('SELECT * FROM mkt_orders WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!order)throw new MarketError('주문을 찾을 수 없습니다.',404);
 if((await tx.query('SELECT event_key FROM mkt_payment_events WHERE event_key=$1',[eventKey])).rows.length)return;
 if(status==='PAID'){
  if(['PAID','PARTIALLY_REFUNDED','REFUNDED'].includes(order.payment_status))return;
  if(!['PENDING','WAITING_FOR_DEPOSIT'].includes(order.payment_status))throw new MarketError('이미 종료된 주문의 입금은 수동 대사가 필요합니다.',409);
  for(const r of (await tx.query<Row>('SELECT * FROM mkt_reservations WHERE order_id=$1 ORDER BY variant_id FOR UPDATE',[id])).rows){if(r.status!=='HELD')throw new MarketError('재고 점유를 확인해주세요.',409);await tx.query('UPDATE mkt_variants SET reserved=reserved-$1,allocated=allocated+$1 WHERE id=$2',[r.quantity,r.variant_id]);await tx.query("UPDATE mkt_reservations SET status='ALLOCATED' WHERE order_id=$1 AND variant_id=$2",[id,r.variant_id]);await stockLog(tx,r.variant_id,0,-r.quantity,r.quantity,'결제 확정',id);}
  await job(tx,id,'payment.paid');
 }else if(status==='WAITING_FOR_DEPOSIT'){if(order.payment_status!=='PENDING')return;if(!dueDate||!Number.isFinite(new Date(dueDate).getTime()))throw new MarketError('입금 기한을 확인해주세요.');}
 else {if(!['PENDING','WAITING_FOR_DEPOSIT'].includes(order.payment_status))return;await release(tx,id);}
 await tx.query('UPDATE mkt_orders SET payment_status=$1,due_at=$2 WHERE id=$3',[status,status==='WAITING_FOR_DEPOSIT'?dueDate:null,id]);
 await tx.query('INSERT INTO mkt_payment_events(event_key,order_id,status) VALUES($1,$2,$3)',[eventKey,id,status]);await audit(tx,'payment.changed',`${order.number} / ${status}`);
 }
export async function customerAction(db:Database,input:Record<string,unknown>,token:string){const id=textValue(input.orderId,'주문',100);return db.transaction(async tx=>{
 await tx.query('SELECT id FROM mkt_orders WHERE id=$1 FOR UPDATE',[id]);const o=await getOrder(tx,id,token);
 if(input.action==='claim'){
  if(!['CANCEL','RETURN','EXCHANGE'].includes(input.type as string))throw new MarketError('요청 종류를 확인해주세요.');const reason=textValue(input.reason,'요청 사유',2000);
  if(!Array.isArray(input.items)||!input.items.length||input.items.length>20)throw new MarketError('요청 상품을 선택해주세요.');const items=input.items.map((i:Row)=>({itemId:textValue(i.itemId,'상품',100),quantity:integer(i.quantity,'수량',1,10)}));if(new Set(items.map(i=>i.itemId)).size!==items.length)throw new MarketError('중복 상품을 확인해주세요.');for(const i of items){const item=o.items.find(x=>x.id===i.itemId);if(!item||i.quantity>item.quantity-item.refundedQty)throw new MarketError('요청 수량을 확인해주세요.');}
  if(o.claims.some(c=>['REQUESTED','APPROVED'].includes(c.status)))throw new MarketError('진행 중인 요청을 먼저 확인해주세요.',409);
  await tx.query('INSERT INTO mkt_claims(id,order_id,type,reason,items) VALUES($1,$2,$3,$4,$5)',[randomUUID(),id,input.type,reason,JSON.stringify(items)]);await job(tx,id,'claim.requested');
 }else if(input.action==='confirm'){
  if(o.fulfillmentStatus!=='DELIVERED'||o.claims.some(c=>['REQUESTED','APPROVED'].includes(c.status)))throw new MarketError('배송 완료 및 진행 중인 요청을 확인해주세요.',409);
  await tx.query("UPDATE mkt_orders SET purchase_status='CONFIRMED',confirmed_at=now() WHERE id=$1 AND purchase_status='OPEN'",[id]);
 }else if(input.action==='review'){
  const productId=textValue(input.productId,'상품',100);if(o.fulfillmentStatus!=='DELIVERED'||!o.items.some(i=>i.productId===productId&&i.refundedQty<i.quantity))throw new MarketError('수령한 상품만 리뷰를 남길 수 있습니다.');
  await tx.query('INSERT INTO mkt_reviews(id,order_id,product_id,rating,content) VALUES($1,$2,$3,$4,$5) ON CONFLICT(order_id,product_id) DO UPDATE SET rating=EXCLUDED.rating,content=EXCLUDED.content,status=$6',[randomUUID(),id,productId,integer(input.rating,'별점',1,5),textValue(input.content,'리뷰',2000),'PENDING']);
 }else if(input.action==='inquiry')await tx.query('INSERT INTO mkt_inquiries(id,order_id,subject,content) VALUES($1,$2,$3,$4)',[randomUUID(),id,textValue(input.subject,'문의 제목',100),textValue(input.content,'문의',2000)]);
 else throw new MarketError('지원하지 않는 요청입니다.');await audit(tx,`customer.${input.action}`,o.number);
 return {order:await getOrder(tx,id)};
 });}
export async function orderPage(db:Database,params:URLSearchParams):Promise<OrderPage>{
 const page=integer(Number(params.get('page')??1),'페이지',1,1_000_000),pageSize=20;
 const q=textValue(params.get('q')??'','검색어',100,true),payment=params.get('payment')??'',fulfillment=params.get('fulfillment')??'',kind=params.get('kind')??'all',scope=params.get('scope')??'all',claimStatus=params.get('claimStatus')??'';
 if(payment&&!Object.hasOwn(paymentLabels,payment)||fulfillment&&!Object.hasOwn(fulfillmentLabels,fulfillment)||!['all','shipments','claims'].includes(kind)||!['all','demo','real'].includes(scope))throw new MarketError('주문 필터를 확인해주세요.');
 const values:unknown[]=[],conditions:string[]=[];
 const bind=(value:unknown)=>{values.push(value);return `$${values.length}`;};
 if(claimStatus&&!['REQUESTED','APPROVED','REJECTED','COMPLETED'].includes(claimStatus))throw new MarketError('요청 상태를 확인해주세요.');
 if(claimStatus)conditions.push(`EXISTS(SELECT 1 FROM mkt_claims c WHERE c.order_id=o.id AND c.status=${bind(claimStatus)})`);
 if(q){const p=bind(q);conditions.push(`(strpos(lower(concat_ws(' ',o.number,o.customer->>'name',o.customer->>'phone',o.customer->>'email',o.customer->>'address',o.customer->>'addressDetail')),lower(${p}))>0 OR EXISTS(SELECT 1 FROM mkt_order_items i WHERE i.order_id=o.id AND strpos(lower(i.name||' '||i.variant_label),lower(${p}))>0) OR EXISTS(SELECT 1 FROM mkt_shipments s WHERE s.order_id=o.id AND strpos(s.tracking_number,${p})>0)${/^[\d -]+$/.test(q)&&/\d/.test(q)?` OR strpos(regexp_replace(o.customer->>'phone','[^0-9]','','g'),${bind(q.replace(/\D/g,''))})>0`:''})`);}
 if(payment)conditions.push(`o.payment_status=${bind(payment)}`);
 if(fulfillment)conditions.push(`o.fulfillment_status=${bind(fulfillment)}`);
 if(scope!=='all')conditions.push(`o.is_demo=${bind(scope==='demo')}`);
 if(kind!=='all')conditions.push(`EXISTS(SELECT 1 FROM ${kind==='claims'?'mkt_claims':'mkt_shipments'} x WHERE x.order_id=o.id)`);
 const date=(name:string)=>{const value=params.get(name)??'';if(!value)return null;if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw new MarketError('조회 날짜를 확인해주세요.');return value;};
 const from=date('from'),to=date('to');if(from&&to&&from>to)throw new MarketError('시작일은 종료일보다 늦을 수 없습니다.');
 if(from)conditions.push(`o.created_at>=${bind(`${from}T00:00:00+09:00`)}::timestamptz`);
 if(to)conditions.push(`o.created_at<${bind(new Date(Date.parse(`${to}T00:00:00+09:00`)+86400000).toISOString())}::timestamptz`);
 const shipping=params.get('shipping')??'all';
 const shippingConditions={all:'TRUE',pending:"o.payment_status IN ('PAID','PARTIALLY_REFUNDED') AND o.fulfillment_status IN ('UNFULFILLED','PREPARING')",label:"o.fulfillment_status='LABEL_REGISTERED' AND o.payment_status IN ('PAID','PARTIALLY_REFUNDED')",transit:"o.fulfillment_status IN ('SHIPPED','PARTIALLY_SHIPPED')",delivered:"o.fulfillment_status='DELIVERED'"};
 if(!Object.hasOwn(shippingConditions,shipping))throw new MarketError('발송 필터를 확인해주세요.');
 const baseWhere=conditions.length?`WHERE ${conditions.join(' AND ')}`:'';
 const where=`${baseWhere||'WHERE TRUE'} AND (${shippingConditions[shipping as keyof typeof shippingConditions]})`;
 // Count and page share one snapshot so an incoming order cannot shift this response's totals.
 return db.transaction(async tx=>{
  await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const total=Number((await tx.query<{count:string}>(`SELECT count(*) FROM mkt_orders o ${where}`,values)).rows[0].count);
  const current=Math.min(page,Math.max(1,Math.ceil(total/pageSize)));
  const newest=kind==='claims'?'(SELECT max(created_at) FROM mkt_claims WHERE order_id=o.id)':kind==='shipments'?'(SELECT max(created_at) FROM mkt_shipments WHERE order_id=o.id)':'o.created_at';
  const ids=(await tx.query<{id:string}>(`SELECT o.id FROM mkt_orders o ${where} ORDER BY ${newest} DESC,o.id DESC LIMIT ${pageSize} OFFSET ${(current-1)*pageSize}`,values)).rows;
  const counts=(await tx.query<Row>(`SELECT count(*) AS all_count,${Object.entries(shippingConditions).filter(([key])=>key!=='all').map(([key,condition])=>`count(*) FILTER(WHERE ${condition}) AS ${key}`).join(',')} FROM mkt_orders o ${baseWhere}`,values)).rows[0];
  const orders:Order[]=[];for(const row of ids)orders.push(await getOrder(tx,row.id));
  return {orders,total,page:current,pageSize,shippingCounts:{all:Number(counts.all_count),pending:Number(counts.pending),label:Number(counts.label),transit:Number(counts.transit),delivered:Number(counts.delivered)}};
 });
}
export async function inquiryPage(db:Database,params:URLSearchParams):Promise<InquiryPage>{
 const page=integer(Number(params.get('page')??1),'페이지',1,1_000_000),pageSize=20,q=textValue(params.get('q')??'','검색어',100,true),status=params.get('status')??'all';
 if(!['all','unanswered','answered'].includes(status))throw new MarketError('문의 상태를 확인해주세요.');
 const values:unknown[]=[],conditions:string[]=[];
 if(q){values.push(q);conditions.push(`(strpos(lower(concat_ws(' ',i.subject,i.content,i.reply,o.number,o.customer->>'name',o.customer->>'phone')),lower($1))>0${/^[\d -]+$/.test(q)&&/\d/.test(q)?` OR strpos(regexp_replace(o.customer->>'phone','[^0-9]','','g'),$2)>0`:''})`);if(/^[\d -]+$/.test(q)&&/\d/.test(q))values.push(q.replace(/\D/g,''));}
 const join='FROM mkt_inquiries i LEFT JOIN mkt_orders o ON o.id=i.order_id',where=conditions.length?`WHERE ${conditions.join(' AND ')}`:'WHERE TRUE';
 return db.transaction(async tx=>{
  await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const count=(await tx.query<Row>(`SELECT count(*) AS all_count,count(*) FILTER(WHERE i.reply='') AS unanswered,count(*) FILTER(WHERE i.reply<>'') AS answered ${join} ${where}`,values)).rows[0];
  const counts={all:Number(count.all_count),unanswered:Number(count.unanswered),answered:Number(count.answered)},total=counts[status as keyof typeof counts],current=Math.min(page,Math.max(1,Math.ceil(total/pageSize)));
  const rows=(await tx.query<Row>(`SELECT i.*,o.number AS order_number,o.customer->>'name' AS customer_name,o.customer->>'phone' AS customer_phone,o.is_demo ${join} ${where} ${status==='all'?'':status==='unanswered'?"AND i.reply=''":"AND i.reply<>''"} ORDER BY i.created_at DESC,i.id DESC LIMIT ${pageSize} OFFSET ${(current-1)*pageSize}`,values)).rows;
  return {inquiries:rows.map(row=>({...mapInquiry(row),orderNumber:row.order_number,customerName:row.customer_name,customerPhone:row.customer_phone,isDemo:row.is_demo})),total,page:current,pageSize,counts};
 });
}
export async function replyInquiry(db:Database,input:Record<string,unknown>){
 const id=textValue(input.inquiryId,'문의',100),reply=textValue(input.reply,'답변',2000),expected=textValue(input.expectedReply,'기존 답변',2000,true);
 await db.transaction(async tx=>{
  const current=(await tx.query<Row>('SELECT reply FROM mkt_inquiries WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!current)throw new MarketError('문의를 찾을 수 없습니다.',404);
  if(current.reply!==expected)throw new MarketError('다른 화면에서 답변이 변경되었습니다. 목록을 새로고침하고 확인해주세요.',409);
  if(current.reply===reply)return;
  await tx.query('UPDATE mkt_inquiries SET reply=$1,replied_at=now() WHERE id=$2',[reply,id]);await audit(tx,'inquiry.replied',id);
 });
}
export async function dispatchRows(db:Queryable):Promise<unknown[][]>{
 const rows=(await db.query<Row>(`SELECT o.number,o.customer,string_agg(i.name||' / '||i.variant_label||' ×'||(i.quantity-i.refunded_qty)::text,' · ' ORDER BY i.id) AS products,sum(i.quantity-i.refunded_qty) AS quantity FROM mkt_orders o JOIN mkt_order_items i ON i.order_id=o.id WHERE o.fulfillment_status='PREPARING' AND o.payment_status IN ('PAID','PARTIALLY_REFUNDED') AND i.quantity>i.refunded_qty AND NOT EXISTS(SELECT 1 FROM mkt_claims c WHERE c.order_id=o.id AND c.status IN ('REQUESTED','APPROVED')) GROUP BY o.id ORDER BY o.created_at,o.id`)).rows;
 return rows.map(row=>[row.number,row.customer.name,row.customer.phone,row.customer.postcode,`${row.customer.address} ${row.customer.addressDetail}`,row.customer.note,row.products,Number(row.quantity)]);
}
export async function adminData(db:Database):Promise<AdminResponse>{
 return db.transaction(async tx=>{
 await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const base=await catalog(tx),ids=(await tx.query<{id:string}>('SELECT id FROM mkt_orders ORDER BY created_at DESC,id DESC LIMIT 20')).rows;
 const orders:Order[]=[];for(const x of ids)orders.push(await getOrder(tx,x.id));
 const [reviews,inquiries,coupons,events,claims,customers,methods,tasks]=[await tx.query<Row>('SELECT * FROM mkt_reviews ORDER BY created_at DESC LIMIT 200'),await tx.query<Row>('SELECT * FROM mkt_inquiries ORDER BY created_at DESC LIMIT 200'),await tx.query<Row>('SELECT * FROM mkt_coupons ORDER BY code'),await tx.query<Row>('SELECT * FROM mkt_audit ORDER BY created_at DESC LIMIT 200'),await tx.query<Row>('SELECT * FROM mkt_claims ORDER BY created_at DESC LIMIT 200'),
  await tx.query<Row>(`SELECT COALESCE(NULLIF(regexp_replace(customer->>'phone','[^0-9]','','g'),''),id) AS key,(array_agg(customer->>'name' ORDER BY created_at DESC,id DESC))[1] AS name,count(*) AS count,COALESCE(sum(total-refund_total) FILTER(WHERE payment_status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED','REFUNDING')),0) AS paid FROM mkt_orders GROUP BY 1 ORDER BY max(created_at) DESC,1 LIMIT 200`),
  await tx.query<Row>("SELECT method,COALESCE(sum(total-refund_total) FILTER(WHERE payment_status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED','REFUNDING')),0) AS paid FROM mkt_orders GROUP BY method"),
  await tx.query<Row>("SELECT (SELECT count(*) FROM mkt_orders o WHERE payment_status IN ('PAID','PARTIALLY_REFUNDED') AND fulfillment_status='UNFULFILLED' AND NOT EXISTS(SELECT 1 FROM mkt_claims c WHERE c.order_id=o.id AND c.status IN ('REQUESTED','APPROVED'))) AS to_prepare,(SELECT count(*) FROM mkt_claims WHERE status='REQUESTED') AS open_claims,(SELECT count(*) FROM mkt_inquiries WHERE reply='') AS unanswered")];
 const aggregate=(await tx.query<Row>("SELECT count(*)::bigint AS orders, count(*) FILTER(WHERE payment_status IN ('PENDING','WAITING_FOR_DEPOSIT'))::bigint AS pending, COALESCE(sum(total) FILTER(WHERE payment_status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED','REFUNDING')),0)::bigint AS paid,COALESCE(sum(refund_total),0)::bigint AS refunds FROM mkt_orders")).rows[0],paid=Number(aggregate.paid),refunds=Number(aggregate.refunds);
 return {...base,orders,claims:claims.rows.map(mapClaim),customers:customers.rows.map(c=>({key:c.key,name:c.name,count:Number(c.count),paid:Number(c.paid)})),methodTotals:Object.fromEntries(['CARD','NAVERPAY','KAKAOPAY','VIRTUAL_ACCOUNT'].map(method=>[method,Number(methods.rows.find(row=>row.method===method)?.paid??0)])) as Record<PaymentMethod,number>,reviews:reviews.rows.map(r=>({id:r.id,orderId:r.order_id,productId:r.product_id,rating:r.rating,content:r.content,status:r.status,createdAt:iso(r.created_at)!})),inquiries:inquiries.rows.map(mapInquiry),coupons:coupons.rows.map(r=>({code:r.code,percent:r.percent,maxDiscount:r.max_discount,minAmount:r.min_amount,expiresAt:iso(r.expires_at),active:r.active})),events:events.rows.map(r=>({id:r.id,action:r.action,detail:r.detail,createdAt:iso(r.created_at)!})),metrics:{paid,refunds,orders:Number(aggregate.orders),pending:Number(aggregate.pending),toPrepare:Number(tasks.rows[0].to_prepare),openClaims:Number(tasks.rows[0].open_claims),unanswered:Number(tasks.rows[0].unanswered),revenue:paid-refunds,estimatedSettlement:null}};
 });
}
function safeLink(value:unknown,label:string,optional=true){const s=textValue(value??'',label,500,optional);if(s&&!/^https:\/\/[^\s]+$/.test(s))throw new MarketError(`${label}은 HTTPS 주소로 입력해주세요.`);return s;}
export async function saveSettings(db:Database,v:unknown){if(!v||typeof v!=='object')throw new MarketError('설정을 확인해주세요.');const s=v as Settings;const clean=await settings(db);clean.brand=textValue(s.brand,'브랜드',60);for(const k of Object.keys(clean.seller) as (keyof Settings['seller'])[])clean.seller[k]=k==='escrowUrl'?safeLink(s.seller?.[k],'구매안전서비스 링크'):textValue(s.seller?.[k]??'',k,300,true);for(const k of ['fee','freeThreshold','remoteFee','returnFee'] as const)clean.shipping[k]=integer(s.shipping?.[k],k,0,10_000_000);for(const k of ['returnAddress','cutoff']as const)clean.shipping[k]=textValue(s.shipping?.[k]??'',k,300,true);for(const k of ['policiesApproved','shippingReady','notificationReady']as const){if(typeof s[k]!=='boolean')throw new MarketError('승인 상태를 확인해주세요.');clean[k]=s[k];}await db.transaction(async tx=>{await tx.query('UPDATE mkt_settings SET data=$1 WHERE id=$2',[JSON.stringify(clean),'store']);await audit(tx,'settings.saved','판매자·배송 설정 저장');});}
export async function saveProduct(db:Database,v:unknown){if(!v||typeof v!=='object')throw new MarketError('상품을 확인해주세요.');const p=v as Product;
 const id=textValue(p.id,'상품 ID',80),slug=textValue(p.slug,'상품 주소',80);if(!/^[a-z0-9-]+$/.test(id)||!/^[-a-z0-9]+$/.test(slug))throw new MarketError('상품 ID는 영문 소문자·숫자·하이픈을 사용해주세요.');if(!['apparel','clicker','figure','gear'].includes(p.category))throw new MarketError('카테고리를 확인해주세요.');
 const price=integer(p.price,'판매가',1,10_000_000);if(typeof p.sample!=='boolean'||typeof p.published!=='boolean'||!p.safety)throw new MarketError('상품 공개·안전 정보를 확인해주세요.');
 if(!['unknown','adult','child'].includes(p.safety.audience)||!['pending','verified','not_required'].includes(p.safety.certification)||!['pending','original','licensed'].includes(p.safety.license))throw new MarketError('안전·권리 정보를 확인해주세요.');
 const safety={...p.safety,age:textValue(p.safety.age??'','대상 연령',100,true),certificateNumber:textValue(p.safety.certificateNumber??'','인증번호',100,true),certificateUrl:safeLink(p.safety.certificateUrl,'인증 자료'),licenseReference:textValue(p.safety.licenseReference??'','권리 자료',300,true)};
 if(!Array.isArray(p.images)||!p.images.length||p.images.length>12||p.images.some(x=>typeof x!=='string'||!/^\/(?!\/)[a-zA-Z0-9_./-]+\.(svg|png|jpg|jpeg|webp)$/.test(x)))throw new MarketError('업로드한 사진 또는 배포된 상품 이미지 주소를 1~12장 등록해주세요.');
 if(!Array.isArray(p.specs)||p.specs.length>30)throw new MarketError('상품 고시 정보를 확인해주세요.');const specs=p.specs.map(s=>({label:textValue(s.label,'항목',100),value:textValue(s.value,'내용',1000)}));
 const dropAt=p.dropAt?new Date(p.dropAt).toISOString():null;
 const data={id,slug,name:textValue(p.name,'상품명',100),line:textValue(p.line,'라인',100),category:p.category,price,description:textValue(p.description,'상품 설명',2000),images:p.images,specs,sample:p.sample,published:p.published,dropAt,safety,soundUrl:p.soundUrl?textValue(p.soundUrl,'음원',300):null};if(data.soundUrl&&!/^(\/audio\/[a-zA-Z0-9_.-]+\.(mp3|wav|ogg)|\/api\/media\/[a-f0-9-]{36}\.wav)$/.test(data.soundUrl))throw new MarketError('실제 녹음한 PCM WAV를 업로드하거나 배포된 음원 주소를 등록해주세요.');
 if(!Array.isArray(p.variants)||!p.variants.length||p.variants.length>100)throw new MarketError('옵션을 확인해주세요.');
 await db.transaction(async tx=>{await tx.query('INSERT INTO mkt_products(id,slug,name,category,price,data) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET slug=EXCLUDED.slug,name=EXCLUDED.name,category=EXCLUDED.category,price=EXCLUDED.price,data=EXCLUDED.data',[id,slug,data.name,p.category,price,JSON.stringify(data)]);
  for(const v of p.variants){const vid=textValue(v.id,'옵션 ID',100),label=textValue(v.label,'옵션 이름',100),delta=integer(v.priceDelta,'추가금',-price+1,10_000_000),onHand=integer(v.onHand,'재고',0,1_000_000);if(!v.options||typeof v.options!=='object'||Array.isArray(v.options)||JSON.stringify(v.options).length>1000)throw new MarketError('옵션 속성을 확인해주세요.');const old=(await tx.query<Row>('SELECT * FROM mkt_variants WHERE id=$1 FOR UPDATE',[vid])).rows[0];if(old&&old.product_id!==id)throw new MarketError('다른 상품의 옵션 ID입니다.');if(old&&onHand!==old.on_hand)throw new MarketError('재고 변경은 재고 조정 메뉴를 사용해주세요.');await tx.query('INSERT INTO mkt_variants(id,product_id,label,price_delta,options,on_hand) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET label=EXCLUDED.label,price_delta=EXCLUDED.price_delta,options=EXCLUDED.options',[vid,id,label,delta,JSON.stringify(v.options),onHand]);}
  await audit(tx,'product.saved',`${id} / 시안 ${p.sample}`);
 });
}
export async function adjustStock(db:Database,input:Record<string,unknown>){const id=textValue(input.variantId,'옵션',100),delta=integer(input.delta,'재고 조정',-1_000_000,1_000_000),reason=textValue(input.reason,'조정 사유',300);await db.transaction(async tx=>{const v=(await tx.query<Row>('SELECT * FROM mkt_variants WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!v||v.on_hand+delta<v.reserved+v.allocated||v.on_hand+delta<0)throw new MarketError('점유·출고 대기 재고보다 줄일 수 없습니다.',409);await tx.query('UPDATE mkt_variants SET on_hand=on_hand+$1 WHERE id=$2',[delta,id]);await stockLog(tx,id,delta,0,0,reason);await audit(tx,'stock.adjusted',`${id} / ${delta} / ${reason}`);});}
export async function prepare(db:Database,id:string){await db.transaction(async tx=>{const o=(await tx.query<Row>('SELECT * FROM mkt_orders WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!o||!['PAID','PARTIALLY_REFUNDED'].includes(o.payment_status)||o.fulfillment_status!=='UNFULFILLED'||(await tx.query("SELECT id FROM mkt_claims WHERE order_id=$1 AND status IN ('REQUESTED','APPROVED')",[id])).rows.length)throw new MarketError('결제 상태 또는 클레임을 확인해주세요.',409);await tx.query("UPDATE mkt_orders SET fulfillment_status='PREPARING' WHERE id=$1",[id]);await audit(tx,'order.prepared',o.number);});}
export async function importShipments(db:Database,rows:unknown,apply:boolean){if(!Array.isArray(rows)||!rows.length||rows.length>500)throw new MarketError('1~500행을 입력해주세요.');const results:{row:number;valid:boolean;error:string;orderNumber:string}[]=[],seenOrders=new Set<string>(),seenTracking=new Set<string>();let applied=0;
 for(const [index,raw]of rows.entries()){const row=raw as Row;try{
  const number=textValue(row.orderNumber,'주문번호',80),carrier=textValue(row.carrier,'택배사',20),tracking=textValue(row.trackingNumber,'송장번호',20).replaceAll('-','');if(!['CJ','LOTTE','POST'].includes(carrier)||!/^\d{10,14}$/.test(tracking))throw new MarketError('택배사 코드(CJ/LOTTE/POST)와 송장번호(10~14자리)를 확인해주세요.');if(seenOrders.has(number)||seenTracking.has(`${carrier}:${tracking}`))throw new MarketError('파일 안에서 주문번호 또는 송장번호가 중복됩니다.');
  await db.transaction(async tx=>{const o=(await tx.query<Row>('SELECT * FROM mkt_orders WHERE number=$1 FOR UPDATE',[number])).rows[0];if(!o||o.fulfillment_status!=='PREPARING'||!['PAID','PARTIALLY_REFUNDED'].includes(o.payment_status))throw new MarketError('배송 준비 주문이 아닙니다.');if((await tx.query("SELECT id FROM mkt_claims WHERE order_id=$1 AND status IN ('REQUESTED','APPROVED')",[o.id])).rows.length)throw new MarketError('처리 중인 클레임이 있습니다.');if((await tx.query('SELECT id FROM mkt_shipments WHERE carrier=$1 AND tracking_number=$2',[carrier,tracking])).rows.length)throw new MarketError('이미 등록된 송장번호입니다.');if(apply){await tx.query('INSERT INTO mkt_shipments(id,order_id,carrier,tracking_number,status) VALUES($1,$2,$3,$4,$5)',[randomUUID(),o.id,carrier,tracking,'LABEL_REGISTERED']);await tx.query("UPDATE mkt_orders SET fulfillment_status='LABEL_REGISTERED' WHERE id=$1",[o.id]);await audit(tx,'shipment.registered',number);}});
  seenOrders.add(number);seenTracking.add(`${carrier}:${tracking}`);results.push({row:index+1,valid:true,error:'',orderNumber:number});if(apply)applied++;
 }catch(e){results.push({row:index+1,valid:false,error:e instanceof MarketError?e.message:'등록 실패',orderNumber:typeof row?.orderNumber==='string'?row.orderNumber:''});}}
 return {results,applied};
}
export async function registerShipment(db:Database,input:Record<string,unknown>){
 const result=await importShipments(db,[input],true);
 if(!result.applied)throw new MarketError(result.results[0].error,409);
}
export async function shipmentStatus(db:Database,id:string,status:unknown,reason:string){reason=textValue(reason,'변경 근거',1000);if(!['SHIPPED','DELIVERED'].includes(status as string))throw new MarketError('배송 상태를 확인해주세요.');await db.transaction(async tx=>{
 const pre=(await tx.query<Row>('SELECT order_id FROM mkt_shipments WHERE id=$1',[id])).rows[0];if(!pre)throw new MarketError('송장을 찾을 수 없습니다.',404);const order=(await tx.query<Row>('SELECT * FROM mkt_orders WHERE id=$1 FOR UPDATE',[pre.order_id])).rows[0];if(!order||!['PAID','PARTIALLY_REFUNDED'].includes(order.payment_status))throw new MarketError('출고 가능한 결제 상태가 아닙니다.',409);const s=(await tx.query<Row>('SELECT * FROM mkt_shipments WHERE id=$1 FOR UPDATE',[id])).rows[0];if(s.status===status)return;
 if(status==='SHIPPED'){if(s.status!=='LABEL_REGISTERED')throw new MarketError('집하 전 상태를 확인해주세요.',409);if((await tx.query("SELECT id FROM mkt_claims WHERE order_id=$1 AND status IN ('REQUESTED','APPROVED')",[s.order_id])).rows.length)throw new MarketError('클레임 처리 중에는 출고할 수 없습니다.',409);
  const reservations=(await tx.query<Row>("SELECT * FROM mkt_reservations WHERE order_id=$1 AND status='ALLOCATED' AND quantity>0 ORDER BY variant_id FOR UPDATE",[s.order_id])).rows;if(!reservations.length)throw new MarketError('출고할 잔여 재고가 없습니다.',409);
  for(const r of reservations){await tx.query('UPDATE mkt_variants SET on_hand=on_hand-$1,allocated=allocated-$1 WHERE id=$2',[r.quantity,r.variant_id]);await tx.query("UPDATE mkt_reservations SET status='SHIPPED' WHERE order_id=$1 AND variant_id=$2",[s.order_id,r.variant_id]);await tx.query('UPDATE mkt_order_items SET shipped_qty=quantity-refunded_qty WHERE order_id=$1 AND variant_id=$2',[s.order_id,r.variant_id]);await stockLog(tx,r.variant_id,-r.quantity,0,-r.quantity,'택배 집하 확인',s.order_id);}
  await tx.query("UPDATE mkt_orders SET fulfillment_status='SHIPPED' WHERE id=$1",[s.order_id]);await job(tx,s.order_id,'shipment.shipped');
 }else{if(s.status!=='SHIPPED')throw new MarketError('배송중 주문만 완료할 수 있습니다.',409);await tx.query("UPDATE mkt_orders SET fulfillment_status='DELIVERED',delivered_at=now() WHERE id=$1",[s.order_id]);await job(tx,s.order_id,'shipment.delivered');}
 await tx.query("UPDATE mkt_shipments SET status=$1,shipped_at=CASE WHEN $1='SHIPPED' THEN COALESCE(shipped_at,now()) ELSE shipped_at END,delivered_at=CASE WHEN $1=$2 THEN COALESCE(delivered_at,now()) ELSE delivered_at END WHERE id=$3",[status,'DELIVERED',id]);await audit(tx,'shipment.updated',`${id} / ${status} / ${reason}`);
 });}
type ClaimRefundAttempt={claimId:string;amount:number;expectedBalance:number;cancelReason:string;resolutionReason:string;previousPaymentStatus:string;idempotencyKey:string;requestedAt:string;status:'PENDING'|'COMPLETED';transactionKey?:string};
function paymentData(value:unknown):Row{if(typeof value==='string'){try{return JSON.parse(value) as Row;}catch{return {};}}return value&&typeof value==='object'?value as Row:{ };}
function refundAttempts(data:Row):Record<string,ClaimRefundAttempt>{return data.refundAttempts&&typeof data.refundAttempts==='object'?data.refundAttempts as Record<string,ClaimRefundAttempt>:{ };}
function claimRefundAmount(o:Order,c:Row,id:string){
 if(c.type==='CANCEL'&&['SHIPPED','PARTIALLY_SHIPPED','DELIVERED'].includes(o.fulfillmentStatus))throw new MarketError('출고 후에는 반품 요청으로 처리해주세요.');
 let amount=0;for(const i of c.items as {itemId:string;quantity:number}[]){const item=o.items.find(x=>x.id===i.itemId);if(!item||!Number.isSafeInteger(i.quantity)||i.quantity<1||i.quantity>item.quantity-item.refundedQty)throw new MarketError('이미 환불된 수량을 확인해주세요.',409);amount+=Math.floor(item.total*(item.refundedQty+i.quantity)/item.quantity)-Math.floor(item.total*item.refundedQty/item.quantity);}
 const remaining=o.items.reduce((n,item)=>n+item.quantity-item.refundedQty,0)- (c.items as {quantity:number}[]).reduce((n,item)=>n+item.quantity,0);if(remaining===0)amount+=o.total-o.refundTotal-amount;
 if(amount<0||o.refundTotal+amount>o.total)throw new MarketError('환불 금액을 확인해주세요.',409);
 const cancelReason=`NURI claim ${id}`;return {amount,cancelReason};
}
export async function resolveClaim(db:Database,input:Record<string,unknown>){
 const id=textValue(input.claimId,'클레임',100),status=input.status,reason=textValue(input.reason,'처리 사유',1000);if(!['APPROVED','REJECTED'].includes(status as string))throw new MarketError('처리 상태를 확인해주세요.');
 const pendingRefund:{value:{attempt:ClaimRefundAttempt;paymentKey:string;orderId:string;total:number}|null}={value:null};
 await db.transaction(async tx=>{
  const pre=(await tx.query<Row>('SELECT order_id FROM mkt_claims WHERE id=$1',[id])).rows[0];if(!pre)throw new MarketError('요청을 찾을 수 없습니다.',404);await tx.query('SELECT id FROM mkt_orders WHERE id=$1 FOR UPDATE',[pre.order_id]);const c=(await tx.query<Row>('SELECT * FROM mkt_claims WHERE id=$1 FOR UPDATE',[id])).rows[0],o=await getOrder(tx,c.order_id);
  const pay=(await tx.query<Row>('SELECT payment_key,status,amount,data FROM mkt_payments WHERE order_id=$1 FOR UPDATE',[o.id])).rows[0],data=paymentData(pay?.data),attempts=refundAttempts(data),existing=attempts[id];
  if(c.status==='COMPLETED'||c.status==='REJECTED')return;
  if(existing&&status==='REJECTED')throw new MarketError('PG 환불 결과 확인 중에는 요청을 반려할 수 없습니다. 먼저 같은 요청으로 대사해주세요.',409);
  if(status==='APPROVED'&&c.type==='CANCEL'&&['PENDING','WAITING_FOR_DEPOSIT'].includes(o.paymentStatus)){
   if(!o.isDemo&&pay)throw new MarketError(o.paymentStatus==='WAITING_FOR_DEPOSIT'?'가상계좌 발급·입금 취소를 PG에서 확인하기 전에는 재고를 해제할 수 없습니다.':'PG 승인·취소 결과를 대사하기 전에는 재고를 해제할 수 없습니다.',503);
   if(c.status!=='REQUESTED')throw new MarketError('이미 처리된 요청입니다.',409);await release(tx,o.id);await tx.query("UPDATE mkt_orders SET payment_status='EXPIRED',due_at=NULL WHERE id=$1",[o.id]);await tx.query("UPDATE mkt_claims SET status='COMPLETED',resolution=$1 WHERE id=$2",[reason,id]);await audit(tx,'claim.resolved',`${id} / ${status} / ${reason}`);return;
  }
  if(status==='APPROVED'&&c.type!=='EXCHANGE'&&!o.isDemo){
   if(!['PAID','PARTIALLY_REFUNDED','REFUNDING'].includes(o.paymentStatus))throw new MarketError('환불 가능한 결제 상태를 확인해주세요.',409);
   if(o.method==='VIRTUAL_ACCOUNT')throw new MarketError('가상계좌 실환불은 구매자 환불계좌 정보 수집·검증 기능을 연결한 뒤 처리할 수 있습니다.',503);
   if(!pay?.payment_key)throw new MarketError('PG 결제키가 없어 실환불을 시작할 수 없습니다. 결제 상태를 먼저 대사해주세요.',503);
   if(!existing){if(c.status!=='REQUESTED'||!['PAID','PARTIALLY_REFUNDED'].includes(o.paymentStatus))throw new MarketError('환불 요청 상태를 확인해주세요.',409);const calculated=claimRefundAmount(o,c,id),expectedBalance=o.total-o.refundTotal;
    if(pay.amount!==o.total||expectedBalance<=0)throw new MarketError('주문 환불 잔액을 확인해주세요.',409);
    const attempt:ClaimRefundAttempt={claimId:id,amount:calculated.amount,expectedBalance,cancelReason:calculated.cancelReason,resolutionReason:reason,previousPaymentStatus:o.paymentStatus,idempotencyKey:randomUUID(),requestedAt:new Date().toISOString(),status:'PENDING'};
    attempts[id]=attempt;await tx.query("UPDATE mkt_payments SET data=$1,status='REFUND_REQUESTED',updated_at=now() WHERE order_id=$2",[JSON.stringify({...data,refundAttempts:attempts}),o.id]);await tx.query("UPDATE mkt_orders SET payment_status='REFUNDING' WHERE id=$1",[o.id]);await tx.query("UPDATE mkt_claims SET resolution='PG 취소 요청 및 결과 대사 중' WHERE id=$1",[id]);
   }else if(existing.status!=='PENDING'&&existing.status!=='COMPLETED')throw new MarketError('환불 요청 상태를 수동 확인해주세요.',409);
   if(existing?.status==='COMPLETED')return;
   pendingRefund.value={attempt:attempts[id],paymentKey:pay.payment_key,orderId:o.id,total:o.total};return;
  }
  if(c.status!=='REQUESTED')throw new MarketError('이미 처리된 요청입니다.',409);
  if(status==='APPROVED'&&c.type!=='EXCHANGE'){
   if(!['PAID','PARTIALLY_REFUNDED'].includes(o.paymentStatus))throw new MarketError('환불 가능한 결제 상태를 확인해주세요.',409);
   const {amount}=claimRefundAmount(o,c,id);for(const i of c.items as {itemId:string;quantity:number}[]){const item=o.items.find(x=>x.id===i.itemId)!;await tx.query('UPDATE mkt_order_items SET refunded_qty=refunded_qty+$1 WHERE id=$2',[i.quantity,item.id]);if(item.shippedQty===0){const r=(await tx.query<Row>('SELECT * FROM mkt_reservations WHERE order_id=$1 AND variant_id=$2 FOR UPDATE',[o.id,item.variantId])).rows[0];if(r?.status==='ALLOCATED'){await tx.query('UPDATE mkt_variants SET allocated=allocated-$1 WHERE id=$2',[i.quantity,item.variantId]);await tx.query("UPDATE mkt_reservations SET quantity=quantity-$1,status=CASE WHEN quantity=$1 THEN 'RELEASED' ELSE status END WHERE order_id=$2 AND variant_id=$3",[i.quantity,o.id,item.variantId]);await stockLog(tx,item.variantId,0,0,-i.quantity,'취소 재고 해제',o.id);}}}
   const remaining=(await tx.query<{n:number}>('SELECT sum(quantity-refunded_qty)::integer AS n FROM mkt_order_items WHERE order_id=$1',[o.id])).rows[0].n;await tx.query('UPDATE mkt_orders SET refund_total=refund_total+$1,payment_status=$2 WHERE id=$3',[amount,remaining===0?'REFUNDED':o.refundTotal+amount>0?'PARTIALLY_REFUNDED':'PAID',o.id]);await tx.query("UPDATE mkt_claims SET status='COMPLETED',resolution=$1 WHERE id=$2",[`${reason} / 데모 환불 ${amount}원 / 회수품 재입고는 검수 후 별도 조정`,id]);await job(tx,o.id,'payment.refunded');
  }else await tx.query('UPDATE mkt_claims SET status=$1,resolution=$2 WHERE id=$3',[status,reason,id]);await audit(tx,'claim.resolved',`${id} / ${status} / ${reason}`);
 });
  if(!pendingRefund.value)return;const refund=pendingRefund.value;
  const {cancelClaimPayment,verifyClaimPaymentBalance}=await import('./payments');const providerInput={orderId:refund.orderId,totalAmount:refund.total,paymentKey:refund.paymentKey,expectedBalance:refund.attempt.expectedBalance,cancelAmount:refund.attempt.amount,cancelReason:refund.attempt.cancelReason,idempotencyKey:refund.attempt.idempotencyKey,requestedAt:refund.attempt.requestedAt};const provider=refund.attempt.amount===0?await verifyClaimPaymentBalance(providerInput):await cancelClaimPayment(providerInput);
 await db.transaction(async tx=>{
  await tx.query('SELECT id FROM mkt_orders WHERE id=$1 FOR UPDATE',[refund!.orderId]);const c=(await tx.query<Row>('SELECT * FROM mkt_claims WHERE id=$1 FOR UPDATE',[id])).rows[0],o=await getOrder(tx,refund!.orderId),pay=(await tx.query<Row>('SELECT data FROM mkt_payments WHERE order_id=$1 FOR UPDATE',[o.id])).rows[0],data=paymentData(pay.data),attempts=refundAttempts(data),attempt=attempts[id];if(!attempt)throw new MarketError('저장된 PG 환불 요청을 찾을 수 없습니다.',409);if(c.status==='COMPLETED'||attempt.status==='COMPLETED')return;if(o.paymentStatus!=='REFUNDING')throw new MarketError('환불 처리 중 주문 상태가 변경되어 수동 대사가 필요합니다.',409);
  if(provider.balanceAmount!==o.total-o.refundTotal-refund!.attempt.amount)throw new MarketError('PG 환불 잔액과 주문 환불액이 일치하지 않습니다. 수동 대사가 필요합니다.',409);
  for(const i of c.items as {itemId:string;quantity:number}[]){const item=o.items.find(x=>x.id===i.itemId);if(!item||i.quantity>item.quantity-item.refundedQty)throw new MarketError('PG 취소는 완료됐지만 상품 환불 수량이 달라 수동 대사가 필요합니다.',409);await tx.query('UPDATE mkt_order_items SET refunded_qty=refunded_qty+$1 WHERE id=$2',[i.quantity,item.id]);if(item.shippedQty===0){const r=(await tx.query<Row>('SELECT * FROM mkt_reservations WHERE order_id=$1 AND variant_id=$2 FOR UPDATE',[o.id,item.variantId])).rows[0];if(r?.status==='ALLOCATED'){if(i.quantity>r.quantity)throw new MarketError('PG 취소는 완료됐지만 재고 예약 수량이 달라 수동 대사가 필요합니다.',409);await tx.query('UPDATE mkt_variants SET allocated=allocated-$1 WHERE id=$2',[i.quantity,item.variantId]);await tx.query("UPDATE mkt_reservations SET quantity=quantity-$1,status=CASE WHEN quantity=$1 THEN 'RELEASED' ELSE status END WHERE order_id=$2 AND variant_id=$3",[i.quantity,o.id,item.variantId]);await stockLog(tx,item.variantId,0,0,-i.quantity,'PG 환불 완료 재고 해제',o.id);}}}
  const remaining=(await tx.query<{n:number}>('SELECT COALESCE(sum(quantity-refunded_qty),0)::integer AS n FROM mkt_order_items WHERE order_id=$1',[o.id])).rows[0].n,newRefundTotal=o.refundTotal+attempt.amount,transactionKey=provider.cancels?.find(x=>x.cancelReason===attempt.cancelReason)?.transactionKey;if(attempt.amount>0&&!transactionKey)throw new MarketError('PG 취소 거래 키가 없어 수동 대사가 필요합니다.',409);const newStatus=attempt.amount===0?attempt.previousPaymentStatus:remaining===0||newRefundTotal===o.total?'REFUNDED':'PARTIALLY_REFUNDED';
  await tx.query('UPDATE mkt_orders SET refund_total=$1,payment_status=$2 WHERE id=$3',[newRefundTotal,newStatus,o.id]);attempt.status='COMPLETED';if(transactionKey)attempt.transactionKey=transactionKey;await tx.query('UPDATE mkt_payments SET status=$1,data=$2,updated_at=now() WHERE order_id=$3',[provider.status,JSON.stringify({...data,status:provider.status,balanceAmount:provider.balanceAmount,...(transactionKey?{lastTransactionKey:provider.lastTransactionKey||transactionKey}:{}),refundAttempts:attempts}),o.id]);await tx.query("UPDATE mkt_claims SET status='COMPLETED',resolution=$1 WHERE id=$2",[attempt.amount===0?`${attempt.resolutionReason} / 0원·PG 취소 없음 / PG 잔액 확인 완료`:`${attempt.resolutionReason} / PG 환불 완료 ${attempt.amount}원 / 거래 ${transactionKey} / 회수품 재입고는 검수 후 별도 조정`,id]);if(attempt.amount>0)await job(tx,o.id,'payment.refunded');await audit(tx,'claim.resolved',`${id} / APPROVED / ${attempt.amount===0?'0원·PG 취소 없음':`PG 환불 ${attempt.amount}원`}`);
 });
}
export async function saveCoupon(db:Database,v:unknown){const c=v as Coupon;if(!c)throw new MarketError('쿠폰을 확인해주세요.');const code=textValue(c.code,'쿠폰 코드',40).toUpperCase();if(!/^[A-Z0-9_-]+$/.test(code)||typeof c.active!=='boolean')throw new MarketError('쿠폰 코드를 확인해주세요.');const expiry=c.expiresAt?new Date(c.expiresAt).toISOString():null;await db.transaction(async tx=>{await tx.query('INSERT INTO mkt_coupons(code,percent,max_discount,min_amount,expires_at,active) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(code) DO UPDATE SET percent=EXCLUDED.percent,max_discount=EXCLUDED.max_discount,min_amount=EXCLUDED.min_amount,expires_at=EXCLUDED.expires_at,active=EXCLUDED.active',[code,integer(c.percent,'할인율',1,100),integer(c.maxDiscount,'최대 할인'),integer(c.minAmount,'최소 금액'),expiry,c.active]);await audit(tx,'coupon.saved',code);});}
export async function runMaintenance(db:Database){let expired=0;const due=(await db.query<{id:string}>("SELECT id FROM mkt_orders o WHERE due_at<now() AND ((payment_status='PENDING' AND NOT EXISTS(SELECT 1 FROM mkt_payments p WHERE p.order_id=o.id)) OR (payment_status='WAITING_FOR_DEPOSIT' AND is_demo=true)) LIMIT 500")).rows;for(const o of due){await db.transaction(async tx=>{const current=(await tx.query<Row>('SELECT * FROM mkt_orders WHERE id=$1 FOR UPDATE',[o.id])).rows[0];if(!current.due_at||new Date(current.due_at).getTime()>=Date.now())return;if(current.payment_status==='PENDING'&&(await tx.query('SELECT order_id FROM mkt_payments WHERE order_id=$1',[o.id])).rows.length)return;await applyPaymentTx(tx,o.id,'EXPIRED',`expire:${o.id}`);expired++;});}return {expired,autoConfirmed:0,detail:'가상계좌 만료는 PG 상태 대사 후 처리합니다. 자동 구매확정은 법정 기산점 자료 연결 전 비활성입니다.'};}
