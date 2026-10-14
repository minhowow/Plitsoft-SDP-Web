import type { Finding, Report } from "@/lib/report/types";

// 조문별 검사 기록의 시험이 함께 쓰는, 손으로 만든 결과. 부품 시험(tests/record.test.tsx)과 브라우저 시험
// (tests/browser/record.test.ts)이 같은 결과로 "기록에 코드가 없다"를 본다.

/**
 * 결과가 코드나 자유로운 글을 실을 수 있는 자리마다 `lines`(합성 코드의 줄)를 넣은 결과. 손으로 만든 것이다.
 *
 * CLI 가 판정자 없이 낸 결과에는 코드가 한 줄도 없다. 그런 결과만으로는 기록이 코드를 옮기지 않는다는 것이 드러나지 않는다
 * (기록이 판정 경로나 인용한 줄을 통째로 옮겨도 그 결과로 만든 기록에는 코드가 없다). 그래서 코드가 실릴 수 있는 자리를
 * 모두 채운다.
 *
 * - 판정자를 켰을 때 CLI 가 코드를 싣는 자리: AI 가 인용한 줄(`run.ai_cleared[].alternatives[].cite`), 받아들이지 않은
 *   인용이 따옴표로 적히는 판정 경로(`findings[].decision_path`. CLI 소스 `evaluate/engine.py` 의 evaluate).
 * - 경로와 코드 조각이 들 수 있는 엔진 오류 문장(`run.engine_errors`).
 * - 파서가 글자인지만 보는 글: 발견의 제목과 질문, 확인되지 않은 대안의 글, 판정을 끝내지 못한 이유, 빠진 판정의 질문과
 *   답, 인용의 종류. CLI 는 여기에 팩의 글이나 정해 둔 낱말을 싣지만, 손으로 고친 파일에는 무엇이든 들 수 있다.
 *
 * 기록에 실리는 값(경로, 줄 번호, 정책·규칙·대안의 id, 지문, 도구와 엔진의 이름)은 그대로 둔다.
 */
export function withCodeEverywhere(base: Report, lines: string[]): Report {
  if (lines.length === 0 || base.findings.length === 0) throw new Error("넣을 줄과, 본으로 삼을 발견이 있어야 합니다.");
  const [first] = base.findings;
  const at = (i: number) => lines[i % lines.length];
  return {
    ...base,
    run: {
      ...base.run,
      judge: base.run.judge ?? "claude-cli:haiku",
      ai_cleared: [
        { policy: first.policy, rule: first.rule, file: first.file, line: first.line, alternatives: lines.map((line, i) => ({ id: "ai-guard", cite: line, gate: at(i + 1) })) },
      ],
      ai_dismissed: lines.map((line, i) => ({ policy: first.policy, rule: first.rule, file: first.file, line: first.line, question: line, answer: at(i + 1) })),
      engine_errors: lines.map((line) => `[Fatal error] Parse failure\n  ${line}`),
    },
    findings: base.findings.map(
      (finding, i): Finding => ({
        ...finding,
        title: at(i),
        ask_developer: at(i + 1),
        untested_reasons: [...finding.untested_reasons, at(i + 2)],
        ai_pending: [...finding.ai_pending, at(i + 3)],
        unsatisfied_alternatives: finding.unsatisfied_alternatives.map((alt, j) => ({
          ...alt,
          message: at(i + j),
          ask_developer: at(i + j + 1),
          remediation: at(i + j + 2),
        })),
        decision_path: [...finding.decision_path, ...lines.map((line) => `대안 ai-guard: AI 예 — 인용 불인정(not-found): “${line}” → 판정에 넣지 않음`), ...lines],
      }),
    ),
  };
}
