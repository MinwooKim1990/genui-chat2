import React from 'react';
import { ChatProvider } from './context/ChatContext';
import { SessionProvider } from './context/SessionContext';
import ChatInterface from './components/ChatInterface';
import SessionModal from './components/SessionModal';

export default function App() {
  return (
    <SessionProvider>
      <ChatProvider>
        <div className="app">
          <SessionModal />
          <ChatInterface />
        </div>
      </ChatProvider>
    </SessionProvider>
  );
}
