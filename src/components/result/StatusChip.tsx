import { STATUS_LABEL, type Status } from "@/lib/report/status";

/**
 * 상태 칩(채운 알약. 판정 상태에만 쓴다). 상태의 이름만 적는다. 뜻은 `title` 속성에 숨기지 않는다(터치와 키보드에서 보이지
 * 않는다. docs/redesign.md 2.1). 상태의 뜻 전체는 조문 도감의 `#status` 한 곳에 있고, 결과 화면의 곁칸이 그곳으로 잇는다.
 */
export function StatusChip({ status }: { status: Status }) {
  return <span className={`chip chip-${status}`}>{STATUS_LABEL[status]}</span>;
}
