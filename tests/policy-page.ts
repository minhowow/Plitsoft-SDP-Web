import type { PackMeta, PolicyMeta } from "@/lib/pack/types";
import { STATUS_LABEL } from "@/lib/report/status";
import { elementAt, elementsOf } from "./helpers";

// 조문 도감의 정책 한 쪽을 HTML 에서 읽어 내는 시험용 도구. 부품을 그려 낸 HTML(tests/policy.test.tsx)과 빌드된 out/ 의
// HTML(tests/browser/out-files.test.ts)을 같은 방법으로 읽는다. 읽은 것을 팩 메타데이터에서 만든 기대값과 통째로 견준다.
// 틀(article) 안은 `readPolicyPage` 가 읽고, 빌드된 쪽에서 그 둘레(쪽이 틀 밖에 더한 것)는 `readAround` 가 읽는다.

const NAMED = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", "\u00a0"],
]);

/**
 * HTML 의 글자 참조(&amp; &lt; &#x27; 등)를 푼다. 한 번에 훑는다. 차례로 바꾸면 "&amp;lt;" 같은 글이 두 번 풀린다.
 * 모르는 이름은 조용히 넘기지 않고 실패한다. 조문 원문을 글자 그대로 견주려면 푸는 쪽이 틀리지 않아야 한다.
 */
export function decodeEntities(html: string): string {
  return html.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole: string, body: string) => {
    if (body.startsWith("#")) {
      const hex = body[1] === "x" || body[1] === "X";
      return String.fromCodePoint(parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10));
    }
    const char = NAMED.get(body);
    if (char === undefined) throw new Error(`모르는 글자 참조입니다: ${whole}`);
    return char;
  });
}

/** 태그와 주석을 걷어 내고 글만 남긴다. React 가 글 조각 사이에 넣는 주석(<!-- -->)도 걷힌다. */
export function plain(html: string): string {
  return decodeEntities(html.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, ""));
}

/** `open` 으로 시작하는 첫 요소. 없으면 null. */
function first(html: string, open: string): string | null {
  const at = html.indexOf(open);
  return at === -1 ? null : elementAt(html, at);
}

function need(html: string, open: string): string {
  const element = first(html, open);
  if (element === null) throw new Error(`요소가 없습니다: ${open}`);
  return element;
}

/** 이름표와 값의 목록(dl)의 줄. 줄마다 `<div><dt>…</dt><dd>…</dd></div>` 다. */
function rowsOf(dl: string): { label: string; value: string; html: string; warn: boolean }[] {
  return elementsOf(dl, "<div>").map((row) => {
    const dd = elementAt(row, row.search(/<dd[ >]/));
    return { label: plain(need(row, "<dt>")), value: plain(dd), html: dd, warn: dd.startsWith('<dd class="warn">') };
  });
}

const attribute = (tag: string, name: string) => new RegExp(` ${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
const openTag = (element: string) => element.slice(0, element.indexOf(">") + 1);

export interface FoldRead {
  /** 처음부터 펼쳐져 있는지. */
  open: boolean;
  /** 화면 낭독기에만 읽히는, 이름 앞의 말(어느 조문·규칙·대안의 것인지). 없으면 null. */
  whose: string | null;
  /** 접혀 있어도 보이는 이름. */
  summary: string;
  /** 펼치면 보이는 글. */
  text: string;
}

const FOLD = '<details class="fold"';
const HIDDEN = '<span class="visually-hidden">';

/**
 * 이름(링크, 접어 둔 것의 summary)을 화면 낭독기에만 읽히는 앞말과 눈에 보이는 글로 나눈다. 앞말은 요소의 맨 앞에만
 * 온다. 앞말과 보이는 글 사이에는 빈칸이 있어야 한다(없으면 두 말이 붙어 읽힌다).
 */
function nameOf(element: string): { whose: string | null; shown: string } {
  const hidden = first(element, HIDDEN);
  if (hidden === null) return { whose: null, shown: plain(element) };
  const inner = element.slice(element.indexOf(">") + 1);
  if (!inner.startsWith(hidden)) throw new Error(`화면 낭독기용 앞말이 이름의 맨 앞에 있지 않습니다: ${element.slice(0, 120)}`);
  const whose = plain(hidden);
  if (!whose.endsWith(" ") || whose.trim() === "") throw new Error(`화면 낭독기용 앞말이 비었거나 빈칸으로 끝나지 않습니다: "${whose}"`);
  return { whose: whose.trimEnd(), shown: plain(element.replace(hidden, "")) };
}

/** 접어 둔 것 하나. `body` 는 이름(summary) 뒤의 HTML 이다. */
function foldOf(details: string): { open: boolean; whose: string | null; summary: string; body: string } {
  const summary = need(details, "<summary>");
  const from = details.indexOf(summary) + summary.length;
  const name = nameOf(summary);
  return {
    open: / open=""/.test(openTag(details)),
    whose: name.whose,
    summary: name.shown,
    body: details.slice(from, details.lastIndexOf("</details>")),
  };
}

/** 접어 둔 글 하나(판정자에게 묻는 글). 안에는 문단 하나가 있다. */
function askedOf(details: string): FoldRead {
  const fold = foldOf(details);
  if (!fold.body.startsWith("<p>") || !fold.body.endsWith("</p>")) throw new Error(`접어 둔 글의 모양이 다릅니다: ${fold.body.slice(0, 80)}`);
  return { open: fold.open, whose: fold.whose, summary: fold.summary, text: plain(fold.body) };
}

const PRE = '<pre class="statute">';

/**
 * 조문 원문 상자의 글. 브라우저가 읽는 것과 같게 푼다: 상자 안에는 글만 있어야 하고(태그나 주석이 없다), 글자 참조를
 * 풀고, 여는 태그 바로 뒤의 줄바꿈 하나는 뺀다(HTML 은 pre 의 첫 줄바꿈을 버린다. React 가 그만큼 하나를 더 적는다).
 */
function statuteOf(pre: string): string {
  const inner = pre.slice(PRE.length, -"</pre>".length);
  if (inner.includes("<")) throw new Error(`조문 원문 상자에 글이 아닌 것이 있습니다: ${inner.slice(0, 80)}`);
  return decodeEntities(inner.replace(/^\n/, ""));
}

export interface LegalRead {
  /** 조문 이름. */
  label: string;
  /** "대표 조문" 표시. 없으면 null. */
  tag: string | null;
  /** 앞선 조문과 원문이 같다는 말. 없으면 null. */
  sameText: string | null;
  /** 처음부터 펼쳐져 있는지(대표 조문만). */
  open: boolean;
  /** 조문마다의 사실 줄(조문마다 값이 다른 날짜와 해시 대조, 법제처 주소가 없을 때 그 말). 원문 해시의 값은 `hash` 다. */
  facts: [label: string, value: string][];
  /** 눈에 띄게 적은 사실의 이름표. */
  warned: string[];
  /** 원문 해시: 화면 낭독기용 앞말, 보이는 앞부분, 펼치면 보이는 전체 값. 해시가 없으면 null 이고 `hashMissing` 에 그 말이 있다. */
  hash: { whose: string | null; short: string; full: string } | null;
  hashMissing: string | null;
  /** 원문 해시가 팩에 적힌 것과 다를 때 원문 위에 적는 말. */
  mismatch: string | null;
  /** 조문 원문. 원문이 없으면 null 이고 `missing` 에 그 말이 있다. */
  statute: string | null;
  missing: string | null;
  /** 법제처 링크. `whose` 는 화면 낭독기에만 읽히는 앞말(조문 이름), `text` 는 눈에 보이는 글, `newWindow` 는 화면 낭독기에만 읽히는 "(새 창)". */
  link: { href: string; target: string | null; rel: string | null; whose: string | null; text: string; newWindow: string | null } | null;
}

export interface AlternativeRead {
  id: string;
  kind: string;
  /** 약한 대안의 줄에 적는 말. */
  weak: string | null;
  /** 알리는 말, 질문, 고치는 법(있을 때). */
  says: [label: string, text: string][];
  /** AI 대안이 판정자에게 묻는 글. 접혀 있다. */
  asked: FoldRead | null;
}

export interface RuleRead {
  /** 규칙 줄의 쪽 안 자리(id). 규칙 id 가 없으면 null. */
  anchor: string | null;
  open: boolean;
  /** 접는 줄의 첫 줄: 첫 대안의 알리는 말. */
  lead: string;
  /** 대안의 수("대안 N"). */
  count: string;
  id: string;
  /** "판정 단위 …". */
  unit: string;
  /** 펼친 안쪽의 이름표(적용 조건, 적용 질문). */
  factLabels: string[];
  /** 적용 조건의 id 와 그 옆 설명 자리의 글. 조건이 없으면 비어 있고 `noConditions` 에 그 말이 있다. */
  conditions: [id: string, description: string][];
  noConditions: string | null;
  /** 적용 질문. 접혀 있다. 없으면 null 이고 `noApplies` 에 그 말이 있다. */
  applies: FoldRead | null;
  noApplies: string | null;
  alternatives: AlternativeRead[];
}

export interface PolicyPageRead {
  title: string;
  /** 머리의 대표 조문 이름. 조문이 없으면 null. */
  law: string | null;
  /** 정책 id. */
  id: string;
  /** 개발자에게 할 질문(이름표와 글). 없으면 null. */
  question: { label: string; text: string } | null;
  /** 바로가기 줄의 글과 링크. */
  jump: { text: string; hrefs: string[] };
  /** 구역의 제목(h2): 근거 조문, 규칙. */
  sections: string[];
  /** 근거 조문이 하나도 없을 때 적는 말. 있으면 null. */
  noLegal: string | null;
  legal: LegalRead[];
  /** 판정자를 켜야 묻는다는 것과 코드가 밖으로 나간다는 것. 한 문단이다. */
  judge: string | null;
  legend: { open: boolean; summary: string; items: string[] };
  rules: RuleRead[];
  /** 곁칸 `이 정책`. */
  side: { title: string; facts: [label: string, value: string][]; warned: string[] };
  /** 쪽에 있는 링크의 주소 전부(문서 차례). */
  hrefs: string[];
  /** 쪽 안의 자리(id) 전부(문서 차례). */
  ids: string[];
  /** 틀: 값과 글을 걷어 낸 뼈대. 되풀이되는 것(조문, 규칙, 대안)은 모양이 같으면 한 줄이다. */
  frame: string[];
}

function legalOf(item: string): LegalRead {
  const details = need(item, '<details class="lg"');
  const summary = need(details, "<summary>");
  const tag = first(summary, '<span class="tag">');
  const same = first(summary, '<span class="fold-note">');
  const rows = rowsOf(need(details, '<dl class="lg-facts">'));
  const hashRow = rows.find((row) => row.label === "원문 해시");
  if (!hashRow) throw new Error(`원문 해시 줄이 없습니다: ${summary.slice(0, 80)}`);
  const hashFold = first(hashRow.html, '<details class="hash">');
  const facts = rows.filter((row) => row !== hashRow);
  const pre = first(details, PRE);
  const anchor = first(item, '<a class="ext"');
  const hiddenInLink = anchor === null ? [] : elementsOf(anchor, HIDDEN);
  return {
    label: plain(need(summary, '<span class="lg-label">')).trim(),
    tag: tag === null ? null : plain(tag).trim(),
    sameText: same === null ? null : plain(same),
    open: / open=""/.test(openTag(details)),
    facts: facts.map((row) => [row.label, row.value]),
    warned: facts.filter((row) => row.warn).map((row) => row.label),
    hash:
      hashFold === null
        ? null
        : (() => {
            const fold = foldOf(hashFold);
            return { whose: fold.whose, short: fold.summary, full: plain(need(hashFold, '<code class="hash-full"')) };
          })(),
    hashMissing: hashFold === null ? hashRow.value : null,
    mismatch: (() => {
      const notice = first(details, '<p class="notice notice-warn">');
      return notice === null ? null : plain(notice);
    })(),
    statute: pre === null ? null : statuteOf(pre),
    missing: (() => {
      const none = first(details, '<p class="none">');
      return none === null ? null : plain(none);
    })(),
    link:
      anchor === null
        ? null
        : {
            href: decodeEntities(attribute(openTag(anchor), "href") ?? ""),
            target: attribute(openTag(anchor), "target"),
            rel: attribute(openTag(anchor), "rel"),
            whose: nameOf(anchor).whose,
            text: plain(hiddenInLink.reduce((rest, hidden) => rest.replace(hidden, ""), anchor)).trim(),
            newWindow: hiddenInLink.length > 1 ? plain(hiddenInLink[hiddenInLink.length - 1]).trim() : null,
          },
  };
}

function alternativeOf(item: string): AlternativeRead {
  const head = need(item, '<p class="alt-h">');
  const weak = first(item, '<p class="hint">');
  const asked = first(item, FOLD);
  return {
    id: plain(need(head, "<code")),
    kind: plain(need(head, '<span class="alt-kind">')),
    weak: weak === null ? null : plain(weak),
    says: rowsOf(need(item, '<dl class="says">')).map((line) => [line.label, line.value]),
    asked: asked === null ? null : askedOf(asked),
  };
}

function ruleOf(details: string): RuleRead {
  const summary = need(details, "<summary>");
  const loc = need(summary, '<span class="loc">');
  const body = need(details, '<div class="rule-body">');
  const facts = rowsOf(need(body, '<dl class="facts">'));
  const [conditions, applies] = facts;
  const list = first(conditions.html, '<ul class="conditions">');
  const asked = first(applies.html, FOLD);
  return {
    anchor: attribute(openTag(details), "id"),
    open: / open=""/.test(openTag(details)),
    lead: plain(need(summary, '<span class="msg">')),
    count: plain(need(summary, '<span class="n">')),
    id: plain(need(loc, "<code")),
    unit: plain(need(loc.slice(loc.indexOf("</code>")), "<span>")),
    factLabels: facts.map((row) => row.label),
    conditions:
      list === null
        ? []
        : elementsOf(list, "<li>").map((item) => [plain(need(item, "<code")), plain(need(item, '<span class="none">'))]),
    noConditions: list === null ? conditions.value : null,
    applies: asked === null ? null : askedOf(asked),
    noApplies: asked === null ? applies.value : null,
    alternatives: elementsOf(need(body, '<ul class="alt-list">'), "<li>").map(alternativeOf),
  };
}

/** 값과 글을 걷어 낸 뼈대의 한 줄. 같은 줄이 잇달아 나오면 한 번만 적는다(조문이 둘이어도, 규칙이 다섯이어도 틀은 같다). */
function frameOf(page: Omit<PolicyPageRead, "frame">): string[] {
  const lines = [
    `머리: ${["제목", page.law !== null && "대표 조문", "정책 id", page.question !== null && "개발자에게 할 질문", "바로가기"].filter(Boolean).join(" · ")}`,
    "구역: 근거 조문",
    // 조문마다의 사실 줄은 조문마다 값이 다를 때만 그 값을 적어서 정책마다 다르다. 틀에는 그 자리만 적는다.
    ...page.legal.map((legal) => `조문: 이름 · 조문마다의 사실 · 원문 해시 · 조문 원문${legal.link ? " · 법제처 원문" : ""}`),
    "구역: 규칙",
    ...(page.judge === null ? [] : ["판정자 알림"]),
    "규칙 읽는 법",
    ...page.rules.flatMap((rule) => [
      `규칙: 알리는 말 · 대안 수 · 규칙 id · 판정 단위 · ${rule.factLabels.join(" · ")}`,
      // 고치는 법은 팩에 있는 대안에만 적는다. 틀에는 늘 있는 둘만 적는다.
      ...rule.alternatives.map((alt) => `대안: id · 종류와 세기 · ${alt.says.map(([label]) => label).filter((label) => label !== "고치는 법").join(" · ")}`),
    ]),
    `곁칸: ${page.side.facts.map(([label]) => label).join(" · ")}`,
  ];
  return lines.filter((line, i) => lines.indexOf(line) === i);
}

const ARTICLE = '<article class="policy-page">';

/** 정책 쪽이 쓰는 요소. 이 밖의 요소(그리지 않는 template·dialog, 스스로 받아 오는 img·iframe 등)가 있으면 실패한다. */
const KNOWN_TAGS = new Set(
  "article header aside section div p h1 h2 dl dt dd ul li strong code span a details summary pre svg path".split(" "),
);

/**
 * 정책 쪽이 쓰는 속성. 이 밖의 속성이 있으면 실패한다: 요소를 가리는 것(hidden, style, inert), 보이지 않는 글을 싣는 것
 * (title, aria-label, alt). aria-hidden 은 선 아이콘(svg)에만 받는다. 쪽 안의 자리(id)는 정해 둔 것과 규칙의 자리만 받는다.
 */
const KNOWN_ATTRIBUTES = new Set(["class", "href", "rel", "target", "open", "translate", "id", "aria-labelledby"]);
const ICON_ATTRIBUTES = new Set(["class", "width", "height", "viewBox", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "aria-hidden", "focusable", "d"]);
const FIXED_IDS = new Set(["legal", "legal-title", "rules", "rules-title", "facts-title"]);

/**
 * 쪽에 아는 요소와 속성만 있는지 본다. 글이 아닌 것으로 가리거나(속성, 그리지 않는 요소) 보이지 않는 글을 싣는 길을 막는다.
 * 읽기 전에 본다. 모르는 속성이 붙은 요소는 읽는 도구가 찾지 못해서, 먼저 보지 않으면 까닭이 "요소가 없다"로만 남는다.
 */
function assertKnownMarkup(article: string): void {
  for (const [tag, name, attributes] of article.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)((?:[\s/][^>]*)?)>/g)) {
    if (!KNOWN_TAGS.has(name)) throw new Error(`읽는 도구가 모르는 요소가 있습니다: ${tag.slice(0, 120)}`);
    const known = name === "svg" || name === "path" ? ICON_ATTRIBUTES : KNOWN_ATTRIBUTES;
    for (const [, attribute, value] of attributes.matchAll(/\s([^\s="'<>/]+)(?:="([^"]*)")?/g)) {
      if (!known.has(attribute)) throw new Error(`읽는 도구가 모르는 속성이 있습니다(${attribute}): ${tag.slice(0, 120)}`);
      if (attribute === "id" && !FIXED_IDS.has(value) && !(name === "details" && /^rule-[A-Za-z0-9_-]+$/.test(value))) {
        throw new Error(`정해 두지 않은 쪽 안의 자리가 있습니다(${value}): ${tag.slice(0, 120)}`);
      }
    }
  }
}

type Piece = string | null | undefined;

/** 글에서 빈칸(줄바꿈까지)을 뺀다. 쪽의 글 전체를 견줄 때 쓴다. 요소 사이에 빈칸이 있고 없고는 그리는 길마다 다르다. */
export const squash = (text: string) => text.replace(/\s+/g, "");

/**
 * 읽은 조각을 틀의 차례로 이은 글(빈칸은 뺀다). 쪽의 글 전체가 이것과 같아야 한다. 빌드된 HTML 은 `assertAllRead` 가
 * 견주고, 브라우저가 그린 쪽은 tests/browser/policy.test.ts 가 팩 메타데이터에서 만든 기대값(`expectedPolicyPage`)으로 견준다.
 */
export function wholeText(page: Omit<PolicyPageRead, "frame">): string {
  const fold = (read: FoldRead | null): Piece[] => (read === null ? [] : [read.whose, read.summary, read.text]);
  const pieces: Piece[] = [
    page.title,
    page.law,
    page.id,
    page.question?.label,
    page.question?.text,
    page.jump.text,
    page.sections[0],
    page.noLegal,
    ...page.legal.flatMap((legal) => [
      legal.label,
      legal.tag,
      legal.sameText,
      ...legal.facts.flat(),
      "원문 해시",
      legal.hash?.whose,
      legal.hash?.short,
      legal.hash?.full,
      legal.hashMissing,
      legal.mismatch,
      legal.statute,
      legal.missing,
      legal.link?.whose,
      legal.link?.text,
      legal.link?.newWindow,
    ]),
    page.sections[1],
    page.judge,
    page.legend.summary,
    ...page.legend.items,
    ...page.rules.flatMap((rule) => [
      rule.lead,
      rule.count,
      rule.id,
      rule.unit,
      rule.factLabels[0],
      ...rule.conditions.flat(),
      rule.noConditions,
      rule.factLabels[1],
      ...fold(rule.applies),
      rule.noApplies,
      ...rule.alternatives.flatMap((alt) => [alt.id, alt.kind, alt.weak, ...alt.says.flat(), ...fold(alt.asked)]),
    ]),
    page.side.title,
    ...page.side.facts.flat(),
  ];
  return squash(pieces.filter((piece) => typeof piece === "string").join(""));
}

/** 두 글이 어긋나기 시작한 곳의 앞뒤(쪽의 것, 견준 것). 같으면 null. 긴 글 둘을 통째로 내보이지 않으려는 것이다. */
export function partingOf(shown: string, wanted: string): [shown: string, wanted: string] | null {
  if (shown === wanted) return null;
  let at = 0;
  while (at < wanted.length && wanted[at] === shown[at]) at += 1;
  const from = Math.max(0, at - 20);
  return [shown.slice(from, at + 60), wanted.slice(from, at + 60)];
}

/**
 * 읽은 것이 쪽의 전부인지 본다. 읽는 도구는 아는 자리만 찾아 읽으므로, 이것이 없으면 모르는 글이 쪽에 더해지거나 구역의
 * 차례가 바뀌어도 읽은 값은 그대로다.
 *
 * - 글: 읽은 조각을 틀의 차례로 이은 글이 쪽의 글 전체와 같다(빈칸은 빼고 견준다).
 * - 접어 둔 것(details)과 화면에서만 가린 글(.visually-hidden): 읽은 수만큼만 있다.
 *
 * 여기서 보는 것은 틀(article) 안이다. 틀 밖은 `readAround` 가 읽는다. CSS 가 가리거나 그린 것은 브라우저 시험이 본다.
 */
function assertAllRead(article: string, page: Omit<PolicyPageRead, "frame">): void {
  const hashes = page.legal.filter((legal) => legal.hash !== null).length;
  const folds = page.rules.flatMap((rule) => [rule.applies ?? [], ...rule.alternatives.map((alt) => alt.asked ?? [])].flat());
  // 조문마다 하나, 해시마다 하나, 규칙 읽는 법, 규칙마다 하나, 묻는 글마다 하나.
  const wanted = page.legal.length + hashes + 1 + page.rules.length + folds.length;
  const details = article.split("<details").length - 1;
  if (details !== wanted) throw new Error(`접어 둔 것이 읽은 것보다 많거나 적습니다: 쪽 ${details}개, 읽은 것 ${wanted}개`);
  const hiddenRead = [
    ...page.legal.flatMap((legal) => [legal.hash?.whose, legal.link?.whose, legal.link?.newWindow]),
    ...folds.map((fold) => fold.whose),
  ].filter((text) => typeof text === "string").length;
  const hidden = article.split("visually-hidden").length - 1;
  if (hidden !== hiddenRead) throw new Error(`화면에서만 가린 글이 읽은 것보다 많거나 적습니다: 쪽 ${hidden}곳, 읽은 것 ${hiddenRead}곳`);

  const parting = partingOf(squash(plain(article)), wholeText(page));
  if (parting === null) return;
  throw new Error(
    `쪽에 읽지 않은 글이 있거나 차례가 틀과 다릅니다. 어긋나기 시작한 곳(빈칸은 뺐다): 쪽 "${parting[0]}" / 읽은 것 "${parting[1]}"`,
  );
}

/**
 * 정책 한 쪽을 읽는다. 쪽 전체의 HTML 을 줘도 되고(빌드된 파일), 부품만 그려 낸 HTML 을 줘도 된다. 읽는 것은 틀(article)
 * 안이다. 틀에 모르는 요소나 속성이 있거나(`assertKnownMarkup`) 읽은 것이 틀의 전부가 아니면(`assertAllRead`) 실패한다.
 */
export function readPolicyPage(html: string): PolicyPageRead {
  const article = need(html, ARTICLE);
  assertKnownMarkup(article);
  const head = need(article, '<header class="policy-page-head">');
  const meta = need(head, '<p class="pd-meta">');
  const law = first(meta, '<span class="law">');
  const ask = first(head, '<div class="pd-q">');
  const jump = need(head, '<p class="jump">');
  const legalSection = need(article, '<section class="policy-section" id="legal"');
  const ruleSection = need(article, '<section class="policy-section" id="rules"');
  // 조문이 없다는 말은 조문 목록 밖(구역 바로 아래)에 있다. 조문 안의 "원문이 실려 있지 않습니다"와 가른다.
  const legalList = first(legalSection, '<div class="box rows legal-list">');
  const noLegal = first(legalList === null ? legalSection : legalSection.replace(legalList, ""), '<p class="none">');
  const judge = first(ruleSection, '<p class="judge-note">');
  const legend = foldOf(need(ruleSection, '<details class="legend-fold">'));
  const side = need(article, '<aside class="policy-side">');
  const sideRows = rowsOf(need(side, '<dl class="side-facts">'));
  const page = {
    title: plain(need(head, "<h1>")),
    law: law === null ? null : plain(law).trim(),
    id: plain(need(meta, "<code")),
    question: ask === null ? null : { label: plain(need(ask, '<p class="lbl">')), text: plain(need(ask, '<p class="question">')) },
    jump: { text: plain(jump), hrefs: [...jump.matchAll(/<a [^>]*href="([^"]*)"/g)].map((match) => decodeEntities(match[1])) },
    sections: [legalSection, ruleSection].map((section) => plain(need(section, "<h2"))),
    noLegal: noLegal === null ? null : plain(noLegal),
    legal: elementsOf(legalSection, '<div class="lg-item').map(legalOf),
    judge: judge === null ? null : plain(judge),
    legend: { open: legend.open, summary: legend.summary, items: elementsOf(legend.body, "<li>").map(plain) },
    rules: elementsOf(ruleSection, '<details class="rule-row"').map(ruleOf),
    side: {
      title: plain(need(side, "<h2")),
      facts: sideRows.map((row): [string, string] => [row.label, row.value]),
      warned: sideRows.filter((row) => row.warn).map((row) => row.label),
    },
    hrefs: [...article.matchAll(/<a [^>]*href="([^"]*)"/g)].map((match) => decodeEntities(match[1])),
    ids: [...article.matchAll(/<[a-z0-9]+ [^>]*\bid="([^"]*)"/g)].map((match) => match[1]),
  };
  assertAllRead(article, page);
  return { ...page, frame: frameOf(page) };
}

export interface AroundRead {
  /** 쪽의 본문(main) 안에서 틀(article)의 앞과 뒤에 있는 것. 둘 다 비어 있어야 한다. */
  beside: [before: string, after: string];
  /** 본문 밖의 것(사이트의 머리와 바닥). 본문은 비워서 자리만 남긴다. 어느 정책의 쪽에서나 같아야 한다. */
  chrome: string;
}

/**
 * 빌드된 쪽 전체에서 틀(article)의 둘레를 읽는다. `readPolicyPage` 는 틀 안만 읽는다. 여기서 읽은 것이 비어 있고(본문 안)
 * 정책마다 같아야(본문 밖) 틀 안에서 읽은 것이 쪽의 전부다.
 *
 * React 가 끼워 넣는 주석은 걷어 내고 읽는다. 본문 밖에서는 스크립트도 걷어 낸다(Next 가 바닥 뒤에 싣는다. 쪽을 옮겨 올 때
 * 쓰는 내용이 들어 있어 쪽마다 다르다). 본문 안의 스크립트는 걷어 내지 않는다. 틀 밖에 더해진 것으로 읽힌다.
 */
export function readAround(html: string): AroundRead {
  const body = need(html.replace(/<!--[\s\S]*?-->/g, ""), "<body");
  const mains = elementsOf(body, "<main");
  if (mains.length !== 1) throw new Error(`쪽의 본문(main)이 하나가 아닙니다: ${mains.length}개`);
  const [main] = mains;
  const open = main.slice(0, main.indexOf(">") + 1);
  const inner = main.slice(open.length, -"</main>".length);
  const article = need(inner, ARTICLE);
  const at = inner.indexOf(article);
  const start = body.indexOf(main);
  const outside = `${body.slice(0, start)}${open}</main>${body.slice(start + main.length)}`;
  return {
    beside: [inner.slice(0, at), inner.slice(at + article.length)],
    chrome: outside.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ""),
  };
}

/** 정책 다섯이 함께 쓰는 틀. 정책마다 조문과 규칙의 수는 달라도 이 뼈대는 같다. */
export const POLICY_FRAME = [
  "머리: 제목 · 대표 조문 · 정책 id · 개발자에게 할 질문 · 바로가기",
  "구역: 근거 조문",
  "조문: 이름 · 조문마다의 사실 · 원문 해시 · 조문 원문 · 법제처 원문",
  "구역: 규칙",
  "판정자 알림",
  "규칙 읽는 법",
  "규칙: 알리는 말 · 대안 수 · 규칙 id · 판정 단위 · 적용 조건 · 적용 질문",
  "대안: id · 종류와 세기 · 알리는 말 · 질문",
  "곁칸: 판정 단위 · 재검토 기한 · 팩 · 팩 판 · 원문과 날짜 · 원문 받은 날 · 원문 해시 대조 · 시행일 · 시행일의 판본",
];

export interface PolicyIndexRead {
  /** 메타 한 줄(팩, 판, 정책 수). */
  meta: string;
  /** 정책 줄: 주소, 제목, 대표 조문, 규칙 수. */
  rows: { href: string; title: string; law: string; rules: string }[];
  /** 상태의 뜻(#status): 이름과 뜻. 상태는 칩으로 그렸는지도 읽는다. */
  status: { label: string; text: string; chip: boolean }[];
  /** 검사에 들지 않는 파일과 정보(#scope): 제목, 첫 문단, 항목(무엇, 왜, 까닭들). */
  scope: { title: string; lead: string; items: { what: string; why: string; cases: string[] }[] };
  /** 구역의 자리(id)와 제목. */
  sections: { id: string; title: string }[];
}

/** 조문 도감 목록(/policy)을 읽는다. 부품만 그려 낸 HTML 이든 빌드된 쪽이든 본문(main) 또는 그 조각을 준다. */
export function readPolicyIndex(html: string): PolicyIndexRead {
  const list = need(html, '<ul class="policy-index">');
  const status = need(html, '<section class="pi-sec" id="status"');
  const scope = need(html, '<section class="pi-sec" id="scope"');
  const box = need(scope, '<div class="box not-seen-box">');
  return {
    meta: plain(need(html, '<p class="pi-meta">')),
    rows: elementsOf(list, "<li>").map((item) => ({
      href: decodeEntities(/href="([^"]*)"/.exec(item)?.[1] ?? ""),
      title: plain(need(item, '<span class="pi-title">')),
      law: plain(need(item, '<span class="pi-law">')),
      rules: plain(need(item, '<span class="pi-n">')),
    })),
    status: elementsOf(need(status, '<dl class="box rows defs">'), "<div>").map((row) => {
      const dt = need(row, "<dt>");
      return { label: plain(dt), text: plain(need(row, "<dd>")), chip: dt.includes('<span class="chip chip-') };
    }),
    scope: {
      title: plain(need(scope, "<h2")),
      lead: plain(need(box, '<p class="hint">')),
      items: elementsOf(need(box, '<ul class="not-seen">'), "<li>")
        .filter((item) => item.startsWith("<li><strong>"))
        .map((item) => {
          const why = need(item, '<div class="ns-why">');
          const cases = first(why, '<ul class="not-seen-cases">');
          return {
            what: plain(need(item, "<strong>")).replace(/:$/, ""),
            why: plain(cases === null ? why : why.replace(cases, "")),
            cases: cases === null ? [] : elementsOf(cases, "<li>").map(plain),
          };
        }),
    },
    sections: [status, scope].map((section) => ({ id: attribute(openTag(section), "id") ?? "", title: plain(need(section, "<h2")) })),
  };
}

// 아래는 기대값이다. 화면의 글을 시험에 따로 적어 둔다. 소스의 글(src/lib/pack/guide.ts)을 가져다 견주면 글을 바꿔도
// 시험이 따라 바뀌어 아무것도 잡지 못한다.

export const NOT_IN_PACK = "팩에 실려 있지 않습니다.";
export const UNDESCRIBED = "팩이 아직 알려 주지 않습니다.";
export const NO_TEXT = "원문이 실려 있지 않습니다.";
export const ASKED = "판정자에게 묻는 글";
export const WEAK = "약한 대안은 참이어도 혼자서는 경고를 풀지 못합니다.";
export const JUDGE_ON = "판정자를 켠 검사에서만 묻습니다.";
export const CODE_LEAVES = "판정자를 켜면 판정 대상 코드가 외부 API 로 나갑니다.";
export const DIFFERS = "조문마다 다름";
const NO_ID = "(id 없음)";
const ORDINAL = ["첫째", "둘째", "셋째", "넷째", "다섯째"];
const ordinal = (index: number) => ORDINAL[index] ?? `${index + 1}번째`;

const unitOf = (scope: string) => (scope === "file" ? "파일" : scope === "anchor" ? "함수" : scope);

/** 규칙 줄의 쪽 안 자리. 영문자·숫자·빼기표 밖의 글자는 `_<16진 코드>_` 로 바꾼다(겹치지 않게 밑줄도 바꾼다). */
export const anchorOf = (ruleId: string) => `rule-${[...ruleId].map((char) => (/[A-Za-z0-9-]/.test(char) ? char : `_${char.codePointAt(0)!.toString(16)}_`)).join("")}`;

/** 대안의 종류와 세기. 팩의 값을 옮긴 것이다. 모르는 값은 팩에 적힌 그대로다. */
function kindOf(alt: PolicyMeta["rules"][number]["alternatives"][number]): string {
  if (alt.kind === "ai") {
    if (alt.evidence === "required" || alt.evidence === "strict") return "AI · 코드 인용 필요";
    return alt.evidence === null ? "AI" : `AI · 인용 조건 ${alt.evidence}`;
  }
  if (alt.strength === null) return "정적";
  return alt.strength === "strong" ? "정적 · 강한" : alt.strength === "weak" ? "정적 · 약한" : `정적 · ${alt.strength}`;
}

type Legal = PolicyMeta["legal"][number];

/** 원문 해시가 팩에 적힌 것과 맞는지의 말. 맞지 않거나 견주지 못했으면 눈에 띄게 적는다(warn). */
function hashOf(legal: Legal): { text: string; warn: boolean } {
  if (legal.text_sha256_matches === true) return { text: "팩에 적힌 것과 같음", warn: false };
  if (legal.text_sha256_matches === false) return { text: "팩에 적힌 것과 다름", warn: true };
  if (!legal.text) return { text: "원문이 없어 견주지 못함", warn: true };
  if (legal.text_sha256 === null) return { text: "팩에 해시가 적혀 있지 않음", warn: true };
  return { text: "견주지 못함", warn: true };
}

/** 조문들이 그 값을 모두 같게 가졌는지. 같으면 [true, 값], 다르면 [false]. */
function sharedOf<T>(legal: Legal[], pick: (legal: Legal) => T): [true, T] | [false] {
  const values = new Set(legal.map(pick));
  return values.size === 1 ? [true, [...values][0]] : [false];
}

/**
 * 정책 하나가 쪽에서 어떻게 읽혀야 하는지. 팩 메타데이터의 값에서 만든다. 팩에 실린 정책에도, 시험이 손으로 고친
 * 정책(값이 빠졌거나 모르는 값이 든 것)에도 쓴다.
 *
 * 원문의 출처(원문 받은 날, 시행일, 원문 해시가 맞는지): 조문이 모두 같은 값이면 곁칸에 한 번, 다르면 조문마다의 줄에 그 값이
 * 있고 곁칸에는 날짜면 "조문마다 다름", 해시 대조면 맞지 않는 것의 수다(색만으로 알리지 않는다). 원문 해시의 값은 늘 조문마다다.
 * 곁칸의 차례는 docs/redesign.md 3장의 목록대로 해시가 시행일의 판본보다 앞이다.
 *
 * 해시가 맞지 않거나 견주지 못한 조문은 대표 조문이 아니어도 펼쳐 둔다. 법제처 주소가 없는 조문에는 없다고 적는다.
 */
export function expectedPolicyPage(policy: PolicyMeta, pack: PackMeta["pack"]): Omit<PolicyPageRead, "frame"> {
  const units = [...new Set(policy.rules.map((rule) => unitOf(rule.scope)))];
  const ai = policy.rules.some((rule) => rule.alternatives.some((alt) => alt.kind === "ai"));
  const applies = policy.rules.some((rule) => Boolean(rule.applies_question));
  const asked = [ai && "AI 대안", applies && "적용 질문"].filter(Boolean).join("과 ");
  const dates: [string, (legal: Legal) => string | null][] = [
    ["원문 받은 날", (legal) => legal.text_retrieved],
    ["시행일", (legal) => legal.effective_from],
  ];
  const [retrieved, effective] = dates.map(([label, pick]) => [label, pick, sharedOf(policy.legal, pick)] as const);
  const sharedHash = sharedOf(policy.legal, (legal) => hashOf(legal).text);
  // 조문마다 해시 대조가 다를 때: 맞지 않거나 견주지 못한 것을 말마다 센다(처음 나온 차례).
  const tally = new Map<string, number>();
  for (const legal of policy.legal) if (hashOf(legal).warn) tally.set(hashOf(legal).text, (tally.get(hashOf(legal).text) ?? 0) + 1);
  const hashSide = sharedHash[0]
    ? policy.legal.length > 1
      ? `${policy.legal.length}개 모두 ${sharedHash[1]}`
      : sharedHash[1]
    : `${policy.legal.length}개 가운데 ${[...tally].map(([text, n]) => `${n}개 ${text}`).join(", ")}`;
  const dateSide = ([label, , shared]: typeof retrieved): [string, string] => [label, shared[0] ? (shared[1] ?? NOT_IN_PACK) : DIFFERS];
  const sideSources: [string, string][] =
    policy.legal.length === 0
      ? []
      : [["원문과 날짜", "팩에 실린 그대로"], dateSide(retrieved), ["원문 해시 대조", hashSide], dateSide(effective), ["시행일의 판본", "팩이 아직 알려 주지 않음"]];
  const perLegalDate = ([label, pick, shared]: typeof retrieved, legal: Legal): [string, string][] => (shared[0] ? [] : [[label, pick(legal) ?? NOT_IN_PACK]]);
  const anyHashWarn = policy.legal.some((legal) => hashOf(legal).warn);
  return {
    title: policy.title,
    law: policy.legal[0]?.label ?? null,
    id: policy.id,
    question: policy.ask_developer === null ? null : { label: "개발자에게 할 질문", text: policy.ask_developer },
    jump: { text: `근거 조문 ${policy.legal.length} · 규칙 ${policy.rules.length}`, hrefs: ["#legal", "#rules"] },
    sections: [`근거 조문 ${policy.legal.length}`, `규칙 ${policy.rules.length}`],
    noLegal: policy.legal.length > 0 ? null : "팩에 근거 조문이 실려 있지 않습니다.",
    legal: policy.legal.map((legal, i) => {
      // 빈 글도 원문이 없는 것으로 친다.
      const text = legal.text || null;
      const same = text === null ? -1 : policy.legal.slice(0, i).findIndex((earlier) => earlier.text === text);
      const hash = hashOf(legal);
      const facts: [string, string][] = [
        ...perLegalDate(retrieved, legal),
        ...(sharedHash[0] ? [] : [["원문 해시 대조", hash.text] as [string, string]]),
        ...perLegalDate(effective, legal),
        ...(legal.url === null ? [["법제처 링크", NOT_IN_PACK] as [string, string]] : []),
      ];
      return {
        label: legal.label,
        // 대표 조문은 팩의 첫 조문이다. 대표 조문의 원문만 펼쳐 둔다.
        tag: i === 0 ? "대표 조문" : null,
        sameText: same === -1 ? null : `위 ${ordinal(same)} 조문과 원문이 같습니다`,
        open: i === 0 || hash.warn,
        facts,
        warned: !sharedHash[0] && hash.warn ? ["원문 해시 대조"] : [],
        hash: legal.text_sha256 ? { whose: `${legal.label} 원문 해시`, short: `${legal.text_sha256.slice(0, 16)}…`, full: legal.text_sha256 } : null,
        hashMissing: legal.text_sha256 ? null : NOT_IN_PACK,
        mismatch: text !== null && legal.text_sha256_matches === false ? "아래 원문은 팩에 적힌 해시와 맞지 않습니다." : null,
        statute: text,
        missing: text === null ? NO_TEXT : null,
        // 눈에는 "법제처 원문"만 보이고, 화면 낭독기에는 어느 조문의 링크인지와 새 창이라는 것이 함께 읽힌다.
        link: legal.url === null ? null : { href: legal.url, target: "_blank", rel: "noopener noreferrer", whose: legal.label, text: "법제처 원문", newWindow: "(새 창)" },
      };
    }),
    judge: asked === "" ? null : `${asked}은 ${JUDGE_ON} ${CODE_LEAVES} 판정자는 기본으로 꺼져 있습니다.`,
    legend: {
      open: false,
      summary: "규칙 읽는 법 판정 단위, 적용 조건, 대안의 종류와 세기",
      items: [
        ...(units.includes("파일") ? ["판정 단위 · 파일: 파일마다 판정 하나를 냅니다. 파일 전체를 보고 판정합니다."] : []),
        ...(units.includes("함수") ? ["판정 단위 · 함수: 팩이 고른 적용 조건이 맞은 자리를 감싸는 가장 바깥 함수마다 판정 하나를 냅니다."] : []),
        `적용 조건: 모두 참이어야 규칙이 적용됩니다. 조건마다 무엇을 보는지는 ${UNDESCRIBED}`,
        "적용 질문: 적용 조건만으로 적용 여부가 정해지지 않을 때 판정자에게 묻습니다.",
        "적법한 대안: 하나만 참이면 경고가 풀려, 결과에 발견으로 나오지 않습니다. 약한 대안은 아래처럼 다릅니다.",
        "정적 · 강한: AI 를 부르지 않고 판정합니다. 참이면 혼자서 경고를 풉니다.",
        "정적 · 약한: 이름·문자열만 본 근거입니다. 참이어도 혼자서는 경고를 풀지 못하고 판정자에게 다시 묻습니다. " +
          `판정자가 없으면 '${STATUS_LABEL.uncertain}'로 남습니다.`,
        "AI · 코드 인용 필요: 정적 조건으로 결론이 나지 않을 때만 판정자에게 묻습니다. '예'라는 답은 코드의 실제 줄을 인용해야 " +
          "인정됩니다. 판정자가 꺼져 있으면 판정에 넣지 않습니다.",
      ],
    },
    rules: policy.rules.map((rule, i) => ({
      anchor: rule.id === null ? null : anchorOf(rule.id),
      // 첫 규칙만 펼쳐 둔다(목업 policy).
      open: i === 0,
      lead: rule.alternatives[0]?.message ?? NOT_IN_PACK,
      count: `대안 ${rule.alternatives.length}`,
      id: rule.id ?? NO_ID,
      unit: `판정 단위 ${unitOf(rule.scope)}`,
      factLabels: ["적용 조건", "적용 질문"],
      conditions: rule.applies_when.map((id): [string, string] => [id ?? NO_ID, UNDESCRIBED]),
      noConditions: rule.applies_when.length === 0 ? "이 규칙에는 적용 조건이 없습니다." : null,
      // 한 쪽에 "판정자에게 묻는 글"이 여럿이다. 화면 낭독기에는 어느 규칙·대안의 것인지 함께 읽힌다.
      applies: rule.applies_question ? { open: false, whose: `${rule.id ?? NO_ID} 적용 질문`, summary: ASKED, text: rule.applies_question } : null,
      noApplies: rule.applies_question ? null : "이 규칙에는 적용 질문이 없습니다.",
      alternatives: rule.alternatives.map((alt) => ({
        id: alt.id ?? NO_ID,
        kind: kindOf(alt),
        weak: alt.kind === "static" && alt.strength === "weak" ? WEAK : null,
        says: [
          ["알리는 말", alt.message ?? NOT_IN_PACK],
          ["질문", alt.ask_developer ?? NOT_IN_PACK],
          // 고치는 법은 팩에 있는 대안에만 적는다(결과 화면과 같다).
          ...(alt.remediation ? [["고치는 법", alt.remediation] as [string, string]] : []),
        ],
        asked: alt.question ? { open: false, whose: `${rule.id ?? NO_ID} 대안 ${alt.id ?? NO_ID}`, summary: ASKED, text: alt.question } : null,
      })),
    })),
    side: {
      title: "이 정책",
      facts: [
        ["판정 단위", units.length === 0 ? NOT_IN_PACK : units.length === 1 ? units[0] : "규칙마다 다름"],
        ["재검토 기한", policy.review_by ?? NOT_IN_PACK],
        ["팩", pack.id ?? NOT_IN_PACK],
        ["팩 판", pack.digest],
        ...sideSources,
      ],
      warned: policy.legal.length > 0 && anyHashWarn ? ["원문 해시 대조"] : [],
    },
    hrefs: ["#legal", "#rules", ...policy.legal.flatMap((legal) => legal.url ?? [])],
    ids: ["legal", "legal-title", "rules", "rules-title", ...policy.rules.flatMap((rule) => (rule.id === null ? [] : [anchorOf(rule.id)])), "facts-title"],
  };
}
