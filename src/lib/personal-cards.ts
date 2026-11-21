import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {NextRequest} from 'next/server';
import {accessStatus, canUsePersonalWorkspace, identity} from './auth';
import {hash, MarketError} from './security';
import {pool} from '../server/postgres.cjs';

export const personalCardThemes = ['mint', 'cobalt', 'ink'] as const;
type Theme = typeof personalCardThemes[number];
export type PersonalCardSlide = {headline: string; body: string; label: string | null};
export type PersonalCardBlueprint = {title: string; theme: Theme; slides: PersonalCardSlide[]};
export type PersonalCard = PersonalCardBlueprint & {id: string; createdAt: string};
type StoredCard = PersonalCard & {ownerId: string};
const cardId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const scope = "workspace='live' AND kind='personal-card'";
const pageSize = 12;
const key = (actor: string, id: string) => hash(actor) + ':' + id;

export const personalCardHeaders = {'Cache-Control': 'private, no-store', 'Cross-Origin-Resource-Policy': 'same-origin'};

export async function requirePersonalCardActor(req: NextRequest, sameAccount = true) {
  const user = await identity(req);
  if (!user || !canUsePersonalWorkspace(await accessStatus(user))) throw new MarketError('개인 공간에 접근할 수 없습니다.', 403);
  if (sameAccount && req.headers.get('x-personal-account') !== user.id) throw new MarketError('로그인 계정이 변경됐습니다. 새로고침 후 다시 시도해주세요.', 409);
  return user.id;
}

export function personalCardError(error: unknown) {
  if (error instanceof MarketError) return Response.json({error: error.message}, {status: error.status, headers: personalCardHeaders});
  console.error('[personal-card]', error instanceof Error ? error.name : 'UnknownError');
  return Response.json({error: '카드뉴스를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'}, {status: 503, headers: personalCardHeaders});
}

function object(value: unknown): {[field: string]: unknown} {
  if (typeof value !== 'object' || !value || Array.isArray(value)) throw new MarketError('카드뉴스 형식을 확인해 주세요.');
  return value as {[field: string]: unknown};
}

function cleanText(value: unknown, max: number, name: string, optional = false) {
  if (optional && (value === null || value === undefined)) return '';
  if (typeof value !== 'string' || value.length > max * 4) throw new MarketError(name + ' 길이를 확인해 주세요.');
  const normalized = value.toWellFormed().normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, ' ');
  const cleaned = normalized.replace(/\s+/g, ' ').trim();
  if ((!optional && !cleaned) || Array.from(cleaned).length > max) throw new MarketError(name + ' 길이를 확인해 주세요.');
  return cleaned;
}

export function validatePersonalCard(input: unknown): PersonalCardBlueprint {
  const draft = object(input);
  const title = cleanText(draft.title, 64, '카드뉴스 제목');
  const theme = draft.theme ?? 'mint';
  if (!personalCardThemes.includes(theme as Theme)) throw new MarketError('카드뉴스 테마를 확인해 주세요.');
  if (!Array.isArray(draft.slides) || draft.slides.length < 1 || draft.slides.length > 8) throw new MarketError('카드뉴스는 1~8장으로 구성해 주세요.');
  const slides = draft.slides.map(value => {
    const slide = object(value);
    return {
      headline: cleanText(slide.headline, 58, '카드 제목'),
      body: cleanText(slide.body, 180, '카드 본문', true),
      label: cleanText(slide.label, 28, '카드 분류', true) || null,
    };
  });
  return {title, theme: theme as Theme, slides};
}

function expose(card: StoredCard): PersonalCard {
  const {id, title, theme, slides, createdAt} = card;
  return {id, title, theme, slides, createdAt};
}

export async function createPersonalCard(actor: string, input: unknown, db:Pick<PoolClient,'query'>=pool()): Promise<PersonalCard> {
  const blueprint = validatePersonalCard(input);
  const card = {...blueprint, ownerId: actor, id: randomUUID(), createdAt: new Date().toISOString()};
  await db.query("INSERT INTO nh_documents(workspace,kind,id,data) VALUES('live','personal-card',$1,$2)",
    [key(actor, card.id), JSON.stringify(card)]);
  return expose(card);
}

export async function listPersonalCards(actor: string, before?: string | null) {
  if (before != null && !cardId.test(before)) throw new MarketError('목록 위치를 확인해 주세요.');
  const prefix = hash(actor) + ':%';
  const cursor = before ? key(actor, before) : null;
  const {rows} = await pool().query<{data: StoredCard}>(
    "SELECT data FROM nh_documents WHERE " + scope + " AND id LIKE $1 AND data->>'ownerId'=$2 " +
    "AND ($3::text IS NULL OR (updated,id) < (SELECT updated,id FROM nh_documents WHERE " + scope + " AND id=$3 AND data->>'ownerId'=$2)) " +
    'ORDER BY updated DESC,id DESC LIMIT $4',
    [prefix, actor, cursor, pageSize + 1],
  );
  return {cards: rows.slice(0, pageSize).map(row => expose(row.data)), nextPage: rows.length > pageSize ? rows[pageSize - 1].data.id : null};
}

export async function getPersonalCard(actor: string, id: string) {
  if (!cardId.test(id)) throw new MarketError('카드뉴스를 찾을 수 없습니다.', 404);
  const {rows} = await pool().query<{data: StoredCard}>(
    "SELECT data FROM nh_documents WHERE " + scope + " AND id=$1 AND data->>'ownerId'=$2", [key(actor, id), actor],
  );
  if (!rows[0]) throw new MarketError('카드뉴스를 찾을 수 없습니다.', 404);
  return expose(rows[0].data);
}
