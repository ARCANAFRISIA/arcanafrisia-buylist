// next.config.ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'cards.scryfall.io' },
      { protocol: 'https', hostname: 'img.scryfall.com' },
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

