import { STATUS_LABEL } from "@/lib/report/status";
import type { Alternative, LegalRef, PolicyDoc } from "./types";

/**
 * 조문 도감(`/policy`)이 팩의 값을 화면의 말로 옮기는 곳.
 *
 * 값은 팩 메타데이터(`data/pack-meta.json`)에 실린 그대로 옮긴다. 그 값이 무엇을 뜻하는지는 CLI README 가 적은 만큼만
 * 적는다(CLI 커밋 `8ae72d8` 의 "어떻게 판정하나", "정책 팩", "외부 통신"). 팩이 주지 않는 것은 주지 않는다고 적는다.
 * 팩의 YAML 주석이나 Semgrep 패턴을 풀어 설명을 만들지 않고, id 를 우리말로 풀어 쓰지도 않는다(`docs/cli-requests.md` 의
 * R5). 팩 작성자 메모와 처분·액수는 싣지 않는다(`docs/commitments.md` 의 1).
 *
 * 화면에 쓰는 팩의 글은 제목, 질문(개발자에게 할 질문, 판정자에게 묻는 글), 알리는 말, 고치는 법이다. 규칙 줄을 펼치면 사람에게
 * 하는 말이 보이고, 판정자에게 묻는 글(적용 질문, AI 대안의 질문)은 한 번 더 접어 둔다(`components/policy/PolicyDetail.tsx`).
 */

/** 팩에 값이 없을 때 그 자리에 적는 말(날짜, 링크, 알리는 말, 질문, 고치는 법). 다른 데서 끌어와 채우지 않는다. */
export const NOT_IN_PACK = "팩에 실려 있지 않습니다.";

/**
 * 적용 조건의 설명 자리에 적는 말. 팩 메타데이터에는 조건의 id 만 있다. 무엇을 보는 조건인지는 팩의 YAML 주석과 Semgrep
 * 패턴에만 있고, 웹은 그것을 풀어 옮기지 않는다(R5).
 */
export const CONDITION_UNDESCRIBED = "팩이 아직 알려 주지 않습니다.";

/** 원문이 없는 조문(`text` 가 null)에 적는 말. */
export const NO_STATUTE_TEXT = "원문이 실려 있지 않습니다.";

/** 사실 줄의 이름표와 값. 조문 도감 정책 쪽의 곁칸 `이 정책` 과 조문마다의 줄이 이 모양으로 적는다. */
export interface Fact {
  label: string;
  value: string;
  /** 눈에 띄게 적을 값(원문 해시가 팩에 적힌 것과 다르거나 견주지 못했을 때). */
  warn?: boolean;
}

/**
 * 원문과 날짜가 어디서 왔는지. D5 까지는 "근거 조문" 구역의 첫 줄(LEGAL_NOTE: "원문과 날짜는 팩에 실린 그대로입니다. 시행일이
 * 어느 판본의 날짜인지는 팩이 아직 알려 주지 않습니다.")이 하던 말이다. 재디자인(D6)에서 곁칸의 사실 줄 둘로 옮겼다. 첫 문장은
 * 이 줄이, 둘째 문장은 아래 `EFFECTIVE_VERSION` 이 말한다. 원문만이 아니라 날짜도 팩의 것이라 이름표에 둘을 함께 적는다.
 */
export const SOURCE_FACT: Fact = { label: "원문과 날짜", value: "팩에 실린 그대로" };

/**
 * 시행일(`effective_from`)이 무엇의 날짜인지. 팩 메타데이터에도 CLI README(`8ae72d8`)에도 없다. 그래서 날짜만 옮기고, 어느
 * 판본의 날짜인지는 팩이 알려 주지 않는다고 적는다. 원문 파일의 머리에도 '시행' 줄이 있는데, 그 줄은 원문의 글이라 풀어 읽지
 * 않는다(두 날짜가 다른 조문이 있다. `docs/ROADMAP.md` 의 "CLI 가 나아갔다").
 *
 * CLI `e1e46a9` 의 README 는 그 뜻을 적는다(받은 판본의 시행일). 그 판으로 다시 수집한 뒤에 이 말을 README 가 적은 만큼으로
 * 바꾼다(`docs/ROADMAP.md` 의 "G1 뒤에 할 일"). 조문별 검사 기록은 같은 사실을 문장으로 적는다(`EFFECTIVE_FROM_NOTE`). 둘은
 * 함께 바꾼다(tests/record.test.tsx).
 */
export const EFFECTIVE_VERSION: Fact = { label: "시행일의 판본", value: "팩이 아직 알려 주지 않음" };

/** 시행일을 적은 자리에 덧붙이는 말(조문별 검사 기록, `src/lib/report/record.ts`). 조문 도감은 `EFFECTIVE_VERSION` 으로 적는다. */
export const EFFECTIVE_FROM_NOTE = "시행일이 어느 판본의 날짜인지는 팩이 아직 알려 주지 않습니다.";

/** 조문마다 값이 다른 날짜를 곁칸에 적는 말. 값은 조문마다의 줄(그 조문을 펼친 안쪽)에 있다. */
export const DIFFERS_BY_LEGAL = "조문마다 다름";

/** 규칙마다 판정 단위가 다를 때 곁칸에 적는 말. 규칙마다의 판정 단위는 규칙 줄에 있다. */
export const DIFFERS_BY_RULE = "규칙마다 다름";

/** 해시를 화면에 짧게 적을 때의 자리 수. 팩 판(16자)과 같다. 전체 값은 그 옆에 접어 둔다. */
export const HASH_SHOWN = 16;

/** 조문들의 그 값이 모두 같은지. 같으면 그 값(없는 값은 null), 다르면 `undefined`. 조문이 없어도 `undefined`. */
function sharedValue(legal: LegalRef[], pick: (ref: LegalRef) => string | null): string | null | undefined {
  if (legal.length === 0) return undefined;
  const values = new Set(legal.map(pick));
  return values.size === 1 ? [...values][0] : undefined;
}

/** 곁칸과 조문마다의 줄에서 원문 해시가 팩에 적힌 것과 맞는지 적는 줄의 이름표. 해시의 값을 적는 줄(`원문 해시`)과 가른다. */
export const HASH_CHECK = "원문 해시 대조";

/**
 * 원문의 출처에 관한 사실. 조문이 모두 같은 값이면 곁칸에 한 번(`side`), 다르면 곁칸에는 `조문마다 다름` 을 적고 조문마다의
 * 줄(`perLegal[i]`)에 그 조문의 값을 적는다. 원문 해시의 값은 원문마다의 것이라 늘 조문마다의 줄에 둔다(부품이 그린다). 곁칸에는
 * 그 해시가 팩에 적힌 것과 맞는지만 모아 적는다(`원문 해시 대조`). 조문이 없는 정책에는 원문의 사실이 없다(곁칸에도 적지 않는다).
 *
 * 곁칸의 차례는 docs/redesign.md 3장의 목록대로다: 원문, 원문 받은 날, 해시, (시행일), 시행일의 판본.
 *
 * 값은 팩 메타데이터 그대로다. 없는 값은 `NOT_IN_PACK` 이다. 날짜를 고치거나 다시 계산하지 않는다.
 */
export function legalFacts(legal: LegalRef[]): { side: Fact[]; perLegal: Fact[][] } {
  if (legal.length === 0) return { side: [], perLegal: [] };
  const side: Fact[] = [SOURCE_FACT];
  const perLegal: Fact[][] = legal.map(() => []);
  const date = (label: string, pick: (ref: LegalRef) => string | null) => {
    const shared = sharedValue(legal, pick);
    side.push({ label, value: shared === undefined ? DIFFERS_BY_LEGAL : (shared ?? NOT_IN_PACK) });
    if (shared === undefined) legal.forEach((ref, i) => perLegal[i].push({ label, value: pick(ref) ?? NOT_IN_PACK }));
  };
  date("원문 받은 날", (ref) => ref.text_retrieved);
  // 해시가 맞는지: 모두 같은 결과면 한 줄로(조문이 여럿이면 "N개 모두"), 다르면 곁칸에는 맞지 않는 것의 수를 말로 적고(색만으로
  // 알리지 않는다) 조문마다의 줄에 그 조문의 결과를 적는다.
  const statuses = legal.map(hashStatus);
  const shared = sharedValue(legal, (ref) => hashStatus(ref).text);
  if (shared === undefined || shared === null) {
    side.push({ label: HASH_CHECK, value: hashTally(statuses), warn: statuses.some((status) => status.warn) });
    statuses.forEach((status, i) => perLegal[i].push({ label: HASH_CHECK, value: status.text, warn: status.warn }));
  } else {
    side.push({ label: HASH_CHECK, value: legal.length > 1 ? `${legal.length}개 모두 ${shared}` : shared, warn: statuses[0].warn });
  }
  date("시행일", (ref) => ref.effective_from);
  side.push(EFFECTIVE_VERSION);
  return { side, perLegal };
}

/**
 * 조문마다 해시 대조의 결과가 다를 때 곁칸에 적는 말: 맞지 않거나 견주지 못한 것이 몇 개인지(`3개 가운데 1개 팩에 적힌 것과
 * 다름`). 결과의 말은 `hashStatus` 그대로이고, 처음 나온 차례로 적는다.
 */
function hashTally(statuses: { text: string; warn: boolean }[]): string {
  const counts = new Map<string, number>();
  for (const status of statuses) if (status.warn) counts.set(status.text, (counts.get(status.text) ?? 0) + 1);
  return `${statuses.length}개 가운데 ${[...counts].map(([text, n]) => `${n}개 ${text}`).join(", ")}`;
}

/**
 * 판정 단위. 팩의 `scope` 값을 옮긴다. 뜻은 CLI README 의 "함수 단위 판정"과 "외부 통신"이 적은 만큼이다. 함수 단위
 * 규칙은 팩이 적용 조건 하나를 골라(`anchor-on`) 그 조건이 맞은 자리로 함수를 정한다. 어느 조건인지는 팩 메타데이터에
 * 없어서 적지 않는다.
 */
const UNIT = new Map([
  ["file", { label: "파일", gloss: "파일마다 판정 하나를 냅니다. 파일 전체를 보고 판정합니다." }],
  ["anchor", { label: "함수", gloss: "팩이 고른 적용 조건이 맞은 자리를 감싸는 가장 바깥 함수마다 판정 하나를 냅니다." }],
]);

/** 판정 단위의 이름. 모르는 값은 풀어 쓰지 않고 팩에 적힌 그대로 보인다. */
export function unitLabel(scope: string): string {
  return UNIT.get(scope)?.label ?? scope;
}

/**
 * 곁칸 `이 정책` 의 판정 단위. 규칙이 모두 같은 단위면 그 이름 하나, 다르면 `규칙마다 다름`(규칙마다의 것은 규칙 줄에 있다).
 * 규칙이 없으면(손으로 만든 자료) null 이다.
 */
export function policyUnit(policy: PolicyDoc): string | null {
  const units = new Set(policy.rules.map((rule) => unitLabel(rule.scope)));
  if (units.size === 0) return null;
  return units.size === 1 ? [...units][0] : DIFFERS_BY_RULE;
}

const STRENGTH = new Map([
  ["strong", "강한"],
  ["weak", "약한"],
]);

/** 약한 정적 대안인지. 표의 줄마다 혼자서는 경고를 풀지 못한다고 적는다. */
export function isWeak(alt: Alternative): boolean {
  return alt.kind === "static" && alt.strength === "weak";
}

/** 인용해야 '예'를 인정하는 AI 대안인지. `evidence` 의 두 값(required, strict)이 모두 그렇다. */
function needsCitation(alt: Alternative): boolean {
  return alt.kind === "ai" && (alt.evidence === "required" || alt.evidence === "strict");
}

/**
 * 대안의 종류와 세기. 팩의 값(`kind`, `strength`)을 옮긴다: static 은 정적, ai 는 AI, strong 은 강한, weak 는 약한.
 * 모르는 값은 팩에 적힌 그대로 보인다.
 *
 * AI 대안에는 세기가 없다(팩 메타데이터에서 null 이다). 대신 '예'를 인정하는 조건(`evidence`)이 있다. 값은 required 와
 * strict 둘이고, 어느 쪽이든 코드의 실제 줄을 인용해야 한다(CLI README 의 "어떻게 판정하나"). 둘의 차이(줄 끝의 주석을
 * 받는지)는 화면에 싣지 않는다. 모르는 값이면 인용이 필요하다고 적지 않고 그 값을 그대로 보인다.
 */
export function altKind(alt: Alternative): string {
  if (alt.kind === "ai") {
    if (needsCitation(alt)) return "AI · 코드 인용 필요";
    return alt.evidence ? `AI · 인용 조건 ${alt.evidence}` : "AI";
  }
  if (alt.strength === null) return "정적";
  return `정적 · ${STRENGTH.get(alt.strength) ?? alt.strength}`;
}

/** 약한 대안의 줄에 적는 말. "규칙 읽는 법"을 펼치지 않아도 보여야 한다(이름만 맞춰서는 경고가 풀리지 않는다). */
export const WEAK_NOTE = "약한 대안은 참이어도 혼자서는 경고를 풀지 못합니다.";

/** 적용 질문이 없는 규칙에 적는 말. */
export const NO_APPLIES_QUESTION = "이 규칙에는 적용 질문이 없습니다.";

/** 접어 둔, 판정자에게 묻는 글(적용 질문, AI 대안의 질문)의 이름. */
export const ASKED_TO_JUDGE = "판정자에게 묻는 글";

/**
 * 판정자에게 묻는 것이 있는 정책에 적는 말. 판정자를 켜야 묻는다는 것과, 켜면 판정 대상 코드가 외부 API 로 나간다는
 * 것을 함께 적는다(`docs/commitments.md` 의 "CLI 가 이미 약속한 것"). 켜 보라고 권하는 말이 아니다. 이 쪽에는 권할 결과가
 * 없다. 판정자에게 묻는 것이 없는 정책이면 null 이다.
 *
 * "판정자는 기본으로 꺼져 있습니다"는 적지 않는다(재디자인 D7). CLI 의 기본값이고, 이 서비스의 분석은 판정자를 늘 켠다
 * (`docs/direction.md` 1장, `docs/commitments.md` 의 "CLI 가 이미 약속한 것").
 */
export function judgeNote(policy: PolicyDoc): string | null {
  const asked = [
    policy.rules.some((rule) => rule.alternatives.some((alt) => alt.kind === "ai")) && "AI 대안",
    policy.rules.some((rule) => Boolean(rule.applies_question)) && "적용 질문",
  ].filter((name): name is string => typeof name === "string");
  if (asked.length === 0) return null;
  return (
    `${asked.join("과 ")}은 판정자를 켠 검사에서만 묻습니다. ` +
    "판정자를 켜면 판정 대상 코드가 외부 API 로 나갑니다."
  );
}

/**
 * 원문 해시가 팩에 적힌 것과 맞는지(`text_sha256_matches`). 팩 메타데이터를 만들 때 원문 파일의 해시를 구해 팩에 적힌
 * 해시와 견준 값이다(`scripts/export-pack-meta.mjs`). 거짓이거나 견주지 못했으면(null) 그 사실을 눈에 띄게 적는다.
 */
export function hashStatus(legal: LegalRef): { text: string; warn: boolean } {
  if (legal.text_sha256_matches === true) return { text: "팩에 적힌 것과 같음", warn: false };
  if (legal.text_sha256_matches === false) return { text: "팩에 적힌 것과 다름", warn: true };
  if (!legal.text) return { text: "원문이 없어 견주지 못함", warn: true };
  if (!legal.text_sha256) return { text: "팩에 해시가 적혀 있지 않음", warn: true };
  return { text: "견주지 못함", warn: true };
}

/** 원문 해시가 팩에 적힌 것과 다를 때 원문 위에 적는 말. */
export const HASH_MISMATCH_NOTE = "아래 원문은 팩에 적힌 해시와 맞지 않습니다.";

const ORDINAL = ["첫째", "둘째", "셋째", "넷째", "다섯째"];

/**
 * 같은 쪽의 앞선 조문 가운데 원문이 글자까지 같은 것이 있으면, 접어 둔 원문의 이름 옆에 적는 말. 한 조의 여러 항을
 * 근거로 든 정책에서는 같은 원문이 되풀이된다(팩의 원문은 조 단위다). 조문 이름은 길어서 차례로 가리킨다.
 */
export function sameTextNote(legal: LegalRef[], index: number): string | null {
  const text = legal[index]?.text;
  if (!text) return null;
  const earlier = legal.slice(0, index).findIndex((ref) => ref.text === text);
  if (earlier === -1) return null;
  return `위 ${ORDINAL[earlier] ?? `${earlier + 1}번째`} 조문과 원문이 같습니다`;
}

/** "규칙 읽는 법"의 한 항목. */
export interface LegendItem {
  term: string;
  text: string;
}

/**
 * 규칙을 읽는 법. 접어 둔다. 이름 옆에 무엇이 들어 있는지 적는다(`LEGEND_COVERS`). 차례는 규칙에 적힌 차례와 같다.
 *
 * 적용 조건은 모두 참이어야 하고 대안은 하나만 참이면 된다. 강한 대안은 혼자 경고를 풀고, 약한 대안(이름·문자열만 본
 * 근거)은 판정자에게 다시 묻는다. AI 는 정적 조건으로 결론이 나지 않을 때만 부르고 '예'는 인용이 있어야 한다. 모두 CLI
 * README 의 "어떻게 판정하나"가 적은 것이다. 적용 질문은 README 의 "외부 통신"이 적은 만큼이다. README 의 '불확실'은 이
 * 사이트의 상태 이름으로 옮긴다.
 *
 * 판정 단위는 이 정책의 규칙에 나온 것만 풀이한다. 모르는 값에는 풀이가 없다.
 */
export function ruleLegend(policy: PolicyDoc): LegendItem[] {
  const units = [...new Set(policy.rules.map((rule) => rule.scope))].flatMap((scope) => UNIT.get(scope) ?? []);
  return [
    ...units.map((unit) => ({ term: `판정 단위 · ${unit.label}`, text: unit.gloss })),
    { term: "적용 조건", text: `모두 참이어야 규칙이 적용됩니다. 조건마다 무엇을 보는지는 ${CONDITION_UNDESCRIBED}` },
    { term: "적용 질문", text: "적용 조건만으로 적용 여부가 정해지지 않을 때 판정자에게 묻습니다." },
    { term: "적법한 대안", text: "하나만 참이면 경고가 풀려, 결과에 발견으로 나오지 않습니다. 약한 대안은 아래처럼 다릅니다." },
    { term: "정적 · 강한", text: "AI 를 부르지 않고 판정합니다. 참이면 혼자서 경고를 풉니다." },
    {
      term: "정적 · 약한",
      text:
        "이름·문자열만 본 근거입니다. 참이어도 혼자서는 경고를 풀지 못하고 판정자에게 다시 묻습니다. " +
        `판정자가 없으면 '${STATUS_LABEL.uncertain}'로 남습니다.`,
    },
    {
      term: "AI · 코드 인용 필요",
      text:
        "정적 조건으로 결론이 나지 않을 때만 판정자에게 묻습니다. '예'라는 답은 코드의 실제 줄을 인용해야 인정됩니다. " +
        "판정자가 꺼져 있으면 판정에 넣지 않습니다.",
    },
  ];
}

/** 접어 둔 "규칙 읽는 법"의 이름 옆에 적는 말. 접혀 있어도 무엇이 들어 있는지 보이게 한다. */
export const LEGEND_COVERS = "판정 단위, 적용 조건, 대안의 종류와 세기";
