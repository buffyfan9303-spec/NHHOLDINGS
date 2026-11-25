import {randomBytes, randomUUID} from 'node:crypto';
import type {NextRequest} from 'next/server';
import type {PoolClient} from 'pg';
import {accessStatus, canUsePersonalWorkspace, identity, isOwner, type AccessRecord} from './auth';
import {equal, hash, integer, MarketError, marketOrigin, seal, textValue, unseal} from './security';
import {socialKinds as kinds, socialStore, socialTransaction, type Owned, type RecordOf} from './personal-social-store';
import {imageUrl, personalAuthorization, personalProviderFetch, personalProviders, publishPersonalPost, threadLength, type PersonalProvider, type SocialDraft} from './personal-social-provider';
import {providers, authorization, exchange, identity as socialIdentity, refresh, type SocialApp, type SocialIdentity, type SocialToken} from '@/server/social.cjs';
import {pool} from '@/server/postgres.cjs';
import {uuidPattern} from '@/server/personal-workspace.cjs';
import {validMetadata, videoId} from '@/server/youtube.cjs';
import {weight} from '@/server/content-tools.cjs';
import {getPersonalCard} from './personal-cards';
import {mintPersonalCardImage} from './personal-card-media';
import {workbenchProject} from './personal-workbench';

type Actor = {id: string; email: string};
type StoredApp = Owned & {fingerprint: string; secret: string};
type App = {config: SocialApp; fingerprint: string; source: 'personal' | 'default'};
type Account = Owned & SocialIdentity & {
  provider: PersonalProvider;
  label: string;
  connectedAt: string;
  paused: boolean;
  connectionId: string;
  appFingerprint: string;
  secret: string;
};
type Flow = Owned & {
  provider: PersonalProvider;
  label: string;
  accountId: string;
  accountVersion: number | null;
  appFingerprint: string;
  session: string;
  stateHash: string;
  expiresAt: number;
  used: boolean;
};
type PostStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'review' | 'cancelled';
type CardMedia = {cardId: string; cardSlide: number; cardTitle: string; altText: string};
type Post = Owned & SocialDraft & Partial<CardMedia> & {
  status: PostStatus;
  ownerEmail: string;
  scheduledAt: string | null;
  connectionId: string | null;
  checkedAt: string | null;
  claimUntil: string | null;
  container: string;
  containerChecks: number;
  uncertain: boolean;
  externalId: string | null;
  link: string | null;
  error: string | null;
  publishedAt: string | null;
  projectId?: string;
};
type Store = ReturnType<typeof socialStore>;
const flowLifetime = 600_000;
const noAccount = () => new MarketError('SNS 계정을 찾을 수 없습니다.', 404);
const noPost = () => new MarketError('SNS 게시물을 찾을 수 없습니다.', 404);
const approvalRequired = () => new MarketError('SNS 계정을 연결한 뒤 게시 내용을 다시 확인해 주세요.', 409);
const activePublish = () => new MarketError('게시가 진행 중입니다. 결과가 확인된 뒤 다시 시도해 주세요.', 409);

export async function personalSocialActor(req: NextRequest, accountHeader = true): Promise<Actor> {
  const user = await identity(req);
  if (!user) throw new MarketError('로그인이 필요합니다.', 401);
  if (!canUsePersonalWorkspace(await accessStatus(user)) || !uuidPattern.test(user.id)) {
    throw new MarketError('개인 비서 사용 승인이 필요합니다.', 403);
  }
  if (accountHeader && req.headers.get('X-Personal-Account') !== user.id) {
    throw new MarketError('로그인 계정이 변경됐습니다. 새로고침 후 다시 시도해주세요.', 409);
  }
  return {id: user.id, email: user.email!.toLowerCase()};
}

export function socialProvider(value: unknown): PersonalProvider {
  if (typeof value !== 'string' || !personalProviders.includes(value as PersonalProvider)) {
    throw new MarketError('Instagram, Threads, YouTube 또는 X를 선택해 주세요.');
  }
  return value as PersonalProvider;
}

function recordId(value: unknown) {
  if (typeof value !== 'string' || !uuidPattern.test(value)) throw new MarketError('SNS 계정 또는 게시물 ID를 확인해 주세요.');
  return value;
}

function versionOf(value: unknown) {
  return integer(value, '저장 버전', 1, Number.MAX_SAFE_INTEGER - 1);
}

function flag(value: unknown) {
  if (typeof value !== 'boolean') throw new MarketError('게시 설정을 확인해 주세요.');
  return value;
}

function appConfig(provider: PersonalProvider, input: Record<string, unknown>): SocialApp {
  const clientId = textValue(input.clientId, 'Client ID', 250);
  const clientSecret = textValue(input.clientSecret, 'Client Secret', 400);
  if (!/^[a-z0-9._-]+$/i.test(clientId) || /\s|[\u0000-\u001f\u007f]/u.test(clientSecret) ||
      (provider === 'youtube' && !clientId.endsWith('.apps.googleusercontent.com')) ||
      ((provider === 'instagram' || provider === 'threads') && !/^\d+$/.test(clientId))) {
    throw new MarketError('발급받은 앱의 Client ID와 Client Secret을 확인해 주세요.');
  }
  if (provider !== 'instagram') return {clientId, clientSecret};
  const version = input.version === undefined || input.version === '' ? 'v25.0' : input.version;
  if (typeof version !== 'string' || !/^v\d{1,3}\.0$/.test(version)) throw new MarketError('Instagram API 버전을 확인해 주세요.');
  return {clientId, clientSecret, version};
}

function appFingerprint(provider: PersonalProvider, config: SocialApp) {
  return hash(JSON.stringify([provider, config.clientId, config.clientSecret, config.version ?? null]));
}

async function app(store: Store, provider: PersonalProvider): Promise<App | null> {
  const personal = await store.get<StoredApp>(kinds.app, provider);
  if (personal) {
    try {
      const config = appConfig(provider, JSON.parse(unseal(personal.data.secret)));
      const fingerprint = appFingerprint(provider, config);
      if (fingerprint === personal.data.fingerprint) return {config, fingerprint, source: 'personal'};
    } catch {}
    throw new MarketError('SNS 앱을 다시 설정해 주세요.', 409);
  }
  const key = 'PERSONAL_SOCIAL_' + provider.toUpperCase();
  if (!process.env[key + '_CLIENT_ID'] || !process.env[key + '_CLIENT_SECRET']) return null;
  try {
    const config = appConfig(provider, {clientId: process.env[key + '_CLIENT_ID'], clientSecret: process.env[key + '_CLIENT_SECRET'], version: process.env[key + '_VERSION']});
    return {config, fingerprint: appFingerprint(provider, config), source: 'default'};
  } catch {
    return null;
  }
}

function postView({id, data}: RecordOf<Post>) {
  const {accountId, provider, title, body, mediaUrl, videoId, madeForKids, synthetic, scheduledAt, status, version,
    link, error, uncertain, publishedAt, cardId, cardSlide, cardTitle, altText, projectId} = data;
  return {id, accountId, provider, title, body, mediaUrl, videoId, madeForKids, synthetic, scheduledAt, status, version, link, error, uncertain, publishedAt,
    cardId: cardId ?? null, cardSlide: cardSlide ?? null, cardTitle: cardTitle ?? null, altText: altText ?? null, projectId: projectId ?? null};
}

const callback = (provider: PersonalProvider) => marketOrigin() + '/api/personal/social/' + provider;

async function configuredApps(store:Store) {
  return new Map<PersonalProvider, App | null>(await Promise.all(
    personalProviders.map(async provider => [provider, await app(store, provider).catch(error => {
      if (error instanceof MarketError) return null;
      throw error;
    })] as const),
  ));
}

function connectedAccountView({id,data}:RecordOf<Account>,configured:Awaited<ReturnType<typeof configuredApps>>) {
  const {provider,label,username,connectedAt,paused,appFingerprint}=data;
  return {id,provider,label,username,connectedAt,paused,ready:configured.get(provider)?.fingerprint===appFingerprint};
}

export async function listConnectedPersonalSocial(owner:string) {
  const store=socialStore(owner);
  const [configured,accounts]=await Promise.all([configuredApps(store),store.list<Account>(kinds.account)]);
  return accounts.map(account=>connectedAccountView(account,configured)).filter(account=>account.ready)
    .map(({id,provider,label,paused})=>({id,provider,label,paused}));
}

export async function personalSocialOverview(owner: string) {
  const store = socialStore(owner);
  const [configured, accounts] = await Promise.all([configuredApps(store), store.list<Account>(kinds.account)]);
  const views = accounts.map(account => connectedAccountView(account, configured));
  return personalProviders.map(id => {
    const own = views.filter(account => account.provider === id);
    return {id, configured: !!configured.get(id), connected: own.filter(account => account.ready).length,
      paused: own.filter(account => account.ready && account.paused).length,
      stale: own.filter(account => !account.ready).length};
  });
}

export async function personalSocialState(actor: Actor) {
  const store = socialStore(actor.id);
  const configured = await configuredApps(store);
  const [accounts, posts] = await Promise.all([store.list<Account>(kinds.account), store.list<Post>(kinds.post)]);
  return {
    providers: personalProviders.map(id => {
      const saved = configured.get(id);
      const own = saved?.source === 'personal' ? saved.config : null;
      return {id, name: providers[id].name, configured: !!saved, appSource: saved?.source ?? null,
        redirectUri: callback(id), ...(own ? {clientId: own.clientId, ...(own.version ? {version: own.version} : {})} : {})};
    }),
    accounts: accounts.map(account=>connectedAccountView(account,configured)),
    posts: posts.map(postView),
  };
}

export function personalSocialCookie(provider: PersonalProvider) {
  return 'nh_personal_sns_' + provider;
}

function session(req: NextRequest) {
  const token = req.cookies.get('nh_access')?.value ?? '';
  try {
    if (token.length > 20_000 || !/^[-\w]+\.[-\w]+\.[-\w]+$/.test(token)) throw new Error();
    // Identity verifies this cookie with Auth before this session binding is read.
    const id = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).session_id;
    if (typeof id !== 'string' || !uuidPattern.test(id)) throw new Error();
    return hash(id);
  } catch {
    throw new MarketError('로그인 세션을 확인할 수 없습니다. 다시 로그인해 주세요.', 403);
  }
}

export async function startPersonalSocialOAuth(req: NextRequest, actor: Actor, input: Record<string, unknown>) {
  if (req.nextUrl.origin !== marketOrigin()) throw new MarketError('등록된 사이트 주소에서 SNS를 연결해 주세요.', 403);
  const provider = socialProvider(input.provider);
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + flowLifetime;
  const sessionId = session(req);
  return socialTransaction(actor.id, async db => {
    const store = socialStore(actor.id, db);
    const settings = await app(store, provider);
    if (!settings) throw new MarketError('이 SNS의 OAuth 앱을 먼저 설정해 주세요.', 412);
    const accountId = input.accountId === undefined || input.accountId === '' ? randomUUID() : recordId(input.accountId);
    const account = await store.get<Account>(kinds.account, accountId);
    if (input.accountId && (!account || account.data.provider !== provider)) throw noAccount();
    const label = textValue(input.label ?? account?.data.label ?? '', '계정 이름', 120, true);
    const old = await store.get<Flow>(kinds.flow, provider);
    const url = personalAuthorization(provider, authorization(provider, settings.config, {state, verifier, redirectUri: callback(provider)}));
    await store.put<Flow>(kinds.flow, provider, {
      ownerId: actor.id, version: 1, provider, label, accountId, accountVersion: account?.data.version ?? null,
      appFingerprint: settings.fingerprint, session: sessionId, stateHash: hash(state), expiresAt, used: false,
    }, old?.data.version);
    return {provider, url, cookie: seal(JSON.stringify({actor: actor.id, provider, session: sessionId, state, verifier, expiresAt}))};
  });
}

export class PersonalSocialAccountMismatch extends Error {}

export async function finishPersonalSocialOAuth(req: NextRequest, actor: Actor, provider: PersonalProvider) {
  if (req.nextUrl.origin !== marketOrigin()) throw new Error('Invalid OAuth origin');
  const {searchParams} = req.nextUrl;
  const state = searchParams.get('state');
  const code = searchParams.get('code');
  const sessionId = session(req);
  const browser = JSON.parse(unseal(req.cookies.get(personalSocialCookie(provider))?.value ?? ''));
  if (browser.actor !== actor.id || browser.provider !== provider || browser.session !== sessionId ||
      !Number.isFinite(browser.expiresAt) || browser.expiresAt < Date.now() || browser.expiresAt > Date.now() + flowLifetime ||
      !state || !/^[\w-]{43}$/.test(state) || typeof browser.state !== 'string' || !equal(state, browser.state) ||
      typeof browser.verifier !== 'string' || !/^[\w-]{43}$/.test(browser.verifier) ||
      !code || code.length > 2000 || /[\x00-\x20\x7f]/u.test(code) || searchParams.has('error')) throw new Error('Invalid OAuth flow');

  const {flow, settings} = await socialTransaction(actor.id, async db => {
    const store = socialStore(actor.id, db);
    const pending = await store.get<Flow>(kinds.flow, provider);
    const settings = await app(store, provider);
    if (!pending || pending.data.used || !settings || pending.data.appFingerprint !== settings.fingerprint ||
        pending.data.session !== sessionId || pending.data.expiresAt !== browser.expiresAt ||
        !equal(hash(state), pending.data.stateHash)) throw new Error('Expired OAuth flow');
    const flow = await store.put(kinds.flow, provider, {...pending.data, used: true}, pending.data.version);
    return {flow, settings};
  });

  const token = await exchange(provider, settings.config, {code, verifier: browser.verifier, redirectUri: callback(provider)}, personalProviderFetch);
  const profile = await socialIdentity(provider, token, personalProviderFetch);
  // Authorization may be revoked while the provider is processing the exchange.
  if (!(await workerAllowed(pool(), actor))) throw new Error('OAuth permission changed');
  await socialTransaction(actor.id, async db => {
    const store = socialStore(actor.id, db);
    const latest = await store.get<Flow>(kinds.flow, provider);
    const latestApp = await app(store, provider);
    const old = await store.get<Account>(kinds.account, flow.data.accountId);
    if (latest?.data.version !== flow.data.version || latestApp?.fingerprint !== settings.fingerprint ||
        (old?.data.version ?? null) !== flow.data.accountVersion || old && old.data.provider !== provider ||
        !(await workerAllowed(db, actor))) throw new Error('OAuth configuration changed');
    if (old && old.data.userId !== profile.userId) throw new PersonalSocialAccountMismatch();
    await ensureIdle(store, post => post.accountId === flow.data.accountId);
    await store.put<Account>(kinds.account, flow.data.accountId, {
      ...profile, ownerId: actor.id, version: 1, provider, label: flow.data.label || Array.from(profile.username.trim()).slice(0,100).join('') || providers[provider].name,
      connectedAt: new Date().toISOString(), paused: old?.data.paused ?? false,
      connectionId: randomUUID(), appFingerprint: settings.fingerprint, secret: seal(JSON.stringify(token)),
    }, old?.data.version);
  });
}

async function ensureIdle(store: Store, matches: (post: Post) => boolean) {
  if ((await store.list<Post>(kinds.post)).some(({data}) => data.status === 'publishing' && matches(data))) throw activePublish();
}

async function ownedCardSelection(actor: string, input: Record<string, unknown>): Promise<CardMedia | null> {
  if (input.cardId == null || input.cardId === '') {
    if (input.cardSlide != null && input.cardSlide !== '') throw new MarketError('편집한 카드뉴스를 선택해 주세요.');
    return null;
  }
  if (typeof input.cardId !== 'string' || input.mediaUrl) throw new MarketError('게시 이미지 출처를 하나만 선택해 주세요.');
  const card = await getPersonalCard(actor, recordId(input.cardId));
  const cardSlide = integer(input.cardSlide, '카드뉴스 페이지', 0, card.slides.length - 1);
  const selected = card.slides[cardSlide];
  const altText = [selected.label, selected.headline, selected.body].filter(Boolean).join('. ');
  return {cardId:card.id, cardSlide, cardTitle:card.title, altText};
}

function postFields(input: Record<string, unknown>, account: RecordOf<Account>, card: CardMedia | null): SocialDraft & Partial<CardMedia> {
  const provider = account.data.provider;
  if (card && provider !== 'instagram' && provider !== 'threads') throw new MarketError('카드 이미지는 Instagram과 Threads에서 사용할 수 있습니다.');
  const title = textValue(input.title, '제목', 160);
  const body = textValue(input.body, '본문', provider === 'threads' ? 1000 : provider === 'instagram' ? 4400 : 5000);
  if (provider === 'youtube') {
    const id = videoId(input.videoId);
    if (!id || !validMetadata(title, body)) throw new MarketError('비공개 영상 ID와 YouTube 제목·설명을 확인해 주세요.');
    return {accountId: account.id, provider, title, body, mediaUrl: '', videoId: id, madeForKids: flag(input.madeForKids), synthetic: flag(input.synthetic)};
  }
  const mediaUrl = imageUrl(textValue(input.mediaUrl ?? '', '이미지 주소', 2000, true));
  if (provider === 'x' && mediaUrl) throw new MarketError('X 예약에는 텍스트 본문을 입력해 주세요.');
  if (provider === 'instagram' && !mediaUrl && !card) throw new MarketError('Instagram에 사용할 공개 JPEG 이미지 URL을 입력해 주세요.');
  const length = provider === 'x' ? weight(body, 'x') : provider === 'threads' ? threadLength(body) : Array.from(body).length;
  const limit = provider === 'x' ? 280 : provider === 'threads' ? 500 : 2200;
  if (length > limit) throw new MarketError('채널의 본문 글자 수 제한을 확인해 주세요.');
  return {accountId: account.id, provider, title, body, mediaUrl, videoId: '', madeForKids: false, synthetic: false, ...(card ?? {})};
}

function newPost(actor: Actor, draft: SocialDraft & Partial<CardMedia>, projectId?: string): Post {
  return {
    ...draft, ...(projectId ? {projectId} : {}), ownerId: actor.id, version: 1, ownerEmail: actor.email, status: 'draft', scheduledAt: null,
    connectionId: null, claimUntil: null, checkedAt: null, container: '', containerChecks: 0, uncertain: false,
    externalId: null, link: null, error: null, publishedAt: null,
  };
}

// AI-created drafts keep an owner-scoped project link so the assistant can continue work across menus.
// undefined keeps the stored link, null or '' removes it, a string must name a project the owner holds.
async function linkedProject(owner: string, value: unknown) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 100) throw new MarketError('연결할 프로젝트를 확인해 주세요.');
  return (await workbenchProject(owner, value)).id;
}

async function approvedAccount(store: Store, post: Pick<Post, 'accountId' | 'provider'>) {
  const account = await store.get<Account>(kinds.account, post.accountId);
  const settings = await app(store, post.provider);
  if (!account || account.data.provider !== post.provider || account.data.paused || !settings ||
      settings.fingerprint !== account.data.appFingerprint) throw approvalRequired();
  return account;
}

export async function changePersonalSocial(actor: Actor, input: Record<string, unknown>) {
  // Saved cards are immutable. Read their scoped contents before taking the shared application connection.
  const card = input.action === 'save' ? await ownedCardSelection(actor.id, input) : null;
  const project = input.action === 'save' ? await linkedProject(actor.id, input.projectId) : undefined;
  return socialTransaction(actor.id, async db => {
    const store = socialStore(actor.id, db);
    if (input.action === 'configure') {
      const provider = socialProvider(input.provider);
      const config = appConfig(provider, input);
      const fingerprint = appFingerprint(provider, config);
      const old = await store.get<StoredApp>(kinds.app, provider);
      if (old?.data.fingerprint === fingerprint && await app(store, provider).catch(() => null)) return {ok: true};
      await ensureIdle(store, post => post.provider === provider);
      await store.put<StoredApp>(kinds.app, provider, {ownerId: actor.id, version: 1, fingerprint, secret: seal(JSON.stringify(config))}, old?.data.version);
      return {ok: true};
    }
    if (input.action === 'pause' || input.action === 'disconnect') {
      const account = await store.get<Account>(kinds.account, recordId(input.accountId));
      if (!account) throw noAccount();
      await ensureIdle(store, post => post.accountId === account.id);
      if (input.action === 'disconnect') {
        await store.remove(kinds.account, account.id, account.data.version);
      } else {
        const paused = flag(input.paused);
        if (paused !== account.data.paused) {
          // Resume requires a fresh approval for reservations made before the pause.
          await store.put(kinds.account, account.id, {...account.data, paused, connectionId: randomUUID()}, account.data.version);
        }
      }
      return {ok: true};
    }
    if (input.action !== 'save' && input.action !== 'schedule' && input.action !== 'cancel') {
      throw new MarketError('SNS 작업을 확인해 주세요.');
    }
    const creating = input.action === 'save' && input.id === undefined;
    const id = creating ? randomUUID() : recordId(input.id);
    const existing = creating ? null : await store.get<Post>(kinds.post, id);
    if (!existing && !creating) throw noPost();
    const previous = existing?.data;
    if (previous && (previous.version !== versionOf(input.version) || previous.uncertain || ['publishing', 'published'].includes(previous.status))) {
      throw new MarketError('변경할 수 없는 게시 상태입니다. 새로고침 후 확인해 주세요.', 409);
    }
    let data: Post;
    if (input.action === 'save') {
      const account = await store.get<Account>(kinds.account, recordId(input.accountId));
      if (!account) throw noAccount();
      data = newPost(actor, postFields(input, account, card), project === undefined ? previous?.projectId : project ?? undefined);
    } else if (input.action === 'cancel') {
      if (previous!.status !== 'scheduled') throw new MarketError('예약된 게시물만 취소할 수 있습니다.', 409);
      data = {...previous!, status: 'cancelled', connectionId: null, error: null};
    } else {
      const reservation = input.scheduledAt;
      const stamp = typeof reservation === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(reservation)
        ? Date.parse(reservation) : NaN;
      if (!Number.isFinite(stamp) || stamp <= Date.now() || new Date(stamp).toISOString().slice(0, 19) !== String(reservation).slice(0, 19) ||
          input.approved !== true) throw new MarketError('미래의 예약 시각과 게시 승인을 확인해 주세요.');
      const account = await approvedAccount(store, previous!);
      data = {
        ...previous!, status: 'scheduled', ownerEmail: actor.email, scheduledAt: new Date(stamp).toISOString(),
        connectionId: account.data.connectionId, claimUntil: null, checkedAt: null, container: '', containerChecks: 0, error: null,
      };
    }
    return {post: postView(await store.put(kinds.post, id, data, previous?.version))};
  });
}

async function workerAllowed(db: Pick<PoolClient, 'query'>, actor: Actor) {
  if (!uuidPattern.test(actor.id) || typeof actor.email !== 'string' || !actor.email) return false;
  if (isOwner({id: actor.id, email: actor.email, email_confirmed_at: 'verified-on-save'})) return true;
  const result = await db.query<{data: AccessRecord}>(
    "SELECT data FROM nh_documents WHERE workspace='live' AND kind='access' AND id=$1", [actor.id],
  );
  const grant = result.rows[0]?.data;
  return grant?.status === 'approved' && grant.scope === 'personal' && grant.email === actor.email;
}

function review(post: Post, uncertain: boolean, error: string): Post {
  return {...post, status: 'review', uncertain, claimUntil: null, error};
}

const interrupted = '게시 응답이 중단되었습니다. 채널에서 실제 게시 여부를 확인해 주세요.';

export async function runPersonalSocial() {
  const start = Date.now();
  const now = new Date(start).toISOString();
  const {rows} = await pool().query<RecordOf<Post>>(
    `SELECT id,data FROM nh_documents
     WHERE workspace='live' AND kind='personal-social-post' AND
       ((data->>'status'='scheduled' AND data->>'scheduledAt'<=$1 AND (data->>'checkedAt' IS NULL OR data->>'checkedAt'<=$2))
        OR (data->>'status'='publishing' AND data->>'claimUntil'<=$1))
     ORDER BY data->>'scheduledAt',id LIMIT 12`,
    [now, new Date(start - 90_000).toISOString()],
  );
  const result = {checked: 0, published: 0, review: 0};
  for (const row of rows) {
    if (Date.now() - start > 45_000) break;
    const actor = {id: row.data.ownerId, email: row.data.ownerEmail};
    if (!uuidPattern.test(actor.id) || !row.id.startsWith(actor.id + ':')) continue;
    const id = row.id.slice(actor.id.length + 1);
    if (!uuidPattern.test(id)) continue;
    const claim = await socialTransaction(actor.id, async db => {
      const store = socialStore(actor.id, db);
      const current = await store.get<Post>(kinds.post, id);
      if (!current || current.data.version !== row.data.version) return null;
      const post = current.data;
      result.checked++;
      if (post.status === 'publishing') {
        await store.put(kinds.post, id, review(post, true, interrupted), post.version);
        result.review++;
        return null;
      }
      if (!(await workerAllowed(db, actor))) {
        await store.put(kinds.post, id, review(post, false, '개인 비서 사용 권한을 확인해 주세요.'), post.version);
        result.review++;
        return null;
      }
      let account: RecordOf<Account>;
      try { account = await approvedAccount(store, post); }
      catch (error) {
        if (!(error instanceof MarketError)) throw error;
        await store.put(kinds.post, id, review(post, false, error.message), post.version);
        result.review++;
        return null;
      }
      if (account.data.connectionId !== post.connectionId) {
        await store.put(kinds.post, id, review(post, false, 'SNS 연결이 변경되었습니다. 다시 승인해 주세요.'), post.version);
        result.review++;
        return null;
      }
      const busy = (await store.list<Post>(kinds.post)).some(({data}) =>
        data.accountId === account.id && data.status === 'publishing' && !!data.claimUntil && data.claimUntil > now);
      if (busy) return null;
      const next = await store.put(kinds.post, id, {
        ...post, status: 'publishing', claimUntil: new Date(Date.now() + flowLifetime).toISOString(),
      }, post.version);
      return {post: next.data as Post, account};
    });
    if (!claim) continue;
    const store = socialStore(actor.id);
    const {post, account} = claim;
    let sending = false;
    try {
      let token: SocialToken = JSON.parse(unseal(account.data.secret));
      const expires = Date.parse(token.expiresAt);
      if (!Number.isFinite(expires)) throw approvalRequired();
      const shortLived = post.provider === 'youtube' || post.provider === 'x';
      if (expires - Date.now() < (shortLived ? 300_000 : 7 * 86400_000)) {
        if (shortLived || Date.now() - Date.parse(token.issuedAt) >= 86400_000) {
          token = await refresh(post.provider, token, personalProviderFetch);
          await store.put(kinds.account, account.id, {...account.data, secret: seal(JSON.stringify(token))}, account.data.version);
        } else if (expires <= Date.now()) {
          throw approvalRequired();
        }
      }
      const verifyDispatch = async () => {
        if (!(await workerAllowed(pool(), actor))) throw new MarketError('개인 비서 사용 권한을 확인해 주세요.', 403);
        const latest = await store.get<Post>(kinds.post, id);
        if (latest?.data.version !== post.version || !latest.data.claimUntil || Date.parse(latest.data.claimUntil) <= Date.now()) {
          throw new MarketError('게시 예약이 변경되었습니다.', 409);
        }
      };
      let mediaUrl = post.mediaUrl;
      if (post.cardId && !post.container) {
        if (post.cardSlide === undefined || !['instagram','threads'].includes(post.provider)) {
          throw new MarketError('승인한 카드뉴스 페이지를 확인해 주세요.', 409);
        }
        await verifyDispatch();
        mediaUrl = await mintPersonalCardImage(actor.id, post.cardId, post.cardSlide);
      }
      const outcome = await publishPersonalPost({...post,mediaUrl}, account.data, token, post.container, async () => {
        await verifyDispatch();
        sending = true;
      });
      if ('pending' in outcome && outcome.pending) {
        if (post.containerChecks >= 2) throw new MarketError('SNS 미디어 처리가 지연되고 있습니다. 확인 후 다시 승인해 주세요.', 409);
        await store.put(kinds.post, id, {
          ...post, status: 'scheduled', claimUntil: null, checkedAt: new Date().toISOString(),
          container: outcome.pending, containerChecks: post.containerChecks + 1, error: '미디어 처리 상태를 확인하는 중입니다.',
        }, post.version);
      } else if ('externalId' in outcome && outcome.externalId) {
        await store.put(kinds.post, id, {
          ...post, status: 'published', claimUntil: null, publishedAt: new Date().toISOString(),
          externalId: outcome.externalId, link: outcome.link || null, error: null,
        }, post.version);
        result.published++;
      } else {
        throw new MarketError('SNS 게시 결과를 확인해 주세요.', 502);
      }
    } catch (error) {
      const message = sending ? interrupted : error instanceof MarketError ? error.message : 'SNS 연결과 원본 게시 상태를 확인해 주세요.';
      await store.put(kinds.post, id, review(post, sending, message), post.version);
      result.review++;
    }
  }
  return result;
}
