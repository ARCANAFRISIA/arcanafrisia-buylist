// src/app/page.tsx  (Server Component)
import QuoteClient from "./QuoteClient";
import { getPayoutPct } from "@/lib/config";

export default async function Page() {
  const payoutPct = getPayoutPct(); // bv. 0.70 uit env

  // 2-conditie model:
  // NM/EX = 1.0  |  GD/LP = 0.9  (10% minder)
  const condMap = {
    NMEX: 1.0,
    GDLP: 0.9,
  } as const;

  return <QuoteClient payoutPct={payoutPct} condMap={condMap} />;
}
