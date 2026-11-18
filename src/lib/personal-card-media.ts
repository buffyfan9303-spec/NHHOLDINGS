import {ownerEmail, type AccessRecord} from './auth';
import {MarketError, marketOrigin, seal, unseal} from './security';
import {getPersonalCard} from './personal-cards';
import {pool} from '../server/postgres.cjs';

const purpose = 'personal-sns-card-image';
const ttl = 15 * 60_000;
const idPattern = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/;
const slidePattern = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 8;

async function actorRetainsAccess(actor: string) {
  if ((actor === process.env.OPERATOR_USER_ID && ownerEmail()) ||
    (actor === process.env.SECOND_OPERATOR_USER_ID && process.env.SECOND_OPERATOR_EMAIL?.trim())) return true;
  const {rows} = await pool().query<{data: AccessRecord}>(
    "SELECT data FROM nh_documents WHERE workspace='live' AND kind='access' AND id=$1", [actor],
  );
  const grant = rows[0]?.data;
  return grant?.status === 'approved' && grant.scope === 'personal' && Boolean(grant.email);
}

// Called by the SNS worker after it validates the account and claims an approved post.
export async function mintPersonalCardImage(actor: string, cardId: string, slide: number) {
  if (!idPattern.test(actor) || !slidePattern(slide) || !(await actorRetainsAccess(actor))) {
    throw new MarketError('발송할 카드를 확인할 수 없습니다.', 404);
  }
  const card = await getPersonalCard(actor, cardId);
  if (!card.slides[slide]) throw new MarketError('발송할 카드를 확인할 수 없습니다.', 404);
  const url = new URL('/api/personal/ai/card-media/' + card.id + '.jpg', marketOrigin());
  if (url.protocol !== 'https:') throw new MarketError('카드뉴스 발행에 사용할 HTTPS 주소를 확인해 주세요.', 503);
  const issuedAt = Date.now();
  const token = seal(JSON.stringify({purpose, actor, cardId: card.id, slide, issuedAt, expiresAt: issuedAt + ttl}));
  url.searchParams.set('token', token);
  return url.href;
}

function parseGrant(file: string, token: string) {
  if (token.length > 1024 || !token || file.length !== 40 || !file.endsWith('.jpg')) return null;
  try {
    const data = JSON.parse(unseal(token));
    const now = Date.now();
    if (data.purpose !== purpose || typeof data.actor !== 'string' || !idPattern.test(data.actor) ||
      typeof data.cardId !== 'string' || file !== data.cardId + '.jpg' || !slidePattern(data.slide) ||
      !Number.isSafeInteger(data.issuedAt) || !Number.isSafeInteger(data.expiresAt) ||
      data.issuedAt > now || data.expiresAt <= now || data.expiresAt !== data.issuedAt + ttl) return null;
    return {actor: data.actor as string, cardId: data.cardId as string, slide: data.slide};
  } catch {return null;}
}

export async function getPersonalCardMedia(file: string, token: string) {
  const grant = parseGrant(file, token);
  if (!grant || !(await actorRetainsAccess(grant.actor))) return null;
  try {
    const card = await getPersonalCard(grant.actor, grant.cardId);
    return card.slides[grant.slide] ? {card, slide: grant.slide} : null;
  } catch (error) {
    if (error instanceof MarketError && error.status === 404) return null;
    throw error;
  }
}
