import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { PackIndex } from "@/lib/pack/types";
import { parseReportText } from "@/lib/report/parse";
import { buildReportView, type ReportView } from "@/lib/report/view-model";
import { DEMO_APPS, DEMO_VARIANTS, type DemoApp, type DemoFile, type DemoVariantKey } from "./apps";
import { unmatchedLines } from "./diff";

// 데모가 보이는 것을 읽는다. 빌드할 때(서버 부품)와 시험에서만 부른다. 파일을 읽으므로 브라우저에서 도는 부품에서는
// 불러오지 않는다.
//
// 읽는 곳은 둘뿐이다: 합성 코드(contract/fixtures)와, 그 코드를 CLI 로 검사한 실제 출력(contract/cli-current).
// v1 초안 예시와 손으로 만든 시험용 자료는 쓰지 않는다(docs/ROADMAP.md 의 관문 G1).

/** 수집 스크립트가 판마다 검사하는 폴더(`policypack scan src/`. scripts/capture-cli-output.mjs). */
const SCANNED = "src";

/** 폴더 아래 모든 파일. `base` 에서 본 경로이고 "/" 로 나눈다(결과에 실린 경로와 같은 모양). 글자 코드 순서다. */
function filesUnder(base: string, dir: string): string[] {
  return readdirSync(path.join(base, dir))
    .sort()
    .flatMap((name) => {
      const relative = `${dir}/${name}`;
      return statSync(path.join(base, relative)).isDirectory() ? filesUnder(base, relative) : [relative];
    });
}

/** 판 하나의 코드. 경로 → 줄. 파일 끝의 줄바꿈 하나는 줄로 세지 않는다. */
function readCode(root: string, app: string, variant: DemoVariantKey): Map<string, string[]> {
  const base = path.join(root, "contract", "fixtures", app, variant);
  return new Map(
    filesUnder(base, SCANNED).map((file) => [file, readFileSync(path.join(base, file), "utf8").replace(/\n$/, "").split("\n")]),
  );
}

/**
 * 한 판의 파일마다, 다른 판의 같은 경로 파일과 견주어 짝이 없는 줄을 가린다. 다른 판에 그 파일이 없으면 모든 줄이
 * 짝이 없다.
 */
function withDiff(code: Map<string, string[]>, other: Map<string, string[]>, side: "before" | "after"): DemoFile[] {
  return [...code].map(([file, lines]) => {
    const pair = other.get(file) ?? [];
    const alone = side === "before" ? unmatchedLines(lines, pair).before : unmatchedLines(pair, lines).after;
    return { path: file, lines: lines.map((text, i) => ({ text, differs: alone[i] })) };
  });
}

/** 판 하나를 검사한 CLI 출력. 읽지 못하면 멈춘다. 읽지 못한 결과를 빈 화면이나 다른 자료로 바꿔 보이지 않는다. */
function readView(root: string, name: string, pack: PackIndex): ReportView {
  const parsed = parseReportText(readFileSync(path.join(root, "contract", "cli-current", `${name}.json`), "utf8"));
  if (!parsed.ok) {
    throw new Error(`데모 결과를 읽지 못했습니다: ${name}. npm run capture 로 다시 수집하세요.\n${parsed.errors.join("\n")}`);
  }
  return buildReportView(parsed.report, parsed.contract, pack);
}

/** 합성 코드와 그 결과로 데모의 화면 구조를 만든다. 결과를 읽지 못하면 빌드가 실패한다. */
export function loadDemoApps(pack: PackIndex, root = process.cwd()): DemoApp[] {
  return DEMO_APPS.map((app) => {
    const [before, after] = DEMO_VARIANTS.map((variant) => readCode(root, app.key, variant.key));
    return {
      key: app.key,
      label: app.label,
      variants: DEMO_VARIANTS.map((variant, i) => ({
        ...variant,
        note: i === 0 ? app.about : `${app.about} ${app.fixed}`,
        files: i === 0 ? withDiff(before, after, "before") : withDiff(after, before, "after"),
        view: readView(root, `${app.key}.${variant.key}`, pack),
      })),
    };
  });
}
