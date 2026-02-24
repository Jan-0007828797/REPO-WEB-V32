/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pro testování: vypni agresivní cacheování buildů (hlavně Preview deploys)
  async headers() {
    return [
      // Všechny stránky (HTML/SSR) — vždy stáhnout znovu
      {
        source: "/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, proxy-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },

      // Next statické bundly (JS/CSS) — pro testování vynutit re-download
      {
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, proxy-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },

      // Favicons / assets
      {
        source: "/(favicon.ico|apple-touch-icon.png|android-chrome-192x192.png|android-chrome-512x512.png|favicon-16x16.png|favicon-32x32.png|site.webmanifest)",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, proxy-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
