import type { Status } from "@/lib/report/status";
import type { PolicyView, ReportView } from "@/lib/report/view-model";

/** 한 판에서 본 정책 하나. 정책 카드에 보이는 것과 같다(상태, 발견 수, AI 가 푼 경고의 수). */
export interface CompareCell {
  status: Status;
  /** 그 정책의 발견 수. 정책 카드의 "발견 N건"과 같은 수다(규칙 묶음의 수가 아니다). */
  findings: number;
  /**
   * AI 의 '예'로 풀린 경고의 수. 발견에는 들어 있지 않다. 정책 카드는 발견이 없는 정책에 "발견 없음"의 풀이 대신 이
   * 사실을 적는다. 표도 숨기지 않는다(docs/commitments.md 의 "AI 가 푼 것을 숨기지 않는다"). 판정자 없이 검사한
   * 결과에서는 늘 0 이다.
   */
  aiCleared: number;
}

export interface CompareRow {
  id: string;
  title: string;
  /** 판마다 하나. 받은 결과의 순서다(고치기 전, 고친 뒤). */
  cells: CompareCell[];
}

/** 표의 줄이 되는 정책인지: 발견이 있거나, AI 가 푼 경고가 있다. */
const reported = (policy: PolicyView) => policy.locations.length > 0 || policy.aiCleared > 0;

/**
 * 같은 코드의 여러 판(고치기 전·후)을 검사한 결과를 정책별로 나란히 놓는다. 어느 판에라도 발견이나 AI 가 푼 경고가
 * 있는 정책만 줄이 된다. 줄은 앞의 판에서 먼저 봐야 할 정책부터다.
 *
 * 결과마다 정책 카드에 보이는 것을 옮길 뿐이다. 두 결과 사이에서 무엇이 풀렸고 무엇이 새로 생겼는지를 가려 적지
 * 않는다. 그러려면 두 결과의 발견을 짝지어야 하는데, 지문으로는 짝지을 수 없다. 지문은 줄 둘레의 코드로
 * 만들어서(CLI 소스 `report/fingerprint.py`), 코드를 고치면 판정이 같아도 지문이 달라지고(`night-push`), 둘레가
 * 그대로면 판정이 달라져도 지문이 같다(`genai-chat`).
 */
export function compareByPolicy(views: ReportView[]): CompareRow[] {
  const found = views.flatMap((view) => view.policies.filter(reported));
  const ids = [...new Set(found.map((policy) => policy.id))];
  return ids.map((id) => ({
    id,
    title: found.find((policy) => policy.id === id)!.title,
    cells: views.map((view) => {
      const policy = view.policies.find((p) => p.id === id);
      // 그 결과에 이 정책의 카드가 없다(팩의 판이 다른 결과). 발견이 없었다고 하지 않는다.
      if (!policy) return { status: "pack-unknown", findings: 0, aiCleared: 0 };
      return { status: policy.status, findings: policy.locations.length, aiCleared: policy.aiCleared };
    }),
  }));
}

/**
 * 데모의 표에 싣는 줄 전부: `compareByPolicy` 의 줄(발견이나 AI 가 푼 경고가 있는 정책) 다음에, 결과에 실린 나머지 정책을 결과의
 * 차례대로 둔다. 데모의 결과 칸에는 곁칸 `정책 N` 이 없어서(docs/redesign.md 3장 "데모", D7) 이 표가 정책 목록을 지닌다. 발견이
 * 0인 판의 `검사한 것` 이 이 표를 정책 목록으로 가리킨다. 칸은 위와 같이 그 결과에 실린 상태를 옮긴다.
 */
export function compareAllPolicies(views: ReportView[]): CompareRow[] {
  const rows = compareByPolicy(views);
  const listed = new Set(rows.map((row) => row.id));
  const rest = views.flatMap((view) => view.policies).filter((policy) => !listed.has(policy.id));
  const ids = [...new Set(rest.map((policy) => policy.id))];
  return [
    ...rows,
    ...ids.map((id) => ({
      id,
      title: rest.find((policy) => policy.id === id)!.title,
      cells: views.map((view): CompareCell => {
        const policy = view.policies.find((p) => p.id === id);
        if (!policy) return { status: "pack-unknown", findings: 0, aiCleared: 0 };
        return { status: policy.status, findings: policy.locations.length, aiCleared: policy.aiCleared };
      }),
    })),
  ];
}

/** 두 판 모두 같은 0의 상태라 표의 줄로 두지 않고 한 덩어리로 적는 정책들. */
export interface QuietGroup {
  status: Status;
  policies: { id: string; title: string }[];
}

/** 묶는 상태: 발견이 0인 상태. 곁칸의 묶음과 같은 차례다. 충족 근거 발견은 아래 결과에 상자가 있어 줄로 둔다. */
const QUIET: Status[] = ["no-signal", "not-reported", "pack-unknown"];

/**
 * 데모의 표(docs/redesign.md D7 의 검토 반영): `compareAllPolicies` 의 줄 가운데 모든 판의 칸이 같은 0의 상태(발견 없음 등)이고
 * 발견도 AI 가 푼 경고도 없는 줄은 상태마다 한 덩어리(`quiet`)로 묶고, 나머지(`rows`)만 표의 줄로 둔다. 곁칸이 발견 없는 정책을
 * 상태마다 묶던 것과 같다. 정책은 하나도 빠지지 않는다(줄이거나 묶음에 있다). 표가 첫 화면을 다 차지하지 않게 한다.
 */
export function compareTable(views: ReportView[]): { rows: CompareRow[]; quiet: QuietGroup[] } {
  const all = compareAllPolicies(views);
  const quietStatus = (row: CompareRow): Status | null => {
    const [first] = row.cells;
    if (first === undefined || !QUIET.includes(first.status)) return null;
    const same = row.cells.every((cell) => cell.status === first.status && cell.findings === 0 && cell.aiCleared === 0);
    return same ? first.status : null;
  };
  return {
    rows: all.filter((row) => quietStatus(row) === null),
    quiet: QUIET.map((status) => ({
      status,
      policies: all.filter((row) => quietStatus(row) === status).map(({ id, title }) => ({ id, title })),
    })).filter((group) => group.policies.length > 0),
  };
}
