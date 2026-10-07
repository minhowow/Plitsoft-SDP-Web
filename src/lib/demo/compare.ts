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
