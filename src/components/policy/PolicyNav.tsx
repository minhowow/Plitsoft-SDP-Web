"use client";

import { useEffect, type MouseEvent, type ReactNode } from "react";
import { moveTo } from "@/lib/scroll";

/**
 * 조문 도감 정책 쪽의 작은 브라우저 부품 둘. 어디에도 요청하지 않고, 주소와 방문 기록을 건드리지 않는다.
 *
 * 쪽 안의 자리로 가는 링크(`#legal`, `#rules`)를 브라우저에 그대로 맡기면, 다른 쪽에 다녀온 뒤 뒤로 가기가 어긋난다(까닭은
 * `lib/scroll.ts` 의 `moveTo`). 그래서 누르면 직접 옮긴다. 스크립트가 붙기 전이나 꺼진 브라우저에서는 해시 링크 그대로 듣는다.
 */
export function JumpLink({ target, children }: { target: string; children: ReactNode }) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // 새 탭으로 열기처럼 다른 키를 함께 누른 것은 브라우저에 맡긴다.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const element = document.getElementById(target);
    if (!element) return;
    event.preventDefault();
    moveTo(element);
  };
  return (
    <a href={`#${target}`} onClick={onClick}>
      {children}
    </a>
  );
}

/**
 * 주소의 자리(#rule-…)가 규칙 줄(접어 둔 details)이면 펼친다. 결과 화면의 규칙 id 링크(`RuleId`)가 이 자리로 온다. 접힌 채로는
 * 규칙의 이름 줄만 보여서, 온 까닭(그 규칙의 대안과 질문)이 바로 보이지 않는다. 아무것도 그리지 않는다.
 */
export function OpenTargetRule() {
  useEffect(() => {
    const open = () => {
      let id: string;
      try {
        id = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        return;
      }
      if (!id) return;
      const element = document.getElementById(id);
      if (element instanceof HTMLDetailsElement && element.classList.contains("rule-row")) element.open = true;
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  return null;
}
