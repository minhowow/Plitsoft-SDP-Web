import { useChat } from "@ai-sdk/react";

export function ChatPanel() {
  const { messages, input, handleInputChange, handleSubmit } = useChat({ api: "/api/chat" });
  return (
    <section>
      <p className="notice">이 서비스는 생성형 인공지능을 이용해 답변합니다.</p>
      {messages.map((m) => (
        <p key={m.id} className={m.role}>
          {m.role === "assistant" && <span className="ai-label">AI가 생성한 답변</span>}
          {m.content}
        </p>
      ))}
      <form onSubmit={handleSubmit}>
        <input value={input} onChange={handleInputChange} placeholder="무엇이든 물어보세요" />
      </form>
    </section>
  );
}
