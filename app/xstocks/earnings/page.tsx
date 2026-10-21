import type { Metadata } from "next";
import { EarningsBuilder } from "@/components/xstocks/earnings-builder";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "xStocks Earnings",
  description: "Public xStocks Earnings card builder — pre/post-market reaction around the print, on-chain.",
  robots: {
    index: true,
    follow: true,
  },
};

export default function XstocksEarningsPage() {
  return <EarningsBuilder />;
}
