import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {editPersonalMail, gmailRaw, listPersonalMail, mailDraft, runPersonalMail} from '../src/lib/personal-mail';
import {personalAgenda} from '../src/lib/personal-agenda';

test('personal Gmail scheduling isolates principal, claims once, and demands review after uncertain transmission',async t=>{
  const owner='99ba882a-9152-4d90-84cf-65035dfd7b29';
  const guest='62320139-42e9-437f-b65a-ac0ffadf16f4';
  const db=new PGlite(), global=globalThis as typeof globalThis & {nhPool?:unknown};
  const prior=global.nhPool, priorURL=process.env.DATABASE_URL;
  process.env.DATABASE_URL='postgres://synthetic.invalid/workspace';
  global.nhPool={query:async (sql:string,args:unknown[]=[])=>{
    const result=await db.query(sql,args);
    return {...result,rowCount:result.rows.length||result.affectedRows};
  }};
  t.after(async()=>{
    global.nhPool=prior;
    if(priorURL===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=priorURL;
    await db.close();
  });
  await db.exec("CREATE TABLE nh_documents(workspace text,kind text,id text,data jsonb,updated timestamptz DEFAULT now(),PRIMARY KEY(workspace,kind,id))");
  const ownerEmail='owner@example.invalid',guestEmail='guest@example.invalid';
  const base={to:'reader@example.invalid',subject:'한국어 일정 안내'.repeat(9),body:'첫째 줄\n둘째 줄'};
  assert.throws(()=>mailDraft({...base,to:'reader@example.invalid\r\nBcc: outsider@example.invalid'}));
  assert.throws(()=>mailDraft({...base,subject:'hello\nCC: unauthorized'}));
  const raw=Buffer.from(gmailRaw(base),'base64url').toString('utf8');
  assert(raw.startsWith('To: '+base.to+'\r\nSubject: =?UTF-8?B?'));
  assert(raw.includes('\r\n '));
  assert.equal(Buffer.from(raw.split('\r\n\r\n')[1],'base64').toString('utf8'),base.body);

  const draft=await editPersonalMail(owner,{action:'draft',...base},ownerEmail);
  const other=await editPersonalMail(guest,{action:'draft',...base,subject:'다른 계정 메일'},guestEmail);
  assert.deepEqual((await listPersonalMail(owner)).map(d=>d.id),[draft.id]);
  assert.equal((await listPersonalMail(owner))[0].subject,base.subject);
  assert.deepEqual((await listPersonalMail(guest)).map(d=>d.id),[other.id]);
  await assert.rejects(()=>editPersonalMail(guest,{action:'draft',id:draft.id,version:1,...base},guestEmail),{status:404});
  await assert.rejects(()=>editPersonalMail(owner,{action:'schedule',id:draft.id,version:1,approved:false,at:new Date(Date.now()+60_000).toISOString()},ownerEmail),{status:400});
  await assert.rejects(()=>editPersonalMail(owner,{action:'draft',id:draft.id,version:9,...base},ownerEmail),{status:409});

  async function scheduled(actor:string,title:string,delta=-1000) {
    const id=randomUUID(),stamp=new Date().toISOString();
    const scheduledAt=new Date(Date.now()+delta).toISOString();
    const record={...base,subject:title,id,ownerId:actor,ownerEmail:actor===owner?ownerEmail:guestEmail,status:'scheduled',version:1,scheduledAt,createdAt:stamp,updatedAt:stamp,connectionId:'fixture-connection'};
    await db.query("INSERT INTO nh_documents(workspace,kind,id,data) VALUES('live','personal-mail-item',$1,$2)",[actor+':'+id,JSON.stringify(record)]);
    return id;
  }
  const ok=await scheduled(owner,'예약 성공 테스트');
  const lost=await scheduled(owner,'응답 유실 테스트');
  const denied=await scheduled(guest,'승인 철회 테스트');
  await scheduled(guest,'지인의 미래 일정',60_000);
  assert.deepEqual(await personalAgenda(owner),[]);
  assert.equal((await personalAgenda(guest))[0].title,'지인의 미래 일정');

  let sent=0, calls=0;
  const runner={
    canRun:async (actor:string,email:string)=>actor===owner&&email===ownerEmail,
    token:async (actor:string,id:string)=>{
      assert.equal(actor,owner);assert.equal(id,'fixture-connection');return 'synthetic-token';
    },
    request:(async (url:string,options:RequestInit)=>{
      calls++;assert.equal(url,'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
      assert.equal(options.redirect,'error');
      const text=Buffer.from(JSON.parse(String(options.body)).raw,'base64url').toString();
      const match=text.match(/Subject: =\?UTF-8\?B\?([^?]+)/);
      assert(match);
      const subject=Buffer.from(match[1],'base64').toString();
      if(subject==='응답 유실 테스트')throw Error('synthetic lost response');
      sent++;return Response.json({id:'synthetic-provider-id'});
    }) as typeof fetch,
  };
  const result=await Promise.all([runPersonalMail(runner),runPersonalMail(runner)]);
  assert.equal(result.reduce((n,row)=>n+row.checked,0),3);
  assert.equal(sent,1);
  assert.equal(calls,2);
  assert.deepEqual(await runPersonalMail(runner),{checked:0,sent:0,review:0});
  const my=(await listPersonalMail(owner)), their=(await listPersonalMail(guest));
  assert.equal(my.find(d=>d.id===ok)?.status,'sent');
  assert.equal(my.find(d=>d.id===lost)?.status,'review');
  assert.equal(their.find(d=>d.id===denied)?.status,'review');
  assert.equal(my.find(d=>d.id===lost)?.retryable,false);
  assert.equal(their.find(d=>d.id===denied)?.retryable,true);
  assert.equal(await editPersonalMail(owner,{action:'schedule',id:lost,version:3,approved:true,at:new Date(Date.now()+60_000).toISOString()},ownerEmail).catch(error=>error.message),'현재 상태에서 예약할 수 없습니다.');
  assert.equal(JSON.stringify(my).includes('synthetic-provider-id'),false);
});
