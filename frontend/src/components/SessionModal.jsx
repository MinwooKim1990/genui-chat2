import React from 'react';
import { useSession } from '../context/SessionContext';
import { useChat } from '../context/ChatContext';

export default function SessionModal() {
  const { showModal, sessionData, closeModal, clearSession } = useSession();
  const { loadMessages } = useChat();

  if (!showModal) return null;

  const handleRestore = () => {
    if (sessionData?.messages) {
      loadMessages(sessionData.messages);
    }
    closeModal();
  };

  const handleNew = () => {
    clearSession();
    closeModal();
  };

  const savedAt = sessionData?.savedAt
    ? new Date(sessionData.savedAt).toLocaleString()
    : 'Unknown';

  const messageCount = sessionData?.messages?.length || 0;

  return (
    <div className="modal-overlay" onClick={handleNew}>
      <div className="modal-content glass" onClick={(e) => e.stopPropagation()}>
        <h2>Previous Session Found</h2>
        <p>
          You have a saved session with {messageCount} messages from {savedAt}.
        </p>
        <div className="modal-buttons">
          <button className="btn btn-primary" onClick={handleRestore}>
            Restore Session
          </button>
          <button className="btn btn-secondary" onClick={handleNew}>
            Start New Session
          </button>
        </div>
      </div>
    </div>
  );
}
