import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 1층 약속: 서버가 없다. `next build` 가 out/ 에 정적 파일만 만든다.
  // server action 과 쿠키는 빌드가 막는다. route handler, proxy(미들웨어), pages/api 는 빌드가 통과하고
  // out/ 에서 조용히 빠질 뿐이라 tests/commitments.test.ts 가 막는다.
  // 이 줄은 관문 G2(docs/ROADMAP.md) 전에는 지우지 않는다.
  output: "export",
  // 쪽마다 폴더/index.html 로 내보낸다. 점이 든 경로는 Next 가 링크에서 끝 슬래시를 떼므로,
  // 주소에 쓰는 이름에는 점을 넣지 않는다(src/lib/pack/index.ts 의 policySlug).
  trailingSlash: true,
};

export default nextConfig;
