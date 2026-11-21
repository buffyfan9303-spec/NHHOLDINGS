import {pool} from '@/server/postgres.cjs';
import {MarketError, textValue} from '@/lib/security';

const scope = "workspace='live' AND kind='personal-ai-profile' AND id=$1 AND data->>'ownerId'=$1";
export type PersonalAIProfile = {instructions: string; version: number};

export async function personalAIProfile(actor: string): Promise<PersonalAIProfile> {
  const {rows} = await pool().query<{data: PersonalAIProfile}>(
    'SELECT data FROM nh_documents WHERE ' + scope,
    [actor],
  );
  const saved = rows[0]?.data;
  return saved ? {instructions:saved.instructions,version:saved.version} : {instructions:'',version:0};
}

export async function savePersonalAIProfile(actor: string, input: Record<string,unknown>): Promise<PersonalAIProfile> {
  const instructions = textValue(input.instructions, '일하는 방식', 1200, true);
  const version = input.version;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) {
    throw new MarketError('개인 설정을 다시 불러와 주세요.');
  }
  const next = {instructions,version:version+1};
  const data = JSON.stringify({...next,ownerId:actor});
  const {rows} = version === 0
    ? await pool().query("INSERT INTO nh_documents(workspace,kind,id,data) VALUES('live','personal-ai-profile',$1,$2) ON CONFLICT DO NOTHING RETURNING id", [actor,data])
    : await pool().query("UPDATE nh_documents SET data=$2,updated=clock_timestamp() WHERE "+scope+" AND data->>'version'=$3 RETURNING id", [actor,data,String(version)]);
  if (!rows.length) throw new MarketError('다른 화면에서 개인 설정이 바뀌었습니다. AI 비서를 다시 열어 주세요.',409);
  return next;
}
