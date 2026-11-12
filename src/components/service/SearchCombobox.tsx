"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import Form from "next/form";
import { useRouter } from "next/navigation";
import { showNavigationPending } from "@/components/HeaderBehavior";
import { Icon } from "@/components/Icon";
import { repoHref, searchHref } from "@/lib/service/href";
import { isRepoFullName } from "@/lib/service/names";
import { formatKst } from "@/lib/service/steps";
import {
  cleanSuggestText,
  FAKE_GITHUB_NOTE,
  githubStatusLine,
  matchRange,
  type GitHubSuggestion,
  type GitHubSuggestPart,
  type GitHubSuggestStatus,
  type SiteSuggestion,
  type SuggestResponse,
} from "@/lib/service/suggest";
import { SITE } from "@/lib/site";

/**
 * 저장소 검색창과 자동 완성(브라우저 부품. docs/redesign.md 5장, 목업 home.js·home-feed.js). 모든 검색창이 이것 하나를 쓴다:
 * 첫 화면(`home`), 머리글(`header`, 넓은 화면), 검색 쪽(`page`). 같은 사이트의 `GET /api/repos/suggest/` 만 부른다. 브라우저
 * 저장소를 쓰지 않는다(이 쪽의 메모리에만 둔다).
 *
 * 스크립트가 없으면 보통의 GET 양식이다(`/search/?q=…`). 스크립트가 있으면 WAI-ARIA APG 의 콤보 상자다: 입력창(role=combobox)이
 * 펼침 목록(listbox)을 `aria-activedescendant` 로 가리키고, 무리는 role=group + aria-labelledby 다. 줄은 진짜 링크다(새 탭 열기·
 * 주소 복사가 된다).
 *
 * - 빈 검색창에 초점이 와도 펼치지 않는다(최근 분석은 첫 화면과 검색 쪽의 본문에 있다). 글자를 치면 펼친다.
 * - 친 뒤 150ms 쉬면 이 사이트의 것만, 500ms 쉬면 GitHub 까지 묻는다. 새로 물으면 앞 요청을 끊는다(AbortController). 같은 질의는
 *   이 쪽의 메모리에서 다시 쓴다(1분까지. GitHub 에 묻지 못한 답과 이 사이트의 기록을 읽지 못한 답은 두지 않고 다시 묻는다).
 *   GitHub 까지 묻는 요청이 닿지 못하면(끊긴 것 말고) 'GitHub 에 묻지 못함(연결 실패)'으로 그린다(조용히 이 사이트의 줄만 두지 않는다).
 * - 고른 줄은 줄의 열쇠(`s:owner/name`, `g:owner/name`, `all`)로 기억한다. 늦게 온 GitHub 결과가 줄을 밀어도 고른 줄이 바뀌지 않고,
 *   줄의 id 도 열쇠에서 나와 aria-activedescendant 가 같은 줄을 따라간다.
 * - 한글을 조합하는 동안(isComposing, keyCode 229)은 묻지 않고 Enter·↑↓ 도 받지 않는다. 조합이 끝나면 친 것으로 본다.
 * - ↑↓ 로 줄을 고르고(끝에서 돈다), Enter 는 고른 줄로 간다(목록을 닫고 간다). 고른 줄이 없으면 양식을 보낸다(비면 /search/).
 *   Esc 는 목록을 닫고, 닫혀 있으면 친 글자를 지운다. Tab 과 초점이 떠나면 닫는다.
 * - 첫 화면(`home`): 빈 검색창에서 ↓ 는 아래 최근 분석의 첫 줄로, 그 목록 안에서 ↑↓ 는 줄 사이로, 첫 줄에서 ↑ 는 검색창으로.
 *   좁은 화면(599px 이하 또는 높이 479px 이하)에서 초점이 있는 동안 표지를 줄여 위로 올린다(`data-mode="search"`. CSS 만, 옮겨
 *   가는 움직임은 없다).
 */

type Variant = "home" | "header" | "page";

interface Props {
  variant: Variant;
  id: string;
  label: string;
  defaultValue?: string;
}

type Row =
  | { kind: "site"; key: string; href: string; row: SiteSuggestion }
  | { kind: "github"; key: string; href: string; row: GitHubSuggestion }
  | { kind: "all"; key: string; href: string };

/** 이 쪽의 메모리에 두는 답(질의마다)과 받은 때. 쪽을 떠나면 사라진다. */
const answers = new Map<string, { at: number; answer: SuggestResponse }>();
const ANSWERS_MAX = 100;
/** 메모리의 답을 다시 쓰는 시간(ms). 이 사이트의 분석 수·날짜가 너무 오래 굳지 않게. */
const ANSWERS_MS = 60_000;
/** 다시 써도 되는 GitHub 상태. 묻지 못한 답(limited·timeout·unavailable)은 두지 않는다(잠시 뒤 다시 치면 다시 묻는다). */
const KEPT: readonly GitHubSuggestStatus[] = ["ok", "skipped", "off"];
const SITE_DELAY_MS = 150;
const FULL_DELAY_MS = 500;
/** 펼침 목록의 높이 하한(px). 바닥글·소프트 키보드 위로 이보다 좁으면 그냥 넘친다. */
const MIN_POP = 132;

function remember(key: string, answer: SuggestResponse) {
  if (answer.site === null || (answer.github && !KEPT.includes(answer.github.status))) return;
  answers.delete(key);
  answers.set(key, { at: Date.now(), answer });
  while (answers.size > ANSWERS_MAX) answers.delete(answers.keys().next().value!);
}

function recall(key: string): SuggestResponse | undefined {
  const entry = answers.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.at >= ANSWERS_MS) {
    answers.delete(key);
    return undefined;
  }
  return entry.answer;
}

const SITE_LOST = "이 사이트의 분석 기록을 읽지 못함";

/** 줄의 열쇠를 id 에 쓸 수 있는 글자로(영문·숫자·`-` 밖의 글자는 `_` 와 16진수로. 서로 다른 열쇠는 서로 다른 id). */
const idPart = (key: string) => key.replace(/[^A-Za-z0-9-]/g, (char) => `_${char.charCodeAt(0).toString(16)}`);

/** 서버의 답을 믿기 전에 모양을 본다. 저장소 이름은 GitHub 이름 규칙에 맞는 것만 남긴다. */
function readAnswer(raw: unknown): SuggestResponse | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.q !== "string") return null;
  const records = (list: unknown): Record<string, unknown>[] =>
    Array.isArray(list)
      ? list.filter(
          (row): row is Record<string, unknown> =>
            typeof row === "object" && row !== null && typeof row.owner === "string" && typeof row.name === "string" && isRepoFullName(row.owner, row.name),
        )
      : [];
  const textOrNull = (value: unknown) => (typeof value === "string" ? value : null);
  const site: SiteSuggestion[] | null = Array.isArray(r.site)
    ? records(r.site)
        .filter((row) => typeof row.analyses === "number" && typeof row.latestAt === "string")
        .map((row) => ({ owner: row.owner as string, name: row.name as string, analyses: row.analyses as number, latestAt: row.latestAt as string }))
    : null;
  const gh = typeof r.github === "object" && r.github !== null ? (r.github as Record<string, unknown>) : null;
  const status = gh && STATUSES.find((name) => name === gh.status);
  const github: GitHubSuggestPart | null =
    gh && status
      ? {
          status,
          items: records(gh.items).map((row) => ({
            owner: row.owner as string,
            name: row.name as string,
            description: textOrNull(row.description),
            language: textOrNull(row.language),
          })),
          total: typeof gh.total === "number" ? gh.total : null,
          skipped: gh.skipped === "short" || gh.skipped === "chars" ? gh.skipped : undefined,
        }
      : null;
  return { q: r.q, site, github, tagged: r.tagged === true, fakeGitHub: r.fakeGitHub === true };
}

const STATUSES: readonly GitHubSuggestStatus[] = ["ok", "limited", "timeout", "unavailable", "off", "skipped"];

/** `owner / name` 을 그리고 친 글자가 든 자리를 굵게. 글은 데이터 그대로다(HTML 로 끼워 넣지 않는다). */
function MarkedName({ owner, name, text }: { owner: string; name: string; text: string }) {
  const range = matchRange(owner, name, text);
  const piece = (value: string, from: number, shown = value): ReactNode => {
    if (!range) return shown;
    const start = Math.max(range[0], from) - from;
    const end = Math.min(range[1], from + value.length) - from;
    if (start >= end) return shown;
    // 빗금 조각은 화면에 ' / ' 로 적는다. 굵게 하는 것은 빗금 글자 하나다.
    if (shown !== value) return <> <b>/</b> </>;
    return (
      <>
        {value.slice(0, start)}
        <b>{value.slice(start, end)}</b>
        {value.slice(end)}
      </>
    );
  };
  return (
    <>
      {piece(owner, 0)}
      {piece("/", owner.length, " / ")}
      {piece(name, owner.length + 1)}
    </>
  );
}

const kstDate = (iso: string) => formatKst(iso).slice(0, 10);

export function SearchCombobox({ variant, id, label, defaultValue }: Props) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const listId = `${id}-list`;
  // 친 글자(앞뒤 빈칸을 뗀 것). 한글을 조합하는 동안에는 바꾸지 않는다.
  const [text, setText] = useState((defaultValue ?? "").trim());
  const [focused, setFocused] = useState(false);
  // Esc 로 닫은 뒤에는 다시 칠 때까지 닫아 둔다.
  const [dismissed, setDismissed] = useState(false);
  // 마지막으로 받은 답. 그리는 것은 이 쪽의 메모리에 지금 글자의 답이 있으면 그것이다(아래 shown).
  const [latest, setLatest] = useState<SuggestResponse | null>(null);
  // 고른 줄의 열쇠. 그 줄을 고른 때의 글자와 함께 둔다(글자가 바뀌면 고른 줄이 풀린다). 자리(몇째 줄)로 두지 않는다: 늦게 온
  // GitHub 결과가 줄을 밀면 같은 자리에 다른 줄이 온다.
  const [pick, setPick] = useState<{ q: string; key: string | null }>({ q: "", key: null });
  const composing = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const wanted = useRef("");

  const q = cleanSuggestText(text);
  const open = focused && q !== "" && !dismissed;

  // 지금 글자의 답: GitHub 까지 물은 답, 그다음 이 사이트만 물은 답. 없으면 마지막 답(새 답을 기다리는 동안).
  const answer: SuggestResponse | null = (latest?.q === q && latest.github ? latest : null) ?? recall(`full:${q}`) ?? (latest?.q === q ? latest : null) ?? recall(`site:${q}`) ?? latest;
  // 답이 지금 친 글자의 것이 아니면(새 답을 기다리는 동안) 지금 글자가 든 줄만 남긴다. 앞 답에 없던 줄을 만들지 않는다.
  const fresh = answer !== null && answer.q === q;
  const keep = (row: { owner: string; name: string }) => fresh || matchRange(row.owner, row.name, q) !== null;
  const siteRows = open ? (answer?.site ?? []).filter(keep) : [];
  const githubRows = open ? (answer?.github?.items ?? []).filter(keep) : [];
  const rows: Row[] = open
    ? [
        ...siteRows.map((row) => ({ kind: "site" as const, key: `s:${row.owner}/${row.name}`, href: repoHref(row.owner, row.name), row })),
        ...githubRows.map((row) => ({ kind: "github" as const, key: `g:${row.owner}/${row.name}`, href: repoHref(row.owner, row.name), row })),
        { kind: "all" as const, key: "all", href: searchHref(q) },
      ]
    : [];
  const optionId = (key: string) => `${id}-opt-${idPart(key)}`;
  const active = open && pick.q === q && pick.key !== null ? rows.findIndex((row) => row.key === pick.key) : -1;
  const setActive = (index: number) => setPick({ q, key: rows[index]?.key ?? null });
  const activeId = active >= 0 ? optionId(rows[active].key) : null;
  const statusLine = fresh && answer?.github ? githubStatusLine(answer.github) : null;
  const siteLost = fresh && answer?.site === null;
  // 펼쳐 있을 때만 알린다(닫을 때 '제안 0개'를 말하지 않는다). 목록 밖의 상태 줄도 함께 말한다(가상 초점으로는 닿지 않는다).
  const announced =
    open && fresh && answer?.github
      ? [`제안 ${siteRows.length + githubRows.length}개`, siteLost ? SITE_LOST : null, statusLine].filter(Boolean).join(". ")
      : "";

  const load = useCallback(async (query: string, siteOnly: boolean) => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    try {
      const response = await fetch(`/api/repos/suggest/?q=${encodeURIComponent(query)}${siteOnly ? "&scope=site" : ""}`, {
        signal: abort.signal,
        headers: { accept: "application/json" },
      });
      const read = readAnswer(await response.json());
      if (!read) throw new TypeError("모르는 답");
      remember(`${siteOnly ? "site" : "full"}:${query}`, read);
      // 그사이 다른 글자를 쳤으면 그리지 않는다(메모리에는 둔다). GitHub 까지 물은 답을 이 사이트만 물은 답으로 덮지 않는다.
      if (wanted.current === query) setLatest((now) => (siteOnly && now?.q === query && now.github ? now : read));
    } catch {
      // 끊은 것이면 그대로 둔다. GitHub 까지 묻는 요청이 닿지 못했거나 모르는 답(플랫폼의 오류 쪽 등)이면 '연결 실패'로 그린다.
      // 이 사이트의 줄은 먼저 받은 답의 것이다(없으면 '읽지 못함'). 메모리에는 두지 않는다.
      if (abort.signal.aborted || siteOnly || wanted.current !== query) return;
      setLatest((now) => {
        const site = now?.q === query ? now : recall(`site:${query}`);
        return {
          q: query,
          site: site?.site ?? null,
          github: { status: "unavailable", items: [], total: null },
          tagged: site?.tagged ?? false,
          fakeGitHub: site?.fakeGitHub ?? false,
        };
      });
    } finally {
      if (controller.current === abort) controller.current = null;
    }
  }, []);

  // 친 글자가 바뀌면: 메모리에 있으면 묻지 않는다(위 answer 가 그것을 그린다). 없으면 150ms 뒤 이 사이트만, 500ms 뒤 GitHub 까지.
  useEffect(() => {
    wanted.current = open ? q : "";
    if (!open) {
      controller.current?.abort();
      return;
    }
    if (recall(`full:${q}`)) return;
    const timers = [
      recall(`site:${q}`) ? null : setTimeout(() => void load(q, true), SITE_DELAY_MS),
      setTimeout(() => void load(q, false), FULL_DELAY_MS),
    ];
    return () => {
      for (const timer of timers) if (timer) clearTimeout(timer);
    };
  }, [open, q, load]);

  // 고른 줄이 굴리는 칸 밖이면 보이게.
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  // 펼침 목록이 바닥글(면책)과 소프트 키보드에 가리지 않게 높이를 묶고 안에서 굴린다(목업 home.js 의 fit).
  const fit = useCallback(() => {
    const pop = popRef.current;
    if (!pop) return;
    pop.style.maxHeight = "";
    if (pop.hidden) return;
    const vv = window.visualViewport;
    const seen = vv ? vv.offsetTop + vv.height : window.innerHeight;
    const foot = document.querySelector(".site-footer");
    const footTop = foot ? foot.getBoundingClientRect().top - 16 : Infinity;
    const room = Math.min(footTop, seen - 12) - pop.getBoundingClientRect().top;
    if (pop.scrollHeight > room) pop.style.maxHeight = `${Math.max(MIN_POP, Math.floor(room))}px`;
  }, []);
  useLayoutEffect(fit);
  useEffect(() => {
    window.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("resize", fit);
    };
  }, [fit]);

  // 첫 화면: 좁은 화면의 검색 모드와, 글자를 친 동안 아래 목록을 감추는 표시. 쪽의 틀(.home)에 단다(CSS 가 짜임을 바꾼다).
  useEffect(() => {
    if (variant !== "home") return;
    const home = formRef.current?.closest<HTMLElement>("[data-page='home']");
    if (!home) return;
    if (focused) home.dataset.mode = "search";
    else delete home.dataset.mode;
    if (open) home.dataset.state = "typing";
    else delete home.dataset.state;
  }, [variant, focused, open]);

  // 자리표시 글이 입력창에 다 들어가지 않으면 짧은 글로(글자 크기는 줄이지 않는다. 휴대폰이 입력할 때 화면을 확대한다).
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const pen = document.createElement("canvas").getContext("2d");
    const fitPlaceholder = () => {
      if (!pen) return;
      const style = getComputedStyle(input);
      pen.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const room = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const want = room > 0 && pen.measureText(SITE.service.searchPlaceholder).width > room ? SITE.service.searchPlaceholderShort : SITE.service.searchPlaceholder;
      if (input.placeholder !== want) input.placeholder = want;
    };
    fitPlaceholder();
    void document.fonts?.ready.then(fitPlaceholder);
    const observer = new ResizeObserver(fitPlaceholder);
    observer.observe(input);
    return () => observer.disconnect();
  }, []);

  // 뒤로 가기로 돌아왔을 때(bfcache) 닫힌 처음 모습으로.
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      inputRef.current?.blur();
      setFocused(false);
      setDismissed(true);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  // 첫 화면의 최근 분석: 목록 안에서 ↑↓ 는 줄 사이로, 첫 줄에서 ↑ 는 검색창으로(목업 home-feed.js).
  useEffect(() => {
    if (variant !== "home") return;
    const feed = document.querySelector<HTMLElement>(".home-feed");
    if (!feed) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.key !== "ArrowDown" && event.key !== "ArrowUp") || event.altKey || event.metaKey || event.ctrlKey) return;
      const list = [...feed.querySelectorAll<HTMLElement>(".act-row")];
      const at = list.indexOf(document.activeElement as HTMLElement);
      if (at < 0) return;
      event.preventDefault();
      if (event.key === "ArrowDown") list[Math.min(at + 1, list.length - 1)].focus();
      else if (at === 0) inputRef.current?.focus();
      else list[at - 1].focus();
    };
    feed.addEventListener("keydown", onKey);
    return () => feed.removeEventListener("keydown", onKey);
  }, [variant]);

  /**
   * 쪽을 옮기기 전에 목록을 닫는다. 쪽 전체를 새로 받지 않고 클라이언트에서 옮긴다(2026-11-12: 새로 받는 동안 앞 쪽이 멈춘 듯
   * 보였다). 누른 즉시 머리글 부품의 이동 중 표시를 단다(키보드 Enter 는 클릭·보내기 이벤트가 없어 여기서 단다).
   */
  function leave(href: string) {
    setDismissed(true);
    showNavigationPending(href);
    router.push(href);
    clearHeader();
  }

  /**
   * 머리글의 검색창은 루트 레이아웃에 있어 클라이언트 이동 사이에 남는다. 이 검색창으로 떠나면 친 글자를 비운다(쪽 전체를 새로
   * 받던 때와 같게). 보내는 글(양식의 값)을 다 읽은 뒤에 비우도록 한 차례 미룬다.
   */
  function clearHeader() {
    if (variant !== "header") return;
    setTimeout(() => {
      if (inputRef.current) inputRef.current.value = "";
      setText("");
    }, 0);
  }

  function readInput() {
    setText(inputRef.current?.value.trim() ?? "");
    setDismissed(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // 한글 조합 중의 Enter·↑↓ 는 조합을 끝내는 키다. 받지 않는다.
    if (event.nativeEvent.isComposing || event.keyCode === 229 || composing.current) return;
    const value = event.currentTarget.value.trim();
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (event.altKey || event.metaKey || event.ctrlKey) return;
      if (value === "") {
        if (variant === "home" && event.key === "ArrowDown") {
          const first = document.querySelector<HTMLElement>(".home-feed .act-row");
          if (first) {
            event.preventDefault();
            first.focus();
          }
        }
        return;
      }
      event.preventDefault();
      if (!open) {
        setText(value);
        setDismissed(false);
        return;
      }
      const n = rows.length;
      if (n === 0) return;
      setActive(event.key === "ArrowDown" ? (active + 1) % n : active <= 0 ? n - 1 : active - 1);
    } else if (event.key === "Enter") {
      if (open && active >= 0 && rows[active]) {
        event.preventDefault();
        leave(rows[active].href);
      } else if (value === "") {
        event.preventDefault();
        leave("/search/");
      } else {
        // 고른 줄이 없으면 보통의 GET 양식으로 보낸다.
        setDismissed(true);
      }
    } else if (event.key === "Escape") {
      // 검색 입력창의 기본 동작(글자 지우기)을 막는다. 열려 있으면 닫기만, 닫혀 있으면 글자를 지운다.
      event.preventDefault();
      if (open) setDismissed(true);
      else if (event.currentTarget.value !== "") {
        event.currentTarget.value = "";
        setText("");
      }
    } else if (event.key === "Tab") {
      setDismissed(true);
    }
  }

  const input = (
    <input
      ref={inputRef}
      id={id}
      name="q"
      type="search"
      placeholder={SITE.service.searchPlaceholder}
      autoComplete="off"
      autoCapitalize="off"
      spellCheck={false}
      enterKeyHint="search"
      defaultValue={defaultValue}
      role="combobox"
      aria-expanded={open}
      aria-controls={listId}
      aria-autocomplete="list"
      aria-activedescendant={activeId ?? undefined}
      onFocus={() => {
        setFocused(true);
        setDismissed(false);
      }}
      onBlur={() => {
        setFocused(false);
        controller.current?.abort();
      }}
      onInput={(event) => {
        if ((event.nativeEvent as InputEvent).isComposing) return;
        // 조합이 아닌 입력이면 조합은 끝났다(compositionend 가 늦거나 오지 않는 브라우저도 있다).
        composing.current = false;
        readInput();
      }}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
        readInput();
      }}
      onKeyDown={onKeyDown}
    />
  );

  const option = (row: Row, body: ReactNode, className = "cbx-opt") => {
    const rowId = optionId(row.key);
    return (
      <a
        key={row.key}
        id={rowId}
        className={className}
        role="option"
        aria-selected={rowId === activeId}
        tabIndex={-1}
        href={row.href}
        onClick={(event) => {
          // 왼쪽 단추로 그냥 누르면 쪽 전체를 새로 받지 않고 옮긴다(Enter 와 같은 길). 새 탭·새 창은 브라우저에 맡긴다.
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          leave(row.href);
        }}
      >
        {body}
      </a>
    );
  };
  const tag = answer?.tagged ? <span className="tag">합성 예시</span> : null;

  const popup = (
    <div className="cbx-pop" ref={popRef} hidden={!open} data-github={open && fresh && answer?.github ? answer.github.status : undefined}>
      <div className="cbx-list" id={listId} role="listbox" aria-label="저장소 제안">
        <div className="cbx-scroll" role="none">
          {siteRows.length > 0 && (
            <div className="cbx-grp" role="group" aria-labelledby={`${id}-g-site`}>
              <div className="cbx-grp-h" id={`${id}-g-site`} role="presentation">
                <span>이 사이트에서 분석된 저장소</span>
                {tag}
              </div>
              {rows
                .filter((row): row is Extract<Row, { kind: "site" }> => row.kind === "site")
                .map((row) =>
                  option(
                    row,
                    <>
                      <span className="cbx-nm" translate="no">
                        <MarkedName owner={row.row.owner} name={row.row.name} text={q} />
                      </span>
                      <span className="cbx-end">
                        <span>분석 {row.row.analyses}회</span>
                        <time className="cbx-when" dateTime={row.row.latestAt}>
                          {kstDate(row.row.latestAt)}
                        </time>
                      </span>
                    </>,
                  ),
                )}
            </div>
          )}
          {githubRows.length > 0 && (
            <div className="cbx-grp" role="group" aria-labelledby={`${id}-g-gh`}>
              <div className="cbx-grp-h" id={`${id}-g-gh`} role="presentation">
                <span>GitHub 공개 저장소 검색 결과</span>
                {tag}
              </div>
              {rows
                .filter((row): row is Extract<Row, { kind: "github" }> => row.kind === "github")
                .map((row) =>
                  option(
                    row,
                    <>
                      <span className="cbx-nm" translate="no">
                        <MarkedName owner={row.row.owner} name={row.row.name} text={q} />
                      </span>
                      {row.row.description && <span className="cbx-desc">{row.row.description}</span>}
                      {row.row.language && <span className="cbx-end">{row.row.language}</span>}
                    </>,
                  ),
                )}
            </div>
          )}
        </div>
        {open &&
          option(
            rows[rows.length - 1],
            <>
              <Icon name="search" />
              <span className="cbx-all-q">
                ‘<span className="cbx-echo">{q}</span>’ 전체 검색
              </span>
            </>,
            "cbx-opt cbx-all",
          )}
      </div>
      {siteLost && <p className="cbx-note">{SITE_LOST}</p>}
      {answer?.fakeGitHub && <p className="cbx-note">{FAKE_GITHUB_NOTE}</p>}
      {statusLine && <p className="cbx-note cbx-status">{statusLine}</p>}
    </div>
  );

  const common = {
    ref: formRef,
    // next/form: 보내면 쪽 전체를 새로 받지 않고 클라이언트에서 /search/?q=… 로 옮긴다. 스크립트가 없으면 보통의 GET 양식이다.
    action: "/search/",
    role: "search",
    "aria-label": label,
    onSubmit: (event: FormEvent<HTMLFormElement>) => {
      // 빈 채로 보내면 검색 쪽의 빈 상태로(주소에 빈 q 를 남기지 않는다).
      if ((inputRef.current?.value.trim() ?? "") === "") {
        event.preventDefault();
        leave("/search/");
        return;
      }
      clearHeader();
    },
    onPointerDown: (event: PointerEvent<HTMLFormElement>) => {
      // 펼침 목록을 누르는 동안 입력창이 초점을 잃지 않게 한다(목업 home.js). 모든 단추에: 가운데·오른쪽 단추로 눌러도 목록이
      // 닫히지 않아야 새 탭 열기(auxclick)와 주소 복사(contextmenu)가 링크에 닿는다. pointerdown 을 막아도 그 둘은 막히지 않는다.
      if ((event.target as Element).closest(".cbx-pop")) event.preventDefault();
    },
  } as const;
  const live = (
    <p className="visually-hidden" aria-live="polite">
      {announced}
    </p>
  );

  if (variant === "home") {
    return (
      <Form {...common} className="find cbx cbx-home">
        <button type="submit" className="find-go" aria-label="검색" tabIndex={-1}>
          <Icon name="search" />
        </button>
        <label htmlFor={id} className="visually-hidden">
          {label}
        </label>
        {input}
        {popup}
        {live}
      </Form>
    );
  }
  if (variant === "header") {
    return (
      <Form {...common} className="hdr-search cbx cbx-header">
        <Icon name="search" />
        <label htmlFor={id} className="visually-hidden">
          {label}
        </label>
        {input}
        {popup}
        {live}
      </Form>
    );
  }
  return (
    <Form {...common} className="search cbx cbx-page">
      <label htmlFor={id} className="visually-hidden">
        {label}
      </label>
      {input}
      <button type="submit" aria-label="검색">
        <Icon name="search" />
      </button>
      {popup}
      {live}
    </Form>
  );
}
