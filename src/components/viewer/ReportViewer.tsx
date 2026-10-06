"use client";

import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { ReportSummary } from "@/components/result/ReportSummary";
import type { PackIndex } from "@/lib/pack/types";
import { parseReport, parseReportText, type ParseResult } from "@/lib/report/parse";
import type { Contract, Report } from "@/lib/report/types";
import { buildReportView } from "@/lib/report/view-model";
import { SAMPLES, type Sample } from "@/lib/samples";
import { ResultBoundary } from "./ResultBoundary";

interface Loaded {
  /** 열 때마다 하나씩 늘린다. 결과 화면을 통째로 새로 만들기 위한 key 다. */
  seq: number;
  name: string;
  note: string | null;
  /** 예시를 열었으면 그 id, 직접 연 파일이면 빈 문자열. */
  sampleId: string;
  result: ParseResult;
}

function fromSample(sample: Sample, seq: number): Loaded {
  return {
    seq,
    name: `${sample.label} (${sample.origin})`,
    note: sample.note,
    sampleId: sample.id,
    result: parseReport(sample.data),
  };
}

/** 화면 구조를 만드는 일까지 오류 경계 안에서 한다. 여기서 실패해도 파일 고르기는 남는다. */
function Result({ report, contract, pack }: { report: Report; contract: Contract; pack: PackIndex }) {
  return <ReportSummary view={buildReportView(report, contract, pack)} />;
}

/**
 * CLI 결과 JSON 을 브라우저 안에서만 읽어 그린다. 파일 내용은 어디로도 보내지 않고 저장하지도 않는다.
 * 처음에는 합성 예시 하나를 열어 둔다.
 *
 * 팩 정보는 쪽(서버 부품)이 필요한 것만 골라 넘긴다. 여기서 팩 메타데이터를 직접 불러오지 않는다
 * (`src/lib/pack/index.ts` 의 `packIndex`).
 */
export function ReportViewer({ pack }: { pack: PackIndex }) {
  const [loaded, setLoaded] = useState<Loaded>(() => fromSample(SAMPLES[0], 0));
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function openFile(file: File) {
    let result: ParseResult;
    try {
      result = parseReportText(await file.text());
    } catch {
      result = { ok: false, errors: ["파일을 읽지 못했습니다. 폴더가 아닌 JSON 파일을 골라 주세요."] };
    }
    setLoaded((prev) => ({ seq: prev.seq + 1, name: file.name, note: null, sampleId: "", result }));
  }

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // 같은 파일을 다시 골라도 열리게 입력을 비운다.
    event.target.value = "";
    if (file) void openFile(file);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void openFile(file);
  }

  function onSample(event: ChangeEvent<HTMLSelectElement>) {
    const sample = SAMPLES.find((s) => s.id === event.target.value);
    if (!sample) return;
    if (fileInput.current) fileInput.current.value = "";
    setLoaded((prev) => fromSample(sample, prev.seq + 1));
  }

  const { result } = loaded;

  return (
    <div className="viewer">
      <div
        className={`dropzone${dragging ? " dropzone-on" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <label htmlFor="report-file">
          <strong>결과 JSON 열기</strong>
          <span>파일을 여기에 끌어다 놓거나 고르세요. 파일은 이 브라우저 안에서만 읽습니다.</span>
        </label>
        <input id="report-file" ref={fileInput} type="file" accept="application/json,.json" onChange={onPick} />
      </div>

      <div className="samples">
        <label htmlFor="sample-select">합성 예시 열기</label>
        <select id="sample-select" value={loaded.sampleId} onChange={onSample}>
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

      <h2 className="viewer-title">{loaded.name}</h2>
      {loaded.note && <p className="viewer-note">합성 예시입니다. {loaded.note}</p>}

      {result.ok ? (
        <ResultBoundary key={loaded.seq}>
          <Result report={result.report} contract={result.contract} pack={pack} />
        </ResultBoundary>
      ) : (
        <div className="notice notice-warn" role="alert">
          <p>이 파일을 결과로 읽지 못했습니다.</p>
          <ul>
            {result.errors.map((error, i) => (
              <li key={i}>{error}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
