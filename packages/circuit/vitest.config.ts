import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // jsdom gives us DOMParser/XPathResult for plaintext re-extraction without
    // forcing the test runner to spawn a full browser.
    environment: "jsdom",
    include: ["test/**/*.test.ts"],
    // Proving can take a while even on small circuits; the hashing pass over
    // 4 fields × ~4KB each on a debug build is the slow part.
    testTimeout: 5 * 60 * 1000,
    hookTimeout: 5 * 60 * 1000,
  },
});
