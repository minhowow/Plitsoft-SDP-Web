import { scopeNote } from "@/lib/report/scope";
import type { ReportView } from "@/lib/report/view-model";

/**
 * 데모의 코드 상자에서 칠하는 줄 하나.
 *
 * 칠하는 것은 결과의 발견에 실린 줄 번호(`findings[].line`)뿐이다. 그 밖의 줄을 골라 칠하지 않는다. 어느 줄이
 * 문제인지 웹이 짐작하는 것이 된다.
 *
 * 그 줄 번호도 문제의 줄이 아니다. 판정이 본 범위 안에서 조문이 닿는다고 본 첫 줄일 뿐이고, kr-core 의 규칙은 모두
 * 파일 전체를 보고 판정한다(대개 import 줄이 실린다). 그래서 칠한 줄 바로 아래에 판정이 본 범위를 적는다.
 * 문구는 발견을 펼친 안쪽의 첫 줄과 같은 데서 온다(`scope.ts` 의 `scopeNote`). 다만 코드 상자에는 곁에 조문 이름이
 * 없고 한 줄에 조문이 다른 발견이 함께 실릴 수 있어서, "이 조문"처럼 곁의 것을 가리키는 말은 코드 상자용으로 바꾼다.
 */
export interface LineMark {
  line: number;
  /** 이 줄 번호가 실린 발견의 수. 같은 줄에 규칙이나 정책이 다른 발견이 함께 있을 수 있다. */
  findings: number;
  /** 판정이 본 범위를 적은 문장. 발견마다 범위가 다르면 여럿이다. */
  notes: string[];
}

/** 이 파일에서 칠할 줄. 줄 순서다. 줄 번호가 없는 발견(`line: null`)은 칠할 줄이 없다. */
export function lineMarks(view: ReportView, file: string): LineMark[] {
  const marks = new Map<number, LineMark>();
  for (const policy of view.policies) {
    for (const location of policy.locations) {
      if (location.file !== file || location.line === null) continue;
      const mark = marks.get(location.line) ?? { line: location.line, findings: 0, notes: [] };
      const note = scopeNote(
        location.scope,
        location.lineUnsure ? "unsure" : "known",
        location.finding.decision_path.length > 0,
        "code",
      );
      mark.findings += 1;
      if (!mark.notes.includes(note)) mark.notes.push(note);
      marks.set(location.line, mark);
    }
  }
  return [...marks.values()].sort((a, b) => a.line - b.line);
}
