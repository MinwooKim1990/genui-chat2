import fetch from 'node-fetch';

// LLM Provider configurations
const PROVIDERS = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-5-mini', 'gpt-5.2'],
    getHeaders: () => ({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
    }),
    // GPT-5 models are reasoning models - different API params
    isReasoningModel: true
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: ['gemini-3-flash-preview', 'gemini-3-pro-preview'],
    getHeaders: () => ({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GEMINI_API_KEY}`
    }),
    isReasoningModel: false
  }
};

// System prompt for code generation
const SYSTEM_PROMPT = `You are an AI assistant that creates interactive React applications that run in a browser sandbox.

CRITICAL OUTPUT FORMAT:
You MUST respond with ONLY valid JSON. No markdown, no code blocks, no explanations outside JSON.

For generating apps, output this EXACT format:
{"type":"sandbox","code":{"App.js":"YOUR_REACT_CODE_HERE","styles.css":"YOUR_CSS_HERE"}}

For text responses only:
{"type":"message","content":"Your message here"}

EXAMPLE - Calculator App:
{"type":"sandbox","code":{"App.js":"import React, { useState } from 'react';\\nimport './styles.css';\\n\\nexport default function App() {\\n  const [display, setDisplay] = useState('0');\\n  const [equation, setEquation] = useState('');\\n\\n  const handleNumber = (num) => {\\n    if (display === '0') setDisplay(num);\\n    else setDisplay(display + num);\\n  };\\n\\n  const handleOperator = (op) => {\\n    setEquation(display + ' ' + op + ' ');\\n    setDisplay('0');\\n  };\\n\\n  const calculate = () => {\\n    try {\\n      const result = eval(equation + display);\\n      setDisplay(String(result));\\n      setEquation('');\\n    } catch { setDisplay('Error'); }\\n  };\\n\\n  const clear = () => { setDisplay('0'); setEquation(''); };\\n\\n  return (\\n    <div className=\\"calculator\\">\\n      <div className=\\"display\\">{equation}{display}</div>\\n      <div className=\\"buttons\\">\\n        {['7','8','9','/','4','5','6','*','1','2','3','-','0','C','=','+'].map(btn => (\\n          <button key={btn} onClick={() => {\\n            if (btn === 'C') clear();\\n            else if (btn === '=') calculate();\\n            else if (['+','-','*','/'].includes(btn)) handleOperator(btn);\\n            else handleNumber(btn);\\n          }} className={['+','-','*','/','='].includes(btn) ? 'operator' : ''}>{btn}</button>\\n        ))}\\n      </div>\\n    </div>\\n  );\\n}","styles.css":".calculator { max-width: 300px; margin: 20px auto; padding: 20px; background: #1a1a2e; border-radius: 16px; }\\n.display { background: #16213e; color: #fff; padding: 20px; font-size: 28px; text-align: right; border-radius: 8px; margin-bottom: 16px; min-height: 60px; word-break: break-all; }\\n.buttons { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }\\nbutton { padding: 20px; font-size: 20px; border: none; border-radius: 8px; cursor: pointer; background: #0f3460; color: white; transition: 0.2s; }\\nbutton:hover { background: #1a4d7c; }\\nbutton.operator { background: #e94560; }\\nbutton.operator:hover { background: #ff6b6b; }"}}

LIBRARIES AVAILABLE:
- react, react-dom (always)
- react-leaflet, leaflet (maps - import 'leaflet/dist/leaflet.css')
- chart.js, react-chartjs-2, recharts (charts)
- date-fns (dates)

RULES:
1. ALWAYS output valid JSON only - NO markdown code blocks
2. Use double backslash for newlines in JSON strings: \\n
3. Escape quotes properly in JSON: \\"
4. For iPhone-style calculator: use grid layout with large touch-friendly buttons
5. For maps: always set explicit container height (400px)
6. For charts: register Chart.js components

DO NOT include any text outside the JSON object.`;

// Parse LLM response to extract structured content
function parseResponse(content) {
  if (!content || typeof content !== 'string') {
    return [{ type: 'message', content: content || '' }];
  }

  let cleaned = content.trim();
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
  cleaned = cleaned.replace(/^```\s*/i, '').replace(/\s*```$/i, '');

  const jsonPatterns = [
    /^\s*(\{[\s\S]*\})\s*$/,
    /^\s*(\[[\s\S]*\])\s*$/,
  ];

  for (const pattern of jsonPatterns) {
    const match = cleaned.match(pattern);
    if (match) {
      try {
        const parsed = JSON.parse(match[1]);
        if (Array.isArray(parsed)) return parsed;
        return [parsed];
      } catch {
        // Continue
      }
    }
  }

  const jsonObjectMatch = cleaned.match(/\{[\s\S]*"type"\s*:\s*"(sandbox|message|thinking)"[\s\S]*\}/);
  if (jsonObjectMatch) {
    try {
      let depth = 0;
      let start = cleaned.indexOf('{');
      let end = start;

      for (let i = start; i < cleaned.length; i++) {
        if (cleaned[i] === '{') depth++;
        else if (cleaned[i] === '}') {
          depth--;
          if (depth === 0) {
            end = i + 1;
            break;
          }
        }
      }

      const jsonStr = cleaned.substring(start, end);
      const parsed = JSON.parse(jsonStr);
      return [parsed];
    } catch {
      // Fall through
    }
  }

  if (cleaned.includes('export default function') || cleaned.includes('function App()')) {
    return [{
      type: 'sandbox',
      code: { 'App.js': cleaned, 'styles.css': '' }
    }];
  }

  return [{ type: 'message', content }];
}

// Call LLM
export async function callLLM({
  messages,
  provider = process.env.DEFAULT_LLM_PROVIDER || 'openai',
  model = process.env.DEFAULT_MODEL || 'gpt-5-mini',
  tools = null,
  stream = false,
  onChunk = null
}) {
  const config = PROVIDERS[provider];
  if (!config) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  const apiKey = provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(`API key not configured for ${provider}`);
  }

  const fullMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...messages
  ];

  // Build request body based on model type
  const body = {
    model,
    messages: fullMessages,
    stream
  };

  // GPT-5 reasoning models: NO temperature, top_p, etc.
  // Use max_completion_tokens instead of max_tokens
  if (config.isReasoningModel) {
    body.max_completion_tokens = 16384;
    // DO NOT set temperature, top_p, etc. for reasoning models
  } else {
    // Gemini and other models support these params
    body.max_tokens = 8192;
    body.temperature = 0.7;
  }

  // JSON response format for OpenAI
  if (provider === 'openai') {
    body.response_format = { type: 'json_object' };
  }

  if (tools) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  console.log(`[LLM] Calling ${provider}/${model}...`);

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: config.getHeaders(),
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[LLM] API Error:`, errorText);
    throw new Error(`LLM API error (${response.status}): ${errorText}`);
  }

  if (stream && onChunk) {
    return handleStream(response, onChunk);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  const toolCalls = data.choices?.[0]?.message?.tool_calls;

  console.log(`[LLM] Response received, length: ${content.length}`);

  return {
    content,
    parsed: parseResponse(content),
    toolCalls,
    usage: data.usage
  };
}

// Handle streaming response
async function handleStream(response, onChunk) {
  const reader = response.body;
  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';

  for await (const chunk of reader) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') {
          onChunk({ done: true, content: fullContent });
          return { content: fullContent, parsed: parseResponse(fullContent) };
        }

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullContent += delta;
            onChunk({ done: false, delta, content: fullContent });
          }
        } catch {
          // Ignore
        }
      }
    }
  }

  return { content: fullContent, parsed: parseResponse(fullContent) };
}

// Generate code with error repair
export async function generateWithRepair({
  messages,
  provider,
  model,
  error = null,
  maxRetries = 3
}) {
  let currentMessages = [...messages];

  if (error) {
    currentMessages.push({
      role: 'user',
      content: `The previous code had an error. Please fix it:\n\nError: ${error}\n\nGenerate corrected code. Output ONLY valid JSON with type "sandbox".`
    });
  }

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const result = await callLLM({ messages: currentMessages, provider, model });
    const sandboxResponse = result.parsed.find(p => p.type === 'sandbox');
    if (sandboxResponse?.code) {
      return result;
    }

    if (attempt < maxRetries - 1) {
      currentMessages.push({ role: 'assistant', content: result.content });
      currentMessages.push({
        role: 'user',
        content: 'Please generate the interactive React code. Output ONLY valid JSON with type "sandbox".'
      });
    }
  }

  throw new Error('Failed to generate valid sandbox code after retries');
}

export { PROVIDERS, parseResponse };
