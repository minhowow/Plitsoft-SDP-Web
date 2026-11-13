import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { casesFile } from "@/lib/cases";
import { figureSvg, type Figure } from "@/lib/how/draw";
import { buildFigures, CLI_PIN, TRACE, traceData } from "@/lib/how/figures";
import { REVIEW_STATUS_LABEL } from "@/lib/report/status";
import { root } from "./helpers";

// 구조 쪽(/how/)의 그림(2026-11-13 오너 지시). 포스터·보고서용 파일(docs/figures/)은 사이트와 같은 자료로 뽑는다
// (scripts/export-figures.mjs). 자료를 고치고 다시 뽑지 않으면 여기서 걸린다. PNG 는 SVG 를 Chrome 으로 그린 것이라 견주지 않는다.

const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const texts = (figure: Figure, small = true) =>
  figure.shapes.flatMap((shape) => (shape.kind === "text" && (small || shape.cls !== "hw-small") ? [shape.text] : []));
const boxes = (figure: Figure) => figure.shapes.filter((shape) => shape.kind === "rect" && shape.cls.startsWith("hw-box") && shape.id !== undefined);
const { simple, trace, detailed } = buildFigures(casesFile);
const all = [...simple, trace, ...detailed];

describe("구조 쪽의 그림", () => {
  it.each(all.map((figure) => [figure.file, figure] as const))("%s: docs/figures 의 SVG 가 사이트의 그림과 같다", (file, figure) => {
    expect(read(`docs/figures/${file}.svg`)).toBe(figureSvg(figure));
  });

  it("쉬운 판은 상자 7개 이하이고, 숫자·커밋·모델 이름·CLI 낱말이 없다(명령 이름은 작은 글씨로만)", () => {
    expect(simple.map((figure) => figure.file)).toEqual(detailed.map((figure) => `${figure.file}-simple`));
    for (const figure of simple) {
      expect(boxes(figure).length, figure.file).toBeLessThanOrEqual(7);
      for (const text of texts(figure, false)) {
        expect(text, figure.file).not.toMatch(/[0-9]|haiku|sonnet|claude|gpt|kr-core|semgrep|review|scan|profile|handoff|관문|\$/i);
        expect(text, figure.file).not.toContain(CLI_PIN.commit);
      }
    }
  });

  it("자세한 판은 상자 12개 이하이고 글은 3~4줄이다. 그림마다 좁은 화면의 목록이 있다", () => {
    for (const figure of detailed) {
      expect(boxes(figure).length, figure.file).toBeLessThanOrEqual(12);
      expect(figure.notes.length, figure.file).toBeGreaterThanOrEqual(3);
      expect(figure.notes.length, figure.file).toBeLessThanOrEqual(4);
    }
    for (const figure of all) expect(figure.list.flatMap((section) => section.items).length, figure.file).toBeGreaterThan(0);
  });

  it("따라가 보기는 사례 쪽에 실린 결과를 그대로 옮긴다", () => {
    const { item, feature } = traceData(casesFile);
    const drawn = texts(trace).join("\n");
    expect(item.duty).toBe(TRACE.duty);
    for (const part of [feature.name, `${item.law} ${item.article}`, REVIEW_STATUS_LABEL[item.status]]) expect(drawn).toContain(part);
    // AI 가 댄 줄은 관문을 통과한 인용 그대로(위치와 글).
    const cite = item.citations.find((c) => c.ok)!;
    expect(drawn).toContain(`${cite.file}:${cite.line}`);
    expect(drawn).toContain(cite.text.trim());
    // 다시 센 검색의 줄 수와 반박 결과도 자료에서 온다.
    for (const search of item.searches) expect(drawn).toContain(`${search.found}줄`);
    expect(item.verification.result).toBe("upheld");
    expect(drawn).toContain("유지");
  });

  it("그림의 CLI 고정 커밋은 수집본과 실행기의 것과 같다", () => {
    const manifest = JSON.parse(read("contract/cli-current/MANIFEST.json")) as { cli: { commit: string } };
    expect(manifest.cli.commit).toBe(CLI_PIN.commit);
    expect(read(".github/workflows/analyze.yml")).toMatch(new RegExp(`CLI_COMMIT: ${CLI_PIN.commit}[0-9a-f]{33}\\n`));
    for (const figure of [detailed[0], detailed[2]]) expect(texts(figure).join("\n"), figure.file).toContain(CLI_PIN.commit);
  });

  it("CLI 그림의 체크리스트는 사이트의 상태 이름을 쓴다", () => {
    const drawn = texts(detailed[1]).join("");
    for (const label of Object.values(REVIEW_STATUS_LABEL)) {
      for (const part of label.split(" · ")) expect(drawn, label).toContain(part);
    }
  });
});
