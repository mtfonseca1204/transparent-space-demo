import type { Metadata } from "next";
import { WeekendMoversBuilder } from "@/components/xstocks/weekend-movers-builder";
import {
  fetchXstocksWeekendMoversTemplate,
  type XstocksWeekendMoversTemplateResponse,
} from "@/lib/solana-indexer-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "xStocks Weekend Movers",
  description: "Public xStocks Weekend Movers image builder powered by Transparent Space data.",
  robots: {
    index: true,
    follow: true,
  },
};

export default async function XstocksPage() {
  let template: XstocksWeekendMoversTemplateResponse | null = null;
  let error: string | undefined;

  try {
    template = await fetchXstocksWeekendMoversTemplate();
  } catch (err) {
    error = err instanceof Error ? err.message : "Weekend movers data is unavailable.";
  }

  return <WeekendMoversBuilder error={error} template={template} />;
}
