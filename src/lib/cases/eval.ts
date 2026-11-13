import raw from "@data/eval-41.json";
import { REVIEW_STATUS_LABEL } from "@/lib/report/status";
import type { EvalFile } from "./eval-figure";

export type { EvalFile, EvalRow } from "./eval-figure";

/**
 * 공개 저장소 41곳의 review 평가(2026-11-13, CLI 세션). 사례 쪽(/cases)의 한 구역과 포스터 그림(docs/figures/review-results-41)이
 * 같은 숫자를 쓴다. 숫자는 `node scripts/export-eval.mjs` 가 summary.json 에서 옮긴 것이다(data/eval-41.json). 남의 저장소라 이름·주소·
 * 코드는 싣지 않고 성격별 숫자만 싣는다. 모델은 조사(haiku)만이고 반박은 없다. 일부 저장소는 앞서 받은 조사 답에 이 판정 규칙만
 * 다시 걸었다(모델 재호출 없음).
 */

export const evalFile = raw as EvalFile;

/**
 * 알려진 한계(summary.md 의 "알려진 한계"를 짧게 줄인 것). 상태 이름은 이 사이트의 것(`REVIEW_STATUS_LABEL`)으로 적는다. 배치 번호와
 * 내부 필드 이름은 옮기지 않았다.
 */
const NA = `'${REVIEW_STATUS_LABEL["not-applicable"]}'`;
const LIKELY = `'${REVIEW_STATUS_LABEL["likely-not-applicable"]}'`;
export const EVAL_LIMITS: readonly string[] = [
  "'자유 입력 추측'·'빈틈' 같은 표시는 모델이 스스로 달아 잘못 달릴 수 있습니다. 서버만·화면만인 저장소에서 반대쪽 의무가 '저장소 밖'으로 가지 않은 일이 있었습니다.",
  `금지 의무는 금지된 행위 자체를 인용해야 '코드에서 본 것'입니다. 모델이 실제 약점을 '빈틈'으로 표시해 ${NA}·${LIKELY}으로 내려간 것이 2건 있습니다(약점은 이유 글에만 남음).`,
  "'충족'이라 답하면서 빠진 것을 적은 답은 가를 칸이 없어 그대로 두었습니다. 반박을 꺼서 다시 보는 단계도 없습니다.",
  "기능 파악의 신호는 JS·TS 만 봅니다. Java·Python 서버의 기능은 AI 가 보탤 때만 잡힙니다.",
  `앞서 받은 답에 규칙만 다시 건 곳에서는 금지 행위를 인용한 2건이 ${NA}으로 내려갔고, 한 곳의 AI 고지 2건은 묻지 않아 답이 없습니다.`,
  `모델이 적은 검색 줄 수가 다시 센 수와 조금만 달라도 ${NA}을 주지 않고 ${LIKELY}으로 둡니다. 모델이 줄 수를 틀리게 세는 일이 많습니다.`,
  "정적 검사가 AI 호출이 아닌 줄을 AI 호출로 잡은 곳이 2곳 있었습니다.",
  "앞선 일부 실행의 비용에는 반박 비용이 들어 있고, 도구 오류로 멈춘 실행(약 $0.2)은 빠졌습니다. 한 곳의 시간은 컴퓨터가 잠든 동안이 끼어 부풀었습니다.",
];
