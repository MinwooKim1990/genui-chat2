import React, { useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { useChat } from '../context/ChatContext';

export default function MessageList() {
  const { messages, isLoading } = useChat();
  const containerRef = useRef(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  if (messages.length === 0 && !isLoading) {
    return (
      <div className="messages-container" ref={containerRef}>
        <WelcomeMessage />
      </div>
    );
  }

  return (
    <div className="messages-container" ref={containerRef}>
      {messages.map((message, index) => (
        <Message key={index} message={message} />
      ))}
      {isLoading && <LoadingIndicator />}
    </div>
  );
}

function Message({ message }) {
  return (
    <div className={`message ${message.role}`}>
      <div className="message-content">
        {message.role === 'assistant' ? (
          <ReactMarkdown
            components={{
              code({ node, inline, className, children, ...props }) {
                return inline ? (
                  <code className={className} {...props}>
                    {children}
                  </code>
                ) : (
                  <pre>
                    <code className={className} {...props}>
                      {children}
                    </code>
                  </pre>
                );
              }
            }}
          >
            {message.content || ''}
          </ReactMarkdown>
        ) : (
          message.content
        )}
      </div>
      {message.sandbox && (
        <div style={{
          marginTop: '0.5rem',
          fontSize: '0.75rem',
          color: 'rgba(255,255,255,0.6)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.25rem'
        }}>
          <SandboxIcon />
          Interactive app generated
        </div>
      )}
    </div>
  );
}

function WelcomeMessage() {
  return (
    <div className="welcome-message">
      <h2>Welcome to GenUI Chat</h2>
      <p>I can create interactive applications for you. Try asking:</p>
      <ul>
        <li>"Create a tip calculator"</li>
        <li>"Show me a bar chart of monthly sales"</li>
        <li>"Build an interactive map of Paris"</li>
        <li>"Make a BMI calculator with inputs"</li>
        <li>"Create a countdown timer"</li>
      </ul>
    </div>
  );
}

function LoadingIndicator() {
  return (
    <div className="loading-indicator">
      <div className="loading-dots">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <span>Generating...</span>
    </div>
  );
}

function SandboxIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <path d="M9 9h6v6H9z" />
    </svg>
  );
}
