// 구조 쪽(/how/)의 그림을 포스터·보고서용 파일로 내보낸다: docs/figures/<이름>.svg 와 .png(밝은 바탕, 3배). 쉬운 판은
// <이름>-simple(포스터), 자세한 판은 <이름>(보고서), 따라가 보기는 trace-<사례>. 그림의 자료는 src/lib/how/figures.ts 이고(따라가
// 보기는 data/cases.json 에서 읽는다) 사이트도 같은 것으로 그린다. 내보내기 전에 Chrome 으로 그려 글이 제 상자 밖으로
// 넘치는지 잰다. 넘치면 파일을 쓰지 않고 멈춘다.
//
//   node scripts/export-figures.mjs          # 모두
//   node scripts/export-figures.mjs --check  # 재기만(파일을 쓰지 않는다)
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { figureSvg } from "../src/lib/how/draw.ts";
import { buildFigures } from "../src/lib/how/figures.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const built = buildFigures(JSON.parse(readFileSync(path.join(root, "data/cases.json"), "utf8")));
const FIGURES = [...built.simple, built.trace, ...built.detailed];
const checkOnly = process.argv.includes("--check");
const browser = await chromium.launch({ channel: "chrome", headless: true });
let failed = false;
try {
  for (const figure of FIGURES) {
    const svg = figureSvg(figure);
    const page = await browser.newPage({ viewport: { width: figure.width, height: figure.height }, deviceScaleFactor: 3 });
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0}</style>${svg}`);
    // 글마다 제 상자(data-in) 안에 들어가는지, 그림 밖으로 나가지 않는지.
    const problems = await page.evaluate(() => {
      const svgEl = document.querySelector("svg");
      const rects = new Map([...document.querySelectorAll("rect[data-id]")].map((r) => [r.dataset.id, r.getBBox()]));
      const out = [];
      for (const t of document.querySelectorAll("text")) {
        const b = t.getBBox();
        const box = t.dataset.in ? rects.get(t.dataset.in) : null;
        const area = box ?? { x: 0, y: 0, width: svgEl.viewBox.baseVal.width, height: svgEl.viewBox.baseVal.height };
        const room = Math.min(b.x - area.x, area.x + area.width - (b.x + b.width), b.y - area.y, area.y + area.height - (b.y + b.height));
        if (room < (box ? 6 : 2)) out.push(`${Math.round(room)}px ${t.textContent}`);
      }
      return out;
    });
    if (problems.length > 0) {
      failed = true;
      console.error(`${figure.file}: 넘치는 글\n  ${problems.join("\n  ")}`);
    } else if (!checkOnly) {
      writeFileSync(path.join(root, "docs/figures", `${figure.file}.svg`), svg);
      await page.locator("svg").screenshot({ path: path.join(root, "docs/figures", `${figure.file}.png`) });
      console.log(`${figure.file}: ${figure.width}×${figure.height}`);
    } else {
      console.log(`${figure.file}: 넘치는 글 없음`);
    }
    await page.close();
  }
} finally {
  await browser.close();
}
if (failed) process.exit(1);
