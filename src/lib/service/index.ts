import { syntheticStore } from "./synthetic";
import type { ServiceStore } from "./types";

/**
 * 쪽이 읽는 저장소. B1 은 합성 저장소다. B2 에서 Postgres 와 GitHub 검색으로 채우는 구현으로 이 한 줄을 바꾼다.
 * 서버 부품(쪽)에서만 불러온다. 브라우저에서 도는 부품은 이 파일을 불러오지 않는다(합성 결과 JSON 이 묶음에 실린다).
 */
export const store: ServiceStore = syntheticStore;

export type * from "./types";
