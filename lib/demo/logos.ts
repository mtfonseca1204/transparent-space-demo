export const DEMO_TOKEN_LOGO_BY_SYMBOL: Record<string, string> = {
  AZR: "/demo/logos/azr.svg",
  BOR: "/demo/logos/bor.svg",
  CYR: "/demo/logos/cyr.svg",
  DOV: "/demo/logos/dov.svg",
  ELA: "/demo/logos/ela.svg",
  FAR: "/demo/logos/far.svg",
  GLM: "/demo/logos/glm.svg",
  HEL: "/demo/logos/hel.svg",
  IVR: "/demo/logos/ivr.svg",
  JUR: "/demo/logos/jur.svg",
  LYR: "/demo/logos/lyr.svg",
  KAI: "/demo/logos/kai.svg",
};

export function getDemoTokenLogo(symbol?: string | null): string | null {
  const normalized = symbol?.trim().toUpperCase().replace(/\.E$/, "") ?? "";
  return DEMO_TOKEN_LOGO_BY_SYMBOL[normalized] ?? null;
}
