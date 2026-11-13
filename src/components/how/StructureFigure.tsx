import { markerIds, type Figure, type Tone } from "@/lib/how/draw";

const TONE_CLASS: Record<Tone, string> = { plain: "", out: " t-out", model: " t-model", tool: " t-tool", keep: " t-keep" };

/**
 * 구조 쪽의 그림 한 장(서버 부품). 넓은 화면에서는 SVG(색은 CSS 토큰), 좁은 화면에서는 같은 내용을 위에서 아래로 읽는 목록이다.
 * 목록은 넓은 화면에서도 화면 낭독기에 읽힌다(그림은 낭독기에 감춘다). 그림의 도형과 목록은 `src/lib/how/` 에 있고,
 * 포스터·보고서용 파일(docs/figures/)도 같은 것으로 그린다.
 */
export function StructureFigure({ figure }: { figure: Figure }) {
  const ids = markerIds(figure.id);
  return (
    <figure className="hw" aria-labelledby={`${figure.id}-h`}>
      <div className="hw-wide" aria-hidden="true">
        <svg className="hw-svg" viewBox={`0 0 ${figure.width} ${figure.height}`} width={figure.width} height={figure.height}>
          <defs>
            {(["plain", "out"] as const).map((tone) => (
              <marker
                key={tone}
                id={ids[tone]}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerUnits="userSpaceOnUse"
                markerWidth={tone === "out" ? 13 : 11}
                markerHeight={tone === "out" ? 13 : 11}
                orient="auto-start-reverse"
              >
                <path d="M0 0 L10 5 L0 10 z" className={`hw-head t-${tone}`} />
              </marker>
            ))}
          </defs>
          {figure.shapes.map((shape, i) => {
            if (shape.kind === "rect")
              return (
                <rect
                  key={i}
                  className={shape.cls}
                  x={shape.x}
                  y={shape.y}
                  width={shape.w}
                  height={shape.h}
                  rx={8}
                  strokeDasharray={shape.dash ? "7 5" : undefined}
                />
              );
            if (shape.kind === "text")
              return (
                <text
                  key={i}
                  className={shape.cls}
                  x={shape.x}
                  y={shape.y}
                  fontSize={shape.size}
                  fontWeight={shape.bold ? 700 : undefined}
                  textAnchor={shape.anchor && shape.anchor !== "start" ? shape.anchor : undefined}
                >
                  {shape.text}
                </text>
              );
            const head = `url(#${/\bt-out\b/.test(shape.cls) ? ids.out : ids.plain})`;
            return (
              <path
                key={i}
                className={shape.cls}
                d={shape.d}
                strokeDasharray={shape.dash ? "7 5" : undefined}
                markerStart={shape.head === "both" ? head : undefined}
                markerEnd={shape.head === "none" ? undefined : head}
              />
            );
          })}
        </svg>
      </div>
      <div className="hw-list">
        {figure.list.map((section, s) => (
          <section key={s} className={`hw-sec${TONE_CLASS[section.tone ?? "plain"]}`}>
            {section.title && <p className="hw-sec-h">{section.title}</p>}
            <ol>
              {section.items.map((item, i) => (
                <li key={i}>
                  {item.via && <p className={`hw-via${TONE_CLASS[item.viaTone ?? "plain"]}`}>{item.via}</p>}
                  <div className={`hw-item${TONE_CLASS[item.tone ?? "plain"]}`}>
                    <p className="hw-item-h">
                      {item.tag && <span className={`hw-chip${TONE_CLASS[item.tone ?? "plain"]}`}>{item.tag}</span>}
                      <strong>{item.title}</strong>
                    </p>
                    {item.lines.length > 0 && (
                      <ul>
                        {item.lines.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </figure>
  );
}
