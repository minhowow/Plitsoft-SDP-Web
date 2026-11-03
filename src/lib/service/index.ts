/**
 * 분석 서비스의 데이터 모델. 쪽이 읽는 저장소 구현은 서버 쪽 `src/server/store/index.ts` 의 `getStore()` 가 고른다
 * (운영: DB + GitHub, SERVICE_STORE=synthetic: 합성). 브라우저에서 도는 부품은 여기서 타입만 가져간다.
 */
export type * from "./types";
