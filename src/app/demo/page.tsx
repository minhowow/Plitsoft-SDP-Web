import { readFileSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { DemoSwitcher, type DemoVariant } from "@/components/demo/DemoSwitcher";
import { packMeta } from "@/lib/pack";
import { parseReport } from "@/lib/report/parse";
import { buildReportView } from "@/lib/report/view-model";
import { findSample } from "@/lib/samples";

export const metadata: Metadata = { title: "데모" };

const APP = "kids-signup";
const FILE = "src/auth/signup.ts";
const VARIANTS = [
  { key: "main", label: "고치기 전 (main)" },
  { key: "fixed", label: "고친 뒤 (fixed)" },
];

/** 빌드할 때 합성 코드와 그 결과(contract/)를 읽는다. 실행 중에는 아무것도 읽지 않는다. */
function loadVariant(key: string, label: string): DemoVariant {
  const code = readFileSync(path.join(process.cwd(), "contract", "fixtures", APP, key, FILE), "utf8").trimEnd();
  const sample = findSample(`${APP}.${key}`);
  const parsed = sample ? parseReport(sample.data) : null;
  if (!parsed?.ok) {
    throw new Error(`데모 결과를 읽지 못했습니다: ${APP}.${key}. npm run capture 로 다시 수집하세요.`);
  }
  return { key, label, file: FILE, code, view: buildReportView(parsed.report, parsed.contract, packMeta) };
}

export default function DemoPage() {
  const variants = VARIANTS.map((v) => loadVariant(v.key, v.label));
  return (
    <>
      <h1>데모: 아동 가입 코드</h1>
      <p className="lede">
        합성 예시입니다. 실제 서비스의 코드가 아닙니다. 가입 코드에 만 14세 미만 분기를 넣기 전과 넣은 뒤를 같은 팩으로
        검사했습니다.
      </p>
      <DemoSwitcher variants={variants} />
    </>
  );
}
