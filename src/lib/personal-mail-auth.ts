import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {type NextRequest, NextResponse} from 'next/server';
import {accessStatus, canUsePersonalWorkspace, identity} from './auth';
import {equal, hash, MarketError, marketOrigin, requireOrigin, seal, unseal} from './security';
import {pool} from '../server/postgres.cjs';

const scope = 'https://www.googleapis.com/auth/gmail.send';
const callbackPath = '/api/personal/mail/oauth';
const redirectUri = () => marketOrigin() + callbackPath;
const cookieName = 'nh_personal_mail';
const flowLifetime = 600_000;
const filter = "workspace='live' AND kind='personal-mail-auth' AND id=$1";
const upsert = "INSERT INTO nh_documents(workspace,kind,id,data) VALUES('live','personal-mail-auth',$1,$2) " +
  'ON CONFLICT(workspace,kind,id) DO UPDATE SET ';
const headers = {'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer'};
const key = (actor: string) => hash('personal-mail-auth:' + actor);
const validClient = /^[\w-]+\.apps\.googleusercontent\.com$/;
const sessionId = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;

type App = {clientId: string; clientSecret: string};
type Token = {accessToken: string; refreshToken: string; expiresAt: number};
type SavedConnection = {id: string; appHash: string; secret: string};
type Record = {app?: string; paused?: boolean; connection?: SavedConnection};
type Browser = {actor: string; session: string; state: string; verifier: string; expires: number};

function cookie(req: NextRequest, maxAge: number) {
  return {httpOnly: true, secure: req.nextUrl.protocol === 'https:', sameSite: 'lax' as const, path: callbackPath, maxAge};
}

async function readRecord(actor: string) {
  const result = await pool().query<{data: Record}>('SELECT data FROM nh_documents WHERE ' + filter, [key(actor)]);
  return result.rows[0]?.data ?? {};
}

function appOf(record: Record): App | null {
  if (record.app) return JSON.parse(unseal(record.app)) as App;
  const clientId = process.env.PERSONAL_MAIL_CLIENT_ID;
  const clientSecret = process.env.PERSONAL_MAIL_CLIENT_SECRET;
  return clientId && validClient.test(clientId) && clientSecret?.trim() ? {clientId, clientSecret} : null;
}

const appHash = (app: App) => hash(JSON.stringify([app.clientId, app.clientSecret]));

export async function mailConnection(actor: string) {
  const record = await readRecord(actor);
  const app = appOf(record);
  const connectionId = app && record.connection?.appHash === appHash(app) ? record.connection.id : null;
  return {configured: !!app, connected: !!connectionId, connectionId, paused: record.paused === true,
    clientId: record.app ? app?.clientId ?? '' : '', redirectUri: redirectUri()};
}

export async function saveMailApp(actor: string, input: {clientId?: unknown; clientSecret?: unknown}) {
  const clientId = typeof input.clientId === 'string' ? input.clientId.trim() : '';
  if (clientId.length > 500 || !validClient.test(clientId)) throw new MarketError('Google 웹 애플리케이션 Client ID를 확인하세요.');
  const previous = appOf(await readRecord(actor));
  const supplied = typeof input.clientSecret === 'string' ? input.clientSecret.trim() : '';
  const clientSecret = supplied || (previous?.clientId === clientId ? previous.clientSecret : '');
  if (!clientSecret || clientSecret.length > 1_024 || /\s/.test(clientSecret)) throw new MarketError('Client Secret을 확인하세요.');
  const app = {clientId, clientSecret};
  if (previous && appHash(previous) === appHash(app)) return mailConnection(actor);
  await pool().query(upsert + "data=(nh_documents.data - 'flow' - 'connection') || excluded.data,updated=clock_timestamp()",
    [key(actor), JSON.stringify({app: seal(JSON.stringify(app))})]);
  return mailConnection(actor);
}

export async function setMailPaused(actor: string, paused: boolean) {
  await pool().query(upsert + 'data=nh_documents.data || excluded.data,updated=clock_timestamp()',
    [key(actor), JSON.stringify({paused})]);
  return mailConnection(actor);
}

export async function disconnectMail(actor: string) {
  await pool().query("UPDATE nh_documents SET data=data - 'flow' - 'connection',updated=clock_timestamp() WHERE " + filter, [key(actor)]);
  return mailConnection(actor);
}

function sessionFor(req: NextRequest) {
  // Invoked only after Supabase verifies the request's user.
  const token = req.cookies.get('nh_access')?.value ?? '';
  try {
    if (token.length <= 20_000 && /^[-\w]+\.[-\w]+\.[-\w]+$/.test(token)) {
      const {session_id} = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
      if (typeof session_id === 'string' && sessionId.test(session_id)) return hash(session_id.toLowerCase());
    }
  } catch {}
  throw new MarketError('로그인 세션을 확인할 수 없습니다. 다시 로그인해주세요.', 403);
}

export async function startMailAuth(req: NextRequest, actor: string) {
  requireOrigin(req);
  if (req.nextUrl.origin !== marketOrigin()) throw new MarketError('등록된 사이트 주소에서 Gmail을 연결해 주세요.', 403);
  const app = appOf(await readRecord(actor));
  if (!app) throw new MarketError('Gmail 웹 애플리케이션 정보를 먼저 저장하세요.', 412);
  const session = sessionFor(req);
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const expires = Date.now() + flowLifetime;
  const pending = {session, stateHash: hash(state), appHash: appHash(app), expires};
  await pool().query(upsert + 'data=nh_documents.data || excluded.data,updated=clock_timestamp()',
    [key(actor), JSON.stringify({flow: pending})]);

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: app.clientId, redirect_uri: redirectUri(), response_type: 'code', scope, state,
    access_type: 'offline', prompt: 'consent select_account', include_granted_scopes: 'false',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
  }).toString();
  const response = NextResponse.json({url: url.href}, {headers});
  response.cookies.set(cookieName, seal(JSON.stringify({actor, session, state, verifier, expires})), cookie(req, flowLifetime / 1000));
  return response;
}

async function exchange(app: App, values: {[field: string]: string}, prior?: string): Promise<Token> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000),
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({client_id: app.clientId, client_secret: app.clientSecret, ...values}),
  });
  const data = await response.json();
  if (data.error === 'invalid_grant') throw new MarketError('Gmail 계정을 다시 연결해 주세요.', 412);
  const refreshToken = data.refresh_token ?? prior;
  const scopeValid = (prior && data.scope === undefined) || (typeof data.scope === 'string' && data.scope.trim() === scope);
  if (!response.ok || !scopeValid || typeof data.access_token !== 'string' || !data.access_token ||
    typeof refreshToken !== 'string' || !refreshToken || data.token_type?.toLowerCase?.() !== 'bearer' ||
    !Number.isSafeInteger(data.expires_in) || data.expires_in < 1 || data.expires_in > 86_400) {
    throw new MarketError('Gmail 권한을 확인하지 못했습니다. Google 연결을 확인해 주세요.', 503);
  }
  return {accessToken: data.access_token, refreshToken, expiresAt: Date.now() + data.expires_in * 1000};
}

async function finishMailAuth(req: NextRequest, actor: string) {
  const session = sessionFor(req);
  const browser: Browser = JSON.parse(unseal(req.cookies.get(cookieName)?.value ?? ''));
  const params = req.nextUrl.searchParams;
  const state = params.get('state');
  const code = params.get('code');
  if (req.nextUrl.origin !== marketOrigin() || browser.actor !== actor || browser.session !== session ||
    !Number.isSafeInteger(browser.expires) || browser.expires < Date.now() || browser.expires > Date.now() + flowLifetime ||
    !state || !/^[\w-]{43}$/.test(state) || !equal(state, browser.state) ||
    !/^[\w-]{43}$/.test(browser.verifier) || !code || code.length > 2_000 ||
    params.getAll('state').length !== 1 || params.getAll('code').length !== 1 || params.has('error')) throw new Error('Invalid Gmail OAuth attempt');

  const app = appOf(await readRecord(actor));
  if (!app) throw new Error('Missing Gmail client');
  const fingerprint = appHash(app);
  const flowFilter = filter + " AND data->'flow'->>'stateHash'=$2 AND data->'flow'->>'session'=$3 AND data->'flow'->>'appHash'=$4 AND data->'flow'->>'expires'=$5";
  const binds = [key(actor), hash(state), session, fingerprint, String(browser.expires)];
  const claimed = await pool().query("UPDATE nh_documents SET data=jsonb_set(data,'{flow,used}','true'::jsonb),updated=clock_timestamp() WHERE " +
    flowFilter + " AND data->'flow'->>'used' IS NULL RETURNING id", binds);
  if (!claimed.rowCount) throw new Error('Gmail OAuth attempt already used');
  const token = await exchange(app, {grant_type: 'authorization_code', code, code_verifier: browser.verifier, redirect_uri: redirectUri()});
  const connection = {id: randomUUID(), appHash: fingerprint, secret: seal(JSON.stringify(token))};
  const saved = await pool().query("UPDATE nh_documents SET data=(data - 'flow') || $6::jsonb,updated=clock_timestamp() WHERE " +
    flowFilter + " AND data->'flow'->>'used'='true' RETURNING id", [...binds, JSON.stringify({connection})]);
  if (!saved.rowCount) throw new Error('Gmail OAuth attempt changed');
}

export async function mailOAuthCallback(req: NextRequest) {
  let result = 'failed';
  try {
    const user = await identity(req);
    if (user && canUsePersonalWorkspace(await accessStatus(user))) {
      await finishMailAuth(req, user.id);
      result = 'connected';
    }
  } catch {}
  const response = NextResponse.redirect(new URL('/personal?mail=' + result + '#mail', marketOrigin()));
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  response.cookies.set(cookieName, '', cookie(req, 0));
  return response;
}

async function usableConnection(actor: string, connectionId: string) {
  const record = await readRecord(actor);
  const app = appOf(record);
  const connection = record.connection;
  if (record.paused) throw new MarketError('Gmail 발송이 일시중지됐습니다.', 409);
  if (!app || !connection || connection.id !== connectionId || connection.appHash !== appHash(app)) {
    throw new MarketError('Gmail 연결이 변경됐습니다. 발송 계정을 다시 확인하세요.', 412);
  }
  return {app, connection, token: JSON.parse(unseal(connection.secret)) as Token};
}

export async function mailAccessToken(actor: string, connectionId: string) {
  const {app, connection, token} = await usableConnection(actor, connectionId);
  if (token.expiresAt > Date.now() + 60_000) return token.accessToken;
  const refreshed = await exchange(app, {grant_type: 'refresh_token', refresh_token: token.refreshToken}, token.refreshToken);
  const result = await pool().query(
    "UPDATE nh_documents SET data=jsonb_set(data,'{connection,secret}',to_jsonb($4::text)),updated=clock_timestamp() WHERE " +
      filter + " AND data->'connection'->>'id'=$2 AND data->'connection'->>'secret'=$3 AND coalesce(data->>'paused','false')='false' RETURNING id",
    [key(actor), connectionId, connection.secret, seal(JSON.stringify(refreshed))],
  );
  return result.rowCount ? refreshed.accessToken : (await usableConnection(actor, connectionId)).token.accessToken;
}
