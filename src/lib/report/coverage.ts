import { STATUS_LABEL } from "./status";
import type { ReportView } from "./view-model";

/**
 * 커버리지 보기의 글: 맨 위 경고, 검사한 파일 수 줄, "다 보지 못한 것" 표.
 *
 * 표에는 결과에 실린 세 목록과 엔진 오류를 그대로 옮긴다. 세 목록은 뜻이 다르다(`docs/architecture.md` 의
 * "커버리지 보기"). 뜻은 CLI 가 정한 대로다(CLI 소스 `evaluate/engine.py` 의 EvalResult, `discover.py`,
 * `static/backend.py`). CLI 0.3.0.dev0 을 합성 폴더에 돌려 확인했다.
 *
 * - 검사하지 않은 파일(`run.skipped`): 코드를 보지 않았다. 검사한 파일 수(`run.files`)에도 들어 있지 않다. 까닭은
 *   다섯 가지 가운데 하나인데(1MB 초과, 축소·번들 파일, 읽을 권한 없음, 엔진이 읽지 못하는 확장자, UTF-8 아님)
 *   파일마다 어느 것인지는 결과에 없다(`docs/cli-requests.md` 의 R15).
 * - 일부를 읽지 못한 파일(`run.unparsed`): 검사했다. 구문을 전부 또는 일부 파싱하지 못해 구문을 봐야 하는 조건이
 *   '모름'이 된다. 글자만 보는 조건은 그대로 판정한다.
 * - 엔진이 끝내지 못한 파일(`run.incomplete`): 검사했다. 엔진이 조건을 끝까지 돌리지 못했고(시간 초과 등), 끝나지
 *   않은 조건은 글자만 보는 조건까지 '모름'이 된다.
 *
 * 뒤의 두 목록의 파일에서 나온 발견이 모두 판단 보류인 것은 아니다. '모름'이 된 조건에 판정이 걸린 곳만 그렇게
 * 남는다. 그래서 "남았을 수 있습니다"라고 적고, 파일마다 이 결과에 나온 발견의 수를 옆에 적는다.
 *
 * 한 파일이 두 목록에 함께 실릴 수 있다. 세 수를 더해 "다 보지 못한 파일 N개"로 적지 않는다.
 *
 * 목록이 비어 있다는 것은 결과에 이름이 실린 파일이 없다는 뜻일 뿐이다. 목록 없이 빠지는 파일과 검사한 범위는
 * 결과에 없다(`SITE.notSeen`). 그래서 "끝까지 봤다"고 적지 않는다.
 */

/** 표의 이름. 맨 위 경고와 빈 결과 화면이 이 이름으로 표를 가리킨다. */
export const GAPS_TITLE = "다 보지 못한 것";

/** 표의 이름 옆에 적는 말. "없음"이 "결과에 실린 목록이 비어 있다"로 읽히게 한다. */
export const GAPS_NOTE = "결과에 실린 목록입니다";

/**
 * 발견이 있는 결과에서 표 아래에 접어 두는 `SITE.notSeen` 의 이름 옆에 적는 말. 접혀 있어도 표에 나오지 않는 것이
 * 있다는 것이 보이게 한다. 그 목록의 항목 이름을 그대로 부른다.
 */
export const GAPS_UNLISTED = "목록 없이 빠지는 파일, 검사한 범위 밖의 파일 등";

/**
 * SARIF 를 열었을 때 검사한 파일 수 줄 아래에 적는 말. SARIF 에는 두 수가 실리지 않는다(`sarif.ts`). 줄에는
 * "알 수 없음"만 보이므로, 까닭과 그 수를 볼 수 있는 길을 한 번 적는다. 같은 검사의 JSON 출력에는 두 수가 있다
 * (`contract/cli-current/kids-signup.main.*` 로 맞춰 봤다).
 */
export const SARIF_COUNTS_NOTE =
  "SARIF 에는 검사한 파일 수와 판정 단위 수가 실려 있지 않습니다. JSON 출력(--output-format json)에는 있습니다.";

/** 한 목록에서 먼저 보이는 파일의 수. 나머지는 접는다. 결과에 실린 순서 그대로다. */
export const SHOWN_PER_LIST = 3;

export type GapKind = "skipped" | "unparsed" | "incomplete" | "engine-errors";

export interface GapFile {
  file: string;
  /** 이 결과에서 이 파일에 나온 발견의 수. 검사하지 않은 파일에는 적지 않는다(null). */
  findings: number | null;
}

export interface GapRow {
  kind: GapKind;
  label: string;
  /** 목록에 든 것의 수. */
  count: number;
  /** 화면에 적는 수. 든 것이 없으면 "없음". */
  countText: string;
  /** 이 목록에 든 것이 무엇을 뜻하는지. 든 것이 있을 때만 적는다. */
  meaning: string | null;
  /** 뜻 아래에 옅게 덧붙이는 말(검사하지 않은 까닭이 결과에 없다는 것). 든 것이 있을 때만 적는다. */
  note: string | null;
  files: GapFile[];
  /**
   * 결과에 실린 오류 문장(`run.engine_errors`). 엔진 오류 줄에만 있다. 엔진이 낸 문장 그대로가 아니다. CLI 가 오류
   * 종류를 앞에 붙이고 엔진의 문장을 앞 200자까지만 싣는다(CLI 소스 `static/parse.py`). 화면은 실린 그대로 보인다.
   */
  texts: string[];
}

export interface CoverageSummary {
  /** 맨 위 경고. 다 보지 못했거나, 검사한 파일이 없거나, 엔진을 돌리지 않았을 때만 있다. */
  warning: { lead: string; detail: string | null } | null;
  /** 검사한 파일 수와 판정 단위 수. 결과에 없는 수는 "알 수 없음"이다. */
  line: string;
  /** 그 줄 아래에 옅게 덧붙이는 말. 출력 형식 때문에 수를 알 수 없을 때(SARIF)만 있다. */
  lineNote: string | null;
  /** 세 목록은 늘 있다. 엔진 오류는 있을 때만 넷째 줄로 붙는다. */
  rows: GapRow[];
}

/** 표의 줄 이름. 조문별 검사 기록도 같은 이름으로 적는다(`record.ts`). 엔진 오류가 없을 때도 그 줄을 적기 때문에 내보낸다. */
export const GAP_LABEL: Record<GapKind, string> = {
  skipped: "검사하지 않은 파일",
  unparsed: "일부를 읽지 못한 파일",
  incomplete: "엔진이 끝내지 못한 파일",
  "engine-errors": "엔진 오류",
};

// 상태 칩에 적힌 이름 그대로 부른다.
const LEFT_UNCERTAIN = `이 파일의 발견이 '${STATUS_LABEL.uncertain}'로 남았을 수 있습니다.`;

const MEANING: Record<GapKind, string> = {
  skipped: "코드를 보지 않았습니다. 이 파일들에서 나올 수 있었던 발견은 결과에 없습니다.",
  unparsed: `검사했지만 구문을 다 읽지 못했습니다. 구문을 봐야 하는 조건이 '모름'이 되어, ${LEFT_UNCERTAIN}`,
  incomplete:
    "검사했지만 엔진이 조건을 끝까지 돌리지 못했습니다(시간 초과·메모리 부족 등). " +
    `끝나지 않은 조건이 '모름'이 되어, ${LEFT_UNCERTAIN}`,
  "engine-errors": `어느 파일에서 난 오류인지 엔진이 밝히지 않았습니다. CLI 는 이때 함께 검사한 파일을 모두 '${GAP_LABEL.incomplete}'에 넣습니다.`,
};

/**
 * 검사하지 않은 까닭. CLI 가 건너뛰는 다섯 가지를 적되(CLI README 의 "써 보기", CLI 소스 `discover.py` 의
 * SKIP_LABELS), 이 결과의 파일이 어느 까닭인지는 결과에 없다고 적는다. 까닭을 짐작해 파일마다 붙이지 않는다.
 *
 * 둘째는 CLI 가 부르는 이름("축소·번들 파일") 그대로 적는다. 축소되지 않았어도 이름이 `.bundle.js`·`.pnp.cjs` 처럼
 * 끝나는 파일이 여기에 든다. "축소 파일"이라고만 적으면 그런 파일이 다섯 까닭 가운데 어느 것에도 맞지 않는다.
 * 그 이름에 가운뎃점이 들어 있어서 까닭 사이는 쉼표로 나눈다.
 */
const SKIPPED_NOTE =
  "건너뛴 까닭(1MB 초과, 축소·번들 파일, 읽을 권한 없음, .mts 같은 확장자, UTF-8 아님)은 결과에 실려 있지 않습니다.";

function row(kind: GapKind, count: number, files: GapFile[], texts: string[] = []): GapRow {
  const unit = kind === "engine-errors" ? "건" : "개";
  return {
    kind,
    label: GAP_LABEL[kind],
    count,
    countText: count === 0 ? "없음" : `${count}${unit}`,
    meaning: count === 0 ? null : MEANING[kind],
    note: count > 0 && kind === "skipped" ? SKIPPED_NOTE : null,
    files,
    texts,
  };
}

/**
 * 엔진이 실려 있지 않은 결과의 맨 위 경고. 파일 수가 없는 결과(SARIF)에서 "검사한 파일이 없습니다" 대신 쓴다.
 *
 * CLI 는 검사할 파일이 없으면 엔진을 돌리지 않고 빈 결과를 낸다(CLI 소스 `cli.py` 의 cmd_scan. 빈 폴더와 축소 파일만
 * 든 폴더를 검사해 확인했다). JSON 은 그때 `files: 0`, `engine: null` 이고, SARIF 는 엔진(`tool.extensions`)만 빠진다.
 * 파일 수는 SARIF 에 없으므로 0개였다고 적지 않는다. 결과에 실린 사실(엔진을 돌리지 않았다)과, CLI 가 언제 그렇게
 * 하는지만 적는다. `--diff` 로 돌려 바뀐 파일이 없을 때 CI 에 올라가는 빈 SARIF 가 이 모양이다(CLI README).
 */
export const NO_ENGINE = {
  lead: "엔진을 돌리지 않은 결과입니다.",
  why: "CLI 는 검사할 파일이 없을 때 엔진을 돌리지 않습니다.",
};

/**
 * 맨 위 경고. 결과의 `coverage_complete` 가 거짓이면 둔다. 목록이 비어 있지 않은데 참으로 실린 결과(CLI 는 그렇게
 * 내지 않는다)와 검사한 파일이 0개인 결과에도 둔다. CLI 는 검사할 파일이 없어도 `coverage_complete: true` 로 낸다.
 *
 * 엔진이 실려 있지 않은 결과에도 둔다(`NO_ENGINE`). 파일 수가 0으로 실려 있으면 "검사한 파일이 없습니다"가 더 곧은
 * 말이므로 그것을 쓴다.
 */
function warning(view: ReportView, rows: GapRow[]): CoverageSummary["warning"] {
  const listed = rows.filter((r) => r.count > 0);
  const noFiles = view.coverage.files === 0;
  const noEngine = view.engine === null;
  if (listed.length === 0 && view.coverage.complete && !noFiles && !noEngine) return null;

  const lead = noFiles ? "검사한 파일이 없습니다." : noEngine ? NO_ENGINE.lead : "다 보지 못한 검사입니다.";
  if (listed.length > 0) {
    const counts = listed.map((r) => `${r.label} ${r.countText}`).join(" · ");
    return { lead, detail: `${counts}. 아래 '${GAPS_TITLE}' 표에서 확인하세요.` };
  }
  if (!view.coverage.complete) {
    return { lead, detail: "결과에는 다 보지 못했다고만 실려 있고, 무엇을 보지 못했는지는 실려 있지 않습니다." };
  }
  // 목록이 비어 있으면 왜 엔진을 돌리지 않았는지 짐작할 것이 없다. CLI 가 언제 그렇게 하는지를 적는다.
  return { lead, detail: noEngine && !noFiles ? NO_ENGINE.why : null };
}

export function coverageSummary(view: ReportView): CoverageSummary {
  const { coverage } = view;

  // 목록의 경로와 발견의 경로는 CLI 가 같은 기준으로 낸다(CLI 소스 `report/json_out.py`). 글자 그대로 견준다.
  const found = new Map<string, number>();
  for (const policy of view.policies) {
    for (const location of policy.locations) found.set(location.file, (found.get(location.file) ?? 0) + 1);
  }
  const examined = (files: string[]): GapFile[] => files.map((file) => ({ file, findings: found.get(file) ?? 0 }));

  const rows = [
    row("skipped", coverage.skipped.length, coverage.skipped.map((file) => ({ file, findings: null }))),
    row("unparsed", coverage.unparsed.length, examined(coverage.unparsed)),
    row("incomplete", coverage.incomplete.length, examined(coverage.incomplete)),
  ];
  if (coverage.engineErrors > 0) rows.push(row("engine-errors", coverage.engineErrors, [], coverage.engineErrorTexts));

  const files = coverage.files === null ? "검사한 파일 수 알 수 없음" : `파일 ${coverage.files}개 검사`;
  const units = coverage.units === null ? "판정 단위 수 알 수 없음" : `판정 단위 ${coverage.units}개`;
  return {
    warning: warning(view, rows),
    line: `${files} · ${units}`,
    lineNote: view.contract === "sarif" ? SARIF_COUNTS_NOTE : null,
    rows,
  };
}
