import { defineConfig } from "vite-plus/test/config";

// Egen konfig utan voidPlugin(): Cloudflare-pluginet går inte att starta i Vitest.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
