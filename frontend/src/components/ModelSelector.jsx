import React from 'react';
import { useChat } from '../context/ChatContext';

const PROVIDERS = {
  openai: {
    name: 'OpenAI',
    models: [
      { id: 'gpt-5-mini', name: 'GPT-5 Mini' },
      { id: 'gpt-5.2', name: 'GPT-5.2' }
    ]
  },
  gemini: {
    name: 'Google',
    models: [
      { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash' },
      { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro' }
    ]
  }
};

export default function ModelSelector() {
  const { provider, model, setProvider, setModel } = useChat();

  const handleProviderChange = (e) => {
    const newProvider = e.target.value;
    setProvider(newProvider);
    // Set default model for new provider
    setModel(PROVIDERS[newProvider].models[0].id);
  };

  const handleModelChange = (e) => {
    setModel(e.target.value);
  };

  return (
    <div className="model-selector">
      <select value={provider} onChange={handleProviderChange}>
        {Object.entries(PROVIDERS).map(([key, config]) => (
          <option key={key} value={key}>
            {config.name}
          </option>
        ))}
      </select>
      <select value={model} onChange={handleModelChange}>
        {PROVIDERS[provider].models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </div>
  );
}
