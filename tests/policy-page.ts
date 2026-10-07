import type { PackMeta, PolicyMeta } from "@/lib/pack/types";
import { STATUS_LABEL } from "@/lib/report/status";
import { SITE } from "@/lib/site";
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
    open: details.startsWith(`${FOLD} open="">`),
    whose: name.whose,
    summary: name.shown,
    body: details.slice(from, details.lastIndexOf("</details>")),
  };
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
  /** 조문 이름. 대표 조문 표시는 따로 읽는다. */
  label: string;
  /** "대표 조문" 표시. 없으면 null. */
  tag: string | null;
  /** 그 표시의 뜻. 이름 바로 아래에 보이는 글로 적혀 있다. 없으면 null. */
  tagNote: string | null;
  /** 시행일, 원문을 받은 날, 원문 해시, 법제처 링크. */
  facts: [label: string, value: string][];
  /** 눈에 띄게 적은 값의 이름표(원문 해시가 다르거나 견주지 못했을 때). */
  warned: string[];
  /** 법제처 링크. `whose` 는 화면 낭독기에만 읽히는 앞말(조문 이름), `text` 는 눈에 보이는 글이다. */
  link: { href: string; target: string | null; rel: string | null; whose: string | null; text: string } | null;
  /** 원문 해시가 팩에 적힌 것과 다를 때 원문 위에 적는 말. */
  mismatch: string | null;
  /** 조문 원문. 접어 둘 수 있다. 원문이 없으면 null 이고 `missing` 에 그 말이 있다. */
  statute: FoldRead | null;
  missing: string | null;
}

export interface AlternativeRead {
  id: string;
  kind: string;
  /** 약한 대안의 줄에 적는 말. */
  weak: string | null;
  /** 알리는 말, 질문, 고치는 법. */
  says: [label: string, text: string][];
  /** AI 대안이 판정자에게 묻는 글. 접혀 있다. */
  asked: FoldRead | null;
}

export interface RuleRead {
  heading: string;
  /** 판정 단위, 적용 조건, 적용 질문의 이름표. */
  factLabels: string[];
  unit: string;
  /** 적용 조건의 id 와 그 옆 설명 자리의 글. 조건이 없으면 비어 있고 `noConditions` 에 그 말이 있다. */
  conditions: [id: string, description: string][];
  noConditions: string | null;
  /** 적용 질문. 접혀 있다. 없으면 null 이고 `noApplies` 에 그 말이 있다. */
  applies: FoldRead | null;
  noApplies: string | null;
  caption: string;
  columns: string[];
  alternatives: AlternativeRead[];
}

export interface PolicyPageRead {
  law: string | null;
  title: string;
  question: string | null;
  /** 한눈에 보는 것: 근거 조문, 규칙, 판정 단위, 재검토 기한, 팩, 팩 판. */
  facts: [label: string, value: string][];
  factsNote: string;
  /** 구역의 제목(h2). */
  sections: string[];
  legalNote: string | null;
  /** 근거 조문이 하나도 없을 때 적는 말. 있으면 null. */
  noLegal: string | null;
  legal: LegalRead[];
  /** 판정자를 켜야 묻는다는 것과 코드가 밖으로 나간다는 것. 한 문단이다. */
  judge: string | null;
  legend: { open: boolean; summary: string; items: string[] };
  rules: RuleRead[];
  disclaimer: string;
  /** 쪽에 있는 링크의 주소 전부. */
  hrefs: string[];
  /** 틀: 값과 글을 걷어 낸 뼈대. 되풀이되는 것(조문, 규칙, 대안)은 모양이 같으면 한 줄이다. */
  frame: string[];
}

const attribute = (tag: string, name: string) => new RegExp(` ${name}="([^"]*)"`).exec(tag)?.[1] ?? null;

function legalOf(block: string): LegalRead {
  const heading = need(block, "<h3>");
  const tag = first(heading, '<span class="tag">');
  const tagNote = first(block, '<p class="hint">');
  const facts = rowsOf(need(block, '<dl class="meta-row legal-facts">'));
  const anchor = first(block, "<a ");
  const details = first(block, FOLD);
  const fold = details === null ? null : foldOf(details);
  const missing = first(block, '<p class="none">');
  const mismatch = first(block, '<p class="notice notice-warn">');
  const name = anchor === null ? null : nameOf(anchor);
  return {
    label: plain(tag === null ? heading : heading.replace(tag, "")).trim(),
    tag: tag === null ? null : plain(tag),
    tagNote: tagNote === null ? null : plain(tagNote),
    facts: facts.map((row) => [row.label, row.value]),
    warned: facts.filter((row) => row.warn).map((row) => row.label),
    link:
      anchor === null || name === null
        ? null
        : {
            href: decodeEntities(attribute(anchor, "href") ?? ""),
            target: attribute(anchor, "target"),
            rel: attribute(anchor, "rel"),
            whose: name.whose,
            text: name.shown,
          },
    mismatch: mismatch === null ? null : plain(mismatch),
    statute: fold === null ? null : { open: fold.open, whose: fold.whose, summary: fold.summary, text: statuteOf(fold.body) },
    missing: missing === null ? null : plain(missing),
  };
}

/** 접어 둔 글 하나(판정자에게 묻는 글). 안에는 문단 하나가 있다. */
function askedOf(details: string): FoldRead {
  const fold = foldOf(details);
  if (!fold.body.startsWith("<p>") || !fold.body.endsWith("</p>")) throw new Error(`접어 둔 글의 모양이 다릅니다: ${fold.body.slice(0, 80)}`);
  return { open: fold.open, whose: fold.whose, summary: fold.summary, text: plain(fold.body) };
}

function alternativeOf(row: string): AlternativeRead {
  const says = need(row, '<td class="alt-says" role="cell">');
  const weak = first(says, '<p class="hint">');
  const asked = first(says, FOLD);
  return {
    id: plain(need(row, '<th scope="row" role="rowheader">')),
    kind: plain(need(row, '<td class="alt-kind" role="cell">')),
    weak: weak === null ? null : plain(weak),
    says: rowsOf(need(says, '<dl class="says">')).map((line) => [line.label, line.value]),
    asked: asked === null ? null : askedOf(asked),
  };
}

function ruleOf(section: string): RuleRead {
  const facts = rowsOf(need(section, '<dl class="facts">'));
  const [unit, conditions, applies] = facts;
  const list = first(conditions.html, '<ul class="conditions">');
  const asked = first(applies.html, FOLD);
  const table = need(section, '<table class="alts" role="table">');
  return {
    heading: plain(need(section, "<h3>")),
    factLabels: facts.map((row) => row.label),
    unit: unit.value,
    conditions:
      list === null
        ? []
        : elementsOf(list, "<li>").map((item) => [plain(need(item, "<code>")), plain(need(item, '<span class="none">'))]),
    noConditions: list === null ? conditions.value : null,
    applies: asked === null ? null : askedOf(asked),
    noApplies: asked === null ? applies.value : null,
    caption: plain(need(table, "<caption>")),
    columns: elementsOf(need(table, '<thead role="rowgroup">'), '<th scope="col" role="columnheader">').map(plain),
    alternatives: elementsOf(need(table, '<tbody role="rowgroup">'), '<tr role="row">').map(alternativeOf),
  };
}

/** 값과 글을 걷어 낸 뼈대의 한 줄. 같은 줄이 잇달아 나오면 한 번만 적는다(조문이 둘이어도, 규칙이 다섯이어도 틀은 같다). */
function frameOf(page: Omit<PolicyPageRead, "frame">): string[] {
  const lines = [
    `머리: ${[page.law !== null && "대표 조문", "제목", page.question !== null && "개발자에게 할 질문"].filter(Boolean).join(" · ")}`,
    `한눈에: ${page.facts.map(([label]) => label).join(" · ")}`,
    "한눈에 적은 값의 뜻",
    "구역: 근거 조문",
    ...(page.legalNote === null ? [] : ["원문과 날짜의 출처"]),
    ...page.legal.map((legal) => `조문: 이름 · ${legal.facts.map(([label]) => label).join(" · ")} · 조문 원문`),
    "구역: 규칙",
    ...(page.judge === null ? [] : ["판정자 알림"]),
    "규칙 읽는 법",
    ...page.rules.flatMap((rule) => [
      `규칙: 이름 · ${rule.factLabels.join(" · ")}`,
      `대안 표: ${rule.columns.join(" · ")}`,
      ...rule.alternatives.map((alt) => `대안: ${alt.says.map(([label]) => label).join(" · ")}`),
    ]),
    "면책",
  ];
  // 규칙마다 "규칙 → 대안 표 → 대안"이 되풀이된다. 이미 나온 줄은 다시 적지 않는다.
  return lines.filter((line, i) => lines.indexOf(line) === i);
}

const ARTICLE = '<article class="policy-page">';

/** 정책 쪽이 쓰는 요소. 이 밖의 요소(그리지 않는 template·dialog, 스스로 받아 오는 img·iframe 등)가 있으면 실패한다. */
const KNOWN_TAGS = new Set(
  "article header section div p h1 h2 h3 dl dt dd ul li strong code span a details summary pre table caption thead tbody tr th td".split(" "),
);

/**
 * 정책 쪽이 쓰는 속성. 이 밖의 속성이 있으면 실패한다: 요소를 가리는 것(hidden, style, aria-hidden, inert), 보이지 않는
 * 글을 싣는 것(title, aria-label, alt), 쪽 안의 자리가 되는 것(id).
 */
const KNOWN_ATTRIBUTES = new Set(["class", "href", "rel", "target", "open", "role", "scope"]);

/**
 * 쪽에 아는 요소와 속성만 있는지 본다. 글이 아닌 것으로 가리거나(속성, 그리지 않는 요소) 보이지 않는 글을 싣는 길을 막는다.
 * 읽기 전에 본다. 모르는 속성이 붙은 요소는 읽는 도구가 찾지 못해서, 먼저 보지 않으면 까닭이 "요소가 없다"로만 남는다.
 */
function assertKnownMarkup(article: string): void {
  for (const [tag, name, attributes] of article.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)((?:[\s/][^>]*)?)>/g)) {
    if (!KNOWN_TAGS.has(name)) throw new Error(`읽는 도구가 모르는 요소가 있습니다: ${tag.slice(0, 120)}`);
    for (const [, attribute] of attributes.matchAll(/\s([^\s="'<>/]+)(?:="[^"]*")?/g)) {
      if (!KNOWN_ATTRIBUTES.has(attribute)) throw new Error(`읽는 도구가 모르는 속성이 있습니다(${attribute}): ${tag.slice(0, 120)}`);
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
    page.law,
    page.title,
    page.question,
    ...page.facts.flat(),
    page.factsNote,
    page.sections[0],
    page.legalNote,
    page.noLegal,
    ...page.legal.flatMap((legal) => [
      legal.label,
      legal.tag,
      legal.tagNote,
      // 법제처 링크의 값에는 화면 낭독기용 앞말이 함께 읽혀 있다.
      ...legal.facts.flat(),
      legal.mismatch,
      ...fold(legal.statute),
      legal.missing,
    ]),
    page.sections[1],
    page.judge,
    page.legend.summary,
    ...page.legend.items,
    ...page.rules.flatMap((rule) => [
      rule.heading,
      rule.factLabels[0],
      rule.unit,
      rule.factLabels[1],
      ...rule.conditions.flat(),
      rule.noConditions,
      rule.factLabels[2],
      ...fold(rule.applies),
      rule.noApplies,
      rule.caption,
      ...rule.columns,
      ...rule.alternatives.flatMap((alt) => [alt.id, alt.kind, alt.weak, ...alt.says.flat(), ...fold(alt.asked)]),
    ]),
    page.disclaimer,
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
 * 차례가 바뀌어도 읽은 값은 그대로다. 정책마다 틀이 같다는 말은 읽은 값이 같다는 데서 그치지 않고 쪽에 그 밖의 것이
 * 없어야 성립한다.
 *
 * - 글: 읽은 조각을 틀의 차례로 이은 글이 쪽의 글 전체와 같다(빈칸은 빼고 견준다). 모르는 글이 있거나, 조각이 다른
 *   차례로 놓였거나, 같은 글이 두 번 적혔으면 어긋난다.
 * - 접어 둔 것(details)과 화면에서만 가린 글(.visually-hidden): 읽은 수만큼만 있다. 읽은 것을 한 번 더 감싸 접거나
 *   가리면 글과 차례는 그대로여서 글만 견주어서는 드러나지 않는다.
 *
 * 여기서 보는 것은 틀(article) 안이다. 틀 밖은 `readAround` 가 읽는다. CSS 가 가리거나 그린 것은 HTML 로는 알 수 없다.
 * 실제로 그려지는지, CSS 가 그린 글이 없는지는 브라우저 시험(tests/browser/policy.test.ts)이 본다.
 */
function assertAllRead(article: string, page: Omit<PolicyPageRead, "frame">): void {
  const folds: FoldRead[] = [
    ...page.legal.flatMap((legal) => legal.statute ?? []),
    ...page.rules.flatMap((rule) => [rule.applies ?? [], ...rule.alternatives.map((alt) => alt.asked ?? [])].flat()),
  ];
  // "규칙 읽는 법"까지 센다.
  const details = article.split("<details").length - 1;
  if (details !== folds.length + 1) throw new Error(`접어 둔 것이 읽은 것보다 많거나 적습니다: 쪽 ${details}개, 읽은 것 ${folds.length + 1}개`);
  const whose = [...page.legal.map((legal) => legal.link?.whose), ...folds.map((fold) => fold.whose)].filter((text) => typeof text === "string");
  const hidden = article.split("visually-hidden").length - 1;
  if (hidden !== whose.length) throw new Error(`화면에서만 가린 글이 읽은 것보다 많거나 적습니다: 쪽 ${hidden}곳, 읽은 것 ${whose.length}곳`);

  const parting = partingOf(squash(plain(article)), wholeText(page));
  if (parting === null) return;
  throw new Error(
    `쪽에 읽지 않은 글이 있거나 차례가 틀과 다릅니다. 어긋나기 시작한 곳(빈칸은 뺐다): 쪽 "${parting[0]}" / 읽은 것 "${parting[1]}"`,
  );
}

/**
 * 정책 한 쪽을 읽는다. 쪽 전체의 HTML 을 줘도 되고(빌드된 파일), 부품만 그려 낸 HTML 을 줘도 된다. 읽는 것은 틀(article)
 * 안이다. 틀에 모르는 요소나 속성이 있거나(`assertKnownMarkup`) 읽은 것이 틀의 전부가 아니면(`assertAllRead`) 실패한다.
 * 틀 밖은 읽지 않는다. 빌드된 쪽에서는 `readAround` 로 함께 읽는다.
 */
export function readPolicyPage(html: string): PolicyPageRead {
  const article = need(html, ARTICLE);
  assertKnownMarkup(article);
  const head = need(article, '<header class="policy-page-head">');
  const law = first(head, '<p class="law">');
  const question = first(head, '<p class="question">');
  const facts = need(article, '<div class="policy-facts">');
  const sections = elementsOf(article, '<section class="policy-section">');
  if (sections.length !== 2) throw new Error(`구역이 둘이 아닙니다: ${sections.length}`);
  const [legalSection, ruleSection] = sections;
  // 근거 조문 구역의 머리: 첫 조문 앞까지. 원문과 날짜의 출처, 또는 조문이 없다는 말이 여기에 있다.
  const firstLegal = legalSection.indexOf('<div class="legal">');
  const legalHead = firstLegal === -1 ? legalSection : legalSection.slice(0, firstLegal);
  const legalNote = first(legalHead, '<p class="hint">');
  const noLegal = first(legalHead, '<p class="none">');
  // 규칙 구역의 머리: 첫 규칙 앞까지. 판정자 알림과 "규칙 읽는 법"이 여기에 있다.
  const firstRule = ruleSection.indexOf('<section class="rule-doc">');
  const ruleHead = firstRule === -1 ? ruleSection : ruleSection.slice(0, firstRule);
  const judge = first(ruleHead, '<p class="notice">');
  const legend = foldOf(need(ruleHead, FOLD));
  const page = {
    law: law === null ? null : plain(law),
    title: plain(need(head, "<h1>")),
    question: question === null ? null : plain(question),
    facts: rowsOf(need(facts, '<dl class="meta-row">')).map((row): [string, string] => [row.label, row.value]),
    factsNote: plain(need(facts, '<p class="hint">')),
    sections: sections.map((section) => plain(need(section, "<h2>"))),
    legalNote: legalNote === null ? null : plain(legalNote),
    noLegal: noLegal === null ? null : plain(noLegal),
    legal: elementsOf(legalSection, '<div class="legal">').map(legalOf),
    judge: judge === null ? null : plain(judge),
    legend: { open: legend.open, summary: legend.summary, items: elementsOf(legend.body, "<li>").map(plain) },
    rules: elementsOf(ruleSection, '<section class="rule-doc">').map(ruleOf),
    disclaimer: plain(need(article, '<p class="disclaimer">')),
    hrefs: [...article.matchAll(/<a [^>]*href="([^"]*)"/g)].map((match) => decodeEntities(match[1])),
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
 * 빌드된 쪽 전체에서 틀(article)의 둘레를 읽는다. `readPolicyPage` 는 틀 안만 읽는다. 틀 밖에 글이나 요소가 더해지면, 한
 * 정책의 쪽에만 더해져도 읽은 값과 틀은 그대로다. 여기서 읽은 것이 비어 있고(본문 안) 정책마다 같아야(본문 밖) 틀 안에서
 * 읽은 것이 쪽의 전부다.
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
  "머리: 대표 조문 · 제목 · 개발자에게 할 질문",
  "한눈에: 근거 조문 · 규칙 · 판정 단위 · 재검토 기한 · 팩 · 팩 판",
  "한눈에 적은 값의 뜻",
  "구역: 근거 조문",
  "원문과 날짜의 출처",
  "조문: 이름 · 시행일 · 원문을 받은 날 · 원문 해시 · 법제처 링크 · 조문 원문",
  "구역: 규칙",
  "판정자 알림",
  "규칙 읽는 법",
  "규칙: 이름 · 판정 단위 · 적용 조건 · 적용 질문",
  "대안 표: 대안 · 종류와 세기 · 확인되지 않았을 때 하는 말",
  "대안: 알리는 말 · 질문 · 고치는 법",
  "면책",
];

// 아래는 기대값이다. 화면의 글을 시험에 따로 적어 둔다. 소스의 글(src/lib/pack/guide.ts)을 가져다 견주면 글을 바꿔도
// 시험이 따라 바뀌어 아무것도 잡지 못한다.

export const NOT_IN_PACK = "팩에 실려 있지 않습니다.";
export const UNDESCRIBED = "팩이 아직 알려 주지 않습니다.";
export const NO_TEXT = "원문이 실려 있지 않습니다.";
export const ASKED = "판정자에게 묻는 글";
export const WEAK = "약한 대안은 참이어도 혼자서는 경고를 풀지 못합니다.";
export const JUDGE_ON = "판정자를 켠 검사에서만 묻습니다.";
export const CODE_LEAVES = "판정자를 켜면 판정 대상 코드가 외부 API 로 나갑니다.";
export const LEGAL_NOTE = "원문과 날짜는 팩에 실린 그대로입니다. 시행일이 어느 판본의 날짜인지는 팩이 아직 알려 주지 않습니다.";
export const PRIMARY_NOTE = "결과에는 이 조문의 이름이 적힙니다.";
export const MADE_WITH = "이 페이지는 위에 적은 팩 판으로 만들었습니다.";
export const DIGEST_NOTE = "결과의 ‘팩 판’이 이와 같으면 같은 판의 팩으로 만든 결과입니다.";
const NO_ID = "(id 없음)";
const ORDINAL = ["첫째", "둘째", "셋째", "넷째", "다섯째"];
const ordinal = (index: number) => ORDINAL[index] ?? `${index + 1}번째`;

const unitOf = (scope: string) => (scope === "file" ? "파일" : scope === "anchor" ? "함수" : scope);

/** 대안의 종류와 세기. 팩의 값을 옮긴 것이다. 모르는 값은 팩에 적힌 그대로다. */
function kindOf(alt: PolicyMeta["rules"][number]["alternatives"][number]): string {
  if (alt.kind === "ai") {
    if (alt.evidence === "required" || alt.evidence === "strict") return "AI · 코드 인용 필요";
    return alt.evidence === null ? "AI" : `AI · 인용 조건 ${alt.evidence}`;
  }
  if (alt.strength === null) return "정적";
  return alt.strength === "strong" ? "정적 · 강한" : alt.strength === "weak" ? "정적 · 약한" : `정적 · ${alt.strength}`;
}

/**
 * 정책 하나가 쪽에서 어떻게 읽혀야 하는지. 팩 메타데이터의 값에서 만든다. 팩에 실린 정책에도, 시험이 손으로 고친
 * 정책(값이 빠졌거나 모르는 값이 든 것)에도 쓴다.
 */
export function expectedPolicyPage(policy: PolicyMeta, pack: PackMeta["pack"]): Omit<PolicyPageRead, "frame"> {
  const units = [...new Set(policy.rules.map((rule) => unitOf(rule.scope)))];
  const ai = policy.rules.some((rule) => rule.alternatives.some((alt) => alt.kind === "ai"));
  const applies = policy.rules.some((rule) => Boolean(rule.applies_question));
  const asked = [ai && "AI 대안", applies && "적용 질문"].filter(Boolean).join("과 ");
  return {
    law: policy.legal[0]?.label ?? null,
    title: policy.title,
    question: policy.ask_developer === null ? null : `개발자에게 할 질문: ${policy.ask_developer}`,
    facts: [
      ["근거 조문", `${policy.legal.length}개`],
      ["규칙", `${policy.rules.length}개`],
      ["판정 단위", units.length > 0 ? units.join(", ") : NOT_IN_PACK],
      ["재검토 기한", policy.review_by ?? NOT_IN_PACK],
      ["팩", pack.id ?? NOT_IN_PACK],
      ["팩 판", pack.digest],
    ],
    factsNote:
      `${MADE_WITH} ${DIGEST_NOTE}` +
      (policy.review_by === null ? "" : ` 재검토 기한이 지나면 ${SITE.cli} validate 가 경고합니다.`),
    sections: [`근거 조문 ${policy.legal.length}개`, `규칙 ${policy.rules.length}개`],
    legalNote: policy.legal.length > 0 ? LEGAL_NOTE : null,
    noLegal: policy.legal.length > 0 ? null : "팩에 근거 조문이 실려 있지 않습니다.",
    legal: policy.legal.map((legal, i) => {
      // 빈 글도 원문이 없는 것으로 친다.
      const text = legal.text || null;
      const same = text === null ? -1 : policy.legal.slice(0, i).findIndex((earlier) => earlier.text === text);
      const hash =
        legal.text_sha256_matches === true
          ? "팩에 적힌 것과 같음"
          : legal.text_sha256_matches === false
            ? "팩에 적힌 것과 다름"
            : text === null
              ? "원문이 없어 견주지 못함"
              : legal.text_sha256 === null
                ? "팩에 해시가 적혀 있지 않음"
                : "견주지 못함";
      return {
        label: legal.label,
        // 대표 조문은 팩의 첫 조문이다. 표시의 뜻은 이름 바로 아래에 보이는 글로 적는다.
        tag: i === 0 ? "대표 조문" : null,
        tagNote: i === 0 ? PRIMARY_NOTE : null,
        facts: [
          ["시행일", legal.effective_from ?? NOT_IN_PACK],
          ["원문을 받은 날", legal.text_retrieved ?? NOT_IN_PACK],
          ["원문 해시", hash],
          ["법제처 링크", legal.url === null ? NOT_IN_PACK : `${legal.label} 새 창에서 열기`],
        ],
        warned: legal.text_sha256_matches === true ? [] : ["원문 해시"],
        // 눈에는 "새 창에서 열기"만 보이고, 화면 낭독기에는 어느 조문의 링크인지 함께 읽힌다.
        link: legal.url === null ? null : { href: legal.url, target: "_blank", rel: "noopener noreferrer", whose: legal.label, text: "새 창에서 열기" },
        mismatch: text !== null && legal.text_sha256_matches === false ? "아래 원문은 팩에 적힌 해시와 맞지 않습니다." : null,
        statute:
          text === null
            ? null
            : {
                // 대표 조문의 원문만 펼쳐 둔다.
                open: i === 0,
                whose: legal.label,
                summary: same === -1 ? "조문 원문" : `조문 원문 위 ${ordinal(same)} 조문과 원문이 같습니다`,
                text,
              },
        missing: text === null ? NO_TEXT : null,
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
    rules: policy.rules.map((rule) => ({
      heading: `규칙 ${rule.id ?? NO_ID}`,
      factLabels: ["판정 단위", "적용 조건", "적용 질문"],
      unit: unitOf(rule.scope),
      conditions: rule.applies_when.map((id): [string, string] => [id ?? NO_ID, UNDESCRIBED]),
      noConditions: rule.applies_when.length === 0 ? "이 규칙에는 적용 조건이 없습니다." : null,
      // 한 쪽에 "판정자에게 묻는 글"이 여럿이다. 화면 낭독기에는 어느 규칙·대안의 것인지 함께 읽힌다.
      applies: rule.applies_question ? { open: false, whose: `${rule.id ?? NO_ID} 적용 질문`, summary: ASKED, text: rule.applies_question } : null,
      noApplies: rule.applies_question ? null : "이 규칙에는 적용 질문이 없습니다.",
      caption: `적법한 대안 ${rule.alternatives.length}개`,
      columns: ["대안", "종류와 세기", "확인되지 않았을 때 하는 말"],
      alternatives: rule.alternatives.map((alt) => ({
        id: alt.id ?? NO_ID,
        kind: kindOf(alt),
        weak: alt.kind === "static" && alt.strength === "weak" ? WEAK : null,
        says: [
          ["알리는 말", alt.message ?? NOT_IN_PACK],
          ["질문", alt.ask_developer ?? NOT_IN_PACK],
          ["고치는 법", alt.remediation ?? NOT_IN_PACK],
        ],
        asked: alt.question ? { open: false, whose: `${rule.id ?? NO_ID} 대안 ${alt.id ?? NO_ID}`, summary: ASKED, text: alt.question } : null,
      })),
    })),
    disclaimer: SITE.disclaimer,
    hrefs: policy.legal.flatMap((legal) => legal.url ?? []),
  };
}
