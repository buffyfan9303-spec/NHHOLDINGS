import { notFound } from "next/navigation";
import Market from "@/components/market";
import { isMarketSection } from "@/lib/routes";
export default async function Page({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  if (!isMarketSection(slug)) notFound();
  return <Market path={slug} />;
}
