import React, { createContext, useContext, useReducer, useCallback } from 'react';
import { useSession } from './SessionContext';

const ChatContext = createContext(null);

const initialState = {
  messages: [],
  isLoading: false,
  error: null,
  currentSandbox: null,
  executionLog: [],
  provider: 'openai',
  model: 'gpt-5-mini'
};

function chatReducer(state, action) {
  switch (action.type) {
    case 'SET_MESSAGES':
      return { ...state, messages: action.payload };
    case 'ADD_MESSAGE':
      return { ...state, messages: [...state.messages, action.payload] };
    case 'UPDATE_LAST_MESSAGE':
      return {
        ...state,
        messages: state.messages.map((msg, idx) =>
          idx === state.messages.length - 1 ? { ...msg, ...action.payload } : msg
        )
      };
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'SET_SANDBOX':
      return { ...state, currentSandbox: action.payload };
    case 'ADD_LOG':
      return {
        ...state,
        executionLog: [...state.executionLog, { ...action.payload, timestamp: Date.now() }]
      };
    case 'CLEAR_LOG':
      return { ...state, executionLog: [] };
    case 'SET_PROVIDER':
      return { ...state, provider: action.payload };
    case 'SET_MODEL':
      return { ...state, model: action.payload };
    case 'RESET':
      return { ...initialState, provider: state.provider, model: state.model };
    default:
      return state;
  }
}

export function ChatProvider({ children }) {
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const { saveSession } = useSession();

  const addLog = useCallback((type, message) => {
    dispatch({ type: 'ADD_LOG', payload: { type, message } });
  }, []);

  const sendMessage = useCallback(async (content) => {
    const userMessage = { role: 'user', content, timestamp: Date.now() };
    dispatch({ type: 'ADD_MESSAGE', payload: userMessage });
    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'CLEAR_LOG' });
    dispatch({ type: 'SET_ERROR', payload: null });

    addLog('info', 'Sending message to AI...');

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...state.messages, userMessage].map(m => ({
            role: m.role,
            content: m.content
          })),
          provider: state.provider,
          model: state.model
        })
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const data = await response.json();

      // Process web search sources
      if (data.sources && data.sources.length > 0) {
        addLog('tool', `Web search: Found ${data.sources.length} sources`);
      }

      // Process tool usage
      if (data.toolsUsed) {
        data.toolsUsed.forEach(tool => {
          addLog('tool', `Used tool: ${tool.name}`);
        });
      }

      // Process parsed responses
      const parsed = data.parsed || [];
      let assistantContent = '';
      let sandboxCode = null;
      let sources = data.sources || [];

      for (const item of parsed) {
        if (item.type === 'thinking') {
          addLog('thinking', item.content?.substring(0, 100) + '...');
        } else if (item.type === 'sandbox') {
          addLog('sandbox', 'Building interactive app...');
          sandboxCode = item.code;
          // Check for sources in sandbox item
          if (item.sources) {
            sources = item.sources;
          }
        } else if (item.type === 'message') {
          assistantContent = item.content || '';
        }
      }

      // If sandbox code was generated, show a confirmation message
      if (sandboxCode) {
        assistantContent = assistantContent || 'Interactive app generated! You can interact with it on the right panel.';
      }

      // If still no content, check if it was a raw response
      if (!assistantContent && !sandboxCode && data.content) {
        // Check if raw content is JSON-like
        const rawContent = data.content.trim();
        if (rawContent.startsWith('{') || rawContent.startsWith('[')) {
          // It's JSON that wasn't parsed properly, try to extract useful info
          try {
            const jsonData = JSON.parse(rawContent);
            if (jsonData.type === 'sandbox' && jsonData.code) {
              sandboxCode = jsonData.code;
              assistantContent = 'Interactive app generated!';
            } else if (jsonData.type === 'message') {
              assistantContent = jsonData.content || '';
            } else if (jsonData.content) {
              assistantContent = jsonData.content;
            }
          } catch {
            // Not valid JSON, show as is but truncated
            assistantContent = 'App generation in progress...';
          }
        } else {
          assistantContent = rawContent;
        }
      }

      const assistantMessage = {
        role: 'assistant',
        content: assistantContent,
        sandbox: sandboxCode,
        timestamp: Date.now()
      };

      dispatch({ type: 'ADD_MESSAGE', payload: assistantMessage });

      if (sandboxCode) {
        dispatch({ type: 'SET_SANDBOX', payload: sandboxCode });
        addLog('success', 'App ready!');
      }

      // Save session
      const updatedMessages = [...state.messages, userMessage, assistantMessage];
      saveSession(updatedMessages);

    } catch (error) {
      console.error('Chat error:', error);
      dispatch({ type: 'SET_ERROR', payload: error.message });
      addLog('error', `Error: ${error.message}`);
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [state.messages, state.provider, state.model, addLog, saveSession]);

  const repairError = useCallback(async (errorMessage) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    addLog('repair', 'Attempting to fix error...');

    try {
      const response = await fetch('/api/chat/repair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: state.messages.map(m => ({ role: m.role, content: m.content })),
          error: errorMessage,
          provider: state.provider,
          model: state.model
        })
      });

      if (!response.ok) {
        throw new Error(`Repair failed: ${response.status}`);
      }

      const data = await response.json();
      const parsed = data.parsed || [];
      const sandboxItem = parsed.find(p => p.type === 'sandbox');

      if (sandboxItem?.code) {
        dispatch({ type: 'SET_SANDBOX', payload: sandboxItem.code });
        dispatch({
          type: 'UPDATE_LAST_MESSAGE',
          payload: { sandbox: sandboxItem.code }
        });
        addLog('success', 'Error fixed! App updated.');
        saveSession(state.messages);
      } else {
        throw new Error('No valid fix generated');
      }

    } catch (error) {
      console.error('Repair error:', error);
      addLog('error', `Repair failed: ${error.message}`);
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [state.messages, state.provider, state.model, addLog, saveSession]);

  const resetChat = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);

  const setProvider = useCallback((provider) => {
    dispatch({ type: 'SET_PROVIDER', payload: provider });
  }, []);

  const setModel = useCallback((model) => {
    dispatch({ type: 'SET_MODEL', payload: model });
  }, []);

  const loadMessages = useCallback((messages) => {
    dispatch({ type: 'SET_MESSAGES', payload: messages });
    const lastSandbox = [...messages].reverse().find(m => m.sandbox);
    if (lastSandbox?.sandbox) {
      dispatch({ type: 'SET_SANDBOX', payload: lastSandbox.sandbox });
    }
  }, []);

  const value = {
    ...state,
    sendMessage,
    repairError,
    resetChat,
    setProvider,
    setModel,
    loadMessages,
    addLog
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within ChatProvider');
  }
  return context;
}
