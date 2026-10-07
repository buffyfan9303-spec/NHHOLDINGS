import type {Product,Settings} from './types';
export const initialSettings:Settings = {
 brand:'NURI MARKET',
 seller:{company:'엔에이치홀딩스',representative:'김윤혜',businessNumber:'525-20-02937',commerceNumber:'',address:'경기도 남양주시 다산중앙로82번안길 166-46, 207-본244호(다산동, 파인듀파크빌딩)',phone:'',email:'',hosting:'Vercel Inc.',escrowUrl:''},
 shipping:{fee:3000,freeThreshold:70000,remoteFee:0,returnFee:3000,returnAddress:'',cutoff:''},
 policiesApproved:false,shippingReady:false,notificationReady:false
};
const safe = {audience:'unknown' as const,age:'실제 상품의 대상 연령 확인 전',certification:'pending' as const,certificateNumber:'',certificateUrl:'',license:'pending' as const,licenseReference:''};
const definitions:[string,string,Product['category'],number,string,string][] = [
 ['pocket-clicker','포켓 클릭커','clicker',18000,'손끝에 작은 리듬','clicker'],
 ['orbit-clicker','오빗 클릭커','clicker',22000,'동그란 형태, 가벼운 재미','orbit'],
 ['little-orbit','리틀 오빗 피규어','figure',16000,'책상 위 작은 친구','figure'],
 ['table-cap','테이블 클럽 볼캡','apparel',39000,'매일 쓰는 테이블 웨어','cap'],
 ['table-tee','테이블 클럽 티셔츠','apparel',42000,'편안하게 오래 입는 한 벌','tee'],
 ['card-guard','테이블 카드 가드','gear',14000,'테이블 위 나만의 표시','gear'],
 ['soft-clicker','소프트 포켓 클릭커','clicker',19000,'조용한 순간을 위한 콘셉트','soft'],
 ['pocket-keyring','포켓 루프 키링','gear',12000,'가방에 더하는 작은 포인트','keyring']
];
export const sampleProducts:Product[] = definitions.map(([slug,name,category,price,description,asset],index)=>({
 id:slug,slug,name,line:category==='apparel'?'Table club':'Pocket objects',category,price,description,
 images:[`/products/${asset}.webp`], specs:[{label:'상품 상태',value:'디자인 시안 · 실제 판매 상품 아님'},{label:'크기·소재',value:'실제 상품 확정 후 등록'},{label:'이미지',value:'AI로 제작한 NURI MARKET 오리지널 콘셉트 렌더'}],
 variants: (category==='apparel' && slug==='table-tee' ? ['M','L','XL'] : category==='clicker'?['클라우드 블루','밀크 화이트']:['기본']).map((label,i)=>({id:`${slug}-${i}`,label,options:{옵션:label},priceDelta:0,onHand:index===6?0:12+i*3,reserved:0,allocated:0,stock:index===6?0:12+i*3})),
 sample:true,published:true,dropAt:null,safety:{...safe},soundUrl:category==='clicker'?'/audio/sample-click.wav':null
}));
