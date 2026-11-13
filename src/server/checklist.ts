import "server-only";
import { isAnalysisId } from "@/lib/service/id";
import { ServiceUnavailableError } from "@/lib/service/errors";
import { formatKst } from "@/lib/service/steps";
import type { Analysis, ServiceStore } from "@/lib/service/types";
import { checklistDoc, checklistFileName, checklistMarkdown, type ChecklistDoc, type ChecklistSource } from "@/lib/review/checklist";
import { showsSyntheticTag } from "./config";
import { internalError } from "./http";
import { getStore } from "./store";

/**
 * 끝난 분석의 의무 체크리스트 내보내기(2026-11-13 오너 지시): 인쇄용 보기(분석 쪽 아래 `checklist/`)와 마크다운 파일
 * (`GET /api/analyses/{id}/checklist/`)이 이것을 읽는다. 같은 커밋의 review 결과가 있는 끝난 분석에만 있다. GitHub 은 부르지 않는다
 * (저장소 주소는 이름으로 만든다. 합성 예시·가짜 GitHub 이면 주소를 적지 않고 합성 예시라고 적는다).
 */
export async function analysisChecklist(
  id: string,
  store: ServiceStore = getStore(),
  tagged = showsSyntheticTag(),
): Promise<{ analysis: Analysis; doc: ChecklistDoc; source: ChecklistSource } | null> {
  if (!isAnalysisId(id)) return null;
  const analysis = await store.findAnalysis(id);
  if (!analysis || analysis.status !== "succeeded") return null;
  const review = await store.getReview(analysis.owner, analysis.name, analysis.commit);
  if (!review) return null;
  // 분석 쪽의 기록과 같다: 검사한 날은 검사 단계가 시작한 때다.
  const scannedAt = analysis.steps.find((step) => step.name === "scan")?.startedAt ?? analysis.requestedAt;
  return {
    analysis,
    doc: checklistDoc(review),
    source: {
      repo: `${analysis.owner}/${analysis.name}`,
      htmlUrl: tagged ? null : `https://github.com/${analysis.owner}/${analysis.name}`,
      commit: analysis.commit,
      facts: [...(tagged ? ["합성 예시"] : []), `분석 ${analysis.id} · 검사 ${formatKst(scannedAt)} KST`],
    },
  };
}

/** 글 응답(오류). 캐시하지 않는다. */
const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

/** 마크다운 파일 응답(받기). 이름은 영문·숫자·붙임표만이다(`checklistFileName`). */
export function markdownResponse(doc: ChecklistDoc, source: ChecklistSource, cache = "no-store"): Response {
  return new Response(checklistMarkdown(doc, source), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${checklistFileName(source)}"`,
      "cache-control": cache,
    },
  });
}

/** GET /api/analyses/{id}/checklist/ */
export async function getChecklistMarkdown(id: string, store?: ServiceStore, tagged?: boolean): Promise<Response> {
  try {
    const found = await analysisChecklist(id, store, tagged);
    if (!found) return text("이 분석에는 내보낼 체크리스트가 없습니다.", 404);
    return markdownResponse(found.doc, found.source);
  } catch (error) {
    if (error instanceof ServiceUnavailableError) return text(error.message, 503);
    return internalError("GET /api/analyses/[id]/checklist", error);
  }
}
