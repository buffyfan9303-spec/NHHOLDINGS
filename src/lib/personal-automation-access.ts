import type {NextRequest} from 'next/server';
import {identity, accessStatus, canUsePersonalWorkspace} from '@/lib/auth';
import {pool} from '@/server/postgres.cjs';
import {MarketError} from '@/lib/security';
import {uuidPattern} from '@/server/personal-workspace.cjs';

export async function automationActor(req: NextRequest) {
  const user = await identity(req);
  if (!user) throw new MarketError('로그인이 필요합니다.', 401);
  const access = uuidPattern.test(user.id) ? await accessStatus(user) : 'none';
  if (!canUsePersonalWorkspace(access)) {
    throw new MarketError('개인 업무 공간 접근 승인이 필요합니다.', 403);
  }
  if (req.headers.get('X-Personal-Account') !== user.id) {
    throw new MarketError('로그인 계정이 변경됐습니다. 새로고침해 주세요.', 409);
  }
  return {id:user.id,email:user.email!.toLowerCase(),owner:access === 'owner'};
}

export async function canRunPersonalAutomation(actor: string, email: string) {
  if (!uuidPattern.test(actor)) return false;
  if (
    actor===process.env.OPERATOR_USER_ID&&email===process.env.OPERATOR_EMAIL?.trim().toLowerCase()||
    actor===process.env.SECOND_OPERATOR_USER_ID&&email===process.env.SECOND_OPERATOR_EMAIL?.trim().toLowerCase()
  )return true;
  const db = pool();
  const result = await db.query(
    "SELECT 1 FROM nh_documents WHERE workspace='live' AND kind='access' AND id=$1 AND data->>'status'='approved' AND data->>'scope'='personal' AND data->>'email'=$2",
    [actor,email],
  );
  return result.rows.length === 1;
}
