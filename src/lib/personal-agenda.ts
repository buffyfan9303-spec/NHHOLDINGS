import {pool} from '@/server/postgres.cjs';

type AutomationEvent = {kind: string; scheduledAt: string; title: string};

export async function personalAgenda(actor: string) {
  const db = pool();
  const rows = await db.query<AutomationEvent>(
    "SELECT kind, data->>'scheduledAt' AS \"scheduledAt\", " +
    "left(COALESCE(NULLIF(data->>'subject',''),NULLIF(data->>'title',''),NULLIF(data->>'caption',''),NULLIF(data->>'body',''),'예약'),120) AS title " +
    "FROM nh_documents WHERE workspace='live' AND kind IN ('personal-mail-item','personal-social-post') " +
    "AND id LIKE $1 AND data->>'ownerId'=$2 AND data->>'status'='scheduled' AND data->>'scheduledAt'>=$3 ORDER BY data->>'scheduledAt',id LIMIT 20",
    [actor+':%',actor,new Date().toISOString()],
  );
  return rows.rows.map(row=>({
    title:row.title,scheduledAt:row.scheduledAt,kind:row.kind==='personal-mail-item'?'mail':'social',
  }));
}
