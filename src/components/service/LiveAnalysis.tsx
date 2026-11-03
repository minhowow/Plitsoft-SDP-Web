"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { readPlace, type QueuePlace } from "@/lib/service/queue";
import { STEP_ORDER } from "@/lib/service/steps";
import type { Analysis, Repository } from "@/lib/service/types";
import { AnalysisHeader, InProgress, PROGRESS_NOTE } from "./analysis";

/**
 * 진행 중인 실제 분석의 머리와 단계(브라우저 부품). 같은 사이트의 `GET /api/analyses/{id}/` 를 `POLL_MS` 마다 읽어 단계를 다시
 * 그리고, 분석이 끝나거나(succeeded) 실패하면(failed) 읽기를 멈추고 `router.refresh()` 로 서버가 그린 결과(대시보드나 멈춘
 * 단계와 까닭)를 받는다. 탭이 보이지 않는 동안은 읽지 않고, 다시 보이면 곧바로 한 번 읽는다.
 *
 * 합성 미리보기의 분석은 움직이지 않으므로 이 부품을 쓰지 않는다(분석 쪽이 서버 부품으로 그린다).
 */

/** 다시 읽는 간격(ms). */
export const POLL_MS = 3_000;

const STATUSES = new Set(["queued", "running", "succeeded", "failed"]);

/** 서버가 돌려준 분석이 이 분석이고 화면이 그릴 수 있는 모양인지. 아니면 쓰지 않는다(지난 그림을 그대로 둔다). */
function readAnalysis(value: unknown, id: string): Analysis | null {
  if (typeof value !== "object" || value === null) return null;
  const analysis = value as Partial<Analysis>;
  if (analysis.id !== id || typeof analysis.status !== "string" || !STATUSES.has(analysis.status)) return null;
  if (!Array.isArray(analysis.steps) || analysis.steps.map((step) => step?.name).join() !== STEP_ORDER.join()) return null;
  if (analysis.status === "failed" && !analysis.failure) return null;
  return analysis as Analysis;
}

export function LiveAnalysis({
  repository,
  analysis: initial,
  place: initialPlace = null,
}: {
  repository: Repository;
  analysis: Analysis;
  /** 대기 중이면 대기열의 어디에 있는지(서버가 DB 에서 센 것). 다시 읽을 때마다 서버가 준 값으로 바꾼다. */
  place?: QueuePlace | null;
}) {
  const router = useRouter();
  const [analysis, setAnalysis] = useState(initial);
  const [place, setPlace] = useState(initialPlace);
  /** 다시 읽지 못한 까닭. 다음에 읽으면 걷는다. */
  const [trouble, setTrouble] = useState<string | null>(null);
  /** 더 읽지 않는 까닭(끝남, 없어짐). */
  const [stopped, setStopped] = useState<string | null>(null);

  useEffect(() => {
    const id = initial.id;
    let done = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      clearTimeout(timer);
      if (!done && !document.hidden) timer = setTimeout(() => void tick(), POLL_MS);
    };

    async function tick() {
      if (done || inFlight || document.hidden) return;
      inFlight = true;
      try {
        const response = await fetch(`/api/analyses/${id}/`, { cache: "no-store" });
        const body = (await response.json().catch(() => null)) as { ok?: unknown; analysis?: unknown; queue?: unknown; message?: unknown } | null;
        if (done) return;
        const next = response.ok && body?.ok === true ? readAnalysis(body.analysis, id) : null;
        if (next) {
          setTrouble(null);
          setAnalysis(next);
          // 서버가 준 대기열의 자리. 없으면(대기 중이 아님, 읽지 못함) 적지 않는다(지난 숫자를 남겨 두지 않는다).
          setPlace(readPlace(body?.queue));
          if (next.status === "succeeded" || next.status === "failed") {
            done = true;
            setStopped(next.status === "succeeded" ? "분석이 끝났습니다. 결과를 불러옵니다." : "분석이 멈췄습니다. 까닭을 불러옵니다.");
            // 서버가 이 주소를 새로 그린다(끝난 분석은 대시보드, 실패한 분석은 멈춘 단계와 까닭).
            router.refresh();
          }
        } else if (response.status === 404) {
          done = true;
          setStopped("이 분석을 더 찾지 못해 진행 읽기를 멈췄습니다. 쪽을 다시 열어 보세요.");
        } else {
          const message = typeof body?.message === "string" ? ` ${body.message}` : "";
          setTrouble(`진행을 다시 읽지 못했습니다.${message} 잠시 뒤 다시 읽습니다.`);
        }
      } catch {
        if (!done) setTrouble("서버에 닿지 못해 진행을 다시 읽지 못했습니다. 잠시 뒤 다시 읽습니다.");
      } finally {
        inFlight = false;
      }
      schedule();
    }

    const onVisibility = () => {
      if (document.hidden) clearTimeout(timer);
      else void tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    schedule();
    return () => {
      done = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [initial.id, router]);

  return (
    <>
      <AnalysisHeader repository={repository} analysis={analysis} />
      <InProgress
        analysis={analysis}
        live
        place={place}
        note={
          <>
            <p>{stopped ?? PROGRESS_NOTE.live}</p>
            {trouble && !stopped && (
              <p className="an-progress-trouble" role="status">
                {trouble}
              </p>
            )}
          </>
        }
      />
    </>
  );
}
