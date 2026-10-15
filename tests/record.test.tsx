import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecordRefused, RecordSheet } from "@/components/result/Record";
import { ReportSummary } from "@/components/result/ReportSummary";
import { ReportWithRecord } from "@/components/result/ReportWithRecord";
import { packIndex } from "@/lib/pack";
import { EFFECTIVE_FROM_NOTE, LEGAL_NOTE } from "@/lib/pack/guide";
import type { PackIndex } from "@/lib/pack/types";
import { coverageSummary, GAPS_NOTE, GAPS_TITLE, SARIF_COUNTS_NOTE } from "@/lib/report/coverage";
import { parseReport } from "@/lib/report/parse";
import {
  AI_CLEARED,
  AI_DISMISSED,
  buildRecord,
  FINGERPRINT_NOTE,
  LINE_UNSURE,
  NOT_IN_PACK,
  NOT_IN_RESULT,
  policySourceNote,
  primaryLawNote,
  RECORD_OMITS,
  RECORD_REFUSED,
  SAME_TEXT_NOTE,
  sourceLine,
  type RecordSource,
  type RecordView,
} from "@/lib/report/record";
import { LINE_IS_FIRST, scopeLabel, scopeNote } from "@/lib/report/scope";
import { findingStatus, NOT_REPORTED_NOR_CLEARED, STATUS_LABEL, STATUS_LEGEND, STATUS_ORDER } from "@/lib/report/status";
import type { AiCleared, AiDismissed, Finding, Report } from "@/lib/report/types";
import { buildReportView, CONTRACT_LABEL, type ReportView } from "@/lib/report/view-model";
import { SITE } from "@/lib/site";
import { elementAt, elementsOf, jsonFiles, readJson, readPackFile, root, sarifFiles, textOf, walk } from "./helpers";
import { withCodeEverywhere } from "./record-data";
import { BANNED_WORDING } from "./wording";

// 조문별 검사 기록(인쇄용): 연 결과 하나를 한 장으로 옮긴 것(docs/ROADMAP.md 의 7번, docs/architecture.md 의 "조문별 검사 기록").
// 무엇을 싣는지(`src/lib/report/record.ts`)와 어떻게 그리는지(`src/components/result/Record.tsx`)를 본다. 브라우저에서만
// 드러나는 것(단추로 고르기, 인쇄할 때 무엇이 나오는지, 쪽수, 좁은 화면, 색)은 tests/browser/record.test.ts 가 본다.
//
// 화면 구조와 기록은 브라우저로 넘기는 팩 정보(`packIndex`)로 만든다. 사이트가 실제로 그렇게 만든다. 기대값은 팩
// 메타데이터를 파일에서 직접 읽어 얻는다(`readPackFile`). 팩의 날짜·해시·글을 여기에 적어 두지 않는다.

const packFile = readPackFile();
/** 팩 메타데이터의 정책(id 로 찾는다). */
const metaOf = (id: string) => packFile.policies.find((policy) => policy.id === id)!;

function viewOf(data: unknown, pack: PackIndex = packIndex): ReportView {
  const parsed = parseReport(data);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return buildReportView(parsed.report, parsed.contract, pack);
}

/** 기록을 만든다. 만들지 못하면 시험이 볼 것이 없으므로 멈춘다. */
function recordOf(data: unknown): RecordView {
  const result = buildRecord(viewOf(data), packIndex);
  if (!result.ok) throw new Error(`기록을 만들지 못했습니다: ${result.reasons.join(" ")}`);
  return result.record;
}

/** 직접 연 파일로 만든 기록이라고 적는다(합성 예시가 아니다). */
const FILE: RecordSource = { name: "result.json", synthetic: false };

function sheet(data: unknown, source: RecordSource = FILE): string {
  return renderToStaticMarkup(<RecordSheet record={recordOf(data)} source={source} />);
}

const read = (...parts: string[]) => readJson(...parts) as Report;
const capture = (name: string) => read("contract", "cli-current", `${name}.json`);
const fixture = (name: string) => read("tests", "fixtures", `${name}.json`);

/** 사이트가 여는 결과 전부: 수집본(JSON, SARIF), v1 초안 예시, 시험용 자료. 모두 이 사이트의 팩과 판이 같다. */
const every: [string, string[]][] = [
  ...jsonFiles("contract", "cli-current").map((file) => ["contract", "cli-current", file]),
  ...sarifFiles("contract", "cli-current").map((file) => ["contract", "cli-current", file]),
  ...jsonFiles("contract", "samples-v1-draft").map((file) => ["contract", "samples-v1-draft", file]),
  ...jsonFiles("tests", "fixtures").map((file) => ["tests", "fixtures", file]),
].map((parts) => [parts.join("/"), parts]);

/** 그 결과가 결과 JSON 의 모양으로 옮겨진 것(SARIF 도 같은 모양으로 읽는다). */
function reportOf(parts: string[]): Report {
  const parsed = parseReport(readJson(...parts));
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return parsed.report;
}

const count = (text: string, needle: string) => text.split(needle).length - 1;

/**
 * 값 안에 든 글(문자열) 전부. 기록을 그리는 자료(`RecordView`)에 어떤 글이 들어 있는지 볼 때 쓴다. 필드의 이름과 JSON 의
 * 기호는 섞이지 않는다(코드의 줄에는 따옴표와 중괄호가 흔하다).
 */
function stringsIn(value: unknown): string {
  const out: string[] = [];
  const collect = (entry: unknown) => {
    if (typeof entry === "string") out.push(entry);
    else if (Array.isArray(entry)) entry.forEach(collect);
    else if (entry !== null && typeof entry === "object") Object.values(entry).forEach(collect);
  };
  collect(value);
  return out.join("\n");
}

/**
 * 표 하나를 뜯어 본 것: 이름, 칸 머리, 줄(줄의 이름과 칸들. 칸은 쌓았을 때 앞에 적는 이름과 글). 표의 이름은 그 구역의
 * 제목이다. 표가 `aria-labelledby` 로 가리키는 것이 그 제목인지는 `readSheet` 가 본다.
 */
function tableParts(table: string, name: string) {
  const head = elementAt(table, table.indexOf("<thead"));
  return {
    name,
    columns: elementsOf(head, "<th ").map(textOf),
    /** 칸 머리를 화면에서만 가렸는지. */
    headHidden: head.startsWith('<thead class="visually-hidden"'),
    groups: elementsOf(table, "<tbody").map((tbody) =>
      elementsOf(tbody, "<tr ").map((tr) => ({
        open: /^<tr[^>]*>/.exec(tr)![0],
        head: textOf(elementsOf(tr, "<th ")[0] ?? ""),
        headHtml: elementsOf(tr, "<th ")[0] ?? "",
        cells: elementsOf(tr, "<td ").map((td) => ({
          label: /data-label="([^"]*)"/.exec(/^<td[^>]*>/.exec(td)![0])?.[1] ?? null,
          text: textOf(td),
          html: td,
        })),
      })),
    ),
  };
}

/**
 * 그려 낸 기록을 뜯어 본 것. 머리(이름, 무엇으로 만든 것인지, 맨 위의 말, 경고)와 구역들.
 * `text` 는 기록의 글 전부다. 기록에 없어야 할 글(코드 등)은 여기서 찾는다.
 */
function readSheet(html: string) {
  expect(count(html, '<article class="record">')).toBe(1);
  const article = elementAt(html, html.indexOf('<article class="record">'));
  // 기록 밖에는 아무것도 없다. 인쇄할 때 이 요소만 나온다.
  expect(article).toBe(html);
  const one = (open: string) => {
    const at = article.indexOf(open);
    return at === -1 ? null : elementAt(article, at);
  };
  const head = one('<header class="record-head">')!;
  const sections = elementsOf(article, '<section class="record-section">');
  // 구역마다 제목(h4)이 하나, 맨 앞에 있다. 표가 든 구역에서는 그 제목이 표의 이름이다. 표는 `aria-labelledby` 로 그 제목을
  // 가리키고, 이름을 따로(caption) 두 번 적지 않는다. 제목으로 건너다니는 사람이 표가 든 구역을 지나치지 않는다.
  expect(article).not.toContain("<caption");
  const parts = sections.map((html) => {
    expect(count(html, "<h4")).toBe(1);
    const h4 = /^<section class="record-section">(<h4(?: id="([^"]+)")?>[\s\S]*?<\/h4>)/.exec(html)!;
    expect(h4, html.slice(0, 80)).not.toBeNull();
    const tables = elementsOf(html, "<table");
    expect(tables.length).toBeLessThanOrEqual(1);
    // 표가 가리키는 것은 제 구역의 제목이다. 표가 없는 구역의 제목에는 id 가 없다.
    expect(tables.map((table) => /^<table class="[^"]*" role="table" aria-labelledby="([^"]+)">/.exec(table)?.[1] ?? null)).toEqual(tables.map(() => h4[2]));
    if (tables.length === 0) expect(h4[2]).toBeUndefined();
    return { html, title: textOf(h4[1]), id: h4[2] ?? null, table: tables.length > 0 ? tableParts(tables[0], textOf(h4[1])) : null, tableHtml: tables[0] ?? null };
  });
  // 제목의 id 는 서로 다르다(한 표가 다른 구역의 제목을 가리키지 않는다).
  const ids = parts.flatMap((part) => (part.id ? [part.id] : []));
  expect(new Set(ids).size).toBe(ids.length);
  expect(count(article, " id=")).toBe(ids.length);
  const table = (title: string) => parts.find((part) => part.table !== null && part.title.startsWith(title))?.table ?? null;
  const section = (title: string) => parts.find((part) => part.title.startsWith(title))?.html ?? null;
  const factsAt = article.indexOf('<dl class="record-facts">');
  const facts = elementsOf(elementAt(article, factsAt), "<div>").map((row) => ({
    label: textOf(elementAt(row, row.indexOf("<dt>"))),
    value: textOf(elementAt(row, row.indexOf("<dd"))),
    code: row.includes("<code>"),
    missing: row.includes('<dd class="none">'),
  }));
  const found = section("발견 ")!;
  const policies = table("정책별 대표 조문과 발견");
  // 정책 표 아래의 목록: 값에 관한 말이 먼저 오고, 발견이 없는 정책에 적힌 상태의 뜻(이름을 굵게 적는다)이 뒤따른다.
  const notes = policies ? elementsOf(elementAt(article, article.indexOf('<ul class="record-notes">')), "<li>") : [];
  const legendFrom = notes.findIndex((li) => li.startsWith("<li><strong>"));
  expect(notes.slice(legendFrom === -1 ? notes.length : legendFrom).every((li) => li.startsWith("<li><strong>"))).toBe(true);
  return {
    article,
    text: textOf(article),
    title: textOf(elementAt(head, head.indexOf("<h3>"))),
    source: textOf(elementAt(head, head.indexOf('<p class="record-source">'))),
    /** 그 바로 아래에 적은, 이 기록에 싣지 않은 것. */
    omits: textOf(elementAt(head, head.indexOf('<p class="record-omits">'))),
    notice: textOf(elementAt(head, head.indexOf('<p class="record-notice">'))),
    /** 맨 위의 말에서 굵게 적은 첫머리. */
    lead: textOf(elementAt(head, head.indexOf("<strong>"))),
    warning: head.includes('<p class="record-warning">') ? textOf(elementAt(head, head.indexOf('<p class="record-warning">'))) : null,
    /** 구역의 이름(문서 순서). 표가 있는 구역에서는 표의 이름이기도 하다. */
    sections: parts.map((part) => part.title),
    /**
     * 구역마다 제목 아래에 놓인 것의 차례: 표(`table`), 표 위에 적는 말(`about`), 그 밖의 것(태그나 class 이름). 표가 쪽을
     * 넘어갈 수 있는 구역이 표로 끝나는지 볼 때 쓴다.
     */
    layout: parts.map((part) => ({
      title: part.title,
      order: [...part.html.replace(/^<section class="record-section"><h4[\s\S]*?<\/h4>/, "").replace(/<\/section>$/, "").matchAll(/<(table|p|ul|dl)\b(?: class="([^"]*)")?[^>]*>[\s\S]*?<\/\1>/g)].map(
        (match) => (match[1] === "table" ? "table" : match[2] === "hint record-about" ? "about" : (match[2] ?? match[1])),
      ),
    })),
    /** 표 위에 적은 말(구역의 이름으로 찾는다). */
    about: (title: string) => elementsOf(section(title) ?? "", '<p class="hint record-about">').map(textOf),
    facts,
    factNotes: elementsOf(section("검사 정보")!, '<p class="hint">').map(textOf),
    gaps: table(GAPS_TITLE)!,
    gapsNote: textOf(elementsOf(section(GAPS_TITLE)!, '<p class="hint">').at(-1)!),
    found: {
      heading: textOf(elementAt(found, found.indexOf("<h4>"))),
      counts: elementsOf(found, "<li>").map(textOf),
      /** 상태별 수 말고 적은 문단(0의 뜻, AI 가 푼 것의 수). */
      notes: elementsOf(found, "<p>").map(textOf),
    },
    policies,
    /** 정책 표 아래에 적은, 값에 관한 말(어느 팩의 값인지, 해시가 같은 줄, 시행일의 한계). */
    policyNotes: notes.filter((li) => !li.startsWith("<li><strong>")).map(textOf),
    /** 그 뒤에 적은, 발견이 없는 정책에 적힌 상태의 뜻("이름: 뜻"). */
    statusNotes: notes.filter((li) => li.startsWith("<li><strong>")).map(textOf),
    findings: table("발견의 자리와 지문"),
    aiCleared: table(AI_CLEARED),
    aiDismissed: table(AI_DISMISSED),
  };
}

const where = (file: string, line: number | null | undefined) => (line === null || line === undefined ? file : `${file}:${line}`);

describe("기록에 싣는 것", () => {
  it("볼 결과가 있다: 수집본 7개와 SARIF, v1 초안 예시 3개, 시험용 자료", () => {
    expect(every.length).toBeGreaterThanOrEqual(17);
    // 모두 이 사이트의 팩과 판이 같다. 그래야 기록을 만든다(아래 "기록을 만들지 않는 결과").
    for (const [name, parts] of every) expect(reportOf(parts).run.pack_digest, name).toBe(packFile.pack.digest);
  });

  it.each(every)("%s: 차례는 머리 → 검사 정보 → 다 보지 못한 것 → 발견 → 정책 → 발견의 자리와 지문 → AI 가 푼 것", (_name, parts) => {
    const report = reportOf(parts);
    const page = readSheet(sheet(readJson(...parts)));
    const cleared = report.run.ai_cleared ?? [];
    const dismissed = report.run.ai_dismissed ?? [];
    expect(page.title).toBe("조문별 검사 기록");
    expect(page.sections).toEqual([
      "검사 정보",
      `${GAPS_TITLE} ${GAPS_NOTE}`,
      `발견 ${report.findings.length}건`,
      "정책별 대표 조문과 발견",
      // 발견이 없으면 그 표를 그리지 않는다. AI 의 기록도 있을 때만 그린다.
      ...(report.findings.length > 0 ? ["발견의 자리와 지문"] : []),
      ...(cleared.length > 0 ? [`${AI_CLEARED} ${cleared.length}건`] : []),
      ...(dismissed.length > 0 ? [`${AI_DISMISSED} ${dismissed.length}건`] : []),
    ]);
    // 기록은 머리와 구역들뿐이다. 마지막 구역 뒤에 따로 선 글이 없다. 표가 한 쪽을 넘으면 인쇄할 때 그 글만 마지막 쪽에 남을
    // 수 있다(docs/architecture.md 의 "조문별 검사 기록"의 "인쇄").
    const head = elementAt(page.article, page.article.indexOf('<header class="record-head">'));
    const sections = elementsOf(page.article, '<section class="record-section">');
    expect(page.article).toBe(`<article class="record">${head}${sections.join("")}</article>`);
  });

  it.each(every)("%s: 길어질 수 있는 표(발견, AI 의 표 둘)는 구역의 끝이다. 덧붙이는 말은 제목과 표 사이에 있다", (_name, parts) => {
    // 앞 쪽에서 이어진 표의 뒤에 온 글은 인쇄할 때 표의 마지막 줄과 붙지 않는다. 표의 끝이 쪽의 끝에 걸리면 그 글만 다음 쪽에
    // 남는다(빠진 판정 28건, AI 가 푼 경고 29건, SARIF 의 1행인 발견 40건에서 그랬다. docs/architecture.md 의 "인쇄").
    const report = reportOf(parts);
    const page = readSheet(sheet(readJson(...parts)));
    const order = (title: string) => page.layout.find((entry) => entry.title.startsWith(title))?.order ?? null;
    expect(order("발견의 자리와 지문")).toEqual(report.findings.length > 0 ? ["about", "table"] : null);
    expect(order(AI_CLEARED)).toEqual((report.run.ai_cleared ?? []).length > 0 ? ["about", "table"] : null);
    expect(order(AI_DISMISSED)).toEqual((report.run.ai_dismissed ?? []).length > 0 ? ["about", "table"] : null);
    // 표 아래에 말이 남은 구역은 둘이다. "다 보지 못한 것"은 늘 다른 구역이 뒤따르고, 정책 표는 줄이 팩의 정책 수만큼이다.
    expect(order(GAPS_TITLE)).toEqual(["table", "hint"]);
    expect(order("정책별 대표 조문과 발견")).toEqual(["table", "record-notes"]);
    expect(page.sections.at(-1)).not.toBe(`${GAPS_TITLE} ${GAPS_NOTE}`);
    expect(recordOf(readJson(...parts)).policies.length).toBeLessThanOrEqual(packFile.policies.length);
  });

  describe("정책별 대표 조문, 시행일, 원문 해시", () => {
    it.each(every)("%s: 정책마다 data/pack-meta.json 의 첫 조문 그대로다", (_name, parts) => {
      const data = readJson(...parts);
      const view = viewOf(data);
      const record = recordOf(data);
      // 줄은 결과 화면의 정책 카드와 같은 정책, 같은 차례다. 제목은 팩에 적힌 것이다(수집본에서는 카드의 제목과 같다).
      expect(record.policies.map((policy) => [policy.id, policy.title])).toEqual(view.policies.map((policy) => [policy.id, policy.title]));
      expect(record.policies.map((policy) => policy.title)).toEqual(record.policies.map((policy) => metaOf(policy.id).title));
      expect(record.policies.length).toBeGreaterThan(0);
      for (const policy of record.policies) {
        const primary = metaOf(policy.id).legal[0];
        expect([policy.law, policy.effectiveFrom, policy.textSha256], policy.id).toEqual([
          primary.label,
          primary.effective_from,
          primary.text_sha256,
        ]);
        // 팩의 원문 파일과 해시가 맞는 조문이다. 덧붙일 말이 없다.
        expect(primary.text_sha256_matches, policy.id).toBe(true);
        expect(policy.hashNote, policy.id).toBeNull();
      }

      // 그려 낸 표에 그 값이 그대로 보인다.
      const table = readSheet(sheet(data)).policies!;
      expect(table.columns).toEqual(["정책", "대표 조문", "시행일", "원문 해시", "발견"]);
      expect(table.groups).toHaveLength(1);
      expect(table.groups[0].map((row) => [row.head, ...row.cells.map((cell) => cell.text)])).toEqual(
        record.policies.map((policy) => {
          const primary = metaOf(policy.id).legal[0];
          return [`${policy.title} ${policy.id}`, primary.label, primary.effective_from, primary.text_sha256, policy.found.join("")];
        }),
      );
    });

    it("대표 조문은 결과의 발견에 적힌 조문이다 (수집본의 발견으로 견준다)", () => {
      let seen = 0;
      for (const [name, parts] of every) {
        const report = reportOf(parts);
        const record = recordOf(readJson(...parts));
        for (const finding of report.findings) {
          expect(record.policies.find((policy) => policy.id === finding.policy)!.law, `${name}: ${finding.policy}`).toBe(finding.law);
          seen += 1;
        }
      }
      expect(seen).toBeGreaterThan(30);
    });

    it.each(every)("%s: 표 아래에 값의 출처(이 결과와 판이 같은 팩), 대표 조문이 무엇인지, 시행일의 한계를 적는다. 해시가 같은 줄이 있으면 그 까닭도 적는다", (name, parts) => {
      const data = readJson(...parts);
      const record = recordOf(data);
      // 팩 메타데이터에서: 기록에 나온 정책들 가운데 대표 조문의 이름은 다른데 원문 해시가 같은 것이 있는지.
      const primaries = record.policies.map((policy) => metaOf(policy.id).legal[0]);
      const shared = primaries.some((a, i) => primaries.slice(i + 1).some((b) => a.text_sha256 !== null && a.text_sha256 === b.text_sha256 && a.label !== b.label));
      // CLI 0.3 의 JSON 과 SARIF 에는 정책 목록이 없다. 표의 줄부터 팩에서 온 것이라고 적는다. v1 초안은 결과의 요약에 나온
      // 정책만 적으므로 줄은 결과에서 오고, 제목·조문·시행일·해시가 팩에서 온다.
      const fromPack = `이 결과와 판이 같은 팩(팩 판 ${packFile.pack.digest})에 적힌 값입니다.`;
      const draft = name.startsWith("contract/samples-v1-draft/");
      expect(viewOf(data).contract === "v1-draft", name).toBe(draft);
      // 대표 조문은 정책의 첫 근거 조문이다. 표에 든 정책 가운데 근거 조문이 더 있는 정책의 수를 팩 메타데이터에서 센다(9번).
      const more = record.policies.filter((policy) => metaOf(policy.id).legal.length > 1).length;
      if (!draft) expect(more, name).toBe(packFile.policies.filter((policy) => policy.legal.length > 1).length);
      expect(record.policyNotes).toEqual([
        draft
          ? `정책의 제목과 대표 조문, 시행일, 원문 해시(SHA-256)는 ${fromPack}`
          : `정책 목록과 대표 조문, 시행일, 원문 해시(SHA-256)는 ${fromPack} 결과에는 정책 목록이 없습니다.`,
        ...(shared ? [SAME_TEXT_NOTE] : []),
        `대표 조문은 팩에 적힌 정책의 근거 조문 가운데 첫째입니다.${more === 0 ? "" : ` 근거 조문이 더 있는 정책이 ${more}개이고, 그 조문은 조문 도감에 있습니다.`}`,
        EFFECTIVE_FROM_NOTE,
      ]);
      expect(record.policyNotes[0]).toBe(policySourceNote(viewOf(data).contract, packFile.pack.digest));
      // 그려 낸 표 아래에 그대로 보인다.
      expect(readSheet(sheet(data)).policyNotes).toEqual(record.policyNotes);
    });

    it("결과에 정책이 하나도 실려 있지 않아도(발견이 0인 CLI 0.3 의 결과) 표에는 팩의 정책이 모두 있다. 그 줄이 팩에서 왔다고 밝힌다", () => {
      // 머리는 "연 파일에 적힌 것을 옮긴 기록"이라고 적는다. 그 파일에 없는 줄은 어디서 왔는지 밝혀야 한다. 결과 화면도
      // 같은 것을 밝힌다("결과에는 정책 목록이 없어, 팩 판이 같은 이 사이트의 팩에서 가져와 …").
      const data = capture("kids-signup.fixed");
      expect(data.findings).toEqual([]);
      // 그 파일에는 정책 id 가 하나도 없다.
      const raw = readFileSync(path.join(root, "contract", "cli-current", "kids-signup.fixed.json"), "utf8");
      for (const policy of packFile.policies) expect(raw, policy.id).not.toContain(policy.id);
      const page = readSheet(sheet(data));
      expect(page.source).toContain("에 적힌 것을 옮긴 기록입니다.");
      expect(page.policies!.groups[0].map((row) => row.head)).toEqual(packFile.policies.map((policy) => `${policy.title} ${policy.id}`));
      expect(page.policyNotes[0]).toContain("정책 목록과 대표 조문, 시행일, 원문 해시(SHA-256)는");
      expect(page.policyNotes[0].endsWith("결과에는 정책 목록이 없습니다.")).toBe(true);
      expect(renderToStaticMarkup(<ReportSummary view={viewOf(data)} />)).toContain("결과에는 정책 목록이 없어, 팩 판이 같은 이 사이트의 팩에서 가져와 아래에 적었습니다.");
      // SARIF 로 연 결과도 같다. v1 초안은 정책이 결과의 요약에 실려 있으므로 그 말을 적지 않는다.
      expect(readSheet(sheet(readJson("contract", "cli-current", "kids-signup.main.sarif"))).policyNotes[0].endsWith("결과에는 정책 목록이 없습니다.")).toBe(true);
      const draft = read("contract", "samples-v1-draft", "kids-signup.fixed.json");
      expect(draft.run.policies!.length).toBeGreaterThan(0);
      expect(readSheet(sheet(draft)).policyNotes[0]).not.toContain("정책 목록");
    });

    it("정책의 제목은 팩에 적힌 것을 적는다. 결과의 발견에 실린 제목은 옮기지 않는다", () => {
      // `findings[].title` 은 파서가 글자인지만 보는 글이다. CLI 는 팩의 제목을 싣지만(CLI 소스 evaluate/engine.py 의 Finding),
      // 손으로 고친 파일에는 무엇이든 들 수 있다. 결과 화면은 결과에 실린 제목을 보인다. 기록에는 코드를 싣지 않는다.
      const base = capture("kids-signup.main");
      const [finding] = base.findings;
      const data = { ...base, findings: [{ ...finding, title: "const leaked = code();" }] };
      expect(viewOf(data).policies.find((policy) => policy.id === finding.policy)!.title).toBe("const leaked = code();");
      const page = readSheet(sheet(data));
      expect(page.text).not.toContain("leaked");
      expect(stringsIn(recordOf(data))).not.toContain("leaked");
      expect(page.policies!.groups[0].map((row) => row.head)).toContain(`${metaOf(finding.policy).title} ${finding.policy}`);
      // 고치지 않은 결과에서는 두 제목이 같은 글이다.
      expect(finding.title).toBe(metaOf(finding.policy).title);
    });

    it("시행일의 한계는 조문 도감과 같은 말이다", () => {
      expect(EFFECTIVE_FROM_NOTE).toBe("시행일이 어느 판본의 날짜인지는 팩이 아직 알려 주지 않습니다.");
      expect(LEGAL_NOTE.endsWith(` ${EFFECTIVE_FROM_NOTE}`)).toBe(true);
    });

    it("대표 조문의 뜻: 근거 조문이 더 있는 정책의 수는 넘긴 팩 정보의 조문 수로 센다. 그런 정책이 없으면 첫 문장만 적는다", () => {
      // 이 사이트의 팩에서는 늘 그런 정책이 있다(수는 위의 시험이 팩 메타데이터로 센다). 넘기는 팩 정보의 조문을 손으로 덜어 본다.
      // 대표 조문(첫 조문)은 그대로 둔다. 발견에 적힌 조문 이름이 그것과 같아야 기록을 만든다.
      const data = capture("kids-signup.main");
      const packWith = (keep: (policy: PackIndex["policies"][number]) => number): PackIndex => ({
        ...packIndex,
        policies: packIndex.policies.map((policy) => ({ ...policy, legal: policy.legal.slice(0, keep(policy)) })),
      });
      const noteWith = (pack: PackIndex) => {
        const result = buildRecord(viewOf(data, pack), pack);
        if (!result.ok) throw new Error(result.reasons.join(" "));
        return result.record.policyNotes.filter((note) => note.startsWith("대표 조문은"));
      };
      const first = "대표 조문은 팩에 적힌 정책의 근거 조문 가운데 첫째입니다.";
      expect(primaryLawNote(0)).toBe(first);
      expect(primaryLawNote(2)).toBe(`${first} 근거 조문이 더 있는 정책이 2개이고, 그 조문은 조문 도감에 있습니다.`);
      // 모든 정책이 조문 하나뿐이면 첫 문장만.
      expect(noteWith(packWith(() => 1))).toEqual([first]);
      // 조문이 둘 이상인 정책 가운데 하나만 그대로 두면 1개다.
      const longer = packIndex.policies.find((policy) => policy.legal.length > 1)!;
      expect(longer).toBeDefined();
      expect(noteWith(packWith((policy) => (policy === longer ? policy.legal.length : 1)))).toEqual([primaryLawNote(1)]);
      // 넘긴 팩 정보 그대로면 팩 메타데이터에서 센 수다.
      expect(noteWith(packIndex)).toEqual([primaryLawNote(packFile.policies.filter((policy) => policy.legal.length > 1).length)]);
    });

    it("대표 조문의 이름은 다른데 원문 해시가 같은 줄이 있을 때만 '원문이 같은 조문'이라고 적는다", () => {
      // 팩의 원문 파일은 조 단위라, 한 조의 다른 항을 대표 조문으로 든 정책들은 해시가 같다. 그 말이 없으면 한쪽 해시를
      // 잘못 옮겨 적은 것처럼 읽힌다. 넘기는 팩 정보를 손으로 바꿔 본다(팩에 어떤 조문이 실려 있든 같은 것을 본다).
      expect(SAME_TEXT_NOTE).toBe("원문 해시가 같은 줄은 팩에 실린 원문이 같은 조문입니다.");
      const data = capture("kids-signup.main");
      type Primary = PackIndex["policies"][number]["legal"][number];
      /** 정책마다(팩의 차례) 대표 조문을 바꾼 팩 정보. */
      const packWith = (change: (primary: Primary, i: number) => Primary): PackIndex => ({
        ...packIndex,
        policies: packIndex.policies.map((policy, i) => ({ ...policy, legal: [change(policy.legal[0], i), ...policy.legal.slice(1)] })),
      });
      const notesWith = (pack: PackIndex) => {
        const result = buildRecord(viewOf(data, pack), pack);
        if (!result.ok) throw new Error(result.reasons.join(" "));
        return result.record.policyNotes;
      };
      const hash = (i: number) => (i + 1).toString(16).repeat(64).slice(0, 64);
      // 손대는 것은 이 결과에 발견이 없는 정책 둘이다(발견이 있는 정책은 조문 이름이 결과와 맞아야 기록을 만든다).
      const [one, other] = packIndex.policies.flatMap((policy, i) => (data.findings.some((finding) => finding.policy === policy.id) ? [] : [i]));
      expect([one, other].every((i) => i !== undefined)).toBe(true);
      expect(packIndex.policies[one].legal[0].label).not.toBe(packIndex.policies[other].legal[0].label);

      // 정책마다 해시가 다르면 적지 않는다(값의 출처, 대표 조문의 뜻, 시행일의 한계 셋만 적는다. 둘째는 9번에서 더했다).
      const distinct = packWith((primary, i) => ({ ...primary, text_sha256: hash(i), text_sha256_matches: true }));
      expect(notesWith(distinct)).toHaveLength(3);
      expect(notesWith(distinct)).not.toContain(SAME_TEXT_NOTE);
      // 두 정책의 해시가 같으면 적는다. 값의 출처 다음, 대표 조문의 뜻과 시행일의 한계 앞이다.
      const same = (extra: Partial<Primary> = {}) =>
        packWith((primary, i) => ({ ...primary, text_sha256: hash(i === other ? one : i), text_sha256_matches: true, ...(i === other ? extra : {}) }));
      expect(notesWith(same())).toHaveLength(4);
      expect(notesWith(same())[1]).toBe(SAME_TEXT_NOTE);
      // 한쪽 해시가 팩 안의 원문 파일과 맞지 않거나 견주지 못했으면 원문이 같은지 알 수 없다. 적지 않는다.
      expect(notesWith(same({ text_sha256_matches: false }))).not.toContain(SAME_TEXT_NOTE);
      expect(notesWith(same({ text_sha256_matches: null }))).not.toContain(SAME_TEXT_NOTE);
      // 조문의 이름까지 같으면(두 정책이 같은 조문을 대표 조문으로 든다) 덧붙일 말이 없다.
      expect(notesWith(same({ label: packIndex.policies[one].legal[0].label }))).not.toContain(SAME_TEXT_NOTE);
      // 해시가 없는 줄끼리는 같다고 하지 않는다.
      const none = packWith((primary) => ({ ...primary, text_sha256: null, text_sha256_matches: null }));
      expect(notesWith(none)).not.toContain(SAME_TEXT_NOTE);
    });

    it("팩에 값이 없으면 없다고 적는다. 해시가 원문 파일과 맞지 않거나 견주지 못했으면 그렇다고 적는다", () => {
      // 이 사이트의 팩에는 없는 모양이다. 넘기는 팩 정보를 손으로 바꿔 본다.
      const data = capture("kids-signup.main");
      const withPrimary = (change: (legal: PackIndex["policies"][number]["legal"]) => PackIndex["policies"][number]["legal"]): PackIndex => ({
        ...packIndex,
        policies: packIndex.policies.map((policy) => (policy.id === "kr.pipa.22-2" ? { ...policy, legal: change(policy.legal) } : policy)),
      });
      const row = (pack: PackIndex) => {
        const result = buildRecord(viewOf(data, pack), pack);
        if (!result.ok) throw new Error(result.reasons.join(" "));
        return result.record.policies.find((policy) => policy.id === "kr.pipa.22-2")!;
      };
      const hash = metaOf("kr.pipa.22-2").legal[0].text_sha256;
      expect(row(withPrimary(([first, ...rest]) => [{ ...first, text_sha256_matches: false }, ...rest]))).toMatchObject({
        textSha256: hash,
        hashNote: "팩 안의 원문 파일과 맞지 않습니다.",
      });
      expect(row(withPrimary(([first, ...rest]) => [{ ...first, text_sha256_matches: null }, ...rest]))).toMatchObject({
        textSha256: hash,
        hashNote: "팩 안의 원문 파일과 견주지 못했습니다.",
      });
      const bare = row(withPrimary(([first, ...rest]) => [{ label: first.label, effective_from: null, text_sha256: null, text_sha256_matches: null }, ...rest]));
      expect([bare.effectiveFrom, bare.textSha256, bare.hashNote]).toEqual([null, null, null]);

      // 그려 낸 표: 빈 칸으로 두지 않고 없다고 적는다. 맞지 않는 해시에는 그 말이 해시 아래에 붙는다.
      const pack = withPrimary(([first, ...rest]) => [{ label: first.label, effective_from: null, text_sha256: null }, ...rest]);
      const drawn = (use: PackIndex) => {
        const result = buildRecord(viewOf(data, use), use);
        if (!result.ok) throw new Error(result.reasons.join(" "));
        const table = readSheet(renderToStaticMarkup(<RecordSheet record={result.record} source={FILE} />)).policies!;
        return table.groups[0].find((entry) => entry.head.endsWith("kr.pipa.22-2"))!.cells.map((cell) => cell.text);
      };
      expect(drawn(pack).slice(1, 3)).toEqual([NOT_IN_PACK, NOT_IN_PACK]);
      expect(NOT_IN_PACK).toBe("팩에 실려 있지 않음");
      const mismatch = withPrimary(([first, ...rest]) => [{ ...first, text_sha256_matches: false }, ...rest]);
      expect(drawn(mismatch)[2]).toBe(`${hash}팩 안의 원문 파일과 맞지 않습니다.`);
    });
  });

  describe("상태별 개수: 세기만 한다", () => {
    it.each(every)("%s: 발견의 수와 상태별 수가 결과의 발견을 센 것과 같다", (_name, parts) => {
      const report = reportOf(parts);
      const record = recordOf(readJson(...parts));
      expect(record.findingCount).toBe(report.findings.length);
      const expected = STATUS_ORDER.map((status) => ({
        label: STATUS_LABEL[status],
        count: report.findings.filter((finding) => findingStatus(finding) === status).length,
        meaning: STATUS_LEGEND[status],
      })).filter((entry) => entry.count > 0);
      expect(record.counts).toEqual(expected);
      // 상태별 수를 더하면 발견의 수다. 하나도 빠지지 않았다.
      expect(record.counts.reduce((sum, entry) => sum + entry.count, 0)).toBe(report.findings.length);

      const page = readSheet(sheet(readJson(...parts)));
      expect(page.found.heading).toBe(`발견 ${report.findings.length}건`);
      // 상태의 이름과 수, 그 옆에 그 상태의 뜻.
      expect(page.found.counts).toEqual(expected.map((entry) => `${entry.label} ${entry.count}건 ${entry.meaning}`));
    });

    it.each(every)("%s: 정책마다의 '발견' 칸도 그 정책의 발견을 상태별로 센 것이다. 발견이 없으면 그 정책의 상태를 적는다", (_name, parts) => {
      const report = reportOf(parts);
      const view = viewOf(readJson(...parts));
      const record = recordOf(readJson(...parts));
      for (const policy of record.policies) {
        const mine = report.findings.filter((finding) => finding.policy === policy.id);
        const cleared = (report.run.ai_cleared ?? []).filter((entry) => entry.policy === policy.id).length;
        const dismissed = (report.run.ai_dismissed ?? []).filter((entry) => entry.policy === policy.id).length;
        const counted = STATUS_ORDER.map((status) => [status, mine.filter((finding) => findingStatus(finding) === status).length] as const)
          .filter(([, n]) => n > 0)
          .map(([status, n]) => `${STATUS_LABEL[status]} ${n}건`);
        expect(policy.found, policy.id).toEqual([
          ...(mine.length > 0 ? counted : [STATUS_LABEL[view.policies.find((entry) => entry.id === policy.id)!.status]]),
          ...(cleared > 0 ? [`${AI_CLEARED} ${cleared}건`] : []),
          ...(dismissed > 0 ? [`${AI_DISMISSED} ${dismissed}건`] : []),
        ]);
      }
    });

    it("발견이 없는 정책에 적은 상태의 뜻을 표 아래에 적는다 (발견 없음은 충족이라는 뜻이 아니다)", () => {
      const NONE = `${STATUS_LABEL["not-reported"]}: ${STATUS_LEGEND["not-reported"]}`;
      expect(STATUS_LEGEND["not-reported"]).toContain("구분할 수 없습니다");
      for (const name of ["kids-signup.main", "kids-signup.fixed", "plain.main", "night-push.fixed"]) {
        expect(readSheet(sheet(capture(name))).statusNotes, name).toEqual([NONE]);
      }
      // v1 초안: 정책별 요약이 있어서 발견이 없는 정책의 상태가 갈린다. 나온 상태만, 먼저 봐야 할 것부터 적는다.
      const draft = readSheet(sheet(read("contract", "samples-v1-draft", "kids-signup.fixed.json")));
      expect(draft.statusNotes).toEqual([
        `${STATUS_LABEL["evidence-found"]}: ${STATUS_LEGEND["evidence-found"]}`,
        `${STATUS_LABEL["no-signal"]}: ${STATUS_LEGEND["no-signal"]}`,
      ]);
      // 곁에 없는 정책이나 조문을 "이"로 가리키지 않는다(정책 카드 밖에서 적는 말이다).
      for (const [name, parts] of every) {
        const page = readSheet(sheet(readJson(...parts)));
        expect([...page.policyNotes, ...page.statusNotes].join(" "), name).not.toMatch(/이 (정책|조문|결과)(은|는|이|가|에)/);
      }
    });

    it("AI 가 푼 경고만 있는 정책의 줄에는 '구분할 수 없다'는 뜻이 붙지 않는다. 조용한 정책과 섞여 있으면 뜻의 주어를 좁힌다", () => {
      // 발견이 없고 AI 가 푼 경고만 있는 정책의 줄에도 "발견 없음"이 적힌다. 그 정책에는 조문이 닿는다고 본 단위가 있었고 AI
      // 의 답으로 풀린 것이다(CLI 소스 evaluate/engine.py 의 _cleared_by_ai). 정책 카드도 그 정책에는 그 말을 적지 않는다.
      const data = fixture("judge-on.cleared");
      const [cleared] = data.run.ai_cleared!;
      const record = recordOf(data);
      const row = record.policies.find((policy) => policy.id === cleared.policy)!;
      expect(row.found).toEqual([STATUS_LABEL["not-reported"], `${AI_CLEARED} 1건`]);
      // 나머지 정책은 조용하다(발견도 AI 가 푼 경고도 없다). 그 정책들 때문에 뜻을 적되, 이름표가 같은 위의 줄에 읽히지 않게 적는다.
      expect(record.policies.filter((policy) => policy.id !== cleared.policy).map((policy) => policy.found)).toEqual(
        packFile.policies.slice(1).map(() => [STATUS_LABEL["not-reported"]]),
      );
      expect(record.quiet).toEqual([{ label: STATUS_LABEL["not-reported"], meaning: NOT_REPORTED_NOR_CLEARED }]);
      expect(NOT_REPORTED_NOR_CLEARED).toBe("발견도 AI 가 푼 경고도 없는 정책은 지금 CLI 출력으로는 '충족 근거 발견'과 '적용 신호 없음'을 구분할 수 없습니다.");
      // 주어만 좁힌 것이다. 나머지는 상태의 뜻 그대로다.
      expect(NOT_REPORTED_NOR_CLEARED.replace("발견도 AI 가 푼 경고도 없는", "발견이 없는")).toBe(STATUS_LEGEND["not-reported"]);
      expect(readSheet(sheet(data)).statusNotes).toEqual([`${STATUS_LABEL["not-reported"]}: ${NOT_REPORTED_NOR_CLEARED}`]);
      // 결과 화면의 그 정책 카드에도 "구분할 수 없습니다"가 없다(tests/demo.test.tsx 가 본다). 여기서는 같은 결과로 견준다.
      const summary = renderToStaticMarkup(<ReportSummary view={viewOf(data)} />);
      const card = elementsOf(summary, '<article class="policy ').find((html) => textOf(html).includes(metaOf(cleared.policy).title))!;
      expect(textOf(card)).toContain("AI 판정자의 답으로 풀린 경고가 1건 있습니다");
      expect(textOf(card)).not.toContain("구분할 수 없습니다");

      // AI 가 푼 경고가 없는 결과에서는 뜻을 그대로 적는다(빠진 판정만 있는 결과도 그렇다. 빠진 판정은 판정 단위에 들지 않는다).
      for (const name of ["judge-on.dismissed", "judge-on.citation-rejected"]) {
        const meanings = recordOf(fixture(name)).quiet.map((entry) => entry.meaning);
        expect(meanings, name).toEqual([STATUS_LEGEND["not-reported"]]);
      }

      // 발견이 없는 정책이 모두 AI 가 푼 경고를 가진 결과: 뜻을 붙일 줄이 없다. 적지 않는다. 정책별 요약이 그 정책 한 줄뿐인
      // v1 초안에 AI 가 푼 경고를 넣어 만든다(손으로 만든 것이다). CLI 0.3 의 결과에서는 팩의 정책이 모두 줄로 나와서
      // 조용한 정책이 늘 함께 있다.
      const draft = read("contract", "samples-v1-draft", "kids-signup.fixed.json");
      const summaryRow = draft.run.policies!.find((entry) => entry.policy === cleared.policy)!;
      const only = { ...draft, run: { ...draft.run, judge: data.run.judge, policies: [summaryRow], ai_cleared: data.run.ai_cleared, ai_dismissed: [] } };
      const onlyRecord = recordOf(only);
      expect(onlyRecord.policies.map((policy) => [policy.id, policy.found.at(-1)])).toEqual([[cleared.policy, `${AI_CLEARED} 1건`]]);
      expect(onlyRecord.quiet).toEqual([]);
      expect(readSheet(sheet(only)).statusNotes).toEqual([]);
      // 같은 결과에서 AI 가 푼 경고를 걷어 내면 그 줄의 상태의 뜻이 돌아온다.
      const bare = recordOf({ ...only, run: { ...only.run, ai_cleared: [] } });
      expect(bare.quiet).toHaveLength(1);
      expect(bare.quiet[0].label).toBe(bare.policies[0].found[0]);
    });
  });

  describe("발견의 자리와 지문", () => {
    it.each(every)("%s: 발견마다 한 줄이고, 자리·판정이 본 범위·상태·지문이 결과 그대로다", (_name, parts) => {
      const data = readJson(...parts);
      const report = reportOf(parts);
      const view = viewOf(data);
      const record = recordOf(data);
      const rows = record.findingGroups.flatMap((group) => group.findings.map((finding) => ({ ...finding, policy: group.policy, rule: group.rule })));
      expect(rows).toHaveLength(report.findings.length);
      // 발견마다 지문이 다르다. 지문으로 짝지어 견준다.
      const byPrint = new Map(report.findings.map((finding) => [finding.fingerprint, finding]));
      expect(byPrint.size).toBe(report.findings.length);
      const locations = new Map(view.policies.flatMap((policy) => policy.locations).map((location) => [location.fingerprint, location]));
      for (const row of rows) {
        const finding = byPrint.get(row.fingerprint)!;
        expect(finding, row.fingerprint).toBeDefined();
        const location = locations.get(row.fingerprint)!;
        expect(row, row.fingerprint).toEqual({
          policy: finding.policy,
          rule: finding.rule,
          file: finding.file,
          line: finding.line,
          lineUnsure: location.lineUnsure,
          scope: scopeLabel(location.scope),
          status: STATUS_LABEL[findingStatus(finding)],
          fingerprint: finding.fingerprint,
        });
      }
      // 묶음은 결과 화면의 규칙 묶음과 같고 차례도 같다. 접지 않고 모두 적는다.
      expect(record.findingGroups.map((group) => [group.policy, group.rule, group.findings.map((finding) => finding.fingerprint)])).toEqual(
        view.policies.flatMap((policy) =>
          policy.rules.map((group) => [policy.id, group.rule, [...group.shown, ...group.folded].map((location) => location.fingerprint)]),
        ),
      );

      // 그려 낸 표.
      const table = readSheet(sheet(data)).findings;
      if (report.findings.length === 0) {
        expect(table).toBeNull();
        return;
      }
      expect(table!.columns).toEqual(["자리", "상태", "지문"]);
      expect(table!.groups).toHaveLength(record.findingGroups.length);
      for (const [i, group] of record.findingGroups.entries()) {
        const [head, ...lines] = table!.groups[i];
        // 묶음의 첫 줄: 정책과 규칙의 id, 그 묶음의 발견 수. 칸 셋을 다 쓴다.
        expect(head.head).toBe(`정책 ${group.policy} · 규칙 ${group.rule} · ${group.findings.length}건`);
        expect(head.open).toBe('<tr class="record-group" role="row">');
        expect(head.headHtml).toMatch(/^<th colSpan="3" scope="rowgroup" role="rowheader">/);
        expect(head.cells).toEqual([]);
        expect(lines.map((line) => [line.head, ...line.cells.map((cell) => `${cell.label}=${cell.text}`)])).toEqual(
          group.findings.map((finding) => [
            // 줄 번호 옆에는 판정이 본 범위가 늘 함께 있다.
            `${where(finding.file, finding.line)} ${finding.scope}${finding.lineUnsure ? ` ${LINE_UNSURE}` : ""}`,
            `상태=${finding.status}`,
            `지문=${finding.fingerprint}`,
          ]),
        );
      }
    });

    it("같은 규칙이 20개 파일에 반복되는 결과: 접지 않고 25건을 모두 적는다. 정책과 규칙의 id 는 묶음마다 한 번만 적는다", () => {
      const page = readSheet(sheet(fixture("repeated-rule")));
      const groups = page.findings!.groups;
      expect(groups.map((rows) => [rows[0].head, rows.length - 1])).toEqual([
        ["정책 kr.network-act.50-4 · 규칙 nonemail-start-block · 20건", 20],
        ["정책 kr.network-act.50-4 · 규칙 nonemail-end-optout · 2건", 2],
        ["정책 kr.network-act.50-4 · 규칙 email-subject-label · 1건", 1],
        ["정책 kr.network-act.50-4 · 규칙 email-body-sender · 1건", 1],
        ["정책 kr.network-act.50-4 · 규칙 email-body-optout · 1건", 1],
      ]);
      expect(count(page.text, "nonemail-start-block")).toBe(1);
      // 접어 둔 것이 없다. 종이에서는 펼칠 수 없다.
      expect(page.article).not.toContain("<details");
    });

    it("지문과 해시는 글자를 더하지 않고 16자마다 줄바꿈 자리만 둔다 (복사한 글이 원래 값 그대로다)", () => {
      const data = capture("kids-signup.main");
      const html = sheet(data);
      const codes = elementsOf(html, '<code class="record-hex">');
      const values = [...recordOf(data).policies.map((policy) => policy.textSha256!), ...data.findings.map((finding) => finding.fingerprint)];
      expect(codes.map(textOf)).toEqual(values);
      for (const [i, code] of codes.entries()) {
        // 안에는 글과 줄바꿈 자리뿐이다. 빈칸도, 다른 요소도 없다.
        const pieces = code.replace(/^<code class="record-hex">|<\/code>$/g, "").split('<wbr aria-hidden="true"/>');
        expect(pieces.join(""), values[i]).toBe(values[i]);
        expect(pieces.every((piece) => /^[0-9a-f]{1,16}$/.test(piece)), values[i]).toBe(true);
        expect(pieces.slice(0, -1).every((piece) => piece.length === 16), values[i]).toBe(true);
      }
      // SHA-256 은 네 마디, 지문은 두 마디다. 정책마다 해시 하나, 발견마다 지문 하나다.
      expect(values.map((value) => value.length)).toEqual([...packFile.policies.map(() => 64), ...data.findings.map(() => 32)]);
      expect(data.findings.length).toBeGreaterThan(0);
    });

    it("줄이 없는 발견은 파일 이름만 적는다. 함수 단위 판정은 그 구역을, 구역을 모르면 모른다고 적는다", () => {
      const rows = readSheet(sheet(fixture("uncommon-shapes"))).findings!.groups.flatMap((group) => group.slice(1).map((row) => row.head));
      expect(rows).toEqual([
        "src/jobs/weekly-digest.ts:7 파일 전체 판정",
        "src/notifications/promo.ts:3 함수 밖 판정",
        "src/notifications/promo.ts:18 함수 12~34행 판정",
        "src/notifications/promo.ts:44 함수 40~58행 판정",
        "src/legacy/blast.js 파일 전체 판정",
        "src/legacy/notify.js:9 파일 전체 판정",
        "src/mail/weekly.ts:4 판정 구역 알 수 없음",
      ]);
    });

    it.each(every)("%s: 표 위에 줄 번호가 무엇인지와 지문이 어디서 온 값인지 적는다 (줄 번호는 문제의 줄이 아니다)", (_name, parts) => {
      // 종이에서는 발견을 펼쳐 볼 수 없다. 적어 두지 않으면 "경로:줄"이 문제의 줄로 읽힌다. "지문"이라는 말은 결과 화면에 없고
      // 기록에서 처음 나온다. 무엇에 쓰는 값인지는 CLI 가 알려 주지 않으므로 어디서 온 값인지만 적는다.
      const data = readJson(...parts);
      const report = reportOf(parts);
      const record = recordOf(data);
      const page = readSheet(sheet(data));
      if (report.findings.length === 0) {
        expect(record.findingNote).toBeNull();
        expect(page.text).not.toContain(FINGERPRINT_NOTE);
        expect(page.text).not.toContain(LINE_IS_FIRST);
        return;
      }
      // 줄이 실린 발견이 있으면 줄 번호의 뜻을 먼저 적는다. 시험에 쓰는 결과는 모두 그렇다.
      expect(report.findings.some((finding) => finding.line !== null)).toBe(true);
      expect(record.findingNote).toBe(`${LINE_IS_FIRST} ${FINGERPRINT_NOTE}`);
      expect(page.about("발견의 자리와 지문")).toEqual([record.findingNote]);
      expect(count(page.text, record.findingNote!)).toBe(1);
    });

    it("그 말은 결과 화면이 발견을 펼친 안쪽에 적는 말과 같다. 지문은 결과에 실린 값이라고만 적는다", () => {
      expect(LINE_IS_FIRST).toBe("줄 번호는 조문이 닿는다고 본 첫 줄입니다.");
      expect(FINGERPRINT_NOTE).toBe("지문은 발견마다 결과에 실린 값 그대로입니다.");
      // 결과 화면(정책 카드 안)은 곁의 조문을 "이 조문"이라고 가리킨다. 기록의 표 위에는 가리킬 조문이 없어서 그 말만 뺀다
      // (데모의 코드 상자와 같은 말이다).
      expect(scopeNote({ kind: "file" }, "known", true, "finding")).toBe(`파일 전체를 보고 내린 판정입니다. ${LINE_IS_FIRST.replace("조문이", "이 조문이")}`);
      expect(scopeNote({ kind: "file" }, "known", true, "code")).toBe(`파일 전체를 보고 내린 판정입니다. ${LINE_IS_FIRST}`);
      const data = capture("kids-signup.main");
      const result = renderToStaticMarkup(<ReportSummary view={viewOf(data)} />);
      expect(textOf(result)).toContain("줄 번호는 이 조문이 닿는다고 본 첫 줄입니다.");
      // "지문"이라는 말과 지문의 값은 결과 화면에 없다. 기록에서 처음 나온다.
      expect(textOf(result)).not.toContain("지문");
      expect(textOf(result)).not.toContain(data.findings[0].fingerprint);
      // 줄이 실린 발견이 하나도 없으면 줄 번호 이야기를 하지 않는다.
      const noLines = { ...data, findings: data.findings.map((finding): Finding => ({ ...finding, line: null })) };
      expect(recordOf(noLines).findingNote).toBe(FINGERPRINT_NOTE);
      expect(readSheet(sheet(noLines)).findings!.groups[0].slice(1).map((row) => row.head)).toEqual(["src/auth/signup.ts 파일 전체 판정"]);
    });

    it("SARIF 가 채운 1행일 수 있는 줄에는 그렇다고 적고, 표 위에 까닭을 적는다", () => {
      // SARIF 는 줄이 없는 발견도 1행으로 싣는다. 수집본에는 1행인 발견이 든 SARIF 가 없어서, 결과 JSON 을 SARIF 에서
      // 옮긴 것처럼 계약만 바꿔 만든다(화면 구조는 계약으로 가린다).
      const report = capture("genai-chat.main");
      expect(report.findings.map((finding) => finding.line)).toEqual([1, 1]);
      const recordFor = (data: Report) => {
        const result = buildRecord(buildReportView(data, "sarif", packIndex), packIndex);
        if (!result.ok) throw new Error(result.reasons.join(" "));
        return result.record;
      };
      const record = recordFor(report);
      const page = readSheet(renderToStaticMarkup(<RecordSheet record={record} source={FILE} />));
      const rows = page.findings!.groups.flatMap((group) => group.slice(1).map((row) => row.head));
      expect(rows).toEqual([`src/chat/ChatPanel.tsx:1 파일 전체 판정 ${LINE_UNSURE}`, `src/chat/ChatPanel.tsx:1 파일 전체 판정 ${LINE_UNSURE}`]);
      const UNSURE = `SARIF 는 줄이 없는 발견도 1행으로 싣습니다. '${LINE_UNSURE}'이라고 적은 줄은 조문이 닿는다고 본 줄인지 알 수 없습니다.`;
      // 줄이 모두 그런 줄이면 "조문이 닿는다고 본 첫 줄"이라는 말을 적지 않는다. 맞는지 알 수 없는 말이다.
      expect(record.findingNote).toBe(`${UNSURE} ${FINGERPRINT_NOTE}`);
      expect(page.about("발견의 자리와 지문")).toEqual([record.findingNote]);
      // 줄을 아는 발견이 섞여 있으면 그 말을 먼저 적고, 알 수 없는 줄의 까닭을 잇는다.
      const mixed = recordFor({ ...report, findings: report.findings.map((finding, i): Finding => (i === 0 ? { ...finding, line: 7 } : finding)) });
      expect(mixed.findingNote).toBe(`${LINE_IS_FIRST} ${UNSURE} ${FINGERPRINT_NOTE}`);
      // 결과 JSON 으로 연 같은 결과에는 그 말이 없다.
      const json = recordOf(report);
      expect(json.findingNote).toBe(`${LINE_IS_FIRST} ${FINGERPRINT_NOTE}`);
      expect(readSheet(sheet(report)).text).not.toContain(LINE_UNSURE);
    });
  });

  describe("검사 정보 (도구 판)", () => {
    const LABELS = ["도구", "엔진", "판정자", "팩 판", "출력 형식", "검사한 파일", "판정 단위", "검사한 범위", "검사한 날", "커밋"];

    it.each(every)("%s: 도구·엔진·판정자·팩 판·출력 형식은 결과 화면의 머리와 같은 값이다", (_name, parts) => {
      const data = readJson(...parts);
      const view = viewOf(data);
      const page = readSheet(sheet(data));
      expect(page.facts.map((fact) => fact.label)).toEqual(LABELS);
      // 결과 화면의 머리(도구, 엔진, 판정자, 팩 판, 출력 형식)에서 읽은 값.
      const result = renderToStaticMarkup(<ReportSummary view={view} />);
      const meta = elementsOf(elementAt(result, result.indexOf('<dl class="report-meta">')), "<div>").map((row) => [
        textOf(elementAt(row, row.indexOf("<dt>"))),
        textOf(elementAt(row, row.indexOf("<dd>"))),
      ]);
      expect(meta.map(([label]) => label)).toEqual(LABELS.slice(0, 5));
      expect(page.facts.slice(0, 5).map((fact) => [fact.label, fact.value])).toEqual(meta);
      // 결과에 실린 값이기도 하다.
      const report = reportOf(parts);
      expect(page.facts.slice(0, 5).map((fact) => fact.value)).toEqual([
        `${report.tool.name} ${report.tool.version}`,
        report.run.engine ? [report.run.engine.name, report.run.engine.version].filter(Boolean).join(" ") : "실행 안 함",
        report.run.judge ?? "꺼짐",
        report.run.pack_digest,
        CONTRACT_LABEL[view.contract],
      ]);
      // 팩 판은 글자 그대로 옮겨 적는 값이다.
      expect(page.facts[3].code).toBe(true);
    });

    it.each(every)("%s: 검사한 파일 수와 판정 단위 수는 결과에 실린 수다. 실려 있지 않으면 알 수 없음이다", (name, parts) => {
      const report = reportOf(parts);
      const page = readSheet(sheet(readJson(...parts)));
      const [files, units] = page.facts.slice(5, 7);
      const sarif = name.endsWith(".sarif");
      expect([files.value, files.missing]).toEqual(sarif ? ["알 수 없음", true] : [`${report.run.files}개`, false]);
      expect([units.value, units.missing]).toEqual(sarif ? ["알 수 없음", true] : [`${report.run.units}개`, false]);
      // SARIF 에는 두 수가 실리지 않는다. 0 으로 채우지 않고, 까닭을 한 번 적는다.
      expect(page.factNotes.includes(SARIF_COUNTS_NOTE), name).toBe(sarif);
      if (sarif) expect([report.run.units, report.run.files]).toEqual([null, undefined]);
    });

    it("SARIF 로 연 결과가 시험에 들어 있다 (위 시험이 빈 목록을 보고 통과하지 않게)", () => {
      expect(every.filter(([name]) => name.endsWith(".sarif")).map(([name]) => name)).toEqual(["contract/cli-current/kids-signup.main.sarif"]);
    });

    it.each(every)("%s: 검사한 범위와 검사한 날은 결과에 실려 있지 않다고 적는다. 커밋도 그렇다", (_name, parts) => {
      const page = readSheet(sheet(readJson(...parts)));
      expect(page.facts.slice(7).map((fact) => [fact.label, fact.value, fact.missing])).toEqual([
        ["검사한 범위", NOT_IN_RESULT, true],
        ["검사한 날", NOT_IN_RESULT, true],
        ["커밋", NOT_IN_RESULT, true],
      ]);
      expect(NOT_IN_RESULT).toBe("결과에 실려 있지 않음");
      // 브라우저는 인쇄물의 머리나 바닥에 날짜를 적는다. 그 날짜가 검사한 날로 읽히지 않게 한 줄 적는다.
      expect(page.factNotes.at(-1)).toBe("브라우저가 인쇄물에 적는 날짜는 인쇄한 날이고, 검사한 날이 아닙니다.");
    });

    it("커밋은 결과에 실려 있을 때만 적는다: v1 초안의 run.commit. 판 번호 없는 결과의 같은 이름 필드는 읽지 않는다", () => {
      const draft = read("contract", "samples-v1-draft", "kids-signup.main.json");
      // 초안 예시에는 값이 없다(null).
      expect(draft.run.commit).toBeNull();
      const commitOf = (data: unknown) => readSheet(sheet(data)).facts.at(-1)!;
      const SHA = "0a1b2c3d4e5f60718293a4b5c6d7e8f901234567";
      expect(commitOf({ ...draft, run: { ...draft.run, commit: SHA } })).toEqual({ label: "커밋", value: SHA, code: true, missing: false });
      // 글자가 아닌 값, 빈 글은 값으로 치지 않는다.
      for (const commit of [null, undefined, "", "  ", 12345, { sha: SHA }]) {
        expect(commitOf({ ...draft, run: { ...draft.run, commit } }).value, String(commit)).toBe(NOT_IN_RESULT);
      }
      // 커밋 해시의 모양(16진수 7~64자)일 때만 옮긴다. git 이 줄여 적는 해시와 SHA-256 도 그 모양이다.
      for (const commit of ["0a1b2c3", SHA.toUpperCase(), "a".repeat(64)]) {
        expect(commitOf({ ...draft, run: { ...draft.run, commit } }).value, commit).toBe(commit);
      }
      // 그 밖의 글은 옮기지 않는다. 이 필드는 파서가 모양을 보지 않아서, 손으로 고친 파일에는 무엇이든 들 수 있다. 기록에
      // 글자 그대로 실리는 값이라 코드가 실릴 길이 된다.
      for (const commit of ["const x = leak();\nmore", "0a1b2c", "a".repeat(65), `${SHA}\n`, ` ${SHA}`, `${SHA} const x = 1;`, "main", "0a1b2c3g", "0a1b2c3\nconst x = 1;"]) {
        const data = { ...draft, run: { ...draft.run, commit } };
        const page = readSheet(sheet(data));
        expect(page.facts.at(-1), JSON.stringify(commit)).toEqual({ label: "커밋", value: NOT_IN_RESULT, code: false, missing: true });
        expect(viewOf(data).commit, JSON.stringify(commit)).toBeNull();
        for (const piece of ["leak", "const x", "more", "main"]) expect(page.text, `${JSON.stringify(commit)}: ${piece}`).not.toContain(piece);
      }
      // CLI 0.3 의 출력에는 이 필드가 없다. 같은 이름의 필드가 끼어 있어도 쓰지 않는다(정책별 요약과 같다).
      const current = capture("kids-signup.main");
      expect(commitOf({ ...current, run: { ...current.run, commit: SHA } }).value).toBe(NOT_IN_RESULT);
      expect(viewOf({ ...current, run: { ...current.run, commit: SHA } }).commit).toBeNull();
      expect(viewOf({ ...draft, run: { ...draft.run, commit: SHA } }).commit).toBe(SHA);
    });
  });

  describe("다 보지 못한 것", () => {
    const rowsOf = (data: unknown) =>
      readSheet(sheet(data)).gaps.groups[0].map((row) => ({
        label: row.head,
        count: row.cells[0].text,
        on: row.open === '<tr class="gap-on" role="row">',
        detail: row.cells[1].html,
      }));

    it.each(every)("%s: 세 목록과 엔진 오류의 수를 늘 같은 차례로 적는다. 수와 파일은 결과 그대로다", (_name, parts) => {
      const report = reportOf(parts);
      const rows = rowsOf(readJson(...parts));
      const lists = [report.run.skipped, report.run.unparsed, report.run.incomplete];
      expect(rows.map((row) => [row.label, row.count, row.on])).toEqual([
        ["검사하지 않은 파일", lists[0].length > 0 ? `${lists[0].length}개` : "없음", lists[0].length > 0],
        ["일부를 읽지 못한 파일", lists[1].length > 0 ? `${lists[1].length}개` : "없음", lists[1].length > 0],
        ["엔진이 끝내지 못한 파일", lists[2].length > 0 ? `${lists[2].length}개` : "없음", lists[2].length > 0],
        ["엔진 오류", report.run.engine_errors.length > 0 ? `${report.run.engine_errors.length}건` : "없음", report.run.engine_errors.length > 0],
      ]);
      // 목록의 파일은 접지 않고 결과에 실린 순서로 모두 적는다.
      for (const [i, list] of lists.entries()) {
        expect(elementsOf(rows[i].detail, "<li>").map((li) => textOf(elementAt(li, li.indexOf("<code>")))), rows[i].label).toEqual(list);
      }
    });

    it("이름과 표 아래의 말: 결과에 실린 목록이라는 것과, 목록 없이 빠지는 것은 실리지 않는다는 것", () => {
      const page = readSheet(sheet(capture("kids-signup.main")));
      expect(page.gaps.name).toBe("다 보지 못한 것 결과에 실린 목록입니다");
      // 칸 머리는 화면에서만 가린다(결과 화면의 표와 같다).
      expect([page.gaps.columns, page.gaps.headHidden]).toEqual([["목록", "수", "뜻과 파일"], true]);
      expect(page.gapsNote).toBe(
        "이 도구가 보지 못하는 것은 위 목록에 실리지 않습니다: JS/TS 가 아닌 파일, 목록 없이 빠지는 JS/TS 파일, 검사한 범위 밖의 파일, 서버·인프라 설정, 데이터에만 있는 동의 상태.",
      );
      // 결과 화면의 "이 도구가 보지 못하는 것"의 항목 이름 그대로다. 항목이 더해지면 따라온다.
      expect(page.gapsNote).toBe(`${SITE.notSeen.title}은 위 목록에 실리지 않습니다: ${SITE.notSeen.items.map((item) => item.what).join(", ")}.`);
      // 든 것이 하나도 없으면 줄을 촘촘히 적는다. 있으면 줄마다 선을 긋는다.
      expect(page.article).toContain('<table class="record-gaps record-gaps-none" role="table" ');
      expect(readSheet(sheet(fixture("incomplete-coverage"))).article).toContain('<table class="record-gaps" role="table" ');
    });

    it("incomplete-coverage: 맨 위에 경고가 있고, 든 것이 있는 줄에 뜻과 파일, 그 파일에 나온 발견의 수를 적는다", () => {
      const data = fixture("incomplete-coverage");
      const page = readSheet(sheet(data));
      // 맨 위 경고는 결과 화면의 것과 같은 말이다. 아래의 표를 이름으로 가리킨다.
      const summary = coverageSummary(viewOf(data));
      expect(page.warning).toBe(`${summary.warning!.lead} ${summary.warning!.detail}`);
      expect(page.warning).toBe(
        "다 보지 못한 검사입니다. 검사하지 않은 파일 1개 · 일부를 읽지 못한 파일 1개 · 엔진이 끝내지 못한 파일 1개. 아래 '다 보지 못한 것' 표에서 확인하세요.",
      );
      const rows = rowsOf(data);
      expect(rows.slice(0, 3).map((row) => elementsOf(row.detail, "<p").map(textOf))).toEqual(
        summary.rows.map((row) => [row.meaning, ...(row.note ? [row.note] : [])]),
      );
      expect(rows.slice(0, 3).map((row) => elementsOf(row.detail, "<li>").map(textOf))).toEqual([
        ["src/lib/chart.min.js"],
        ["src/auth/signup.ts 발견 1건"],
        ["src/marketing/campaign.ts 발견 3건"],
      ]);
      expect(rows[3].detail).toBe('<td class="record-gap-detail" role="cell"></td>');
    });

    it("다 보지 못한 것이 없는 결과에는 맨 위 경고가 없다. 검사한 파일이 0개면 있다", () => {
      expect(readSheet(sheet(capture("kids-signup.main"))).warning).toBeNull();
      const plain = capture("plain.main");
      const empty = { ...plain, run: { ...plain.run, files: 0, engine: null } };
      expect(readSheet(sheet(empty)).warning).toBe("검사한 파일이 없습니다.");
    });

    it("엔진 오류는 수만 적는다. 결과에 실린 오류 문장은 싣지 않는다", () => {
      // 오류 문장에는 경로와 코드 조각이 들 수 있다. 손으로 만든 결과로 본다(수집본에는 엔진 오류가 없다).
      const base = fixture("incomplete-coverage");
      const errors = ["[Fatal error] Parse failure at /home/dev/app/src/pay/charge.ts:12\n  const card = req.body.card;", "[Timeout] rule kr.pipa.22-2"];
      const data = { ...base, run: { ...base.run, engine_errors: errors, incomplete: ["src/marketing/campaign.ts", "src/auth/signup.ts", "src/math.ts"] } };
      const record = recordOf(data);
      const page = readSheet(sheet(data));
      const row = rowsOf(data)[3];
      expect([row.label, row.count, row.on]).toEqual(["엔진 오류", "2건", true]);
      expect(elementsOf(row.detail, "<p").map(textOf)).toEqual([
        coverageSummary(viewOf(data)).rows[3].meaning,
        "오류 문장은 이 기록에 싣지 않습니다.",
      ]);
      // 결과 화면은 그 문장을 접어서 싣는다. 기록에는 문장도, 그 안의 경로와 코드 조각도 없다.
      expect(renderToStaticMarkup(<ReportSummary view={viewOf(data)} />)).toContain("const card = req.body.card;");
      for (const piece of [...errors, "Fatal error", "/home/dev/app", "req.body.card", "Timeout"]) {
        expect(page.text, piece).not.toContain(piece);
        expect(stringsIn(record), piece).not.toContain(piece);
      }
    });
  });

  describe("AI 가 푼 것: 숨기지 않는다", () => {
    it("AI 가 푼 경고: 수와 정책·규칙·파일·줄·대안 id 를 싣는다. 인용한 줄은 싣지 않는다", () => {
      const data = fixture("judge-on.cleared");
      const [cleared] = data.run.ai_cleared!;
      const cite = cleared.alternatives[0].cite!;
      expect(cite.length).toBeGreaterThan(10);
      const record = recordOf(data);
      expect(record.aiCleared).toEqual([{ policy: cleared.policy, rule: cleared.rule, file: cleared.file, line: cleared.line, alternatives: ["ai-guard"] }]);
      const page = readSheet(sheet(data));
      expect(page.aiCleared!.name).toBe("AI 가 푼 경고 1건");
      expect(page.aiCleared!.columns).toEqual(["자리", "정책과 규칙", "AI 가 ‘예’라고 답한 대안"]);
      expect(page.aiCleared!.groups[0].map((row) => [row.head, ...row.cells.map((cell) => `${cell.label}=${cell.text}`)])).toEqual([
        ["src/auth/signup.ts:5", "정책과 규칙=kr.pipa.22-2 signup-without-guard", "대안=ai-guard"],
      ]);
      // 발견 수 옆과 그 정책의 줄에도 수가 보인다. 발견에는 들어 있지 않다고 적는다.
      expect(page.found.heading).toBe("발견 0건");
      expect(page.found.notes).toEqual([SITE.zeroIsNotClearance, "AI 가 푼 경고 1건. 발견에는 들어 있지 않습니다."]);
      expect(record.policies.find((policy) => policy.id === "kr.pipa.22-2")!.found).toEqual([STATUS_LABEL["not-reported"], "AI 가 푼 경고 1건"]);
      // 인용이 코드에 있는지만 확인된 것이라 사람이 봐야 한다는 말이 함께 있다. 인용한 줄은 기록에 없으므로 볼 곳을 가리킨다.
      // 표 위에 적는다(결과 화면도 목록 위에 적는다).
      expect(page.about(AI_CLEARED)).toEqual([
        "AI 판정자가 ‘예’라고 답하고 코드 줄을 인용해서 풀린 경고입니다. 인용이 코드에 있는지만 확인된 것이라, 그 줄이 근거가 맞는지는 사람이 봐야 합니다. " +
          "인용한 줄은 결과의 ‘AI 가 푼 경고’에서 확인하세요.",
      ]);
      // 결과 화면에는 인용한 줄이 보인다. 기록에는 없다.
      expect(renderToStaticMarkup(<ReportSummary view={viewOf(data)} />)).toContain(cite);
      expect(page.text).not.toContain(cite);
      expect(stringsIn(record)).not.toContain(cite);
      // 인용의 종류(gate)도 옮기지 않는다. 옮기는 것은 대안의 id 뿐이다.
      expect(stringsIn(record)).not.toContain("grounded");
    });

    it("AI 가 적용되지 않는다고 답해 빠진 판정: 수와 정책·규칙·파일·줄을 싣는다. 질문과 답은 싣지 않는다", () => {
      const data = fixture("judge-on.dismissed");
      const [dismissed] = data.run.ai_dismissed!;
      expect(dismissed.question!.length).toBeGreaterThan(10);
      const record = recordOf(data);
      expect(record.aiDismissed).toEqual([{ policy: dismissed.policy, rule: dismissed.rule, file: dismissed.file, line: dismissed.line }]);
      const page = readSheet(sheet(data));
      expect(page.aiDismissed!.name).toBe("AI 가 적용되지 않는다고 답해 빠진 판정 1건");
      expect(page.aiDismissed!.groups[0].map((row) => [row.head, ...row.cells.map((cell) => `${cell.label}=${cell.text}`)])).toEqual([
        ["src/auth/signup.ts:5", "정책과 규칙=kr.pipa.22-2 signup-without-guard"],
      ]);
      expect(page.about(AI_DISMISSED)).toEqual(["적용 여부를 묻는 질문에 AI 가 ‘아니오’라고 답해, 인용 없이 빠진 판정입니다."]);
      // 빠진 판정은 발견에도 판정 단위 수에도 들어 있지 않다(결과 화면의 "검사한 것"이 같은 말을 적는다).
      expect(page.found.notes).toEqual([
        SITE.zeroIsNotClearance,
        "AI 가 적용되지 않는다고 답해 빠진 판정 1건. 발견에도 판정 단위 수에도 들어 있지 않습니다.",
      ]);
      expect(record.policies.find((policy) => policy.id === "kr.pipa.22-2")!.found).toEqual([
        STATUS_LABEL["not-reported"],
        "AI 가 적용되지 않는다고 답해 빠진 판정 1건",
      ]);
      // 질문과 답은 기록에 옮기지 않는다. CLI 는 답을 정해 둔 낱말('아니오')로 싣지만(CLI 소스 judge/base.py 의 RawAnswer),
      // 이 사이트의 파서는 두 필드의 모양을 보지 않는다. 손으로 고친 파일에 코드가 든 글이 실려 있어도 기록에는 없다.
      expect(dismissed.answer).toBe("아니오");
      const withAnswer = { ...data, run: { ...data.run, ai_dismissed: [{ ...dismissed, answer: "아니오. `const age = calcKoreanAge(form.birthDate);` 는 나이 계산일 뿐입니다." }] } };
      const text = readSheet(sheet(withAnswer)).text;
      for (const piece of [dismissed.question!, "calcKoreanAge", "나이 계산일 뿐"]) {
        expect(text, piece).not.toContain(piece);
        expect(stringsIn(recordOf(withAnswer)), piece).not.toContain(piece);
      }
    });

    it("AI 의 기록에 실린 줄 번호는 정수일 때만 옮긴다. 그 밖의 값이면 파일 이름만 적는다", () => {
      // 파서는 두 기록에서 정책·규칙·파일이 글자인지만 본다(src/lib/report/guards.ts 의 isAiRecords). 줄 번호의 모양은 보지
      // 않아서, 손으로 고친 파일에는 무엇이든 들 수 있다. 기록의 "자리"에 글자 그대로 찍히는 값이라 여기서 거른다.
      const cleared = fixture("judge-on.cleared");
      const dismissed = fixture("judge-on.dismissed");
      const withLine = (line: unknown) => ({
        ...cleared,
        run: {
          ...cleared.run,
          ai_cleared: cleared.run.ai_cleared!.map((entry) => ({ ...entry, line })) as AiCleared[],
          ai_dismissed: dismissed.run.ai_dismissed!.map((entry) => ({ ...entry, line })) as AiDismissed[],
        },
      });
      const places = (data: unknown) => {
        const page = readSheet(sheet(data));
        return [page.aiCleared!.groups[0][0].head, page.aiDismissed!.groups[0][0].head];
      };
      // 정수면 옮긴다.
      expect(places(withLine(5))).toEqual(["src/auth/signup.ts:5", "src/auth/signup.ts:5"]);
      for (const line of ["5", 5.5, "12; const leaked = code();", { line: 5 }, [5], true, null, undefined, Number.NaN]) {
        const data = withLine(line);
        expect(places(data), JSON.stringify(line)).toEqual(["src/auth/signup.ts", "src/auth/signup.ts"]);
        const record = recordOf(data);
        expect([record.aiCleared[0].line, record.aiDismissed[0].line], JSON.stringify(line)).toEqual([null, null]);
        expect(readSheet(sheet(data)).text, JSON.stringify(line)).not.toContain("leaked");
        expect(stringsIn(record), JSON.stringify(line)).not.toContain("leaked");
      }
    });

    it("결과 화면이 부르는 이름과 같은 이름으로 적는다", () => {
      expect([AI_CLEARED, AI_DISMISSED]).toEqual(["AI 가 푼 경고", "AI 가 적용되지 않는다고 답해 빠진 판정"]);
      const cleared = renderToStaticMarkup(<ReportSummary view={viewOf(fixture("judge-on.cleared"))} />);
      const dismissed = renderToStaticMarkup(<ReportSummary view={viewOf(fixture("judge-on.dismissed"))} />);
      expect(cleared).toContain(`<summary>${AI_CLEARED} 1건</summary>`);
      expect(dismissed).toContain(`<summary>${AI_DISMISSED} 1건</summary>`);
    });

    it("판정자 없이 검사한 결과에는 AI 의 표도 말도 없다. 판정자를 켠 결과인데 빠진 판정의 목록이 없으면 모른다고 적는다", () => {
      for (const name of jsonFiles("contract", "cli-current")) {
        const page = readSheet(sheet(read("contract", "cli-current", name)));
        expect([page.aiCleared, page.aiDismissed], name).toEqual([null, null]);
        expect(page.found.notes.join(" "), name).not.toContain("AI");
      }
      // 판정자를 켰는데 `run.ai_dismissed` 가 실려 있지 않은 결과(CLI 0.3 은 늘 싣는다. 손으로 만든 것).
      const base = fixture("judge-on.citation-rejected");
      const run: Partial<Report["run"]> = { ...base.run };
      delete run.ai_dismissed;
      expect(readSheet(sheet({ ...base, run })).found.notes).toEqual(["AI 가 적용되지 않는다고 답해 빠진 판정이 있었는지는 결과에 실려 있지 않습니다."]);
      expect(readSheet(sheet(base)).found.notes).toEqual([]);
    });

    it("빠진 판정이 있는데 판정 단위 수가 결과에 없으면(SARIF) 발견에 들어 있지 않다고만 적는다", () => {
      const data = fixture("judge-on.dismissed");
      const record = buildRecord(buildReportView({ ...data, run: { ...data.run, units: null } }, "sarif", packIndex), packIndex);
      if (!record.ok) throw new Error(record.reasons.join(" "));
      expect(record.record.aiNotes).toEqual(["AI 가 적용되지 않는다고 답해 빠진 판정 1건. 발견에는 들어 있지 않습니다."]);
    });
  });
});

describe("기록에 싣지 않는 것: 코드", () => {
  /** 합성 코드의 줄(빈 줄은 뺀다. 앞뒤의 빈칸은 뗀다). */
  function codeLines(app: string, variant: string): string[] {
    const dir = path.join("contract", "fixtures", app, variant);
    return walk(dir)
      .flatMap((file) => readFileSync(path.join(root, file), "utf8").split("\n"))
      .map((line) => line.trim())
      .filter((line) => line !== "");
  }

  // ROADMAP 7번의 완료 조건이다.
  it("kids-signup.main 으로 만든 기록에 코드 조각이 없다", () => {
    const lines = codeLines("kids-signup", "main");
    // 그 표본의 합성 코드(contract/fixtures/kids-signup/main/src/auth/signup.ts)의 줄 전부다.
    expect(lines).toEqual(readFileSync(path.join(root, "contract", "fixtures", "kids-signup", "main", "src", "auth", "signup.ts"), "utf8").trim().split("\n").map((line) => line.trim()).filter(Boolean));
    expect(lines).toHaveLength(8);
    expect(lines).toContain("const age = calcKoreanAge(form.birthDate);");
    const data = capture("kids-signup.main");
    const page = readSheet(sheet(data, { name: "아동 가입 · 고치기 전 (CLI 실제 출력)", synthetic: true }));
    for (const line of lines) expect(page.text, line).not.toContain(line);
    // 줄에 든 이름도 없다(함수, 변수). 기록에 있는 것은 경로와 줄 번호, id, 지문이다.
    for (const name of ["calcKoreanAge", "signUp", "SignupForm", "birthDate", "db.user", "redirect", "userId"]) {
      expect(page.text, name).not.toContain(name);
    }
    expect(page.text).toContain("src/auth/signup.ts:5");
    expect(page.text).toContain(data.findings[0].fingerprint);
    // 기록을 그리는 자료에도 없다.
    const record = stringsIn(recordOf(data));
    for (const line of lines) expect(record, line).not.toContain(line);
    expect(record).toContain(data.findings[0].fingerprint);

    // 그 결과에는 코드가 한 줄도 없다(판정자 없이 검사했다). 그것만 보면 기록이 판정 경로나 인용한 줄을 통째로 옮겨도 이
    // 시험은 통과한다. 그래서 같은 결과에서 코드가 실릴 수 있는 자리마다 그 표본의 코드 줄을 넣고 다시 본다(손으로 만든
    // 것이다. tests/record-data.ts): AI 가 인용한 줄, 판정 경로, 엔진 오류 문장, 빠진 판정의 질문과 답, 제목과 대안의 글.
    expect(JSON.stringify(data)).not.toContain("calcKoreanAge");
    const stuffed = withCodeEverywhere(data, lines);
    // 결과 화면은 그 글을 보인다(넣은 줄이 화면 구조까지 간다는 뜻이다). 중괄호뿐인 줄은 빼고 본다.
    const result = textOf(renderToStaticMarkup(<ReportSummary view={viewOf(stuffed)} />));
    const telling = lines.filter((line) => line.length > 3);
    expect(telling).toHaveLength(7);
    for (const line of telling) expect(result, line).toContain(line);
    const stuffedPage = readSheet(sheet(stuffed, { name: "아동 가입 · 고치기 전 (CLI 실제 출력)", synthetic: true }));
    const stuffedRecord = stringsIn(recordOf(stuffed));
    for (const line of lines) {
      expect(stuffedPage.text, line).not.toContain(line);
      expect(stuffedRecord, line).not.toContain(line);
    }
    for (const name of ["calcKoreanAge", "signUp", "SignupForm", "birthDate", "db.user", "redirect", "userId", "Fatal error", "인용 불인정"]) {
      expect(stuffedPage.text, name).not.toContain(name);
      expect(stuffedRecord, name).not.toContain(name);
    }
    // 코드가 아닌 것은 그대로 실린다: 자리와 지문, AI 가 푼 경고와 빠진 판정의 수와 자리, 엔진 오류의 수.
    expect(stuffedPage.text).toContain("src/auth/signup.ts:5");
    expect(stuffedPage.text).toContain(data.findings[0].fingerprint);
    expect(stuffedPage.aiCleared!.name).toBe(`${AI_CLEARED} 1건`);
    expect(stuffedPage.aiDismissed!.name).toBe(`${AI_DISMISSED} ${lines.length}건`);
    expect(stuffedPage.gaps.groups[0].at(-1)!.cells[0].text).toBe(`${lines.length}건`);
    // 정책의 제목은 팩의 것이다(결과의 제목 자리에 넣은 코드가 아니다).
    expect(stuffedPage.policies!.groups[0].map((row) => row.head)).toContain(`${metaOf(data.findings[0].policy).title} ${data.findings[0].policy}`);
  });

  it.each(jsonFiles("contract", "cli-current").map((file) => file.replace(/\.json$/, "")))("%s: 그 표본의 합성 코드의 줄이 기록에 없다", (name) => {
    const [app, variant] = name.split(".");
    const lines = codeLines(app, variant);
    expect(lines.length).toBeGreaterThan(2);
    const page = readSheet(sheet(capture(name)));
    for (const line of lines) expect(page.text, line).not.toContain(line);
  });

  it("SARIF 로 열어도 같다", () => {
    const page = readSheet(sheet(readJson("contract", "cli-current", "kids-signup.main.sarif")));
    for (const line of codeLines("kids-signup", "main")) expect(page.text, line).not.toContain(line);
  });

  it.each(every)("%s: 판정 경로의 문장, 대안의 글, 질문이 기록에 없다", (_name, parts) => {
    // 판정 경로는 CLI 가 남긴 문장이지만 AI 의 답 원문이 섞일 수 있다. 대안의 글과 질문은 코드가 아니지만 기록에 싣는
    // 것이 아니다(결과 화면과 조문 도감에 있다). 기록은 자리와 지문만 적는다.
    const report = reportOf(parts);
    const data = readJson(...parts);
    const page = readSheet(sheet(data));
    const record = stringsIn(recordOf(data));
    const absent = (piece: string) => {
      expect(page.text, piece).not.toContain(piece);
      expect(record, piece).not.toContain(piece);
    };
    for (const finding of report.findings) {
      for (const step of finding.decision_path) absent(step);
      absent(finding.ask_developer);
      for (const alt of finding.unsatisfied_alternatives) {
        for (const text of [alt.message, alt.ask_developer, alt.remediation]) if (text) absent(text);
      }
    }
    for (const cleared of report.run.ai_cleared ?? []) for (const alt of cleared.alternatives) if (alt.cite) absent(alt.cite);
    for (const dismissed of report.run.ai_dismissed ?? []) for (const text of [dismissed.question, dismissed.answer === "아니오" ? null : dismissed.answer]) if (text) absent(text);
  });

  it("판정자를 켠 결과(손으로 만든 자료 셋)에서 AI 가 인용한 줄이 기록에 없다", () => {
    const names = jsonFiles("tests", "fixtures").filter((file) => file.startsWith("judge-on."));
    expect(names).toHaveLength(3);
    let cites = 0;
    for (const name of names) {
      const data = read("tests", "fixtures", name);
      expect(data.run.judge, name).not.toBeNull();
      const page = readSheet(sheet(data));
      // 그 자료가 흉내 낸 합성 코드의 줄 전부. 인용은 그 가운데 한 줄이다.
      for (const line of codeLines("kids-signup", "main")) expect(page.text, `${name}: ${line}`).not.toContain(line);
      for (const cleared of data.run.ai_cleared ?? []) {
        for (const alt of cleared.alternatives) {
          expect(codeLines("kids-signup", "main")).toContain(alt.cite);
          cites += 1;
        }
      }
    }
    // 빈 것을 보고 통과한 것이 아니다. 인용한 줄이 실린 자료가 있다.
    expect(cites).toBeGreaterThan(0);
  });

  it("받아들이지 않은 인용이 판정 경로에 적혀 있어도 기록에 없다", () => {
    // CLI 는 받아들이지 않은 '예'의 인용을 판정 경로의 문장에 따옴표로 적는다(CLI 소스 evaluate/engine.py 의 evaluate:
    // "AI 예 — 인용 불인정(까닭): “인용 앞 120자”"). 손으로 만든 자료의 판정 경로에는 그 인용이 없어서, 그 문장을 CLI 가
    // 남기는 모양으로 바꿔 넣는다. 인용은 AI 가 지어낸 줄일 수도 있다(까닭 not-found).
    const base = fixture("judge-on.citation-rejected");
    const quoted = "if (age < 14) return requireGuardianConsent(form);";
    const step = `대안 ai-guard: AI 예 — 인용 불인정(not-found): “${quoted}” → 판정에 넣지 않음`;
    const data = {
      ...base,
      findings: base.findings.map((finding): Finding => ({
        ...finding,
        decision_path: finding.decision_path.map((line) => (line.includes("인용 불인정") ? step : line)),
      })),
    };
    expect(data.findings.flatMap((finding) => finding.decision_path)).toContain(step);
    // 결과 화면은 판정 경로를 CLI 가 낸 그대로 보인다. 기록에는 그 문장도, 그 안의 인용도 없다.
    expect(textOf(renderToStaticMarkup(<ReportSummary view={viewOf(data)} />))).toContain(step);
    const page = readSheet(sheet(data));
    for (const piece of [step, quoted, "requireGuardianConsent", "인용 불인정", "not-found"]) {
      expect(page.text, piece).not.toContain(piece);
      expect(stringsIn(recordOf(data)), piece).not.toContain(piece);
    }
    // 그 발견의 자리와 상태, 지문은 있다.
    expect(page.findings!.groups[0].slice(1).map((row) => [row.head, ...row.cells.map((cell) => cell.text)])).toEqual([
      ["src/auth/signup.ts:5 파일 전체 판정", STATUS_LABEL["needs-review-ai-pending"], base.findings[0].fingerprint],
    ]);
  });

  it("기록의 자료(RecordView)에는 코드가 들어갈 자리가 없다: 발견의 줄에는 자리·범위·상태·지문뿐이다", () => {
    for (const [name, parts] of every) {
      const record = recordOf(readJson(...parts));
      for (const group of record.findingGroups) {
        expect(Object.keys(group).sort(), name).toEqual(["findings", "policy", "rule"]);
        for (const finding of group.findings) expect(Object.keys(finding).sort(), name).toEqual(["file", "fingerprint", "line", "lineUnsure", "scope", "status"]);
      }
      for (const cleared of record.aiCleared) expect(Object.keys(cleared).sort(), name).toEqual(["alternatives", "file", "line", "policy", "rule"]);
      for (const dismissed of record.aiDismissed) expect(Object.keys(dismissed).sort(), name).toEqual(["file", "line", "policy", "rule"]);
      for (const gap of record.gaps) expect(Object.keys(gap).sort(), name).toEqual(["countText", "files", "label", "meaning", "note", "on"]);
    }
  });

  it("머리에 싣지 않은 것을 밝힌다 (무엇으로 만든 기록인지 바로 아래에, 한 번)", () => {
    expect(RECORD_OMITS).toBe("코드, AI 가 인용한 줄, 판정 경로, 엔진 오류 문장은 이 기록에 싣지 않습니다.");
    for (const [name, parts] of every) {
      const page = readSheet(sheet(readJson(...parts)));
      expect(page.omits, name).toBe(RECORD_OMITS);
      expect(count(page.text, RECORD_OMITS), name).toBe(1);
      // 머리의 차례: 이름, 무엇으로 만든 것인지, 싣지 않은 것, 법률 자문·인증이 아니라는 말.
      const head = elementAt(page.article, page.article.indexOf('<header class="record-head">'));
      expect(elementsOf(head, "<p ").map((p) => /^<p class="([^"]*)"/.exec(p)![1]).slice(0, 3), name).toEqual(["record-source", "record-omits", "record-notice"]);
    }
  });
});

describe("기록을 만들지 않는 결과", () => {
  const refused = (data: unknown) => {
    const result = buildRecord(viewOf(data), packIndex);
    if (result.ok) throw new Error("기록이 만들어졌습니다.");
    return result.reasons;
  };

  it("결과의 팩 판이 이 사이트의 팩과 다르면 만들지 않고, 두 판과 까닭을 적는다", () => {
    const base = capture("night-push.fixed");
    const OTHER = "0123456789abcdef";
    expect(OTHER).not.toBe(packFile.pack.digest);
    expect(refused({ ...base, run: { ...base.run, pack_digest: OTHER } })).toEqual([
      `이 결과를 만든 팩(팩 판 ${OTHER})과 이 사이트에 실린 팩(팩 판 ${packFile.pack.digest})의 판이 다릅니다. ` +
        "기록에 적는 시행일과 원문 해시는 이 사이트의 팩에 적힌 값이라, 이 결과를 만든 팩의 것이 아닙니다.",
    ]);
    // 한 글자만 달라도 다른 판이다. 앞부분만 견주지 않는다.
    const near = `${packFile.pack.digest.slice(0, -1)}${packFile.pack.digest.endsWith("0") ? "1" : "0"}`;
    expect(refused({ ...base, run: { ...base.run, pack_digest: near } })).toHaveLength(1);
    expect(refused({ ...base, run: { ...base.run, pack_digest: packFile.pack.digest.toUpperCase() + "x" } })).toHaveLength(1);
    // 발견이 0인 결과도 같다. 발견이 없다고 팩 판을 보지 않고 넘어가지 않는다.
    const plain = capture("plain.main");
    expect(refused({ ...plain, run: { ...plain.run, pack_digest: OTHER } })).toHaveLength(1);
    // 판이 같은 결과는 만든다.
    expect(buildRecord(viewOf(base), packIndex).ok).toBe(true);
  });

  it("결과에 이 사이트의 팩에 없는 정책이 있으면 만들지 않는다 (발견, AI 가 푼 경고, 빠진 판정 어디에 나오든)", () => {
    const base = capture("night-push.fixed");
    const UNKNOWN = "kr.example.99";
    const reason = (ids: string) => `결과에 이 사이트의 팩에 없는 정책이 있습니다: ${ids}. 그 정책의 대표 조문과 시행일, 원문 해시를 알 수 없습니다.`;
    const moved = { ...base, findings: base.findings.map((finding, i): Finding => (i === 0 ? { ...finding, policy: UNKNOWN } : finding)) };
    expect(refused(moved)).toEqual([reason(UNKNOWN)]);
    const cleared = fixture("judge-on.cleared");
    expect(refused({ ...cleared, run: { ...cleared.run, ai_cleared: cleared.run.ai_cleared!.map((entry) => ({ ...entry, policy: UNKNOWN })) } })).toEqual([reason(UNKNOWN)]);
    // 빠진 판정에만 나오는 정책은 결과 화면에 카드가 없다. 그래도 기록에서는 본다.
    const dismissed = fixture("judge-on.dismissed");
    const onlyDismissed = { ...dismissed, run: { ...dismissed.run, ai_dismissed: dismissed.run.ai_dismissed!.map((entry) => ({ ...entry, policy: UNKNOWN })) } };
    expect(viewOf(onlyDismissed).policies.map((policy) => policy.id)).not.toContain(UNKNOWN);
    expect(refused(onlyDismissed)).toEqual([reason(UNKNOWN)]);
    // 여럿이면 모두 적는다. 글자 코드 순서다(결과에 나온 차례에 따라 달라지지 않는다).
    const two = { ...base, findings: base.findings.map((finding, i): Finding => ({ ...finding, policy: i === 0 ? UNKNOWN : i === 1 ? "kr.example.100" : finding.policy })) };
    expect(refused(two)).toEqual([reason(`kr.example.100, ${UNKNOWN}`)]);
    expect(refused({ ...two, findings: [...two.findings].reverse() })).toEqual(refused(two));
  });

  it("결과에 적힌 조문 이름이 팩의 대표 조문과 다르면 만들지 않는다", () => {
    const base = capture("night-push.fixed");
    const renamed = { ...base, findings: base.findings.map((finding, i): Finding => (i === 0 ? { ...finding, law: "다른 법 제1조" } : finding)) };
    expect(refused(renamed)).toEqual([
      `결과에 적힌 조문 이름이 이 사이트의 팩에 실린 대표 조문과 다른 정책이 있습니다: ${base.findings[0].policy}. ` +
        "팩에 적힌 시행일과 원문 해시가 그 조문의 것인지 알 수 없습니다.",
    ]);
    // 팩의 둘째 조문이어도 다르다. 기록에 적는 것은 첫 조문의 값이다.
    const policy = packFile.policies.find((entry) => entry.legal.length > 1)!;
    const sample = every.map(([, parts]) => reportOf(parts)).find((report) => report.findings.some((finding) => finding.policy === policy.id))!;
    const second = { ...sample, findings: sample.findings.map((finding): Finding => (finding.policy === policy.id ? { ...finding, law: policy.legal[1].label } : finding)) };
    expect(policy.legal[1].label).not.toBe(policy.legal[0].label);
    expect(buildRecord(buildReportView(second, "cli-0.3", packIndex), packIndex)).toMatchObject({ ok: false });
  });

  it("팩 판이 다르면 그 까닭만 적는다. 그 팩의 정책이 이 사이트에 없다는 것을 덧붙이지 않는다", () => {
    const base = capture("night-push.fixed");
    const data = {
      ...base,
      run: { ...base.run, pack_digest: "0123456789abcdef" },
      findings: base.findings.map((finding): Finding => ({ ...finding, policy: "kr.example.99", law: "다른 법 제1조" })),
    };
    expect(refused(data)).toHaveLength(1);
    expect(refused(data)[0]).toContain("판이 다릅니다");
  });

  it("까닭을 그대로 보인다. 만들지 않은 기록의 값(해시, 시행일, 지문)은 보이지 않는다", () => {
    const base = capture("night-push.fixed");
    const reasons = refused({ ...base, run: { ...base.run, pack_digest: "0123456789abcdef" } });
    const html = renderToStaticMarkup(<RecordRefused reasons={reasons} />);
    expect(html.startsWith('<div class="notice notice-warn record-refused">')).toBe(true);
    expect(textOf(elementAt(html, html.indexOf("<strong>")))).toBe(RECORD_REFUSED);
    expect(RECORD_REFUSED).toBe("이 결과로는 검사 기록을 만들지 않습니다.");
    expect(elementsOf(html, "<li>").map(textOf)).toEqual(reasons);
    // 기록이 아니다. 인쇄할 때 기록만 남기는 규칙이 이 안내에는 걸리지 않는다.
    expect(html).not.toContain('class="record"');
    for (const policy of packFile.policies) {
      expect(html, policy.id).not.toContain(policy.legal[0].text_sha256!);
    }
    for (const finding of base.findings) expect(html).not.toContain(finding.fingerprint);
    for (const [pattern, why] of BANNED_WORDING) expect(pattern.test(html), `${pattern} — ${why}`).toBe(false);
  });
});

describe("확인서처럼 읽히지 않는다", () => {
  it.each(every)("%s: 맨 위에 법률 자문·인증이 아니라는 말과 0의 뜻이 있다. 발견 수와 상관없이 적는다", (_name, parts) => {
    const page = readSheet(sheet(readJson(...parts)));
    expect(page.lead).toBe("법률 자문이 아닙니다. 인증이나 확인서도 아닙니다.");
    expect(page.notice).toBe(
      "법률 자문이 아닙니다. 인증이나 확인서도 아닙니다. 검토가 필요한 지점을 알려 줄 뿐이고, 조문 해석과 최종 판단은 사람이 합니다. 검토 필요 신호가 0이어도 법적 문제가 없다는 뜻은 아닙니다.",
    );
    // 사이트의 문구 그대로다: 면책(바닥글과 같은 글)과 0의 뜻. 인쇄하면 바닥글은 함께 나오지 않는다.
    expect(page.notice).toBe(`${SITE.record.lead} ${SITE.record.rest} ${SITE.zeroIsNotClearance}`);
    expect(page.notice).toContain(SITE.disclaimer.split(". ")[0]);
    expect(`${SITE.record.lead.split(". ")[0]}. ${SITE.record.rest}`).toBe(SITE.disclaimer);
    // 이름, 무엇으로 만든 것인지, 그 말이 구역들보다 앞에 있다.
    const at = (needle: string) => page.article.indexOf(needle);
    expect(at("<h3>")).toBeLessThan(at('<p class="record-source">'));
    expect(at('<p class="record-source">')).toBeLessThan(at('<p class="record-omits">'));
    expect(at('<p class="record-omits">')).toBeLessThan(at('<p class="record-notice">'));
    expect(at('<p class="record-notice">')).toBeLessThan(at('<section class="record-section">'));
    expect(at('<p class="record-notice">')).toBeLessThan(at("<table"));
  });

  it("발견이 0인 결과: 0건이라는 줄 바로 아래에 0의 뜻을 다시 적는다. 발견이 있으면 맨 위에만 있다", () => {
    const zero = every.filter(([, parts]) => reportOf(parts).findings.length === 0);
    expect(zero.length).toBeGreaterThanOrEqual(6);
    for (const [name, parts] of every) {
      const report = reportOf(parts);
      const page = readSheet(sheet(readJson(...parts)));
      expect(count(page.text, SITE.zeroIsNotClearance), name).toBe(report.findings.length === 0 ? 2 : 1);
      if (report.findings.length === 0) {
        expect(page.found.heading, name).toBe("발견 0건");
        expect(page.found.notes[0], name).toBe(SITE.zeroIsNotClearance);
        expect(page.found.counts, name).toEqual([]);
      }
    }
  });

  it.each(every)("%s: 통과·적합·안전 같은 판정의 말, 도장·발급·서명 같은 증서의 말이 없다", (_name, parts) => {
    const page = readSheet(sheet(readJson(...parts)));
    expect(page.text).not.toMatch(/통과|합격|적합|준수|안전|양호|정상|이상\s*없|문제\s*없|깨끗|완료|승인|인증됨|확인됨|확인했|보증|증명|발급|직인|서명|도장|유효/);
    for (const [pattern, why] of BANNED_WORDING) expect(pattern.test(page.article), `${pattern} — ${why}`).toBe(false);
    // "인증"과 "확인서"는 아니라고 말하는 자리(맨 위)에만 나온다.
    expect(count(page.text, "인증")).toBe(1);
    expect(count(page.text, "확인서")).toBe(1);
  });

  it.each(every)("%s: 점수·등급·비율을 만들지 않는다. 수는 '몇 건', '몇 개'로만 적는다", (_name, parts) => {
    const page = readSheet(sheet(readJson(...parts)));
    expect(page.text).not.toMatch(/%|퍼센트|점수|등급|순위|비율|평균|달성|\d\s*점(?![가-힣])|\d\s*\/\s*\d|\d\s*개\s*(중|가운데)/);
    expect(page.article).not.toMatch(/<(progress|meter|svg|img|canvas)\b/);
    // 상태는 색 칩이 아니라 글자로 적는다(종이에서는 색에 기대지 않는다).
    expect(page.article).not.toContain('class="chip');
  });

  it("무엇으로 만든 기록인지 적는다: 합성 예시면 그렇다고, 직접 연 파일이면 그 파일을 옮겼을 뿐이라고", () => {
    const data = capture("kids-signup.main");
    const sample = readSheet(sheet(data, { name: "아동 가입 · 고치기 전 (CLI 실제 출력)", synthetic: true }));
    expect(sample.source).toBe("합성 예시입니다. 아동 가입 · 고치기 전 (CLI 실제 출력)");
    const file = readSheet(sheet(data, { name: "result.json", synthetic: false }));
    // 이 사이트는 연 파일의 모양만 본다. CLI 가 낸 그대로인지는 알 길이 없다.
    expect(file.source).toBe("연 파일(result.json)에 적힌 것을 옮긴 기록입니다. 그 파일이 CLI 가 낸 그대로인지는 확인하지 않았습니다.");
    expect(file.text).not.toContain("합성 예시");
    expect(sourceLine({ name: "a.sarif", synthetic: false })).toContain("연 파일(a.sarif)");
    // 파일 이름에 든 글자는 글로만 그려진다.
    const odd = readSheet(sheet(data, { name: '<img src=x onerror="1">.json', synthetic: false }));
    expect(odd.source).toContain('연 파일(<img src=x onerror="1">.json)');
    expect(odd.article).not.toContain("<img");
  });

  describe("기록을 만든 시각을 적지 않는다", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("언제 만들어도 글자까지 같은 기록이다 (시계를 읽지 않는다)", () => {
      const drawn = [new Date("2026-10-08T05:00:00+09:00"), new Date("2031-01-02T23:59:59+09:00")].map((now) => {
        vi.useFakeTimers();
        vi.setSystemTime(now);
        return every.map(([, parts]) => sheet(readJson(...parts)));
      });
      expect(drawn[0]).toEqual(drawn[1]);
      expect(drawn[0].length).toBe(every.length);
    });

    it.each(every)("%s: 기록에 적힌 날짜는 팩에 적힌 대표 조문의 시행일뿐이다. 시각은 없다", (_name, parts) => {
      const data = readJson(...parts);
      const page = readSheet(sheet(data));
      const dates = [...page.text.matchAll(/\d{4}\s*[-./년]\s*\d{1,2}\s*[-./월]\s*\d{1,2}/g)].map((match) => match[0]);
      expect(dates).toEqual(recordOf(data).policies.map((policy) => metaOf(policy.id).legal[0].effective_from));
      // 시:분, 오전·오후, 요일 같은 글도 없다.
      expect(page.text).not.toMatch(/\d{1,2}:\d{2}|오전|오후|[월화수목금토일]요일|GMT|UTC|KST/);
      expect(page.article).not.toMatch(/<time\b|datetime=/);
    });
  });
});

describe("인쇄물에 맞는 모양", () => {
  it.each(every)("%s: 접어 둔 것, 링크, 단추, 마우스를 올려야 뜨는 말이 없다. 종이에서는 펼칠 수도 누를 수도 없다", (_name, parts) => {
    const { article } = readSheet(sheet(readJson(...parts)));
    expect(article).not.toMatch(/<(details|summary|a|button|input|select|form|script|style|iframe)\b/);
    expect(article).not.toMatch(/\s(title|href|hidden|style|onclick)=/);
    // 가린 글은 화면 낭독기용 칸 머리 하나뿐이다("다 보지 못한 것" 표).
    expect(count(article, "visually-hidden")).toBe(1);
  });

  it.each(every)("%s: 화면 낭독기에서 가린 것은 줄바꿈 자리뿐이다. 글이나 값이 든 요소는 가리지 않는다", (_name, parts) => {
    // 눈에는 보이는데 화면 낭독기에는 없는 값이 있으면, 듣는 사람에게는 그 값이 빠진 기록이 된다(해시, 시행일, 상태, 지문).
    const { article } = readSheet(sheet(readJson(...parts)));
    // 줄바꿈 자리(wbr)는 빈 요소다. 경로와 해시가 빈칸이 낀 이름으로 읽히지 않게 가린다(Where.tsx, Record.tsx 의 Hex).
    const breaks = count(article, '<wbr aria-hidden="true"/>');
    expect(breaks).toBeGreaterThan(0);
    expect(count(article, "aria-hidden")).toBe(breaks);
    expect(article).not.toMatch(/\sinert\b|\srole="(presentation|none)"/);
  });

  it.each(every)("%s: 표는 진짜 table 이고, 화면 낭독기가 읽을 role 과 쌓았을 때 칸 앞에 적을 이름이 칸마다 있다", (_name, parts) => {
    const { article } = readSheet(sheet(readJson(...parts)));
    const tables = elementsOf(article, "<table");
    expect(tables.length).toBeGreaterThanOrEqual(2);
    for (const html of tables) {
      // 표의 이름은 표가 가리키는 구역의 제목이다(`readSheet` 가 제 구역의 제목인지 본다).
      const labelledBy = /^<table class="[^"]*" role="table" aria-labelledby="([^"]+)">/.exec(html)?.[1];
      expect(labelledBy, html.slice(0, 80)).toBeDefined();
      const name = textOf(elementAt(article, article.indexOf(`<h4 id="${labelledBy}">`)));
      expect(name.length).toBeGreaterThan(3);
      const table = tableParts(html, name);
      expect(count(html, "<thead"), name).toBe(1);
      for (const tr of elementsOf(html, "<tr ")) expect(/^<tr[^>]* role="row">/.test(tr), name).toBe(true);
      for (const th of elementsOf(html, "<th ")) expect(/^<th[^>]* role="(columnheader|rowheader)">/.test(th), name).toBe(true);
      for (const td of elementsOf(html, "<td ")) expect(/^<td[^>]* role="cell"/.test(td), name).toBe(true);
      for (const tbody of elementsOf(html, "<tbody")) expect(tbody.startsWith('<tbody role="rowgroup">'), name).toBe(true);
      if (table.headHidden) continue;
      // 칸 앞에 적는 이름은 그 칸의 칸 머리다(첫 칸은 줄의 이름이라 따로 적지 않는다). 긴 칸 머리는 끝의 낱말로 줄여 적는다.
      for (const row of table.groups.flat().filter((entry) => entry.cells.length > 0)) {
        expect(row.cells.map((cell) => cell.label).every((label, i) => table.columns[i + 1].endsWith(label!)), name).toBe(true);
        // 칸의 내용은 상자 하나로 감싼다(쌓았을 때 이름과 내용이 나란히 놓인다).
        for (const cell of row.cells) expect(/^<td[^>]*><div>[\s\S]*<\/div><\/td>$/.test(cell.html), name).toBe(true);
      }
    }
  });

  it("경로는 '/' 뒤에서 줄이 바뀐다 (결과 화면의 발견 줄과 같은 부품이다)", () => {
    const html = sheet(capture("kids-signup.main"));
    expect(html).toContain('<code>src/<wbr aria-hidden="true"/>auth/<wbr aria-hidden="true"/>signup<span class="where-tail">.ts:5</span></code>');
  });
});

describe("결과 화면과 기록을 오가는 틀 (ReportWithRecord)", () => {
  const frame = (data: unknown) => renderToStaticMarkup(<ReportWithRecord view={viewOf(data)} pack={packIndex} source={FILE} />);

  it.each(every)("%s: 처음에는 결과 화면이다. 고르는 단추가 그 위에 있고, 기록은 고르기 전에는 그리지 않는다", (_name, parts) => {
    const data = readJson(...parts);
    const html = frame(data);
    expect(html.startsWith('<div class="report-switch"><div class="segmented" role="group" aria-label="결과와 검사 기록 고르기">')).toBe(true);
    const group = elementAt(html, html.indexOf('<div class="segmented"'));
    expect(elementsOf(group, "<button").map((button) => [textOf(button), /aria-pressed="(true|false)"/.exec(button)?.[1], /type="([^"]*)"/.exec(button)?.[1]])).toEqual([
      ["결과", "true", "button"],
      ["조문별 검사 기록", "false", "button"],
    ]);
    // 단추 아래는 결과 화면 그대로다.
    expect(html).toBe(`<div class="report-switch">${group}<div>${renderToStaticMarkup(<ReportSummary view={viewOf(data)} />)}</div></div>`);
    // 기록은 없다. 0의 뜻 같은 말이 결과 화면에 두 번 보이지 않는다.
    expect(html).not.toContain('class="record"');
    expect(html).not.toContain("인쇄");
  });

  it("단추의 이름은 사이트의 문구에서 온다", () => {
    expect(SITE.record.title).toBe("조문별 검사 기록");
    expect(frame(capture("plain.main"))).toContain(`>${SITE.record.title}</button>`);
  });
});
