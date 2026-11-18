import {NextRequest} from 'next/server';
import {automationActor} from '@/lib/personal-automation-access';
import {body, failure, integer, MarketError, requireOrigin, textValue} from '@/lib/security';
import {uuidPattern} from '@/server/personal-workspace.cjs';
import {pool} from '@/server/postgres.cjs';

export const dynamic = 'force-dynamic';
const headers = {'Cache-Control':'private, no-store'};
const scope = "workspace='live' AND kind='personal-revenue'";
const owned = scope + " AND id=$1 AND data->>'ownerId'=$2";
const categories = ['웹사이트','블로그','SNS','기타'];
const conflict = () => new MarketError('다른 화면에서 변경됐습니다. 다시 불러온 후 시도해 주세요.', 409);
type Revenue = ReturnType<typeof draftFrom> & {version:number; ownerId:string};
type Row = {id:string; data:Revenue};

function period(value: unknown) {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value)) throw new MarketError('정산 월을 확인해 주세요.');
  return value;
}
function draftFrom(input: Record<string, unknown>) {
  const category = textValue(input.category, '수익 분류', 20);
  if (!categories.includes(category)) throw new MarketError('수익 분류를 확인해 주세요.');
  return {
    period: period(input.period),
    category,
    name: textValue(input.name, '수익원 이름', 100),
    income: integer(input.income, '수익', 0, 1_000_000_000_000),
    expense: integer(input.expense, '비용', 0, 1_000_000_000_000),
  };
}
function clientRow(row: Row) {
  const {period, category, name, income, expense, version} = row.data;
  return {id:row.id.slice(row.id.indexOf(':') + 1), period, category, name, income, expense, version};
}
function rejected(error: unknown) {
  const response = failure(error);
  response.headers.set('Cache-Control', headers['Cache-Control']);
  return response;
}

export async function GET(req: NextRequest) {
  try {
    const actor = await automationActor(req);
    const month = period(req.nextUrl.searchParams.get('month'));
    const {rows} = await pool().query<Row>(
      'SELECT id,data FROM nh_documents WHERE ' + scope + " AND id LIKE $1 AND data->>'ownerId'=$2 AND data->>'period'=$3 ORDER BY updated DESC,id",
      [actor.id + ':%', actor.id, month],
    );
    return Response.json({entries:rows.map(clientRow)}, {headers});
  } catch (error) {
    return rejected(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    requireOrigin(req);
    const actor = await automationActor(req);
    const input = await body(req);
    if (typeof input.id !== 'string' || !uuidPattern.test(input.id)) throw new MarketError('수익 항목을 확인해 주세요.');
    const key = [actor.id + ':' + input.id, actor.id];
    const db = pool();
    if (input.action === 'create') {
      const draft = draftFrom(input);
      const inserted = await db.query<Row>("INSERT INTO nh_documents(workspace,kind,id,data) VALUES('live','personal-revenue',$1,$2) ON CONFLICT DO NOTHING RETURNING id,data",
        [key[0], JSON.stringify({...draft, ownerId:actor.id, version:1})]);
      const row = inserted.rows[0] ?? (await db.query<Row>('SELECT id,data FROM nh_documents WHERE ' + owned, key)).rows[0];
      if (!row || (!inserted.rows.length && (row.data.version !== 1 || !Object.entries(draft).every(([field,value]) => row.data[field as keyof typeof draft] === value)))) throw conflict();
      return Response.json({entry:clientRow(row)}, {headers});
    }

    const version = integer(input.version, '저장 버전', 1, Number.MAX_SAFE_INTEGER - 1);
    const previous = (await db.query<Row>('SELECT id,data FROM nh_documents WHERE ' + owned, key)).rows[0];
    if (!previous) throw new MarketError('수익 항목을 찾을 수 없습니다.', 404);
    if (previous.data.version !== version) throw conflict();
    if (input.action === 'remove') {
      const removed = await db.query('DELETE FROM nh_documents WHERE ' + owned + " AND data->>'version'=$3 RETURNING id", [...key, String(version)]);
      if (!removed.rows.length) throw conflict();
      return Response.json({id:input.id}, {headers});
    }
    if (input.action !== 'update') throw new MarketError('수익 작업을 확인해 주세요.');
    const data = {...draftFrom(input), ownerId:actor.id, version:version + 1};
    const updated = await db.query<Row>('UPDATE nh_documents SET data=$3,updated=clock_timestamp() WHERE ' + owned + " AND data->>'version'=$4 RETURNING id,data",
      [...key, JSON.stringify(data), String(version)]);
    if (!updated.rows.length) throw conflict();
    return Response.json({entry:clientRow(updated.rows[0])}, {headers});
  } catch (error) {
    return rejected(error);
  }
}
