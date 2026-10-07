import { configDefaults, defineConfig } from "vitest/config";
import base from "./vitest.config.mjs";

// 브라우저 시험(`npm run test:browser`). 빌드된 out/ 을 127.0.0.1 에 띄우고 이 컴퓨터의 Chrome 으로 연다.
// `npm run check` 에서 빌드 뒤에 돈다. Chrome 을 찾지 못하면 건너뛰지 않고 실패한다(tests/browser/site.ts).
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["tests/browser/**/*.test.ts"],
    exclude: configDefaults.exclude,
    // 쪽을 열고 기다리는 시험이다. 한 시험에 30초까지 준다(보통 1~2초에 끝난다).
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
