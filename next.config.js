/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  turbopack: {},
  // Only use static export if explicitly requested (e.g. for pure static hosting)
  ...(process.env.STATIC_EXPORT === 'true' ? { output: 'export' } : {}),
  images: {
    domains: ['firebasestorage.googleapis.com'],
    // Required for static export
    unoptimized: true,
  },
  webpack: (config, { isServer }) => {
    // Fix for TensorFlow.js and other heavy libraries
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
