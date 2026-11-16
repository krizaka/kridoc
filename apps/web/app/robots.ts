import type { MetadataRoute } from "next";
import { headers } from "next/headers";

import { isDevHost } from "@/lib/dev-host";
import { readEnv } from "@/lib/env";
import { CRAWLERS } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const env = readEnv();
  return env.APP_SEARCH_INDEXING === "off" || isDevHost((await headers()).get("host"))
    ? { rules: { userAgent: "*", disallow: "/" } }
    : {
        rules: [{ userAgent: "*", allow: "/" }, ...CRAWLERS.map((userAgent) => ({ userAgent, allow: "/" }))],
        sitemap: `${SITE_URL}/sitemap.xml`,
      };
}
