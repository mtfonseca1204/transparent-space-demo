import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_NAME = "Transparent Space";
const SITE_TITLE = "Transparent Space - On-Chain Liquidity Operations";
const SITE_DESCRIPTION =
  "The operations layer for on-chain liquidity. MM SLAs, pool health, RFQ flow, and LP behavior across chains.";
const SITE_KEYWORDS = [
  "DeFi",
  "on-chain liquidity",
  "liquidity operations",
  "market maker SLAs",
  "pool health",
  "RFQ flow",
  "LP behavior",
  "cross-chain liquidity",
  "RFQ analytics",
  "LP analytics",
  "DEX monitoring",
  "market maker monitoring",
  "execution quality",
];

// Set this in prod for correct canonical URLs, OpenGraph images, sitemap, etc.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://transparent.space";
const metadataBase = new URL(SITE_URL);

const VERIFICATION_OTHER: Record<string, string> = {
  ...(process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION
    ? { "msvalidate.01": process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION }
    : {}),
  ...(process.env.NEXT_PUBLIC_PINTEREST_SITE_VERIFICATION
    ? { "p:domain_verify": process.env.NEXT_PUBLIC_PINTEREST_SITE_VERIFICATION }
    : {}),
};

export const metadata: Metadata = {
  metadataBase,
  applicationName: SITE_NAME,
  title: {
    default: SITE_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  keywords: SITE_KEYWORDS,
  authors: [{ name: SITE_NAME }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  category: "finance",
  generator: "Next.js",
  referrer: "origin-when-cross-origin",
  formatDetection: {
    telephone: false,
    address: false,
    email: false,
  },
  alternates: {
    canonical: "/",
  },
  robots:
    process.env.NODE_ENV === "production"
      ? {
          index: true,
          follow: true,
          nocache: false,
          googleBot: {
            index: true,
            follow: true,
            "max-video-preview": -1,
            "max-image-preview": "large",
            "max-snippet": -1,
          },
        }
      : {
          index: false,
          follow: false,
          noarchive: true,
          nosnippet: true,
          googleBot: {
            index: false,
            follow: false,
            noarchive: true,
            nosnippet: true,
          },
        },
  openGraph: {
    type: "website",
    url: "/",
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    locale: "en_US",
    images: [
      {
        url: "/og-image.svg",
        width: 1200,
        height: 630,
        alt: "Transparent Space liquidity performance dashboard",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ["/og-image.svg"],
    site: process.env.NEXT_PUBLIC_TWITTER_SITE,
    creator: process.env.NEXT_PUBLIC_TWITTER_CREATOR,
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    shortcut: ["/icon.svg"],
    apple: [{ url: "/icon.svg" }],
  },
  manifest: "/site.webmanifest",
  verification: {
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION,
    yandex: process.env.NEXT_PUBLIC_YANDEX_SITE_VERIFICATION,
    yahoo: process.env.NEXT_PUBLIC_YAHOO_SITE_VERIFICATION,
    other: Object.keys(VERIFICATION_OTHER).length ? VERIFICATION_OTHER : undefined,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0f19",
  colorScheme: "dark light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        name: SITE_NAME,
        url: SITE_URL,
        description: SITE_DESCRIPTION,
        inLanguage: "en",
      },
      {
        "@type": "WebApplication",
        name: SITE_NAME,
        url: SITE_URL,
        description: SITE_DESCRIPTION,
        applicationCategory: "FinanceApplication",
        operatingSystem: "Web",
      },
    ],
  };

  return (
    <html lang="en">
      <head>
        {/* Extra SEO / platform tags not covered by `metadata` */}
        <meta name="application-name" content={SITE_NAME} />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content={SITE_NAME} />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="msapplication-TileColor" content="#0b0f19" />
        <meta name="msapplication-tap-highlight" content="no" />
        <meta name="HandheldFriendly" content="true" />
        <meta name="format-detection" content="telephone=no" />

        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
