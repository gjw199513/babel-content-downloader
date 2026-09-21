import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: [".audit/**", "dist/**", "node_modules/**"],
  },
});
