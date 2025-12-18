import React, { useState, useEffect } from 'react';
import {
  SandpackProvider,
  SandpackLayout,
  SandpackPreview,
  useSandpack
} from '@codesandbox/sandpack-react';
import { useChat } from '../context/ChatContext';

// Default template when no code is generated
const DEFAULT_FILES = {
  '/App.js': `export default function App() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      fontFamily: 'system-ui, sans-serif',
      color: '#666',
      textAlign: 'center',
      padding: '20px'
    }}>
      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ marginBottom: '16px', opacity: 0.5 }}>
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <path d="M9 9h6v6H9z" />
      </svg>
      <h2 style={{ margin: '0 0 8px', color: '#333' }}>No App Yet</h2>
      <p style={{ margin: 0 }}>Ask me to create something interactive!</p>
    </div>
  );
}`,
  '/styles.css': `* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: system-ui, -apple-system, sans-serif;
  line-height: 1.5;
}`
};

// Dependencies available in sandbox
const SANDBOX_DEPENDENCIES = {
  'react': '^18.2.0',
  'react-dom': '^18.2.0',
  'react-leaflet': '^4.2.1',
  'leaflet': '^1.9.4',
  'chart.js': '^4.4.1',
  'react-chartjs-2': '^5.2.0',
  'recharts': '^2.10.3',
  'date-fns': '^3.0.6'
};

export default function SandboxPreview() {
  const { currentSandbox, addLog, repairError } = useChat();
  const [files, setFiles] = useState(DEFAULT_FILES);
  const [key, setKey] = useState(0);

  useEffect(() => {
    if (currentSandbox) {
      const newFiles = {
        '/styles.css': currentSandbox['styles.css'] || DEFAULT_FILES['/styles.css']
      };

      // Handle App.js
      if (currentSandbox['App.js']) {
        newFiles['/App.js'] = currentSandbox['App.js'];
      } else if (currentSandbox['app.js']) {
        newFiles['/App.js'] = currentSandbox['app.js'];
      } else if (typeof currentSandbox === 'string') {
        newFiles['/App.js'] = currentSandbox;
      }

      setFiles(newFiles);
      setKey(k => k + 1); // Force remount
    }
  }, [currentSandbox]);

  const handleError = (error) => {
    if (error && error.message) {
      addLog('error', `Runtime error: ${error.message}`);
    }
  };

  return (
    <div className="sandbox-container">
      <SandpackProvider
        key={key}
        template="react"
        files={files}
        customSetup={{
          dependencies: SANDBOX_DEPENDENCIES,
          entry: '/index.js'
        }}
        options={{
          externalResources: [
            'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
          ],
          classes: {
            'sp-wrapper': 'sandbox-wrapper',
            'sp-layout': 'sandbox-layout',
            'sp-preview': 'sandbox-preview-frame'
          }
        }}
        theme="dark"
      >
        <SandpackLayout>
          <SandpackPreview
            showOpenInCodeSandbox={false}
            showRefreshButton={true}
          />
        </SandpackLayout>
        <ErrorHandler onError={handleError} onRepair={repairError} />
      </SandpackProvider>
    </div>
  );
}

// Error handler component
function ErrorHandler({ onError, onRepair }) {
  const { sandpack } = useSandpack();
  const [error, setError] = useState(null);

  useEffect(() => {
    // Listen for errors from sandpack
    const errorInfo = sandpack.error;
    if (errorInfo) {
      setError(errorInfo);
      onError?.(errorInfo);
    } else {
      setError(null);
    }
  }, [sandpack.error, onError]);

  if (!error) return null;

  return (
    <div className="error-banner">
      <ErrorIcon className="error-icon" />
      <span className="error-message">{error.message}</span>
      <button
        className="btn btn-repair"
        onClick={() => onRepair?.(error.message)}
      >
        Auto-fix
      </button>
    </div>
  );
}

function ErrorIcon({ className }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}
