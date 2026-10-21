import type { Metadata } from "next";

const FAVICON_SVG =
  "data:image/svg+xml,%3Csvg viewBox='0 0 64 64' fill='none' stroke='%23ffffff' stroke-width='3' xmlns='http://www.w3.org/2000/svg'%3E%3Crect x='19.5' y='3.5' width='41' height='41'/%3E%3Crect x='11.5' y='11.5' width='41' height='41'/%3E%3Crect x='3.5' y='19.5' width='41' height='41'/%3E%3C/svg%3E";

const LANDING_TITLE = "Transparent Space - On-Chain Liquidity Operations";
const LANDING_DESCRIPTION =
  "The operations layer for on-chain liquidity. MM SLAs, pool health, RFQ flow, and LP behavior across chains.";
const LANDING_IMAGE = "/og-image.svg";

export const metadata: Metadata = {
  title: LANDING_TITLE,
  description: LANDING_DESCRIPTION,
  keywords: [
    "on-chain liquidity operations",
    "market maker SLAs",
    "pool health",
    "RFQ flow",
    "LP behavior",
    "cross-chain liquidity",
    "RFQ analytics",
    "LP analytics",
    "execution quality",
  ],
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: [{ url: FAVICON_SVG, type: "image/svg+xml" }],
    shortcut: [FAVICON_SVG],
    apple: [{ url: FAVICON_SVG }],
  },
  openGraph: {
    type: "website",
    title: LANDING_TITLE,
    description: LANDING_DESCRIPTION,
    siteName: "Transparent Space",
    url: "https://transparent.space",
    images: [
      {
        url: LANDING_IMAGE,
        width: 1200,
        height: 630,
        alt: "Transparent Space liquidity performance dashboard",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: LANDING_TITLE,
    description: LANDING_DESCRIPTION,
    images: [LANDING_IMAGE],
  },
};

export default function LandingPage() {
  return (
    <main
      className="h-screen w-full overflow-hidden"
      style={{ backgroundColor: "#0A0906" }}
    >
      <iframe
        src="/landing/index.html"
        title="Transparent Space Landing Page"
        className="h-full w-full border-0"
      />
    </main>
  );
}
