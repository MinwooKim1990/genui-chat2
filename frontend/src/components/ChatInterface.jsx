import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useChat } from '../context/ChatContext';
import MessageList from './MessageList';
import SandboxPreview from './SandboxPreview';
import ExecutionLog from './ExecutionLog';
import ModelSelector from './ModelSelector';

export default function ChatInterface() {
  const [input, setInput] = useState('');
  const [leftWidth, setLeftWidth] = useState(40); // percentage
  const [pendingFiles, setPendingFiles] = useState([]);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const containerRef = useRef(null);
  const isDragging = useRef(false);
  const { sendMessage, isLoading, resetChat, messages } = useChat();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isLoading) return;
    if (!input.trim() && pendingFiles.length === 0) return;

    const message = input.trim() || 'Please analyze the attached file(s).';
    setInput('');
    const filesToSend = pendingFiles;
    setPendingFiles([]);
    await sendMessage(message, filesToSend);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setPendingFiles((prev) => [...prev, ...files]);
    e.target.value = '';
  };

  const handleRemoveFile = (index) => {
    setPendingFiles((prev) => prev.filter((_, idx) => idx !== index));
  };

  // Resize handlers
  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (!isDragging.current || !containerRef.current) return;

    const container = containerRef.current;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = (x / rect.width) * 100;

    // Clamp between 20% and 80%
    const clampedPercentage = Math.min(Math.max(percentage, 20), 80);
    setLeftWidth(clampedPercentage);
  }, []);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="chat-interface">
      {/* Header */}
      <header className="chat-header glass">
        <h1>GenUI Chat</h1>
        <div className="header-actions">
          <ModelSelector />
          {messages.length > 0 && (
            <button className="btn btn-secondary" onClick={resetChat}>
              New Chat
            </button>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <div className="main-content" ref={containerRef}>
        {/* Chat Panel */}
        <div className="chat-panel glass" style={{ width: `${leftWidth}%` }}>
          <MessageList />
        </div>

        {/* Resize Handle */}
        <div
          className="resize-handle"
          onMouseDown={handleMouseDown}
        >
          <div className="resize-handle-bar" />
        </div>

        {/* Sandbox Panel */}
        <div className="sandbox-panel glass" style={{ width: `${100 - leftWidth}%` }}>
          <SandboxPreview />
          <ExecutionLog />
        </div>
      </div>

      {/* Input Area */}
      <form className="input-area glass" onSubmit={handleSubmit}>
        <div className="input-wrapper">
          <button
            type="button"
            className="btn btn-secondary btn-icon"
            onClick={() => fileInputRef.current?.click()}
            title="Attach files"
            disabled={isLoading}
          >
            <AttachIcon />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
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
            disabled={isLoading || (!input.trim() && pendingFiles.length === 0)}
            title="Send message"
          >
            <SendIcon />
          </button>
        </div>
        {pendingFiles.length > 0 && (
          <div className="attachments-preview">
            {pendingFiles.map((file, index) => (
              <div key={`${file.name}-${index}`} className="attachment-chip">
                <span className="attachment-name">{file.name}</span>
                <button
                  type="button"
                  className="attachment-remove"
                  onClick={() => handleRemoveFile(index)}
                  title="Remove file"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
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

function AttachIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21.44 11.05l-8.49 8.49a5 5 0 0 1-7.07-7.07l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.19 9.19a2 2 0 0 1-2.83-2.83l8.49-8.49" />
    </svg>
  );
}
