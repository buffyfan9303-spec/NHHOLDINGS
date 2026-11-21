import {NextRequest} from 'next/server';
import {personalAgenda} from '@/lib/personal-agenda';
import {accessStatus, canUsePersonalWorkspace, identity} from '@/lib/auth';
import {body, failure, integer, MarketError, requireOrigin, textValue} from '@/lib/security';
import {personalWorkspace, uuidPattern, type PersonalDraft} from '@/server/personal-workspace.cjs';

export const dynamic = 'force-dynamic';
const headers = {'Cache-Control': 'private, no-store'};
const kinds = new Set(['task', 'schedule', 'note', 'link']);
const changed = () => new MarketError('이미 변경된 항목입니다. 새로고침 후 다시 시도해주세요.', 409);
const missing = () => new MarketError('개인 항목을 찾을 수 없습니다.', 404);

async function actor(req: NextRequest) {
  const user = await identity(req);
  if (!user) throw new MarketError('로그인이 필요합니다.', 401);
  const access = await accessStatus(user);
  if (!canUsePersonalWorkspace(access) || !uuidPattern.test(user.id)) {
    throw new MarketError('개인 비서 사용 승인이 필요합니다.', 403);
  }
  return {
    workspace: personalWorkspace(user.id),
    account: {id: user.id, email: user.email!, owner: access === 'owner'},
  };
}

function recordId(value: unknown) {
  if (typeof value !== 'string' || !uuidPattern.test(value)) throw new MarketError('개인 항목을 확인해주세요.');
  return value;
}

function flag(value: unknown) {
  if (typeof value !== 'boolean') throw new MarketError('완료 상태를 확인해주세요.');
  return value;
}

function webLink(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MarketError('https://로 시작하는 링크를 입력해주세요.');
  }
  if (!/^https:\/\/[^/?#\s]/u.test(value) || url.protocol !== 'https:' || url.username || url.password || /[\u0000-\u001f\u007f\\]/u.test(value)) {
    throw new MarketError('https://로 시작하는 링크를 입력해주세요.');
  }
  return url.href;
}

function calendarDate(value: unknown) {
  if (value === null || value === '') return null;
  if (typeof value === 'string' && /^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) {
    const stamp = new Date(value + 'T00:00:00Z');
    if (Number.isFinite(stamp.getTime()) && stamp.toISOString().slice(0, 10) === value) return value;
  }
  throw new MarketError('날짜를 확인해주세요.');
}

function draftFrom(input: Record<string, unknown>, previous?: PersonalDraft): PersonalDraft {
  const kind = input.kind === undefined ? previous?.kind : input.kind;
  if (typeof kind !== 'string' || !kinds.has(kind)) throw new MarketError('개인 항목 유형을 확인해주세요.');
  const title = textValue(input.title === undefined ? previous?.title : input.title, '제목', 160);
  const detail = textValue(input.detail === undefined ? previous?.detail ?? '' : input.detail, kind === 'link' ? '링크' : '내용', 4000, kind !== 'link');
  const dueOn = calendarDate(input.dueOn === undefined ? previous?.dueOn ?? null : input.dueOn);
  if (kind === 'schedule' && !dueOn) throw new MarketError('일정 날짜를 입력해주세요.');
  const dueTime = input.dueTime === undefined ? (dueOn ? previous?.dueTime ?? null : null) : input.dueTime === '' ? null : input.dueTime;
  if (dueTime !== null && (!dueOn || typeof dueTime !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(dueTime))) {
    throw new MarketError('날짜와 시간을 확인해주세요.');
  }
  return {
    kind: kind as PersonalDraft['kind'],
    title,
    detail: kind === 'link' ? webLink(detail) : detail,
    dueOn,
    dueTime,
    done: flag(input.done === undefined ? previous?.done ?? false : input.done),
  };
}

function rejected(error: unknown) {
  const response = failure(error);
  response.headers.set('Cache-Control', headers['Cache-Control']);
  return response;
}

export async function GET(req: NextRequest) {
  try {
    const {workspace, account} = await actor(req);
    const week = req.nextUrl.searchParams.get('week');
    if (week !== null) {
      if (req.headers.get('X-Personal-Account') !== account.id) throw changed();
      const day = calendarDate(week);
      const from = new Date(day + 'T00:00:00+09:00');
      if (!day || new Date(day + 'T00:00:00Z').getUTCDay() !== 1) throw new MarketError('월요일 기준의 주간 일정을 선택해주세요.');
      const until = new Date(+from + 7 * 86400_000 - 1);
      return Response.json({agenda:await personalAgenda(account.id,{from:from.toISOString(),until:until.toISOString()})},{headers});
    }
    const [items,agenda]=await Promise.all([workspace.list(),personalAgenda(account.id)]);
    return Response.json({account,items,agenda}, {headers});
  } catch (error) {
    return rejected(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    requireOrigin(req);
    const {workspace, account} = await actor(req);
    if (req.headers.get('X-Personal-Account') !== account.id) {
      throw new MarketError('로그인 계정이 변경됐습니다. 새로고침 후 다시 시도해주세요.', 409);
    }
    const input = await body(req);
    if (input.action === 'create') {
      const id = input.id === undefined ? undefined : recordId(input.id);
      const item = await workspace.create(draftFrom(input), id);
      if (!item) throw changed();
      return Response.json({item}, {headers});
    }

    if (input.action !== 'update' && input.action !== 'complete' && input.action !== 'remove') {
      throw new MarketError('개인 비서 작업을 확인해주세요.');
    }
    const id = recordId(input.id);
    const version = integer(input.version, '저장 버전', 1, Number.MAX_SAFE_INTEGER - 1);
    const previous = await workspace.get(id);
    if (!previous) throw missing();
    if (previous.version !== version) throw changed();

    if (input.action === 'remove') {
      if (!await workspace.remove(id, version)) throw changed();
      return Response.json({id}, {headers});
    }
    const fields = input.action === 'complete' ? {done: input.done === undefined ? true : flag(input.done)} : input;
    const item = await workspace.update(previous, draftFrom(fields, previous));
    if (!item) throw changed();
    return Response.json({item}, {headers});
  } catch (error) {
    return rejected(error);
  }
}
