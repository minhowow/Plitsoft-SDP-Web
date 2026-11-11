"use client";

import { useState, type KeyboardEvent } from "react";
import { Icon } from "@/components/Icon";
import type { CodeSource } from "@/components/result/PolicyCard";
import { Where } from "@/components/result/Where";
import type { FlowEdge, FlowKind, FlowNode, ReviewCitation } from "@/lib/review";
import type { FlowLayout } from "@/lib/review/flow";
import { fileLink, shortCommit } from "@/lib/service/href";

/** 마디 종류의 이름(화면 낭독기와 고른 마디의 머리). */
const KIND_LABEL: Record<FlowKind, string> = { input: "받는 것", server: "처리", store: "저장", external: "외부로 보냄" };

/** 인용한 줄: 위치(분석 쪽은 GitHub 의 커밋 고정 링크)와 줄의 글. 관문을 통과한 인용만 받는다. */
export function CitedLines({ citations, code }: { citations: ReviewCitation[]; code: CodeSource | null }) {
  if (citations.length === 0) return null;
  return (
    <ul className="cites">
      {citations.map((cite, i) => {
        const link = code && fileLink(code.htmlUrl, code.commit, cite.file, cite.line);
        const where = <Where file={cite.file} line={cite.line} />;
        return (
          <li key={`${cite.file}:${cite.line}:${i}`} className="cite">
            <span className="cite-at">
              {link && code ? (
                <a className="gh" href={link} target="_blank" rel="noopener noreferrer">
                  {where}
                  <Icon name="external" />
                  <span className="visually-hidden">(GitHub, 새 창, 커밋 {shortCommit(code.commit)} 에 고정)</span>
                </a>
              ) : (
                where
              )}
            </span>
            <code className="cite-text" translate="no">
              {cite.text}
            </code>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * 개인정보 흐름 그림(2026-11-11 오너 지시). 자리는 서버가 셈해 넘긴다(`layoutFlow`). 마디를 누르거나 Enter·Space 를 누르면 그 마디가
 * 골라지고, 그림 아래에 그 마디의 자료와 인용한 줄(관문을 통과한 것), 이어진 화살표가 보인다. 처음에는 첫 외부 마디를 고른다
 * (외부로 나가는 것이 가장 먼저 볼 것이다). 외부로 나가는 화살표는 눈에 띄는 색과 굵기로 그린다. 바깥 스크립트를 쓰지 않는다.
 */
export function FlowFigure({
  layout,
  nodes,
  edges,
  code,
}: {
  layout: FlowLayout;
  nodes: FlowNode[];
  edges: FlowEdge[];
  code: CodeSource | null;
}) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const first = nodes.find((node) => node.kind === "external") ?? nodes[0];
  const [selected, setSelected] = useState<string | null>(first?.id ?? null);
  const node = selected ? byId.get(selected) : undefined;
  const pick = (id: string) => setSelected(id);
  const onKey = (event: KeyboardEvent<SVGGElement>, id: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pick(id);
    }
  };
  const incoming = node ? edges.filter((edge) => edge.to === node.id) : [];
  const outgoing = node ? edges.filter((edge) => edge.from === node.id) : [];
  return (
    <figure className="flow">
      <div className="flow-scroll">
        <svg
          className="flow-svg"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          width={layout.width}
          height={layout.height}
          role="group"
          aria-label="개인정보 흐름"
        >
          <defs>
            {/* 화살촉은 선 굵기를 따라 커지지 않게 그림의 단위로 잰다. */}
            <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" className="flow-head" />
            </marker>
            <marker id="flow-arrow-out" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" className="flow-head-out" />
            </marker>
          </defs>
          {layout.columns.map((column) => (
            <text key={column.x} x={column.x} y={20} className="flow-col">
              {column.title}
            </text>
          ))}
          {layout.paths.map((path, i) => {
            const on = selected !== null && (path.from === selected || path.to === selected);
            return (
              <path
                key={`${path.from}-${path.to}-${i}`}
                d={path.d}
                className={`flow-edge${path.outward ? " out" : ""}${on ? " on" : ""}`}
                markerEnd={`url(#${path.outward ? "flow-arrow-out" : "flow-arrow"})`}
              />
            );
          })}
          {layout.boxes.map((box) => {
            const data = byId.get(box.id);
            const name = `${KIND_LABEL[box.kind]}: ${data?.label ?? box.id}${data && data.data.length > 0 ? ` — ${data.data.join(", ")}` : ""}`;
            return (
              <g
                key={box.id}
                className={`flow-node k-${box.kind}${selected === box.id ? " sel" : ""}`}
                role="button"
                tabIndex={0}
                aria-pressed={selected === box.id}
                aria-label={name}
                onClick={() => pick(box.id)}
                onKeyDown={(event) => onKey(event, box.id)}
              >
                <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={8} />
                {box.kind === "external" && (
                  <text x={box.x + box.w - 12} y={box.y + 18} className="flow-tag" textAnchor="end">
                    외부
                  </text>
                )}
                {box.labelLines.map((line, i) => (
                  <text key={`l${i}`} x={box.x + 14} y={box.y + 26 + i * 19} className="flow-label">
                    {line}
                  </text>
                ))}
                {box.dataLines.map((line, i) => (
                  <text key={`d${i}`} x={box.x + 14} y={box.y + 26 + box.labelLines.length * 19 + 4 + i * 16} className="flow-data">
                    {line}
                  </text>
                ))}
              </g>
            );
          })}
        </svg>
      </div>
      {node && (
        <div className="flow-panel" aria-live="polite">
          <p className="flow-panel-hd">
            <span className="flow-kind">{KIND_LABEL[node.kind]}</span> <strong>{node.label}</strong>
          </p>
          {node.data.length > 0 && <p className="flow-panel-data">{node.data.join(" · ")}</p>}
          {(incoming.length > 0 || outgoing.length > 0) && (
            <ul className="flow-links">
              {incoming.map((edge, i) => (
                <li key={`in${i}`}>
                  ← {byId.get(edge.from)?.label}
                  {edge.data.length > 0 && <span className="flow-link-data"> {edge.data.join(" · ")}</span>}
                </li>
              ))}
              {outgoing.map((edge, i) => (
                <li key={`out${i}`} className={byId.get(edge.to)?.kind === "external" ? "out" : undefined}>
                  → {byId.get(edge.to)?.label}
                  {edge.data.length > 0 && <span className="flow-link-data"> {edge.data.join(" · ")}</span>}
                </li>
              ))}
            </ul>
          )}
          <CitedLines citations={node.citations.filter((cite) => cite.ok)} code={code} />
        </div>
      )}
    </figure>
  );
}
