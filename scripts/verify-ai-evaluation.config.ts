/**
 * Vitest config for the LIVE AI-evaluation verification.
 *
 * Kept separate from `vitest.config.ts` on purpose: `npm test` must stay fast,
 * offline and free, and this suite is none of those — it calls the real Gemini
 * API with the key from `.env.local` and spends real quota.
 *
 *   npm run verify:ai
 */
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/verify-ai-evaluation.ts"],
    // A multi-page vision pass plus a question-paper read is slow by nature.
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, ".."),
    },
  },
});
