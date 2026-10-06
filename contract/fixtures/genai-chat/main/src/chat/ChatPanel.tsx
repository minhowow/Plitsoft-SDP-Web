import { useChat } from "@ai-sdk/react";

export function ChatPanel() {
  const { messages, input, handleInputChange, handleSubmit } = useChat({ api: "/api/chat" });
  return (
    <section>
      {messages.map((m) => (
        <p key={m.id} className={m.role}>
          {m.content}
        </p>
      ))}
      <form onSubmit={handleSubmit}>
        <input value={input} onChange={handleInputChange} placeholder="무엇이든 물어보세요" />
      </form>
    </section>
  );
}
