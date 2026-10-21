import {
  getMarketMakerDisplayLabel,
  shouldAnonymizeMarketMakers,
} from "@/lib/space-policy";

export type LpMeta = {
  label: string;
  logoSrc?: string | null;
  marketMakerKey?: "flowdesk" | "tokka";
  /** Stand-in dot color for labels that have no logo asset. */
  color?: string;
};

const LP_META_BY_ADDRESS: Record<string, LpMeta> = {
  "0xa35e89d4d5e1a8d00ec24b2bc0cd4fb427309ece": {
    label: "lhava",
    logoSrc: "/mm/lhava.ico",
  },
  "0xb6c9e6451a4b4f65249f60de4fd12da1088a2807": {
    label: "ripio",
    logoSrc: "/mm/ripio.png",
  },
  "0x6cad4a701e6490718775159f1a694b419263db73": {
    label: "Amber",
    logoSrc: "/mm/amber.png",
  },
  "b42ufb14x8rtlfup1bl9szwe5ylrw1yqhf9ng9zfb9ko": {
    label: "Flowdesk",
    logoSrc: "/mm/flowdesk.ico",
    marketMakerKey: "flowdesk",
  },
  // Solana xStocks market makers — colored dots stand in for missing logos.
  // Concentrated variants share the parent's hue at a lighter tone so paired
  // labels are visually grouped at a glance.
  "bpvz4dmqyj7wqhhdzumcrjlv2pphfiij7jvwa6oddeiz": {
    label: "MM1",
    color: "#4F46E5",
  },
  "9lcas74waxrzgu58sycxfwsbudse1mqvz9k9qvaqsqa3": {
    label: "MM1 Conc.",
    color: "#818CF8",
  },
  "t2ldgczsfrhvquttw4hr9shcabqwquv4fhesvkwd8o1": {
    label: "MM2",
    color: "#059669",
  },
  "fcpeh4oze11qjctkhmcu5qnyxtxqbobdwzrcyfye96tg": {
    label: "MM2 Conc.",
    color: "#34D399",
  },
};

export const getLpMeta = (
  address?: string | null,
  spaceSlug?: string | null
): LpMeta | undefined => {
  if (!address) return undefined;
  const meta = LP_META_BY_ADDRESS[address.toLowerCase()];
  if (!meta) return undefined;
  if (!meta.marketMakerKey || !shouldAnonymizeMarketMakers(spaceSlug)) return meta;
  return {
    ...meta,
    label: getMarketMakerDisplayLabel(meta.marketMakerKey, meta.label, spaceSlug),
    logoSrc: null,
  };
};

export const truncateAddress = (address?: string | null): string => {
  const value = (address ?? "").trim();
  if (!value) return "";
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
};

export const formatLpLabel = (
  address?: string | null,
  spaceSlug?: string | null
): string => {
  const meta = getLpMeta(address, spaceSlug);
  return meta?.label ?? truncateAddress(address);
};
