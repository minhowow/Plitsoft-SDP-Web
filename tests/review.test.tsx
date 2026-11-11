import Ajv from "ajv/dist/2020";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewView } from "@/components/review/ReviewView";
import { parseReview } from "@/lib/review";
import { layoutFlow } from "@/lib/review/flow";
import { REVIEW_STATUS_LABEL } from "@/lib/report/status";
import { closedDetailsAt, elementsOf, readJson, textOf } from "./helpers";

// review 2판(policypack review, CLI e12e6ba)의 결과를 읽는 부품과 화면(2026-11-11 오너 지시). 자료는 손으로 만든 합성 예시다.
const sample = () => readJson("contract", "review", "genai-chat.review.json") as Record<string, unknown>;

describe("review 결과 (2판)", () => {
  it("합성 예시는 CLI 의 스키마(contract/schema/review.cli-2.schema.json)에 맞고, 읽으면 화면이 쓰는 필드가 다 있다", () => {
    const validate = new Ajv({ strict: false, allErrors: true }).compile(readJson("contract", "schema", "review.cli-2.schema.json") as object);
    expect(validate(sample()), JSON.stringify(validate.errors)).toBe(true);
    const review = parseReview(sample())!;
    expect(review.flow.nodes.map((n) => n.kind)).toEqual(["input", "input", "server", "server", "store", "store", "external", "external"]);
    expect(review.summary.top).toHaveLength(5);
    expect(review.checklist.map((item) => item.status)).toContain("not-applicable");
    // 판이 다르거나 모양이 다르면 읽지 않는다.
    expect(parseReview({ ...sample(), review_version: 1 })).toBeNull();
    expect(parseReview({ ...sample(), checklist: [{ duty: "x", status: "to-check" }] })).toBeNull();
  });

  it("흐름 그림: 받는 것 | 처리 | 저장·외부로 보냄. 외부로 가는 화살표만 눈에 띄게 그린다", () => {
    const review = parseReview(sample())!;
    const layout = layoutFlow(review.flow.nodes, review.flow.edges);
    expect(layout.columns.map((c) => c.title)).toEqual(["받는 것", "처리", "저장 · 외부로 보냄"]);
    const box = (id: string) => layout.boxes.find((b) => b.id === id)!;
    // 마지막 단은 저장이 위, 외부가 아래다.
    expect(Math.max(box("n5").y, box("n6").y)).toBeLessThan(Math.min(box("n7").y, box("n8").y));
    expect(layout.paths.filter((p) => p.outward).map((p) => `${p.from}>${p.to}`).sort()).toEqual(["n3>n8", "n4>n7"]);
  });

  it("체크리스트: 코드에서 본 것의 맨 위 다섯 건은 펼쳐 두고, 나머지 갈래는 접는다. 해당 없음은 찾아본 말과 다시 센 건수를 펼치면 보인다", () => {
    const html = renderToStaticMarkup(<ReviewView review={parseReview(sample())!} />);
    const lead = elementsOf(html, '<ol class="rv-items">')[0];
    expect(elementsOf(lead, '<li class="rv-item">')).toHaveLength(5);
    expect(closedDetailsAt(html, html.indexOf('<ol class="rv-items">'))).toEqual([]);
    for (const status of ["check-outside", "check-applicability", "unknown", "evidence-found", "likely-not-applicable", "not-applicable"] as const) {
      const at = html.indexOf(`<details class="rv-group rv-${status}">`);
      expect(at, status).toBeGreaterThan(-1);
      expect(textOf(elementsOf(html.slice(at), "<summary>")[0])).toBe(`${REVIEW_STATUS_LABEL[status]} 1건`);
    }
    const na = html.slice(html.indexOf('<details class="rv-group rv-not-applicable">'));
    expect(textOf(na)).toContain("찾아본 말 1개");
    expect(textOf(na)).toContain("다시 센 줄 0줄");
    // 검증 정보: 결과에 실린 수 그대로.
    const info = textOf(elementsOf(html, '<section class="box info rv-verify"')[0]);
    expect(info).toContain("31개 · 검사기가 거절 2개");
    expect(info).toContain("유지 10 · 뒤집음 1");
    expect(info).toContain("$1.42 (상한 $2)");
  });

  it("인용은 관문을 통과한 것만, 의무 한 줄에 처분의 말이 들면 싣지 않는다", () => {
    const data = sample();
    const checklist = (data.checklist as Record<string, unknown>[]).map((item, i) =>
      i === 0
        ? {
            ...item,
            duty_text: `처리방침 공개 \u{acfc}\u{d0dc}\u{b8cc} 대상`,
            citations: [...(item.citations as object[]), { file: "src/x.ts", line: 1, text: "REJECTED_LINE", ok: false, why: "not-found" }],
          }
        : item,
    );
    const html = renderToStaticMarkup(<ReviewView review={parseReview({ ...data, checklist })!} />);
    expect(html).not.toContain("REJECTED_LINE");
    expect(html).not.toContain("처리방침 공개");
  });
});
