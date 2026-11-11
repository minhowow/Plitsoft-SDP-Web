import { Icon } from "@/components/Icon";
import { Where } from "@/components/result/Where";
import type { CaseCitation, CaseData } from "@/lib/cases";
import { fileLink, shortCommit } from "@/lib/service/href";

/** 사람이 쓴 글. 역따옴표로 감싼 곳은 코드로 적는다. 글자는 그대로다. */
export function Prose({ text }: { text: string }) {
  return text.split("`").map((part, i) =>
    i % 2 === 1 ? (
      <code key={i} translate="no">
        {part}
      </code>
    ) : (
      part
    ),
  );
}

/** 파일·줄. 미리 돌린 그 커밋에 고정한 GitHub 링크(새 창). */
export function CaseWhere({ data, file, line }: { data: CaseData; file: string; line: number }) {
  return (
    <a className="case-at" href={fileLink(data.htmlUrl, data.commit, file, line) ?? undefined} target="_blank" rel="noopener noreferrer">
      <Where file={file} line={line} />
      <Icon name="external" />
      <span className="visually-hidden">(새 창, 커밋 {shortCommit(data.commit)} 에 고정)</span>
    </a>
  );
}

/** AI 가 댄 근거 줄: 줄마다 파일·줄(GitHub 링크)과 그 글(결과에 실린 그대로). */
export function CaseCites({ data, cites }: { data: CaseData; cites: CaseCitation[] }) {
  if (cites.length === 0) return null;
  return (
    <>
      <p className="case-cites-lbl">AI 가 인용한 줄</p>
      <ul className="cites">
        {cites.map((cite, i) => (
          <li key={i} className="cite">
            <span className="cite-at">
              <CaseWhere data={data} file={cite.file} line={cite.line} />
            </span>
            <code className="cite-text" translate="no">
              {cite.text}
            </code>
          </li>
        ))}
      </ul>
    </>
  );
}
