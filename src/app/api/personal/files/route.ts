import {type NextRequest, NextResponse} from 'next/server';
import {body, limit, MarketError, requireOrigin} from '@/lib/security';
import {
  beginDriveOAuth, beginPersonalFileUpload, downloadPersonalFile, driveAccessToken, DriveConnectionRequired,
  driveOAuthConfig, driveOAuthCookie, getPersonalFile, listPersonalFiles, personalFileMaxBytes, requirePersonalFileIdentity,
} from '@/lib/personal-files';

export const dynamic = 'force-dynamic';
const headers = {'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer'};
const disconnected = (configured: boolean) => Response.json({
  configured, connected: false, maxBytes: personalFileMaxBytes, files: [], nextPage: null,
}, {headers});

function fileResponseFailure(error: unknown) {
  if (error instanceof MarketError) return Response.json({error: error.message}, {status: error.status, headers});
  console.error('[personal-files]', error instanceof Error ? error.name : 'UnknownError');
  return Response.json({error: 'Google Drive에 연결하지 못했습니다. 잠시 후 다시 시도하세요.'}, {status: 503, headers});
}

export async function GET(req: NextRequest) {
  try {
    const actor = await requirePersonalFileIdentity(req);
    const config = driveOAuthConfig();
    const {searchParams} = req.nextUrl;
    const download = searchParams.get('download');
    const status = searchParams.get('status');
    if (!config) {
      if (download !== null || status !== null) throw new MarketError('Google Drive 연결을 설정해 주세요.', 503);
      return disconnected(false);
    }
    try {
      const token = await driveAccessToken(actor, config);
      if (download !== null) return Response.json({url: await downloadPersonalFile(token, actor, download)}, {headers});
      if (status !== null) return Response.json({file: await getPersonalFile(token, actor, status)}, {headers});
      const listed = await listPersonalFiles(token, actor, searchParams.get('page'));
      return Response.json({configured: true, connected: true, maxBytes: personalFileMaxBytes, ...listed}, {headers});
    } catch (error) {
      if (error instanceof DriveConnectionRequired && download === null && status === null) return disconnected(true);
      throw error;
    }
  } catch (error) {return fileResponseFailure(error);}
}

export async function POST(req: NextRequest) {
  try {
    requireOrigin(req);
    const actor = await requirePersonalFileIdentity(req);
    const config = driveOAuthConfig();
    if (!config) throw new MarketError('Google Drive 연결을 설정해 주세요.', 503);
    const input = await body(req);
    if (input.action === 'connect') {
      limit('personal-drive-connect:' + actor, 8);
      const {url, browser} = await beginDriveOAuth(req, actor, config);
      const response = NextResponse.json({url}, {headers});
      response.cookies.set(driveOAuthCookie, browser, {
        httpOnly: true, secure: req.nextUrl.protocol === 'https:', sameSite: 'lax', path: '/api/personal/files/oauth', maxAge: 600,
      });
      return response;
    }
    if (input.action !== 'upload') throw new MarketError('파일 동작을 확인하세요.');
    limit('personal-drive-upload:' + actor, 12);
    const token = await driveAccessToken(actor, config);
    const upload = await beginPersonalFileUpload(token, actor, req.headers.get('origin')!, input);
    return Response.json(upload, {status: 201, headers});
  } catch (error) {return fileResponseFailure(error);}
}
