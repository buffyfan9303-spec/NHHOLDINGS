import {Resolver} from 'node:dns/promises';
import {isIP} from 'node:net';
import {NextRequest} from 'next/server';
import {automationActor} from '@/lib/personal-automation-access';
import {body, failure, integer, limit, MarketError, requireOrigin, textValue} from '@/lib/security';
import {uuidPattern} from '@/server/personal-workspace.cjs';
import {pool} from '@/server/postgres.cjs';

export const dynamic = 'force-dynamic';
const headers = {'Cache-Control':'private, no-store'};
const sites = "workspace='live' AND kind='personal-site'";
const owned = sites + " AND id=$1 AND data->>'ownerId'=$2";
const guide = "workspace='live' AND kind='personal-site-guide' AND id='shared'";
const changed = () => new MarketError('다른 화면에서 변경됐습니다. 다시 불러온 후 시도해 주세요.', 409);

type DnsResult = {checkedAt: string; records: string[]; status: 'found' | 'missing' | 'unavailable'};
type Site = ReturnType<typeof websiteDraft> & {version: number; dns: DnsResult | null};
type SiteRow = {id: string; data: Site & {ownerId: string}};
type SharedGuide = {note: string; version: number};
const registrars = ['가비아','후이즈','Cloudflare Registrar','기타'];
const hosts = ['Vercel','GitHub Pages','Cloudflare Pages','카페24','기타'];

function choice(value: unknown, label: string, allowed: string[]) {
  if (typeof value !== 'string' || (value !== '' && !allowed.includes(value))) throw new MarketError(label + '를 확인해 주세요.');
  return value;
}

function publicUrl(value: unknown) {
  const input = textValue(value, '웹사이트 주소', 1000, true);
  if (!input) return '';
  try {
    if (/[\u0000-\u0020\u007f\\?#]/u.test(input)) throw Error();
    const url = new URL(input.includes('://') ? input : 'https://' + input);
    const labels = url.hostname.split('.');
    if (url.protocol !== 'https:' || url.username || url.password || url.port || isIP(url.hostname) ||
        url.hostname.length > 253 || labels.length < 2 ||
        labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) ||
        /\.(?:localhost|local|test|invalid|example|internal|onion|arpa)$/i.test(url.hostname)) throw Error();
    return url.href;
  } catch {
    throw new MarketError('공개 HTTPS 주소를 입력해 주세요. 예시 example.com');
  }
}

function websiteDraft(input: Record<string, unknown>) {
  const renewOn = textValue(input.renewOn, '갱신일', 10, true);
  if (renewOn) {
    const date = new Date(renewOn + 'T00:00:00Z');
    if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(renewOn) ||
        !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== renewOn) throw new MarketError('갱신일을 확인해 주세요.');
  }
  return {
    name: textValue(input.name, '웹사이트 이름', 90),
    url: publicUrl(input.url),
    registrar: choice(input.registrar, '등록 업체', registrars),
    host: choice(input.host, '호스팅', hosts),
    renewOn,
  };
}

function siteForClient({id, data}: SiteRow) {
  const {name, url, registrar, host, renewOn, version, dns} = data;
  return {id: id.slice(id.indexOf(':') + 1), name, url, registrar, host, renewOn, version, dns};
}

function hostname(url: string) {
  return url ? new URL(url).hostname : '';
}

async function checkDns(url: string): Promise<DnsResult> {
  const host = hostname(publicUrl(url));
  if (!host) throw new MarketError('웹사이트 주소를 먼저 저장해 주세요.');
  const dns = new Resolver({timeout: 1500, tries: 1});
  const kinds = ['A', 'AAAA', 'CNAME'];
  const results = await Promise.allSettled([dns.resolve4(host), dns.resolve6(host), dns.resolveCname(host)]);
  const records = kinds.filter((_, index) => {
    const result = results[index];
    return result.status === 'fulfilled' && result.value.length > 0;
  });
  const unavailable = results.some(result => result.status === 'rejected' && !['ENODATA','ENOTFOUND'].includes(result.reason?.code));
  return {checkedAt: new Date().toISOString(), records, status: records.length ? 'found' : unavailable ? 'unavailable' : 'missing'};
}

function rejected(error: unknown) {
  const response = failure(error);
  response.headers.set('Cache-Control', headers['Cache-Control']);
  return response;
}

export async function GET(req: NextRequest) {
  try {
    const actor = await automationActor(req);
    const db = pool();
    const [list, shared] = await Promise.all([
      db.query<SiteRow>('SELECT id,data FROM nh_documents WHERE ' + sites + " AND id LIKE $1 AND data->>'ownerId'=$2 ORDER BY updated DESC,id", [actor.id + ':%', actor.id]),
      db.query<{data: SharedGuide}>('SELECT data FROM nh_documents WHERE ' + guide),
    ]);
    const {note, version} = shared.rows[0]?.data ?? {note: '', version: 0};
    return Response.json({sites: list.rows.map(siteForClient), guide: {note, version}, canShare: actor.owner}, {headers});
  } catch (error) {
    return rejected(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    requireOrigin(req);
    const actor = await automationActor(req);
    const input = await body(req);
    const db = pool();
    if (input.action === 'share') {
      if (!actor.owner) throw new MarketError('운영자만 가이드를 편집할 수 있습니다.', 403);
      const version = integer(input.version, '공유 메모 버전', 0, Number.MAX_SAFE_INTEGER - 1);
      const data = {note: textValue(input.note, '공유할 메모', 4000, true), version: version + 1};
      const result = version === 0
        ? await db.query("INSERT INTO nh_documents(workspace,kind,id,data) VALUES('live','personal-site-guide','shared',$1) ON CONFLICT DO NOTHING RETURNING id", [JSON.stringify(data)])
        : await db.query('UPDATE nh_documents SET data=$1,updated=clock_timestamp() WHERE ' + guide + " AND data->>'version'=$2 RETURNING id", [JSON.stringify(data), String(version)]);
      if (!result.rows.length) throw changed();
      return Response.json({guide: data}, {headers});
    }

    if (typeof input.id !== 'string' || !uuidPattern.test(input.id)) throw new MarketError('웹사이트 항목을 확인해 주세요.');
    const key = [actor.id + ':' + input.id, actor.id];
    if (input.action === 'create') {
      const draft = websiteDraft(input);
      const data = {...draft, ownerId: actor.id, version: 1, dns: null};
      const result = await db.query<SiteRow>(
        "INSERT INTO nh_documents(workspace,kind,id,data) VALUES('live','personal-site',$1,$2) ON CONFLICT DO NOTHING RETURNING id,data",
        [key[0], JSON.stringify(data)],
      );
      const row = result.rows[0] ?? (await db.query<SiteRow>('SELECT id,data FROM nh_documents WHERE ' + owned, key)).rows[0];
      if (!row || (!result.rows.length && (row.data.version !== 1 || !Object.entries(draft).every(([field, value]) => row.data[field as keyof typeof draft] === value)))) throw changed();
      return Response.json({site: siteForClient(row)}, {headers});
    }

    const version = integer(input.version, '저장 버전', 1, Number.MAX_SAFE_INTEGER - 1);
    const row = (await db.query<SiteRow>('SELECT id,data FROM nh_documents WHERE ' + owned, key)).rows[0];
    if (!row) throw new MarketError('웹사이트 항목을 찾을 수 없습니다.', 404);
    if (row.data.version !== version) throw changed();
    if (input.action === 'remove') {
      const result = await db.query('DELETE FROM nh_documents WHERE ' + owned + " AND data->>'version'=$3 RETURNING id", [...key, String(version)]);
      if (!result.rows.length) throw changed();
      return Response.json({id: input.id}, {headers});
    }

    const before = row.data;
    let data: SiteRow['data'];
    if (input.action === 'update') {
      const draft = websiteDraft(input);
      data = {...before, ...draft, dns: hostname(draft.url) === hostname(before.url) ? before.dns : null};
    } else if (input.action === 'dns') {
      limit('personal-site-dns:' + actor.id, 8);
      if (before.dns && Date.now() - Date.parse(before.dns.checkedAt) < 10_000) {
        throw new MarketError('10초 뒤 다시 확인해 주세요.', 429);
      }
      data = {...before, dns: await checkDns(before.url)};
    } else {
      throw new MarketError('웹사이트 작업을 확인해 주세요.');
    }
    const result = await db.query<SiteRow>(
      'UPDATE nh_documents SET data=$3,updated=clock_timestamp() WHERE ' + owned + " AND data->>'version'=$4 RETURNING id,data",
      [...key, JSON.stringify({...data, version: version + 1}), String(version)],
    );
    if (!result.rows.length) throw changed();
    return Response.json({site: siteForClient(result.rows[0])}, {headers});
  } catch (error) {
    return rejected(error);
  }
}
