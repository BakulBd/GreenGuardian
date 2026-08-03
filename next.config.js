/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: [
    '192.168.1.101',
    'green.bakul.app',
    'localhost:3000',
    'localhost:3001',
    '127.0.0.1:3000',
    '127.0.0.1:3001'
  ],
  reactStrictMode: true,
  turbopack: {},
  // Only use static export if explicitly requested (e.g. for pure static hosting)
  ...(process.env.STATIC_EXPORT === 'true' ? { output: 'export' } : {}),
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
      },
    ],
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
  // Keep node-only packages external to the server bundle (route handlers).
  serverExternalPackages: ["nodemailer", "firebase-admin"],
};

module.exports = nextConfig;
