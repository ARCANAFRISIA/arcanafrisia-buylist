// next.config.ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'cards.scryfall.io' },
      { protocol: 'https', hostname: 'img.scryfall.com' },
        { protocol: "https", hostname: "images.pokemontcg.io",},
        {
        protocol: "https",
        hostname: "images.scrydex.com",
      },
    ],
  },
  async rewrites() {
    return [
      // Home → /buy (jouw nieuwe buylist pagina)
      { source: '/', destination: '/buy' },
    ];
  },
};

export default nextConfig;

