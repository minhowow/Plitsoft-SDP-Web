-- 분석 서비스(B2)의 첫 스키마. docs/architecture.md 의 "서버: DB".
-- 저장하는 것: 저장소·커밋·분석 id·진행 단계·시각·도구와 팩의 판·실행기 run·CLI 결과 JSON(docs/commitments.md 의 2).
-- 저장하지 않는 것: 받은 압축 파일, 코드 전체, 요청한 사람의 IP, 사용자 정보(로그인이 없다).

CREATE TABLE analyses (
  id             text PRIMARY KEY CHECK (id ~ '^[23456789abcdefghjkmnpqrstuvwxyz]{10}$'),
  -- GitHub 이 돌려준 그대로의 대소문자.
  owner          text NOT NULL,
  repo           text NOT NULL,
  -- 견줄 때 쓰는 열쇠: 소문자 owner/repo. GitHub 은 이름의 대소문자를 가리지 않는다.
  repo_key       text NOT NULL CHECK (repo_key = lower(owner) || '/' || lower(repo)),
  commit_sha     text NOT NULL CHECK (commit_sha ~ '^[0-9a-f]{40}$'),
  branch         text NOT NULL,
  status         text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  failure_step   text CHECK (failure_step IN ('queued', 'fetch', 'scan', 'finish')),
  failure_reason text,
  requested_at   timestamptz NOT NULL,
  -- 끝난(succeeded·failed) 시각. 같은 커밋의 최근 분석으로 보낼 때 견준다. 화면의 끝난 시각은 단계(steps)에서 읽는다.
  finished_at    timestamptz,
  -- 단계마다 [{"name","startedAt","endedAt"}]. STEP_ORDER 의 차례로 모두 있다.
  steps          jsonb NOT NULL,
  tool_version   text,
  pack_digest    text,
  runner_run_id  text,
  runner_run_url text,
  CHECK ((status = 'failed') = (failure_step IS NOT NULL AND failure_reason IS NOT NULL))
);

CREATE INDEX analyses_by_repo ON analyses (repo_key, requested_at DESC);
CREATE INDEX analyses_by_time ON analyses (requested_at DESC);

-- 같은 저장소·같은 커밋에 대기·진행 중인 분석은 하나뿐이다. 같은 요청이 동시에 두 번 와도 둘째는 이 제약에 걸린다.
CREATE UNIQUE INDEX analyses_one_moving ON analyses (repo_key, commit_sha) WHERE status IN ('queued', 'running');

-- CLI 가 낸 결과를 받은 그대로(글자 그대로) 둔다. 읽히지 않는 결과도 그대로 두고, 분석 행에 실패 까닭을 적는다.
CREATE TABLE results (
  analysis_id text PRIMARY KEY REFERENCES analyses (id) ON DELETE CASCADE,
  json        text NOT NULL
);
