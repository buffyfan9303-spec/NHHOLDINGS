'use strict';

const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {randomUUID} = require('node:crypto');
const {PGlite} = require('@electric-sql/pglite');
const {context} = require('../src/server/context.cjs');
const {controller} = require('../src/server/dashboard.cjs');

async function main() {
  const db = new PGlite();
  const fetchOriginal = globalThis.fetch;
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE nh_web;');
    await db.exec(readFileSync('db/dashboard.sql', 'utf8'));
    process.env.DATABASE_URL = 'postgres://test.invalid/studio-library';
    process.env.SESSION_SECRET = 'synthetic-studio-library-encryption-key';
    globalThis.nhPool = {
      async query(sql, args) {
        const result = await db.query(sql, args);
        return {...result, rowCount: result.rows.length || result.affectedRows};
      },
      async connect() {return {...this, release() {}};},
    };
    globalThis.fetch = () => {throw new Error('Studio library must not fetch remote assets');};
    const owner = randomUUID();
    const otherOwner = randomUUID();
    const drafts = '/api/studio/work-drafts';
    const assets = '/api/studio/assets';
    async function call(path, input, expected, actorId = owner, demo = false) {
      const app = await controller({actorId, demo});
      const route = path.split('?')[0];
      const method = input === undefined ? 'GET' : 'POST';
      const response = await app.handle({url: `http://fixture.test${path}`, method}, route, input || {}, 'operator@example.test');
      const value = await response.json();
      assert.equal(response.status, expected, JSON.stringify(value).slice(0, 260));
      assert.match(response.headers.get('Cache-Control'), /no-store/);
      return value;
    }

    const ctx = await context('live');
    const scheduled = {service: 'tistory', business: 'platform', status: 'scheduled', version: 4, title: '예약 원고',
      body: '원본', channel: 'blog', approval: {key: 'fixture'}, scheduledAt: '2026-12-01T00:00:00.000Z'};
    await ctx.put('content', 'scheduled', scheduled);
    await ctx.put('content', 'other-service', {...scheduled, service: 'crm'});
    const key = `new:${randomUUID()}`;
    const snapshot = {id: '', title: '  비공개   ', body: '첫 문장\n\n다음 문장', channel: 'blog', sources: '입력 도중인 출처', affiliate: false};
    assert.deepEqual(await call(drafts, undefined, 200), {drafts: []});
    await call(drafts, undefined, 401, null);
    const first = (await call(drafts, {key, version: 0, snapshot: {...snapshot, status: 'published', secret: 'ignored field'}}, 200)).draft;
    assert.equal(first.version, 1);
    assert.equal(first.snapshot.title, snapshot.title);
    assert.equal(first.snapshot.sources, snapshot.sources);
    assert(!Object.hasOwn(first.snapshot, 'status'));
    assert(!Object.hasOwn(first.snapshot, 'secret'));
    assert.deepEqual(await call(drafts, undefined, 200, otherOwner), {drafts: []});
    assert.deepEqual(await call(drafts, undefined, 200, owner, true), {drafts: []});
    await call(`${drafts}?key=${key}`, undefined, 404, otherOwner);
    await call(`${drafts}?key=${key}`, undefined, 404, owner, true);
    const index = (await call(drafts, undefined, 200)).drafts;
    assert.equal(index[0].title, snapshot.title);
    assert(!Object.hasOwn(index[0], 'snapshot'));
    assert.deepEqual((await call(`${drafts}?key=${key}`, undefined, 200)).draft, first);

    const deviceA = (await call(drafts, {key, version: 1, snapshot: {...snapshot, title: 'A 기기 저장'}}, 200)).draft;
    const stale = await call(drafts, {key, version: 1, snapshot: {...snapshot, title: 'B 기기 저장'}}, 409);
    assert.deepEqual(stale.draft, deviceA);
    const copyKey = `new:${randomUUID()}`;
    const copy = (await call(drafts, {key: copyKey, version: 0, snapshot: {...snapshot, title: 'B 사본'}}, 200)).draft;
    assert.equal(copy.version, 1);
    assert.deepEqual((await call(`${drafts}?key=${key}`, undefined, 200)).draft, deviceA);
    assert.equal((await call(drafts, {key, version: stale.draft.version, snapshot}, 200)).draft.version, 3);
    await call(drafts, {key: `new:${randomUUID()}`, version: -1, snapshot}, 400);
    await call(drafts, {key: `new:${randomUUID()}`, version: 0, snapshot: {...snapshot, body: '일'.repeat(20001)}}, 400);
    await call(drafts, {key: 'post:other-service', version: 0, snapshot: {...snapshot, id: 'other-service', version: '4'}}, 404);
    const separate = (await call(drafts, {key: 'post:scheduled', version: 0, snapshot: {...snapshot, id: 'scheduled', version: '4'}}, 200)).draft;
    assert.equal(separate.snapshot.version, '4');
    await ctx.reload();
    assert.deepEqual(ctx.get('content', 'scheduled'), scheduled);
    assert.equal(ctx.list('content-revision').length, 0);
    const state = await call('/api/state', undefined, 200, otherOwner);
    assert(!JSON.stringify(state).includes('B 사본'));
    assert(!JSON.stringify(state).includes('post:scheduled'));

    const supplied = {brand: 'mind', kind: 'jpeg', name: ' 합성 이미지 ', url: 'https://media.example.com/photo.jpg',
      source: ' 사내 제작 ', usage: ' SNS 게시 승인 ', alt: '사진 설명', approved: true};
    const official = (await call(assets, undefined, 200)).assets;
    assert.equal(official.length, 5);
    assert(official.every(entry => entry.official && readFileSync(`public${entry.path}`, 'utf8').includes('<svg')));
    await call(assets, {...supplied, approved: false}, 400);
    await call(assets, {...supplied, source: ''}, 400);
    await call(assets, {...supplied, alt: '하나\n둘'}, 400);
    await call(assets, {...supplied, url: 'https://media.example.com/not-jpeg.png'}, 400);
    const unsafeURLs = ['javascript:alert(1)', '//media.example.com/photo.jpg', 'http://media.example.com/photo.jpg',
      'https://user:pass@media.example.com/photo.jpg', 'https://127.0.0.1/photo.jpg', 'https://0x7f000001/photo.jpg',
      'https://asset.localhost/photo.jpg', 'https://[::1]/photo.jpg', 'https://media.example.com:4000/photo.jpg',
      'https://media.example.com\\private/photo.jpg'];
    for (const url of unsafeURLs) await call(assets, {...supplied, url}, 400);
    const created = (await call(assets, supplied, 200)).asset;
    assert.equal(created.name, supplied.name.trim());
    assert.equal(created.source, supplied.source.trim());
    assert.equal(created.usage, supplied.usage.trim());
    assert.equal(created.approvedAt.length, 24);
    assert.deepEqual((await call(assets, undefined, 200, otherOwner)).assets.at(-1), created);
    const used = (await call(assets, {action: 'used', id: created.id}, 200)).used;
    assert.equal(used.id, created.id);
    assert.equal((await call(assets, undefined, 200)).assets[0].lastUsedAt, used.lastUsedAt);
    assert.equal((await call(assets, undefined, 200, otherOwner)).assets.at(-1).lastUsedAt, null);
    assert((await call(assets, undefined, 200, owner, true)).assets.every(row => row.lastUsedAt === null));
    await call(assets, supplied, 409);
    await call(assets, {action: 'withdraw', id: created.id, version: 0}, 409);
    await call(assets, {action: 'withdraw', id: created.id, version: 1}, 200);
    await call(assets, {action: 'used', id: created.id}, 404);
    assert.deepEqual((await call(assets, undefined, 200)).assets, official);
    await ctx.reload();
    assert(ctx.audits.some(row => row.action === 'studio.asset_approved' && row.target === created.id));
    assert(ctx.audits.some(row => row.action === 'studio.asset_withdrawn' && row.target === created.id));
    console.log('Studio library passed: private per actor and workspace, conflict/copy/overwrite, editorial schedule preserved, approved assets, URL boundaries and audit.');
  } finally {
    globalThis.fetch = fetchOriginal;
    await db.close();
  }
}

main().catch(error => {console.error(error); process.exitCode = 1;});
