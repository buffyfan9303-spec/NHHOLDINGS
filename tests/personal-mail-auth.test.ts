import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {NextRequest} from 'next/server';
import {GET as callback} from '../src/app/api/personal/mail/oauth/route';
import {disconnectMail, mailAccessToken, mailConnection, saveMailApp, setMailPaused, startMailAuth} from '../src/lib/personal-mail-auth';

test('personal Gmail uses send-only one-time OAuth and finishes only for the active selected connection', async t => {
  const origin = 'https://personal.example.invalid';
  const scope = 'https://www.googleapis.com/auth/gmail.send';
  const clientId = 'synthetic.apps.googleusercontent.com';
  const clientSecret = 'synthetic-client-secret';
  const owner = {id: 'owner-a', email: 'owner@example.invalid', email_confirmed_at: '2026-11-19'};
  const guest = {id: 'guest-b', email: 'guest@example.invalid', email_confirmed_at: '2026-11-19'};
  const keys = ['MARKET_ORIGIN', 'OPERATOR_EMAIL', 'OPERATOR_USER_ID', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY',
    'SESSION_SECRET', 'DATABASE_URL', 'PERSONAL_MAIL_CLIENT_ID', 'PERSONAL_MAIL_CLIENT_SECRET', 'ALLOWED_ORIGINS', 'VERCEL_URL'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const g = globalThis as typeof globalThis & {nhPool?: unknown};
  const previousPool = g.nhPool;
  const db = new PGlite();
  t.after(async () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    g.nhPool = previousPool;
    await db.close();
  });
  Object.assign(process.env, {MARKET_ORIGIN: origin, OPERATOR_EMAIL: owner.email, OPERATOR_USER_ID: owner.id,
    SUPABASE_URL: 'https://auth.example.invalid', SUPABASE_PUBLISHABLE_KEY: 'mock', DATABASE_URL: 'postgres://local-test',
    SESSION_SECRET: 'test-personal-mail-32-character-session-key'});
  delete process.env.PERSONAL_MAIL_CLIENT_ID;
  delete process.env.PERSONAL_MAIL_CLIENT_SECRET;
  delete process.env.ALLOWED_ORIGINS;
  delete process.env.VERCEL_URL;
  await db.exec("CREATE TABLE nh_documents(workspace text,kind text,id text,data jsonb,updated timestamptz DEFAULT now(),PRIMARY KEY(workspace,kind,id))");
  await db.query("INSERT INTO nh_documents(workspace,kind,id,data) VALUES('live','access',$1,$2)", [guest.id,
    JSON.stringify({email: guest.email, status: 'approved', scope: 'personal'})]);
  g.nhPool = {query: async (query: string, args: unknown[] = []) => {
    const result = await db.query(query, args);
    return {...result, rowCount: result.rows.length || result.affectedRows};
  }};
  const jwt = (actor: string, session = '6d41a99a-a317-45d5-8c41-b031ca1eef6a') =>
    'e30.' + Buffer.from(JSON.stringify({sub: actor, session_id: session})).toString('base64url') + '.stub';
  const post = (startOrigin = origin) => new NextRequest(origin + '/api/personal/mail', {method: 'POST',
    headers: {Origin: startOrigin, Cookie: 'nh_access=' + jwt(owner.id)}});
  let pendingConsent: URL | undefined;
  let exchanged = 0, refreshed = 0;
  t.mock.method(globalThis, 'fetch', async (input: string, init?: RequestInit) => {
    if (input === 'https://auth.example.invalid/auth/v1/user') {
      return Response.json(new Headers(init?.headers).get('Authorization')?.includes(jwt(guest.id)) ? guest : owner);
    }
    assert.equal(input, 'https://oauth2.googleapis.com/token');
    assert.equal(init?.redirect, 'error');
    const form = new URLSearchParams(String(init?.body));
    assert.equal(form.get('client_id'), clientId);
    assert.equal(form.get('client_secret'), clientSecret);
    if (form.get('grant_type') === 'authorization_code') {
      exchanged++;
      assert.equal(createHash('sha256').update(form.get('code_verifier')!).digest('base64url'), pendingConsent?.searchParams.get('code_challenge'));
      assert.equal(form.get('redirect_uri'), origin + '/api/personal/mail/oauth');
      return Response.json({access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_in: 30, token_type: 'Bearer', scope});
    }
    refreshed++;
    assert.equal(form.get('grant_type'), 'refresh_token');
    assert.equal(form.get('refresh_token'), 'synthetic-refresh');
    return Response.json({access_token: 'synthetic-renewed', expires_in: 3600, token_type: 'Bearer'});
  });
  assert.equal((await mailConnection(owner.id)).configured, false);
  assert.equal((await saveMailApp(owner.id, {clientId, clientSecret})).configured, true);
  assert.equal((await mailConnection(guest.id)).configured, false);
  assert.equal(JSON.stringify(await mailConnection(owner.id)).includes(clientSecret), false);
  await assert.rejects(startMailAuth(post('https://other.example.invalid'), owner.id), {status: 403});
  async function connect() {
    const start = await startMailAuth(post(), owner.id);
    pendingConsent = new URL((await start.json()).url);
    assert.equal(pendingConsent.origin, 'https://accounts.google.com');
    assert.equal(pendingConsent.searchParams.get('scope'), scope);
    assert.equal(pendingConsent.searchParams.get('code_challenge_method'), 'S256');
    const cookie = start.cookies.get('nh_personal_mail')!.value;
    const state = pendingConsent.searchParams.get('state');
    const url = origin + '/api/personal/mail/oauth?code=synthetic-code&state=' + state;
    return (actor = owner.id, session?: string) => new NextRequest(url, {
      headers: {Cookie: 'nh_access=' + jwt(actor, session) + '; nh_personal_mail=' + cookie},
    });
  }
  const first = await connect();
  for (const rejected of [first(guest.id), first(owner.id, '86909483-4a27-42b1-bd7d-72d371c97461')]) {
    assert.match((await callback(rejected)).headers.get('location') ?? '', /mail=failed/);
  }
  assert.equal(exchanged, 0);
  assert.match((await callback(first())).headers.get('location') ?? '', /mail=connected/);
  assert.match((await callback(first())).headers.get('location') ?? '', /mail=failed/);
  assert.equal(exchanged, 1);
  const initialId = (await mailConnection(owner.id)).connectionId!;
  assert.ok(initialId);
  await assert.rejects(mailAccessToken(guest.id, initialId), {status: 412});
  await setMailPaused(owner.id, true);
  await assert.rejects(mailAccessToken(owner.id, initialId), {status: 409});
  assert.equal(refreshed, 0);
  await setMailPaused(owner.id, false);
  assert.equal(await mailAccessToken(owner.id, initialId), 'synthetic-renewed');
  assert.equal(refreshed, 1);
  await saveMailApp(owner.id, {clientId, clientSecret: ''});
  assert.equal((await mailConnection(owner.id)).connectionId, initialId);

  const renewed = await connect();
  assert.match((await callback(renewed())).headers.get('location') ?? '', /mail=connected/);
  const renewedId = (await mailConnection(owner.id)).connectionId!;
  assert.notEqual(renewedId, initialId);
  await assert.rejects(mailAccessToken(owner.id, initialId), {status: 412});
  const saved = await db.query("SELECT data FROM nh_documents WHERE kind='personal-mail-auth'");
  for (const forbidden of [clientSecret, 'synthetic-access', 'synthetic-refresh']) {
    assert.equal(JSON.stringify(saved.rows).includes(forbidden), false);
  }
  await disconnectMail(owner.id);
  await assert.rejects(mailAccessToken(owner.id, renewedId), {status: 412});
  assert.equal((await mailConnection(owner.id)).connected, false);
});
