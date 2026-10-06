import genaiChatFixed from "@contract/cli-current/genai-chat.fixed.json";
import genaiChatMain from "@contract/cli-current/genai-chat.main.json";
import kidsSignupFixed from "@contract/cli-current/kids-signup.fixed.json";
import kidsSignupMain from "@contract/cli-current/kids-signup.main.json";
import nightPushFixed from "@contract/cli-current/night-push.fixed.json";
import nightPushMain from "@contract/cli-current/night-push.main.json";
import plainMain from "@contract/cli-current/plain.main.json";
import draftKidsSignupFixed from "@contract/samples-v1-draft/kids-signup.fixed.json";
import draftKidsSignupMain from "@contract/samples-v1-draft/kids-signup.main.json";
import draftPlainMain from "@contract/samples-v1-draft/plain.main.json";

export interface Sample {
  id: string;
  label: string;
  /** 무엇을 보여 주는 표본인지 한 줄. */
  note: string;
  origin: "CLI 실제 출력" | "v1 초안 예시";
  data: unknown;
}

/**
 * 합성 데모 코드(contract/fixtures)의 결과. 모두 합성 예시이고 실제 서비스의 결과가 아니다.
 * "CLI 실제 출력"은 `npm run capture` 로 수집한 것, "v1 초안 예시"는 거기에 손으로 필드를 덧붙인 것이다.
 */
export const SAMPLES: Sample[] = [
  {
    id: "kids-signup.main",
    label: "아동 가입 · 고치기 전",
    note: "연령 분기가 없는 가입 코드. 정적 대안이 모두 거짓이고 AI 질문은 답이 없습니다.",
    origin: "CLI 실제 출력",
    data: kidsSignupMain,
  },
  {
    id: "kids-signup.fixed",
    label: "아동 가입 · 고친 뒤",
    note: "14세 미만 분기를 넣은 코드. 발견이 사라집니다.",
    origin: "CLI 실제 출력",
    data: kidsSignupFixed,
  },
  {
    id: "night-push.main",
    label: "광고 푸시 · 고치기 전",
    note: "광고 표기와 수신거부 안내가 없는 앱 푸시.",
    origin: "CLI 실제 출력",
    data: nightPushMain,
  },
  {
    id: "night-push.fixed",
    label: "광고 푸시 · 고친 뒤",
    note: "표기와 야간 동의 확인을 넣었지만 판정자 없이는 풀리지 않는 사례.",
    origin: "CLI 실제 출력",
    data: nightPushFixed,
  },
  {
    id: "genai-chat.main",
    label: "생성형 AI 채팅 · 고치기 전",
    note: "AI 결과물 표시와 사전 고지가 없는 채팅 화면.",
    origin: "CLI 실제 출력",
    data: genaiChatMain,
  },
  {
    id: "genai-chat.fixed",
    label: "생성형 AI 채팅 · 고친 뒤",
    note: "표시와 고지 문구를 넣었지만 약한 근거라 판정자 없이는 풀리지 않는 사례.",
    origin: "CLI 실제 출력",
    data: genaiChatFixed,
  },
  {
    id: "plain.main",
    label: "정책 신호가 없는 코드",
    note: "어느 정책도 닿지 않는 유틸리티 함수. 빈 결과 화면을 봅니다.",
    origin: "CLI 실제 출력",
    data: plainMain,
  },
  {
    id: "draft.kids-signup.main",
    label: "아동 가입 · 고치기 전 (v1 초안)",
    note: "정책별 요약이 있으면 나머지 정책이 '적용 신호 없음'으로 보입니다.",
    origin: "v1 초안 예시",
    data: draftKidsSignupMain,
  },
  {
    id: "draft.kids-signup.fixed",
    label: "아동 가입 · 고친 뒤 (v1 초안)",
    note: "충족 근거 위치가 있으면 '충족 근거 발견'으로 보입니다.",
    origin: "v1 초안 예시",
    data: draftKidsSignupFixed,
  },
  {
    id: "draft.plain.main",
    label: "정책 신호가 없는 코드 (v1 초안)",
    note: "모든 정책이 '적용 신호 없음'으로 보입니다.",
    origin: "v1 초안 예시",
    data: draftPlainMain,
  },
];

export function findSample(id: string): Sample | undefined {
  return SAMPLES.find((s) => s.id === id);
}
