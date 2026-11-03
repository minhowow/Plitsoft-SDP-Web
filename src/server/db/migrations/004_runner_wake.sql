-- 실행기를 깨우지 못한 마지막 때(2026-11-03, 검토). docs/architecture.md 의 "대기열과 실행 자리".
-- 깨우기에 실패하면 그 분석을 실패로 적지 않고 대기열에 되돌린 뒤, 여기에 때와 까닭을 적는다. 그 뒤 WAKE_RETRY_MINUTES(2분)
-- 동안은 어느 서버 인스턴스도 깨우지 않는다(실행기 장애가 이어질 때 쪽을 읽을 때마다 대기열의 분석이 하나씩 실패로 적히지
-- 않게). 깨우기에 성공하면 지운다. 행은 하나뿐이다. 요청한 사람에 관한 것은 담지 않는다: 때와 까닭(이 서버가 만든 글)뿐이다.
CREATE TABLE runner_wake (
  id        smallint PRIMARY KEY CHECK (id = 1),
  failed_at timestamptz NOT NULL,
  reason    text NOT NULL
);
