'use strict';

const {createHash, randomUUID} = require('node:crypto');
const {isIP} = require('node:net');
const {CHANNELS, httpsURL} = require('./content-tools.cjs');

const draftRoute = '/api/studio/work-drafts';
const assetRoute = '/api/studio/assets';
const draftKind = 'studio-work-draft';
const assetKind = 'studio-brand-asset';
const assetUseKind = 'studio-asset-recent';
const recentLimit = 32;
const uuid = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
const assetId = new RegExp(`^${uuid}$`);
const draftKey = new RegExp(`^(?:new:${uuid}|post:[A-Za-z0-9_-]{1,80})$`);
const brandNames = new Set(['one', 'market', 'mind', 'holdem', 'crm', 'common']);
const assetKinds = new Set(['logo', 'image', 'jpeg', 'link']);
const fields = {
  campaignId: 200, title: 300, body: 20000, media: 2000, slides: 18009, videoUrl: 2000,
  altText: 1000, brand: 80, youtubeVideoId: 2000, youtubeCheckAccount: 80,
  youtubeMadeForKids: 5, youtubeSynthetic: 5, growthCampaign: 80, seoTitle: 300,
  description: 500, slug: 200, keyword: 200, cta: 500, url: 2000, sources: 24000,
};

function officialLogo(brand, name, variant, alt) {
  const path = `/brand/nuri-${brand}${variant === 'light' ? '-light' : ''}.svg`;
  return {
    id: `official-${brand}-${variant}`, brand, name, kind: 'logo', url: `https://nhholdings.xyz${path}`,
    path, source: '누리 서비스에 적용된 공식 로고',
    usage: `${variant === 'light' ? '밝은' : '어두운'} 배경에서 사용하세요. 비율과 색상을 유지하세요.`,
    alt, official: true,
  };
}

const officialAssets = [
  officialLogo('one', 'ONE PIECE 워드마크 · 밝은 배경', 'light', 'ONE PIECE'),
  officialLogo('one', 'ONE PIECE 워드마크 · 어두운 배경', 'dark', 'ONE PIECE'),
  officialLogo('market', 'NURI MARKET 로고 · 밝은 배경', 'light', 'NURI MARKET'),
  officialLogo('market', 'NURI MARKET 로고 · 어두운 배경', 'dark', 'NURI MARKET'),
  {id: 'official-holdem-light', brand: 'holdem', name: 'NURI HOLDEM 로고', kind: 'logo',
    url: 'https://nhholdings.xyz/brand/nuri-holdem-logo.svg', path: '/brand/nuri-holdem-logo.svg',
    source: 'NURI HOLDEM 공식 BI 가로 로고', usage: '밝은 배경에서 사용하세요. 인쇄용은 별도 아웃라인 파일을 사용하세요.',
    alt: 'NURI HOLDEM', official: true},
];

function fail(message, status = 400) {
  throw Object.assign(new Error(message), {status});
}

function idFor(actorId, key) {
  return createHash('sha256').update(JSON.stringify([actorId, key])).digest('hex');
}

function requireKey(key) {
  if (typeof key !== 'string' || !draftKey.test(key)) fail('작업 초안을 확인하세요.');
  return key;
}

function versionOf(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail('저장 버전을 확인하세요.');
  return value;
}

function readSnapshot(ctx, key, snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) fail('편집 내용을 확인하세요.');
  const id = key.startsWith('post:') ? key.slice(5) : '';
  if ((snapshot.id ?? '') !== id) fail('작업 초안과 원고 정보가 일치하지 않습니다.');
  const source = id ? ctx.get('content', id) : null;
  if (id && (!source || source.service !== 'tistory' || (source.business || 'platform') !== 'platform')) {
    fail('연결된 SNS 원고를 찾을 수 없습니다. 별도 사본으로 저장하세요.', 404);
  }
  const version = id ? Number(snapshot.version) : 1;
  if (!Number.isSafeInteger(version) || version < 1) fail('연결된 원고의 버전을 확인하세요.');
  if (!CHANNELS.includes(snapshot.channel)) fail('작성 채널을 확인하세요.');
  if (snapshot.blogTarget && !['tistory', 'wordpress'].includes(snapshot.blogTarget)) fail('블로그 발행 방식을 확인하세요.');
  if (snapshot.affiliate !== undefined && typeof snapshot.affiliate !== 'boolean') fail('제휴 여부를 확인하세요.');
  const content = Object.fromEntries(Object.entries(fields).map(([field, max]) => {
    const value = snapshot[field] ?? '';
    if (typeof value !== 'string' || value.length > max || value.includes('\u0000')) fail('편집 내용의 형식이나 길이를 확인하세요.');
    return [field, value];
  }));
  if (id) content.campaignId = source.campaignId || '';
  else content.campaignId = '';
  return {...content, id, version: String(version), service: 'tistory', business: 'platform',
    channel: snapshot.channel, blogTarget: snapshot.blogTarget || 'tistory', affiliate: snapshot.affiliate === true};
}

function workDraft(record, full = false) {
  const {key, version, updatedAt, snapshot} = record;
  return {
    key, version, updatedAt, title: snapshot.title, channel: snapshot.channel, sourceId: snapshot.id,
    ...(full ? {snapshot} : {}),
  };
}

async function saveDraft(ctx, input, actorId, email) {
  const key = requireKey(input.key), version = versionOf(input.version), id = idFor(actorId, key);
  return ctx.transaction(async () => {
    await ctx.lock(`${draftKind}:${id}`);
    await ctx.reload();
    const existing = ctx.get(draftKind, id);
    if (existing && existing.actorId !== actorId) fail('작업 초안을 찾을 수 없습니다.', 404);
    if ((existing?.version ?? 0) !== version) {
      return {status: 409, body: {error: '다른 기기에서 작업 초안이 변경됐습니다.', draft: existing ? workDraft(existing, true) : null}};
    }
    const snapshot = readSnapshot(ctx, key, input.snapshot);
    const updatedAt = new Date().toISOString();
    const record = {key, actorId, version: version + 1, snapshot, updatedAt};
    await ctx.put(draftKind, id, record);
    await ctx.audit(email, 'studio.work_draft_saved', id);
    return {status: 200, body: {draft: workDraft(record, true)}};
  });
}

function metadata(value, label, max, required = true) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    fail(`${label}을 확인하세요.`);
  }
  const trimmed = value.trim();
  if (required && !trimmed) fail(`${label}을 입력하세요.`);
  return trimmed;
}

function assetURL(value) {
  const input = metadata(value, '공개 HTTPS 주소', 2000);
  const url = new URL(httpsURL(input, '자산 주소', false));
  const host = url.hostname.replace(/\.$/, '');
  if (url.port || input.includes('\\') || !host.includes('.') || isIP(host) || host.includes(':') ||
      /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|onion)$|(?:^|\.)home\.arpa$/i.test(host)) {
    fail('공개 도메인의 HTTPS 주소를 입력하세요.');
  }
  return url;
}

function registeredAsset(id, row) {
  const {brand, name, kind, url, source, usage, alt, approvedAt, version} = row;
  return {id, brand, name, kind, url, source, usage, alt, approvedAt, version, official: false, lastUsedAt: null};
}

function listAssets(ctx, actorId) {
  const registered = ctx.list(assetKind).filter(row => !row.withdrawnAt).map(row => registeredAsset(row.id, row));
  const recent = ctx.get(assetUseKind, idFor(actorId, 'asset-use'))?.items || [];
  const usage = new Map(recent.map((row, order) => [row.id, {...row, order}]));
  return [...officialAssets, ...registered].sort((a, b) => (usage.get(a.id)?.order ?? recentLimit) - (usage.get(b.id)?.order ?? recentLimit))
    .map(asset => ({...asset, lastUsedAt: usage.get(asset.id)?.lastUsedAt || null}));
}

async function markAssetUsed(ctx, actorId, asset) {
  const official = officialAssets.some(row => row.id === asset);
  if (!official && (typeof asset !== 'string' || !assetId.test(asset))) fail('등록한 자산을 선택하세요.');
  const historyId = idFor(actorId, 'asset-use');
  return ctx.transaction(async () => {
    await ctx.lock(`${assetUseKind}:${historyId}`);
    await ctx.reload();
    const registered = official ? null : ctx.get(assetKind, asset);
    if (!official && (!registered || registered.withdrawnAt)) fail('승인된 자산을 찾을 수 없습니다.', 404);
    const used = {id: asset, lastUsedAt: new Date().toISOString()};
    const prior = ctx.get(assetUseKind, historyId)?.items || [];
    await ctx.put(assetUseKind, historyId, {items: [used, ...prior.filter(row => row.id !== asset)].slice(0, recentLimit)});
    return {used};
  });
}

async function editAssets(ctx, input, actorId, email) {
  if (input.action === 'used') return markAssetUsed(ctx, actorId, input.id);
  if (input.action === 'withdraw') {
    if (typeof input.id !== 'string' || !assetId.test(input.id)) fail('등록한 자산을 선택하세요.');
    const version = versionOf(input.version);
    return ctx.transaction(async () => {
      await ctx.lock('studio-brand-assets');
      await ctx.reload();
      const old = ctx.get(assetKind, input.id);
      if (!old || old.withdrawnAt) fail('등록된 자산을 찾을 수 없습니다.', 404);
      if (old.version !== version) fail('자산이 변경됐습니다. 목록을 새로 열어주세요.', 409);
      await ctx.put(assetKind, input.id, {...old, version: version + 1, withdrawnAt: new Date().toISOString()});
      await ctx.audit(email, 'studio.asset_withdrawn', input.id);
      return {withdrawn: input.id};
    });
  }
  if (input.action !== undefined) fail('지원하지 않는 자산 작업입니다.');
  if (input.approved !== true) fail('브랜드 사용 권리와 승인 범위를 확인하세요.');
  if (!brandNames.has(input.brand) || !assetKinds.has(input.kind)) fail('브랜드와 자산 유형을 선택하세요.');
  const name = metadata(input.name, '자산 이름', 120);
  const url = assetURL(input.url);
  if (input.kind === 'jpeg' && !/\.jpe?g$/i.test(url.pathname)) fail('JPEG 자산은 .jpg 또는 .jpeg 주소로 등록하세요.');
  const source = metadata(input.source, '출처·권리 근거', 500);
  const usage = metadata(input.usage, '사용 범위', 500);
  const alt = metadata(input.alt, input.kind === 'link' ? '링크 이름' : '이미지 대체 텍스트', 300, input.kind !== 'link');
  return ctx.transaction(async () => {
    await ctx.lock('studio-brand-assets');
    await ctx.reload();
    if ([...officialAssets, ...ctx.list(assetKind)].some(row => row.url === url.href && row.brand === input.brand && !row.withdrawnAt)) {
      fail('같은 브랜드에 이미 승인된 자산입니다.', 409);
    }
    const id = randomUUID();
    const row = {brand: input.brand, kind: input.kind, name, url: url.href, source, usage, alt,
      version: 1, approvedAt: new Date().toISOString()};
    await ctx.put(assetKind, id, row);
    await ctx.audit(email, 'studio.asset_approved', id);
    return {asset: registeredAsset(id, row)};
  });
}

async function handle(ctx, method, route, input, actorId, email, requestUrl) {
  if (route !== draftRoute && route !== assetRoute) return null;
  if (typeof actorId !== 'string' || !actorId || actorId.length > 200) fail('운영자 로그인이 필요합니다.', 401);
  if (method === 'GET' && route === draftRoute) {
    const key = requestUrl ? new URL(requestUrl).searchParams.get('key') : null;
    if (key === null) {
      return {status: 200, body: {drafts: ctx.list(draftKind).filter(row => row.actorId === actorId).map(row => workDraft(row))}};
    }
    const record = ctx.get(draftKind, idFor(actorId, requireKey(key)));
    if (!record || record.actorId !== actorId) fail('작업 초안을 찾을 수 없습니다.', 404);
    return {status: 200, body: {draft: workDraft(record, true)}};
  }
  if (method === 'POST' && route === draftRoute) return saveDraft(ctx, input, actorId, email);
  if (method === 'GET') return {status: 200, body: {assets: listAssets(ctx, actorId)}};
  if (method === 'POST') return {status: 200, body: await editAssets(ctx, input, actorId, email)};
  fail('지원하지 않는 요청입니다.', 405);
}

module.exports = {handle};
