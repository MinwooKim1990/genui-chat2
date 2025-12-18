import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

const SessionContext = createContext(null);

const STORAGE_KEY = 'genui-chat-session';

export function SessionProvider({ children }) {
  const [showModal, setShowModal] = useState(false);
  const [hasSavedSession, setHasSavedSession] = useState(false);
  const [sessionData, setSessionData] = useState(null);

  // Check for saved session on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.messages && parsed.messages.length > 0) {
          setHasSavedSession(true);
          setSessionData(parsed);
          setShowModal(true);
        }
      }
    } catch (error) {
      console.error('Error loading session:', error);
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const saveSession = useCallback((messages) => {
    try {
      const data = {
        messages,
        savedAt: Date.now()
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      setSessionData(data);
      setHasSavedSession(true);
    } catch (error) {
      console.error('Error saving session:', error);
    }
  }, []);

  const clearSession = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      setSessionData(null);
      setHasSavedSession(false);
    } catch (error) {
      console.error('Error clearing session:', error);
    }
  }, []);

  const closeModal = useCallback(() => {
    setShowModal(false);
  }, []);

  const value = {
    showModal,
    hasSavedSession,
    sessionData,
    saveSession,
    clearSession,
    closeModal
  };

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within SessionProvider');
  }
  return context;
}
