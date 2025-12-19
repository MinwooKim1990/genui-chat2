import React, { createContext, useContext, useReducer, useCallback } from 'react';
import { useSession } from './SessionContext';

const ChatContext = createContext(null);

const initialState = {
  messages: [],
  isLoading: false,
  error: null,
  currentSandbox: null,
  executionLog: [],
  provider: 'gemini',
  model: 'gemini-3-flash-preview'
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

  const uploadFiles = useCallback(async (files) => {
    if (!files || files.length === 0) return [];

    const formData = new FormData();
    files.forEach((file) => formData.append('files', file));

    const response = await fetch(`/api/files/upload?provider=${state.provider}`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status}`);
    }

    const data = await response.json();
    return data.files || [];
  }, [state.provider]);

  const sendMessage = useCallback(async (content, files = []) => {
    const userMessage = { role: 'user', content, timestamp: Date.now() };
    dispatch({ type: 'ADD_MESSAGE', payload: userMessage });
    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'CLEAR_LOG' });
    dispatch({ type: 'SET_ERROR', payload: null });

    addLog('info', 'Sending message to AI...');

    try {
      let attachments = [];
      if (files.length > 0) {
        addLog('info', `Uploading ${files.length} file(s)...`);
        attachments = await uploadFiles(files);
        const failed = attachments.filter(item => item.error);
        if (failed.length > 0) {
          addLog('warning', `${failed.length} file(s) uploaded with warnings`);
        }
      }

      const userMessageWithFiles = { ...userMessage, attachments };
      dispatch({ type: 'UPDATE_LAST_MESSAGE', payload: { attachments } });

      const payload = {
        messages: [...state.messages, userMessageWithFiles].map(m => ({
          role: m.role,
          content: m.content,
          attachments: m.attachments
        })),
        provider: state.provider,
        model: state.model
      };

      const readErrorMessage = async (response) => {
        let errorMessage = `Server error: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData?.error || errorData?.message || errorMessage;
        } catch {
          try {
            const text = await response.text();
            if (text) errorMessage = text;
          } catch {
            // keep default
          }
        }
        return errorMessage;
      };

      const parseSseEvent = (rawEvent) => {
        if (!rawEvent) return null;
        const lines = rawEvent.split('\n');
        let event = 'message';
        const dataLines = [];
        for (const line of lines) {
          if (line.startsWith('event:')) {
            event = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart());
          }
        }
        if (dataLines.length === 0) return null;
        const dataText = dataLines.join('\n');
        let data = dataText;
        try {
          data = JSON.parse(dataText);
        } catch {
          // keep as string
        }
        return { event, data };
      };

      const fetchChatJson = async () => {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          throw new Error(await readErrorMessage(response));
        }

        return response.json();
      };

      const fetchChatStream = async () => {
        const response = await fetch('/api/chat/stream', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream'
          },
          body: JSON.stringify(payload)
        });

        if (response.status === 404) {
          const err = new Error('SSE_UNSUPPORTED');
          err.code = 'SSE_UNSUPPORTED';
          throw err;
        }

        if (!response.ok) {
          throw new Error(await readErrorMessage(response));
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('text/event-stream')) {
          try {
            return await response.json();
          } catch {
            const err = new Error('SSE_UNSUPPORTED');
            err.code = 'SSE_UNSUPPORTED';
            throw err;
          }
        }

        if (!response.body) {
          const err = new Error('SSE_UNSUPPORTED');
          err.code = 'SSE_UNSUPPORTED';
          throw err;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let resultData = null;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let separatorIndex = buffer.indexOf('\n\n');
          while (separatorIndex !== -1) {
            const rawEvent = buffer.slice(0, separatorIndex);
            buffer = buffer.slice(separatorIndex + 2);
            const parsedEvent = parseSseEvent(rawEvent);
            if (parsedEvent) {
              if (parsedEvent.event === 'result') {
                resultData = parsedEvent.data;
              } else if (parsedEvent.event === 'error') {
                const message = parsedEvent.data?.error || parsedEvent.data?.message || 'Server error';
                throw new Error(message);
              } else if (parsedEvent.event === 'status') {
                if (parsedEvent.data?.message) {
                  addLog('info', parsedEvent.data.message);
                }
              }
            }
            separatorIndex = buffer.indexOf('\n\n');
          }
        }

        if (!resultData) {
          throw new Error('No response from server');
        }

        return resultData;
      };

      let data;
      try {
        data = await fetchChatStream();
      } catch (error) {
        if (error.code === 'SSE_UNSUPPORTED') {
          data = await fetchChatJson();
        } else {
          throw error;
        }
      }

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
      const updatedMessages = [...state.messages, userMessageWithFiles, assistantMessage];
      saveSession(updatedMessages);

    } catch (error) {
      console.error('Chat error:', error);
      dispatch({ type: 'SET_ERROR', payload: error.message });
      addLog('error', `Error: ${error.message}`);
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [state.messages, state.provider, state.model, addLog, saveSession, uploadFiles]);

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
        let errorMessage = `Repair failed: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData?.error || errorData?.message || errorMessage;
        } catch {
          try {
            const text = await response.text();
            if (text) errorMessage = text;
          } catch {
            // keep default
          }
        }
        throw new Error(errorMessage);
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
        const updatedMessages = state.messages.map((msg, idx) =>
          idx === state.messages.length - 1 ? { ...msg, sandbox: sandboxItem.code } : msg
        );
        saveSession(updatedMessages);
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
