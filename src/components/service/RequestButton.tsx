"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ID_ALPHABET, ID_LENGTH } from "@/lib/service/id";

/**
 * 분석 요청 단추(브라우저 부품). 같은 사이트의 `POST /api/analyses/` 만 부른다. 받으면 그 분석 쪽으로 가고(새 분석이든, 같은
 * 커밋의 분석으로 보낸 것이든), 받지 않으면 서버가 돌려준 까닭(하루·동시 상한, 너무 큼, 없음 등)을 단추 옆에 그대로 적는다.
 *
 * 누르는 동안은 다시 누를 수 없다(`aria-disabled`, 그리고 손잡이가 진행 중인 요청을 보고 돌아간다). `disabled` 를 쓰지 않는
 * 것은 키보드 차례에서 빠지지 않게 하려는 것이다(까닭을 `aria-describedby` 로 듣는다).
 */

/** 서버가 돌려주는 응답의 모양 가운데 이 단추가 읽는 것. */
interface RequestAnswer {
  ok?: unknown;
  reused?: unknown;
  href?: unknown;
  message?: unknown;
}

/** 옮겨 갈 주소는 이 사이트의 분석 쪽 주소만 받는다(서버가 만든 값이지만, 다른 곳으로 가는 주소는 따르지 않는다). */
const ANALYSIS_PATH = new RegExp(`^/r/[a-z0-9._-]+/[a-z0-9._-]+/a/[${ID_ALPHABET}]{${ID_LENGTH}}/$`);

type State = { kind: "idle" } | { kind: "busy" } | { kind: "moving"; reused: boolean } | { kind: "refused"; message: string };

export function RequestButton({ owner, name, label }: { owner: string; name: string; label: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "idle" });
  // 상태가 그려지기 전에 두 번 눌러도 요청은 하나다.
  const pending = useRef(false);

  async function request() {
    if (pending.current) return;
    pending.current = true;
    setState({ kind: "busy" });
    let answer: RequestAnswer | null = null;
    try {
      const response = await fetch("/api/analyses/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner, repo: name }),
      });
      answer = (await response.json().catch(() => null)) as RequestAnswer | null;
    } catch {
      answer = null;
    }
    if (answer?.ok === true && typeof answer.href === "string" && ANALYSIS_PATH.test(answer.href)) {
      // 옮겨 가는 동안에도 다시 누를 수 없게 둔다.
      setState({ kind: "moving", reused: answer.reused === true });
      router.push(answer.href);
      return;
    }
    pending.current = false;
    setState({
      kind: "refused",
      message:
        typeof answer?.message === "string" && answer.message !== ""
          ? answer.message
          : "서버에 닿지 못했거나 응답을 읽지 못했습니다. 잠시 뒤 다시 요청해 주세요.",
    });
  }

  const busy = state.kind === "busy" || state.kind === "moving";
  return (
    <>
      <button
        type="button"
        aria-disabled={busy ? "true" : undefined}
        aria-busy={busy ? "true" : undefined}
        aria-describedby="request-note"
        onClick={() => void request()}
      >
        {busy ? "요청하는 중…" : label}
      </button>
      {/* 바뀌는 말을 화면 낭독기가 읽게 한다. 거절은 경고 색으로 적는다. */}
      <p id="request-note" className={state.kind === "refused" ? "hint request-refused" : "hint"} role="status">
        {state.kind === "busy" && "요청을 보냈습니다. 저장소와 끝 커밋을 확인하고 있습니다."}
        {state.kind === "moving" &&
          (state.reused
            ? "같은 커밋의 분석이 이미 있어 새로 만들지 않고 그 분석으로 갑니다."
            : "분석을 만들었습니다. 분석 쪽으로 갑니다.")}
        {state.kind === "refused" && <>요청하지 못했습니다. {state.message}</>}
      </p>
    </>
  );
}
