"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

const OPEN_MENU = ".site-header details.menu[open]";

function closeMenus() {
  for (const menu of document.querySelectorAll<HTMLDetailsElement>(OPEN_MENU)) menu.open = false;
}

/** 머리글 메뉴의 링크 가운데 지금 쪽의 것. 조문 도감은 정책 하나의 쪽(/policy/<id>/)에서도 지금 쪽이다. */
function isCurrent(href: string, pathname: string) {
  const path = pathname.endsWith("/") ? pathname : `${pathname}/`;
  return href === "/policy/" ? path.startsWith("/policy/") : path === href;
}

/**
 * 머리글의 작은 브라우저 부품. 아무것도 그리지 않고 어디에도 요청하지 않는다(머리글의 HTML 은 모든 쪽에서 같다).
 *
 * - 좁은 화면의 메뉴(`details.menu`)를 쪽을 옮긴 뒤에 닫는다. 루트 레이아웃은 클라이언트 이동 사이에 남아서, 그대로 두면 메뉴의
 *   링크를 눌러 다른 쪽으로 가도 메뉴가 펼친 채 남는다. 지금 쪽의 링크를 누르면 주소가 그대로라 그때도 닫는다.
 * - 초점이 메뉴 밖으로 나가거나 메뉴 밖을 누르면 닫는다. 펼친 메뉴는 본문 위에 떠서, 열린 채 두면 초점이 간 검색창·단추를 덮는다.
 *   Esc 로도 닫고, 초점이 메뉴 안에 있었을 때만 메뉴의 이름으로 돌려보낸다.
 * - 메뉴의 링크 가운데 지금 쪽의 것에 `aria-current="page"` 를 단다(보이는 표시는 CSS 의 :has 가 스크립트 없이도 한다).
 *
 * 스크립트가 없어도 메뉴는 열고 닫히고(details), 검색은 보통의 GET 양식으로 된다.
 */
export function HeaderBehavior() {
  const pathname = usePathname();

  useEffect(() => {
    closeMenus();
    for (const link of document.querySelectorAll<HTMLAnchorElement>(".site-header nav a")) {
      if (isCurrent(link.getAttribute("href") ?? "", pathname)) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
  }, [pathname]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest(".site-header .menu-pop a")) closeMenus();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      for (const menu of document.querySelectorAll<HTMLDetailsElement>(OPEN_MENU)) {
        if (!target || !menu.contains(target)) menu.open = false;
      }
    };
    const onFocusOut = (event: FocusEvent) => {
      const menu = (event.target as Element | null)?.closest?.<HTMLDetailsElement>(".site-header details.menu");
      if (!menu?.open) return;
      const next = event.relatedTarget as Node | null;
      // 창 밖으로 초점이 나간 때(next 가 없다)는 그대로 둔다. 창으로 돌아오면 같은 자리다.
      if (next && !menu.contains(next)) menu.open = false;
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const open = document.querySelector<HTMLDetailsElement>(OPEN_MENU);
      if (!open) return;
      const inside = open.contains(document.activeElement);
      open.open = false;
      if (inside) open.querySelector("summary")?.focus();
    };
    document.addEventListener("click", onClick);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return null;
}
