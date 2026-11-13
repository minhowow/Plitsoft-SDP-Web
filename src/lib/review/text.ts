import { REVIEW_STATUS_LABEL } from "@/lib/report/status";
import type { ReviewItem, ReviewStatus } from "./index";

/**
 * review 체크리스트의 글을 고르는 일. 결과 화면(`components/review/ReviewView.tsx`)과 체크리스트 내보내기(`checklist.ts`: 마크다운
 * 파일, 인쇄용 보기)가 같은 말을 쓴다.
 */

/** 확인할 것의 세 갈래. */
export const CHECKS: readonly ReviewStatus[] = ["seen-in-code", "check-outside", "check-applicability"];

/**
 * 화면에 싣지 않는 처분의 말(docs/commitments.md 1장: 처분 사례와 그 액수를 화면에 싣지 않는다). 의무 한 줄에 이 말이 들면 그 줄은
 * 적지 않고 법·조문·법제처 링크만 둔다. 소스의 문구 시험(tests/commitments.test.ts)이 이 낱말을 글자 그대로 막으므로 글자 번호로
 * 적는다(tests/wording.ts 의 처분·액수 줄과 같은 세 낱말).
 */
export const SANCTION = new RegExp(
  [
    [0xacfc, 0xc9d5, 0xae08],
    [0xacfc, 0xd0dc, 0xb8cc],
    [0xbc8c, 0xae08],
  ]
    .map((codes) => String.fromCodePoint(...codes))
    .join("|"),
);

/**
 * 관문이 모델의 답을 바꾼 까닭(`ReviewItem.gate`)을 이 사이트의 상태 이름으로. 모르는 까닭이면 적지 않는다. condition-present 는
 * 조건이 코드에서 확인됐을 때(기능 신호나 관문을 통과한 인용, 상태 '코드에서 본 것')와 AI 의 말뿐일 때(상태 '해당 여부부터')를 가른다.
 */
export function gateText(item: ReviewItem): string | undefined {
  const na = REVIEW_STATUS_LABEL["not-applicable"];
  switch (item.gate) {
    case "condition-present":
      return item.status === "seen-in-code"
        ? `걸리는 조건이 코드에 있어 AI 가 낸 '${na}'을 받지 않았습니다.`
        : `AI 가 걸리는 조건이 있다고 답해 '${na}'을 받지 않았습니다.`;
    case "no-condition":
      return `걸리는 조건이 없다는 근거가 없어 AI 가 낸 '${na}'을 받지 않았습니다.`;
    case "name-or-default":
      return `AI 가 댄 줄이 이름·기본값뿐이라 '${REVIEW_STATUS_LABEL["evidence-found"]}'으로 받지 않았습니다.`;
    // CLI 2a24d94 부터.
    case "audience":
      return `이용자가 누구인지(아동·미성년자·청소년)에 걸리는 의무라 AI 가 낸 '${na}'을 받지 않았습니다.`;
    case "missing-check":
      return `나이·본인·지역을 확인하는 장치가 없다는 것은 그런 이용자가 없다는 근거가 아니라 AI 가 낸 '${na}'을 받지 않았습니다.`;
    case "applies-unknown":
      return `AI 가 걸리는지 모른다고 답해 '${REVIEW_STATUS_LABEL["check-applicability"].split(" · ").at(-1)}'으로 옮겼습니다.`;
    default:
      return undefined;
  }
}

/** 글의 첫 문장(마침표·물음표 다음 빈칸까지). 나머지가 있으면 함께 돌려준다. 글을 고치지 않는다. */
export function firstSentence(text: string): [string, string] {
  const match = /^(.+?[.?!])\s+(\S[\s\S]*)$/.exec(text.trim());
  return match ? [match[1], match[2]] : [text.trim(), ""];
}

/**
 * 묻지 못한 까닭: CLI 는 `not_answered` 에 까닭의 이름(cost-cap 등)을, `reason` 에 그 말을 싣는다. reason 이 비었을 때만 적고,
 * 이름 꼴(영문 소문자·숫자·붙임표)이면 그대로 싣지 않는다.
 */
export function notAnsweredText(item: ReviewItem): string | null {
  if (item.reason || !item.notAnswered) return null;
  return /^[a-z0-9-]+$/.test(item.notAnswered) ? "답을 받지 못했습니다." : item.notAnswered;
}
