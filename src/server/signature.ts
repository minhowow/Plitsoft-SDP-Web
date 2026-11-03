import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * 실행기 콜백의 서명. 실행기(runner/run.mjs 의 `sign`)와 이 서버가 같은 열쇠(RUNNER_SECRET)로 같은 글을 HMAC-SHA256 한다.
 *
 *   서명할 글 = "v1\n" + 시각(유닉스 초) + "\n" + 범위 + "\n" + 본문
 *   머리 x-runner-timestamp: 시각,  x-runner-signature: "v1=" + 16진수
 *
 * 범위는 분석 id(그 분석의 콜백) 또는 `claim`(로컬 실행기가 대기 중인 분석을 집어 감)이다. 범위를 서명에 넣어 한 분석에 보낸
 * 서명을 다른 분석에 다시 쓰지 못하게 한다. 시각이 지금과 5분 넘게 어긋나면 받지 않는다(오래된 요청을 다시 보내는 것을 줄인다.
 * 같은 요청을 5분 안에 다시 보내는 것은 상태 전이가 막는다: 끝난 분석은 바뀌지 않고, 단계는 앞으로만 간다).
 *
 * 견주기는 `timingSafeEqual` 로 한다. 열쇠가 없으면(RUNNER_SECRET 을 두지 않은 배포) 모든 콜백을 거절한다.
 */

export const SIGNATURE_VERSION = "v1";
export const TIMESTAMP_HEADER = "x-runner-timestamp";
export const SIGNATURE_HEADER = "x-runner-signature";
/** 받는 시각 어긋남(초). */
export const MAX_SKEW_SECONDS = 5 * 60;

export function signedText(timestamp: string, scope: string, body: string): string {
  return `${SIGNATURE_VERSION}\n${timestamp}\n${scope}\n${body}`;
}

export function sign(secret: string, timestamp: string, scope: string, body: string): string {
  return `${SIGNATURE_VERSION}=${createHmac("sha256", secret).update(signedText(timestamp, scope, body), "utf8").digest("hex")}`;
}

export type VerifyOutcome = { ok: true } | { ok: false; reason: "no-secret" | "malformed" | "stale" | "mismatch" };

/**
 * 본문을 읽기 전에 머리만 본다: 모양과 시각 어긋남. 이것이 맞지 않는 요청은 본문(최대 RESULT_MAX_KB)을 읽지 않고 거절한다
 * (아무나 큰 본문을 보내 서버가 받아 두게 하지 못하게). 서명 자체는 본문을 읽은 뒤 `verify` 가 본다.
 */
export function precheck(input: {
  secret: string | null;
  timestamp: string | null;
  signature: string | null;
  now: number;
}): VerifyOutcome {
  if (!input.secret) return { ok: false, reason: "no-secret" };
  const { timestamp, signature } = input;
  if (!timestamp || !/^\d{1,12}$/.test(timestamp) || !signature || !/^v1=[0-9a-f]{64}$/.test(signature)) {
    return { ok: false, reason: "malformed" };
  }
  if (Math.abs(input.now / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS) return { ok: false, reason: "stale" };
  return { ok: true };
}

export function verify(input: {
  secret: string | null;
  timestamp: string | null;
  signature: string | null;
  scope: string;
  body: string;
  /** 지금(밀리초). */
  now: number;
}): VerifyOutcome {
  const pre = precheck(input);
  if (!pre.ok) return pre;
  const timestamp = input.timestamp!;
  const signature = input.signature!;
  const expected = Buffer.from(sign(input.secret!, timestamp, input.scope, input.body), "utf8");
  const given = Buffer.from(signature, "utf8");
  // 모양을 위에서 보았으므로 길이가 같다. 그래도 길이가 다르면 timingSafeEqual 이 던지므로 먼저 본다.
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "mismatch" };
  return { ok: true };
}
