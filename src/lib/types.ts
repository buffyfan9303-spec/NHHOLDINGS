export type Category = "clicker" | "figure" | "apparel" | "gear";
export const categories: {id: Category | "all"; label: string}[] = [
  {id:"all",label:"전체"},{id:"apparel",label:"의류·모자"},{id:"clicker",label:"클릭커"},{id:"figure",label:"미니 피규어"},{id:"gear",label:"홀덤 굿즈"}
];
export type Variant = {id:string; label:string; options:Record<string,string>; priceDelta:number; onHand:number; reserved:number; allocated:number; stock:number};
export type Product = {id:string; slug:string; name:string; line:string; category:Category; price:number; description:string; images:string[]; specs:{label:string;value:string}[]; variants:Variant[]; sample:boolean; published:boolean; dropAt:string|null; safety:{audience:"adult"|"child"|"unknown";age:string;certification:"pending"|"verified"|"not_required";certificateNumber:string;certificateUrl:string;license:"original"|"licensed"|"pending";licenseReference:string}; soundUrl?:string|null};
export type Customer = {name:string;phone:string;email:string;postcode:string;address:string;addressDetail:string;note:string};
export type PaymentMethod = "CARD"|"NAVERPAY"|"KAKAOPAY"|"VIRTUAL_ACCOUNT";
export type PaymentStatus = "PENDING"|"WAITING_FOR_DEPOSIT"|"PAID"|"PARTIALLY_REFUNDED"|"REFUNDING"|"REFUNDED"|"FAILED"|"EXPIRED";
export type FulfillmentStatus = "UNFULFILLED"|"PREPARING"|"LABEL_REGISTERED"|"SHIPPED"|"PARTIALLY_SHIPPED"|"DELIVERED";
export type OrderItem = {id:string;productId:string;variantId:string;name:string;variantLabel:string;quantity:number;unitPrice:number;discount:number;total:number;refundedQty:number;shippedQty:number};
export type Shipment = {id:string;orderId:string;carrier:string;trackingNumber:string;status:"LABEL_REGISTERED"|"SHIPPED"|"DELIVERED";shippedAt:string|null;deliveredAt:string|null;createdAt:string};
export type Claim = {id:string;orderId:string;type:"CANCEL"|"RETURN"|"EXCHANGE";status:"REQUESTED"|"APPROVED"|"REJECTED"|"COMPLETED";reason:string;resolution:string;items:{itemId:string;quantity:number}[];createdAt:string};
export type Order = {id:string;number:string;createdAt:string;paymentStatus:PaymentStatus;fulfillmentStatus:FulfillmentStatus;purchaseStatus:"OPEN"|"CONFIRMED";method:PaymentMethod;subtotal:number;discount:number;shipping:number;total:number;refundTotal:number;customer:Customer;items:OrderItem[];shipments:Shipment[];claims:Claim[];isDemo:boolean;dueAt:string|null;deliveredAt:string|null;virtualAccount?:{bank:string;accountNumber:string;dueDate:string}|null;inquiries?:Inquiry[];reviews?:Review[]};
export type Settings = {brand:string;seller:{company:string;representative:string;businessNumber:string;commerceNumber:string;address:string;phone:string;email:string;hosting:string;escrowUrl:string};shipping:{fee:number;freeThreshold:number;remoteFee:number;returnFee:number;returnAddress:string;cutoff:string};policiesApproved:boolean;shippingReady:boolean;notificationReady:boolean};
export type Readiness = {id:string;label:string;ready:boolean;detail:string};
export type CatalogResponse = {products:Product[];settings:Settings;mode:"preview"|"test"|"live";readiness:Readiness[];pgClientKey:string|null;publicReviews?:Omit<Review,'orderId'|'status'>[]};
export type Review = {id:string;orderId:string;productId:string;rating:number;content:string;status:"PENDING"|"APPROVED"|"REJECTED";createdAt:string};
export type Inquiry = {id:string;orderId:string|null;subject:string;content:string;reply:string;repliedAt:string|null;createdAt:string};
export type AdminInquiry = Inquiry & {orderNumber:string|null;customerName:string|null;customerPhone:string|null;isDemo:boolean|null};
export type InquiryPage = {inquiries:AdminInquiry[];total:number;page:number;pageSize:number;counts:{all:number;unanswered:number;answered:number}};
export type Coupon = {code:string;percent:number;maxDiscount:number;minAmount:number;expiresAt:string|null;active:boolean};
export type AdminResponse = CatalogResponse & {orders:Order[];claims:Claim[];reviews:Review[];inquiries:Inquiry[];coupons:Coupon[];events:{id:string;action:string;detail:string;createdAt:string}[];customers:{key:string;name:string;count:number;paid:number}[];methodTotals:Record<PaymentMethod,number>;metrics:{paid:number;refunds:number;orders:number;pending:number;toPrepare:number;openClaims:number;unanswered:number;revenue:number;estimatedSettlement:number|null}};
export type OrderPage = {orders:Order[];total:number;page:number;pageSize:number;shippingCounts:{all:number;pending:number;label:number;transit:number;delivered:number}};
export const carrierLabels:Record<string,string>={CJ:'CJ대한통운',LOTTE:'롯데택배',POST:'우체국택배'};
export const money = (value:number) => new Intl.NumberFormat("ko-KR",{style:"currency",currency:"KRW",maximumFractionDigits:0}).format(value);
export const paymentLabels: Record<PaymentStatus,string> = {PENDING:"결제 대기",WAITING_FOR_DEPOSIT:"입금 대기",PAID:"결제 완료",PARTIALLY_REFUNDED:"부분 환불",REFUNDING:"환불 처리중",REFUNDED:"환불 완료",FAILED:"결제 실패",EXPIRED:"미입금 취소"};
export const fulfillmentLabels: Record<FulfillmentStatus,string> = {UNFULFILLED:"출고 대기",PREPARING:"배송 준비",LABEL_REGISTERED:"송장 등록",SHIPPED:"배송중",PARTIALLY_SHIPPED:"일부 배송",DELIVERED:"배송 완료"};
