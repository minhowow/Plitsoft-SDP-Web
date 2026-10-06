import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportSummary } from "@/components/result/ReportSummary";
import { packMeta } from "@/lib/pack";
import { parseReport } from "@/lib/report/parse";
import { buildReportView } from "@/lib/report/view-model";
import { jsonFiles, readJson } from "./helpers";
import { BANNED_WORDING } from "./wording";

// 결과 화면을 실제로 그려서 글자를 본다. 소스만 보는 시험이 놓치는 것(데이터에서 온 글, 조건에 따라 달라지는 글)을 잡는다.

function render(...parts: string[]): string {
  const parsed = parseReport(readJson(...parts));
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return renderToStaticMarkup(<ReportSummary view={buildReportView(parsed.report, parsed.contract, packMeta)} />);
}

const every: string[][] = [
  ...jsonFiles("contract", "cli-current").map((f) => ["contract", "cli-current", f]),
  ...jsonFiles("contract", "samples-v1-draft").map((f) => ["contract", "samples-v1-draft", f]),
  ...jsonFiles("tests", "fixtures").map((f) => ["tests", "fixtures", f]),
];

describe("그려 낸 결과 화면의 문구", () => {
  it.each(every.map((parts) => [parts.join("/"), parts] as const))("%s", (_name, parts) => {
    const html = render(...parts);
    for (const [pattern, why] of BANNED_WORDING) {
      expect(pattern.test(html), `${pattern} — ${why}`).toBe(false);
    }
    expect(html).toContain("법률 자문이 아닙니다");
  });

  it("발견이 0이면 법적 문제가 없다는 뜻이 아니라고 적는다", () => {
    expect(render("contract", "cli-current", "plain.main.json")).toContain("법적 문제가 없다는 뜻은 아닙니다");
  });
});

describe("판정자에 관한 문구", () => {
  it("판정자가 꺼져 있었으면 켜 보라고 권하되, 코드가 외부로 나간다는 것을 함께 적는다", () => {
    const html = render("contract", "cli-current", "kids-signup.main.json");
    expect(html).toContain("판정자가 꺼져 있었습니다");
    expect(html).toContain("외부 API 로 나갑니다");
  });

  it("판정자를 켰는데 답을 쓰지 못한 경우에는 켜 보라고 하지 않는다", () => {
    const html = render("tests", "fixtures", "judge-on.citation-rejected.json");
    expect(html).not.toContain("판정자를 켜고");
    expect(html).toContain("답을 쓸 수 없었습니다");
    expect(html).toContain("인용한 코드가 확인되지 않았습니다");
  });

  it("AI 가 푼 경고를 숨기지 않고, 구분할 수 없다고도 하지 않는다", () => {
    const html = render("tests", "fixtures", "judge-on.cleared.json");
    expect(html).toContain("AI 가 푼 경고 1건");
    expect(html).toContain("const age = calcKoreanAge(form.birthDate);");
    expect(html).toContain("풀린 경고가 1건 있습니다");
  });

  it("적용 질문으로 빠진 판정을 숨기지 않는다", () => {
    const html = render("tests", "fixtures", "judge-on.dismissed.json");
    expect(html).toContain("빠진 판정 1건");
    expect(html).toContain("아니오");
  });
});

describe("다 보지 못한 결과", () => {
  it("세 목록을 뜻에 맞게 나눠 적는다", () => {
    const html = render("tests", "fixtures", "incomplete-coverage.json");
    expect(html).toContain("다 보지 못했습니다");
    expect(html).toContain("검사하지 않은 파일 1개");
    expect(html).toContain("이 파일들은 결과에 없습니다");
    expect(html).toContain("일부를 읽지 못한 파일 1개");
    expect(html).toContain("결과에는 들어 있습니다");
  });
});

describe("발견의 단위", () => {
  it("같은 줄의 서로 다른 규칙은 규칙 이름과 함께 따로 보인다", () => {
    const html = render("contract", "cli-current", "night-push.main.json");
    expect(html).toContain("규칙 nonemail-start-block");
    expect(html).toContain("규칙 nonemail-end-optout");
    expect(html).toContain("발견 2건");
  });
});
