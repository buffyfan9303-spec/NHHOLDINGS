"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Order } from "@/lib/types";
import { money } from "@/lib/types";
import { readLocal, request } from "./market";
import { Icon } from "./icons";

type Widgets = {
  setAmount: (value: { currency: string; value: number }) => Promise<void>;
  renderPaymentMethods: (value: { selector: string; variantKey: string }) => Promise<unknown>;
  renderAgreement: (value: { selector: string; variantKey: string }) => Promise<unknown>;
  requestPayment: (value: { orderId: string; orderName: string; successUrl: string; failUrl: string; customerEmail: string; customerName: string }) => Promise<void>;
};
type TossConstructor = ((clientKey: string) => { widgets: (options: { customerKey: string }) => Widgets }) & { ANONYMOUS: string };
declare global { interface Window { TossPayments?: TossConstructor } }

export default function Payment({ order, token, clientKey, result }: { order?: Order; token?: string; clientKey?: string | null; result?: string }) {
  const [widgets, setWidgets] = useState<Widgets | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState<Order | null>(null);
  const [resultId, setResultId] = useState("");
  useEffect(() => {
    let active = true;
    async function initialize() {
      if (!order || !clientKey) return;
      try {
        if (!window.TossPayments) await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script"); script.src = "https://js.tosspayments.com/v2/standard"; script.onload = () => resolve(); script.onerror = () => reject(new Error("결제창을 불러오지 못했습니다. 주문은 마이페이지에서 확인해 주세요.")); document.head.appendChild(script);
        });
        if (!active || !window.TossPayments) return;
        const instance = window.TossPayments(clientKey).widgets({ customerKey: window.TossPayments.ANONYMOUS });
        await instance.setAmount({ currency: "KRW", value: order.total });
        if (!active) return;
        await instance.renderPaymentMethods({ selector: "#payment-methods", variantKey: "DEFAULT" });
        await instance.renderAgreement({ selector: "#payment-agreement", variantKey: "AGREEMENT" });
        if (active) setWidgets(instance);
      } catch (e) { if (active) setError((e as Error).message); }
    }
    void initialize();
    return () => { active = false; };
  }, [order, clientKey]);
  useEffect(() => {
    if (!result) return;
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get("orderId") ?? "";
    setResultId(orderId);
    if (result !== "success") { setError(params.get("message") ?? "결제가 완료되지 않았습니다. 주문 상태를 확인한 후 다시 진행해 주세요."); return; }
    const access = readLocal<Record<string,string>>("nuri-market-order-access", {})[orderId];
    const paymentKey = params.get("paymentKey");
    const amount = Number(params.get("amount"));
    if (!access || !orderId || !paymentKey || !Number.isSafeInteger(amount) || amount <= 0) { setError("결제 승인 정보를 확인할 수 없습니다. 주문 조회에서 상태를 확인해 주세요."); return; }
    setBusy(true);
    void request<{ order: Order }>("/api/payments/confirm", { orderId, paymentKey, amount }, access).then(response => setConfirmed(response.order)).catch(e => setError((e as Error).message)).finally(() => setBusy(false));
  }, [result]);
  async function pay() {
    if (!widgets || !order || !token) return;
    setBusy(true); setError("");
    try { await widgets.requestPayment({ orderId: order.id, orderName: order.items.length > 1 ? `${order.items[0].name} 외 ${order.items.length-1}건` : order.items[0].name, successUrl: `${window.location.origin}/payment/success`, failUrl: `${window.location.origin}/payment/fail`, customerEmail: order.customer.email, customerName: order.customer.name }); }
    catch(e) { setError((e as Error).message); setBusy(false); }
  }
  if (result) return <div className="result-screen"><Icon name={confirmed ? "check" : error ? "close" : "shield"} size={48}/><h1>{confirmed ? "결제 상태를 확인했습니다" : busy ? "결제 승인 확인 중" : "결제 결과 확인"}</h1><p>{confirmed ? `${confirmed.number} / ${money(confirmed.total)}` : "서버에서 주문 금액과 결제사 결과를 대사합니다."}</p>{error && <p className="error-text" role="alert">{error}</p>}<Link className="primary" href={resultId ? `/order/${resultId}` : "/my"}>주문 상태 보기</Link></div>;
  return <div className="toss-payment"><div id="payment-methods"/><div id="payment-agreement"/>{!clientKey && <p className="error-text">결제사 계약 및 연동 설정을 확인 중입니다. 실제 결제를 진행할 수 없습니다.</p>}{error && <p className="error-text" role="alert">{error}</p>}<button className="primary full" onClick={pay} disabled={!widgets || busy}>{busy ? "결제 진행 중" : `${money(order?.total ?? 0)} 결제하기`}</button></div>;
}
