"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

const OPEN_MENU = ".site-header details.menu[open]";

function closeMenus() {
  for (const menu of document.querySelectorAll<HTMLDetailsElement>(OPEN_MENU)) menu.open = false;
}

/**
 * 머리글 메뉴의 링크 가운데 지금 쪽의 것. 조문 도감은 정책 하나의 쪽(/policy/<id>/)에서도, 사례는 사례 하나의 쪽(/cases/<이름>/)
 * 에서도 지금 쪽이다. 최근 분석(/search/)은 질의 없는 검색 쪽에서만이다. 주소의 질의는 이 부품이 읽지 않고, 그 쪽이 본문에 남긴
 * 표시(`data-page="search-home"`)로 가린다.
 */
function isCurrent(href: string, pathname: string) {
  const path = pathname.endsWith("/") ? pathname : `${pathname}/`;
  if (href === "/policy/" || href === "/cases/") return path.startsWith(href);
  if (href === "/search/") return path === href && document.querySelector('main [data-page="search-home"]') !== null;
  return path === href;
}

/** 쪽 이동 중 표시를 거두는 늦은 한계(이동이 실패하거나 같은 쪽으로 끝나도 표시가 남지 않게). */
const PENDING_LIMIT_MS = 20_000;
let pendingFrom: string | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | undefined;
let pendingPoll: ReturnType<typeof setInterval> | undefined;

/**
 * 쪽 이동 중 표시(2026-11-12 오너 지시: 누르면 100ms 안에 보이는 반응). 서버가 그리는 동안 앞 쪽이 멈춘 듯 보이지 않게, 누른 즉시
 * `html[data-nav]`(맨 위 진행 막대, 늦으면 본문을 흐림. CSS)와 본문의 `aria-busy` 를 단다. 주소가 바뀌면 거둔다(0.1초마다 본다:
 * 질의만 바뀌고 본문이 같은 이동도 놓치지 않게). 갈 곳이 지금 쪽이면 달지 않는다.
 */
function startPending() {
  pendingFrom = location.href;
  document.documentElement.dataset.nav = "pending";
  document.querySelector("main")?.setAttribute("aria-busy", "true");
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(stopPending, PENDING_LIMIT_MS);
  clearInterval(pendingPoll);
  pendingPoll = setInterval(settlePending, 100);
}

/** 다른 부품이 클라이언트에서 옮기기 전에 부른다(키보드로 고른 자동 완성 줄, 분석 요청 뒤). 지금 쪽으로 가면 아무것도 하지 않는다. */
export function showNavigationPending(href: string) {
  if (isOtherPage(new URL(href, location.href))) startPending();
}

function stopPending() {
  pendingFrom = null;
  clearTimeout(pendingTimer);
  clearInterval(pendingPoll);
  delete document.documentElement.dataset.nav;
  document.querySelector("main")?.removeAttribute("aria-busy");
}

/** 주소가 누른 때와 달라졌으면(이동이 끝났으면) 표시를 거둔다. */
function settlePending() {
  if (pendingFrom !== null && location.href !== pendingFrom) stopPending();
}

/** 이 사이트의 다른 쪽(경로나 질의가 다른 곳)으로 가는 주소인지. 같은 쪽 안의 자리 옮김(#)·다른 사이트는 아니다. */
function isOtherPage(url: URL) {
  return url.origin === location.origin && (url.pathname !== location.pathname || url.search !== location.search);
}

/** 링크 누름이 이 창에서 다른 쪽으로 옮기는 것인지(새 창·새 탭·내려받기는 아니다). */
function opensPage(event: MouseEvent) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  const link = (event.target as Element | null)?.closest?.("a[href]");
  if (!(link instanceof HTMLAnchorElement) || (link.target && link.target !== "_self") || link.hasAttribute("download")) return false;
  return isOtherPage(new URL(link.href, location.href));
}

/**
 * 검색 양식(GET)을 보내면 갈 주소가 다른 쪽인지. 빈 값(빈칸만 있어도)은 주소에 넣지 않는다: 검색창은 빈 질의를 질의 없는
 * /search/ 로 보낸다(`SearchCombobox`).
 */
function submitsPage(event: SubmitEvent) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.method.toLowerCase() !== "get") return false;
  const url = new URL(form.action, location.href);
  for (const [name, value] of new FormData(form)) if (typeof value === "string" && value.trim() !== "") url.searchParams.append(name, value);
  return isOtherPage(url);
}

function markCurrent(pathname: string) {
  for (const link of document.querySelectorAll<HTMLAnchorElement>(".site-header nav a")) {
    if (isCurrent(link.getAttribute("href") ?? "", pathname)) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}

/**
 * 머리글의 작은 브라우저 부품. 아무것도 그리지 않고 어디에도 요청하지 않는다(머리글의 HTML 은 모든 쪽에서 같다).
 *
 * - 좁은 화면의 메뉴(`details.menu`)를 쪽을 옮긴 뒤에 닫는다. 루트 레이아웃은 클라이언트 이동 사이에 남아서, 그대로 두면 메뉴의
 *   링크를 눌러 다른 쪽으로 가도 메뉴가 펼친 채 남는다. 지금 쪽의 링크를 누르면 주소가 그대로라 그때도 닫는다.
 * - 초점이 메뉴 밖으로 나가거나 메뉴 밖을 누르면 닫는다. 펼친 메뉴는 본문 위에 떠서, 열린 채 두면 초점이 간 검색창·단추를 덮는다.
 *   Esc 로도 닫고, 초점이 메뉴 안에 있었을 때만 메뉴의 이름으로 돌려보낸다.
 * - 메뉴의 링크 가운데 지금 쪽의 것에 `aria-current="page"` 를 단다(보이는 표시는 CSS 의 :has 가 스크립트 없이도 한다).
 *   검색 쪽은 질의만 바뀌어도(주소의 경로는 그대로) 본문이 바뀌므로, 본문이 바뀔 때도 다시 본다.
 *
 * - 이 사이트의 다른 쪽으로 가는 링크를 누르거나 검색을 보내면, 그 쪽이 그려질 때까지 이동 중 표시를 단다(`startPending`).
 *
 * 스크립트가 없어도 메뉴는 열고 닫히고(details), 검색은 보통의 GET 양식으로 된다.
 */
export function HeaderBehavior() {
  const pathname = usePathname();

  useEffect(() => {
    closeMenus();
    markCurrent(pathname);
    settlePending();
    const main = document.querySelector("main");
    if (!main) return;
    let frame = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        markCurrent(pathname);
        // 검색 쪽처럼 경로는 그대로이고 질의만 바뀐 이동도 본문이 바뀔 때 끝난다.
        settlePending();
      });
    });
    observer.observe(main, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
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
    // 쪽 이동 중 표시: 링크(Link 도 a 다)와 검색 양식. 잡는 단계에서 본다(Link 는 제 손잡이에서 기본 동작을 막고 클라이언트에서
    // 옮긴다). 자동 완성의 줄을 고를 때(엔터)는 그 부품이 router.push 로 옮기므로 그 링크의 클릭과 같은 길이 아니다: 표시는
    // 주소가 바뀌면 거두므로 남지 않는다.
    const onNavClick = (event: MouseEvent) => {
      if (opensPage(event)) startPending();
    };
    const onSubmit = (event: SubmitEvent) => {
      if (submitsPage(event)) startPending();
    };
    const onPopState = () => settlePending();
    // 뒤로·앞으로 가기로 되살아난 쪽(bfcache)은 이동 중이 아니다. 떠날 때의 표시가 그대로 남아 있을 수 있다.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) stopPending();
    };
    document.addEventListener("click", onClick);
    document.addEventListener("click", onNavClick, true);
    document.addEventListener("submit", onSubmit, true);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("keydown", onKey);
    window.addEventListener("popstate", onPopState);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("click", onNavClick, true);
      document.removeEventListener("submit", onSubmit, true);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("pageshow", onPageShow);
      stopPending();
    };
  }, []);

  return null;
}
