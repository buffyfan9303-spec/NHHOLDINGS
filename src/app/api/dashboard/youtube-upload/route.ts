import {NextRequest} from 'next/server';
import {identity, isOwner} from '@/lib/auth';
import {body, failure, MarketError, readBytes, requireOrigin} from '@/lib/security';
import {context} from '@/server/context.cjs';
import {begin, chunkSize, transfer} from '@/server/youtube-upload.cjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const headers = {'Cache-Control': 'private, no-store'};

export async function POST(req: NextRequest) {
  try {
    requireOrigin(req);
    const user = await identity(req);
    if (!user || !isOwner(user)) throw new MarketError('운영자 계정으로 로그인하세요.', 403);
    const input = await body(req);
    const ctx = await context('live');
    const result = input.action === 'begin'
      ? await begin(ctx, user.id, input)
      : input.action === 'status'
        ? await transfer(ctx, user.id, input.id, null, null)
        : null;
    if (!result) throw new MarketError('업로드 동작을 선택하세요.');
    return Response.json(result, {headers});
  } catch (error) {
    return uploadFailure(error);
  }
}

export async function PUT(req: NextRequest) {
  try {
    requireOrigin(req);
    const user = await identity(req);
    if (!user || !isOwner(user)) throw new MarketError('운영자 계정으로 로그인하세요.', 403);
    const offset = req.headers.get('x-upload-offset');
    if (!offset || !/^\d{1,9}$/.test(offset)) throw new MarketError('업로드 위치를 확인하세요.');
    if (req.headers.get('content-type') !== 'application/octet-stream') throw new MarketError('영상 전송 형식을 확인하세요.', 415);
    const bytes = await readBytes(req, chunkSize);
    const ctx = await context('live');
    const result = await transfer(ctx, user.id, req.headers.get('x-upload-id'), Number(offset), bytes);
    return Response.json(result, {headers});
  } catch (error) {
    return uploadFailure(error);
  }
}

function uploadFailure(error: unknown) {
  if (error instanceof Error && 'status' in error && typeof error.status === 'number' && error.status >= 400 && error.status <= 599) {
    return Response.json({error: error.message}, {status: error.status, headers});
  }
  return failure(error);
}
