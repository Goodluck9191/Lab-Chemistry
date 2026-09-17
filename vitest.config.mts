import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Domain, application and security tests are pure TypeScript with no DOM, no
 * database and no Next.js runtime, so a Node environment is enough. Tests that
 * need a live Supabase project read credentials from the environment and skip
 * themselves when it is absent (see tests/integration).
 *
 * Component tests (`.test.tsx` under tests/ui) opt into jsdom with a
 * `@vitest-environment jsdom` docblock at the top of the file, so the default
 * stays fast and dependency-free for everything else.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    globals: false,
    reporters: ["default"],
  },
});
