import { EFFECTIVE_FROM_NOTE } from "@/lib/pack/guide";
import type { PackIndex } from "@/lib/pack/types";
import { SITE } from "@/lib/site";
import { coverageSummary, GAP_LABEL, SARIF_COUNTS_NOTE, type CoverageSummary, type GapFile } from "./coverage";
import { LINE_IS_FIRST, SARIF_LINE_ONE, scopeLabel } from "./scope";
import { NOT_REPORTED_NOR_CLEARED, STATUS_LABEL, STATUS_LEGEND, STATUS_ORDER, type Status } from "./status";
import type { Contract } from "./types";
import { CONTRACT_LABEL, type LocationView, type PolicyView, type ReportView } from "./view-model";

/**
 * 조문별 검사 기록(인쇄용)에 적는 것. 연 결과 하나를 한 장으로 옮긴다. 그리는 것은 `components/result/Record.tsx` 다.
 *
 * 싣는 것: 검사 정보(도구·엔진·판정자·팩 판·출력 형식, 검사한 파일 수와 판정 단위 수), 다 보지 못한 것(세 목록과 엔진
 * 오류의 수), 상태별 발견 수, 정책마다 대표 조문과 그 시행일·원문 해시, 발견마다 자리와 지문, AI 가 푼 경고와 AI 의
 * 답으로 빠진 판정.
 *
 * 싣지 않는 것: 코드와, 코드가 섞일 수 있는 글. 이 파일의 타입에는 그런 글이 들어갈 자리가 없다.
 * - AI 가 인용한 줄(`ai_cleared[].alternatives[].cite`). 코드다.
 * - 판정 경로(`decision_path`). CLI 가 남긴 문장이지만 AI 가 인용한 줄이 섞일 수 있다. 인용을 받아들이지 않은 대안의
 *   문장에 CLI 가 그 인용을 앞 120자까지 따옴표 안에 적는다(CLI 소스 `evaluate/engine.py` 의 evaluate).
 * - 적용 질문과 그 답(`ai_dismissed[].question`, `answer`). 질문은 팩의 글이고 답은 CLI 가 정해 둔 네 값 가운데
 *   하나라서(CLI 소스 `judge/base.py` 의 RawAnswer. 빠진 판정에서는 '아니오'다) 코드가 아니다. 그래도 옮기지 않는다.
 *   기록에는 빠진 판정의 자리와 수만 적는다. 답이 '아니오'였다는 것은 표의 이름이 말하고, 이 사이트의 파서는 두 필드의
 *   모양을 보지 않는다(손으로 고친 파일에는 무엇이든 들 수 있다).
 * - 엔진 오류 문장(`run.engine_errors`). 경로와 코드 조각이 들 수 있다. 수만 적는다.
 * - 발견에 실린 정책의 제목(`findings[].title`). 파서가 글자인지만 보는 글이다. 팩의 제목을 적는다.
 *
 * 파일 경로, 줄 번호, 규칙 id, 대안 id, 지문은 코드가 아니므로 싣는다. 지문은 줄 둘레의 코드로 만든 해시이고(CLI 소스
 * `report/fingerprint.py`) 코드 자체는 아니다. 이 값들은 연 파일에 적힌 글자 그대로다. 모양을 볼 수 있는 것은 보고 옮긴다
 * (AI 의 기록의 줄 번호는 정수일 때만, 커밋은 해시의 모양일 때만. `view-model.ts`).
 *
 * 결과에 없는 것은 지어내지 않고 없다고 적는다. 검사한 범위와 검사한 날은 어느 출력에도 없다(`docs/cli-requests.md` 의
 * R14, R7). 기록을 만든 시각도 적지 않는다. 검사한 날처럼 읽힌다. 이 파일은 시계를 읽지 않는다.
 *
 * 수는 세기만 한다. 합쳐서 점수나 비율로 바꾸지 않는다(`docs/commitments.md` 의 1).
 */

/** 결과에 없는 값의 자리에 적는 말. */
export const NOT_IN_RESULT = "결과에 실려 있지 않음";

/** 팩에 없는 값(대표 조문, 시행일, 원문 해시)의 자리에 적는 말. */
export const NOT_IN_PACK = "팩에 실려 있지 않음";

/** 출력 형식 때문에 알 수 없는 수(SARIF 의 파일 수와 판정 단위 수)의 자리에 적는 말. */
const UNKNOWN = "알 수 없음";

/** SARIF 가 채운 1행일 수 있는 줄 옆에 적는 말(`RecordFinding.lineUnsure`). 표 위의 말이 이 이름으로 가리킨다. */
export const LINE_UNSURE = "1행인지 알 수 없음";

/**
 * 발견 표 위에 적는 말의 끝 문장. "지문"이라는 말은 결과 화면에 없고 기록에서 처음 나온다. 무엇에 쓰는 값인지는 CLI 가
 * 알려 주지 않는다(README 에 없다). 그래서 어디서 온 값인지만 적는다. 결과 JSON 에서는 `findings[].fingerprint`, SARIF
 * 에서는 `partialFingerprints` 에 실린 값이다.
 */
export const FINGERPRINT_NOTE = "지문은 발견마다 결과에 실린 값 그대로입니다.";

/** 정책 표 아래에 적는 말. 대표 조문의 이름은 다른데 원문 해시가 같은 줄이 있을 때만 적는다(`buildRecord`). */
export const SAME_TEXT_NOTE = "원문 해시가 같은 줄은 팩에 실린 원문이 같은 조문입니다.";

/**
 * 정책 표 아래에 적는 말: "대표 조문"이 무엇인지(9번). 기록은 정책마다 팩의 첫 조문 하나만 적는다(결과에 적히는 조문 이름이
 * 그 조문이다). 조문 도감의 정책 페이지는 그 정책의 근거 조문을 모두 싣는다. 종이만 보면 근거 조문이 그것뿐인 것처럼 읽히므로,
 * 표에 든 정책 가운데 근거 조문이 더 있는 정책의 수를 함께 적고(이 사이트의 팩에 적힌 조문의 수로 센다. `PackIndex` 의
 * `legal`) 나머지는 조문 도감에 있다고 가리킨다. 어느 조문인지는 적지 않는다. 정책마다 적으면 종이에 실을 줄이 늘고, 그
 * 이름은 조문 도감에 있다.
 */
export function primaryLawNote(more: number): string {
  const first = "대표 조문은 팩에 적힌 정책의 근거 조문 가운데 첫째입니다.";
  return more === 0 ? first : `${first} 근거 조문이 더 있는 정책이 ${more}개이고, 그 조문은 조문 도감에 있습니다.`;
}

/**
 * 정책 표 아래의 첫 줄: 표에 적은 것 가운데 무엇이 이 사이트의 팩에서 왔는지.
 *
 * 정책의 제목, 대표 조문의 이름, 그 시행일과 원문 해시는 어느 출력으로 연 결과에서나 팩의 것을 적는다(`buildRecord`).
 * CLI 0.3 의 JSON 과 SARIF 에서는 표의 줄(어느 정책을 적는지)부터 팩에서 온다. 그 결과에는 정책 목록이 없어서 화면 구조가
 * 팩의 정책을 모두 그린다(`view-model.ts`). 발견이 0인 결과에는 정책 id 가 하나도 없다. 그것을 밝히지 않으면 머리의 "연
 * 파일에 적힌 것을 옮긴 기록"과 어긋난다. 결과 화면도 같은 것을 밝힌다(`examined.ts` 의 정책 줄). v1 초안은 결과의 정책별
 * 요약에 나온 정책만 적으므로 줄은 결과에서 온다.
 */
export function policySourceNote(contract: Contract, digest: string): string {
  const fromPack = `이 결과와 판이 같은 팩(팩 판 ${digest})에 적힌 값입니다.`;
  return contract === "v1-draft"
    ? `정책의 제목과 대표 조문, 시행일, 원문 해시(SHA-256)는 ${fromPack}`
    : `정책 목록과 대표 조문, 시행일, 원문 해시(SHA-256)는 ${fromPack} 결과에는 정책 목록이 없습니다.`;
}

/** 결과 화면이 이 둘을 부르는 이름 그대로다(`components/result/ReportSummary.tsx`). */
export const AI_CLEARED = "AI 가 푼 경고";
export const AI_DISMISSED = "AI 가 적용되지 않는다고 답해 빠진 판정";

/** 기록이 무엇으로 만든 것인지. 기록만 인쇄되므로 기록이 제 안에 적는다. */
export interface RecordSource {
  /** 합성 예시의 이름, 또는 연 파일의 이름. */
  name: string;
  /** 합성 예시인지. 예시 결과에는 늘 그렇다고 밝힌다(`docs/commitments.md` 의 1). */
  synthetic: boolean;
}

/**
 * 기록의 제목 아래에 적는 말.
 *
 * 직접 연 파일이면, 그 파일에 적힌 것을 옮겼을 뿐이라는 것을 함께 적는다. 이 사이트는 연 파일의 모양만 본다. 그 파일이
 * CLI 가 낸 그대로인지, 손으로 고친 것인지는 알 길이 없다. 그것을 밝히지 않으면 기록이 내용을 보증하는 종이처럼 읽힌다.
 */
export function sourceLine(source: RecordSource): string {
  if (source.synthetic) return `합성 예시입니다. ${source.name}`;
  return `연 파일(${source.name})에 적힌 것을 옮긴 기록입니다. 그 파일이 CLI 가 낸 그대로인지는 확인하지 않았습니다.`;
}

/** "검사 정보"의 한 줄. */
export interface RecordFact {
  label: string;
  value: string;
  /**
   * `code`: 글자 그대로 옮겨 적는 값(팩 판, 커밋). 고정폭으로 적는다.
   * `missing`: 값이 없어서 없다고 적은 줄. 옅게 적는다.
   */
  kind: "text" | "code" | "missing";
}

/** "다 보지 못한 것"의 한 줄. 결과 화면의 표(`coverage.ts` 의 `GapRow`)에서 엔진 오류 문장만 뺀 것이다. */
export interface RecordGap {
  label: string;
  /** 든 것의 수. 없으면 "없음". */
  countText: string;
  /** 든 것이 있는 줄인지. */
  on: boolean;
  meaning: string | null;
  note: string | null;
  /** 결과에 실린 순서 그대로, 모두 적는다. 인쇄물은 접어 둔 것을 펼칠 수 없다. */
  files: GapFile[];
}

/** 상태 하나의 발견 수와 그 상태의 뜻. */
export interface RecordCount {
  label: string;
  count: number;
  meaning: string;
}

/** 정책 하나: 대표 조문과 그 시행일·원문 해시, 이 결과에서의 발견. */
export interface RecordPolicy {
  id: string;
  /** 팩에 적힌 제목. 결과의 발견에 실린 제목(`findings[].title`)을 옮기지 않는다(`buildRecord`). */
  title: string;
  /** 대표 조문의 이름. 팩의 첫 조문이고, 결과의 발견에 적히는 조문이다. 팩에 조문이 없으면 null. */
  law: string | null;
  /** 팩에 적힌 시행일. */
  effectiveFrom: string | null;
  /** 팩에 적힌 원문 해시(SHA-256). */
  textSha256: string | null;
  /** 해시 아래에 적는 말. 그 해시가 팩 안의 원문 파일과 맞지 않거나 견주지 못했을 때만 있다. */
  hashNote: string | null;
  /** "발견" 칸의 줄. 발견이 있으면 상태별 수, 없으면 그 정책의 상태. AI 가 푼 경고와 빠진 판정의 수가 뒤따른다. */
  found: string[];
}

/** 발견 하나의 자리와 지문. 코드도 판정 경로도 없다. */
export interface RecordFinding {
  file: string;
  line: number | null;
  /** SARIF 가 채운 1행일 수 있는 줄(`view-model.ts` 의 `LocationView.lineUnsure`). */
  lineUnsure: boolean;
  /** 판정이 본 범위("파일 전체 판정" 등). 줄 번호 옆에 늘 함께 적는다. 줄 번호는 문제의 줄이 아니다. */
  scope: string;
  status: string;
  fingerprint: string;
}

/**
 * 같은 정책·같은 규칙의 발견 묶음. 결과 화면의 규칙 묶음과 같은 묶음이고 차례도 같다(`view-model.ts` 의
 * `RuleGroupView`). 다만 접지 않고 모두 적는다. 정책과 규칙의 id 를 줄마다 되풀이하지 않으려고 묶는다. 같은 규칙이
 * 여러 파일에 나온 결과에서 줄이 그만큼 짧아진다.
 */
export interface RecordFindingGroup {
  policy: string;
  rule: string;
  findings: RecordFinding[];
}

/** AI 가 푼 경고 하나. 인용한 줄은 없다. 대안은 id 만 적는다. */
export interface RecordAiCleared {
  policy: string;
  rule: string;
  file: string;
  line: number | null;
  alternatives: string[];
}

/** AI 의 답으로 빠진 판정 하나. 질문과 답은 없다. */
export interface RecordAiDismissed {
  policy: string;
  rule: string;
  file: string;
  line: number | null;
}

export interface RecordView {
  /** 맨 위 경고. 결과 화면의 것과 같다. 다 보지 못한 검사라는 것은 기록에서도 가장 먼저 읽혀야 한다. */
  warning: CoverageSummary["warning"];
  facts: RecordFact[];
  /** "검사 정보" 아래에 옅게 적는 말. */
  factNotes: string[];
  gaps: RecordGap[];
  /**
   * "다 보지 못한 것" 아래에 적는 한 줄. 목록이 비어 있어도 다 봤다는 뜻이 아니다. 목록 없이 빠지는 것(`SITE.notSeen`)의
   * 이름을 늘어놓는다. 까닭까지 적은 풀이는 결과 화면에 있다.
   */
  gapsNote: string;
  findingCount: number;
  /** 발견이 있는 상태만, 먼저 봐야 할 것부터. */
  counts: RecordCount[];
  /** 상태별 수 아래에 적는 말: AI 가 푼 경고와 빠진 판정의 수. 숨기지 않는다. */
  aiNotes: string[];
  policies: RecordPolicy[];
  /** 정책 표 아래에 적는 말: 값이 어디서 왔는지와 시행일의 한계. */
  policyNotes: string[];
  /** 발견이 없는 정책에 적힌 상태의 뜻. AI 가 푼 경고만 있는 정책의 줄에는 붙지 않게 적는다(`buildRecord`). */
  quiet: { label: string; meaning: string }[];
  /** 발견마다 자리와 지문. 정책, 규칙 차례로 묶는다. */
  findingGroups: RecordFindingGroup[];
  /**
   * 발견 표 위에 적는 말: 줄 번호가 무엇인지(문제의 줄이 아니다)와 지문이 어디서 온 값인지. SARIF 가 채운 1행일 수 있는
   * 줄이 있으면 그 까닭이 사이에 든다. 발견이 없으면 표도 말도 없다(null).
   */
  findingNote: string | null;
  aiCleared: RecordAiCleared[];
  aiDismissed: RecordAiDismissed[];
}

/**
 * 기록을 만들었거나, 만들지 않은 까닭. 까닭은 화면에 그대로 적을 문장이다.
 */
export type RecordResult = { ok: true; record: RecordView } | { ok: false; reasons: string[] };

/** 기록을 만들지 않았을 때 까닭 위에 적는 말. */
export const RECORD_REFUSED = "이 결과로는 검사 기록을 만들지 않습니다.";

/**
 * 기록의 머리에, 무엇으로 만든 기록인지 바로 아래에 적는 말. 기록에 없는 것이 결과에 없는 것은 아니다. 일부러 싣지 않은
 * 것을 밝힌다.
 *
 * 기록의 맨 아래에 두지 않는다. 인쇄할 때 그 한 줄만 마지막 쪽에 남는 일이 있었다. 발견 표가 한 쪽을 넘고 표의 마지막 줄이
 * 쪽의 끝에 걸리면 그랬다. 앞 쪽에서 이어진 표의 뒤에 온 글은 Chrome 이 표의 마지막 줄과 붙여 주지 못한다
 * (`docs/architecture.md` 의 "조문별 검사 기록"의 "인쇄"). 같은 까닭으로 발견 표와 AI 의 표 둘에 덧붙이는 말도 표 위에
 * 적는다(`components/result/Record.tsx`).
 */
export const RECORD_OMITS = "코드, AI 가 인용한 줄, 판정 경로, 엔진 오류 문장은 이 기록에 싣지 않습니다.";

/** 발견이 있는 상태만, 먼저 봐야 할 것부터. */
function countByStatus(locations: LocationView[]): { status: Status; count: number }[] {
  return STATUS_ORDER.map((status) => ({
    status,
    count: locations.filter((location) => location.status === status).length,
  })).filter((entry) => entry.count > 0);
}

const countOf = <T>(items: T[], key: (item: T) => string): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return counts;
};

/** 줄 번호는 정수일 때만 옮긴다. AI 의 기록에서는 파서가 이 필드의 모양을 보지 않는다. */
const lineOf = (line: unknown): number | null => (typeof line === "number" && Number.isInteger(line) ? line : null);

/**
 * 기록을 만든다. 만들 수 없으면 까닭을 돌려준다.
 *
 * 대표 조문의 원문 해시는 어느 출력에도 없다. 시행일은 결과 JSON 에 없고, SARIF 에는 발견이 난 규칙의 조문에만 실린다
 * (규칙의 태그와 `help.markdown`. 웹은 그 둘을 읽지 않는다. `sarif.ts`). 그래서 두 값을 이 사이트의 팩 메타데이터에서
 * 가져온다. 그 값이 이 결과의 것이라고 할 수 있을 때만 기록을 만든다.
 *
 * - 결과의 팩 판이 이 사이트의 팩과 다르면 만들지 않는다. 다른 판의 팩에서는 조문도, 해시도, 시행일도 달랐을 수 있다.
 * - 결과에 이 사이트의 팩에 없는 정책이 있으면 만들지 않는다. 그 정책에 적을 값이 없다. 그 줄만 비워 둔 기록은 나머지가
 *   빠짐없는 것처럼 읽힌다.
 * - 결과에 적힌 조문 이름(`findings[].law`)이 팩의 대표 조문과 다르면 만들지 않는다. 팩의 값이 그 조문의 것이 아니다.
 *
 * 뒤의 둘은 팩 판이 같은 결과에서는 생기지 않는다(CLI 는 팩의 첫 조문을 싣는다). 손으로 고친 파일에서만 생긴다.
 */
export function buildRecord(view: ReportView, pack: PackIndex): RecordResult {
  if (view.packDigest !== pack.pack.digest) {
    return {
      ok: false,
      reasons: [
        `이 결과를 만든 팩(팩 판 ${view.packDigest})과 이 사이트에 실린 팩(팩 판 ${pack.pack.digest})의 판이 다릅니다. ` +
          "기록에 적는 시행일과 원문 해시는 이 사이트의 팩에 적힌 값이라, 이 결과를 만든 팩의 것이 아닙니다.",
      ],
    };
  }

  const known = new Map(pack.policies.map((policy) => [policy.id, policy]));
  // 결과에 나온 정책: 카드로 그리는 정책(발견, AI 가 푼 경고, 정책별 요약)과, AI 의 답으로 빠진 판정에만 나오는 정책.
  const named = new Set([
    ...view.policies.map((policy) => policy.id),
    ...view.aiCleared.map((cleared) => cleared.policy),
    ...view.aiDismissed.map((dismissed) => dismissed.policy),
  ]);
  // 까닭에 적는 id 는 글자 코드 순서로 늘어놓는다. 결과에 나온 차례나 보는 사람의 언어 설정에 따라 달라지지 않는다.
  const unknown = [...named].filter((id) => !known.has(id)).sort();
  const renamed = view.policies
    .filter((policy) => {
      const primary = known.get(policy.id)?.legal[0]?.label;
      return known.has(policy.id) && policy.locations.some((location) => location.finding.law !== (primary ?? ""));
    })
    .map((policy) => policy.id)
    .sort();
  if (unknown.length > 0 || renamed.length > 0) {
    return {
      ok: false,
      reasons: [
        ...(unknown.length > 0
          ? [`결과에 이 사이트의 팩에 없는 정책이 있습니다: ${unknown.join(", ")}. 그 정책의 대표 조문과 시행일, 원문 해시를 알 수 없습니다.`]
          : []),
        ...(renamed.length > 0
          ? [
              `결과에 적힌 조문 이름이 이 사이트의 팩에 실린 대표 조문과 다른 정책이 있습니다: ${renamed.join(", ")}. ` +
                "팩에 적힌 시행일과 원문 해시가 그 조문의 것인지 알 수 없습니다.",
            ]
          : []),
      ],
    };
  }

  const { coverage } = view;
  const summary = coverageSummary(view);
  const locations = view.policies.flatMap((policy) => policy.locations);
  const dismissedBy = countOf(view.aiDismissed, (dismissed) => dismissed.policy);

  const fact = (label: string, value: string, kind: RecordFact["kind"] = "text"): RecordFact => ({ label, value, kind });
  const facts = [
    fact("도구", view.tool),
    fact("엔진", view.engine ?? "실행 안 함"),
    fact("판정자", view.judge ?? "꺼짐"),
    fact("팩 판", view.packDigest, "code"),
    fact("출력 형식", CONTRACT_LABEL[view.contract]),
    coverage.files === null ? fact("검사한 파일", UNKNOWN, "missing") : fact("검사한 파일", `${coverage.files}개`),
    coverage.units === null ? fact("판정 단위", UNKNOWN, "missing") : fact("판정 단위", `${coverage.units}개`),
    fact("검사한 범위", NOT_IN_RESULT, "missing"),
    fact("검사한 날", NOT_IN_RESULT, "missing"),
    view.commit === null ? fact("커밋", NOT_IN_RESULT, "missing") : fact("커밋", view.commit, "code"),
  ];

  // 엔진 오류는 수만 적는다. 결과 화면의 표는 오류가 있을 때만 그 줄을 두지만, 기록에는 없을 때도 없다고 적는다.
  const gaps: RecordGap[] = summary.rows
    .filter((row) => row.kind !== "engine-errors")
    .map((row) => ({ label: row.label, countText: row.countText, on: row.count > 0, meaning: row.meaning, note: row.note, files: row.files }));
  const errors = summary.rows.find((row) => row.kind === "engine-errors");
  gaps.push({
    label: GAP_LABEL["engine-errors"],
    countText: errors?.countText ?? "없음",
    on: errors !== undefined,
    meaning: errors?.meaning ?? null,
    note: errors ? "오류 문장은 이 기록에 싣지 않습니다." : null,
    files: [],
  });

  const aiNotes: string[] = [];
  if (view.aiCleared.length > 0) aiNotes.push(`${AI_CLEARED} ${view.aiCleared.length}건. 발견에는 들어 있지 않습니다.`);
  if (view.aiDismissed.length > 0) {
    // 빠진 판정은 판정 단위 수에도 들어 있지 않다(`examined.ts`). 그 수가 결과에 없으면(SARIF) 발견만 말한다.
    const outOf = coverage.units === null ? "발견에는" : "발견에도 판정 단위 수에도";
    aiNotes.push(`${AI_DISMISSED} ${view.aiDismissed.length}건. ${outOf} 들어 있지 않습니다.`);
  } else if (!view.aiDismissedKnown) {
    aiNotes.push(`${AI_DISMISSED}이 있었는지는 결과에 실려 있지 않습니다.`);
  }

  const policies: RecordPolicy[] = view.policies.map((policy) => {
    const meta = known.get(policy.id)!;
    const legal = meta.legal[0];
    const hash = legal?.text_sha256 ?? null;
    return {
      id: policy.id,
      // 제목은 팩의 것을 적는다. 화면 구조의 제목은 발견이 있으면 결과의 것(`findings[].title`)인데, 그것은 파서가 모양을
      // 보지 않는 글이다. CLI 가 낸 결과에서는 팩의 제목과 같은 글이고(팩 판이 같을 때만 기록을 만든다), 손으로 고친
      // 파일에는 무엇이든 들 수 있다. 기록에는 코드를 싣지 않는다.
      title: meta.title,
      law: legal?.label ?? null,
      effectiveFrom: legal?.effective_from ?? null,
      textSha256: hash,
      hashNote:
        hash === null || legal?.text_sha256_matches === true
          ? null
          : legal?.text_sha256_matches === false
            ? "팩 안의 원문 파일과 맞지 않습니다."
            : "팩 안의 원문 파일과 견주지 못했습니다.",
      found: foundLines(policy, dismissedBy.get(policy.id) ?? 0),
    };
  });

  // 대표 조문의 이름은 다른데 원문 해시가 같은 줄이 있으면 그 까닭을 적는다. 적지 않으면 한쪽 해시를 잘못 옮겨 적은
  // 것처럼 읽힌다. 해시가 같으면 원문이 같다. 팩의 원문 파일은 조 단위라서, 한 조의 서로 다른 항을 대표 조문으로 든
  // 정책들은 같은 파일을 가리킨다(CLI `8ae72d8` 의 팩에서 확인했다. `docs/cli-requests.md` 의 R5). 해시가 원문 파일과
  // 맞는 줄끼리만 그렇게 적는다. 맞지 않거나 견주지 못한 줄은 원문이 같은지 알 수 없다.
  const sameText = policies.some(
    (a, i) =>
      a.textSha256 !== null &&
      a.hashNote === null &&
      policies.slice(i + 1).some((b) => b.textSha256 === a.textSha256 && b.hashNote === null && b.law !== a.law),
  );

  // 발견이 없고 AI 가 푼 경고만 있는 정책에는 "발견 없음"의 뜻(충족인지 미적용인지 구분할 수 없다)을 붙이지 않는다.
  // 그 정책 카드도 그 말 대신 AI 가 푼 경고가 있다고 적는다(`components/result/PolicyCard.tsx`).
  // - 발견이 없는 정책이 모두 그런 정책이면 그 뜻을 적지 않는다.
  // - 그런 정책과 조용한 정책이 섞여 있으면 뜻의 주어를 좁혀 적는다. 두 줄에 같은 이름("발견 없음")이 적혀 있어서,
  //   그대로 적으면 AI 가 푼 경고가 있는 줄에도 읽힌다.
  const without = (policy: PolicyView) => policy.locations.length === 0;
  const clearedOnly = view.policies.some((policy) => without(policy) && policy.aiCleared > 0 && policy.status === "not-reported");
  const quiet = STATUS_ORDER.filter((status) =>
    view.policies.some((policy) => without(policy) && policy.aiCleared === 0 && policy.status === status),
  ).map((status) => ({
    label: STATUS_LABEL[status],
    meaning: status === "not-reported" && clearedOnly ? NOT_REPORTED_NOR_CLEARED : STATUS_LEGEND[status],
  }));

  const findingGroups: RecordFindingGroup[] = view.policies.flatMap((policy) =>
    policy.rules.map((group) => ({
      policy: policy.id,
      rule: group.rule,
      findings: [...group.shown, ...group.folded].map((location) => ({
        file: location.file,
        line: location.line,
        lineUnsure: location.lineUnsure,
        scope: scopeLabel(location.scope),
        status: STATUS_LABEL[location.status],
        fingerprint: location.fingerprint,
      })),
    })),
  );

  return {
    ok: true,
    record: {
      warning: summary.warning,
      facts,
      factNotes: [
        ...(view.contract === "sarif" ? [SARIF_COUNTS_NOTE] : []),
        "브라우저가 인쇄물에 적는 날짜는 인쇄한 날이고, 검사한 날이 아닙니다.",
      ],
      gaps,
      // 항목 이름에 가운뎃점이 든 것이 있어서(서버·인프라 설정) 쉼표로 나눈다.
      gapsNote: `${SITE.notSeen.title}은 위 목록에 실리지 않습니다: ${SITE.notSeen.items.map((item) => item.what).join(", ")}.`,
      findingCount: view.findingCount,
      counts: countByStatus(locations).map(({ status, count }) => ({
        label: STATUS_LABEL[status],
        count,
        meaning: STATUS_LEGEND[status],
      })),
      aiNotes,
      policies,
      policyNotes: [
        policySourceNote(view.contract, pack.pack.digest),
        ...(sameText ? [SAME_TEXT_NOTE] : []),
        primaryLawNote(view.policies.filter((policy) => known.get(policy.id)!.legal.length > 1).length),
        EFFECTIVE_FROM_NOTE,
      ],
      quiet,
      findingGroups,
      findingNote: findingNote(locations),
      aiCleared: view.aiCleared.map((cleared) => ({
        policy: cleared.policy,
        rule: cleared.rule,
        file: cleared.file,
        line: lineOf(cleared.line),
        alternatives: cleared.alternatives.map((alt) => alt.id),
      })),
      aiDismissed: view.aiDismissed.map((dismissed) => ({
        policy: dismissed.policy,
        rule: dismissed.rule,
        file: dismissed.file,
        line: lineOf(dismissed.line),
      })),
    },
  };
}

/**
 * 발견 표 위에 적는 말. 발견이 없으면 표를 그리지 않으므로 말도 없다.
 *
 * - 줄 번호가 무엇인지. 종이에서는 발견을 펼쳐 볼 수 없어서, 적어 두지 않으면 "경로:줄"이 문제의 줄로 읽힌다. 결과 화면이
 *   발견을 펼친 안쪽에 적는 말과 같다(`scope.ts`). 줄이 실린 발견이 있을 때만 적는다.
 * - SARIF 가 채운 1행일 수 있는 줄이 있으면, 그 줄은 위의 말이 맞는지 알 수 없다고 잇는다.
 * - 지문이 어디서 온 값인지.
 *
 * 표 아래가 아니라 위에 적는다. 표가 쪽을 넘어가면 표 아래의 글만 다음 쪽에 남을 수 있다(`RECORD_OMITS`).
 */
function findingNote(locations: LocationView[]): string | null {
  if (locations.length === 0) return null;
  return [
    ...(locations.some((location) => location.line !== null && !location.lineUnsure) ? [LINE_IS_FIRST] : []),
    ...(locations.some((location) => location.lineUnsure)
      ? [`${SARIF_LINE_ONE} '${LINE_UNSURE}'이라고 적은 줄은 조문이 닿는다고 본 줄인지 알 수 없습니다.`]
      : []),
    FINGERPRINT_NOTE,
  ].join(" ");
}

/**
 * 정책 하나의 "발견" 칸. 발견이 있으면 상태별 수를 적는다. 없으면 그 정책의 상태를 적는다("발견 없음" 등. 뜻은 표
 * 아래에 적는다). AI 가 푼 경고와 AI 의 답으로 빠진 판정이 있으면 그 수를 덧붙인다. 발견이 없는 줄에서도 숨기지 않는다.
 */
function foundLines(policy: PolicyView, dismissed: number): string[] {
  const lines =
    policy.locations.length > 0
      ? countByStatus(policy.locations).map(({ status, count }) => `${STATUS_LABEL[status]} ${count}건`)
      : [STATUS_LABEL[policy.status]];
  if (policy.aiCleared > 0) lines.push(`${AI_CLEARED} ${policy.aiCleared}건`);
  if (dismissed > 0) lines.push(`${AI_DISMISSED} ${dismissed}건`);
  return lines;
}
