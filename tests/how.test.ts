import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { figureSvg } from "@/lib/how/draw";
import { CLI_PIN, FIGURES } from "@/lib/how/figures";
import { REVIEW_STATUS_LABEL } from "@/lib/report/status";
import { root } from "./helpers";

// 구조 쪽(/how/)의 그림(2026-11-13 오너 지시). 포스터·보고서용 파일(docs/figures/)은 사이트와 같은 자료로 뽑는다
// (scripts/export-figures.mjs). 자료를 고치고 다시 뽑지 않으면 여기서 걸린다. PNG 는 SVG 를 Chrome 으로 그린 것이라 견주지 않는다.

const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const texts = (figure: (typeof FIGURES)[number]) => figure.shapes.flatMap((shape) => (shape.kind === "text" ? [shape.text] : []));

describe("구조 쪽의 그림", () => {
  it.each(FIGURES.map((figure) => [figure.file, figure] as const))("%s: docs/figures 의 SVG 가 사이트의 그림과 같다", (file, figure) => {
    expect(read(`docs/figures/${file}.svg`)).toBe(figureSvg(figure));
  });

  it("그림마다 일을 하는 상자는 12개 이하이고 글은 3~4줄이다. 좁은 화면의 목록도 비어 있지 않다", () => {
    expect(FIGURES).toHaveLength(3);
    for (const figure of FIGURES) {
      const boxes = figure.shapes.filter((shape) => shape.kind === "rect" && shape.cls.startsWith("hw-box") && shape.id !== undefined);
      expect(boxes.length, figure.file).toBeLessThanOrEqual(12);
      expect(figure.notes.length, figure.file).toBeGreaterThanOrEqual(3);
      expect(figure.notes.length, figure.file).toBeLessThanOrEqual(4);
      expect(figure.list.flatMap((section) => section.items).length, figure.file).toBeGreaterThan(0);
    }
  });

  it("그림의 CLI 고정 커밋은 수집본과 실행기의 것과 같다", () => {
    const manifest = JSON.parse(read("contract/cli-current/MANIFEST.json")) as { cli: { commit: string } };
    expect(manifest.cli.commit).toBe(CLI_PIN.commit);
    expect(read(".github/workflows/analyze.yml")).toMatch(new RegExp(`CLI_COMMIT: ${CLI_PIN.commit}[0-9a-f]{33}\\n`));
    for (const figure of [FIGURES[0], FIGURES[2]]) expect(texts(figure).join("\n"), figure.file).toContain(CLI_PIN.commit);
  });

  it("CLI 그림의 체크리스트는 사이트의 상태 이름을 쓴다", () => {
    const drawn = texts(FIGURES[1]).join("");
    for (const label of Object.values(REVIEW_STATUS_LABEL)) {
      for (const part of label.split(" · ")) expect(drawn, label).toContain(part);
    }
  });
});
