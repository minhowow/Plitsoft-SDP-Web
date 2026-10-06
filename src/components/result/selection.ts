/** 발견 줄(summary)을 한 번 누른 일. 브라우저의 click 이벤트에서 뽑는다. */
export interface RowClick {
  /** click 이벤트의 detail. 키보드로 누르면 0, 마우스는 이어 누른 횟수(1, 2, 3 …)다. */
  detail: number;
  /** 이 줄 안의 글이 지금 골라져 있는지. */
  selecting: boolean;
  /** 선택을 만들거나 늘리는 동작이었는지: 누른 채 끌었거나, Shift 를 누른 채 눌렀다. */
  extending: boolean;
  /** 이어 누르는 동안(더블 클릭 등) 이 줄이 이미 여닫힌 횟수. */
  toggles: number;
}

/**
 * 발견 줄을 누른 것이 글을 고르던 것이면 펼침을 바꾸지 않는다. 막아야 하면 true.
 *
 * 줄 안의 경로는 복사해 가는 글이라 고를 수 있어야 한다. 그런데 줄 전체가 펼침 단추라서, 끌어서 고르면 끌기 끝의
 * 클릭이 줄을 여닫아 버린다. 글을 고르는 동안에는 줄이 처음 상태 그대로 남게(여닫힌 횟수가 짝수로 끝나게) 맞춘다.
 */
export function blocksToggle({ detail, selecting, extending, toggles }: RowClick): boolean {
  // 골라진 글이 없으면 그냥 누른 것이다. 키보드(Enter·Space)로 누른 것도 글을 고르는 동작이 아니다.
  if (!selecting || detail === 0) return false;
  // 한 번 누름: 끌거나 Shift 로 고른 것만 막는다. 이미 골라져 있던 글 위를 그냥 누른 것은 여닫으려는 것이다.
  if (detail === 1) return extending;
  // 두 번·세 번 이어 눌러 낱말이나 줄을 골랐다. 첫 번째 누름은 이미 지나갔으므로, 그때 여닫혔으면 이번에 되돌리고
  // (막지 않는다) 되돌린 뒤에는 더 바꾸지 않는다(막는다).
  return toggles % 2 === 0;
}
