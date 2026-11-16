import Link from "next/link";
export default function NotFound() {
  return <main className="load-state" id="main-content"><h1>페이지를 찾을 수 없습니다.</h1><p>주소를 확인하시거나 NURI MARKET 첫 화면으로 이동해 주세요.</p><Link href="/" className="primary">첫 화면으로</Link></main>;
}
