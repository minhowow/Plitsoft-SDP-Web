/**
 * 대기열과 실행 자리(docs/architecture.md 의 "대기열과 실행 자리"). 화면에 적는 숫자는 모두 DB 에서 센 것이다
 * (`src/server/queue.ts` 의 `readQueue`). 서버 부품과 브라우저 부품이 함께 쓰므로 서버 코드를 부르지 않는다.
 *
 * - 대기열: 요청을 받았고 아직 실행기에 보내지 않은 분석. 먼저 요청한 것이 앞이다.
 * - 실행 자리: 실행기에 보냈고 아직 시작을 알리지 않은 분석과 분석 중인 분석이 쓴다. 자리 수는 POOL_SIZE 다.
 */

import { formatKst } from "./steps";

/**
 * 실행기를 깨우지 못한 뒤 다시 깨워 보기까지 쉬는 시간(분). 그동안은 어느 서버 인스턴스도 깨우지 않는다(`src/server/queue.ts`).
 * 서버 부품과 화면 문구가 함께 쓴다.
 */
export const WAKE_RETRY_MINUTES = 2;

/** 한 순간의 대기열과 실행 자리. */
export interface QueueSnapshot {
  /** 센 때(ISO). 서버가 한 번 그리고 다시 읽지 않는 쪽(저장소 쪽)은 이 때를 적는다. */
  countedAt: string;
  /** 실행 자리 수(POOL_SIZE). */
  poolSize: number;
  /** 실행 자리를 쓰는 분석 수(실행기에 보냈거나 분석 중). POOL_SIZE 를 줄인 직후에는 자리 수보다 클 수 있다. */
  inUse: number;
  /** 대기열의 분석 id. 먼저 요청한 것이 앞이다. */
  waiting: string[];
  /** 실행기에 보냈고 실행기가 아직 시작을 알리지 않은 분석 id. */
  dispatched: string[];
  /** 실행기를 깨우지 못한 마지막 때와 까닭(이 서버가 만든 글). 깨우기에 성공하면 지워진다. 없으면 null. */
  wakeFailure: { at: string; reason: string } | null;
}

/** 분석 하나가 대기열의 어디에 있는지. 대기 중(queued)인 분석에만 있다. */
export type QueuePlace =
  | {
      kind: "waiting";
      /** 앞에 있는 분석 수. */
      ahead: number;
      poolSize: number;
      inUse: number;
      /** 실행기를 깨우지 못해 대기열이 멈춰 있으면 그 까닭. 아니면 없다. */
      wakeFailure?: string;
    }
  | { kind: "dispatched"; poolSize: number; inUse: number };

export function placeOf(snapshot: QueueSnapshot | null, id: string): QueuePlace | null {
  if (!snapshot) return null;
  const { poolSize, inUse } = snapshot;
  const at = snapshot.waiting.indexOf(id);
  if (at !== -1) {
    const place: QueuePlace = { kind: "waiting", ahead: at, poolSize, inUse };
    return snapshot.wakeFailure ? { ...place, wakeFailure: snapshot.wakeFailure.reason } : place;
  }
  if (snapshot.dispatched.includes(id)) return { kind: "dispatched", poolSize, inUse };
  return null;
}

/** "실행 자리 2개 중 1개 사용 중" */
export function poolText(poolSize: number, inUse: number): string {
  return `실행 자리 ${poolSize}개 중 ${inUse}개 사용 중`;
}

/** 목록 한 줄에 적는 짧은 말. "대기열 2번째(앞에 1개)" / "실행기에 보냄, 시작 기다림" */
export function placeShort(place: QueuePlace): string {
  return place.kind === "waiting" ? `대기열 ${place.ahead + 1}번째(앞에 ${place.ahead}개)` : "실행기에 보냄, 시작 기다림";
}

/** 분석 쪽과 저장소 쪽의 진행 칸에 적는 말. */
export function placeText(place: QueuePlace): string {
  const pool = `${poolText(place.poolSize, place.inUse)}입니다.`;
  if (place.kind === "dispatched") {
    return `실행 자리를 얻어 실행기에 보냈고, 실행기가 시작을 알리기를 기다리고 있습니다. ${pool}`;
  }
  const order = `대기열 ${place.ahead + 1}번째입니다(앞에 ${place.ahead}개). ${pool}`;
  if (place.wakeFailure) {
    return `${order} 실행기를 깨우지 못해 대기열이 잠시 멈춰 있습니다. 까닭: ${place.wakeFailure} ${WAKE_RETRY_MINUTES}분이 지난 뒤 대기열을 넘길 때 다시 깨워 봅니다.`;
  }
  return `${order} 앞의 분석이 끝나 자리가 나면 차례대로 실행기에 보냅니다.`;
}

/** 숫자를 센 때(서버가 한 번 그리고 다시 읽지 않는 쪽에 적는다). "이 쪽을 연 때(2026-11-03 12:00 한국 표준시)" */
export function countedText(countedAt: string): string {
  return `이 쪽을 연 때(${formatKst(countedAt)} 한국 표준시)`;
}

/** 서버가 돌려준 값이 대기열의 자리인지 본다(브라우저 부품이 읽을 때). 아니면 null. */
export function readPlace(value: unknown): QueuePlace | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const count = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;
  if (!count(v.poolSize) || !count(v.inUse)) return null;
  if (v.kind === "waiting" && count(v.ahead)) {
    const place: QueuePlace = { kind: "waiting", ahead: v.ahead, poolSize: v.poolSize, inUse: v.inUse };
    const why = v.wakeFailure;
    return typeof why === "string" && why.length > 0 && why.length <= 500 ? { ...place, wakeFailure: why } : place;
  }
  if (v.kind === "dispatched") return { kind: "dispatched", poolSize: v.poolSize, inUse: v.inUse };
  return null;
}
