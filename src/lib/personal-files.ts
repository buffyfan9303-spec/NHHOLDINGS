import {createHash, randomBytes, randomUUID} from 'node:crypto';
import type {NextRequest} from 'next/server';
import {accessStatus, canUsePersonalWorkspace, identity} from './auth';
import {equal, hash, MarketError, marketOrigin, seal, unseal} from './security';
import {pool} from '../server/postgres.cjs';

export const personalFileMaxBytes = 100_000_000;
export const driveOAuthCookie = 'nh_personal_drive';
const scope = 'https://www.googleapis.com/auth/drive.file';
const api = 'https://www.googleapis.com';
const binaryContentType = 'application/octet-stream';
const uploadPath = '/upload/drive/v3/files';
const fileId = /^[A-Za-z0-9_-]{5,180}$/;
const flowLifetime = 10 * 60_000;
const fileFields = 'id,name,size,createdTime,trashed,ownedByMe,appProperties,webContentLink,capabilities(canDownload)';
const documentKey = "workspace='live' AND kind='personal-drive' AND id=$1";
const upsert = "INSERT INTO nh_documents(workspace,kind,id,data) VALUES('live','personal-drive',$1,$2) " +
  'ON CONFLICT(workspace,kind,id) DO UPDATE SET ';
const validClientId = /^[\w-]+\.apps\.googleusercontent\.com$/;

type OAuthConfig = {clientId: string; clientSecret: string};
type DriveToken = {accessToken: string; refreshToken: string; expiresAt: number};
type Connection = {id: string; clientHash: string; secret: string};
type DriveRecord = {app?: string; connection?: Connection};
type BrowserFlow = {state: string; verifier: string; actor: string; session: string; expires: number};

export class DriveConnectionRequired extends MarketError {
  constructor() {super('Google Drive 계정을 연결해 주세요.', 412);}
}

async function record(actor: string) {
  const result = await pool().query<{data: DriveRecord}>('SELECT data FROM nh_documents WHERE ' + documentKey, [accountKey(actor)]);
  return result.rows[0]?.data ?? {};
}

function configuredApp(data: DriveRecord): OAuthConfig | null {
  if (data.app) return JSON.parse(unseal(data.app)) as OAuthConfig;
  const clientId = process.env.PERSONAL_DRIVE_CLIENT_ID;
  const clientSecret = process.env.PERSONAL_DRIVE_CLIENT_SECRET;
  return clientId && validClientId.test(clientId) && clientSecret?.trim()
    ? {clientId, clientSecret} : null;
}

export async function driveOAuthConfig(actor: string) {
  return configuredApp(await record(actor));
}

const clientHashOf = (config: OAuthConfig) => hash(JSON.stringify([config.clientId, config.clientSecret]));

export async function saveDriveApp(actor: string, input: {[key: string]: unknown}) {
  const data = await record(actor);
  const previous = configuredApp(data);
  const clientId = typeof input.clientId === 'string' ? input.clientId.trim() : '';
  const supplied = typeof input.clientSecret === 'string' ? input.clientSecret.trim() : '';
  const clientSecret = supplied || (previous?.clientId === clientId ? previous.clientSecret : '');
  if (clientId.length > 500 || !validClientId.test(clientId)) throw new MarketError('Google 웹 애플리케이션 Client ID를 확인하세요.');
  if (!clientSecret || clientSecret.length > 1_024 || /\s/.test(clientSecret)) throw new MarketError('Client Secret을 확인하세요.');
  const app = {clientId, clientSecret};
  const unchanged = previous && clientHashOf(previous) === clientHashOf(app);
  if (unchanged && data.app) return;
  const combined = unchanged ? 'nh_documents.data' : "(nh_documents.data - 'flow' - 'connection')";
  await pool().query(upsert + 'data=' + combined + ' || excluded.data,updated=clock_timestamp()',
    [accountKey(actor), JSON.stringify({app: seal(JSON.stringify(app))})]);
}

export async function disconnectDrive(actor: string) {
  await pool().query("UPDATE nh_documents SET data=data-'flow'-'connection',updated=clock_timestamp() WHERE " + documentKey,
    [accountKey(actor)]);
}

export async function requirePersonalFileIdentity(req: NextRequest, accountHeader = true) {
  const user = await identity(req);
  if (!user || !canUsePersonalWorkspace(await accessStatus(user))) throw new MarketError('개인 공간에 접근할 수 없습니다.', 403);
  if (accountHeader && req.headers.get('x-personal-account') !== user.id) {
    throw new MarketError('로그인 계정이 변경됐습니다. 새로고침 후 다시 시도해주세요.', 409);
  }
  return user.id;
}

function sessionBinding(req: NextRequest) {
  try {
    const token = req.cookies.get('nh_access')?.value ?? '';
    if (token.length > 20_000 || !/^[-\w]+\.[-\w]+\.[-\w]+$/.test(token)) throw new Error();
    const parsed = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (typeof parsed.session_id === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(parsed.session_id)) {
      return hash(parsed.session_id.toLowerCase());
    }
  } catch {}
  throw new MarketError('로그인 세션을 확인할 수 없습니다. 다시 로그인해주세요.', 403);
}

export const driveRedirectUri = () => marketOrigin() + '/api/personal/files/oauth';
const accountKey = (actor: string) => 'account:' + hash(actor);
const ownerStamp = (actor: string) => hash('personal-drive:' + actor);

export async function beginDriveOAuth(req: NextRequest, actor: string, config: OAuthConfig) {
  if (req.nextUrl.origin !== marketOrigin()) throw new MarketError('등록된 사이트 주소에서 Google Drive를 연결해 주세요.', 403);
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const session = sessionBinding(req);
  const expires = Date.now() + flowLifetime;
  const browser = seal(JSON.stringify({actor, session, state, verifier, expires}));
  const pending = {session, stateHash: hash(state), clientHash: clientHashOf(config), expires};
  await pool().query(
    upsert + 'data=nh_documents.data || excluded.data,updated=clock_timestamp()',
    [accountKey(actor), JSON.stringify({flow: pending})],
  );
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: config.clientId, redirect_uri: driveRedirectUri(), response_type: 'code', scope, state,
    access_type: 'offline', prompt: 'consent select_account', include_granted_scopes: 'false',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
  }).toString();
  return {url: url.href, browser};
}

async function exchangeToken(config: OAuthConfig, values: Record<string, string>, previousRefresh?: string): Promise<DriveToken> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({client_id: config.clientId, client_secret: config.clientSecret, ...values}),
    redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json();
  if (!response.ok) {
    if (result.error === 'invalid_grant') throw new DriveConnectionRequired();
    throw new MarketError('Google Drive 인증을 확인하지 못했습니다.', 503);
  }
  const refreshToken = result.refresh_token ?? previousRefresh;
  if (typeof result.access_token !== 'string' || !result.access_token || typeof refreshToken !== 'string' || !refreshToken ||
    typeof result.token_type !== 'string' || result.token_type.toLowerCase() !== 'bearer' ||
    !Number.isSafeInteger(result.expires_in) || result.expires_in < 1 || result.expires_in > 86_400) {
    throw new MarketError('Google Drive 인증을 확인하지 못했습니다.', 503);
  }
  if ((!previousRefresh || result.scope !== undefined) && (typeof result.scope !== 'string' || result.scope.trim() !== scope)) {
    throw new DriveConnectionRequired();
  }
  return {accessToken: result.access_token, refreshToken, expiresAt: Date.now() + result.expires_in * 1000};
}

export async function finishDriveOAuth(req: NextRequest, actor: string, config: OAuthConfig) {
  if (req.nextUrl.origin !== marketOrigin()) throw new Error('Wrong callback origin');
  const browser: BrowserFlow = JSON.parse(unseal(req.cookies.get(driveOAuthCookie)?.value ?? ''));
  const {searchParams} = req.nextUrl;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const session = sessionBinding(req);
  if (browser.actor !== actor || browser.session !== session || !Number.isSafeInteger(browser.expires) ||
    browser.expires < Date.now() || browser.expires > Date.now() + flowLifetime ||
    !state || !/^[\w-]{43}$/.test(state) || typeof browser.state !== 'string' || !equal(state, browser.state) ||
    typeof browser.verifier !== 'string' || !/^[\w-]{43}$/.test(browser.verifier) ||
    !code || code.length > 2_000 || searchParams.getAll('code').length !== 1 ||
    searchParams.getAll('state').length !== 1 || searchParams.has('error')) throw new Error('Invalid OAuth flow');

  const clientHash = clientHashOf(config);
  const filter = documentKey + " AND data->'flow'->>'stateHash'=$2 AND data->'flow'->>'session'=$3 AND data->'flow'->>'clientHash'=$4 AND data->'flow'->>'expires'=$5";
  const bindings = [accountKey(actor), hash(state), session, clientHash, String(browser.expires)];
  const claimed = await pool().query(
    "UPDATE nh_documents SET data=jsonb_set(data,'{flow,used}','true'::jsonb),updated=clock_timestamp() WHERE " + filter + " AND data->'flow'->>'used' IS NULL RETURNING id",
    bindings,
  );
  if (!claimed.rowCount) throw new Error('OAuth flow already consumed');
  const token = await exchangeToken(config, {grant_type: 'authorization_code', code, code_verifier: browser.verifier, redirect_uri: driveRedirectUri()});
  const connection = {id: randomUUID(), clientHash, secret: seal(JSON.stringify(token))};
  const saved = await pool().query(
    "UPDATE nh_documents SET data=(data-'flow') || $6::jsonb,updated=clock_timestamp() WHERE " + filter + " AND data->'flow'->>'used'='true' RETURNING id",
    [...bindings, JSON.stringify({connection})],
  );
  if (!saved.rowCount) throw new Error('OAuth flow superseded');
}

async function connection(actor: string, config: OAuthConfig, expectedConnectionId?: string) {
  const saved = (await record(actor)).connection;
  if (!saved?.secret || saved.clientHash !== clientHashOf(config) || (expectedConnectionId !== undefined && expectedConnectionId !== saved.id)) {
    throw new DriveConnectionRequired();
  }
  const token: DriveToken = JSON.parse(unseal(saved.secret));
  return {saved, token};
}

export async function driveAccessToken(actor: string, config: OAuthConfig, expectedConnectionId?: string) {
  const {saved, token} = await connection(actor, config, expectedConnectionId);
  if (token.expiresAt > Date.now() + 60_000) return {token: token.accessToken, connectionId: saved.id};
  const refreshed = await exchangeToken(config, {grant_type: 'refresh_token', refresh_token: token.refreshToken}, token.refreshToken);
  const committed = await pool().query(
    "UPDATE nh_documents SET data=jsonb_set(data,'{connection,secret}',to_jsonb($4::text)),updated=clock_timestamp() WHERE " +
    documentKey + " AND data->'connection'->>'id'=$2 AND data->'connection'->>'secret'=$3 RETURNING id",
    [accountKey(actor), saved.id, saved.secret, seal(JSON.stringify(refreshed))],
  );
  const accessToken = committed.rowCount ? refreshed.accessToken : (await connection(actor, config, saved.id)).token.accessToken;
  return {token: accessToken, connectionId: saved.id};
}

async function driveRequest(url: string | URL, token: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init, headers: {...init?.headers, Authorization: 'Bearer ' + token},
    redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) throw new MarketError('파일을 찾을 수 없습니다.', 404);
  if (response.status === 401) throw new DriveConnectionRequired();
  if (!response.ok) throw new MarketError('Google Drive가 요청을 처리하지 못했습니다. 연결과 저장 공간을 확인하세요.', 503);
  return response;
}

type DriveFile = {
  id?: string; name?: string; size?: string; createdTime?: string; trashed?: boolean; ownedByMe?: boolean;
  appProperties?: Record<string, string>; webContentLink?: string; capabilities?: {canDownload?: boolean};
};

function toPersonalFile(file: DriveFile, actor: string) {
  if (!file.id || !fileId.test(file.id) || !file.name || file.trashed !== false || file.ownedByMe !== true ||
    file.appProperties?.nuriOwner !== ownerStamp(actor) || !file.createdTime || !Number.isFinite(Date.parse(file.createdTime)) ||
    typeof file.size !== 'string' || !/^\d+$/.test(file.size)) return null;
  const bytes = Number(file.size);
  if (!Number.isSafeInteger(bytes) || bytes < 0) return null;
  return {id: file.id, name: file.name, bytes, createdAt: file.createdTime};
}

function uploadUrl(value: string | null) {
  if (!value) throw new Error('Missing Drive upload session');
  const url = new URL(value);
  if (![api, 'https://upload.drive.google.com'].includes(url.origin) ||
    url.pathname !== uploadPath || url.username || url.password || url.hash ||
    url.searchParams.get('uploadType') !== 'resumable' || !url.searchParams.get('upload_id')) throw new Error('Invalid Drive upload session');
  return url.href;
}

export async function listPersonalFiles(token: string, actor: string, pageToken: string | null) {
  if (pageToken && (pageToken.length > 2048 || !/^[\w+=/.-]+$/.test(pageToken))) throw new MarketError('목록 위치를 확인하세요.');
  const url = new URL('/drive/v3/files', api);
  url.search = new URLSearchParams({
    q: "trashed = false and appProperties has { key='nuriOwner' and value='" + ownerStamp(actor) + "' }",
    spaces: 'drive', pageSize: '25', orderBy: 'createdTime desc', fields: 'nextPageToken,files(' + fileFields + ')',
    ...(pageToken ? {pageToken} : {}),
  }).toString();
  const result = await (await driveRequest(url, token)).json();
  const files = result.files ?? [];
  if (!Array.isArray(files)) throw new Error('Invalid Drive file list');
  return {
    files: files.map((file: DriveFile) => toPersonalFile(file, actor)).filter(Boolean),
    nextPage: typeof result.nextPageToken === 'string' ? result.nextPageToken : null,
  };
}

export async function beginPersonalFileUpload(token: string, actor: string, origin: string, input: Record<string, unknown>) {
  if (typeof input.name !== 'string' || input.name.length > 240) throw new MarketError('파일 이름을 확인하세요.');
  const name = input.name.toWellFormed().normalize('NFC').replace(/[\p{Cc}\p{Cf}\\/]/gu, '_').trim();
  if (!name || name === '.' || name === '..' || Buffer.byteLength(name) > 240) throw new MarketError('파일 이름을 확인하세요.');
  const bytes = input.bytes;
  if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0) throw new MarketError('파일 용량을 확인하세요.');
  if (bytes > personalFileMaxBytes) throw new MarketError('파일 한 개의 최대 용량은 100 MB입니다.', 413);
  const allocated = await (await driveRequest(api + '/drive/v3/files/generateIds?count=1&space=drive&type=files', token)).json();
  const id = allocated.ids?.[0];
  if (typeof id !== 'string' || !fileId.test(id)) throw new Error('Invalid Drive file id');
  const initiated = await driveRequest(api + uploadPath + '?uploadType=resumable', token, {
    method: 'POST', headers: {
      'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': binaryContentType,
      'X-Upload-Content-Length': String(bytes), Origin: origin,
    },
    body: JSON.stringify({id, name, mimeType: binaryContentType, appProperties: {nuriOwner: ownerStamp(actor)}}),
  });
  return {
    id, expiresAt: Date.now() + 7 * 24 * 60 * 60_000, url: uploadUrl(initiated.headers.get('location')),
    headers: {'Content-Type': binaryContentType},
  };
}

async function readPersonalFile(token: string, actor: string, id: string) {
  if (!fileId.test(id)) throw new MarketError('파일을 찾을 수 없습니다.', 404);
  const url = new URL('/drive/v3/files/' + id, api);
  url.searchParams.set('fields', fileFields);
  const data: DriveFile = await (await driveRequest(url, token)).json();
  const file = toPersonalFile(data, actor);
  if (file?.id !== id) throw new MarketError('파일을 찾을 수 없습니다.', 404);
  return {file, data};
}

export async function getPersonalFile(token: string, actor: string, id: string) {
  return (await readPersonalFile(token, actor, id)).file;
}

export async function downloadPersonalFile(token: string, actor: string, id: string) {
  const {data} = await readPersonalFile(token, actor, id);
  if (data.capabilities?.canDownload !== true || !data.webContentLink) throw new MarketError('Google Drive에서 다운로드할 수 없는 파일입니다.', 400);
  const url = new URL(data.webContentLink);
  if (!['https://drive.google.com', 'https://drive.usercontent.google.com', 'https://docs.google.com'].includes(url.origin) || url.username || url.password) {
    throw new Error('Invalid Drive download link');
  }
  return url.href;
}
