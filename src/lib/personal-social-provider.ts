import {isIP} from 'node:net';
import {MarketError} from './security';
import {publish as publishYouTube} from '@/server/youtube.cjs';
import type {SocialIdentity, SocialToken} from '@/server/social.cjs';

export const personalProviders = ['instagram', 'threads', 'youtube', 'x'] as const;
export type PersonalProvider = typeof personalProviders[number];
export type SocialDraft = {
  accountId: string;
  provider: PersonalProvider;
  title: string;
  body: string;
  mediaUrl: string;
  videoId: string;
  madeForKids: boolean;
  synthetic: boolean;
  altText?: string;
};

// The existing business workflow may still use legacy Threads origins. These
// translations apply only to the personal workspace and its official API calls.
export function personalAuthorization(id: PersonalProvider, href: string) {
  if (id !== 'threads') return href;
  const url = new URL(href);
  url.hostname = 'threads.com';
  return url.href;
}

export const personalProviderFetch: typeof fetch = (input, init) => {
  if (typeof input === 'string' && input.startsWith('https://graph.threads.net/')) {
    input = 'https://graph.threads.com/' + input.slice('https://graph.threads.net/'.length);
  }
  return fetch(input, init);
};

const threadSegments = new Intl.Segmenter(undefined, {granularity: 'grapheme'});
export function threadLength(value: string) {
  let length = 0;
  for (const {segment} of threadSegments.segment(value)) {
    length += /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(segment)
      ? Buffer.byteLength(segment, 'utf8') : Array.from(segment).length;
  }
  return length;
}

export function imageUrl(input: string) {
  if (!input) return '';
  let url: URL;
  try { url = new URL(input); }
  catch { throw new MarketError('공개 HTTPS 이미지 주소를 확인해 주세요.'); }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!/^https:\/\/[^/?#\s]/u.test(input) || url.protocol !== 'https:' || url.port || url.username || url.password ||
      url.hash || /[\u0000-\u0020\u007f\\]/u.test(input) || !host.includes('.') || isIP(host.replace(/^\[|\]$/g, '')) ||
      /\.(?:localhost|local|internal|home|lan|test|invalid)$/i.test(host)) {
    throw new MarketError('공개 HTTPS 이미지 주소를 확인해 주세요.');
  }
  return url.href;
}

function permalink(provider: PersonalProvider, input: unknown) {
  if (typeof input !== 'string') return '';
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    if (provider === 'instagram' && ['instagram.com','www.instagram.com'].includes(url.hostname) && /^\/p\/[\w-]+\/?$/.test(url.pathname)) {
      return 'https://www.instagram.com' + url.pathname;
    }
    if (provider === 'threads' && ['threads.net','www.threads.net','threads.com','www.threads.com'].includes(url.hostname) && /^\/@[\w.]+\/post\/[\w-]+\/?$/.test(url.pathname)) {
      return 'https://www.threads.com' + url.pathname;
    }
  } catch {}
  return '';
}

async function meta(path: string, token: string, fields?: Record<string, string>) {
  const response = await fetch(path, {
    headers: {Authorization: 'Bearer ' + token},
    ...(fields ? {method: 'POST', body: new URLSearchParams(fields)} : {}),
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new MarketError('SNS API 응답을 확인하지 못했습니다. 채널 연결과 게시 상태를 확인해 주세요.', 502);
  const data = await response.json();
  if (!data || typeof data !== 'object' || data.error) throw new MarketError('SNS 응답 형식을 확인할 수 없습니다.', 502);
  return data;
}

function mediaId(value: unknown) {
  if (typeof value !== 'string' || !/^\d{1,40}$/.test(value)) throw new MarketError('SNS 게시 결과를 확인하지 못했습니다.', 502);
  return value;
}

export async function publishPersonalPost(
  post: SocialDraft,
  account: SocialIdentity,
  config: SocialToken,
  container: string,
  beforeWrite: () => Promise<void>,
) {
  if (post.provider === 'youtube') {
    return publishYouTube({
      youtubeVideoId: post.videoId, title: post.title, body: post.body,
      youtubeMadeForKids: post.madeForKids, youtubeSynthetic: post.synthetic,
    }, account, config, fetch, beforeWrite);
  }
  if (!/^\d{1,40}$/.test(account.userId)) throw new MarketError('확인된 게시 계정이 필요합니다.', 409);
  if (post.provider === 'x') {
    await beforeWrite();
    const response = await fetch('https://api.x.com/2/tweets', {
      method:'POST', headers:{Authorization:'Bearer ' + config.token, 'Content-Type':'application/json'},
      body:JSON.stringify({text:post.body}), cache:'no-store', redirect:'error', signal:AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new MarketError('X API 프로젝트의 게시 권한과 실제 게시 상태를 확인해 주세요.', 502);
    const externalId = mediaId((await response.json()).data?.id);
    return {externalId, link:'https://x.com/i/web/status/' + externalId};
  }
  const threads = post.provider === 'threads';
  const version = config.version ?? 'v25.0';
  if (!/^v\d{1,3}\.0$/.test(version)) throw new MarketError('Instagram API 버전을 확인해 주세요.', 409);
  const base = threads ? 'https://graph.threads.com/v1.0' : 'https://graph.instagram.com/' + version;
  const accountUrl = base + '/' + account.userId;
  if (!container) {
    const fields: Record<string, string> = threads
      ? {media_type: post.mediaUrl ? 'IMAGE' : 'TEXT', text: post.body, ...(post.mediaUrl ? {image_url: post.mediaUrl} : {})}
      : {image_url: post.mediaUrl, caption: post.body};
    if (post.altText) fields.alt_text = post.altText;
    container = mediaId((await meta(accountUrl + (threads ? '/threads' : '/media'), config.token, fields)).id);
  }
  const field = threads ? 'status' : 'status_code';
  const state = (await meta(base + '/' + mediaId(container) + '?fields=' + field, config.token))[field];
  if (state === 'IN_PROGRESS') return {pending: container};
  if (state !== 'FINISHED') throw new MarketError('SNS 미디어 처리 상태를 확인해 주세요.', 409);
  await beforeWrite();
  const result = await meta(accountUrl + (threads ? '/threads_publish' : '/media_publish'), config.token, {creation_id: container});
  const externalId = mediaId(result.id);
  const info = await meta(base + '/' + externalId + '?fields=permalink', config.token).catch(() => null);
  return {externalId, link: permalink(post.provider, info?.permalink)};
}
