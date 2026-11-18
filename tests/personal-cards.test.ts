import assert from 'node:assert/strict';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {NextRequest} from 'next/server';
import sharp from 'sharp';
import {GET, POST} from '../src/app/api/personal/ai/cards/route';
import {GET as fetchCard} from '../src/app/api/personal/ai/cards/[id]/route';
import {GET as fetchMedia} from '../src/app/api/personal/ai/card-media/[file]/route';
import {createPersonalCard, listPersonalCards, validatePersonalCard} from '../src/lib/personal-cards';
import {mintPersonalCardImage} from '../src/lib/personal-card-media';
import {renderPersonalCard} from '../src/lib/personal-card-png';

const sample = {
  title: '작업 시간을 아껴 주는 세 가지 습관',
  theme: 'mint',
  slides: [
    {headline: '할 일 하나에 집중하세요', body: '첫 작업의 목표를 한 줄로 쓰고 그 작업이 끝나면 다음 일을 확인하세요.', label: '일의 습관'},
    {headline: '보고서는 한 번에 모으세요', body: '기록, 일정, 담당자를 한곳에 모아 확인 시간을 줄입니다. <sample> & 체크리스트'},
  ],
};

test('card schema bounds model output and preserves literal text for rendering', async () => {
  assert.throws(() => validatePersonalCard({...sample, theme: 'https://other.invalid'}), {status: 400});
  assert.throws(() => validatePersonalCard({...sample, slides: []}), {status: 400});
  assert.throws(() => validatePersonalCard({...sample, slides: [{headline: '한'.repeat(59)}]}), {status: 400});
  const draft = validatePersonalCard(sample);
  assert.match(draft.slides[1].body, /<sample> & 체크리스트/);
  const dated = {id: 'test-card', createdAt: '2026-11-19T00:00:00Z'};
  const lastSlide = validatePersonalCard({
    title: '제목'.repeat(32), theme: 'ink',
    slides: [{headline:'한'.repeat(58), body:'글'.repeat(180)}],
  });
  const [first, second] = await Promise.all([
    renderPersonalCard({...draft, ...dated}, 1),
    renderPersonalCard({...lastSlide, ...dated}, 0),
  ]);
  for (const bytes of [first, second]) {
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.format, 'png');
    assert.equal(metadata.width, 1080);
    assert.equal(metadata.height, 1350);
  }
  assert.notDeepEqual(first, second);
  await assert.rejects(renderPersonalCard({...draft, ...dated}, 8), {status: 404});
});

test('personal cards stay actor-bound for metadata and direct image requests', async t => {
  const origin = 'https://cards.test.invalid';
  const path = origin + '/api/personal/ai/cards';
  const owner = {id: '6d41a99a-a317-45d5-8c41-b031ca1eef6a', email: 'owner@example.invalid', email_confirmed_at: '2026-11-19'};
  const guest = {id: '86909483-4a27-42b1-bd7d-72d371c97461', email: 'guest@example.invalid', email_confirmed_at: '2026-11-19'};
  const keys = ['MARKET_ORIGIN', 'OPERATOR_EMAIL', 'OPERATOR_USER_ID', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY',
    'DATABASE_URL', 'ALLOWED_ORIGINS', 'VERCEL_URL', 'SESSION_SECRET'];
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
  await db.exec("CREATE TABLE nh_documents(workspace text,kind text,id text,data jsonb,updated timestamptz DEFAULT clock_timestamp(),PRIMARY KEY(workspace,kind,id))");
  await db.query("INSERT INTO nh_documents(workspace,kind,id,data) VALUES('live','access',$1,$2)", [guest.id,
    JSON.stringify({email: guest.email, status: 'approved', scope: 'personal'})]);
  g.nhPool = {query: async (query: string, args: unknown[] = []) => {
    const result = await db.query(query, args);
    return {...result, rowCount: result.rows.length || result.affectedRows};
  }};
  Object.assign(process.env, {MARKET_ORIGIN: origin, OPERATOR_EMAIL: owner.email, OPERATOR_USER_ID: owner.id,
    SUPABASE_URL: 'https://auth.test.invalid', SUPABASE_PUBLISHABLE_KEY: 'mock', DATABASE_URL: 'postgres://local-only',
    SESSION_SECRET: 'test-personal-card-media-signing-key-only'});
  delete process.env.ALLOWED_ORIGINS;
  delete process.env.VERCEL_URL;
  t.mock.method(globalThis, 'fetch', async (input: string, init?: RequestInit) => {
    assert.equal(input, 'https://auth.test.invalid/auth/v1/user');
    return Response.json(new Headers(init?.headers).get('Authorization') === 'Bearer ' + owner.id ? owner : guest);
  });
  const req = (suffix = '', actor = owner.id, data?: unknown, headers: Record<string, string> = {}) =>
    new NextRequest(path + suffix, {method: data ? 'POST' : 'GET', headers: {Cookie: 'nh_access=' + actor, Origin: origin,
      'X-Personal-Account': actor, ...headers}, ...(data ? {body: JSON.stringify(data)} : {})});
  assert.equal((await GET(new NextRequest(path))).status, 403);
  assert.equal((await GET(req('', owner.id, undefined, {'X-Personal-Account': guest.id}))).status, 409);
  assert.equal((await POST(req('', owner.id, {card: sample}, {Origin: 'https://other.invalid'}))).status, 403);
  const response = await POST(req('', owner.id, {card: sample}));
  assert.equal(response.status, 201);
  const card = (await response.json()).card;
  assert.equal(card.title, sample.title);
  assert.equal('ownerId' in card, false);
  assert.equal((await (await GET(req('', guest.id))).json()).cards.length, 0);
  const target = {params: Promise.resolve({id: card.id})};
  assert.equal((await fetchCard(req('/' + card.id + '?slide=0', guest.id), target)).status, 404);
  assert.equal((await fetchCard(new NextRequest(path + '/' + card.id + '?slide=0'), target)).status, 403);
  assert.equal((await fetchCard(req('/' + card.id + '?slide=8'), target)).status, 404);
  const image = await fetchCard(new NextRequest(path + '/' + card.id + '?slide=0&download=1', {headers: {Cookie: 'nh_access=' + owner.id}}), target);
  assert.equal(image.status, 200, 'owner can open an image from a normal authenticated browser link');
  assert.equal(image.headers.get('cache-control'), 'private, no-store');
  assert.equal(image.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.equal(image.headers.get('content-disposition'), 'attachment; filename="nuri-card-1.png"');
  assert.equal((await sharp(Buffer.from(await image.arrayBuffer())).metadata()).width, 1080);

  for (let index = 0; index < 13; index++) await createPersonalCard(owner.id, {...sample, title: '카드 ' + index});
  const newest = await listPersonalCards(owner.id);
  assert.equal(newest.cards.length, 12);
  assert(newest.nextPage);
  const earlier = await listPersonalCards(owner.id, newest.nextPage);
  assert.equal(earlier.cards.length, 2);
  assert.equal(earlier.nextPage, null);
  assert.equal(new Set([...newest.cards, ...earlier.cards].map(entry => entry.id)).size, 14);
  assert.equal((await listPersonalCards(guest.id, newest.nextPage)).cards.length, 0);

  let time = Date.now();
  t.mock.method(Date, 'now', () => time);
  await assert.rejects(mintPersonalCardImage(guest.id, card.id, 0), {status: 404});
  await assert.rejects(mintPersonalCardImage(owner.id, card.id, 7), {status: 404});
  const ownMedia = new URL(await mintPersonalCardImage(owner.id, card.id, 1));
  const guestCard = await createPersonalCard(guest.id, sample);
  const guestMedia = new URL(await mintPersonalCardImage(guest.id, guestCard.id, 0));
  assert.equal(ownMedia.origin, origin);
  assert.equal(ownMedia.pathname, '/api/personal/ai/card-media/' + card.id + '.jpg');
  const signed = (value: URL, entryId = card.id) => fetchMedia(new NextRequest(value), {params: Promise.resolve({file: entryId + '.jpg'})});
  const unsigned = new URL(ownMedia);
  unsigned.search = '';
  assert.equal((await signed(unsigned)).status, 404);
  const changed = new URL(ownMedia);
  const token = changed.searchParams.get('token')!;
  changed.searchParams.set('token', (token.startsWith('A') ? 'B' : 'A') + token.slice(1));
  assert.equal((await signed(changed)).status, 404);
  const duplicate = new URL(ownMedia);
  duplicate.searchParams.append('token', token);
  assert.equal((await signed(duplicate)).status, 404);
  assert.equal((await signed(ownMedia, guestCard.id)).status, 404);
  const providerImage = await signed(ownMedia);
  assert.equal(providerImage.status, 200);
  assert.equal(providerImage.headers.get('content-type'), 'image/jpeg');
  assert.equal(providerImage.headers.get('cache-control'), 'private, no-store');
  const jpg = await sharp(Buffer.from(await providerImage.arrayBuffer())).metadata();
  assert.equal(jpg.format, 'jpeg');
  assert.equal(jpg.width, 1080);
  assert.equal(jpg.height, 1350);
  assert.equal(jpg.exif, undefined);
  await db.query("UPDATE nh_documents SET data=jsonb_set(data,'{status}','\"revoked\"') WHERE id=$1", [guest.id]);
  assert.equal((await fetchCard(req('/' + card.id + '?slide=0', guest.id), target)).status, 403);
  assert.equal((await signed(guestMedia, guestCard.id)).status, 404, 'revoked actor media expires immediately');
  time += 15 * 60_000;
  assert.equal((await signed(ownMedia)).status, 404, 'delivery token stops at the TTL boundary');
});
