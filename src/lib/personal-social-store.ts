import type {PoolClient} from 'pg';
import {pool} from '@/server/postgres.cjs';
import {MarketError} from './security';

export const socialKinds = {
  app: 'personal-social-app',
  flow: 'personal-social-flow',
  account: 'personal-social-account',
  post: 'personal-social-post',
} as const;

type Kind = typeof socialKinds[keyof typeof socialKinds];
type Query = Pick<PoolClient, 'query'>;
export type Owned = {ownerId: string; version: number};
export type RecordOf<T> = {id: string; data: T};
const scope = "workspace='live' AND kind=$1";
const owned = scope + " AND id=$2 AND data->>'ownerId'=$3";
const changed = () => new MarketError('이미 변경됐습니다. 새로고침 후 다시 시도해 주세요.', 409);

export function socialStore(ownerId: string, db: Query = pool()) {
  const key = (kind: Kind, id: string) => [kind, ownerId + ':' + id, ownerId];
  const decode = <T>(row: RecordOf<T>) => ({id: row.id.slice(ownerId.length + 1), data: row.data});

  async function get<T extends Owned>(kind: Kind, id: string, lock = false) {
    const row = (await db.query<RecordOf<T>>(
      'SELECT id,data FROM nh_documents WHERE ' + owned + (lock ? ' FOR UPDATE' : ''),
      key(kind, id),
    )).rows[0];
    return row ? decode(row) : null;
  }

  async function list<T extends Owned>(kind: Kind) {
    const {rows} = await db.query<RecordOf<T>>(
      "SELECT id,data FROM nh_documents WHERE " + scope + " AND id LIKE $2 AND data->>'ownerId'=$3 ORDER BY updated DESC,id",
      [kind, ownerId + ':%', ownerId],
    );
    return rows.map(decode);
  }

  async function put<T extends Owned>(kind: Kind, id: string, data: T, expected?: number) {
    const next = {...data, ownerId, version: (expected ?? 0) + 1};
    const {rows} = await db.query<RecordOf<T>>(
      expected === undefined
        ? "INSERT INTO nh_documents(workspace,kind,id,data) VALUES('live',$1,$2,$3) ON CONFLICT DO NOTHING RETURNING id,data"
        : "UPDATE nh_documents SET data=$4,updated=clock_timestamp() WHERE " + owned + " AND data->>'version'=$5 RETURNING id,data",
      expected === undefined
        ? [kind, ownerId + ':' + id, JSON.stringify(next)]
        : [...key(kind, id), JSON.stringify(next), String(expected)],
    );
    if (!rows[0]) throw changed();
    return decode(rows[0]);
  }

  async function remove(kind: Kind, id: string, expected: number) {
    const {rows} = await db.query(
      "DELETE FROM nh_documents WHERE " + owned + " AND data->>'version'=$4 RETURNING id",
      [...key(kind, id), String(expected)],
    );
    if (!rows.length) throw changed();
  }

  return {get, list, put, remove};
}

export async function socialTransaction<T>(actor: string, work: (db: PoolClient) => Promise<T>) {
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['personal-social:' + actor]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
