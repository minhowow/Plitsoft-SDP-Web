"use client";

import { Component, type ReactNode } from "react";

/**
 * 결과 화면만 감싸는 오류 경계. 예상하지 못한 모양의 파일로 그리다 실패해도
 * 파일 고르기와 머리·바닥글은 남는다. 파일을 새로 열 때마다 key 를 바꿔 다시 만든다.
 */
export class ResultBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="notice notice-warn" role="alert">
          <p>이 결과를 그리지 못했습니다. 파일 모양이 이 뷰어가 아는 것과 다릅니다. 다른 파일을 열어 보세요.</p>
        </div>
      );
    }
    return this.props.children;
  }
}
