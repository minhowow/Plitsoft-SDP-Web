"use client";

/** 브라우저의 인쇄를 부르는 단추. 무엇이 인쇄되는지는 CSS 가 정한다(globals.css 의 @media print). 어디에도 요청하지 않는다. */
export function PrintButton() {
  return (
    <button type="button" className="btn" onClick={() => window.print()}>
      인쇄
    </button>
  );
}
