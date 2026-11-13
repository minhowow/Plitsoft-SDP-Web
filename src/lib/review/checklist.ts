import { REVIEW_GOODS_LABEL, REVIEW_RECHECK_LABEL, REVIEW_STATUS_LABEL } from "@/lib/report/status";
import { SITE } from "@/lib/site";
import { REVIEW_STATUSES, type Review, type ReviewItem, type ReviewStatus } from "./index";
import { CHECKS, firstSentence, gateText, notAnsweredText, SANCTION } from "./text";

/**
 * 의무 체크리스트 내보내기(2026-11-13 오너 지시): 결과 쪽의 체크리스트를 마크다운 파일로 받고, 인쇄용 보기로 본다. 둘은 이 파일의
 * `checklistDoc` 한 모양에서 나온다. 화면(`components/review/ReviewView.tsx`)과 같은 차례·같은 말이다: 갈래 차례(코드에서 본 것은
 * 결과의 요약이 고른 것 먼저), 묻지 않은 품목 의무는 '해당 여부부터' 뒤에 한 묶음, 다시 검토 중인 의무는 맨 끝에 이름만. 인용은
 * 도구가 코드에서 확인한 것(`ok`)만, 처분의 말이 든 의무 한 줄은 싣지 않는다(docs/commitments.md 1장). 종이·파일에는 접을 곳이
 * 없으므로 화면에서 접어 둔 것(나머지 갈래, 찾아본 말, 자세히)도 모두 펼쳐 싣는다.
 */

export interface ChecklistCite {
  file: string;
  line: number | null;
  text: string;
}

export interface ChecklistEntry {
  duty: string;
  /** 법과 조문. */
  law: string;
  url: string | null;
  /** 의무 한 줄(처분의 말이 들면 빈 글). */
  dutyText: string;
  /** 무엇을 봤는지 한 문장(관문이 답을 바꿨으면 그 까닭). 다시 검토 중·묻지 않은 품목이면 빈 글. */
  seen: string;
  /** 걸리는 조건은 있는데 찾지 못한 지킨 처리(확인할 것 세 갈래에만). */
  missing: string;
  cites: ChecklistCite[];
  /** 기능이 있다는 프로필 신호의 파일. */
  signals: ChecklistCite[];
  question: string;
  notAnswered: string | null;
  searches: { pattern: string; path: string; found: number | null; claimed: number | null }[];
  /** 모델의 말 가운데 첫 문장 뒤의 것. */
  rest: string;
  overturned: boolean;
}

export interface ChecklistGroup {
  key: ReviewStatus | "goods" | "recheck";
  label: string;
  /** 사람이 확인할 줄인지(확인할 것 세 갈래와 묻지 않은 품목). 마크다운은 이 줄들을 할 일 칸(`- [ ]`)으로 적는다. */
  todo: boolean;
  entries: ChecklistEntry[];
}

export interface ChecklistDoc {
  overview: { features: number; obligations: number; check: number };
  groups: ChecklistGroup[];
  run: Review["run"];
}

/** 결과 하나의 사실(내보낸 파일의 머리에 적는다). 무엇을 적는지는 부르는 쪽(분석 쪽, 사례 쪽)이 정한다. */
export interface ChecklistSource {
  /** owner/name. */
  repo: string;
  /** GitHub 저장소 주소. 합성이면 null. */
  htmlUrl: string | null;
  commit: string;
  /** "분석 abc · 2026-11-13 14:03 KST" 나 "미리 돌린 결과 2026-11-12" 같은 사실 줄. */
  facts: string[];
}

const where = (cite: ChecklistCite) => (cite.line === null ? cite.file : `${cite.file}:${cite.line}`);

function entryOf(item: ReviewItem, held = false): ChecklistEntry {
  const gate = gateText(item);
  const [seen, rest] = held ? ["", ""] : gate ? [gate, item.reason] : firstSentence(item.reason);
  const ok = item.citations.filter((cite) => cite.ok);
  const cite = (c: { file: string; line: number | null; text: string }) => ({ file: c.file, line: c.line, text: c.text.trim() });
  return {
    duty: item.duty,
    law: `${item.law} ${item.article}`.trim(),
    url: item.url,
    dutyText: item.dutyText && !SANCTION.test(item.dutyText) ? item.dutyText : "",
    seen,
    missing: !held && CHECKS.includes(item.status) ? item.missing : "",
    cites: held ? [] : ok.filter((c) => c.why !== "profile").map(cite),
    signals: held ? [] : ok.filter((c) => c.why === "profile").map(cite),
    question: item.question,
    notAnswered: held ? null : notAnsweredText(item),
    searches: held ? [] : item.searches.map(({ pattern, path, found, claimed }) => ({ pattern, path, found, claimed })),
    rest,
    overturned: !held && item.verification === "overturned",
  };
}

/** 체크리스트를 내보낼 모양으로. `recheck` 는 사람이 짚어 상태를 싣지 않는 의무(사례 쪽). */
export function checklistDoc(review: Review, recheck: readonly string[] = []): ChecklistDoc {
  const items = review.checklist.filter((item) => !recheck.includes(item.duty));
  const held = review.checklist.filter((item) => recheck.includes(item.duty));
  const goods = items.filter((item) => item.group === "goods");
  const by = (status: ReviewStatus) => items.filter((item) => item.status === status && item.group !== "goods");
  const seen = by("seen-in-code");
  const top = review.summary.top.flatMap((duty) => seen.filter((item) => item.duty === duty));
  const groups: ChecklistGroup[] = [];
  for (const status of REVIEW_STATUSES) {
    const list = status === "seen-in-code" ? [...top, ...seen.filter((item) => !top.includes(item))] : by(status);
    if (list.length > 0) groups.push({ key: status, label: REVIEW_STATUS_LABEL[status], todo: CHECKS.includes(status), entries: list.map((item) => entryOf(item)) });
    if (status === "check-applicability" && goods.length > 0) {
      groups.push({ key: "goods", label: REVIEW_GOODS_LABEL, todo: true, entries: goods.map((item) => ({ ...entryOf(item, true), question: item.question })) });
    }
  }
  if (held.length > 0) groups.push({ key: "recheck", label: REVIEW_RECHECK_LABEL, todo: false, entries: held.map((item) => entryOf(item, true)) });
  return {
    overview: {
      features: review.profile.features.filter((feature) => feature.removed === null).length,
      obligations: review.obligations.listed,
      check: items.filter((item) => CHECKS.includes(item.status) && item.group !== "goods").length,
    },
    groups,
    run: review.run,
  };
}

/** 검증 정보의 줄(이름, 값). 화면의 검증 정보와 같은 수다. */
export function verificationRows(run: Review["run"]): [string, string][] {
  const sum = (record: Record<string, number>) => Object.values(record).reduce((a, b) => a + b, 0);
  const v = run.verificationCounts;
  const notAsked = sum(run.notAsked);
  return [
    ["인용", `${run.citations}개 · 검사기가 거절 ${run.citationsRejected}개`],
    ["부재 검색", `${run.searches}개 · 건수가 맞지 않음 ${run.searchesRejected}개`],
    ["반박", `유지 ${v.upheld ?? 0} · 뒤집음 ${v.overturned ?? 0}${v["overturn-ungrounded"] ? ` · 근거 없는 뒤집기 거절 ${v["overturn-ungrounded"]}` : ""}`],
    ["가린 비밀값", `${sum(run.masked)}개`],
    ...(notAsked > 0 ? [["묻지 않은 의무", `${notAsked}개`] as [string, string]] : []),
    ["모델", `조사 ${run.models.investigate} · 반박 ${run.models.verify}`],
    ["비용 어림", `$${run.usdEstimate.toFixed(2)}${run.limits ? ` (상한 $${run.limits.usd})` : ""}`],
    ["시간", `${Math.round(run.seconds)}초${run.limits ? ` (상한 ${Math.round(run.limits.seconds)}초)` : ""}`],
  ];
}

/** 마크다운 글로 옮길 때 서식으로 읽히는 글자를 막는다. */
const md = (text: string) => text.replace(/([\\`*_[\]<>#|])/g, "\\$1").replace(/\s*\n\s*/g, " ");
/** 코드 조각. 글에 역따옴표가 있으면 두 개로 감싼다. */
const code = (text: string) => (text.includes("`") ? `\`\` ${text} \`\`` : `\`${text}\``);

/** 파일 이름(영문·숫자·붙임표만): checklist-owner-name-커밋7자리.md */
export function checklistFileName(source: ChecklistSource): string {
  return `checklist-${source.repo.replace("/", "-")}-${source.commit.slice(0, 7)}.md`.replace(/[^A-Za-z0-9._-]/g, "-");
}

/** 마크다운 파일. 맨 위에 법률 자문도 인증도 아니라는 말(조문별 검사 기록과 같다), 저장소·커밋·사실 줄, 요약, 갈래마다의 의무. */
export function checklistMarkdown(doc: ChecklistDoc, source: ChecklistSource): string {
  const out: string[] = [];
  out.push(`# 의무 체크리스트 · ${md(source.repo)}`, "");
  out.push(`> **${SITE.record.lead}** ${SITE.record.rest}`, "");
  out.push(`- 저장소: ${source.htmlUrl ?? md(source.repo)} · 커밋 ${code(source.commit.slice(0, 7))}`);
  for (const fact of source.facts) out.push(`- ${md(fact)}`);
  out.push(`- 만든 곳: ${md(SITE.name)}`);
  out.push(`- 요약: 감지된 기능 ${doc.overview.features}가지 · 걸릴 수 있는 의무 ${doc.overview.obligations}개 · 확인할 것 ${doc.overview.check}건`);
  out.push("- 인용은 도구가 그 파일에서 글자 그대로 확인한 줄만 실었습니다.", "");
  for (const group of doc.groups) {
    out.push(`## ${md(group.label)} ${group.entries.length}건`, "");
    for (const entry of group.entries) {
      out.push(`${group.todo ? "- [ ]" : "-"} **${md(entry.law)}**${entry.overturned ? " (반박이 바꿈)" : ""}`);
      const sub = (line: string) => out.push(`  - ${line}`);
      if (entry.dutyText) sub(`의무: ${md(entry.dutyText)}`);
      if (entry.seen) sub(`본 것: ${md(entry.seen)}`);
      if (entry.missing) sub(`없는 것: ${md(entry.missing)}`);
      for (const cite of entry.cites) sub(`인용: ${code(where(cite))} ${code(cite.text)}`);
      if (entry.signals.length > 0) sub(`기능 신호: ${entry.signals.map((cite) => code(where(cite))).join(", ")}`);
      if (entry.question) sub(`질문: ${md(entry.question)}`);
      if (entry.notAnswered) sub(md(entry.notAnswered));
      for (const s of entry.searches) {
        const found = s.found === null ? "모름" : `${s.found}줄`;
        const claimed = s.claimed !== null && s.claimed !== s.found ? ` · AI 가 적은 수 ${s.claimed}줄` : "";
        sub(`찾아본 말: ${code(s.pattern)} (${md(s.path || ".")}) 다시 센 줄 ${found}${claimed}`);
      }
      if (entry.rest) sub(`자세히: ${md(entry.rest)}`);
      if (entry.url) sub(`법제처: ${entry.url}`);
    }
    out.push("");
  }
  out.push("## 검증 정보", "");
  for (const [name, value] of verificationRows(doc.run)) out.push(`- ${name}: ${md(value)}`);
  out.push("");
  return out.join("\n");
}
