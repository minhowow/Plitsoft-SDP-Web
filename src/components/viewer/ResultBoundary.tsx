"use client";

import { Component, type ReactNode } from "react";

/**
 * 결과 화면만 감싸는 오류 경계. 예상하지 못한 모양의 파일로 그리다 실패해도
 * 파일 고르기와 머리·바닥글은 남는다. 파일을 새로 열 때마다 key 를 바꿔 다시 만든다.
 *
 * `head` 는 실패했을 때 안내 위에 그리는 머리(뷰어의 연 파일 이름). 결과의 틀 안에 있던 머리가 함께 사라지기 때문이다.
 *
 * 실패하면 위에 알린다(`onFailed`). 뷰어는 그것을 받아 "여는 중"을 거두고, "열었습니다"라고 알리지 않는다.
 * 실패했다는 것은 아래의 안내(role="alert")가 화면 낭독기에 스스로 알린다.
 */
export class ResultBoundary extends Component<{ children: ReactNode; onFailed?: () => void; head?: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onFailed?.();
  }

  render() {
    if (this.state.failed) {
      return (
        <>
          {/* 결과의 틀이 그리던 머리(연 파일의 이름)를 대신 그린다. 무엇을 열다 실패했는지 보이게 한다. */}
          {this.props.head}
          <div className="notice notice-warn" role="alert">
            <p>이 결과를 그리지 못했습니다. 파일 모양이 이 뷰어가 아는 것과 다릅니다. 다른 파일을 열어 보세요.</p>
          </div>
        </>
      );
    }
    return this.props.children;
  }
}
