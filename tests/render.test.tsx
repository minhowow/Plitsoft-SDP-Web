import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportSummary } from "@/components/result/ReportSummary";
import { blocksToggle } from "@/components/result/selection";
import { packMeta } from "@/lib/pack";
import { parseReport } from "@/lib/report/parse";
import { scopeLabel } from "@/lib/report/scope";
import { STATUS_LABEL } from "@/lib/report/status";
import type { Finding, Report } from "@/lib/report/types";
import { buildReportView, type ReportView } from "@/lib/report/view-model";
import { closedDetailsAt, elementAt, elementsOf, jsonFiles, readJson, textOf } from "./helpers";
import { BANNED_WORDING } from "./wording";

// 결과 화면을 실제로 그려서 글자를 본다. 소스만 보는 시험이 놓치는 것(데이터에서 온 글, 조건에 따라 달라지는 글)을 잡는다.

function viewOf(data: unknown): ReportView {
  const parsed = parseReport(data);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return buildReportView(parsed.report, parsed.contract, packMeta);
}

function renderData(data: unknown): string {
  return renderToStaticMarkup(<ReportSummary view={viewOf(data)} />);
}

function render(...parts: string[]): string {
  return renderData(readJson(...parts));
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

const GROUP = '<section class="rule-group">';
const ROW = '<li class="finding">';
const FOLD = '<details class="more">';

/** 규칙 묶음 하나의 HTML. */
function ruleGroup(html: string, rule: string): string {
  const head = html.indexOf(`<h4>규칙 ${rule}</h4>`);
  if (head === -1) throw new Error(`규칙 묶음이 없습니다: ${rule}`);
  return elementAt(html, html.lastIndexOf(GROUP, head));
}

/** 발견 줄 하나를 뜯어 본 것. `summary` 는 줄이 닫혀 있어도 보이는 부분이고, 나머지는 펼쳐야 보인다. */
function rowParts(row: string) {
  const summary = elementAt(row, row.indexOf("<summary>"));
  const part = (open: string) => {
    const at = summary.indexOf(open);
    return at === -1 ? null : textOf(elementAt(summary, at));
  };
  const bodies = elementsOf(row, '<div class="finding-body">');
  const paths = elementsOf(row, '<ol class="path">');
  return {
    /** 처음부터 펼쳐져 있는지. */
    open: row.startsWith(`${ROW}<details open="">`),
    summary,
    where: part("<code>"),
    scope: part('<span class="finding-scope">'),
    status: part('<span class="chip '),
    rule: part('<span class="visually-hidden">'),
    bodies,
    body: bodies[0] ?? "",
    /** 판정 경로 목록의 수. 발견 하나에 하나이거나, 경로가 비어 있으면 없다. */
    pathLists: paths.length,
    /** 판정 경로의 문장들. 경로 목록이 없으면 null. */
    path: paths.length > 0 ? elementsOf(paths[0], "<li>").map(textOf) : null,
    alternatives: elementsOf(row, '<li class="alt">'),
  };
}

/** 그려 낸 화면의 발견 줄(문서 순서)과, 화면 구조가 정한 순서의 발견을 짝지어 준다. */
function rowsWithFindings(data: unknown) {
  const view = viewOf(data);
  const html = renderToStaticMarkup(<ReportSummary view={view} />);
  const expected = view.policies.flatMap((policy) =>
    policy.rules.flatMap((group) => [
      ...group.shown.map((location, i) => ({ location, first: i === 0, folded: false })),
      ...group.folded.map((location) => ({ location, first: false, folded: true })),
    ]),
  );
  const starts: number[] = [];
  for (let at = html.indexOf(ROW); at !== -1; at = html.indexOf(ROW, at + 1)) starts.push(at);
  expect(starts).toHaveLength(expected.length);
  return {
    html,
    rows: starts.map((at, i) => ({ at, ...expected[i], ...rowParts(elementAt(html, at)) })),
  };
}

const where = (file: string, line: number | null) => (line === null ? file : `${file}:${line}`);

/** 글들이 이 순서로 나오는지. 앞의 글을 찾은 자리 뒤에서 다음 글을 찾는다. */
function inOrder(text: string, needles: string[]): boolean {
  let from = 0;
  for (const needle of needles) {
    const at = text.indexOf(needle, from);
    if (at === -1) return false;
    from = at + needle.length;
  }
  return true;
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

  it("규칙마다 묶음이 따로 있고, 묶음마다 제 발견이 펼쳐져 있다", () => {
    const html = render("contract", "cli-current", "night-push.main.json");
    for (const [rule, alternative] of [
      ["nonemail-start-block", "label-name-phone"],
      ["nonemail-end-optout", "optout-080-free"],
    ]) {
      const group = ruleGroup(html, rule);
      expect(count(group, '<li class="finding">')).toBe(1);
      expect(count(group, '<details open="">')).toBe(1);
      expect(group).toContain(alternative);
      expect(textOf(group)).toContain("src/marketing/campaign.ts:2");
    }
  });
});

describe("발견 줄마다 제 발견이 그려진다", () => {
  // 닫힌 채 그려지는 줄(대표 2·3번째, 접힌 곳)은 사용자가 직접 펼쳐야 보인다. 그 안쪽까지 줄마다 본다.
  function expectRowsMatch(data: unknown) {
    const { html, rows } = rowsWithFindings(data);
    expect(rows).toHaveLength((data as Report).findings.length);
    for (const row of rows) {
      const { location } = row;
      const finding = location.finding;
      const name = `${location.rule} ${where(location.file, location.line)}`;
      // 닫혀 있어도 보이는 부분: 경로·줄, 판정이 본 범위, 상태. 화면 낭독기에는 규칙 이름도.
      expect(row.where, name).toBe(where(location.file, location.line));
      expect(row.scope, name).toBe(scopeLabel(location.scope));
      expect(row.status, name).toBe(STATUS_LABEL[location.status]);
      expect(row.rule, name).toBe(`규칙 ${location.rule}`);
      // 묶음의 첫 발견만 펼쳐 둔다.
      expect(row.open, name).toBe(row.first);
      // 접힌 곳의 발견만 닫힌 details(같은 규칙의 나머지) 하나에 가려 있다. 그 밖의 줄을 가리는 것은 없다.
      const hiddenBy = row.folded ? [FOLD] : [];
      expect(closedDetailsAt(html, row.at), name).toEqual(hiddenBy);
      // 줄이 닫혀 있어도 경로와 판정 범위는 줄과 함께 보인다(줄 자신의 닫힌 details 에 가려지지 않는다).
      for (const piece of ["<code>", '<span class="finding-scope">', '<span class="chip ']) {
        expect(closedDetailsAt(html, html.indexOf(piece, row.at)), `${name} ${piece}`).toEqual(hiddenBy);
      }
      // 안쪽은 펼쳐 둔 줄에서만 처음부터 보인다.
      const bodyAt = html.indexOf('<div class="finding-body">', row.at);
      expect(closedDetailsAt(html, bodyAt), `${name} 안쪽`).toEqual(row.first ? hiddenBy : [...hiddenBy, "<details>"]);
      // 펼친 안쪽은 그 발견의 것이다.
      expect(row.bodies, name).toHaveLength(1);
      expect(
        row.alternatives.map((alt) => textOf(elementAt(alt, alt.indexOf('<p class="alt-id">')))),
        name,
      ).toEqual(finding.unsatisfied_alternatives.map((alt) => alt.id));
      expect(row.pathLists, name).toBe(finding.decision_path.length > 0 ? 1 : 0);
      expect(row.path, name).toEqual(finding.decision_path.length > 0 ? finding.decision_path : null);
    }
  }

  it.each(every.map((parts) => [parts.join("/"), parts] as const))("%s", (_name, parts) => {
    expectRowsMatch(readJson(...parts));
  });

  it("같은 규칙이 반복돼 글이 같은 줄들도 서로 바뀌지 않는다 (발견마다 다른 글을 넣어 본다)", () => {
    const data = readJson("tests", "fixtures", "repeated-rule.json") as Report;
    const findings = data.findings.map((f, i) => ({
      ...f,
      decision_path: [...f.decision_path, `시험용 표시 ${i}번`],
      unsatisfied_alternatives: f.unsatisfied_alternatives.map((alt) => ({
        ...alt,
        remediation: `시험용 고치는 법 ${i}번`,
      })),
    }));
    expectRowsMatch({ ...data, findings });

    const { html, rows } = rowsWithFindings({ ...data, findings });
    findings.forEach((f, i) => {
      // 발견의 글은 화면에 한 번씩만, 제 줄 안에만 나온다.
      expect(count(html, `시험용 표시 ${i}번<`), f.file).toBe(1);
      expect(count(html, `시험용 고치는 법 ${i}번<`), f.file).toBe(f.unsatisfied_alternatives.length);
      const row = rows.find((r) => r.location.fingerprint === f.fingerprint)!;
      expect(row.path?.at(-1), f.file).toBe(`시험용 표시 ${i}번`);
      expect(textOf(row.body), f.file).toContain(`시험용 고치는 법 ${i}번`);
    });
  });

  it("상태가 섞여 있으면 줄마다 제 상태를 적는다", () => {
    const data = readJson("tests", "fixtures", "repeated-rule.json") as Report;
    const changes: Record<string, Partial<Finding>> = {
      "src/campaigns/winter-sale.ts": { ai_pending: [], untested_reasons: [] },
      "src/campaigns/weekend-deal.ts": { outcome: "needs-review-uncertain" },
    };
    const RULE = "nonemail-start-block";
    const findings = data.findings.map((f) => (f.rule === RULE ? { ...f, ...changes[f.file] } : f));
    expectRowsMatch({ ...data, findings });
    const { rows } = rowsWithFindings({ ...data, findings });
    const statusOf = (file: string) =>
      rows.find((r) => r.location.rule === RULE && r.location.file === file)?.status;
    expect(statusOf("src/campaigns/winter-sale.ts")).toBe("미충족 신호(검토 필요)");
    expect(statusOf("src/campaigns/weekend-deal.ts")).toBe("판단 보류(모름)");
    expect(statusOf("src/campaigns/black-friday.ts")).toBe("검토 필요 · AI 확인 전");
  });
});

describe("규칙 묶음은 가려지지 않는다", () => {
  it.each(every.map((parts) => [parts.join("/"), parts] as const))("%s", (_name, parts) => {
    // 규칙이 다른 발견은 서로 다른 의무다. 묶음을 통째로 접어 두는 것(닫힌 details)이 있으면 안 된다.
    const html = render(...parts);
    for (let at = html.indexOf(GROUP); at !== -1; at = html.indexOf(GROUP, at + 1)) {
      expect(closedDetailsAt(html, at), textOf(elementAt(html, at)).slice(0, 40)).toEqual([]);
    }
  });

  it("규칙이 다섯인 결과에서 묶음 다섯이 모두 처음부터 보인다", () => {
    const html = render("tests", "fixtures", "repeated-rule.json");
    const heads = elementsOf(html, "<h4>").map(textOf);
    expect(heads).toEqual([
      "규칙 nonemail-start-block",
      "규칙 nonemail-end-optout",
      "규칙 email-subject-label",
      "규칙 email-body-sender",
      "규칙 email-body-optout",
    ]);
    for (const head of heads) {
      expect(closedDetailsAt(html, html.indexOf(`<h4>${head}</h4>`)), head).toEqual([]);
    }
  });
});

describe("같은 규칙이 여러 파일에 반복되는 결과 (손으로 만든 시험용 자료)", () => {
  const html = render("tests", "fixtures", "repeated-rule.json");

  it("20개 파일에 반복되는 규칙은 대표 3곳을 먼저 보이고 나머지 17곳을 접는다", () => {
    const group = ruleGroup(html, "nonemail-start-block");
    expect(textOf(group)).toContain("20곳");
    const foldAt = group.indexOf(FOLD);
    expect(foldAt).toBeGreaterThan(-1);
    const shown = group.slice(0, foldAt);
    const folded = elementAt(group, foldAt);

    expect(count(shown, '<li class="finding">')).toBe(3);
    expect(count(folded, '<li class="finding">')).toBe(17);
    expect(folded).toContain("같은 규칙의 나머지 17곳");
    // 접힌 곳은 닫힌 채로 그려진다(open 이 없다). 그 안의 발견도 닫혀 있다.
    expect(folded.startsWith(`${FOLD}<summary>`)).toBe(true);
    expect(folded).not.toContain("<details open");

    expect(textOf(shown)).toContain("src/campaigns/black-friday.ts:2");
    expect(textOf(shown)).toContain("src/campaigns/coupon-reminder.ts:3");
    expect(textOf(shown)).not.toContain("src/campaigns/flash-sale.ts:2");
    expect(textOf(folded)).toContain("src/campaigns/flash-sale.ts:2");
    expect(textOf(folded)).toContain("src/features/marketing/sms/restock/sendRestockPromotionMessage.ts:4");
  });

  it("대표 3곳 가운데 첫 곳만 펼쳐 두고 나머지는 한 줄로 둔다", () => {
    const group = ruleGroup(html, "nonemail-start-block");
    const shown = elementsOf(group.slice(0, group.indexOf(FOLD)), ROW).map(rowParts);
    expect(shown.map((row) => [row.where, row.open])).toEqual([
      ["src/campaigns/black-friday.ts:2", true],
      ["src/campaigns/chuseok-gift.ts:2", false],
      ["src/campaigns/coupon-reminder.ts:3", false],
    ]);
  });

  it("닫힌 발견 줄에서도 줄 번호 옆에 판정이 본 범위가 보인다", () => {
    // 파일 단위 판정의 줄 번호는 조문이 닿는다고 본 첫 줄일 뿐이다. 펼치지 않은 줄이 그 줄을 문제의 줄처럼 보이면 안 된다.
    const rows = elementsOf(html, ROW).map(rowParts);
    expect(rows).toHaveLength(25);
    expect(rows.filter((row) => !row.open)).toHaveLength(20);
    for (const row of rows) {
      expect(row.where, row.where ?? "").toMatch(/:\d+$/);
      expect(row.scope, row.where ?? "").toBe("파일 전체 판정");
      // 범위는 펼친 안쪽이 아니라 줄 자체(summary)에 있다.
      expect(row.summary, row.where ?? "").not.toContain("finding-body");
    }
  });

  it("규칙이 다른 발견은 접힌 곳 밖에 보인다", () => {
    // 접힌 곳은 20개 파일에 반복된 규칙 하나뿐이다.
    expect(count(html, FOLD)).toBe(1);
    expect(html).toContain("발견 25건");
    for (const [rule, places] of [
      ["nonemail-end-optout", 2],
      ["email-subject-label", 1],
      ["email-body-sender", 1],
      ["email-body-optout", 1],
    ] as const) {
      const group = ruleGroup(html, rule);
      expect(group).not.toContain(FOLD);
      expect(count(group, '<li class="finding">')).toBe(places);
    }
    // 한 파일·한 줄에 함께 나온 서로 다른 세 규칙이 저마다 펼쳐져 있다.
    for (const rule of ["email-subject-label", "email-body-sender", "email-body-optout"]) {
      const group = ruleGroup(html, rule);
      expect(textOf(group)).toContain("src/mail/newsletter.ts:3");
      expect(count(group, '<details open="">')).toBe(1);
    }
  });

  it("접힌 곳에만 있는 상태는 묶음 머리에 개수로 보인다", () => {
    const data = readJson("tests", "fixtures", "repeated-rule.json") as Report;
    const uniform = textOf(ruleGroup(html, "nonemail-start-block").split("<ul")[0]);
    expect(uniform).toBe("규칙 nonemail-start-block20곳");

    // 파일 순서대로라면 접힌 곳에 들어가는 한 곳을 판단 보류로 바꾼다.
    const findings = data.findings.map((f) =>
      f.rule === "nonemail-start-block" && f.file === "src/campaigns/winter-sale.ts"
        ? { ...f, outcome: "needs-review-uncertain" }
        : f,
    );
    const mixed = ruleGroup(renderData({ ...data, findings }), "nonemail-start-block");
    const head = textOf(mixed.split("<ul")[0]);
    expect(head).toContain("검토 필요 · AI 확인 전 19곳");
    expect(head).toContain("판단 보류(모름) 1곳");
    expect(textOf(elementAt(mixed, mixed.indexOf(FOLD)))).toContain("src/campaigns/winter-sale.ts:2");
  });
});

describe("발견을 펼친 안쪽", () => {
  const body = (html: string) => elementAt(html, html.indexOf('<div class="finding-body">'));

  it("확인되지 않은 대안 → 질문 → 고치는 법 → 판정 경로 순서로 읽힌다", () => {
    const text = textOf(body(render("contract", "cli-current", "kids-signup.main.json")));
    expect(
      inOrder(text, [
        "확인되지 않은 적법한 대안 2개",
        "under14-branch",
        "만 14세 미만을 가르는 연령 분기가 보이지 않습니다.",
        "질문",
        "이 가입 흐름에서 만 14세 미만 사용자를 어떻게 가려내나요?",
        "고치는 법",
        "생년월일로 만 나이를 계산해 14세 미만 분기를 두세요.",
        "guardian-call",
        "보호자 동의를 확인하는 것으로 보이는 함수 호출이 없습니다.",
        "질문",
        "법정대리인 동의를 확인하는 함수 이름이 무엇인가요?",
        "고치는 법",
        "판정을 끝까지 하지 못한 이유",
        "ai-guard",
        "판정 경로",
        "적용: 정적 true",
        "대안 under14-branch: 정적 false",
        "→ needs-review",
      ]),
      text,
    ).toBe(true);
  });

  it("고치는 법이 실려 있지 않은 대안은 지어내지 않고 그렇다고 적는다", () => {
    const html = body(render("contract", "cli-current", "kids-signup.main.json"));
    // 수집본에서 guardian-call 의 remediation 은 null 이다.
    const guardian = textOf(elementAt(html, html.lastIndexOf('<li class="alt">')));
    expect(
      inOrder(guardian, [
        "guardian-call",
        "질문",
        "법정대리인 동의를 확인하는 함수 이름이 무엇인가요?",
        "고치는 법",
        "이 대안에는 고치는 법이 실려 있지 않습니다.",
      ]),
      guardian,
    ).toBe(true);
  });

  it("판정 경로는 CLI 가 낸 문장을 순서대로, 글자 그대로 보인다", () => {
    for (const file of jsonFiles("contract", "cli-current")) {
      const data = readJson("contract", "cli-current", file) as Report;
      const html = renderData(data);
      const paths = html.split('<ol class="path">').slice(1).map((part) => part.split("</ol>")[0]);
      expect(paths).toHaveLength(data.findings.length);
      const shown = paths.map((path) => path.split("</li>").slice(0, -1).map(textOf));
      for (const finding of data.findings) {
        expect(shown, `${file}: ${finding.rule}`).toContainEqual(finding.decision_path);
      }
    }
  });

  it("확인되지 않은 대안이 실려 있지 않으면 그렇다고 적고 판정 경로를 가리킨다", () => {
    // 약한 근거가 참이라 판단 보류로 남은 발견이다. 그 대안은 목록에 없고 판정 경로의 문장에만 나온다.
    const group = ruleGroup(render("contract", "cli-current", "genai-chat.fixed.json"), "ai-output-without-label");
    const text = textOf(group);
    expect(group).not.toContain('<li class="alt">');
    expect(text).toContain("결과에 실린 것이 없습니다");
    expect(text).toContain("대안 label-text: 약한 근거 — AI 확인 전에는 풀지 않음 → unknown");
  });

  it("값이 모름인 대안은 없다고 단정하지 않는다", () => {
    const data = readJson("tests", "fixtures", "incomplete-coverage.json") as Report;
    // 파일 일부를 읽지 못했거나 엔진이 조건을 끝내지 못하면 CLI 는 대안의 값을 unknown 으로 싣는다.
    const withValue = (value: string) =>
      renderData({
        ...data,
        findings: data.findings.map((f) => ({
          ...f,
          unsatisfied_alternatives: f.unsatisfied_alternatives.map((alt) => ({ ...alt, value })),
        })),
      });
    expect(withValue("unknown")).toContain("확인하지 못했을 뿐이고, 없다고 판정된 것은 아닙니다");
    expect(withValue("false")).not.toContain("확인하지 못했을 뿐이고");
  });

  it("판정자가 꺼져 있었다는 말을 두 번 적지 않는다. 다른 이유는 그대로 적는다", () => {
    const off = body(render("contract", "cli-current", "kids-signup.main.json"));
    expect(count(off, "판정자가 꺼져")).toBe(1);
    const unread = body(render("tests", "fixtures", "incomplete-coverage.json"));
    expect(unread).toContain("파일 일부를 읽지 못했습니다");
    expect(count(unread, "판정자가 꺼져")).toBe(1);
  });

  it("값이 거짓도 모름도 아닌 대안은 그 값을 그대로 적는다", () => {
    const data = readJson("contract", "cli-current", "kids-signup.main.json") as Report;
    const withValue = (value: string) =>
      renderData({
        ...data,
        findings: data.findings.map((f) => ({
          ...f,
          unsatisfied_alternatives: f.unsatisfied_alternatives.map((alt) => ({ ...alt, value })),
        })),
      });
    // CLI 0.3 은 거짓과 모름만 싣는다. 다른 값이 든 파일을 열었을 때 그 값을 숨기거나 거짓처럼 보이지 않는다.
    expect(withValue("true")).toContain("이 대안의 값: true");
    expect(withValue("false")).not.toContain("이 대안의 값:");
    expect(withValue("unknown")).not.toContain("이 대안의 값:");
  });

  it("메시지가 실려 있지 않은 대안은 빈 채로 둔다", () => {
    const data = readJson("contract", "cli-current", "kids-signup.main.json") as Report;
    const html = renderData({
      ...data,
      findings: data.findings.map((f) => ({
        ...f,
        unsatisfied_alternatives: f.unsatisfied_alternatives.map((alt) => ({ ...alt, message: null })),
      })),
    });
    const alternatives = elementsOf(html, '<li class="alt">');
    expect(alternatives).toHaveLength(2);
    for (const alt of alternatives) {
      expect(alt).not.toContain("alt-message");
      expect(textOf(alt)).not.toContain("null");
    }
  });
});

describe("판정이 본 범위", () => {
  // 줄 번호는 판정이 본 범위 안의 한 줄일 뿐이다. 줄 번호 옆(닫혀 있어도 보이는 자리)과 펼친 안쪽에 범위를 적는다.
  const kids = readJson("contract", "cli-current", "kids-signup.main.json") as Report;
  const rowWith = (patch: (finding: Finding) => unknown) => {
    const { rows } = rowsWithFindings({ ...kids, findings: kids.findings.map(patch) });
    expect(rows).toHaveLength(1);
    const [row] = rows;
    return { where: row.where, label: row.scope, note: textOf(elementAt(row.body, row.body.indexOf('<p class="hint">'))) };
  };

  it("파일 단위 판정: 파일 전체를 봤고, 줄 번호는 첫 줄일 뿐이라고 밝힌다", () => {
    expect(rowWith((f) => f)).toEqual({
      where: "src/auth/signup.ts:5",
      label: "파일 전체 판정",
      note: "파일 전체를 보고 내린 판정입니다. 줄 번호는 이 조문이 닿는다고 본 첫 줄입니다.",
    });
  });

  it("줄이 없는 발견에는 줄 번호를 붙이지 않고 줄 번호 이야기도 하지 않는다", () => {
    expect(rowWith((f) => ({ ...f, line: null }))).toEqual({
      where: "src/auth/signup.ts",
      label: "파일 전체 판정",
      note: "파일 전체를 보고 내린 판정입니다.",
    });
  });

  it("함수 단위 판정: 감싸는 함수가 있으면 그 줄 범위를 적는다", () => {
    expect(
      rowWith((f) => ({ ...f, scope: "anchor", region: { start_line: 3, end_line: 21 }, top_level: false })),
    ).toEqual({
      where: "src/auth/signup.ts:5",
      label: "함수 3~21행 판정",
      note: "함수 단위로 내린 판정입니다. 판정 구역은 3~21행입니다.",
    });
  });

  it("함수 단위 판정: 함수 밖의 줄을 본 판정이면 그렇다고 적는다", () => {
    expect(rowWith((f) => ({ ...f, scope: "anchor", region: null, top_level: true }))).toEqual({
      where: "src/auth/signup.ts:5",
      label: "함수 밖 판정",
      note: "함수 밖(모듈 최상위)의 줄을 보고 내린 판정입니다.",
    });
  });

  it("함수 단위 판정: 감싸는 함수가 없어 파일 전체를 본 판정이면 파일 단위와 같게 적는다", () => {
    expect(rowWith((f) => ({ ...f, scope: "anchor", region: null, top_level: false }))).toEqual({
      where: "src/auth/signup.ts:5",
      label: "파일 전체 판정",
      note: "파일 전체를 보고 내린 판정입니다. 줄 번호는 이 조문이 닿는다고 본 첫 줄입니다.",
    });
  });

  it("함수 단위인데 구역이 결과에 없으면 짐작하지 않고 알 수 없다고 적는다", () => {
    expect(
      rowWith((f) => {
        const finding: Partial<Finding> = { ...f, scope: "anchor", region: null };
        delete finding.top_level;
        return finding;
      }),
    ).toEqual({
      where: "src/auth/signup.ts:5",
      label: "판정 구역 알 수 없음",
      note: "함수 단위 규칙의 판정입니다. 판정 구역은 결과에 실려 있지 않아 알 수 없습니다.",
    });
  });
});

describe("수집본에 없는 드문 모양 (손으로 만든 시험용 자료)", () => {
  const { rows } = rowsWithFindings(readJson("tests", "fixtures", "uncommon-shapes.json"));
  const row = (rule: string, file: string, line: number | null) => {
    const found = rows.find((r) => r.location.rule === rule && r.location.file === file && r.location.line === line);
    if (!found) throw new Error(`발견 줄이 없습니다: ${rule} ${where(file, line)}`);
    return found;
  };

  it("함수 단위 판정은 줄마다 제 구역을 적는다. 같은 파일 안에서는 줄 순서다", () => {
    const anchored = rows.filter((r) => r.location.rule === "nonemail-start-block");
    expect(anchored.map((r) => [r.where, r.scope, r.folded])).toEqual([
      ["src/jobs/weekly-digest.ts:7", "파일 전체 판정", false],
      ["src/notifications/promo.ts:3", "함수 밖 판정", false],
      ["src/notifications/promo.ts:18", "함수 12~34행 판정", false],
      ["src/notifications/promo.ts:44", "함수 40~58행 판정", true],
    ]);
    expect(row("email-subject-label", "src/mail/weekly.ts", 4).scope).toBe("판정 구역 알 수 없음");
  });

  it("줄이 없는 발견은 파일 이름만 적는다", () => {
    const blast = row("nonemail-end-optout", "src/legacy/blast.js", null);
    expect(blast.where).toBe("src/legacy/blast.js");
    expect(blast.summary).not.toContain("where-tail");
    expect(textOf(blast.summary)).not.toContain("null");
    expect(textOf(blast.body)).toContain("파일 전체를 보고 내린 판정입니다.");
    expect(textOf(blast.body)).not.toContain("줄 번호는");
  });

  it("질문이 실려 있지 않은 대안은 지어내지 않고 그렇다고 적는다", () => {
    const blast = row("nonemail-end-optout", "src/legacy/blast.js", null);
    expect(blast.alternatives).toHaveLength(1);
    const alt = textOf(blast.alternatives[0]);
    const message = "보내는 메시지 본문 끝에서 '무료' 표시가 붙은 080 수신거부 번호를 확인하지 못했습니다.";
    expect(
      inOrder(alt, [
        "optout-080-free",
        message,
        "질문",
        "이 대안에는 질문이 실려 있지 않습니다.",
        "고치는 법",
        "이 대안에는 고치는 법이 실려 있지 않습니다.",
      ]),
      alt,
    ).toBe(true);
    // 메시지나 정책의 질문으로 빈자리를 채우지 않는다.
    expect(count(alt, message)).toBe(1);
    expect(alt).not.toContain("수신거부 방법이 정해진 자리에 들어가나요");
  });

  it("판정 경로가 실려 있지 않으면 그렇다고 적는다", () => {
    const notify = row("nonemail-end-optout", "src/legacy/notify.js", 9);
    expect(notify.path).toBeNull();
    const text = textOf(notify.body);
    expect(inOrder(text, ["판정 경로", "결과에 판정 경로가 실려 있지 않습니다."]), text).toBe(true);
    expect(text).not.toContain("CLI 가 남긴 문장 그대로입니다.");
    // 판정 경로가 있는 발견에는 이 안내가 나오지 않는다.
    expect(textOf(row("nonemail-end-optout", "src/legacy/blast.js", null).body)).not.toContain("판정 경로가 실려 있지 않습니다");
  });
});

describe("경로와 줄을 적는 법", () => {
  const kids = readJson("contract", "cli-current", "kids-signup.main.json") as Report;
  /** 발견 줄에 그려진 경로(code 요소)의 HTML. */
  const code = (file: string, line: number | null) => {
    const { rows } = rowsWithFindings({ ...kids, findings: kids.findings.map((f) => ({ ...f, file, line })) });
    return elementAt(rows[0].summary, rows[0].summary.indexOf("<code>"));
  };
  const BREAK = '<wbr aria-hidden="true"/>';

  it('"/" 뒤에 줄바꿈 자리를 두고, 확장자와 줄 번호는 한 덩어리로 묶는다', () => {
    expect(code("src/auth/signup.ts", 5)).toBe(
      `<code>src/${BREAK}auth/${BREAK}signup<span class="where-tail">.ts:5</span></code>`,
    );
    expect(code("src/app/page.test.tsx", 120)).toBe(
      `<code>src/${BREAK}app/${BREAK}page.test<span class="where-tail">.tsx:120</span></code>`,
    );
  });

  it("글자를 더하거나 빼지 않는다", () => {
    for (const [file, line] of [
      ["src/auth/signup.ts", 5],
      ["src/features/marketing/sms/restock/sendRestockPromotionMessage.ts", 4],
      ["/abs/path/index.js", 1],
      ["Makefile", 3],
      [".env", 2],
      ["src/a.b/c", 7],
      ["src/auth/signup.ts", null],
    ] as const) {
      expect(textOf(code(file, line)), file).toBe(where(file, line));
    }
  });

  it("확장자가 없으면 줄 번호만, 줄이 없으면 아무것도 묶지 않는다", () => {
    expect(code("Makefile", 3)).toBe('<code>Makefile<span class="where-tail">:3</span></code>');
    expect(code(".env", 2)).toBe('<code>.env<span class="where-tail">:2</span></code>');
    expect(code("src/auth/signup.ts", null)).toBe(`<code>src/${BREAK}auth/${BREAK}signup.ts</code>`);
  });

  it("묶은 덩어리는 줄을 바꾸지 못하므로 길면 줄 번호만 묶는다 (좁은 화면에서 넘치지 않게)", () => {
    const long = "notes.a-very-long-extension-name";
    expect(code(long, 12)).toBe(`<code>${long}<span class="where-tail">:12</span></code>`);
    // 묶은 덩어리는 16자를 넘지 않는다.
    for (const [file, line] of [
      ["a.typescript", 1234],
      ["a.typescript", 12345],
      ["a.ts", 123456789],
    ] as const) {
      const tail = textOf(elementAt(code(file, line), code(file, line).indexOf('<span class="where-tail">')));
      expect(tail.length, `${file}:${line}`).toBeLessThanOrEqual(16);
      expect(tail.endsWith(`:${line}`), `${file}:${line}`).toBe(true);
    }
  });
});

describe("발견 줄을 누를 때 (펼침과 글 고르기)", () => {
  // 줄 전체가 펼침 단추다. 경로를 끌어 골라 복사하는 동안에는 줄이 여닫히지 않아야 한다.
  // 브라우저에서 실제로 그렇게 되는지는 이 시험이 보지 못한다(docs/ROADMAP.md 의 8번).
  const click = { detail: 1, selecting: false, extending: false, toggles: 0 };

  it("그냥 누르면 여닫힌다", () => {
    expect(blocksToggle(click)).toBe(false);
    // 끌었어도 골라진 글이 없으면 누른 것이다.
    expect(blocksToggle({ ...click, extending: true })).toBe(false);
  });

  it("끌거나 Shift 를 누른 채 눌러 글을 골랐으면 여닫히지 않는다", () => {
    expect(blocksToggle({ ...click, selecting: true, extending: true })).toBe(true);
  });

  it("이미 골라져 있던 글 위를 그냥 누르면 여닫힌다", () => {
    expect(blocksToggle({ ...click, selecting: true })).toBe(false);
  });

  it("키보드로 누르면 글이 골라져 있어도 여닫힌다", () => {
    expect(blocksToggle({ detail: 0, selecting: true, extending: false, toggles: 0 })).toBe(false);
    expect(blocksToggle({ detail: 0, selecting: true, extending: true, toggles: 0 })).toBe(false);
  });

  it("두 번·세 번 이어 눌러 글을 골라도 처음 상태로 돌아온다", () => {
    // 브라우저가 차례로 보내는 클릭을 그대로 흉내 낸다. 첫 클릭 때는 아직 골라진 글이 없다.
    const run = (clicks: number) => {
      let open = false;
      let toggles = 0;
      for (let detail = 1; detail <= clicks; detail++) {
        if (detail === 1) toggles = 0;
        if (!blocksToggle({ detail, selecting: detail > 1, extending: false, toggles })) {
          open = !open;
          toggles += 1;
        }
      }
      return open;
    };
    expect(run(1)).toBe(true);
    expect(run(2)).toBe(false);
    expect(run(3)).toBe(false);
    expect(run(4)).toBe(false);
  });
});
