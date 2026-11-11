import type { Metadata } from "next";
import sample from "@contract/review/genai-chat.review.json";
import { ReviewView } from "@/components/review/ReviewView";
import { parseReview } from "@/lib/review";

export const metadata: Metadata = { title: "review 결과 · 합성 예시" };

/**
 * review 결과 화면을 합성 예시로 보는 쪽(빌드할 때 그린다). 자료는 손으로 만든 review 2판 결과(contract/review/genai-chat.review.json,
 * 가상의 생성형 AI 채팅 서비스)다. 실제 저장소의 결과는 CLI 가 미리 돌려 넘긴 뒤 사례 쪽에 싣는다(2026-11-11 오너 지시).
 */
export default function ReviewSamplePage() {
  const review = parseReview(sample);
  return (
    <div className="page-wide an-page">
      <header className="an-head">
        <div className="ttl">
          <h1>
            review 결과 <span className="tag">합성 예시</span>
          </h1>
        </div>
      </header>
      {review ? <ReviewView review={review} /> : <p className="notice notice-warn">예시 결과를 읽지 못했습니다.</p>}
    </div>
  );
}
