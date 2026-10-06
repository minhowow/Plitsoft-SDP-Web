/**
 * 이름과 고정 문구를 한곳에 둔다. CLI 이름(policypack)은 가칭이라 바뀔 수 있다.
 * 화면 어디서도 이름을 직접 적지 말고 여기서 가져다 쓴다.
 */
export const SITE = {
  name: "policypack 웹",
  cli: "policypack",
  tagline: "JS/TS 코드에서 국내 법·정책상 검토가 필요한 지점을 조문과 함께 보여 줍니다.",
  /** 모든 화면에 붙는 면책. docs/commitments.md 의 표기 약속. */
  disclaimer:
    "법률 자문이 아닙니다. 검토가 필요한 지점을 알려 줄 뿐이고, 조문 해석과 최종 판단은 사람이 합니다.",
  /** 발견이 없을 때 반드시 함께 보여 주는 문구. */
  zeroIsNotClearance: "검토 필요 신호가 0이어도 법적 문제가 없다는 뜻은 아닙니다.",
} as const;
