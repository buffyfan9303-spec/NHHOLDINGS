import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "NURI MARKET | 작은 취향, 가까운 일상", template: "%s | NURI MARKET" },
  description: "클릭커, 작은 오브제, 홀덤 의류와 굿즈를 만나는 NURI MARKET. 현재 샘플 컬렉션으로 제작 중입니다.",
  robots: { index: false, follow: false },
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko" data-scroll-behavior="smooth"><head><link rel="stylesheet" href="/market-motion.css"/></head><body>{children}</body></html>;
}
