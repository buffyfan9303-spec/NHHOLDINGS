// 쇼핑몰 공개 경로 허용 목록. src/components/market.tsx의 섹션 분기와 같은 값을 쓴다.
// 목록에 없는 첫 경로 조각은 서버에서 404로 끝낸다(soft 404 방지).
export const MARKET_SECTIONS = ['home','search','wishlist','product','cart','checkout','my','order','payment','policy'] as const;
export function isMarketSection(slug:readonly string[]){return slug.length>0&&(MARKET_SECTIONS as readonly string[]).includes(slug[0]);}
