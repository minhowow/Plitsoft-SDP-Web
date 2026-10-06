import { STATUS_HINT, STATUS_LABEL, type Status } from "@/lib/report/status";

export function StatusChip({ status }: { status: Status }) {
  return (
    <span className={`chip chip-${status}`} title={STATUS_HINT[status]}>
      {STATUS_LABEL[status]}
    </span>
  );
}
