// 부품 시험(vitest)에서 `import "server-only"` 를 받는 빈 모듈. Next 는 이 이름을 스스로 처리해(브라우저 묶음에 들면 빌드가
// 멈춘다) 패키지를 따로 깔지 않았다. 시험은 node 에서만 도므로 비워 둔다.
export {};
