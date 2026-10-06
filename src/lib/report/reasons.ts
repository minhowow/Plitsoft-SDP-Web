/** findings[].untested_reasons 값을 사람이 읽는 말로. 모르는 값은 그대로 보여 준다. */
const REASON_LABEL: Record<string, string> = {
  "no-judge": "판정자가 꺼져 있어 AI 에게 묻지 않았습니다",
  "judge-unavailable": "판정자를 부르지 못했습니다",
  "judge-unparseable": "판정자가 답했지만 쓸 수 없는 답이었습니다",
  "citation-rejected": "AI 가 '예'라고 했지만 인용한 코드가 확인되지 않았습니다",
  "weak-unconfirmed": "이름·문자열만 본 약한 근거라 혼자서는 풀지 않았습니다",
  timeout: "판정자가 시간 안에 답하지 않았습니다",
  "parse-error": "파일 일부를 읽지 못했습니다",
  "engine-incomplete": "엔진이 이 파일을 끝까지 돌리지 못했습니다",
};

export function reasonLabel(reason: string): string {
  return REASON_LABEL[reason] ?? reason;
}
