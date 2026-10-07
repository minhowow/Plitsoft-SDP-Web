"use client";

import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent,
  type RefObject,
} from "react";
import { ReportSummary } from "@/components/result/ReportSummary";
import type { PackIndex } from "@/lib/pack/types";
import { readResultFile } from "@/lib/report/open";
import { parseReport, type ParseResult } from "@/lib/report/parse";
import type { Contract, Report } from "@/lib/report/types";
import { buildReportView } from "@/lib/report/view-model";
import { SAMPLES, type Sample } from "@/lib/samples";
import { SITE } from "@/lib/site";
import { ResultBoundary } from "./ResultBoundary";

interface Loaded {
  /** 열 때마다 달라지는 번호(늘어나기만 한다). 결과 화면과 안내를 통째로 새로 만들기 위한 key 다. */
  seq: number;
  name: string;
  /** 제목 아래에 적는 말. 예시가 무엇을 보여 주는지, 또는 파일을 여럿 놓았을 때 첫 파일만 본다는 것. */
  note: string | null;
  /** 예시를 열었으면 그 id, 직접 연 파일이면 빈 문자열. */
  sampleId: string;
  result: ParseResult;
}

/** 읽지 못한 까닭을 먼저 보이는 수. 발견마다 같은 필드가 빠진 파일은 까닭이 수백 줄이 된다. */
const SHOWN_ERRORS = 5;

/**
 * 파일을 끄는 동안 dragover 가 이만큼(ms) 오지 않으면 끌기가 끝난 것으로 본다. 브라우저는 끄는 동안 그 이벤트를
 * 이어서 보낸다(HTML 표준은 350ms 안팎마다라고 적는다). 그보다 넉넉히 둔다.
 */
const DRAG_IDLE_MS = 800;

/** 브라우저가 되살린 스크롤 자리를 맨 위로 되돌리며 지켜보는 시간(ms). 문서를 다 받은 때부터 잰다(아래 `startAtTop`). */
const RESTORE_WATCH_MS = 500;

/** 사람이 무엇인가 하기 시작했다는 것을 알려 주는 이벤트. 그 뒤로는 스크롤을 건드리지 않는다. */
const USER_ACTS = ["wheel", "touchstart", "keydown", "pointerdown", "dragenter"] as const;

/**
 * 이 탭에서 가장 나중에 연 것. 다른 쪽(조문 도감 등)에 다녀오면 뷰어가 새로 붙는데, 그때 이것을 되살린다.
 *
 * 되살리지 않으면, 연 결과에서 정책 링크를 눌렀다가 뒤로 왔을 때 기본 합성 예시가 열려 있다. 브라우저가 스크롤
 * 자리까지 되살리므로 제목과 "합성 예시입니다"는 화면 밖에 있고, 보이는 것은 예시의 정책 카드다.
 *
 * 메모리에만 둔다(docs/commitments.md 의 1층). 브라우저 저장소에 쓰지 않으므로, 새로 고치거나 탭을 닫으면 사라진다.
 */
let kept: Loaded | null = null;

function fromSample(sample: Sample, seq: number): Loaded {
  return {
    seq,
    name: `${sample.label} (${sample.origin})`,
    note: `합성 예시입니다. ${sample.note}`,
    sampleId: sample.id,
    result: parseReport(sample.data),
  };
}

/** 끌고 있는 것에 파일이 들어 있는지. 글이나 링크를 끄는 것은 건드리지 않는다. */
function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes("Files") ?? false;
}

/** 이 문서를 새로 고침이나 뒤로·앞으로 가기로 다시 받았는지. 그때 브라우저는 앞서 보던 스크롤 자리를 되살린다. */
function documentWasRestored(): boolean {
  const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  return entry?.type === "reload" || entry?.type === "back_forward";
}

/**
 * 브라우저가 스크롤 자리를 되살려도 맨 위에서 시작하게 한다. 되살릴 결과가 없을 때 쓴다. 돌려준 함수를 부르면 그만둔다.
 *
 * 새로 고치면 연 것은 사라지고(메모리에만 두었다) 기본 예시가 열린다. 그런데 브라우저는 앞서 보던 스크롤 자리를
 * 되살린다. 그대로 두면 제목과 "합성 예시입니다"가 화면 밖에 놓인다.
 *
 * 붙을 때 한 번 올리는 것으로는 모자란다. 브라우저가 자리를 되살리는 때가 그 뒤일 수 있다(Chrome 154 에서 쟀다. 문서를
 * 다 받은 직후에 한 번 더 되살리고, 같은 문서 안에서 뒤로 왔을 때는 다음 화면을 그리면서 되살린다). 그래서 문서를 다
 * 받고 RESTORE_WATCH_MS 가 지날 때까지 지켜보다가, 스크롤이 움직이면 다시 올린다. 사람이 무엇인가 하기 시작하면
 * 곧바로 그만둔다.
 */
function startAtTop(): () => void {
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
 * 결과 화면. 화면 구조를 만드는 일까지 오류 경계 안에서 한다. 여기서 실패해도 파일 고르기는 남는다.
 *
 * 화면에 붙은 뒤에 붙었다고 알린다(`onDrawn`). 그리다 실패하면 이 부품은 붙지 않으므로 알리지 않는다. "열었습니다"는
 * 이 알림을 받은 뒤에만 화면 낭독기에 나간다.
 */
function Result({
  seq,
  report,
  contract,
  pack,
  onDrawn,
}: {
  seq: number;
  report: Report;
  contract: Contract;
  pack: PackIndex;
  onDrawn: (seq: number) => void;
}) {
  useEffect(() => {
    onDrawn(seq);
  }, [onDrawn, seq]);
  return <ReportSummary view={buildReportView(report, contract, pack)} />;
}

/** 읽지 못한 파일의 안내: 까닭, 그리고 이 뷰어가 여는 파일과 그것을 만드는 명령. */
function Unreadable({ errors }: { errors: string[] }) {
  const more = errors.length - SHOWN_ERRORS;
  return (
    <div className="notice notice-warn" role="alert">
      <p>이 파일을 결과로 읽지 못했습니다.</p>
      <ul>
        {errors.slice(0, SHOWN_ERRORS).map((error, i) => (
          <li key={i}>{error}</li>
        ))}
      </ul>
      {more > 0 && <p>그 밖에 {more}곳이 더 있습니다.</p>}
      <p>
        이 뷰어는 CLI 의 JSON·SARIF 출력을 저장한 파일을 엽니다. 예: <code>{SITE.scanExample}</code>
      </p>
    </div>
  );
}

/**
 * 연 것 하나의 화면: 이름, 설명, 결과 또는 읽지 못했다는 안내.
 * 발견이 많은 결과는 그리는 데 시간이 걸린다. 위의 파일 고르기와 따로 그려지게 memo 로 묶는다(아래 `shown`).
 */
const Opened = memo(function Opened({
  loaded,
  pack,
  heading,
  onDrawn,
  onFailed,
}: {
  loaded: Loaded;
  pack: PackIndex;
  heading: RefObject<HTMLHeadingElement | null>;
  onDrawn: (seq: number) => void;
  onFailed: (seq: number) => void;
}) {
  const { result, seq } = loaded;
  return (
    <>
      <h2 ref={heading} className="viewer-title">
        {loaded.name}
      </h2>
      {loaded.note && <p className="viewer-note">{loaded.note}</p>}
      {/*
        결과와 안내는 열 때마다 새로 만든다(key). 안내(role="alert")가 같은 요소로 남으면, 같은 까닭으로 읽지 못한 파일을
        잇달아 열었을 때 화면 낭독기에 다시 알려지지 않는다.
      */}
      {result.ok ? (
        <ResultBoundary key={seq} onFailed={() => onFailed(seq)}>
          <Result seq={seq} report={result.report} contract={result.contract} pack={pack} onDrawn={onDrawn} />
        </ResultBoundary>
      ) : (
        <Unreadable key={seq} errors={result.errors} />
      )}
    </>
  );
});

/**
 * CLI 결과(JSON, SARIF)를 브라우저 안에서만 읽어 그린다. 파일 내용은 어디로도 보내지 않고 저장하지도 않는다.
 * 처음에는 합성 예시 하나를 열어 둔다. 다른 쪽에 다녀오면 그 전에 열어 둔 것이 그대로 열려 있다(위 `kept`).
 *
 * 팩 정보는 쪽(서버 부품)이 필요한 것만 골라 넘긴다. 여기서 팩 메타데이터를 직접 불러오지 않는다
 * (`src/lib/pack/index.ts` 의 `packIndex`).
 */
export function ReportViewer({ pack }: { pack: PackIndex }) {
  // 되살릴 것이 있는 채로 붙었는지. 처음 그릴 때 정해 둔다(`kept` 는 붙은 뒤에 곧 채워진다).
  const [hadKept] = useState(() => kept !== null);
  const [loaded, setLoaded] = useState<Loaded>(() => kept ?? fromSample(SAMPLES[0], 0));
  // 결과 화면은 한 박자 늦게 따라온다. 발견이 많은 결과를 그리는 동안에도 파일 고르기와 예시 고르기가 멈추지 않는다.
  const shown = useDeferredValue(loaded);
  const [dragging, setDragging] = useState(false);
  // 이 화면이 붙을 때 이미 열려 있던 것(기본 예시, 또는 다른 쪽에 다녀오기 전에 연 것). 화면 낭독기에 알리지 않는다.
  const [atMount] = useState(loaded.seq);
  // 결과 화면이 붙은 것과 그리다 실패한 것의 번호. 결과는 오류 경계 안에서 그려지므로, 그려졌는지는 그 뒤에야 안다.
  const [drawn, setDrawn] = useState(-1);
  const [failed, setFailed] = useState(-1);
  const fileInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // 가장 나중에 연 것의 번호. 파일을 읽는 사이에 다른 것을 열었으면 먼저 것의 결과는 버린다.
  const latest = useRef(loaded.seq);
  // 파일로 연 것의 번호. 그려진 뒤 제목이 화면 밖이면 제목으로 스크롤한다(아래).
  const reveal = useRef<number | null>(null);

  const openFiles = useCallback(async (files: FileList | null | undefined, how: "picked" | "dropped") => {
    const file = files?.[0];
    if (!file) return;
    // 놓아서 연 것은 파일 입력이 고른 파일이 아니다. 앞서 고른 파일의 이름이 입력에 남지 않게 비운다.
    if (how === "dropped" && fileInput.current) fileInput.current.value = "";
    // 읽기 전에 적어 둔다. 끌어다 놓기가 끝나면 목록이 비어 있을 수 있다. 읽기 전이므로 읽혔는지와 무관한 말로 적는다.
    // 첫 파일을 읽지 못해도 바로 아래의 안내와 어긋나지 않아야 한다.
    const note =
      files.length > 1 ? `한 번에 한 파일만 엽니다. 놓은 파일 ${files.length}개 가운데 첫 파일만 봅니다.` : null;
    const seq = ++latest.current;
    const result = await readResultFile(file);
    if (seq !== latest.current) return;
    reveal.current = seq;
    setLoaded({ seq, name: file.name, note, sampleId: "", result });
  }, []);

  // 새로 고치거나 뒤로·앞으로 가기로 문서를 다시 받았는데 되살릴 것이 없으면(기본 예시로 시작한다) 맨 위에서 시작한다.
  // 처음 찾아온 문서에서는 하지 않는다. 스크립트가 늦게 붙는 동안 읽어 내려간 사람을 맨 위로 끌어올리게 된다.
  useEffect(() => {
    if (hadKept || !documentWasRestored()) return undefined;
    return startAtTop();
  }, [hadKept]);

  useEffect(() => {
    kept = loaded;
  }, [loaded]);

  // 파일로 연 것은(고르기, 끌어다 놓기) 그려진 뒤 제목이 화면 밖이면 제목으로 스크롤한다. 아래로 내린 채 파일을 놓거나
  // 화면이 낮으면, 무엇이 열렸는지도 읽지 못했다는 안내도 화면에 보이지 않는다. 예시 고르기는 스크롤하지 않는다.
  // 고르기 상자에 초점을 둔 채 넘겨 보는 동안 화면이 움직이면 안 된다.
  useEffect(() => {
    if (reveal.current !== shown.seq) return;
    reveal.current = null;
    const box = heading.current?.getBoundingClientRect();
    if (box && (box.top < 0 || box.bottom > window.innerHeight)) heading.current?.scrollIntoView({ block: "start" });
  }, [shown]);

  // 파일은 이 화면 어디에 놓아도 연다. 받지 않으면 드롭존 밖에 놓은 파일을 브라우저가 대신 연다(Chrome 은 새 탭으로
  // 연다). 보던 결과를 잃거나 가리지 않게, 창 전체에서 받는다.
  useEffect(() => {
    let idle: number | undefined;
    const stop = () => {
      window.clearTimeout(idle);
      setDragging(false);
    };
    const onOver = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      // 막지 않으면 놓을 수 없는 자리가 되어 drop 이 오지 않고, 브라우저가 그 파일을 연다.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      setDragging(true);
      // 끄는 동안에는 dragover 가 이어서 온다. 놓지 않고 끝난 끌기(Esc, 다른 창에 놓음)는 브라우저가 알리지 않을 때가
      // 있으므로, 한동안 오지 않으면 끝난 것으로 본다. 끄는 동안의 표시가 켜진 채 남지 않게 하기 위해서다.
      window.clearTimeout(idle);
      idle = window.setTimeout(stop, DRAG_IDLE_MS);
    };
    const onLeave = (event: DragEvent) => {
      // 창 밖으로 나갔으면 기다리지 않고 끈다. 창 안의 요소 사이를 오갈 때의 나감은 좌표가 창 안이다.
      const { clientX: x, clientY: y } = event;
      if (x <= 0 || y <= 0 || x >= window.innerWidth || y >= window.innerHeight) stop();
    };
    const onDrop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      // 파일 입력 위에 놓았을 때도 여기서 한 번만 연다(막으면 입력이 스스로 파일을 받지 않는다).
      event.preventDefault();
      stop();
      void openFiles(event.dataTransfer?.files, "dropped");
    };
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.clearTimeout(idle);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [openFiles]);

  // 파일 고르기 창을 열기 전에 입력을 비운다. 같은 이름의 파일을 다시 골라도 열리게 하기 위해서다(고친 뒤 다시 검사한
  // 결과는 이름이 같다. 비우지 않으면 브라우저가 바뀐 것이 없다고 보고 알리지 않는다). 고른 뒤에 비우면 방금 연
  // 파일인데도 입력 옆에 "선택된 파일 없음"이 보인다.
  function onChoose(event: MouseEvent<HTMLInputElement>) {
    event.currentTarget.value = "";
  }

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    void openFiles(event.target.files, "picked");
  }

  function onSample(event: ChangeEvent<HTMLSelectElement>) {
    const sample = SAMPLES.find((s) => s.id === event.target.value);
    if (!sample) return;
    if (fileInput.current) fileInput.current.value = "";
    setLoaded(fromSample(sample, ++latest.current));
  }

  // 새로 연 것을 아직 그리는 중인지. 그동안 아래에는 앞서 연 것이 남아 있다.
  const stale = shown !== loaded;
  // 이 화면에서 새로 연 것만 알린다. 처음 열려 있는 예시와 되살린 것은 알리지 않는다.
  const fresh = loaded.seq !== atMount;
  // 결과로 읽은 것은 그려졌는지(또는 그리다 실패했는지)를 알 때까지 여는 중이다.
  const opening = fresh && (stale || (loaded.result.ok && drawn !== loaded.seq && failed !== loaded.seq));

  // 화면 낭독기에 알리는 말. 초점은 고르던 자리에 그대로 둔다(예시를 화살표로 넘기는 동안 초점이 옮겨 가면 안 된다).
  // 무엇을 열었는지만 알린다. 발견 수는 알리지 않는다. 수만 들으면 0건이 "볼 것이 없다"로 들리고, 맨 위 경고와 AI 가
  // 푼 경고가 빠진다. 그것은 결과 화면이 차례대로 말한다(docs/commitments.md 의 1).
  // 읽지 못했을 때와 그리지 못했을 때는 안내 상자(role="alert")가 스스로 알린다. 그때 "열었습니다"라고 하지 않는다.
  let status = "";
  if (opening) status = `여는 중입니다: ${loaded.name}`;
  else if (fresh && drawn === loaded.seq) status = `열었습니다: ${loaded.name}`;

  return (
    <div className="viewer">
      <div className={`dropzone${dragging ? " dropzone-on" : ""}`}>
        <label htmlFor="report-file">
          <strong>결과 파일 열기</strong>
          <span>파일을 이 화면에 끌어다 놓거나 고르세요. 파일은 이 브라우저 안에서만 읽습니다.</span>
        </label>
        {/*
          autoComplete="off": 브라우저가 이 입력의 값을 기억했다가 되살리지 않게 한다. 뒤로·앞으로 가기로 문서를 다시 받으면
          연 것은 사라지고 기본 예시가 열리는데(메모리에만 두었다), 브라우저는 폼 값을 되살린다. 되살리게 두면 화면은 기본
          예시인데 입력 옆에는 앞서 고른 파일의 이름이 적힌다. 아래의 예시 고르기도 같다(떠나기 전의 값으로 되살아난다).
        */}
        <input
          id="report-file"
          ref={fileInput}
          type="file"
          accept=".json,.sarif,application/json"
          autoComplete="off"
          onClick={onChoose}
          onChange={onPick}
        />
      </div>

      {/* 파일을 끄는 동안 창 둘레에 그린다. 아래로 내려 드롭존이 화면 밖에 있어도, 어디에 놓든 받는다는 것이 보인다. */}
      {dragging && (
        <div className="drop-frame" aria-hidden="true">
          <span>이 화면 어디에 놓아도 됩니다</span>
        </div>
      )}

      <div className="samples">
        <label htmlFor="sample-select">합성 예시 열기</label>
        <select id="sample-select" value={loaded.sampleId} autoComplete="off" onChange={onSample}>
          <option value="" disabled>
            직접 연 파일
          </option>
          {SAMPLES.map((sample) => (
            <option key={sample.id} value={sample.id}>
              {sample.label} · {sample.origin}
            </option>
          ))}
        </select>
      </div>

      <p className="visually-hidden" role="status">
        {status}
      </p>

      {/* 그리는 데 오래 걸리면 앞서 연 것을 흐리게 해, 아직 바뀌지 않았다는 것이 보이게 한다(CSS 가 조금 기다렸다 흐린다). */}
      <div className={stale ? "opened opened-stale" : "opened"} aria-busy={opening}>
        <Opened loaded={shown} pack={pack} heading={heading} onDrawn={setDrawn} onFailed={setFailed} />
      </div>
    </div>
  );
}
