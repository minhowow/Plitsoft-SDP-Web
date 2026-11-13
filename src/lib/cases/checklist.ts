import { parseReview } from "@/lib/review";
import { checklistDoc, type ChecklistDoc, type ChecklistSource } from "@/lib/review/checklist";
import { SITE } from "@/lib/site";
import { casesFile, type CaseData } from "./index";

/**
 * 사례의 의무 체크리스트 내보내기(마크다운 파일과 인쇄용 보기, 2026-11-13). 사례 쪽과 같이 미리 돌린 결과라는 것, 돌린 날, CLI 판,
 * 판정 규칙만 다시 건 결과라는 것을 머리에 적는다(docs/commitments.md 의 1). 모델은 검증 정보에 있다. review 가 없으면 null.
 */
export function caseChecklist(c: CaseData): { doc: ChecklistDoc; source: ChecklistSource } | null {
  const review = parseReview(c.review);
  if (!review) return null;
  const { ranOn, cli, regate } = casesFile.reviewRun;
  return {
    doc: checklistDoc(review, c.recheck),
    source: {
      repo: `${c.owner}/${c.name}`,
      htmlUrl: c.htmlUrl,
      commit: c.commit,
      facts: [`${SITE.cases.prerun} ${ranOn} · CLI ${cli}`, ...(regate ? [`${SITE.cases.regate} · 규칙 CLI ${regate.cli}`] : [])],
    },
  };
}
