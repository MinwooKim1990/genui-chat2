import React, { useState, useRef, useEffect } from 'react';
import { useChat } from '../context/ChatContext';
import MessageList from './MessageList';
import SandboxPreview from './SandboxPreview';
import ExecutionLog from './ExecutionLog';
import ModelSelector from './ModelSelector';

export default function ChatInterface() {
  const [input, setInput] = useState('');
  const inputRef = useRef(null);
  const { sendMessage, isLoading, resetChat, messages } = useChat();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const message = input.trim();
    setInput('');
    await sendMessage(message);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="chat-interface">
      {/* Header */}
      <header className="chat-header glass">
        <h1>GenUI Chat</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <ModelSelector />
          {messages.length > 0 && (
            <button className="btn btn-secondary" onClick={resetChat}>
              New Chat
            </button>
          )}
        </div>
      </header>

      {/* Chat Panel */}
      <div className="chat-panel glass">
        <MessageList />
      </div>

      {/* Sandbox Panel */}
      <div className="sandbox-panel glass">
        <SandboxPreview />
        <ExecutionLog />
      </div>

      {/* Input Area */}
      <form className="input-area glass" onSubmit={handleSubmit}>
        <div className="input-wrapper">
          <input
            ref={inputRef}
            type="text"
            className="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask me to create an interactive app... (calculator, chart, map, form)"
            disabled={isLoading}
          />
          <button
            type="submit"
            className="btn btn-primary btn-icon"
            disabled={isLoading || !input.trim()}
            title="Send message"
          >
            <SendIcon />
          </button>
        </div>
      </form>
    </div>
  );
}

function SendIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" />
    </svg>
  );
}
