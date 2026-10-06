import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const dir = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    // tsconfig.json 의 paths 와 같게 둔다.
    alias: {
      "@data": dir("./data"),
      "@contract": dir("./contract"),
      "@": dir("./src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
