import fetch, { AbortError } from 'node-fetch';

// Helper: fetch with timeout
async function fetchWithTimeout(url, options, timeoutMs = 60000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

// Helper: retry fetch
async function fetchWithRetry(url, options, { maxRetries = 2, timeoutMs = 60000 } = {}) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`[Fetch] Retry attempt ${attempt}/${maxRetries}`);
        await new Promise(r => setTimeout(r, 1000 * attempt)); // exponential backoff
      }
      return await fetchWithTimeout(url, options, timeoutMs);
    } catch (error) {
      lastError = error;
      console.error(`[Fetch] Attempt ${attempt} failed:`, error.message);

      // Don't retry on abort/timeout
      if (error.name === 'AbortError') {
        throw new Error(`Request timed out after ${timeoutMs}ms`);
      }
    }
  }

  throw lastError;
}

// LLM Provider configurations
const PROVIDERS = {
  openai: {
    models: ['gpt-5-mini', 'gpt-5.2'],
    supportsWebSearch: true
  },
  gemini: {
    models: ['gemini-3-flash-preview', 'gemini-3-pro-preview'],
    supportsWebSearch: true
  }
};

// System prompt - ALWAYS generate interactive apps
const SYSTEM_PROMPT = `You are GenUI - an AI that ALWAYS creates interactive React applications. You are NOT a chatbot.

CRITICAL: You MUST ALWAYS respond with a React application, NEVER plain text.
Even for questions, news, weather, etc. - CREATE AN APP that displays the information visually.

OUTPUT FORMAT (MANDATORY):
\`\`\`json
{"type":"sandbox","code":{"App.js":"YOUR_REACT_CODE","styles.css":"YOUR_CSS"},"sources":[{"title":"...","url":"...","image":"..."}]}
\`\`\`

RULES:
1. ALWAYS create an interactive React app - NEVER just text
2. For news/information: Create a beautiful card-based UI displaying the content
3. Use web search results to get REAL data including REAL image URLs
4. If web search provides image URLs, USE THEM in your app
5. If no real images available, use https://picsum.photos/seed/KEYWORD/WIDTH/HEIGHT
6. App must fill container: min-height: 100vh; width: 100%;
7. Use dark theme: backgrounds #1a1a2e, #0f0f23, #16213e
8. Make cards with glassmorphism effect

ALLOWED LIBRARIES (ONLY USE THESE):
- react, react-dom (built-in)
- recharts (for charts: LineChart, BarChart, AreaChart, PieChart, etc.)
- date-fns (for date formatting)
- react-leaflet, leaflet (for maps)
- chart.js, react-chartjs-2 (alternative charts)

DO NOT USE: lucide-react, @heroicons, framer-motion, tailwindcss, or any other libraries not listed above.

STYLING (inline styles or styles.css):
- Root: min-height: 100vh; width: 100%; padding: 20px; background: linear-gradient(135deg, #0f0f23, #1a1a2e);
- Cards: background: rgba(255,255,255,0.05); backdrop-filter: blur(10px); border-radius: 16px; border: 1px solid rgba(255,255,255,0.1);
- Images: width: 100%; border-radius: 12px; object-fit: cover;
- Icons: Use SVG inline or emoji, NOT icon libraries.

IMPORTANT: Include "sources" array in your response with title, url, and image for each source used.

JSON ESCAPING (CRITICAL):
- Wrap your JSON response in \`\`\`json code blocks
- Newlines in code: Use \\n
- Quotes in code: Use \\"
- Backslash in code: Use \\\\`;

// Parse LLM response
function parseResponse(content) {
  if (!content || typeof content !== 'string') {
    return [{ type: 'message', content: content || '' }];
  }

  let cleaned = content.trim();

  // Remove markdown code blocks (handle multiple variations)
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
  cleaned = cleaned.replace(/^```\s*/i, '').replace(/\s*```$/i, '');

  // Also handle case where ``` is in the middle
  const jsonMatch = cleaned.match(/```json\s*([\s\S]*?)\s*```/i);
  if (jsonMatch) {
    cleaned = jsonMatch[1].trim();
  }

  // Check if it looks like JSON (starts with { or [)
  const trimmedCleaned = cleaned.trim();
  const looksLikeJson = trimmedCleaned.startsWith('{') || trimmedCleaned.startsWith('[');

  // Try to parse as JSON first
  if (looksLikeJson) {
    try {
      // Find JSON object boundaries
      const startIdx = cleaned.indexOf('{');
      const endIdx = cleaned.lastIndexOf('}');
      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        const jsonStr = cleaned.substring(startIdx, endIdx + 1);
        const parsed = JSON.parse(jsonStr);

        // Valid sandbox response
        if (parsed.type === 'sandbox' && parsed.code) {
          console.log('[Parse] Successfully parsed sandbox JSON');
          return [parsed];
        }

        // Other valid JSON with type
        if (parsed.type) {
          return [parsed];
        }
      }
    } catch (e) {
      console.error('[Parse] JSON parse error:', e.message);

      // Try to extract code from malformed JSON
      const codeMatch = cleaned.match(/"App\.js"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      const cssMatch = cleaned.match(/"styles\.css"\s*:\s*"((?:[^"\\]|\\.)*)"/);

      if (codeMatch) {
        console.log('[Parse] Extracted code from malformed JSON');
        try {
          // Unescape the code string
          const appCode = JSON.parse('"' + codeMatch[1] + '"');
          const cssCode = cssMatch ? JSON.parse('"' + cssMatch[1] + '"') : '';
          return [{
            type: 'sandbox',
            code: { 'App.js': appCode, 'styles.css': cssCode }
          }];
        } catch (e2) {
          console.error('[Parse] Failed to unescape code:', e2.message);
        }
      }

      // If it looks like JSON but failed to parse, return as message (don't treat as React code)
      return [{ type: 'message', content: 'Failed to parse app response. Please try again.' }];
    }
  }

  // Only check for React code if it doesn't look like JSON
  if (!looksLikeJson && (cleaned.includes('export default function') || cleaned.includes('function App()'))) {
    console.log('[Parse] Detected raw React code');
    return [{
      type: 'sandbox',
      code: { 'App.js': cleaned, 'styles.css': '' }
    }];
  }

  return [{ type: 'message', content }];
}

// Extract sources and images from OpenAI web search response
function extractOpenAISources(output) {
  const sources = [];

  if (!output || !Array.isArray(output)) return sources;

  for (const item of output) {
    if (item.type === 'message' && item.content) {
      for (const content of item.content) {
        if (content.annotations) {
          for (const annotation of content.annotations) {
            if (annotation.type === 'url_citation') {
              sources.push({
                title: annotation.title || '',
                url: annotation.url || '',
                image: null
              });
            }
          }
        }
      }
    }
  }

  return sources;
}

// Extract sources from Gemini grounding metadata
function extractGeminiSources(groundingMetadata) {
  const sources = [];

  if (!groundingMetadata?.groundingChunks) return sources;

  for (const chunk of groundingMetadata.groundingChunks) {
    if (chunk.web) {
      sources.push({
        title: chunk.web.title || '',
        url: chunk.web.uri || '',
        image: null
      });
    }
  }

  return sources;
}

// Call OpenAI with Responses API (supports web search)
async function callOpenAI({ messages, model, enableWebSearch = true }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  // Build input from messages
  const lastUserMessage = messages.filter(m => m.role === 'user').pop();
  const conversationContext = messages.map(m => `${m.role}: ${m.content}`).join('\n');

  const input = `${SYSTEM_PROMPT}\n\nConversation:\n${conversationContext}\n\nCreate an interactive React app based on the user's request. If information lookup is needed, search the web first.`;

  const body = {
    model,
    input,
    tools: enableWebSearch ? [{ type: 'web_search' }] : [],
    tool_choice: enableWebSearch ? 'auto' : undefined
  };

  console.log(`[OpenAI] Calling Responses API with model ${model}, web_search: ${enableWebSearch}`);

  const response = await fetchWithRetry('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  }, { maxRetries: 2, timeoutMs: 90000 });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[OpenAI] API Error:', errorText);
    throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  // Extract text content
  let content = data.output_text || '';

  // If output is array (multiple items), find the message
  if (data.output && Array.isArray(data.output)) {
    for (const item of data.output) {
      if (item.type === 'message' && item.content) {
        for (const c of item.content) {
          if (c.type === 'output_text' || c.text) {
            content = c.text || c.output_text || content;
          }
        }
      }
    }
  }

  const sources = extractOpenAISources(data.output);

  console.log(`[OpenAI] Response received, sources: ${sources.length}`);

  return {
    content,
    parsed: parseResponse(content),
    sources,
    usage: data.usage
  };
}

// Call Gemini with native API (supports google_search)
async function callGemini({ messages, model, enableWebSearch = true }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  // Build contents from messages
  const contents = [];

  // Add conversation messages
  for (const msg of messages) {
    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    });
  }

  const body = {
    contents,
    // Gemini 3 uses system_instruction separately
    system_instruction: {
      parts: [{ text: SYSTEM_PROMPT }]
    },
    generationConfig: {
      // Gemini 3 recommends keeping temperature at 1.0
      temperature: 1.0,
      maxOutputTokens: 8192
    }
  };

  // Add google_search tool for grounding
  if (enableWebSearch) {
    body.tools = [{
      google_search: {}
    }];
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  console.log(`[Gemini] Calling native API with model ${model}, google_search: ${enableWebSearch}`);
  console.log(`[Gemini] Request body:`, JSON.stringify(body, null, 2).slice(0, 500));

  let response;
  try {
    response = await fetchWithRetry(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }, { maxRetries: 2, timeoutMs: 90000 });
  } catch (fetchError) {
    console.error('[Gemini] Fetch error:', fetchError.message);
    throw new Error(`Gemini connection failed: ${fetchError.message}`);
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Gemini] API Error:', response.status, errorText);
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  // Extract content
  let content = '';
  const candidate = data.candidates?.[0];

  if (candidate?.content?.parts) {
    for (const part of candidate.content.parts) {
      if (part.text) {
        content += part.text;
      }
    }
  }

  const sources = extractGeminiSources(candidate?.groundingMetadata);

  console.log(`[Gemini] Response received, sources: ${sources.length}`);

  return {
    content,
    parsed: parseResponse(content),
    sources,
    groundingMetadata: candidate?.groundingMetadata,
    usage: data.usageMetadata
  };
}

// Main LLM call function
export async function callLLM({
  messages,
  provider = process.env.DEFAULT_LLM_PROVIDER || 'openai',
  model,
  enableWebSearch = true,
  stream = false,
  onChunk = null
}) {
  const config = PROVIDERS[provider];
  if (!config) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  // Default models
  if (!model) {
    model = provider === 'openai' ? 'gpt-5-mini' : 'gemini-3-flash-preview';
  }

  console.log(`[LLM] Provider: ${provider}, Model: ${model}, WebSearch: ${enableWebSearch}`);

  if (provider === 'openai') {
    return callOpenAI({ messages, model, enableWebSearch });
  } else if (provider === 'gemini') {
    return callGemini({ messages, model, enableWebSearch });
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

// Generate with retry/repair
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
        content: 'You MUST create an interactive React app. Output ONLY valid JSON with type "sandbox" containing App.js and styles.css. Never respond with plain text.'
      });
    }
  }

  throw new Error('Failed to generate valid sandbox code after retries');
}

export { PROVIDERS, parseResponse };
