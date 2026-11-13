// 공개 저장소 41곳 review 평가의 포스터 그림을 내보낸다: docs/figures/review-results-41.svg 와 .png(밝은 바탕, 2배). 숫자는
// data/eval-41.json(scripts/export-eval.mjs), 그림은 src/lib/cases/eval-figure.ts 다. 내보내기 전에 Chrome 으로 그려 글끼리
// 겹치는지, 그림 밖으로 나가는지 잰다. 그러면 파일을 쓰지 않고 멈춘다. review-results-12 는 건드리지 않는다.
//
//   node --no-warnings scripts/export-eval-figure.mjs
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { evalFigureSvg } from "../src/lib/cases/eval-figure.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const svg = evalFigureSvg(JSON.parse(readFileSync(path.join(root, "data/eval-41.json"), "utf8")));
const [, width, height] = /width="(\d+)" height="(\d+)"/.exec(svg).map(Number);
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0}</style>${svg}`);
  const problems = await page.evaluate(() => {
    const view = document.querySelector("svg").viewBox.baseVal;
    const texts = [...document.querySelectorAll("text")].map((t) => ({ t: t.textContent, b: t.getBBox() }));
    const out = [];
    for (const { t, b } of texts) {
      if (b.x < 2 || b.y < 2 || b.x + b.width > view.width - 2 || b.y + b.height > view.height - 2) out.push(`그림 밖: ${t}`);
    }
    for (let i = 0; i < texts.length; i++)
      for (let j = i + 1; j < texts.length; j++) {
        const [a, b] = [texts[i].b, texts[j].b];
        const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        if (w > 1 && h > 3) out.push(`겹침: ${texts[i].t} / ${texts[j].t}`);
      }
    // 막대 칸 안의 수가 제 칸 너비 안에 드는지(칸은 바로 앞의 rect).
    for (const t of document.querySelectorAll("text[text-anchor=middle]")) {
      const rect = t.previousElementSibling;
      if (rect?.tagName === "rect" && t.getBBox().width + 6 > rect.getBBox().width) out.push(`칸보다 넓은 수: ${t.textContent}`);
    }
    return out;
  });
  if (problems.length > 0) {
    console.error(`review-results-41:\n  ${problems.join("\n  ")}`);
    process.exitCode = 1;
  } else {
    writeFileSync(path.join(root, "docs/figures/review-results-41.svg"), svg);
    await page.locator("svg").screenshot({ path: path.join(root, "docs/figures/review-results-41.png") });
    console.log(`review-results-41: ${width}×${height}`);
  }
} finally {
  await browser.close();
}
