import Link from "next/link";
import { HomeCase } from "@/components/cases/HomeCase";
import { ActivityList } from "@/components/service/activity";
import { HomeSearch } from "@/components/service/SearchForm";
import { orUnavailable } from "@/lib/service/errors";
import { SITE } from "@/lib/site";
import { showsSyntheticTag } from "@/server/config";
import { getStore } from "@/server/store";

// 최근 분석은 요청 때 DB 에서 읽는다. 이 쪽은 다시 읽지 않는다(진행 중인 줄도 그린 때의 것이다. docs/redesign.md 의 D3 결과).
export const dynamic = "force-dynamic";

/** 첫 화면에 보이는 최근 분석 줄 수(저장소마다 한 줄). */
const HOME_ROWS = 4;

/**
 * 첫 화면(docs/redesign.md 3장 "첫 화면", 목업 home-feed). 머리글 없이 가운데 한 단에 표지(서비스 이름), 큰 검색창, 이 사이트의
 * 최근 분석(저장소마다 한 줄). 검색창과 최근 분석 사이에 공개 사례 한 건이 지나는 길과 그 체크리스트 일부를 둔다(2026-11-13 오너
 * 지시, `HomeCase`). 설명 구획은 두지 않는다. 면책은 바닥글에 있다. 머리글을 감추는 것은 CSS 가 이 쪽의 표시
 * (`data-page="home"`)를 보고 한다(머리글의 HTML 은 모든 쪽에서 같다).
 */
export default async function Home() {
  const store = getStore();
  const loaded = await orUnavailable(
    (async () => {
      const rows = await store.recentActivity(HOME_ROWS);
      const done = rows.filter(({ analysis }) => analysis.status === "succeeded").map(({ analysis }) => analysis.id);
      const findings = await store.findingCounts(done);
      const features = await store.featureNames(done);
      return { rows, findings, features };
    })(),
  );
  const tagged = showsSyntheticTag();

  return (
    <div className="home" data-page="home">
      <h1 className="wm">
        <Wordmark />
      </h1>
      <HomeSearch id="home-q" label="저장소 검색" />
      <HomeCase />
      <section className="home-feed" aria-labelledby="recent-title">
        <div className="home-feed-hd">
          <h2 id="recent-title">최근 분석</h2>
          {tagged && <span className="tag">합성 예시</span>}
          {loaded.ok && loaded.value.rows.length > 0 && <span className="home-kst">시각 KST</span>}
          <Link href="/search/" className="home-all">
            모두 보기
          </Link>
        </div>
        {!loaded.ok ? (
          <p className="notice notice-warn">{loaded.message}</p>
        ) : loaded.value.rows.length === 0 ? (
          <p className="home-empty">아직 분석 없음</p>
        ) : (
          <ActivityList rows={loaded.value.rows} findings={loaded.value.findings} features={loaded.value.features} variant="feed" />
        )}
      </section>
    </div>
  );
}

/**
 * 표지: 서비스 이름(`SITE.name`). 한글 낱말은 라틴 글자의 어센더 높이에 맞춰 조금 작게 적는다(CSS `.wm-ko`). 이름이 바뀌어도
 * 낱말마다 한글이 들었는지로만 가른다.
 */
function Wordmark() {
  const words = SITE.name.split(" ");
  return (
    <>
      {words.map((word, i) => (
        <span key={i}>
          {i > 0 && " "}
          <span className={/[가-힣]/.test(word) ? "wm-ko" : "wm-latin"} translate={/[가-힣]/.test(word) ? undefined : "no"}>
            {word}
          </span>
        </span>
      ))}
    </>
  );
}
