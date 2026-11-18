import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {NextRequest} from 'next/server';
import {GET as list, POST as save} from '../src/app/api/personal/route';
import {POST as review} from '../src/app/api/access/route';
import {GET as business, POST as changeBusiness} from '../src/app/api/dashboard/[...route]/route';
import {GET as authStatus, POST as login} from '../src/app/api/auth/route';
import {GET as dashboard} from '../src/app/dashboard/route';
import {requestOneAccess} from '../src/lib/auth';
import {context} from '../src/server/context.cjs';

const origin = 'https://personal.example.invalid';
const identity = (last: number, name: string) => ({
  id: '1d8af025-86e5-4ef0-8fc5-075f6a37000' + last,
  email: name + '@example.invalid',
  email_confirmed_at: '2026-11-19T00:00:00.000Z',
});
const users = {
  owner: identity(1, 'owner'),
  first: identity(2, 'first'),
  second: identity(3, 'second'),
  viewer: identity(4, 'viewer'),
  unconfirmed: {...identity(5, 'unconfirmed'), email_confirmed_at: undefined},
  anonymous: {...identity(6, 'anonymous'), is_anonymous: true},
};
const environment = {
  DATABASE_URL: 'postgres://test-only',
  MARKET_MODE: 'test',
  MARKET_ORIGIN: origin,
  SUPABASE_URL: 'https://auth-personal.example.invalid',
  SUPABASE_PUBLISHABLE_KEY: 'test-only',
  SESSION_SECRET: 'local-only-personal-workspace-check-secret',
  SUPABASE_SERVICE_ROLE_KEY: 'test-only',
  OPERATOR_USER_ID: users.owner.id,
  OPERATOR_EMAIL: users.owner.email,
};
const itemId = 'e2f65df0-a47e-4495-a042-fa722f429474';
const account = (name: string) => users[name as keyof typeof users];
const req = (path: string, who = '', payload?: object, from = origin, expectedId?: string) => new NextRequest(origin + path, {
  method: payload ? 'POST' : 'GET',
  headers: {
    Origin: from,
    'Content-Type': 'application/json',
    ...(who ? {Cookie: 'nh_access=' + who} : {}),
    ...(expectedId ? {'X-Personal-Account': expectedId} : {}),
  },
  ...(payload ? {body: JSON.stringify(payload)} : {}),
});
const personalGet = (who = '', query = '') => list(req('/api/personal' + query, who));
const personalSave = (who: string, payload: object, from?: string, expectedId = account(who)?.id) =>
  save(req('/api/personal', who, payload, from, expectedId));
const route = (part: string) => ({params: Promise.resolve({route: [part]})});
const state = async (who: string, query?: string) => {
  const response = await personalGet(who, query);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  return response.json();
};
const saved = async (who: string, input: object) => {
  const response = await personalSave(who, input);
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  return (await response.json()).item;
};

test('personal scope is explicit, account data stays private, and a revoke stops the next request', async () => {
  const db = new PGlite();
  const g = globalThis as typeof globalThis & {nhPool?: unknown};
  const previousPool = g.nhPool;
  const previousFetch = globalThis.fetch;
  const previousEnv = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  const query = async (sql: string, args: unknown[] = []) => {
    const result = await db.query(sql, args);
    return {...result, rowCount: result.affectedRows ?? result.rows.length};
  };
  const versionOf = async (id: string) => (await db.query<{version: string}>(
    "SELECT updated::text AS version FROM nh_documents WHERE workspace='live' AND kind='access' AND id=$1", [id],
  )).rows[0].version;
  const moderate = async (action: string, who: 'first' | 'second' | 'viewer', extra: object = {}, reviewer = 'owner') =>
    review(req('/api/access', reviewer, {id: users[who].id, action, version: await versionOf(users[who].id), ...extra}));

  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE nh_web;');
    await db.exec(await readFile('db/dashboard.sql', 'utf8'));
    g.nhPool = {query, connect: async () => ({query, release() {}})};
    Object.assign(process.env, environment);
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.origin, environment.SUPABASE_URL);
      if (url.pathname === '/auth/v1/token') {
        const person = Object.entries(users).find(([, person]) => person.email === JSON.parse(String(init?.body)).email);
        assert.ok(person);
        return Response.json({access_token: person[0], refresh_token: 'fixture-refresh', expires_in: 3600});
      }
      const token = new Headers(init?.headers).get('Authorization')?.slice(7) ?? '';
      const user = url.pathname === '/auth/v1/user' ? account(token) : Object.values(users).find(user => url.pathname === '/auth/v1/admin/users/' + user.id);
      return user ? Response.json(user) : new Response(null, {status: 401});
    };

    const unauthenticated = await personalGet();
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticated.headers.get('Cache-Control'), 'private, no-store');
    assert.equal((await personalGet('unconfirmed')).status, 403);
    assert.equal((await personalGet('anonymous')).status, 403);
    assert.equal((await personalGet('unknown-cookie')).status, 401);
    assert.equal((await personalGet('first')).status, 403);
    await requestOneAccess(users.first);
    await requestOneAccess(users.second);
    await db.query("INSERT INTO nh_documents VALUES('live','access',$1,$2,now())", [
      users.viewer.id, JSON.stringify({status: 'approved', email: users.viewer.email}),
    ]);
    assert.equal((await moderate('approve', 'second', {}, 'first')).status, 403);
    assert.equal((await moderate('approve', 'second', {action: ['approve']})).status, 400);
    assert.equal((await personalSave('first', {action: 'create', kind: 'task', title: 'pending'})).status, 403);

    const firstApproval = await moderate('approve', 'first');
    assert.equal(firstApproval.status, 200);
    assert.equal((await firstApproval.json()).request.scope, 'personal');
    assert.equal((await moderate('approve', 'second', {scope: 'personal'})).status, 200);
    assert.equal((await personalGet('viewer')).status, 403);
    assert.equal((await business(req('/api/dashboard/session', 'viewer'), route('session'))).status, 200);
    assert.equal((await business(req('/api/dashboard/state', 'first'), route('state'))).status, 403);
    assert.equal((await changeBusiness(req('/api/dashboard/task', 'first', {title: 'cross-scope'}), route('task'))).status, 403);
    const redirected = await dashboard(req('/dashboard', 'first'));
    assert.equal(redirected.headers.get('Location'), '/personal');
    const personalAuth = await authStatus(req('/api/auth?portal=one', 'first'));
    assert.equal((await personalAuth.json()).destination, '/personal');
    const signedIn = await login(req('/api/auth', '', {action: 'login', email: users.first.email, password: 'safe-fixture', portal: 'one'}));
    assert.equal((await signedIn.json()).destination, '/personal');
    const marketplace = await authStatus(req('/api/auth?portal=market', 'first'));
    assert.equal((await marketplace.json()).destination, '/nurimarket');
    assert.deepEqual(await state('owner'), {account: {id: users.owner.id, email: users.owner.email, owner: true}, items: [], agenda: []});

    const create = {action: 'create', id: itemId, kind: 'task', title: '개인 작업', detail: '개인 메모', dueOn: '2026-11-20', ownerId: users.owner.id, actorId: users.second.id};
    assert.equal((await personalSave('first', create, origin, '')).status, 409, 'writes require a loaded account');
    assert.equal((await personalSave('second', create, origin, users.first.id)).status, 409, 'an older tab cannot modify a new session');
    const first = await saved('first', create);
    assert.deepEqual(Object.keys(first).sort(), ['createdAt', 'detail', 'done', 'dueOn', 'dueTime', 'id', 'kind', 'title', 'updatedAt', 'version']);
    assert.equal(first.version, 1);
    assert.equal(first.dueOn, '2026-11-20');
    assert.deepEqual(await saved('first', create), first, 'a retry with the same id and contents is idempotent');
    assert.equal((await personalSave('first', {...create, detail: '실수로 중복 ID 사용'})).status, 409);
    assert.deepEqual((await state('owner', '?userId=' + users.first.id)).items, []);
    assert.deepEqual((await state('second', '?ownerId=' + users.first.id)).items, []);
    for (const who of ['owner', 'second']) {
      for (const action of ['update', 'complete', 'remove']) {
        const rejected = await personalSave(who, {action, id: itemId, version: 1, ownerId: users.first.id, title: '교차 변경'});
        assert.equal(rejected.status, 404);
        assert.equal(rejected.headers.get('Cache-Control'), 'private, no-store');
      }
    }

    const sameId = await saved('second', {action: 'create', id: itemId, kind: 'note', title: '둘째의 노트'});
    assert.equal(sameId.id, first.id);
    assert.deepEqual((await state('second')).items, [sameId]);
    assert.deepEqual((await state('first')).items, [first]);
    const starts = await Promise.all([
      personalSave('first', {action: 'complete', id: itemId, version: 1}),
      personalSave('first', {action: 'update', id: itemId, version: 1, title: '최신 입력'}),
    ]);
    assert.deepEqual(starts.map(r => r.status).sort(), [200, 409]);
    assert.equal((await state('first')).items[0].version, 2);
    const completed = await saved('first', {action: 'complete', id: itemId, version: 2});
    assert.equal(completed.done, true);
    const newState = await saved('first', {action: 'complete', id: itemId, version: completed.version, done: false});
    assert.equal(newState.done, false);
    assert.equal((await personalSave('first', {action: 'remove', id: itemId, version: 1})).status, 409);
    assert.equal((await personalSave('second', {action: 'remove', id: itemId, version: 1}, 'https://foreign.example.invalid')).status, 403);
    assert.equal((await personalSave('second', {action: 'remove', id: itemId, version: 1})).status, 200);
    assert.deepEqual((await state('second')).items, []);
    assert.equal((await state('first')).items.length, 1);

    for (const invalid of [
      {kind: 'schedule', dueOn: '2026-02-30'},
      {kind: 'schedule'},
      {kind: 'schedule', dueOn: '2026-11-20', dueTime: '24:00'},
      {kind: 'note', dueOn: false},
      {kind: 'link', detail: 'javascript:alert(0)'},
      {kind: 'link', detail: 'http://example.invalid/'},
      {kind: 'link', detail: 'https:///example.invalid/'},
      {kind: 'link', detail: 'https://user:password@example.invalid/'},
    ]) {
      assert.equal((await personalSave('owner', {action: 'create', title: '거절할 값', ...invalid})).status, 400);
    }
    const schedule = await saved('owner', {action: 'create', kind: 'schedule', title: '일정', dueOn: '2026-11-20', dueTime: '09:05'});
    const link = await saved('owner', {action: 'create', kind: 'link', title: '참고 링크', detail: 'https://example.invalid'});
    assert.equal(schedule.dueTime, '09:05');
    assert.equal(link.detail, 'https://example.invalid/');
    const ownData = await db.query<{owner_id: string; id: string}>("SELECT data->>'ownerId' AS owner_id,id FROM nh_documents WHERE kind='personal-item'");
    assert.equal(ownData.rows.length, 3);
    assert.ok(ownData.rows.every(row => row.id.startsWith(row.owner_id + ':')));
    const spoofedRecordId = 'e84b1af6-a499-4929-a74e-e90d37a3ea76';
    await db.query("INSERT INTO nh_documents VALUES('live','personal-item',$1,$2,now())", [
      users.first.id + ':' + spoofedRecordId, JSON.stringify({ownerId: users.owner.id, ...newState}),
    ]);
    assert.deepEqual((await state('first')).items, [newState], 'the id prefix and ownership field must both match');
    assert.deepEqual((await state('owner')).items.map((row: {id: string}) => row.id).sort(), [link.id, schedule.id].sort());

    const businessWorkspace = await context('live');
    assert.deepEqual(businessWorkspace.list('personal-item'), []);
    assert.equal(businessWorkspace.get('personal-item', users.first.id + ':' + itemId), null);

    await db.exec('SET ROLE nh_web');
    try {
      assert.deepEqual((await state('first')).items, [newState]);
    } finally {
      await db.exec('RESET ROLE');
    }

    for (const role of ['anon', 'authenticated']) {
      await db.exec('SET ROLE ' + role);
      try {
        await assert.rejects(db.query('SELECT data FROM nh_documents'), /permission denied/);
      } finally {
        await db.exec('RESET ROLE');
      }
    }

    const revoked = await moderate('revoke', 'first');
    assert.equal(revoked.status, 200);
    assert.equal((await personalGet('first')).status, 403);
    assert.equal((await personalSave('first', {action: 'remove', id: itemId, version: 2})).status, 403);
    assert.equal((await dashboard(req('/dashboard', 'first'))).headers.get('Location'), '/access-pending');
    assert.equal((await moderate('approve', 'first', {scope: 'business'})).status, 200);
    assert.equal((await personalGet('first')).status, 403, 'switching to a business-only grant does not activate personal data');
    assert.equal((await business(req('/api/dashboard/session', 'first'), route('session'))).status, 200);
    assert.equal((await moderate('approve', 'first', {scope: 'personal'})).status, 200);
    assert.deepEqual((await state('first')).items, [newState]);
  } finally {
    globalThis.fetch = previousFetch;
    g.nhPool = previousPool;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await db.close();
  }
});
