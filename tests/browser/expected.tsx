import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { DemoPanel } from "@/components/demo/DemoPanel";
import { PolicyDetail } from "@/components/policy/PolicyDetail";
import { ReportSummary } from "@/components/result/ReportSummary";
import type { DemoApp, DemoVariant } from "@/lib/demo/apps";
import { loadDemoApps } from "@/lib/demo/load";
import { packIndex } from "@/lib/pack";
import type { LegalRef, PackMeta, PolicyDoc, PolicyMeta } from "@/lib/pack/types";
import { parseReportText } from "@/lib/report/parse";
import { buildReportView, type ReportView } from "@/lib/report/view-model";
import { elementsOf, root } from "../helpers";
import { plain, squash } from "../policy-page";

// 브라우저 시험이 견줄 글: 결과 화면과 데모의 부품을 Node 에서 그려 낸 것. 브라우저가 그린 글이 이것과 같은지 본다.
// 같지 않으면 브라우저에서 도는 코드가 붙은 뒤에 글을 더하거나 바꾼 것이다(조문 도감은 팩 메타데이터에서 기대값을 따로
// 만든다. tests/policy-page.ts). 여기서 보는 것은 브라우저와 부품이 같은지이고, 부품이 그리는 글이 맞는지는 부품 시험
// (tests/render.test.tsx, tests/demo.test.tsx)이 본다. 그래서 팩도 쪽이 넘기는 것(`packIndex`)을 그대로 쓴다.

/** 결과 파일의 글을 뷰어가 하는 대로 읽어 화면 구조로 만든다. 읽지 못하면 시험이 잘못된 것이다. */
export function viewOfText(text: string): ReportView {
  const parsed = parseReportText(text);
  if (!parsed.ok) throw new Error(`결과로 읽지 못했습니다: ${parsed.errors.join(" / ")}`);
  return buildReportView(parsed.report, parsed.contract, packIndex);
}

/** 저장소의 결과 파일(경로 조각)을 화면 구조로 만든다. */
export const viewOfFile = (...parts: string[]) => viewOfText(readFileSync(path.join(root, ...parts), "utf8"));

/** 결과 화면(`ReportSummary`)이 그 결과로 그리는 글 전체. 빈칸은 뺀다(요소 사이의 빈칸은 그리는 길마다 다르다). */
export const reportText = (view: ReportView) => squash(plain(renderToStaticMarkup(<ReportSummary view={view} />)));

/** 데모가 빌드할 때 읽는 앱(쪽과 같은 방법으로 읽는다). */
export const demoApps: DemoApp[] = loadDemoApps(packIndex);

/** 데모의 한 판(`DemoPanel`)이 그리는 글 전체. 빈칸은 뺀다. 기록은 고르기 전이라 그리지 않는다. */
export const panelText = (app: DemoApp, variant: DemoVariant) =>
  squash(plain(renderToStaticMarkup(<DemoPanel app={app} variant={variant} pack={packIndex} />)));

/**
 * 조문 도감의 정책 쪽 부품(`PolicyDetail`)이 그 정책의 첫 조문을 그리는 HTML(`<div class="legal">` 하나). `legal` 로 첫 조문의
 * 값을 바꿔 그린다. 팩에 없는 모양(원문 해시가 맞지 않는 조문 등)의 꾸밈을 브라우저에서 재려고, 열린 쪽에 이것을 넣는다.
 * 작성자 메모는 넘기지 않는다(부품이 받지 않는다).
 */
export function legalBlockMarkup(policy: PolicyMeta, pack: PackMeta["pack"], legal: Partial<LegalRef>): string {
  const doc = Object.fromEntries(Object.entries(policy).filter(([key]) => key !== "rationale")) as PolicyDoc;
  const patched: PolicyDoc = { ...doc, legal: doc.legal.map((ref, i) => (i === 0 ? { ...ref, ...legal } : ref)) };
  const html = renderToStaticMarkup(<PolicyDetail policy={patched} pack={pack} />);
  const [first] = elementsOf(html, '<div class="legal">');
  if (!first) throw new Error(`${policy.id}: 조문이 그려지지 않았습니다.`);
  return first;
}

/** 빌드된 쪽(out/ 의 HTML)의 본문(main) 글 전체. 빈칸은 뺀다. 브라우저가 쪽을 그린 뒤의 글과 견준다. */
export function builtMainText(pathname: string): string {
  const html = readFileSync(path.join(root, "out", pathname, "index.html"), "utf8");
  const mains = elementsOf(html, "<main");
  if (mains.length !== 1) throw new Error(`${pathname}: 본문(main)이 하나가 아닙니다(${mains.length}개)`);
  return squash(plain(mains[0]));
}
