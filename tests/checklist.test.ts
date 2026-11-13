import { describe, expect, it } from "vitest";
import { casesFile } from "@/lib/cases";
import { caseChecklist } from "@/lib/cases/checklist";
import { REVIEW_GOODS_LABEL, REVIEW_RECHECK_LABEL, REVIEW_STATUS_LABEL } from "@/lib/report/status";
import { parseReview, REVIEW_STATUSES } from "@/lib/review";
import { checklistDoc, checklistFileName, checklistMarkdown } from "@/lib/review/checklist";
import { SANCTION } from "@/lib/review/text";
import { syntheticStore } from "@/lib/service/synthetic";
import { SITE } from "@/lib/site";
import { getChecklistMarkdown } from "@/server/checklist";
import { BANNED_WORDING } from "./wording";

// 의무 체크리스트 내보내기(2026-11-13 오너 지시): 마크다운 파일과 인쇄용 보기가 같은 모양(checklistDoc)에서 나온다.

describe("체크리스트 내보내기", () => {
  it("사례마다: 갈래 차례는 화면과 같고 의무는 빠짐없이 한 번씩, 다시 검토 중인 의무는 맨 끝에 이름만", () => {
    for (const c of casesFile.cases) {
      const review = parseReview(c.review)!;
      const doc = checklistDoc(review, c.recheck);
      const order = [...REVIEW_STATUSES.map((status) => REVIEW_STATUS_LABEL[status]), REVIEW_GOODS_LABEL, REVIEW_RECHECK_LABEL];
      const labels = doc.groups.map((group) => group.label);
      expect(labels.map((label) => order.indexOf(label))).toEqual([...labels.map((label) => order.indexOf(label))].sort((a, b) => a - b));
      // 품목 의무는 '해당 여부부터' 바로 뒤.
      if (labels.includes(REVIEW_GOODS_LABEL)) expect(labels.indexOf(REVIEW_GOODS_LABEL)).toBeGreaterThan(-1);
      const duties = doc.groups.flatMap((group) => group.entries.map((entry) => entry.duty));
      expect(duties.sort()).toEqual(review.checklist.map((item) => item.duty).sort());
      // 코드에서 본 것은 결과의 요약이 고른 의무가 먼저다.
      const seen = doc.groups.find((group) => group.key === "seen-in-code");
      const top = review.summary.top.filter((duty) => seen?.entries.some((entry) => entry.duty === duty));
      expect(seen?.entries.slice(0, top.length).map((entry) => entry.duty) ?? []).toEqual(top);
      expect(doc.overview.check).toBe(
        review.checklist.filter((item) => !c.recheck.includes(item.duty) && ["seen-in-code", "check-outside", "check-applicability"].includes(item.status) && item.group !== "goods").length,
      );
    }
  });

  it("마크다운: 맨 위에 자문·인증이 아니라는 말, 저장소·커밋·미리 돌린 결과, 할 일 칸은 확인할 것에만. 도구가 거절한 인용은 싣지 않는다", () => {
    for (const c of casesFile.cases) {
      const review = parseReview(c.review)!;
      const { doc, source } = caseChecklist(c)!;
      const text = checklistMarkdown(doc, source);
      expect(text.startsWith(`# 의무 체크리스트 · ${c.owner}/${c.name}\n`)).toBe(true);
      expect(text).toContain(SITE.record.lead);
      expect(text).toContain(c.htmlUrl);
      expect(text).toContain(c.commit.slice(0, 7));
      expect(text).toContain(`${SITE.cases.prerun} ${casesFile.reviewRun.ranOn}`);
      expect(text).toContain(`조사 ${review.run.models.investigate}`);
      const todo = doc.groups.filter((group) => group.todo).reduce((n, group) => n + group.entries.length, 0);
      expect(text.match(/^- \[ \] /gm)?.length ?? 0).toBe(todo);
      for (const item of review.checklist) {
        for (const cite of item.citations.filter((cite) => !cite.ok)) {
          // 같은 줄이 다른 의무에서 통과한 인용으로 실렸을 수 있다. 그 의무에서만 본다.
          const ok = review.checklist.some((other) => other.citations.some((o) => o.ok && o.text.trim() === cite.text.trim()));
          if (!ok && cite.text.trim().length > 12) expect(text, `${c.slug} ${item.duty}`).not.toContain(cite.text.trim());
        }
        if (item.dutyText && SANCTION.test(item.dutyText)) expect(text).not.toContain(item.dutyText);
      }
      for (const [pattern, why] of BANNED_WORDING) expect(pattern.test(text), `${c.slug}: ${why}`).toBe(false);
      expect(checklistFileName(source)).toMatch(/^checklist-[A-Za-z0-9._-]+-[0-9a-f]{7}\.md$/);
    }
  });

  it("처분의 말이 든 의무 한 줄은 싣지 않는다", () => {
    const c = casesFile.cases[0];
    const review = parseReview(c.review)!;
    const word = String.fromCodePoint(0xacfc, 0xd0dc, 0xb8cc);
    const changed = { ...review, checklist: review.checklist.map((item, i) => (i === 0 ? { ...item, dutyText: `${item.dutyText} ${word}` } : item)) };
    const doc = checklistDoc(changed);
    const entry = doc.groups.flatMap((group) => group.entries).find((e) => e.duty === review.checklist[0].duty)!;
    expect(entry.dutyText).toBe("");
    expect(checklistMarkdown(doc, caseChecklist(c)!.source)).not.toContain(word);
  });

  it("분석의 마크다운 파일(GET /api/analyses/{id}/checklist/): review 가 있는 끝난 분석만, 받기 머리와 함께. 합성이면 주소 없이 합성 예시", async () => {
    const response = await getChecklistMarkdown("4qqa6fdx2h", syntheticStore, true);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="checklist-example-studio-genai-chat-5d34db9.md"');
    const text = await response.text();
    expect(text).toContain("- 합성 예시");
    expect(text).toContain("분석 4qqa6fdx2h");
    expect(text).not.toContain("https://github.com/");
    // review 가 없는 분석, 끝나지 않은 분석, 없는 분석.
    for (const id of ["wtk33e9zuf", "9f4gxaqj6s", "zzzzzzzzzz", "../etc"]) expect((await getChecklistMarkdown(id, syntheticStore, true)).status).toBe(404);
  });
});
