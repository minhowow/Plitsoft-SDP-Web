/**
 * 구조 쪽(/how/)의 그림을 그리는 바탕. 그림 한 장은 도형(네모·글·선)의 목록이고, 같은 목록으로 사이트의 그림
 * (`StructureFigure`, 색은 CSS 토큰이라 두 테마를 따른다)과 포스터·보고서용 파일(docs/figures/*.svg·png, 밝은 바탕,
 * `scripts/export-figures.mjs`)을 그린다. 좁은 화면에서는 그림 대신 같은 내용의 목록(`list`)을 위에서 아래로 보인다.
 *
 * 스크립트가 Node 로 바로 읽으므로(형만 지운다) 다른 파일을 불러오지 않고, 지울 수 있는 형 표기만 쓴다.
 */

/** 색의 뜻. 색은 뜻이 있는 곳에만 쓴다: 바깥으로 나감(주황, 개인정보 흐름 그림과 같다), 모델이 말한 것, 도구가 확인한 것. */
export type Tone = "plain" | "out" | "model" | "tool" | "keep";

export type Shape =
  | { kind: "rect"; id?: string; x: number; y: number; w: number; h: number; cls: string; dash?: boolean }
  | {
      kind: "text";
      x: number;
      y: number;
      text: string;
      cls: string;
      size: number;
      bold?: boolean;
      anchor?: "start" | "middle" | "end";
      /** 이 글이 들어가야 하는 네모의 id. 내보내는 스크립트가 넘치는지 잰다. */
      in?: string;
    }
  | { kind: "path"; d: string; cls: string; head?: "end" | "both" | "none"; dash?: boolean };

/** 좁은 화면의 목록 한 줄: 앞 줄에서 오는 화살표의 말(`via`), 꼬리표(경계·모델·도구), 이름, 줄. */
export interface ListItem {
  via?: string;
  viaTone?: Tone;
  tag?: string;
  tone?: Tone;
  title: string;
  lines: string[];
}

export interface ListSection {
  title?: string;
  tone?: Tone;
  items: ListItem[];
}

export interface Figure {
  id: string;
  /** docs/figures/ 의 파일 이름(확장자 없이). */
  file: string;
  title: string;
  width: number;
  height: number;
  shapes: Shape[];
  list: ListSection[];
  /** 그림 아래의 글(3~4줄). */
  notes: string[];
}

/** 글자 크기(그림 단위). 포스터에서는 그림 폭 대비 비율이 글자 크기를 정한다. */
export const SIZE = { lane: 15, title: 17, line: 14, edge: 14, tag: 12 } as const;
const LINE_GAP = 21;
const PAD = 14;

export class Canvas {
  shapes: Shape[] = [];

  /** 경계(브라우저, Vercel ...): 옅은 바탕의 큰 네모와 왼쪽 위의 이름. */
  lane(id: string, x: number, y: number, w: number, h: number, label: string, opts: { tone?: Tone; sub?: string; dash?: boolean } = {}) {
    const tone = opts.tone ?? "plain";
    this.shapes.push({ kind: "rect", id, x, y, w, h, cls: `hw-lane t-${tone}`, dash: opts.dash });
    this.shapes.push({ kind: "text", x: x + PAD, y: y + 24, text: label, cls: `hw-lane-name t-${tone}`, size: SIZE.lane, bold: true, in: id });
    if (opts.sub) this.shapes.push({ kind: "text", x: x + PAD, y: y + 24 + 19, text: opts.sub, cls: "hw-sub", size: SIZE.tag, in: id });
  }

  /** 일을 하는 상자: 이름(굵게)과 줄. 꼬리표(`tag`)는 오른쪽 위에 작게. */
  box(id: string, x: number, y: number, w: number, h: number, title: string, lines: string[] = [], opts: { tone?: Tone; tag?: string } = {}) {
    const tone = opts.tone ?? "plain";
    this.shapes.push({ kind: "rect", id, x, y, w, h, cls: `hw-box t-${tone}`, dash: tone === "model" });
    this.shapes.push({ kind: "text", x: x + PAD, y: y + 27, text: title, cls: "hw-title", size: SIZE.title, bold: true, in: id });
    if (opts.tag)
      this.shapes.push({ kind: "text", x: x + w - 10, y: y + 18, text: opts.tag, cls: `hw-tag t-${tone}`, size: SIZE.tag, bold: true, anchor: "end", in: id });
    lines.forEach((line, i) =>
      this.shapes.push({ kind: "text", x: x + PAD, y: y + 27 + 25 + i * LINE_GAP, text: line, cls: "hw-line", size: SIZE.line, in: id }),
    );
  }

  /** 화살표. 점을 차례로 잇는다(꺾인 선). */
  arrow(points: [number, number][], opts: { tone?: Tone; both?: boolean; dash?: boolean } = {}) {
    const d = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ");
    this.shapes.push({ kind: "path", d, cls: `hw-edge t-${opts.tone ?? "plain"}`, head: opts.both ? "both" : "end", dash: opts.dash });
  }

  /** 화살촉 없는 금(이음매 등). */
  line(points: [number, number][], cls: string, dash = false) {
    const d = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ");
    this.shapes.push({ kind: "path", d, cls, head: "none", dash });
  }

  /** 화살표에 붙는 말(무엇이 오가는지). */
  label(x: number, y: number, text: string, opts: { tone?: Tone; anchor?: "start" | "middle" | "end" } = {}) {
    this.shapes.push({ kind: "text", x, y, text, cls: `hw-elabel t-${opts.tone ?? "plain"}`, size: SIZE.edge, anchor: opts.anchor ?? "middle" });
  }

  /** 선 없는 글(그림의 범례, 경계 안의 덧붙임). */
  text(x: number, y: number, text: string, opts: { cls?: string; size?: number; bold?: boolean; anchor?: "start" | "middle" | "end"; in?: string } = {}) {
    this.shapes.push({ kind: "text", x, y, text, cls: opts.cls ?? "hw-line", size: opts.size ?? SIZE.line, bold: opts.bold, anchor: opts.anchor, in: opts.in });
  }

  /** 범례의 견본: 그 뜻의 상자를 작게 그리고 옆에 이름. 글의 끝 x 를 돌려준다(다음 견본을 놓을 자리). */
  swatch(x: number, y: number, tone: Tone, text: string, width: number) {
    this.shapes.push({ kind: "rect", x, y: y - 13, w: 28, h: 18, cls: `hw-box t-${tone}`, dash: tone === "model" });
    this.shapes.push({ kind: "text", x: x + 38, y, text, cls: `hw-tag t-${tone}`, size: SIZE.line, bold: true });
    return x + 38 + width;
  }

  /** 금(점선 네모 등)만. */
  rect(id: string, x: number, y: number, w: number, h: number, cls: string, dash = false) {
    this.shapes.push({ kind: "rect", id, x, y, w, h, cls, dash });
  }
}

/** 포스터·보고서용 파일의 색(사이트의 밝은 테마 토큰과 같은 값, src/app/globals.css). */
export const PAPER_STYLE = `
  .hw-bg { fill: #ffffff; }
  .hw-lane { fill: #f6f8fa; stroke: #d1d9e0; stroke-width: 1.5; }
  .hw-lane.t-out { fill: #fff1e5; stroke: #bc4c00; }
  .hw-lane.t-keep { fill: #ffffff; stroke: #818b98; }
  .hw-lane-name { fill: #1f2328; }
  .hw-lane-name.t-out { fill: #953800; }
  .hw-sub { fill: #59636e; }
  .hw-box { fill: #ffffff; stroke: #818b98; stroke-width: 1.5; }
  .hw-box.t-out { fill: #fff1e5; stroke: #bc4c00; stroke-width: 2; }
  .hw-box.t-model { fill: #fbefff; stroke: #8250df; stroke-width: 2; }
  .hw-box.t-tool { fill: #ddf4ff; stroke: #0969da; stroke-width: 2; }
  .hw-box.t-keep { fill: #ffffff; stroke: #1f2328; stroke-width: 2; }
  .hw-title { fill: #1f2328; }
  .hw-line { fill: #59636e; }
  .hw-tag { fill: #59636e; }
  .hw-tag.t-out { fill: #953800; }
  .hw-tag.t-model { fill: #8250df; }
  .hw-tag.t-tool { fill: #0969da; }
  .hw-edge { fill: none; stroke: #59636e; stroke-width: 2; }
  .hw-seam { fill: none; stroke: #59636e; stroke-width: 2; }
  .hw-edge.t-out { stroke: #bc4c00; stroke-width: 3; }
  .hw-head { fill: #59636e; }
  .hw-head.t-out { fill: #bc4c00; }
  .hw-elabel { fill: #59636e; paint-order: stroke; stroke: #ffffff; stroke-width: 5px; stroke-linejoin: round; }
  .hw-elabel.t-out { fill: #953800; font-weight: 700; }
`;

const FONT = "-apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', 'Noto Sans CJK KR', sans-serif";

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 화살촉 둘(보통, 바깥으로 나감). 사이트는 그림마다 id 를 달리한다(한 쪽에 그림이 셋). */
export const markerIds = (figureId: string) => ({ plain: `${figureId}-head`, out: `${figureId}-head-out` });

const toneOf = (cls: string): "out" | "plain" => (/\bt-out\b/.test(cls) ? "out" : "plain");

/** 파일로 내보낼 SVG(밝은 바탕). 글자는 그림 단위의 크기라 어디에 넣어도 그림 폭과 같은 비율로 커진다. */
export function figureSvg(figure: Figure): string {
  const ids = markerIds(figure.id);
  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${figure.width}" height="${figure.height}" viewBox="0 0 ${figure.width} ${figure.height}" font-family="${FONT}">`,
    `  <title>${esc(figure.title)}</title>`,
    "  <defs>",
    ...(["plain", "out"] as const).map(
      (tone) =>
        `    <marker id="${ids[tone]}" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="${tone === "out" ? 13 : 11}" markerHeight="${tone === "out" ? 13 : 11}" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" class="hw-head t-${tone}"/></marker>`,
    ),
    `    <style>${PAPER_STYLE}    </style>`,
    "  </defs>",
    `  <rect class="hw-bg" width="${figure.width}" height="${figure.height}"/>`,
  );
  for (const shape of figure.shapes) {
    if (shape.kind === "rect") {
      out.push(
        `  <rect class="${shape.cls}" x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}" rx="8"${shape.dash ? ' stroke-dasharray="7 5"' : ""}${shape.id ? ` data-id="${shape.id}"` : ""}/>`,
      );
    } else if (shape.kind === "text") {
      const anchor = shape.anchor && shape.anchor !== "start" ? ` text-anchor="${shape.anchor}"` : "";
      const weight = shape.bold ? ' font-weight="700"' : "";
      const fit = shape.in ? ` data-in="${shape.in}"` : "";
      out.push(`  <text class="${shape.cls}" x="${shape.x}" y="${shape.y}" font-size="${shape.size}"${weight}${anchor}${fit}>${esc(shape.text)}</text>`);
    } else {
      const head = `url(#${ids[toneOf(shape.cls)]})`;
      const start = shape.head === "both" ? ` marker-start="${head}"` : "";
      const end = shape.head === "none" ? "" : ` marker-end="${head}"`;
      out.push(`  <path class="${shape.cls}" d="${shape.d}"${shape.dash ? ' stroke-dasharray="7 5"' : ""}${start}${end}/>`);
    }
  }
  out.push("</svg>", "");
  return out.join("\n");
}
