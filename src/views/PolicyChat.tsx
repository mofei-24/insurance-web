import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { PolicyRobot } from "./PolicyRobot";
import "./policyChat.css";

type Source = { title: string; file: string; pages: number[]; excerpt: string };
type Reply = { answer: string; sources: Source[] };
type Turn = { question: string; reply?: Reply; error?: string };

export function PolicyChat() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const lastTrigger = useRef<HTMLButtonElement | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const history = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);
  useEffect(() => {
    if (open && history.current)
      history.current.scrollTop = history.current.scrollHeight;
  }, [open, turns, busy]);

  function close() {
    setOpen(false);
    (lastTrigger.current?.isConnected
      ? lastTrigger.current
      : document.getElementById("policy-robot-restore")
    )?.focus();
  }

  function toggleChat(source: HTMLButtonElement) {
    if (open) {
      close();
      return;
    }
    lastTrigger.current = source;
    setOpen(true);
  }

  async function ask() {
    const question = input.trim();
    if (!question || busy) return;
    const previousQuestion = [...turns]
      .reverse()
      .find((turn) => turn.reply)?.question;
    setInput("");
    setBusy(true);
    setTurns([...turns, { question }]);
    let turn: Turn = { question };
    try {
      const response = await fetch(new URL("api/rag/chat", document.baseURI), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, previousQuestion }),
      });
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("条款问答服务未连接，请通过项目启动脚本打开工作台。");
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "问答请求失败。");
      turn = { question, reply: data };
    } catch (error) {
      turn = {
        question,
        error: error instanceof Error ? error.message : "问答请求失败。",
      };
      setInput((value) => value || question);
    } finally {
      setTurns((items) => [...items.slice(0, -1), turn]);
      setBusy(false);
    }
  }

  return (
    <>
      <section
        id="policy-chat"
        className="policy-chat"
        role="dialog"
        aria-labelledby="policy-chat-title"
        hidden={!open}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") close();
        }}
      >
        <header>
          <h2 id="policy-chat-title">条款问答</h2>
          <button type="button" aria-label="关闭条款问答" onClick={close}>
            <Icon name="close" />
          </button>
        </header>
        <div
          className="policy-chat-history"
          ref={history}
          role="log"
          aria-live="polite"
        >
          {!turns.length && (
            <p>
              请输入产品名称、版本和想了解的条款，例如“安盛天平 2025 版 B
              款的等待期是多久？”
            </p>
          )}
          {turns.map((turn, i) => (
            <div className="policy-chat-turn" key={i}>
              <p className="policy-chat-question">{turn.question}</p>
              {turn.error && (
                <p className="policy-chat-error" role="alert">
                  {turn.error}
                </p>
              )}
              {turn.reply && (
                <>
                  <p className="policy-chat-answer">{turn.reply.answer}</p>
                  <div className="policy-chat-sources">
                    {turn.reply.sources.map((source, index) => (
                      <details key={index}>
                        <summary>
                          [{index + 1}] {source.title}
                        </summary>
                        <small>
                          {source.file}
                          {source.pages.length > 0 &&
                            ` · 来源页 ${source.pages.join("、")}`}
                        </small>
                        <p>{source.excerpt}</p>
                      </details>
                    ))}
                  </div>
                </>
              )}
            </div>
          ))}
          {busy && <p role="status">正在检索条款并生成回答…</p>}
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void ask();
          }}
        >
          <input
            ref={field}
            aria-label="保险条款问题"
            placeholder="输入保险条款问题"
            maxLength={1000}
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          <button
            type="submit"
            className="primary"
            disabled={busy || !input.trim()}
          >
            发送
          </button>
        </form>
        <p className="policy-chat-note">
          问题和匹配的条款片段会发送给模型服务。请勿输入个人信息。
        </p>
      </section>
      <PolicyRobot chatOpen={open} onToggleChat={toggleChat} />
    </>
  );
}
