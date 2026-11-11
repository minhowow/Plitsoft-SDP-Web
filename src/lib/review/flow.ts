import type { FlowEdge, FlowKind, FlowNode } from "./index";

/**
 * 개인정보 흐름 그림의 자리 잡기(2026-11-11 오너 지시: 무엇을 받아 → 어디에 저장하고 → 어느 외부로 보내나). 서버가 셈해 SVG 의
 * 좌표만 넘긴다(바깥 스크립트·그림 꾸러미를 쓰지 않는다).
 *
 * - 단은 셋이다: 받는 것(input) | 처리(server) | 저장(store)과 외부로 보냄(external). 마지막 단은 저장을 위에, 외부를 아래에 둔다.
 *   마디가 없는 단은 걷는다.
 * - 단 안의 차례는 앞 단에서 이어 오는 마디들의 높이 가운데(무게 중심)로 정한다. 화살표가 덜 엇갈린다.
 * - 화살표는 앞 마디의 오른쪽에서 뒤 마디의 왼쪽으로 잇는 굽은 선이다. 한 마디에 여럿이 닿으면 닿는 자리를 위아래로 벌린다.
 * - 외부로 나가는 화살표(`outward`)는 화면에서 눈에 띄게 그린다.
 * - 글은 SVG 가 줄을 바꾸지 않으므로 여기서 나눈다. 한글은 글자 너비 1, 그 밖은 0.55 로 어림한다.
 */

export interface FlowBox {
  id: string;
  kind: FlowKind;
  x: number;
  y: number;
  w: number;
  h: number;
  labelLines: string[];
  dataLines: string[];
}

export interface FlowPath {
  from: string;
  to: string;
  d: string;
  /** 외부(external) 마디로 가는 화살표. */
  outward: boolean;
}

export interface FlowColumn {
  x: number;
  w: number;
  title: string;
}

export interface FlowLayout {
  width: number;
  height: number;
  columns: FlowColumn[];
  boxes: FlowBox[];
  paths: FlowPath[];
}

export const NODE_W = 216;
const COL_GAP = 104;
const PAD_X = 8;
const TOP = 44;
const NODE_GAP = 18;
const GROUP_GAP = 34;
const LABEL_SIZE = 14;
const DATA_SIZE = 12;
const LABEL_LINE = 19;
const DATA_LINE = 16;
const INNER = NODE_W - 28;

/** 글자 하나의 너비(em) 어림. */
const charWidth = (ch: string) => (/[ᄀ-ᇿ　-鿿가-힯＀-￯]/.test(ch) ? 1 : 0.55);

/** 글을 너비(px)에 맞춰 줄로 나눈다. 빈칸이나 가운뎃점 뒤에서 먼저 끊고, 줄이 `max` 를 넘으면 마지막 줄 끝에 말줄임을 붙인다. */
export function wrapText(text: string, size: number, width: number, max: number): string[] {
  const limit = width / size;
  const lines: string[] = [];
  let line = "";
  let used = 0;
  let lastBreak = -1;
  for (const ch of text) {
    const w = charWidth(ch);
    if (used + w > limit && line !== "") {
      if (lastBreak > 0 && lastBreak < line.length) {
        lines.push(line.slice(0, lastBreak).trimEnd());
        line = line.slice(lastBreak).trimStart();
      } else {
        lines.push(line);
        line = "";
      }
      used = [...line].reduce((sum, c) => sum + charWidth(c), 0);
      lastBreak = -1;
    }
    line += ch;
    used += w;
    if (ch === " " || ch === "·" || ch === ",") lastBreak = line.length;
  }
  if (line.trim() !== "") lines.push(line.trimEnd());
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  kept[max - 1] = `${kept[max - 1].replace(/\s*\S?$/, "")}…`;
  return kept;
}

const COLUMN_OF: Record<FlowKind, number> = { input: 0, server: 1, store: 2, external: 2 };

function heightOf(box: Pick<FlowBox, "labelLines" | "dataLines">): number {
  return 12 + box.labelLines.length * LABEL_LINE + (box.dataLines.length > 0 ? 4 + box.dataLines.length * DATA_LINE : 0) + 10;
}

/** 단의 이름: 마지막 단은 든 것에 따라. */
function titleOf(column: number, kinds: Set<FlowKind>): string {
  if (column === 0) return "받는 것";
  if (column === 1) return "처리";
  if (kinds.has("store") && kinds.has("external")) return "저장 · 외부로 보냄";
  return kinds.has("store") ? "저장" : "외부로 보냄";
}

export function layoutFlow(nodes: FlowNode[], edges: FlowEdge[]): FlowLayout {
  const boxes = new Map<string, FlowBox>();
  for (const node of nodes) {
    const labelLines = wrapText(node.label, LABEL_SIZE, INNER, 2);
    const dataLines = node.data.length > 0 ? wrapText(node.data.join(" · "), DATA_SIZE, INNER, 2) : [];
    boxes.set(node.id, { id: node.id, kind: node.kind, x: 0, y: 0, w: NODE_W, h: 0, labelLines, dataLines });
  }
  for (const box of boxes.values()) box.h = heightOf(box);

  const preds = new Map<string, string[]>();
  for (const edge of edges) preds.set(edge.to, [...(preds.get(edge.to) ?? []), edge.from]);

  // 단마다의 마디(차례는 아직 결과에 실린 대로). 마디가 없는 단은 걷는다.
  const raw: FlowNode[][] = [[], [], []];
  for (const node of nodes) raw[COLUMN_OF[node.kind]].push(node);
  const used = raw.map((list, i) => ({ list, i })).filter((c) => c.list.length > 0);

  const columnHeight = (list: FlowNode[], column: number) => {
    let h = 0;
    list.forEach((node, k) => {
      h += boxes.get(node.id)!.h + (k > 0 ? NODE_GAP : 0);
    });
    // 저장과 외부 사이는 조금 더 벌린다.
    if (column === 2 && list.some((n) => n.kind === "store") && list.some((n) => n.kind === "external")) h += GROUP_GAP - NODE_GAP;
    return h;
  };
  const maxH = Math.max(0, ...used.map(({ list, i }) => columnHeight(list, i)));

  const centerY = (id: string) => {
    const box = boxes.get(id)!;
    return box.y + box.h / 2;
  };
  const columns: FlowColumn[] = [];
  const placed = new Set<string>();
  used.forEach(({ list, i }, position) => {
    const x = PAD_X + position * (NODE_W + COL_GAP);
    columns.push({ x, w: NODE_W, title: titleOf(i, new Set(list.map((n) => n.kind))) });
    // 앞 단에서 이어 오는 마디의 높이 가운데로 차례를 정한다(이어 오는 것이 없으면 실린 차례 그대로 뒤에).
    const weight = (node: FlowNode, index: number) => {
      const from = (preds.get(node.id) ?? []).filter((id) => placed.has(id));
      return from.length > 0 ? from.reduce((sum, id) => sum + centerY(id), 0) / from.length : Number.MAX_SAFE_INTEGER / 2 + index;
    };
    const order = (group: FlowNode[]) =>
      position === 0 ? group : group.map((node, index) => ({ node, w: weight(node, index) })).sort((a, b) => a.w - b.w).map((e) => e.node);
    const sorted = i === 2 ? [...order(list.filter((n) => n.kind === "store")), ...order(list.filter((n) => n.kind === "external"))] : order(list);
    let y = TOP + (maxH - columnHeight(sorted, i)) / 2;
    sorted.forEach((node, k) => {
      const box = boxes.get(node.id)!;
      if (k > 0 && node.kind === "external" && sorted[k - 1].kind === "store") y += GROUP_GAP - NODE_GAP;
      box.x = x;
      box.y = y;
      y += box.h + NODE_GAP;
    });
    for (const node of sorted) placed.add(node.id);
  });

  // 닿는 자리: 한 마디에서 나가거나 들어오는 화살표가 여럿이면 상대의 높이 차례로 위아래로 벌린다.
  const portY = (id: string, others: string[], other: string) => {
    const box = boxes.get(id)!;
    const sorted = [...others].sort((a, b) => centerY(a) - centerY(b));
    const n = sorted.length;
    const step = Math.min(12, (box.h - 16) / Math.max(1, n - 1));
    return box.y + box.h / 2 + (sorted.indexOf(other) - (n - 1) / 2) * step;
  };
  const outs = new Map<string, string[]>();
  const ins = new Map<string, string[]>();
  for (const edge of edges) {
    outs.set(edge.from, [...(outs.get(edge.from) ?? []), edge.to]);
    ins.set(edge.to, [...(ins.get(edge.to) ?? []), edge.from]);
  }
  const paths: FlowPath[] = edges.map((edge) => {
    const a = boxes.get(edge.from)!;
    const b = boxes.get(edge.to)!;
    const sy = portY(edge.from, outs.get(edge.from)!, edge.to);
    const ty = portY(edge.to, ins.get(edge.to)!, edge.from);
    const forward = b.x > a.x;
    const sx = forward ? a.x + a.w : a.x + a.w / 2;
    const tx = forward ? b.x - 7 : b.x + b.w / 2;
    const bend = forward ? Math.max(40, (tx - sx) / 2) : 60;
    const d = forward
      ? `M${sx},${sy.toFixed(1)} C${(sx + bend).toFixed(1)},${sy.toFixed(1)} ${(tx - bend).toFixed(1)},${ty.toFixed(1)} ${tx},${ty.toFixed(1)}`
      : `M${sx},${(a.y + a.h).toFixed(1)} C${sx},${(a.y + a.h + bend).toFixed(1)} ${tx},${(b.y - bend).toFixed(1)} ${tx},${(b.y - 7).toFixed(1)}`;
    return { from: edge.from, to: edge.to, d, outward: b.kind === "external" };
  });

  const width = PAD_X * 2 + used.length * NODE_W + Math.max(0, used.length - 1) * COL_GAP;
  return { width, height: TOP + maxH + 12, columns, boxes: [...boxes.values()], paths };
}
