import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // B2(docs/direction.md): 서버가 있다. 서버 코드는 src/server/ 와 src/app/api/ 에만 둔다(tests/commitments.test.ts).
  // 분석 서비스의 쪽(첫 화면·검색·저장소·분석)은 요청 때 그리고, /view·/demo·/policy 는 빌드할 때 그려 둔다.
  //
  // 쪽 주소는 끝에 빗금을 둔다(B1 의 주소 그대로. 빗금 없는 주소는 빗금 있는 주소로 보낸다).
  // 점이 든 경로는 Next 가 파일로 보고 빗금을 붙이지 않으므로, 조문 도감 주소에는 점을 넣지 않는다(src/lib/pack/index.ts 의 policySlug).
  trailingSlash: true,
  // PGlite(로컬 개발·시험의 DB)는 WebAssembly 와 데이터 파일을 지닌 패키지라 묶지 않고 node_modules 에서 그대로 불러온다.
  // `pg` 는 Next 가 이미 묶지 않는 목록에 있다.
  serverExternalPackages: ["@electric-sql/pglite"],
  // 마이그레이션 SQL 은 서버가 처음 DB 를 열 때 파일에서 읽는다(src/server/db). 배포 묶음에 함께 싣는다.
  outputFileTracingIncludes: {
    "/*": ["./src/server/db/migrations/*.sql"],
  },
};

export default nextConfig;
