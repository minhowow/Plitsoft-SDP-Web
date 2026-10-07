import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const dir = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// 부품 시험(`npm test`). 빌드 없이 돈다. 빌드된 out/ 을 브라우저로 여는 시험은 vitest.browser.config.mts 가 따로 돌린다.
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
    exclude: [...configDefaults.exclude, "tests/browser/**"],
  },
});
