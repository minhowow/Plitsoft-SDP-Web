"use client";

import { memo, useDeferredValue, useImperativeHandle, useState, type Ref } from "react";
import { flushSync } from "react-dom";
import type { PackIndex } from "@/lib/pack/types";
import { buildRecord, type RecordSource } from "@/lib/report/record";
import type { ReportView } from "@/lib/report/view-model";
import { SITE } from "@/lib/site";
import { RecordRefused, RecordSheet } from "./Record";
import { ReportSummary } from "./ReportSummary";

/**
 * 검사 기록을 고른 화면: 인쇄 단추와 기록. 기록을 만들 수 없는 결과면 단추 없이 그 까닭을 보인다.
 *
 * 인쇄 단추는 브라우저의 인쇄를 부를 뿐이다. 무엇이 인쇄되는지는 CSS 가 정한다(globals.css 의 @media print. 기록이
 * 열려 있으면 기록만 나온다). 브라우저의 메뉴나 단축키로 인쇄해도 같다. PDF 는 브라우저의 인쇄 창이 만든다.
 */
function RecordPanel({ view, pack, source }: { view: ReportView; pack: PackIndex; source: RecordSource }) {
  const result = buildRecord(view, pack);
  if (!result.ok) return <RecordRefused reasons={result.reasons} />;
  return (
    <>
      <div className="record-tools">
        <button type="button" onClick={() => window.print()}>
          인쇄
        </button>
        <span className="hint">인쇄하면 이 기록만 나옵니다. 인쇄 창에서 PDF 로 저장할 수 있습니다.</span>
      </div>
      <RecordSheet record={result.record} source={source} />
    </>
  );
}

/** 결과 화면. 단추를 눌러 이 틀이 다시 그려질 때 함께 다시 그려지지 않게 묶어 둔다(같은 결과면 그릴 것이 같다). */
const Summary = memo(ReportSummary);

/** 이 틀을 품은 쪽이 밖에서 시키는 일. 데모의 표가 쓴다(`components/demo/DemoPanel.tsx`). */
export interface ReportSwitch {
  /**
   * 결과 화면이 보이게 한다. 돌아왔을 때는 결과 화면이 이미 화면에 붙어 있다. 결과 화면 안의 자리(정책 카드)로 옮겨 가기
   * 전에 부른다. 기록을 보는 동안에는 그 자리가 가려져 있어서, 그대로는 옮겨 갈 수 없다.
   */
  showResult(): void;
}

/**
 * 결과 한 건을 두 가지로 본다: 결과 화면(`ReportSummary`)과 조문별 검사 기록(`RecordSheet`). 뷰어와 데모가 함께 쓴다.
 *
 * 기록은 결과가 메모리에 있는 바로 이 자리에서 만든다. 1층에는 서버도 브라우저 저장소도 없어서, 기록을 다른 쪽으로
 * 넘길 길이 없다. 주소에 싣지도 않는다(`docs/architecture.md` 의 "조문별 검사 기록"). 고른 것은 이 부품의 상태일 뿐이라
 * 다른 결과를 열거나 다른 쪽에 다녀오면 결과 화면으로 돌아간다.
 *
 * 기록을 고른 동안에도 결과 화면은 지우지 않고 가려 둔다. 돌아왔을 때 펼쳐 둔 발견 줄이 그대로이고, 발견이 많은 결과를
 * 다시 그리지 않는다. 기록은 고른 뒤에 그린다. 발견마다 한 줄이라, 미리 그려 두면 큰 결과에서 요소가 그만큼 는다.
 *
 * 기록 단추는 누르자마자 눌린 모양이 되고, 기록은 한 박자 늦게 따라온다(`useDeferredValue`. 뷰어가 결과를 여는 방식과
 * 같다). 발견이 수천 건인 결과의 기록을 만드는 일이 잘게 나뉘어, 그동안 화면이 멈추는 시간이 줄어든다. 다 그린 것을
 * 화면에 붙이는 동안은 멈춘다(잰 값은 `docs/architecture.md` 의 "조문별 검사 기록"). 결과로 돌아갈 때는 늦추지 않는다.
 * 기록을 걷고 가려 둔 결과 화면을 드러내는 일뿐이다.
 */
export function ReportWithRecord({
  view,
  pack,
  source,
  ref,
}: {
  view: ReportView;
  pack: PackIndex;
  source: RecordSource;
  ref?: Ref<ReportSwitch>;
}) {
  const [record, setRecord] = useState(false);
  const drawn = useDeferredValue(record);
  // 기록이 화면에 있는지. 고른 뒤 한 박자 늦게 참이 되고, 결과를 고르면 곧바로 거짓이 된다.
  const shown = record && drawn;

  useImperativeHandle(
    ref,
    () => ({
      // 곧바로 그려 낸다. 부른 쪽은 돌아오자마자 결과 화면 안의 자리로 옮겨 간다.
      showResult: () => flushSync(() => setRecord(false)),
    }),
    [],
  );

  return (
    <div className="report-switch">
      <div className="segmented" role="group" aria-label="결과와 검사 기록 고르기">
        <button type="button" aria-pressed={!record} onClick={() => setRecord(false)}>
          결과
        </button>
        <button type="button" aria-pressed={record} onClick={() => setRecord(true)}>
          {SITE.record.title}
        </button>
      </div>
      <div hidden={shown}>
        <Summary view={view} />
      </div>
      {shown && <RecordPanel view={view} pack={pack} source={source} />}
    </div>
  );
}
