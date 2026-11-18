import test from 'node:test';
import assert from 'node:assert/strict';
import {marketRehearsal} from '../src/lib/market-rehearsal';

test('운영 환경에서도 격리 리허설은 테스트 상품·주문·문의·배송·취소만 실행한다',async()=>{
 const prior=process.env.NODE_ENV;
 Object.assign(process.env,{NODE_ENV:'production',DATABASE_URL:'postgres://invalid.test/rehearsal-must-not-connect',SEED_DEMO_DATA:'false',SESSION_SECRET:'synthetic-only-enough-length-for-market-rehearsal'});
 try{
  const result=await marketRehearsal();
  assert.equal(result.checks.length,5);
  assert(result.checks.every(check=>check.ok));
  assert(!JSON.stringify(result).includes('checkoutToken'));
 }finally{
  if(prior===undefined)Reflect.deleteProperty(process.env,'NODE_ENV');else Object.assign(process.env,{NODE_ENV:prior});
 }
});
