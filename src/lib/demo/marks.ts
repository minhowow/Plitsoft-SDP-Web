import { scopeLabel } from "@/lib/report/scope";
import type { ReportView } from "@/lib/report/view-model";

/**
 * 데모의 코드 상자에서 칠하는 줄 하나.
 *
 * 칠하는 것은 결과의 발견에 실린 줄 번호(`findings[].line`)뿐이다. 그 밖의 줄을 골라 칠하지 않는다. 어느 줄이
 * 문제인지 웹이 짐작하는 것이 된다.
 *
 * 그 줄 번호도 문제의 줄이 아니다. 판정이 본 범위 안에서 조문이 닿는다고 본 첫 줄일 뿐이고, kr-core 의 규칙은 대개
 * 파일 전체를 보고 판정한다(대개 import 줄이 실린다. CLI 7300205 의 야간 광고 규칙은 발송 호출을 감싼 함수를 본다). 그래서 칠한
 * 줄 바로 아래에 `발견 N건이 가리키는 줄(파일 전체 판정)` 처럼 판정이 본 범위를 함께 적는다(docs/redesign.md 3장 "데모"). 범위의
 * 이름은 발견 줄의 것과 같다(`scope.ts` 의 `scopeLabel`).
 */
export interface LineMark {
  line: number;
  /** 이 줄 번호가 실린 발견의 수. 같은 줄에 규칙이나 정책이 다른 발견이 함께 있을 수 있다. */
  findings: number;
  /** 판정이 본 범위의 이름. 발견마다 범위가 다르면 여럿이다. */
  scopes: string[];
}

/** 이 파일에서 칠할 줄. 줄 순서다. 줄 번호가 없는 발견(`line: null`)은 칠할 줄이 없다. */
export function lineMarks(view: ReportView, file: string): LineMark[] {
  const marks = new Map<number, LineMark>();
  for (const policy of view.policies) {
    for (const location of policy.locations) {
      if (location.file !== file || location.line === null) continue;
      const mark = marks.get(location.line) ?? { line: location.line, findings: 0, scopes: [] };
      const scope = scopeLabel(location.scope);
      mark.findings += 1;
      if (!mark.scopes.includes(scope)) mark.scopes.push(scope);
      marks.set(location.line, mark);
    }
  }
  return [...marks.values()].sort((a, b) => a.line - b.line);
}
