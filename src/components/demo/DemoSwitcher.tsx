"use client";

import { useState } from "react";
import { ReportSummary } from "@/components/result/ReportSummary";
import type { ReportView } from "@/lib/report/view-model";

export interface DemoVariant {
  key: string;
  label: string;
  file: string;
  code: string;
  view: ReportView;
}

/** 합성 데모 앱의 고치기 전·후를 오가며 본다. 코드와 결과는 빌드 때 읽어 온 것이다. */
export function DemoSwitcher({ variants }: { variants: DemoVariant[] }) {
  const [current, setCurrent] = useState(variants[0].key);
  const variant = variants.find((v) => v.key === current) ?? variants[0];
  const marked = new Set(
    variant.view.policies.flatMap((p) => [
      ...p.locations.filter((l) => l.file === variant.file).map((l) => l.line),
      ...p.evidence.filter((e) => e.file === variant.file).map((e) => e.line),
    ]),
  );

  return (
    <div className="demo">
      <div className="segmented" role="group" aria-label="데모 판 고르기">
        {variants.map((v) => (
          <button key={v.key} type="button" aria-pressed={v.key === current} onClick={() => setCurrent(v.key)}>
            {v.label}
          </button>
        ))}
      </div>

      <figure className="codeblock">
        <figcaption>
          <code>{variant.file}</code> · 합성 예시
        </figcaption>
        <pre>
          {variant.code.split("\n").map((line, i) => (
            <span key={i} className={marked.has(i + 1) ? "codeline codeline-marked" : "codeline"} data-line={i + 1}>
              {line || " "}
            </span>
          ))}
        </pre>
      </figure>

      <ReportSummary view={variant.view} />
    </div>
  );
}
