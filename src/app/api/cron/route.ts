import {NextRequest} from 'next/server';
import {controller} from '@/server/dashboard.cjs';
import {collect} from '@/lib/dashboard';
import {equal} from '@/lib/security';
import {getDB} from '@/lib/db';
import {runMaintenance} from '@/lib/commerce';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !equal(req.headers.get('authorization') ?? '', 'Bearer ' + secret)) {
    return Response.json({error: 'Unauthorized'}, {status: 401});
  }

  const startedAt = new Date().toISOString();
  try {
    const [sources, publishing, maintenance] = await Promise.allSettled([
      controller({collect}).then(app => app.refresh()),
      controller({collect}).then(app => app.tick()),
      getDB().then(runMaintenance),
    ]);
    const stages = {
      sources: sources.status === 'fulfilled',
      publishing: publishing.status === 'fulfilled',
      maintenance: maintenance.status === 'fulfilled',
    };
    const ok = Object.values(stages).every(Boolean);
    const finishedAt = new Date().toISOString();
    const error = ok ? null : '예약 실행의 일부 단계가 실패했습니다.';
    const payload = {
      startedAt, finishedAt, ...(ok ? {lastSuccessAt: finishedAt} : {}), ok, error, stages,
      publishing: publishing.status === 'fulfilled' ? publishing.value ?? null : null,
      maintenance: maintenance.status === 'fulfilled' ? maintenance.value : null,
    };
    await (await getDB()).query(
      "INSERT INTO nh_documents(workspace,kind,id,data) VALUES('live','system','cron',$1) ON CONFLICT(workspace,kind,id) DO UPDATE SET data=nh_documents.data||excluded.data,updated=now() WHERE nh_documents.data->>'startedAt' IS NULL OR nh_documents.data->>'startedAt' <= excluded.data->>'startedAt'",
      [JSON.stringify(payload)],
    );
    return Response.json({ok, error, stages, publishing: payload.publishing, maintenance: payload.maintenance}, {status: ok ? 200 : 500});
  } catch {
    return Response.json({error: '예약 실행 상태를 확인해주세요.'}, {status: 500});
  }
}
