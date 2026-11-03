-- 대기열과 실행 자리(2026-11-03, 오너 제안). docs/architecture.md 의 "대기열과 실행 자리".
-- 요청은 늘 대기열(queued, dispatched_at 이 빔)에 받고, 실행 자리(POOL_SIZE)가 비면 가장 먼저 요청한 것부터 실행기에 보낸다
-- (dispatched_at 에 보낸 때를 적는다). 실행 자리를 쓰는 것: 실행기에 보냈고 아직 시작을 알리지 않은 분석(queued, dispatched_at
-- 있음)과 분석 중(running)인 분석.

ALTER TABLE analyses ADD COLUMN dispatched_at timestamptz;

-- 이 열을 두기 전에는 요청을 받을 때 바로 실행기를 깨웠다. 그때 대기·진행 중이던 분석은 이미 보낸 것이다.
UPDATE analyses SET dispatched_at = requested_at WHERE status IN ('queued', 'running');

-- 대기열: 아직 보내지 않은 분석을 요청한 차례로.
CREATE INDEX analyses_waiting ON analyses (requested_at, id) WHERE status = 'queued' AND dispatched_at IS NULL;

-- GitHub 을 부르는 수의 1분 창(서버 인스턴스가 함께 쓴다). 요청한 사람에 관한 것은 담지 않는다: 통 이름(search·core), 창이
-- 시작한 분, 그 창에 쓴 수뿐이다.
CREATE TABLE github_budget (
  bucket       text NOT NULL CHECK (bucket IN ('search', 'core')),
  window_start timestamptz NOT NULL,
  used         integer NOT NULL CHECK (used >= 0),
  PRIMARY KEY (bucket, window_start)
);
