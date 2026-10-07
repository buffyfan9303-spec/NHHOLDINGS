"use client";
import {Fragment,useEffect,useId,useState} from 'react';
import type {Inquiry,InquiryPage} from '@/lib/types';
import {Icon} from './icons';

const date=(value:string)=>new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'});
type Mutate=(body:unknown,success?:string)=>Promise<boolean>;

export function InquiryReply({inquiry,busy,mutate,onSaved}:{inquiry:Inquiry;busy:boolean;mutate:Mutate;onSaved?:()=>void}){
 const replyId=useId();
 const [editing,setEditing]=useState(false),[reply,setReply]=useState(''),[expected,setExpected]=useState(''),[failed,setFailed]=useState(false);
 return <div className="inquiry-reply">
  {inquiry.reply&&<><p className="reply">{inquiry.reply}</p><small>{inquiry.repliedAt?`답변 저장 ${date(inquiry.repliedAt)}`:'이전 답변 · 저장 시각 미기록'}</small></>}
  {!editing?<button className="secondary compact" disabled={busy} onClick={()=>{setReply(inquiry.reply);setExpected(inquiry.reply);setFailed(false);setEditing(true);}}>{inquiry.reply?'답변 수정':'답변 작성'}</button>:
   <form className="reply-form" onSubmit={async e=>{e.preventDefault();setFailed(false);if(await mutate({action:'inquiry.reply',inquiryId:inquiry.id,reply,expectedReply:expected},'답변을 저장했습니다. 고객 주문 조회에 반영됩니다.')){setEditing(false);onSaved?.();}else setFailed(true);}}>
    <div className="field"><label htmlFor={replyId}>고객에게 보낼 답변</label><textarea id={replyId} required maxLength={2000} rows={5} value={reply} onChange={e=>setReply(e.target.value)} placeholder="문의 내용과 배송 상태를 확인한 뒤 답변해 주세요."/></div>
    <div className="reply-form-footer"><span>{reply.length} / 2,000자 · 해당 주문 고객에게 표시</span><div className="button-row"><button type="button" className="secondary compact" disabled={busy} onClick={()=>setEditing(false)}>작성 취소</button><button className="primary compact" disabled={busy||!reply.trim()||reply.trim()===expected}>{busy?'저장 중…':'답변 저장'}</button></div></div>
    {failed&&<p className="error-text" role="alert">답변을 저장하지 못했습니다. 입력 내용과 상단 오류 안내를 확인해주세요. 다른 화면에서 답변이 바뀌었다면 목록을 새로고침한 후 다시 작성해주세요.</p>}
   </form>}
 </div>;
}

export default function InquiryManager({revision,busy,mutate,onOrder}:{revision:unknown;busy:boolean;mutate:Mutate;onOrder:(id:string)=>void}){
 const [q,setQ]=useState(''),[draft,setDraft]=useState(''),[status,setStatus]=useState('unanswered'),[page,setPage]=useState(1),[result,setResult]=useState<InquiryPage|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[open,setOpen]=useState<string|null>(null);
 useEffect(()=>{
  let active=true,controller:AbortController;
  const load=async()=>{controller?.abort();controller=new AbortController();const current=controller;setLoading(true);try{const response=await fetch(`/api/admin/inquiries?${new URLSearchParams({q,status,page:String(page)})}`,{signal:current.signal,cache:'no-store'}),next=await response.json();if(!response.ok)throw new Error(next.error??'문의를 조회하지 못했습니다.');if(active){setResult(next);setError('');if(next.page!==page)setPage(next.page);}}catch(e){if(active&&(e as Error).name!=='AbortError')setError((e as Error).message);}finally{if(active&&!current.signal.aborted)setLoading(false);}};
  void load();const timer=setInterval(()=>{if(document.visibilityState==='visible'&&!busy&&!open)void load();},30000);return()=>{active=false;controller?.abort();clearInterval(timer);};
 },[q,status,page,revision,refresh,busy,open]);
 const resetPage=()=>{setPage(1);setOpen(null);};
 return <section className="admin-panel inquiry-manager">
  <div className="panel-heading"><div><span className="eyebrow">CUSTOMER CARE</span><h2>Q&A 문의 목록</h2><p className="muted">주문·배송 문의를 확인하고 고객에게 답변합니다.</p></div><button className="secondary compact" disabled={loading} onClick={()=>setRefresh(v=>v+1)}>문의 새로고침</button></div>
  <div className="status-switches" aria-label="문의 상태">
   {([['unanswered','미답변'],['answered','답변완료'],['all','전체']] as const).map(([key,label])=><button key={key} className={status===key?'active':''} aria-pressed={status===key} onClick={()=>{setStatus(key);resetPage();}}>{label}<strong>{result?.counts[key]??'—'}</strong></button>)}
  </div>
  <form className="order-filters" onSubmit={e=>{e.preventDefault();setQ(draft.trim());resetPage();}}><label className="order-search"><Icon name="search" size={18}/><input aria-label="문의 검색" maxLength={100} value={draft} onChange={e=>setDraft(e.target.value)} placeholder="문의·답변 내용, 주문번호, 고객명, 연락처"/></label><button className="primary compact">검색</button><button type="button" className="text-button" onClick={()=>{setQ('');setDraft('');resetPage();}}>초기화</button></form>
  <div className="order-list-meta"><strong>{loading?'조회 중…':`문의 ${result?.total??0}건`}</strong><span>검색 조건 내 전체 이력 · 20건씩 · 최신 접수순 · 한국 시각</span></div>
  {error&&<p role="alert" className="error-text">{error}</p>}
  <div className="table-wrap" aria-busy={loading}><table className="inquiries-table"><thead><tr><th>접수일 · 상태</th><th>고객 · 연결 주문</th><th>문의 내용</th><th>답변</th></tr></thead><tbody>{result?.inquiries.map(inquiry=><Fragment key={inquiry.id}>
   <tr><td><small>{date(inquiry.createdAt)}</small><span className={`tag ${inquiry.reply?'blue':'claim-tag'}`}>{inquiry.reply?'답변완료':'미답변'}</span>{inquiry.isDemo&&<span className="tag">체험</span>}</td><td><strong>{inquiry.customerName??'주문 연결 없음'}</strong><small>{inquiry.customerPhone}</small>{inquiry.orderId&&<button className="table-link" onClick={()=>onOrder(inquiry.orderId!)}>{inquiry.orderNumber}</button>}</td><td><strong>{inquiry.subject}</strong><p className="inquiry-preview">{inquiry.content}</p></td><td><button className="secondary compact" aria-expanded={open===inquiry.id} onClick={()=>setOpen(open===inquiry.id?null:inquiry.id)}>{open===inquiry.id?'접기':inquiry.reply?'답변 확인':'답변하기'}</button></td></tr>
   {open===inquiry.id&&<tr className="inquiry-expanded"><td colSpan={4}><div className="inquiry-full"><strong>{inquiry.subject}</strong><p>{inquiry.content}</p><InquiryReply inquiry={inquiry} busy={busy} mutate={mutate} onSaved={()=>{setOpen(null);setRefresh(v=>v+1);}}/></div></td></tr>}
  </Fragment>)}</tbody></table>{!result&&loading?<p role="status" className="table-empty">문의를 조회하고 있습니다…</p>:!result?.total&&!error&&<p className="table-empty">조건에 맞는 문의가 없습니다.</p>}</div>
  <div className="order-pagination"><span>{result?.total?`${(result.page-1)*20+1}–${Math.min(result.page*20,result.total)} / ${result.total}건`:'0건'}</span><nav aria-label="문의 페이지"><button className="secondary compact" disabled={page<=1||loading} onClick={()=>{setPage(v=>v-1);setOpen(null);}}>이전</button><strong>{result?.page??1} / {Math.max(1,Math.ceil((result?.total??0)/20))}</strong><button className="secondary compact" disabled={page*20>=(result?.total??0)||loading} onClick={()=>{setPage(v=>v+1);setOpen(null);}}>다음</button></nav></div>
 </section>;
}
