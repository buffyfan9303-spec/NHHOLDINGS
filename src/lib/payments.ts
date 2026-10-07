import type {Database} from './db';
import {getOrder,applyPaymentTx,mode,catalog,audit} from './commerce';
import {MarketError,integer,textValue,seal,unseal,equal} from './security';
type PGPayment={paymentKey:string;orderId:string;totalAmount:number;balanceAmount:number;currency:string;status:string;method:string;secret?:string;lastTransactionKey?:string;virtualAccount?:{bankCode:string;accountNumber:string;dueDate:string;expired:boolean};easyPay?:{provider:string};receipt?:{url:string};cashReceipt?:{receiptUrl:string}};
export function pgDueDate(value:string){const explicit=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value)?`${value}+09:00`:value;const date=new Date(explicit);if(!Number.isFinite(date.getTime()))throw new MarketError('PG 입금 기한 형식을 확인해주세요.',409);return date.toISOString();}
async function pg(path:string,body?:unknown,idempotencyKey?:string):Promise<PGPayment>{
 const secret=process.env.TOSS_SECRET_KEY??'';if(mode()==='preview'||!secret.startsWith(mode()==='live'?'live_':'test_'))throw new MarketError('PG 연결 키가 설정되지 않았습니다.',503);
 let response:Response;try{response=await fetch(`https://api.tosspayments.com/v1/payments${path}`,{method:body?'POST':'GET',headers:{Authorization:`Basic ${Buffer.from(`${secret}:`).toString('base64')}`,'Content-Type':'application/json',...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(8000),cache:'no-store'});}catch{throw new MarketError('PG 응답을 확인하지 못했습니다. 재시도로 결제 상태를 대사해주세요.',503);}
 const data=await response.json();if(!response.ok)throw new MarketError(`결제사 처리 확인이 필요합니다. (${typeof data.code==='string'?data.code:'PG_ERROR'})`,409);return data as PGPayment;
}
function validate(p:PGPayment,id:string,amount:number){if(p.orderId!==id||p.totalAmount!==amount||p.currency!=='KRW'||typeof p.paymentKey!=='string')throw new MarketError('PG 주문·금액 대사가 일치하지 않습니다.',409);}
function method(p:PGPayment){return p.method==='가상계좌'?'VIRTUAL_ACCOUNT':p.easyPay?.provider==='네이버페이'?'NAVERPAY':p.easyPay?.provider==='카카오페이'?'KAKAOPAY':'CARD';}
async function persist(db:Database,p:PGPayment){await db.transaction(async tx=>{
 const row=(await tx.query<{total:number;payment_key:string|null;payment_status:string}>(`SELECT o.total,o.payment_status,p.payment_key FROM mkt_orders o LEFT JOIN mkt_payments p ON p.order_id=o.id WHERE o.id=$1 FOR UPDATE OF o`,[p.orderId])).rows[0];if(!row)throw new MarketError('주문을 찾을 수 없습니다.',404);validate(p,p.orderId,row.total);if(row.payment_key&&row.payment_key!==p.paymentKey)throw new MarketError('다른 결제키가 등록되어 있습니다.',409);
 // A delayed virtual-account issue response must never overwrite a completed payment.
 if(['PAID','PARTIALLY_REFUNDED','REFUNDED','REFUNDING'].includes(row.payment_status)&&p.status==='WAITING_FOR_DEPOSIT')return;
 const known=['DONE','WAITING_FOR_DEPOSIT','EXPIRED','CANCELED','ABORTED'];if(!known.includes(p.status))throw new MarketError('현재 PG 상태는 수동 대사가 필요합니다.',409);
 const dueDate=p.virtualAccount?pgDueDate(p.virtualAccount.dueDate):undefined,data={status:p.status,balanceAmount:p.balanceAmount,receiptUrl:p.receipt?.url??null,cashReceiptUrl:p.cashReceipt?.receiptUrl??null,virtualAccount:p.virtualAccount?{bank:p.virtualAccount.bankCode,accountNumber:p.virtualAccount.accountNumber,dueDate}:null};
 await tx.query('INSERT INTO mkt_payments(order_id,payment_key,status,amount,deposit_secret,data) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(order_id) DO UPDATE SET payment_key=EXCLUDED.payment_key,status=EXCLUDED.status,deposit_secret=COALESCE(EXCLUDED.deposit_secret,mkt_payments.deposit_secret),data=EXCLUDED.data,updated_at=now()',[p.orderId,p.paymentKey,p.status,p.totalAmount,p.secret?seal(p.secret):null,JSON.stringify(data)]);
 await tx.query('UPDATE mkt_orders SET method=$1 WHERE id=$2',[method(p),p.orderId]);
 if(p.status==='DONE')await applyPaymentTx(tx,p.orderId,'PAID',`pg:${p.paymentKey}:DONE`);
 else if(p.status==='WAITING_FOR_DEPOSIT')await applyPaymentTx(tx,p.orderId,'WAITING_FOR_DEPOSIT',`pg:${p.paymentKey}:WAIT`,dueDate);
 else {if(['PAID','PARTIALLY_REFUNDED','REFUNDED'].includes(row.payment_status))throw new MarketError('입금 취소·환불 내역의 수동 대사가 필요합니다.',409);await applyPaymentTx(tx,p.orderId,p.status==='ABORTED'?'FAILED':'EXPIRED',`pg:${p.paymentKey}:${p.status}`);}
 });}
export async function confirmPayment(db:Database,input:Record<string,unknown>,token:string){
 const id=textValue(input.orderId,'주문',100),key=textValue(input.paymentKey,'결제키',200),amount=integer(input.amount,'결제금액',1),order=await getOrder(db,id,token);if(order.isDemo)throw new MarketError('체험 주문은 실결제를 받을 수 없습니다.',409);if(amount!==order.total)throw new MarketError('서버 주문 금액과 요청 금액이 다릅니다.',409);
 const c=await catalog(db);if(mode()==='live'&&c.readiness.some(x=>!x.ready))throw new MarketError('운영 개시 준비를 확인해주세요.',503);
 // PG lookup has no approval side effect. Verify ownership before reserving its unique payment key.
 let p=await pg(`/${encodeURIComponent(key)}`);validate(p,id,amount);if(p.paymentKey!==key)throw new MarketError('조회한 PG 결제키가 다릅니다.',409);
 await db.transaction(async tx=>{const r=(await tx.query<{payment_status:string;due_at:string|null}>('SELECT payment_status,due_at FROM mkt_orders WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!['PENDING','WAITING_FOR_DEPOSIT','PAID'].includes(r.payment_status))throw new MarketError('결제 가능한 주문 상태를 확인해주세요.',409);const old=(await tx.query<{payment_key:string|null}>('SELECT payment_key FROM mkt_payments WHERE order_id=$1',[id])).rows[0];if(old?.payment_key&&old.payment_key!==key)throw new MarketError('다른 결제키가 이미 등록되어 있습니다.',409);if(!old?.payment_key&&r.payment_status==='PENDING'&&r.due_at&&new Date(r.due_at).getTime()<Date.now())throw new MarketError('주문 결제 시간이 만료되었습니다.',409);await tx.query('INSERT INTO mkt_payments(order_id,payment_key,status,amount) VALUES($1,$2,$3,$4) ON CONFLICT(order_id) DO NOTHING',[id,key,'VERIFYING',amount]);if(r.payment_status==='PENDING'&&!old?.payment_key)await tx.query("UPDATE mkt_orders SET due_at=now()+interval '10 minutes' WHERE id=$1",[id]);});
 // The DB and PG have no shared transaction. Persist the verified key before approval; query on every retry.
 if(p.status==='IN_PROGRESS'){const latest=await getOrder(db,id,token);if(latest.dueAt&&new Date(latest.dueAt).getTime()<Date.now())throw new MarketError('새 결제 승인은 만료되었습니다. 기존 결제 결과 대사는 계속 가능합니다.',409);p=await pg('/confirm',{paymentKey:key,orderId:id,amount},`confirm:${id}`);}
 validate(p,id,amount);await persist(db,p);return {order:await getOrder(db,id,token)};
}
export async function paymentWebhook(db:Database,input:Record<string,unknown>){
 const payload=input.eventType==='PAYMENT_STATUS_CHANGED'?input.data as Record<string,unknown>:input;if(!payload||typeof payload!=='object')throw new MarketError('웹훅 본문을 확인해주세요.');
 const id=textValue(payload.orderId,'주문',100),r=(await db.query<{payment_key:string|null;deposit_secret:string|null;amount:number}>('SELECT payment_key,deposit_secret,amount FROM mkt_payments WHERE order_id=$1',[id])).rows[0];if(!r?.payment_key||!r.deposit_secret||typeof payload.secret!=='string'||!equal(unseal(r.deposit_secret),payload.secret))throw new MarketError('가상계좌 웹훅 검증에 실패했습니다.',403);
 const p=await pg(`/${encodeURIComponent(r.payment_key)}`);validate(p,id,r.amount);await persist(db,p);return {received:true};
}
export async function reconcilePayments(db:Database){const rows=(await db.query<{order_id:string;payment_key:string}>(`SELECT p.order_id,p.payment_key FROM mkt_payments p JOIN mkt_orders o ON o.id=p.order_id WHERE o.payment_status IN ('PENDING','WAITING_FOR_DEPOSIT') AND o.is_demo=false ORDER BY o.created_at LIMIT 50`)).rows;let reconciled=0,failed=0;for(const r of rows){try{const p=await pg(`/${encodeURIComponent(r.payment_key)}`);await persist(db,p);reconciled++;}catch{failed++;await audit(db,'payment.reconcile_required',r.order_id);}}return {reconciled,failed};}
