import Ajv from "ajv/dist/2020";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewView } from "@/components/review/ReviewView";
import { parseReview } from "@/lib/review";
import { layoutFlow } from "@/lib/review/flow";
import CasePage from "@/app/cases/[slug]/page";
import CasesPage from "@/app/cases/page";
import { casesFile } from "@/lib/cases";
import { REVIEW_GOODS_LABEL, REVIEW_RECHECK_LABEL, REVIEW_STATUS_LABEL } from "@/lib/report/status";
import { closedDetailsAt, elementAt, elementsOf, readJson, textOf } from "./helpers";

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

  it("흐름 그림: 내보내기만 하는 외부는 첫 단의 아래에, 같은 단 안의 화살표는 위아래로 곧게", () => {
    const node = (id: string, kind: "input" | "server" | "store" | "external") => ({ id, kind, label: id, data: [], citations: [] });
    const edge = (from: string, to: string) => ({ from, to, data: [], citations: [] });
    const layout = layoutFlow(
      [node("in", "input"), node("kakao", "external"), node("api", "server"), node("agent", "server"), node("db", "store")],
      [edge("in", "api"), edge("kakao", "api"), edge("kakao", "db"), edge("in", "agent"), edge("agent", "api"), edge("api", "db")],
    );
    const box = (id: string) => layout.boxes.find((b) => b.id === id)!;
    expect(box("kakao").x).toBe(box("in").x);
    expect(box("kakao").y).toBeGreaterThan(box("in").y);
    expect(layout.columns.map((c) => c.title)).toEqual(["받는 것", "처리", "저장"]);
    const up = layout.paths.find((p) => p.from === "agent" && p.to === "api")!;
    expect(up.d).toMatch(/^M[\d.]+,[\d.]+ L[\d.]+,[\d.]+$/);
    expect(layout.paths.some((p) => p.outward)).toBe(false);
    // 첫 단에서 마지막 단으로 건너뛰는 화살표는 가운데 단의 상자 사이 틈으로 곧게 지나간다(상자 뒤로 지나가지 않는다).
    const skip = layout.paths.find((p) => p.from === "kakao" && p.to === "db")!;
    const through = /L([\d.]+),([\d.]+)/.exec(skip.d)!;
    expect(Number(through[1])).toBe(box("api").x + box("api").w);
    for (const id of ["api", "agent"]) {
      const b = box(id);
      expect(Number(through[2]) > b.y && Number(through[2]) < b.y + b.h, id).toBe(false);
    }
  });

  it("다시 검토 중: 짚은 의무는 상태·까닭·인용 없이 이름만 맨 아래에 접고, 갈래 수와 맨 위 한 줄의 수에서 뺀다", () => {
    const review = parseReview(sample())!;
    const held = review.checklist.find((item) => item.status === "not-applicable")!;
    const html = renderToStaticMarkup(<ReviewView review={review} recheck={[held.duty]} />);
    expect(html).not.toContain('<details class="rv-group rv-not-applicable">');
    const at = html.indexOf('<details class="rv-group rv-recheck">');
    expect(at).toBeGreaterThan(-1);
    const fold = elementAt(html, at);
    expect(textOf(elementsOf(fold, "<summary>")[0])).toBe(`${REVIEW_RECHECK_LABEL} 1건`);
    expect(textOf(fold)).toContain(held.dutyText);
    expect(textOf(fold)).not.toContain(REVIEW_STATUS_LABEL["not-applicable"]);
    expect(fold).not.toContain("rv-searches");
  });

  it("2판 덧붙임(CLI f4967db): 품목 묶음은 한 줄로 접고 확인할 것의 수에서 빼며, 관문의 메모·까닭 이름·프로필 신호의 빈 줄을 그대로 싣지 않고, 없는 것을 적는다", () => {
    const data = sample();
    const base = (data.checklist as Record<string, unknown>[])[0];
    const note = "걸리는 조건 자체가 없다는 답(applies '아니오'와 condition)이 없어 '해당 없음'으로 받지 않았습니다.";
    const named = "인용이 조문이 요구하는 행위가 아니라 이름·기본값뿐이라 '충족 근거 있음'으로 받지 않았습니다.";
    const goods = (duty: string, name: string) => ({
      ...base,
      duty,
      duty_text: `${name} 판매 의무 ${duty}`,
      status: "check-applicability",
      asked: false,
      not_answered: "goods-not-detected",
      group: "goods",
      first: null,
      verification: { result: "not-run", why: "goods-not-detected" },
      citations: [],
      searches: [],
      question: `${name}도 판매하나요? 판매한다면 이 의무가 걸립니다.`,
      reason: `${name} 판매에만 걸리는 의무입니다. 코드에서 이 품목의 신호를 찾지 못해 묻지 않았습니다.`,
    });
    const checklist = [
      {
        ...base,
        duty: "gate-no-condition",
        status: "check-applicability",
        first: { ...(base.first as object), gate: { from: "not-applicable", why: "no-condition", note } },
        reason: `${note} 모델이 쓴 말 하나. 모델이 쓴 말 둘.`,
      },
      {
        ...base,
        duty: "gate-name",
        status: "seen-in-code",
        missing: "약관 고지 화면이 없음",
        first: { ...(base.first as object), gate: { from: "evidence-found", why: "name-or-default", note: named } },
        reason: `${named} helmet 기본값으로 HSTS 를 켭니다.`,
        citations: [{ file: "src/app/signup/page.tsx", line: null, text: "", ok: true, why: "profile" }],
      },
      {
        ...base,
        duty: "gate-said",
        status: "check-applicability",
        first: { ...(base.first as object), gate: { from: "not-applicable", why: "condition-present", note: "조건 메모." } },
        reason: "조건 메모. 모델의 말.",
      },
      {
        ...base,
        duty: "gate-unknown",
        status: "check-applicability",
        first: { ...(base.first as object), gate: { from: "seen-in-code", why: "applies-unknown", note: "모름 메모." } },
        reason: "모름 메모. 제공인지 위탁인지는 개발자 판단입니다.",
      },
      { ...base, duty: "cap", status: "unknown", asked: false, first: null, not_answered: "cost-cap", reason: "저장소당 금액 상한에 걸려 묻지 못했습니다" },
      goods("liquor-1", "주류"),
      goods("books-1", "도서"),
    ];
    const review = parseReview({ ...data, checklist })!;
    expect(review.checklist.map((item) => item.gate)).toEqual(["no-condition", "name-or-default", "condition-present", "applies-unknown", null, null, null]);
    expect(review.checklist[0].reason).toBe("모델이 쓴 말 하나. 모델이 쓴 말 둘.");
    const html = renderToStaticMarkup(<ReviewView review={review} code={{ htmlUrl: "https://github.com/o/r", commit: "a".repeat(40) }} />);
    const text = textOf(html);
    for (const raw of ["goods-not-detected", "cost-cap", "applies", "condition", "충족 근거 있음"]) expect(text, raw).not.toContain(raw);
    // 품목 묶음: '해당 여부부터' 갈래 바로 뒤의 한 줄. 맨 위 한 줄의 확인할 것은 품목 의무를 빼고 센다(2건).
    const at = html.indexOf('<details class="rv-group rv-goods">');
    expect(at).toBeGreaterThan(html.indexOf('<details class="rv-group rv-check-applicability">'));
    expect(textOf(elementsOf(html.slice(at), "<summary>")[0])).toBe(`${REVIEW_GOODS_LABEL} 2건`);
    expect(textOf(elementAt(html, at))).toContain("주류도 판매하나요?");
    expect(textOf(elementsOf(html, '<p class="overview">')[0])).toContain("확인할 것 4건");
    expect(textOf(elementsOf(html.slice(html.indexOf('<details class="rv-group rv-check-applicability">')), "<summary>")[0])).toBe(
      `${REVIEW_STATUS_LABEL["check-applicability"]} 3건`,
    );
    // CLI 2a24d94 의 까닭도 이 사이트의 말로(메모를 그대로 싣지 않는다).
    expect(text).toContain("AI 가 걸리는지 모른다고 답해 '해당 여부부터 확인할 것'으로 옮겼습니다.");
    expect(text).not.toContain("모름 메모.");
    // 조건이 AI 의 말뿐이면(해당 여부부터) 조건이 있다고 단정하지 않는다.
    expect(text).toContain(`AI 가 걸리는 조건이 있다고 답해 '${REVIEW_STATUS_LABEL["not-applicable"]}'을 받지 않았습니다.`);
    expect(text).not.toContain("조건 메모.");
    // 관문이 바꾼 항목: 첫 줄은 이 사이트의 상태 이름으로 적은 까닭, 모델의 말은 '자세히'에.
    expect(text).toContain(`걸리는 조건이 없다는 근거가 없어 AI 가 낸 '${REVIEW_STATUS_LABEL["not-applicable"]}'을 받지 않았습니다.`);
    expect(text).toContain(`'${REVIEW_STATUS_LABEL["evidence-found"]}'으로 받지 않았습니다.`);
    expect(text).toContain("모델이 쓴 말 하나. 모델이 쓴 말 둘.");
    expect(text).toContain("없는 것 약관 고지 화면이 없음");
    // 프로필 신호는 인용한 줄(빈 글)이 아니라 기능 신호의 파일 링크.
    expect(html).not.toContain('<code class="cite-text" translate="no"></code>');
    expect(text).toContain("기능 신호: src/app/signup/page.tsx");
    // 묻지 못한 항목은 reason 의 말만(까닭 이름을 싣지 않는다).
    expect(text).toContain("저장소당 금액 상한에 걸려 묻지 못했습니다");
  });
});

describe("사례 쪽: review 2판 실측(2026-11-12)", () => {
  it("사례 4곳의 결과는 모두 읽히고, 짚은 의무는 그 결과의 체크리스트에 있다. 사례 쪽은 review 화면을 그리고 짚은 의무를 접는다", async () => {
    // CLI f4967db 로 다시 돌린 결과(2026-11-12)에서 사례 4곳의 '다시 검토 중'은 걷어 냈다(오너 지시).
    expect(casesFile.reviewRun.cli).toBe("f4967db");
    expect(casesFile.cases.flatMap((c) => c.recheck)).toEqual([]);
    for (const c of casesFile.cases) {
      const review = parseReview(c.review);
      expect(review, c.slug).not.toBeNull();
      for (const duty of c.recheck) expect(review!.checklist.map((item) => item.duty), c.slug).toContain(duty);
      const html = renderToStaticMarkup(await CasePage({ params: Promise.resolve({ slug: c.slug }) }));
      expect(html).toContain('<figure class="flow">');
      expect(html.includes('<details class="rv-group rv-recheck">'), c.slug).toBe(c.recheck.length > 0);
      expect(html).toContain(c.commit.slice(0, 7));
    }
  });

  it("성격이 다른 저장소 8곳: 이름·주소 없이 성격과 갈래별 건수·시간·비용만. 라이브러리는 빈 체크리스트", () => {
    expect(casesFile.others.map((o) => o.kind)).toEqual(["쇼핑몰", "위치", "가입만", "AI 없는 커뮤니티", "라이브러리", "POS", "자체 서버 AI", "실시간 게임"]);
    for (const row of casesFile.others) expect(Object.keys(row).sort()).toEqual(["counts", "kind", "recheck", "seconds", "usd"]);
    // 비용은 공식 단가로 다시 센 것이다(11/12 실측 12곳 합계 $15.06, 사례 4곳의 그날 몫 $5.12 를 빼면 8곳 $9.94).
    expect(Math.round(casesFile.others.reduce((sum, row) => sum + row.usd, 0) * 100) / 100).toBe(9.94);
    const library = casesFile.others.find((o) => o.kind === "라이브러리")!;
    expect(Object.values(library.counts).every((n) => n === 0)).toBe(true);
    const html = renderToStaticMarkup(<CasesPage />);
    const table = elementsOf(html, '<table class="tbl others-table"')[0];
    expect(elementsOf(table, "<tr>").length).toBe(2 + casesFile.others.length);
    expect(table).not.toContain("<a ");
    // 8곳은 사례 4곳과 다른 판(e12e6ba)으로 돌렸다는 것을 표 위에 적는다.
    expect(textOf(html)).toContain(`CLI ${casesFile.othersRun.cli}`);
  });
});

