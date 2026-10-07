import { STATUS_HINT, STATUS_LABEL, type Status } from "@/lib/report/status";

/**
 * 상태 칩. 마우스를 올리면 상태의 뜻이 보인다. 뜻은 정책 카드 안에서 쓰는 말(`STATUS_HINT`)이다. 정책 카드 밖에서
 * 상태의 뜻을 풀이로 적는 자리에서는 그 자리의 말을 `hint` 로 준다(칩 옆의 글과 다른 말이 뜨지 않게).
 */
export function StatusChip({ status, hint = STATUS_HINT[status] }: { status: Status; hint?: string }) {
  return (
    <span className={`chip chip-${status}`} title={hint}>
      {STATUS_LABEL[status]}
    </span>
  );
}
