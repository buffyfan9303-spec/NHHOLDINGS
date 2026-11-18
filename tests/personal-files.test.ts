import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import {PGlite} from '@electric-sql/pglite';
import {NextRequest} from 'next/server';
import {GET, POST} from '../src/app/api/personal/files/route';
import {GET as callback} from '../src/app/api/personal/files/oauth/route';
import {driveOAuthCookie, personalFileMaxBytes} from '../src/lib/personal-files';
import {hash} from '../src/lib/security';

test('personal Drive uses scoped one-time OAuth, owner-stamped files and direct upload without exposing Google tokens', async t => {
  const origin = 'https://nuri.test.invalid';
  const owner = {id: 'owner', email: 'owner@example.invalid', email_confirmed_at: '2026-11-19'};
  const guest = {id: 'guest', email: 'guest@example.invalid', email_confirmed_at: '2026-11-19'};
  const clientId = 'test-client.apps.googleusercontent.com';
  const scope = 'https://www.googleapis.com/auth/drive.file';
  const keys = ['MARKET_ORIGIN', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'OPERATOR_EMAIL', 'OPERATOR_USER_ID',
    'PERSONAL_DRIVE_CLIENT_ID', 'PERSONAL_DRIVE_CLIENT_SECRET', 'SESSION_SECRET', 'DATABASE_URL', 'VERCEL_URL', 'ALLOWED_ORIGINS'];
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
  await db.exec("CREATE TABLE nh_documents(workspace text,kind text,id text,data jsonb,updated timestamptz DEFAULT now(),PRIMARY KEY(workspace,kind,id))");
  g.nhPool = {query: async (query: string, args: unknown[] = []) => {
    const result = await db.query(query, args);
    return {...result, rowCount: result.rows.length || result.affectedRows};
  }};
  Object.assign(process.env, {
    MARKET_ORIGIN: origin, SUPABASE_URL: 'https://auth.test.invalid', SUPABASE_PUBLISHABLE_KEY: 'mock',
    OPERATOR_EMAIL: owner.email, OPERATOR_USER_ID: owner.id, DATABASE_URL: 'postgres://mock-only',
    SESSION_SECRET: 'test-only-personal-files-32-character-secret',
  });
  delete process.env.PERSONAL_DRIVE_CLIENT_ID;
  delete process.env.VERCEL_URL;
  delete process.env.ALLOWED_ORIGINS;

  const path = '/api/personal/files';
  const file = {id: 'fixture-file', name: '한글 보고서.pdf', size: '3815483', createdTime: '2026-11-19T00:00:00Z',
    trashed: false, ownedByMe: true, appProperties: {nuriOwner: hash('personal-drive:guest')},
    webContentLink: 'https://drive.google.com/uc?id=fixture-file&export=download', capabilities: {canDownload: true}};
  const other = {...file, id: 'other-file', appProperties: {nuriOwner: hash('personal-drive:owner')}};
  const uploadUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=synthetic-upload';
  const jwt = (id: string, session = '6d41a99a-a317-45d5-8c41-b031ca1eef6a') =>
    'e30.' + Buffer.from(JSON.stringify({sub: id, session_id: session})).toString('base64url') + '.stub';
  let consent: URL | undefined;
  let calls = 0, tokenExchanges = 0, refreshes = 0, uploads = 0;
  let providerHasAccess = true;
  t.mock.method(globalThis, 'fetch', async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    const requestHeaders = new Headers(init?.headers);
    if (url.origin === 'https://auth.test.invalid') {
      return Response.json(requestHeaders.get('Authorization')?.includes(jwt('owner')) ? owner : guest);
    }
    calls++;
    assert.equal(init?.redirect, 'error');
    if (url.href === 'https://oauth2.googleapis.com/token') {
      const form = new URLSearchParams(String(init?.body));
      assert.equal(form.get('client_id'), clientId);
      assert.equal(form.get('client_secret'), 'synthetic-client-secret');
      if (form.get('grant_type') === 'authorization_code') {
        tokenExchanges++;
        assert.equal(form.get('redirect_uri'), origin + path + '/oauth');
        assert.equal(createHash('sha256').update(form.get('code_verifier')!).digest('base64url'), consent?.searchParams.get('code_challenge'));
      } else {
        refreshes++;
        assert.equal(form.get('grant_type'), 'refresh_token');
        assert.equal(form.get('refresh_token'), 'synthetic-refresh-token');
      }
      return Response.json({access_token: 'synthetic-access-token', refresh_token: 'synthetic-refresh-token',
        token_type: 'Bearer', expires_in: tokenExchanges === 1 && refreshes === 0 ? 30 : 3600, scope});
    }
    assert.equal(url.origin, 'https://www.googleapis.com');
    assert.equal(requestHeaders.get('authorization'), 'Bearer synthetic-access-token');
    if (!providerHasAccess) return Response.json({error: 'sensitive-provider-detail'}, {status: 401});
    if (url.pathname === '/drive/v3/files/generateIds') return Response.json({ids: [file.id]});
    if (url.pathname === '/upload/drive/v3/files') {
      uploads++;
      assert.equal(init?.method, 'POST');
      assert.equal(url.searchParams.get('uploadType'), 'resumable');
      assert.equal(requestHeaders.get('X-Upload-Content-Length'), file.size);
      assert.equal(requestHeaders.get('Origin'), origin);
      assert.deepEqual(JSON.parse(String(init?.body)), {id: file.id, name: file.name,
        mimeType: 'application/octet-stream', appProperties: file.appProperties});
      return new Response(null, {headers: {Location: uploadUrl}});
    }
    if (url.pathname === '/drive/v3/files') {
      assert.match(url.searchParams.get('q') ?? '', new RegExp(file.appProperties.nuriOwner));
      assert.equal(url.searchParams.get('orderBy'), 'createdTime desc');
      return Response.json({files: [file, other], nextPageToken: 'next='});
    }
    if (url.pathname === '/drive/v3/files/' + file.id) return Response.json(file);
    if (url.pathname === '/drive/v3/files/' + other.id) return Response.json(other);
    throw new Error('Unexpected provider endpoint');
  });
  await db.query("INSERT INTO nh_documents(workspace,kind,id,data) VALUES('live','access',$1,$2)", [guest.id,
    JSON.stringify({email: guest.email, status: 'approved', scope: 'business'})]);
  function req(search = '', data?: unknown, actor = 'guest', header = actor, more?: Record<string, string>) {
    return new NextRequest(origin + path + search, {method: data ? 'POST' : 'GET',
      headers: {Origin: origin, Cookie: 'nh_access=' + jwt(actor), 'X-Personal-Account': header, ...more},
      ...(data ? {body: JSON.stringify(data)} : {})});
  }
  assert.equal((await GET(new NextRequest(origin + path))).status, 403);
  assert.equal((await GET(req())).status, 403);
  await db.query("UPDATE nh_documents SET data=jsonb_set(data,'{scope}','\"personal\"') WHERE id=$1", [guest.id]);
  assert.equal((await GET(req('', undefined, 'guest', 'owner'))).status, 409);
  const unavailable = await GET(req());
  assert.equal(unavailable.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await unavailable.json(), {configured: false, connected: false, maxBytes: personalFileMaxBytes, files: [], nextPage: null});

  Object.assign(process.env, {PERSONAL_DRIVE_CLIENT_ID: clientId, PERSONAL_DRIVE_CLIENT_SECRET: 'synthetic-client-secret'});
  assert.equal((await (await GET(req())).json()).connected, false);
  assert.equal((await POST(req('', {action: 'connect'}, 'guest', 'guest', {Origin: 'https://different.test.invalid'}))).status, 403);
  assert.equal((await POST(req('', {action: 'connect'}, 'guest', 'owner'))).status, 409);
  const start = await POST(req('', {action: 'connect'}));
  assert.equal(start.status, 200);
  consent = new URL((await start.json()).url);
  assert.equal(consent.origin, 'https://accounts.google.com');
  assert.equal(consent.searchParams.get('scope'), scope);
  assert.equal(consent.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(consent.searchParams.get('include_granted_scopes'), 'false');
  const cookie = start.cookies.get(driveOAuthCookie)!.value;
  const state = consent.searchParams.get('state');
  function callbackRequest(value: string, actor = 'guest', alternateSession?: string) {
    return req('/oauth?code=synthetic-code&state=' + value, undefined, actor, actor, {
      Cookie: 'nh_access=' + jwt(actor, alternateSession) + '; ' + driveOAuthCookie + '=' + cookie,
    });
  }
  for (const rejected of [callbackRequest('bad-name'), callbackRequest(state!, 'owner'),
    callbackRequest(state!, 'guest', '86909483-4a27-42b1-bd7d-72d371c97461')]) {
    assert.match((await callback(rejected)).headers.get('location') ?? '', /drive=failed/);
  }
  assert.equal(calls, 0);
  assert.match((await callback(callbackRequest(state!))).headers.get('location') ?? '', /drive=connected/);
  assert.match((await callback(callbackRequest(state!))).headers.get('location') ?? '', /drive=failed/);
  assert.equal(tokenExchanges, 1, 'OAuth state can only be used once');
  const rows = await db.query("SELECT data FROM nh_documents WHERE kind='personal-drive'");
  assert.equal(JSON.stringify(rows.rows).includes('synthetic-refresh-token'), false);
  assert.equal(JSON.stringify(rows.rows).includes('synthetic-access-token'), false);

  const listed = await (await GET(req())).json();
  assert.deepEqual(listed, {configured: true, connected: true, maxBytes: personalFileMaxBytes, files: [
    {id: file.id, name: file.name, bytes: 3815483, createdAt: file.createdTime},
  ], nextPage: 'next='});
  assert.equal(refreshes, 1, 'expired access is refreshed using the saved encrypted token');
  assert.equal((await (await GET(req('', undefined, 'owner'))).json()).connected, false);
  assert.equal((await GET(req('?download=' + other.id))).status, 404);
  assert.deepEqual(await (await GET(req('?download=' + file.id))).json(), {url: file.webContentLink});
  assert.equal((await POST(req('', {action: 'upload', name: file.name, bytes: personalFileMaxBytes + 1}))).status, 413);
  const started = await POST(req('', {action: 'upload', name: file.name, bytes: Number(file.size)}));
  assert.equal(started.status, 201);
  const begun = await started.json();
  assert.equal(begun.url, uploadUrl);
  assert.equal(begun.id, file.id);
  assert.deepEqual(begun.headers, {'Content-Type': 'application/octet-stream'});
  assert.equal(JSON.stringify(begun).includes('token'), false);
  assert.equal((await (await GET(req('?status=' + file.id))).json()).file.bytes, 3815483);
  assert.equal(uploads, 1);

  providerHasAccess = false;
  const disconnected = await (await GET(req())).json();
  assert.equal(disconnected.connected, false);
  assert.equal(JSON.stringify(disconnected).includes('sensitive-provider-detail'), false);
  await db.query("UPDATE nh_documents SET data=jsonb_set(data,'{status}','\"revoked\"') WHERE id=$1", [guest.id]);
  const before = calls;
  assert.equal((await GET(req('?download=' + file.id))).status, 403);
  assert.equal(calls, before, 'revoked account must never reach Google');
});

test('personal file sizes render with one decimal at most', async () => {
  const window = {} as {NuriPersonalFiles: {formatSize: (value: number) => string}};
  vm.runInNewContext(await readFile('public/one/personal-files.js', 'utf8'), {window});
  const format = window.NuriPersonalFiles.formatSize;
  assert.equal(format(3_815_483), '3.8 MB');
  assert.equal(format(1_000_000), '1 MB');
  assert.equal(format(999_999), '1 MB');
  assert.equal(format(1_450), '1.5 KB');
  assert.equal(format(0), '0 B');
  assert.equal(format(personalFileMaxBytes), '100 MB');
});
