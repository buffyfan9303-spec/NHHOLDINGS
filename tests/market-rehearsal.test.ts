import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createDatabase} from '../src/lib/db';
import {applyPayment,catalog,createOrder,customerAction,getOrder,prepare,registerShipment,replyInquiry,resolveClaim,shipmentStatus} from '../src/lib/commerce';

test('상품 공개 전 격리 주문·문의·배송·미결제 취소 점검',async()=>{
  // The test runner isolates this environment from the application server.
  Object.assign(process.env,{NODE_ENV:'test',MARKET_MODE:'preview',SEED_DEMO_DATA:'true',
    DATABASE_URL:'postgres://invalid.test/rehearsal-must-not-connect',SESSION_SECRET:'synthetic-only-enough-length-for-market-rehearsal'});
  const directory=await mkdtemp(path.join(tmpdir(),'nuri-market-rehearsal-'));
  try {
    const db=await createDatabase(directory);
    try {
      const item=(await catalog(db)).products.find(product=>product.sample&&product.published&&product.variants.some(variant=>variant.stock>=2));
      const variant=item?.variants.find(variant=>variant.stock>=2);
      assert(variant,'격리 상품과 재고');
      const input=()=>({requestId:randomUUID(),checkoutToken:randomUUID()+randomUUID(),lines:[{variantId:variant.id,quantity:1}],method:'CARD',
        customer:{name:'리허설',phone:'01000000000',email:'rehearsal@example.invalid',postcode:'12345',address:'격리 검증 주소',addressDetail:'리허설',note:''},
        consent:{terms:true,privacy:true,marketing:false,version:'2026-10-07'}});
      const purchase=await createOrder(db,input());
      assert(purchase.mode==='preview'&&purchase.pgClientKey===null&&purchase.order.isDemo&&purchase.order.shipping>=0,'합성 주문과 배송비 계산');
      await customerAction(db,{action:'inquiry',orderId:purchase.order.id,subject:'리허설 문의',content:'출고 상태를 확인합니다.'},purchase.accessToken);
      const query=(await getOrder(db,purchase.order.id,purchase.accessToken)).inquiries?.[0];
      if(query)await replyInquiry(db,{inquiryId:query.id,reply:'리허설 답변',expectedReply:''});
      assert.equal((await getOrder(db,purchase.order.id,purchase.accessToken)).inquiries?.[0]?.reply,'리허설 답변','문의 등록·답변 조회');
      // Only the local state machine receives a synthetic payment event.
      await applyPayment(db,purchase.order.id,'PAID','rehearsal-payment');
      await prepare(db,purchase.order.id);
      await registerShipment(db,{orderNumber:purchase.order.number,carrier:'CJ',trackingNumber:'123456789012'});
      const shipment=(await getOrder(db,purchase.order.id)).shipments[0];
      await shipmentStatus(db,shipment.id,'SHIPPED','리허설 집하');
      await shipmentStatus(db,shipment.id,'DELIVERED','리허설 배송 완료');
      assert.equal((await getOrder(db,purchase.order.id)).fulfillmentStatus,'DELIVERED','출고 준비·송장·배송 완료');
      const cancel=await createOrder(db,input());
      await customerAction(db,{action:'claim',orderId:cancel.order.id,type:'CANCEL',reason:'리허설 취소',
        items:[{itemId:cancel.order.items[0].id,quantity:1}]},cancel.accessToken);
      const claim=(await getOrder(db,cancel.order.id)).claims[0];
      await resolveClaim(db,{claimId:claim.id,status:'APPROVED',reason:'미결제 리허설 취소'});
      const result=await getOrder(db,cancel.order.id);
      const stock=(await catalog(db)).products.flatMap(product=>product.variants).find(v=>v.id===variant.id);
      assert(result.paymentStatus==='EXPIRED'&&result.claims[0].status==='COMPLETED'&&stock?.reserved===0,'미결제 취소와 재고 점유 해제');
    } finally {
      await db.close();
    }
  } finally {
    await rm(directory,{recursive:true,force:true});
  }
});
