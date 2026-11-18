import {MarketError} from './security';
import {getDB} from './db';

type InquiryRow = {id: string; subject: string; content: string; reply: string; created_at: string | Date};

export async function operatorInquiries(page: number, id?: string) {
  if (id && !/^[a-f0-9-]{36}$/i.test(id)) throw new MarketError('문의 항목을 확인하세요.', 400);
  const database = await getDB();
  const total = Number((await database.query<{total: string}>(
    "SELECT count(*) AS total FROM mkt_inquiries i JOIN mkt_orders o ON o.id=i.order_id WHERE NOT o.is_demo",
  )).rows[0].total);
  const pageSize = 20;
  const current = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
  const select = "SELECT i.id,i.subject,i.content,i.reply,i.created_at FROM mkt_inquiries i JOIN mkt_orders o ON o.id=i.order_id WHERE NOT o.is_demo";
  const records = id
    ? await database.query<InquiryRow>(select + ' AND i.id=$1', [id])
    : await database.query<InquiryRow>(select + ' ORDER BY i.created_at DESC,i.id DESC LIMIT $1 OFFSET $2', [pageSize,(current-1)*pageSize]);
  return {rows:records.rows.map(row=>({
    id:'market-'+row.id,kind:'market',subject:row.subject,body:row.content,
    answered:!!row.reply,createdAt:new Date(row.created_at).toISOString(),sourceLink:'/nurimarket/admin',
  })),total,page:current,pageSize};
}
