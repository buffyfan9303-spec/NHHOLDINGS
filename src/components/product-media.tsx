"use client";
import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { request } from "./market";

type Media = { id: string; url: string; mime: string; size: number; createdAt: string };

export default function ProductMedia({ images, productName, onChange, onUploadingChange, disabled = false }: { images: string[]; productName: string; onChange: (update: (previous: string[]) => string[]) => void; onUploadingChange: (uploading: boolean) => void; disabled?: boolean }) {
  const [media, setMedia] = useState<Media[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function load() { try { setMedia((await request<{ media: Media[] }>("/api/admin/media")).media); setError(""); } catch (e) { setError((e as Error).message); } }
  useEffect(() => { void load(); }, []);
  async function upload(files: FileList | null) {
    if (!files?.length || uploading || disabled) return;
    setError(""); setMessage("");
    const selected = Array.from(files);
    if (images.filter(Boolean).length + selected.length > 12) { setError("상품 이미지는 최대 12장입니다. 기존 사진을 제외한 뒤 업로드해 주세요."); return; }
    if (selected.some(file => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 4_000_000)) { setError("사진마다 4MB 이하인 JPG, PNG, WebP 파일을 선택해 주세요."); return; }
    setUploading(true); onUploadingChange(true);
    let completed = 0;
    try {
      for (const file of selected) {
        const form = new FormData(); form.set("file", file);
        const response = await fetch("/api/admin/media", { method: "POST", body: form });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "이미지 업로드를 완료하지 못했습니다.");
        if (typeof result.url !== "string" || !result.url.startsWith("/")) throw new Error("업로드 결과의 이미지 주소를 확인할 수 없습니다.");
        onChange(previous => [...previous.filter(Boolean), result.url].slice(0,12));
        completed++;
      }
      setMessage(`${completed}장을 업로드했습니다. 상품 저장을 눌러 반영해 주세요.`);
      await load();
    } catch (e) { setError(`${completed ? `${completed}장은 업로드했습니다. ` : ""}${(e as Error).message}`); }
    finally { setUploading(false); onUploadingChange(false); }
  }
  function move(index: number, direction: number) { onChange(previous => { const next = [...previous]; [next[index], next[index+direction]] = [next[index+direction], next[index]]; return next; }); }
  return <section className="product-media-manager" aria-label="상품 이미지 관리">
    <label className="field">상품 사진 업로드<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={disabled || uploading || images.filter(Boolean).length >= 12} onChange={event => { void upload(event.target.files); event.target.value = ""; }}/></label>
    <p className="hint">사진은 상품 페이지에서 공개됩니다. 개인정보·인증서·거래 자료가 포함된 사진은 올리지 마세요.</p><p className="hint">JPG·PNG·WebP, 장당 최대 4MB. 사진을 선택하면 업로드하며 상품 저장 후 화면에 반영합니다. 대표 사진은 첫 번째, 피규어 실측 비교 사진은 두 번째에 배치하세요.</p>
    {uploading && <p className="media-status" role="status">이미지를 확인하고 업로드하는 중입니다.</p>}
    {error && <p className="error-text" role="alert">{error}</p>}{message && <p className="success-text" role="status">{message}</p>}
    <div className="media-selected">{images.map((url,index) => url ? <article key={`${url}-${index}`}><img src={url} width="160" height="160" alt={`${productName || "상품"} 이미지 ${index+1}`}/><div className="media-image-caption"><strong>{index === 0 ? "대표 사진" : `${index+1}번 사진`}</strong><div><button type="button" className="icon-button" disabled={disabled || uploading || index === 0} onClick={() => move(index,-1)} aria-label={`${index+1}번 사진을 앞으로 이동`}><span aria-hidden="true">↑</span></button><button type="button" className="icon-button" disabled={disabled || uploading || index === images.length-1} onClick={() => move(index,1)} aria-label={`${index+1}번 사진을 뒤로 이동`}><span aria-hidden="true">↓</span></button><button type="button" className="icon-button" disabled={disabled||uploading} onClick={() => onChange(previous => previous.filter((_,i) => i !== index))} aria-label={`${index+1}번 사진을 상품에서 제외`}><Icon name="close" size={14}/></button></div></div></article> : null)}</div>
    <details className="media-library"><summary>업로드한 이미지에서 선택</summary><p className="hint">사진을 선택해 현재 상품에 추가할 수 있습니다. 상품에서 제외해도 업로드 파일 자체는 삭제하지 않습니다.</p><button type="button" className="text-button" onClick={load} disabled={disabled||uploading}>목록 새로고침</button>{media.length ? <div className="media-library-grid">{media.map(item => <button key={item.id} type="button" disabled={disabled || uploading || images.includes(item.url) || images.filter(Boolean).length >= 12} onClick={() => onChange(previous => [...previous.filter(Boolean),item.url].slice(0,12))} aria-label={`업로드 이미지 ${item.id} 상품에 추가`}><img src={item.url} width="120" height="120" alt="업로드 이미지 미리보기"/><span>{images.includes(item.url) ? "추가됨" : "추가"}</span></button>)}</div> : <p className="muted">업로드한 이미지가 없습니다.</p>}</details>
  </section>;
}

export function ProductAudio({ url, disabled, onChange, onUploadingChange }: { url: string | null | undefined; disabled: boolean; onChange: (url: string | null) => void; onUploadingChange: (uploading: boolean) => void }) {
  const [uploading,setUploading] = useState(false);
  const [error,setError] = useState("");
  const [message,setMessage] = useState("");
  async function upload(file:File | undefined) {
    if (!file || uploading || disabled) return;
    setError("");setMessage("");
    if (!/\.wav$/i.test(file.name) || file.size > 2_000_000) { setError("2MB 이하의 PCM WAV 파일을 선택해 주세요. 재생 길이는 5초 이하여야 합니다.");return; }
    setUploading(true);onUploadingChange(true);
    try {
      const form=new FormData();form.set("file",file);
      const response=await fetch("/api/admin/audio",{method:"POST",body:form});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error??"음원을 업로드하지 못했습니다.");
      if(typeof result.url!=="string"||!result.url.startsWith("/"))throw new Error("업로드한 음원 주소를 확인하지 못했습니다.");
      onChange(result.url);setMessage("음원을 업로드했습니다. 상품 저장을 눌러 반영해 주세요.");
    }catch(e){setError((e as Error).message);}
    finally{setUploading(false);onUploadingChange(false);}
  }
  return <section className="product-audio-manager"><label className="field">실제 클릭 녹음 업로드<input type="file" accept=".wav,audio/wav,audio/x-wav" disabled={disabled||uploading} onChange={event=>{void upload(event.target.files?.[0]);event.target.value="";}}/></label><p className="hint">PCM WAV · 최대 5초 · 2MB 이하. 본인이 사용할 권리가 있는 실제 상품 녹음을 등록하세요. 음원은 상품 페이지에서 공개되므로 사람의 대화나 개인정보가 포함된 파일은 올리지 마세요.</p>{uploading&&<p className="media-status" role="status">녹음 파일을 확인하고 업로드하는 중입니다.</p>}{error&&<p className="error-text" role="alert">{error}</p>}{message&&<p className="success-text" role="status">{message}</p>}{url&&<><audio controls preload="none" src={url} aria-label="등록된 클릭 음원 미리듣기"/><button type="button" className="text-button" disabled={disabled||uploading} onClick={()=>onChange(null)}>상품에서 음원 제외</button></>}</section>;
}
