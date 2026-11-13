import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // `server-only` throws outside the react-server condition; tests run on the server.
      "server-only": path.resolve(__dirname, "test/support/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["test/unit/**/*.test.ts", "test/db/**/*.test.ts"],
    globalSetup: ["test/support/global-setup.ts"],
    setupFiles: ["test/support/setup-env.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
