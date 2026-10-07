// 스크롤 자리를 다룬다: 브라우저가 되살린 자리, 같은 쪽 안에서 옮겨 가기. 브라우저에서만 부른다(부품의 effect 나
// 이벤트 처리 안).
//
// 고른 것을 메모리에만 두는 쪽(`/view` 의 연 결과, `/demo` 의 고른 앱과 판)은 문서를 다시 받으면 처음 화면으로
// 돌아간다. 그런데 브라우저는 앞서 보던 스크롤 자리를 되살린다. 그대로 두면 처음 화면의 한가운데에 놓여, 무엇이 열려
// 있는지 알리는 제목과 "합성 예시입니다"가 화면 밖에 있다.

/** 브라우저가 되살린 스크롤 자리를 맨 위로 되돌리며 지켜보는 시간(ms). 문서를 다 받은 때부터 잰다(아래 `startAtTop`). */
const RESTORE_WATCH_MS = 500;

/** 사람이 무엇인가 하기 시작했다는 것을 알려 주는 이벤트. 그 뒤로는 스크롤을 건드리지 않는다. */
const USER_ACTS = ["wheel", "touchstart", "keydown", "pointerdown", "dragenter"] as const;

/** 이 문서를 새로 고침이나 뒤로·앞으로 가기로 다시 받았는지. 그때 브라우저는 앞서 보던 스크롤 자리를 되살린다. */
export function documentWasRestored(): boolean {
  const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  return entry?.type === "reload" || entry?.type === "back_forward";
}

/**
 * 브라우저가 스크롤 자리를 되살려도 맨 위에서 시작하게 한다. 되살릴 것(메모리에 둔 것)이 없을 때 쓴다. 돌려준 함수를
 * 부르면 그만둔다.
 *
 * 붙을 때 한 번 올리는 것으로는 모자란다. 브라우저가 자리를 되살리는 때가 그 뒤일 수 있다(Chrome 154 에서 쟀다. 문서를
 * 다 받은 직후에 한 번 더 되살리고, 같은 문서 안에서 뒤로 왔을 때는 다음 화면을 그리면서 되살린다). 그래서 문서를 다
 * 받고 RESTORE_WATCH_MS 가 지날 때까지 지켜보다가, 스크롤이 움직이면 다시 올린다. 사람이 무엇인가 하기 시작하면
 * 곧바로 그만둔다.
 */
export function startAtTop(): () => void {
  let timer: number | undefined;
  function toTop() {
    if (window.scrollY !== 0) window.scrollTo(0, 0);
  }
  function stop() {
    window.clearTimeout(timer);
    window.removeEventListener("scroll", toTop);
    window.removeEventListener("load", arm);
    for (const type of USER_ACTS) window.removeEventListener(type, stop);
  }
  function arm() {
    timer = window.setTimeout(stop, RESTORE_WATCH_MS);
  }
  window.addEventListener("scroll", toTop, { passive: true });
  for (const type of USER_ACTS) window.addEventListener(type, stop, { passive: true });
  if (document.readyState === "complete") arm();
  else window.addEventListener("load", arm);
  toTop();
  return stop;
}

/**
 * 같은 쪽 안의 요소로 옮겨 간다. 그 요소를 창의 위쪽에 놓고 키보드 초점도 그리로 옮긴다(다음 Tab 이 그 안에서
 * 이어진다). 주소와 방문 기록은 건드리지 않고, 요청도 내보내지 않는다.
 *
 * 해시 링크(`<a href="#id">`)를 브라우저에 그대로 맡기지 않는 까닭이 있다(Next 16.3.8, 헤드리스 Chrome 154 에서 봤다).
 * - 브라우저는 방문 기록에 새 항목을 더하는데, 그 항목에는 Next 의 라우터가 남기는 상태가 없다. 그 뒤 다른 쪽에 갔다가
 *   뒤로 오면 라우터가 그 항목을 알아보지 못해, 주소만 돌아오고 화면은 다녀온 쪽 그대로다.
 * - Next 의 라우터로 해시만 바꾸면(`router.push("#id")` 로 해 봤다) 그 일은 없다. 그런데 받아 둔 경로 정보가 낡으면
 *   요청이 나간다. 쪽을 연 지 6분 뒤에 해 보니 `/demo/index.txt` 를 다시 받았다(곧바로 했을 때는 0건).
 */
export function moveTo(target: HTMLElement): void {
  target.scrollIntoView();
  // 초점을 받지 못하는 요소면 받을 수 있게 했다가, 초점이 떠나면 되돌린다. 늘 받을 수 있게 두면 그 안의 빈 곳을 누를
  // 때마다 초점이 그 요소로 옮겨 간다.
  if (!target.hasAttribute("tabindex")) {
    target.setAttribute("tabindex", "-1");
    target.addEventListener("blur", () => target.removeAttribute("tabindex"), { once: true });
  }
  target.focus({ preventScroll: true });
}
