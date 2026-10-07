import type { Finding } from "./types";

/**
 * 화면에 보이는 상태. 문구는 docs/commitments.md 의 표기 약속을 따른다.
 * 점수·등급·순위는 만들지 않는다.
 */
export type Status =
  | "needs-review"
  | "needs-review-ai-pending"
  | "uncertain"
  | "evidence-found"
  | "no-signal"
  | "not-reported"
  | "pack-unknown";

export const STATUS_LABEL: Record<Status, string> = {
  "needs-review": "미충족 신호(검토 필요)",
  "needs-review-ai-pending": "검토 필요 · AI 확인 전",
  uncertain: "판단 보류(모름)",
  "evidence-found": "충족 근거 발견",
  "no-signal": "적용 신호 없음",
  "not-reported": "발견 없음",
  "pack-unknown": "알 수 없음",
};

export const STATUS_HINT: Record<Status, string> = {
  "needs-review": "이 조문이 닿는 코드인데, 적법한 대안이 하나도 확인되지 않았습니다. 사람이 봐야 합니다.",
  "needs-review-ai-pending":
    "정적 조건으로는 대안이 확인되지 않았고, AI 에게 물어야 할 조건은 판정에 넣을 답이 없습니다(판정자가 꺼져 있거나, 답하지 못했거나, 답을 쓸 수 없었습니다).",
  uncertain: "적용 여부나 대안이 '모름'으로 남았습니다. 약한 근거만 있거나 파일을 끝까지 읽지 못했습니다.",
  "evidence-found": "적법한 대안 가운데 하나가 코드에서 확인됐습니다.",
  "no-signal": "이 조문이 닿는 코드 신호를 찾지 못했습니다. 법적 문제가 없다는 뜻은 아닙니다.",
  "not-reported":
    "이 정책에는 발견이 없습니다. 지금 CLI 출력으로는 '충족 근거 발견'과 '적용 신호 없음'을 구분할 수 없습니다.",
  "pack-unknown":
    "이 결과는 이 사이트에 실린 것과 다른 판의 팩으로 만들어졌습니다. 그 팩에 이 정책이 있었는지 알 수 없습니다.",
};

/**
 * 상태의 뜻을 정책 카드 밖에서 적을 때의 말. 여러 정책을 한 표에 놓고 그 아래에 상태의 뜻을 풀이로 적는 자리에서 쓴다
 * (데모의 "고치기 전과 고친 뒤의 결과").
 *
 * `STATUS_HINT` 는 정책 카드 안에서 그 정책을 두고 하는 말이라 "이 정책", "이 조문", "이 결과"라고 적는다. 풀이에는 그
 * 말이 가리킬 정책이 없다. 뜻은 그대로 두고 가리키는 말만 걷어 낸다. 그런 말이 없는 상태는 `STATUS_HINT` 그대로다.
 */
export const STATUS_LEGEND: Record<Status, string> = {
  ...STATUS_HINT,
  "needs-review": "조문이 닿는 코드인데, 적법한 대안이 하나도 확인되지 않았습니다. 사람이 봐야 합니다.",
  "no-signal": "조문이 닿는 코드 신호를 찾지 못했습니다. 법적 문제가 없다는 뜻은 아닙니다.",
  "not-reported": "발견이 없는 정책은 지금 CLI 출력으로는 '충족 근거 발견'과 '적용 신호 없음'을 구분할 수 없습니다.",
  "pack-unknown": "이 사이트에 실린 것과 다른 판의 팩으로 만든 결과입니다. 그 팩에 같은 정책이 있었는지 알 수 없습니다.",
};

/** 위에 놓을수록 먼저 봐야 한다. */
export const STATUS_ORDER: Status[] = [
  "needs-review",
  "needs-review-ai-pending",
  "uncertain",
  "evidence-found",
  "no-signal",
  "not-reported",
  "pack-unknown",
];

export function findingStatus(finding: Finding): Status {
  if (finding.outcome === "needs-review-uncertain") return "uncertain";
  // AI 대안은 쓸 수 있는 답이 없으면 판정에 넣지 않으므로 정적 판정(검토 필요)이 그대로 남는다. '모름'과 섞지 않는다.
  // ai_pending 은 판정자가 꺼진 경우만이 아니다. 답하지 못했거나 답을 쓸 수 없었던 경우도 들어간다.
  return finding.ai_pending.length > 0 ? "needs-review-ai-pending" : "needs-review";
}

export function worst(statuses: Status[]): Status {
  for (const status of STATUS_ORDER) {
    if (statuses.includes(status)) return status;
  }
  return "not-reported";
}
