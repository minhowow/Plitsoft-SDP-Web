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
  // 출력이 못 한다고 적지 않는다. 판 번호 없는 출력(CLI 8ae72d8 까지)은 정적 조건으로 풀린 단위를 내지 않아 가를 수 없지만,
  // 결과 판 1 은 "단위 수 = 발견 + AI 가 푼 것 + 정적 대안으로 풀린 것"이라 판정자를 끈 결과에서는 셋 모두 없는 정책이
  // 적용 신호 없음으로 갈린다(CLI 7300205 의 report/json_out.py). 웹이 그렇게 셈하지 않는 것이다(docs/ROADMAP.md 의
  // "사람 결정이 필요한 것"). 두 출력에 함께 맞는 말로 적는다.
  "not-reported":
    "이 정책에는 발견이 없습니다. 이 사이트는 아직 '충족 근거 발견'과 '적용 신호 없음'으로 나누어 적지 않습니다.",
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
  "not-reported": "발견이 없는 정책은 이 사이트가 아직 '충족 근거 발견'과 '적용 신호 없음'으로 나누어 적지 않습니다.",
  "pack-unknown": "이 사이트에 실린 것과 다른 판의 팩으로 만든 결과입니다. 그 팩에 같은 정책이 있었는지 알 수 없습니다.",
};

/**
 * "발견 없음"의 뜻을, 발견은 없고 AI 가 푼 경고만 있는 정책과 한 표에 놓고 적을 때의 말(조문별 검사 기록의 정책 표).
 *
 * 그런 정책의 줄에도 "발견 없음"이 적힌다. 풀이의 이름표가 같아서, `STATUS_LEGEND` 를 그대로 적으면 "나누어 적지 않는다"가 그
 * 줄의 말로도 읽힌다. 그 정책에는 조문이 닿는다고 본 단위가 있었고 AI 의 답으로 풀린 것이라, 그 말이 맞지 않는다. 정책
 * 카드도 그런 정책에는 이 말 대신 AI 가 푼 경고가 있다고 적는다(`components/result/PolicyCard.tsx`). 그래서 주어를 좁힌다.
 */
export const NOT_REPORTED_NOR_CLEARED =
  "발견도 AI 가 푼 경고도 없는 정책은 이 사이트가 아직 '충족 근거 발견'과 '적용 신호 없음'으로 나누어 적지 않습니다.";

/**
 * 검토 결과 체크리스트의 세 묶음(2026-11-11 오너 결정, docs/commitments.md 의 1). 의무(정책)마다 이 차례로 적는다. 묶음 안의
 * 줄마다의 상태는 위의 상태 이름(칩) 그대로다.
 *
 * - kept: 지킨 근거 있음. 강한 정적 대안이 맞은 자리(충족 근거 발견)와 AI 가 코드 줄을 인용해 푼 경고. 인용은 코드에 있는지만
 *   확인된 것이라 사람이 봐야 한다.
 * - check: 확인할 것. 미충족 신호(검토 필요)와 검토 필요 · AI 확인 전. 줄마다 확인 질문이 있다.
 * - unknown: 코드로는 알 수 없음. 판단 보류(모름).
 */
export const CHECKLIST_LABEL = {
  kept: "지킨 근거 있음",
  check: "확인할 것",
  unknown: "코드로는 알 수 없음",
} as const;

/**
 * review 체크리스트(policypack review 2판)의 상태 이름(2026-11-11 오너 결정, docs/commitments.md 의 1). 갈래는 이 차례다. "확인할
 * 것"은 세 갈래(코드에서 본 것, 저장소 밖에서 확인할 것, 해당 여부부터 확인할 것)이고, "해당 없음"은 AI 가 낸 검색어를 도구가 저장소에서
 * 다시 돌려 건수가 맞은 것에만 쓴다. 검색으로 확인되지 않은 것은 "걸리지 않는 것으로 보임(확인 안 됨)"이다.
 */
export const REVIEW_STATUS_LABEL = {
  "seen-in-code": "확인할 것 · 코드에서 본 것",
  "check-outside": "확인할 것 · 저장소 밖에서 확인할 것",
  "check-applicability": "확인할 것 · 해당 여부부터 확인할 것",
  unknown: "모름",
  "evidence-found": "지킨 근거 있음",
  "likely-not-applicable": "걸리지 않는 것으로 보임(확인 안 됨)",
  "not-applicable": "해당 없음",
} as const;

/**
 * 사례 쪽 review 결과에서 사람이 답을 읽고 말이 안 된다고 짚은 의무(2026-11-12 오너 결정, docs/commitments.md 의 1). 그 상태를
 * 그대로 싣지 않고 이 이름으로 접어 둔다. CLI 가 고친 다음 판에서 다시 돌린다.
 */
export const REVIEW_RECHECK_LABEL = "다시 검토 중";

/**
 * review 체크리스트에서 품목 신호가 없어 묻지 않은 품목 의무(주류·도서 등, CLI 의 group goods)를 한 줄로 묶는 이름. 갈래는 "해당
 * 여부부터 확인할 것"이지만 확인할 것의 수에 넣지 않는다.
 */
export const REVIEW_GOODS_LABEL = "특정 품목을 판다면 확인할 것";

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
