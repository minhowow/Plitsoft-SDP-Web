import Link from "next/link";
import type { ReactNode } from "react";
import { keepArticle } from "@/components/text";
import { packMeta, policyHref, primaryLaw } from "@/lib/pack";
import { hangulToQwerty } from "@/lib/service/keyboard";
import { searchHref } from "@/lib/service/href";
import { FAKE_GITHUB_NOTE, githubStatusLine } from "@/lib/service/suggest";
import type { RepositoryActivity, SearchOutcome } from "@/lib/service/types";
import { SITE } from "@/lib/site";
import { ActivityList } from "./activity";
import { AnalyzedRow, RepoRow } from "./parts";
import { SearchForm } from "./SearchForm";

/**
 * 되뇌는 글 ‘…’에 조사를 붙인다. 검색어는 주소(`?q=`)에서 오는 남의 글이라 빈칸 없이 길 수 있다. 통째로 줄을 바꾸지 않는 조각
 * (`keepParticles` 의 `.nobreak`)으로 묶으면 좁은 화면에서 가로로 넘친다(검토 1: 375px 에서 60자가 434px). 그래서 검색어는
 * 아무 데서나 줄이 바뀌게 두고(`.search-q`), 마지막 글자와 닫는 따옴표·조사만 묶는다(조사가 줄 머리로 떨어지지 않게).
 * 글자는 그대로다.
 */
function Echoed({ text, particle }: { text: string; particle: string }) {
  const chars = Array.from(text);
  const last = chars.pop() ?? "";
  return (
    <>
      ‘<span className="search-q">{chars.join("")}</span>
      <span className="nobreak">
        {last}’{particle}
      </span>
    </>
  );
}

/** 합성 예시 이름표(docs/commitments.md 의 1). 다는지는 서버가 정한다(`showsSyntheticTag`). */
function Tag({ on }: { on: boolean }) {
  return on ? <span className="tag">합성 예시</span> : null;
}

/** 로컬 가짜 GitHub 에 묻는 사이트에서만: 찾는 것이 합성 저장소뿐이라는 한 줄. 저장소 수는 적지 않는다(가짜 GitHub 이 정한다). */
const FAKE_GITHUB = FAKE_GITHUB_NOTE;

/** 읽은 최근 분석. DB 에 닿지 못하면 그 까닭이다. */
export type LoadedActivity = { ok: true; rows: RepositoryActivity[]; findings: Record<string, number | null> } | { ok: false; message: string };

/**
 * 검색 쪽의 빈 상태(`/search/` 를 질의 없이 연 쪽. 도구 화면의 이름이 여기로 온다. 목업 search-home #closed). 검색창, 이 사이트의
 * 최근 분석 상자, 곁칸의 검사하는 정책(팩 메타데이터의 정책 모두. 수를 글로 박아 두지 않는다).
 */
export function SearchHome({ recent, tagged }: { recent: LoadedActivity; tagged: boolean }) {
  const policies = packMeta.policies;
  return (
    <div className="search-home" data-page="search-home">
      <div className="search-home-q">
        <SearchForm id="search-page-q" label="저장소 검색(이 쪽)" />
      </div>
      <section className="box search-home-recent" aria-labelledby="recent-title">
        <div className="box-hd">
          <h2 id="recent-title">최근 분석</h2>
          <Tag on={tagged} />
          {recent.ok && recent.rows.length > 0 && <span className="box-end">시각 KST</span>}
        </div>
        {!recent.ok ? (
          <p className="notice notice-warn box-in">{recent.message}</p>
        ) : recent.rows.length === 0 ? (
          <p className="box-empty">아직 분석 없음</p>
        ) : (
          <ActivityList rows={recent.rows} findings={recent.findings} variant="box" />
        )}
      </section>
      <section className="box search-home-side" aria-labelledby="policies-title">
        <div className="box-hd">
          <h2 id="policies-title">
            검사하는 정책 <span className="count">{policies.length}</span>
          </h2>
          <Link href="/policy/" className="box-end">
            조문 도감
          </Link>
        </div>
        <ul className="pol-list">
          {policies.map((policy) => (
            <li key={policy.id}>
              <Link href={policyHref(policy.id)} className="pol-row">
                <span className="pol-title">{policy.title}</span>
                <span className="pol-law">{keepArticle(primaryLaw(policy))}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/**
 * 검색 쪽의 본문(`?q=` 가 있을 때). 서버가 질의로 저장소를 찾아 그린다(운영: GitHub 검색, 합성 미리보기: 합성 목록). 검색창은
 * 보통의 GET 양식이라 엔터나 단추로 `/search/?q=…` 로 간다. 치는 동안 찾지 않는다(GitHub 을 글자마다 부르지 않는다).
 *
 * 0건이면 까닭이 될 수 있는 사실만 적는다(docs/redesign.md 3장 "검색"): GitHub 에 물었으면 `GitHub 에 없음`, 한글만 친 질의에는
 * 같은 글쇠의 영문으로 찾는 링크, 로컬 가짜 GitHub 이면 그 사실, 그 아래 이 사이트에서 분석된 저장소. GitHub 에 묻지 못했으면
 * 자동 완성과 같은 말(`GitHub 에 묻지 못함(요청 수 상한)` 등)과 서버가 준 까닭을 적고, 그 아래에도 이 사이트에서 분석된 저장소를
 * 둔다(docs/redesign.md 5장: "GitHub 에 없음"과 "묻지 못함"을 가른다).
 */
export function SearchResults({
  query,
  outcome,
  tagged,
  fakeGitHub,
  github = false,
  analyzed = null,
}: {
  query: string;
  outcome: SearchOutcome;
  tagged: boolean;
  /** 로컬 가짜 GitHub 에 묻는 사이트인지(`usesFakeGitHub`). */
  fakeGitHub: boolean;
  /** 이 사이트의 검색이 GitHub 에 묻는지(운영 저장소 구현). 합성 미리보기는 합성 목록을 거른다. */
  github?: boolean;
  /** 0건일 때 보일 이 사이트의 분석된 저장소. */
  analyzed?: LoadedActivity | null;
}) {
  let body: ReactNode;
  if (!outcome.ok) {
    const line = outcome.github ? githubStatusLine({ status: outcome.github, total: null }) : null;
    body = (
      <>
        <div className="empty-block" role="status">
          <h2 className="empty-head search-count">
            <Echoed text={query} particle="" /> 검색하지 못함
          </h2>
          {line && <p>{line}</p>}
          <p className="muted">{outcome.message}</p>
        </div>
        {analyzed && <Analyzed analyzed={analyzed} tagged={tagged} />}
      </>
    );
  } else if (outcome.hits.length === 0) {
    const english = hangulToQwerty(query);
    body = (
      <>
        <div className="empty-block" role="status">
          <h2 className="empty-head search-count">
            <Echoed text={query} particle="에" /> 맞는 저장소 없음
          </h2>
          {github && <p>{githubStatusLine({ status: "ok", total: 0 })}</p>}
          {english && (
            <p>
              <Link href={searchHref(english)}>
                영문 자판으로 친 <Echoed text={english} particle="로" /> 찾기
              </Link>
            </p>
          )}
          {fakeGitHub && <p className="muted">{FAKE_GITHUB}</p>}
        </div>
        {analyzed && <Analyzed analyzed={analyzed} tagged={tagged} />}
      </>
    );
  } else {
    const shown = outcome.hits.length;
    body = (
      <section aria-labelledby="results-title">
        <div className="sec-h">
          <h2 id="results-title" className="search-count">
            <Echoed text={query} particle="" /> 결과{" "}
            <span className="count">
              {outcome.total > shown ? `${outcome.total.toLocaleString("en-US")}개 가운데 ${shown}개` : shown}
            </span>
          </h2>
          <Tag on={tagged} />
          {fakeGitHub && <span className="sec-end muted">{FAKE_GITHUB}</span>}
        </div>
        <ul className="box sr-list" aria-label="검색 결과">
          {outcome.hits.map((hit) => (
            <RepoRow key={`${hit.repository.owner}/${hit.repository.name}`} hit={hit} />
          ))}
        </ul>
      </section>
    );
  }
  return (
    <div className="search-page">
      {/* 쪽 제목은 검색창과 16px(이 단의 간격)로 붙인다(목업 search) */}
      <h1>저장소 검색</h1>
      {/* 질의가 바뀌면(같은 쪽 안의 이동) 검색창을 새로 그려 그 질의를 채운다 */}
      <SearchForm key={query} id="search-page-q" label="저장소 검색(이 쪽)" defaultValue={query} />
      {body}
    </div>
  );
}

/** 검색 0건 아래의 "이 사이트에서 분석된 저장소". 없으면 그리지 않는다. 발견 0건이 보이면 0의 뜻을 둔다. */
function Analyzed({ analyzed, tagged }: { analyzed: LoadedActivity; tagged: boolean }) {
  if (!analyzed.ok) return <p className="notice notice-warn">{analyzed.message}</p>;
  if (analyzed.rows.length === 0) return null;
  const zero = analyzed.rows.some(({ analysis }) => analysis.status === "succeeded" && analyzed.findings[analysis.id] === 0);
  return (
    <section aria-labelledby="analyzed-title">
      <div className="sec-h">
        <h2 id="analyzed-title">이 사이트에서 분석된 저장소</h2>
        <Tag on={tagged} />
      </div>
      <ul className="box sr-list">
        {analyzed.rows.map((activity) => (
          <AnalyzedRow key={activity.analysis.id} activity={activity} count={analyzed.findings[activity.analysis.id]} />
        ))}
      </ul>
      {zero && <p className="hint zero-note">{SITE.zeroIsNotClearance}</p>}
    </section>
  );
}
