import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://transparent.space";
  const isProd = process.env.NODE_ENV === "production";

  return {
    rules: [
      {
        userAgent: "*",
        allow: isProd ? "/" : undefined,
        disallow: isProd ? ["/api/"] : ["/"],
      },
    ],
    sitemap: `${siteUrl.replace(/\/$/, "")}/sitemap.xml`,
    host: siteUrl.replace(/\/$/, ""),
  };
}
