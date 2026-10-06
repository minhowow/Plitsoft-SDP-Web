"use client";

import { useRef, type MouseEvent, type ReactNode } from "react";
import { blocksToggle } from "./selection";

/** 누른 자리에서 이만큼(px) 넘게 움직였으면 끈 것으로 본다. 누르다 손이 조금 떨린 것은 끈 것이 아니다. */
const DRAG_PX = 4;

/**
 * 발견 줄의 머리. 줄 전체가 펼침 단추(summary)다. 경로를 끌어 골라 복사해도 줄이 여닫히지 않게 한다.
 * 스크립트가 돌기 전이거나 꺼져 있으면 브라우저의 기본 동작 그대로다(어디를 눌러도 여닫힌다).
 */
export function FindingSummary({ children }: { children: ReactNode }) {
  // 마우스를 누른 자리. 뗀 자리와 견주어 끌었는지 본다.
  const pressedAt = useRef<{ x: number; y: number } | null>(null);
  // 이어 누르는 동안(더블 클릭 등) 이 줄이 여닫힌 횟수.
  const toggles = useRef(0);

  function onMouseDown(event: MouseEvent<HTMLElement>) {
    pressedAt.current = { x: event.clientX, y: event.clientY };
  }

  function onClick(event: MouseEvent<HTMLElement>) {
    if (event.detail <= 1) toggles.current = 0;
    const from = pressedAt.current;
    const dragged =
      event.detail > 0 &&
      from !== null &&
      (Math.abs(event.clientX - from.x) > DRAG_PX || Math.abs(event.clientY - from.y) > DRAG_PX);
    const selection = window.getSelection();
    const selecting =
      selection !== null &&
      !selection.isCollapsed &&
      selection.containsNode(event.currentTarget, true) &&
      selection.toString() !== "";
    const block = blocksToggle({
      detail: event.detail,
      selecting,
      extending: dragged || event.shiftKey,
      toggles: toggles.current,
    });
    if (block) event.preventDefault();
    else toggles.current += 1;
  }

  return (
    <summary onMouseDown={onMouseDown} onClick={onClick}>
      {children}
    </summary>
  );
}
