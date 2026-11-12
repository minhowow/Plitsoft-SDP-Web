/**
 * `policypack review <저장소>` 의 결과(2판, CLI e12e6ba 부터. 스키마 contract/schema/review.cli-2.schema.json). 한 JSON 에 프로필(규칙
 * 신호와 AI 가 인용과 함께 보태거나 뺀 기능, 서비스 설명, 플랫폼), 개인정보 흐름(마디·화살표와 인용), 걸릴 수 있는 의무, 의무
 * 체크리스트, 실행 정보가 있다(2026-11-11 오너 지시로 화면을 만든다).
 *
 * 화면이 쓰는 필드만 읽는다. 판이 2 가 아니거나 화면이 쓰는 필드의 모양이 다르면 읽지 않는다(null). 인용은 관문을 통과한 것
 * (`ok`)만 화면에 보인다. 체크리스트 항목의 `title` 에는 처분 액수가 덧붙은 것이 있어 쓰지 않고 `duty_text`(의무 한 줄)를 쓴다.
 * `quote`(조문 인용)는 이 사이트가 조문 원문을 팩 메타데이터에서만 싣기로 했으므로 읽지 않는다(CLAUDE.md).
 */

/** 체크리스트의 상태. 갈래 이름은 `src/lib/report/status.ts` 의 `REVIEW_STATUS_LABEL`. */
export const REVIEW_STATUSES = [
  "seen-in-code",
  "check-outside",
  "check-applicability",
  "unknown",
  "evidence-found",
  "likely-not-applicable",
  "not-applicable",
] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/**
 * 모델이 댄 인용과 관문의 결과. `ok` 면 줄은 관문이 코드에서 다시 구한 줄이다. `why` 가 `profile` 이면 모델의 인용이 아니라 기능이
 * 있다는 프로필 신호다(CLI f4967db 부터. 줄 번호와 글이 빈 것이 있다).
 */
export interface ReviewCitation {
  file: string;
  line: number | null;
  text: string;
  ok: boolean;
  why: string;
}

/** 부재 주장의 검색: 관문이 저장소에서 다시 돌린 줄 수(`found`)가 모델이 적은 수(`claimed`)와 같으면 `ok`. */
export interface ReviewSearch {
  pattern: string;
  path: string;
  claimed: number | null;
  found: number | null;
  ok: boolean;
}

export interface ReviewEvidence {
  file: string;
  line: number | null;
  what: string;
}

export interface ReviewFeature {
  id: string;
  name: string;
  /** signal(규칙 신호) · model(이해 단계가 인용과 함께 더함) · static(내장 팩 정적 검사). */
  sources: string[];
  evidence: ReviewEvidence[];
  evidenceTotal: number;
  modelCitations: ReviewCitation[];
  modelReason: string | null;
  /** 이해 단계가 인용과 함께 뺀 기능이면 그 까닭과 인용. */
  removed: { reason: string; citations: ReviewCitation[] } | null;
}

export type FlowKind = "input" | "server" | "store" | "external";

export interface FlowNode {
  id: string;
  kind: FlowKind;
  label: string;
  data: string[];
  citations: ReviewCitation[];
}

export interface FlowEdge {
  from: string;
  to: string;
  data: string[];
  citations: ReviewCitation[];
}

export interface ReviewItem {
  duty: string;
  feature: string;
  law: string;
  article: string;
  /** 의무 한 줄. */
  dutyText: string;
  url: string | null;
  status: ReviewStatus;
  citations: ReviewCitation[];
  searches: ReviewSearch[];
  question: string;
  reason: string;
  /** 묻지 않았거나 답을 받지 못한 까닭(있을 때만). */
  notAnswered: string | null;
  /** 반박 검증의 결과(upheld · overturned · overturn-ungrounded · not-run). */
  verification: string;
  /** 걸리는 조건은 있는데 찾지 못한 지킨 처리(CLI f4967db 부터, 없으면 빈 글). */
  missing: string;
  /** 한 줄로 묶어 보일 묶음(`goods`: 품목 신호가 없어 묻지 않은 품목 의무). 없으면 null. */
  group: string | null;
  /**
   * 관문이 모델의 답을 바꾼 까닭(`first.gate.why`: condition-present · no-condition · name-or-default). CLI 는 그 메모를 `reason`
   * 앞에 붙인다. 읽을 때 그 앞머리를 떼고(`reason` 은 모델의 말만), 화면은 까닭을 이 사이트의 상태 이름으로 적는다.
   */
  gate: string | null;
}

export interface Review {
  summary: { counts: Partial<Record<ReviewStatus, number>>; top: string[] };
  profile: {
    commit: string | null;
    platforms: string[];
    summary: string;
    features: ReviewFeature[];
    files: { service: number; testOrConfig: number } | null;
  };
  flow: { nodes: FlowNode[]; edges: FlowEdge[] };
  /** 걸릴 수 있는 의무의 수(목록 층)와 지위로만 걸리는 의무의 수. */
  obligations: { listed: number; statusOnly: number };
  checklist: ReviewItem[];
  run: {
    models: { investigate: string; verify: string };
    seconds: number;
    usdEstimate: number;
    limits: { usd: number; seconds: number } | null;
    citations: number;
    citationsRejected: number;
    searches: number;
    searchesRejected: number;
    verificationCounts: Record<string, number>;
    masked: Record<string, number>;
    notAsked: Record<string, number>;
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const counts = (v: unknown): Record<string, number> =>
  isObj(v) ? Object.fromEntries(Object.entries(v).filter((e): e is [string, number] => num(e[1]) !== null)) : {};

function citationsOf(v: unknown): ReviewCitation[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((c) =>
    isObj(c) && str(c.file) !== null && str(c.text) !== null
      ? [{ file: c.file as string, line: num(c.line), text: c.text as string, ok: c.ok === true, why: str(c.why) ?? "" }]
      : [],
  );
}

function searchesOf(v: unknown): ReviewSearch[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((s) =>
    isObj(s) && str(s.pattern) !== null
      ? [{ pattern: s.pattern as string, path: str(s.path) ?? "", claimed: num(s.claimed), found: num(s.found), ok: s.ok === true }]
      : [],
  );
}

const isStatus = (v: unknown): v is ReviewStatus => typeof v === "string" && (REVIEW_STATUSES as readonly string[]).includes(v);
const KINDS: readonly string[] = ["input", "server", "store", "external"];

/** review 결과 JSON 을 읽는다. 판이 2 가 아니거나 화면이 쓰는 필드의 모양이 다르면 null. */
export function parseReview(data: unknown): Review | null {
  if (!isObj(data) || data.review_version !== 2) return null;
  const { summary, profile, data_flow: flow, obligations, checklist, run } = data;
  if (!isObj(summary) || !isObj(profile) || !isObj(flow) || !isObj(obligations) || !Array.isArray(checklist) || !isObj(run)) return null;
  if (!Array.isArray(profile.features) || !Array.isArray(flow.nodes) || !Array.isArray(flow.edges)) return null;

  const features: ReviewFeature[] = [];
  for (const f of profile.features) {
    if (!isObj(f) || str(f.id) === null || str(f.name) === null) return null;
    const evidence = (Array.isArray(f.evidence) ? f.evidence : []).flatMap((e) =>
      isObj(e) && str(e.file) !== null ? [{ file: e.file as string, line: num(e.line), what: str(e.what) ?? "" }] : [],
    );
    const removed = isObj(f.removed) ? { reason: str(f.removed.reason) ?? "", citations: citationsOf(f.removed.citations) } : null;
    features.push({
      id: f.id as string,
      name: f.name as string,
      sources: strs(f.sources),
      evidence,
      evidenceTotal: num(f.evidence_total) ?? evidence.length,
      modelCitations: citationsOf(f.model_citations),
      modelReason: str(f.model_reason),
      removed,
    });
  }

  const nodes: FlowNode[] = [];
  for (const n of flow.nodes) {
    if (!isObj(n) || str(n.id) === null || str(n.label) === null || !KINDS.includes(n.kind as string)) return null;
    nodes.push({ id: n.id as string, kind: n.kind as FlowKind, label: n.label as string, data: strs(n.data), citations: citationsOf(n.citations) });
  }
  const ids = new Set(nodes.map((n) => n.id));
  const edges: FlowEdge[] = [];
  for (const e of flow.edges) {
    if (!isObj(e) || str(e.from) === null || str(e.to) === null) return null;
    // 마디 목록에 없는 끝을 가리키는 화살표는 그리지 않는다(어디로 잇는지 모른다).
    if (!ids.has(e.from as string) || !ids.has(e.to as string)) continue;
    edges.push({ from: e.from as string, to: e.to as string, data: strs(e.data), citations: citationsOf(e.citations) });
  }

  const items: ReviewItem[] = [];
  for (const it of checklist) {
    if (!isObj(it) || str(it.duty) === null || !isStatus(it.status)) return null;
    const gate = isObj(it.first) && isObj(it.first.gate) ? it.first.gate : null;
    const note = gate ? (str(gate.note) ?? "") : "";
    const reason = str(it.reason) ?? "";
    // 메모가 앞에 붙은 reason(조사 답을 그대로 받은 항목)일 때만 관문의 까닭을 둔다. 반박이 바꾼 항목의 reason 은 반박의 말이다.
    const gated = gate !== null && note !== "" && reason.startsWith(note);
    items.push({
      duty: it.duty as string,
      feature: str(it.feature) ?? "",
      law: str(it.law) ?? "",
      article: str(it.article) ?? "",
      dutyText: str(it.duty_text) ?? "",
      url: str(it.url),
      status: it.status,
      citations: citationsOf(it.citations),
      searches: searchesOf(it.searches),
      question: str(it.question) ?? "",
      reason: gated ? reason.slice(note.length).trim() : reason,
      notAnswered: str(it.not_answered),
      verification: isObj(it.verification) ? (str(it.verification.result) ?? "") : "",
      missing: str(it.missing)?.trim() ?? "",
      group: str(it.group),
      gate: gated ? (str(gate.why) ?? null) : null,
    });
  }

  const models = isObj(run.models) ? run.models : {};
  const limits = isObj(run.limits) && num(run.limits.usd) !== null && num(run.limits.seconds) !== null ? { usd: run.limits.usd as number, seconds: run.limits.seconds as number } : null;
  const files = isObj(profile.files) && num(profile.files.service) !== null && num(profile.files.test_or_config) !== null
    ? { service: profile.files.service as number, testOrConfig: profile.files.test_or_config as number }
    : null;
  return {
    summary: { counts: counts(summary.counts) as Partial<Record<ReviewStatus, number>>, top: strs(summary.top) },
    profile: { commit: str(profile.commit), platforms: strs(profile.platforms), summary: str(profile.summary) ?? "", features, files },
    flow: { nodes, edges },
    obligations: { listed: Array.isArray(obligations.listed) ? obligations.listed.length : 0, statusOnly: num(obligations.status_only) ?? 0 },
    checklist: items,
    run: {
      models: { investigate: str(models.investigate) ?? "", verify: str(models.verify) ?? "" },
      seconds: num(run.seconds) ?? 0,
      usdEstimate: num(run.usd_estimate) ?? 0,
      limits,
      citations: num(run.citations) ?? 0,
      citationsRejected: num(run.citations_rejected) ?? 0,
      searches: num(run.searches) ?? 0,
      searchesRejected: num(run.searches_rejected) ?? 0,
      verificationCounts: counts(run.verification_counts),
      masked: counts(run.masked),
      notAsked: counts(run.not_asked),
    },
  };
}

/** review 결과 JSON 글을 읽는다(DB·실행기 콜백에 글로 실린다). 읽지 못하면 null. */
export function parseReviewText(text: string | null | undefined): Review | null {
  if (!text) return null;
  try {
    return parseReview(JSON.parse(text));
  } catch {
    return null;
  }
}
