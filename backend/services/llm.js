import fetch from 'node-fetch';
import { fetchUrlMetadata } from '../tools/fetch.js';
import { generateOpenAIImage, generateGeminiImage } from './images.js';
import { saveRemoteImage } from './media.js';

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
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
      return await fetchWithTimeout(url, options, timeoutMs);
    } catch (error) {
      lastError = error;
      console.error(`[Fetch] Attempt ${attempt} failed:`, error.message);

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
    models: ['gpt-5-mini-2025-08-07', 'gpt-5.2-2025-12-11'],
    supportsWebSearch: true
  },
  gemini: {
    models: ['gemini-3-flash-preview', 'gemini-3-pro-preview'],
    supportsWebSearch: true
  }
};

const SYSTEM_PROMPT = `You are GenUI - an AI that ALWAYS creates interactive React applications. You are NOT a chatbot.

CRITICAL: You MUST ALWAYS respond with a React application, NEVER plain text.
Even for questions, news, weather, etc. - CREATE AN APP that displays the information visually.

OUTPUT FORMAT (MANDATORY):
\`\`\`json
{"type":"sandbox","code":{"App.js":"YOUR_REACT_CODE","styles.css":"YOUR_CSS"},"sources":[{"title":"...","url":"...","image":"..."}]}
\`\`\`

RULES:
1. ALWAYS create an interactive React app - NEVER just text
2. Use the user's language for all UI text
3. If sources are provided or web search is used, include a visible Sources section and populate the "sources" array
4. If sources include image URLs (sources[].image) use them in the UI
5. Prefer item.image or sources[].image for primary images; use image_fallback ONLY as onError fallback
6. When you need images for sources, call fetch_url_metadata on relevant URLs to get image URLs
7. Do NOT call generate_image unless the user explicitly asks for new images OR context.generated_images is provided
8. For news/web search requests, never generate images; use source images or fallback placeholders
9. For <img> elements, always set onError to swap to a fallback image URL
10. If attachments include public_url, you may render them with img/video/audio or link in the UI
11. If context.generated_images exists, you MUST use those URLs as primary visuals (do not use random image URLs)
12. Keep output concise: avoid embedding full documents, cap large lists, and keep App.js + styles reasonably small
13. App must fill container: min-height: 100vh; width: 100%;
14. When context JSON is provided, use ONLY the URLs/images from context.plan/items or context.sources; never fabricate links
15. Default to a clean, modern UI. Use dark glassmorphism unless user requests a different style

ALLOWED LIBRARIES (ONLY USE THESE):
- react, react-dom (built-in)
- recharts (for charts: LineChart, BarChart, AreaChart, PieChart, etc.)
- date-fns (for date formatting)
- react-leaflet, leaflet (for maps)
- chart.js, react-chartjs-2 (alternative charts)

DO NOT USE: lucide-react, @heroicons, framer-motion, tailwindcss, or any other libraries not listed above.

STYLING (inline styles or styles.css):
- Root: min-height: 100vh; width: 100%; padding: 20px;
- Cards: background: rgba(255,255,255,0.05); backdrop-filter: blur(10px); border-radius: 16px; border: 1px solid rgba(255,255,255,0.1);
- Images: width: 100%; border-radius: 12px; object-fit: cover;

IMPORTANT: Include "sources" array in your response with title, url, and image for each source used.

JSON ESCAPING (CRITICAL):
- Wrap your JSON response in \`\`\`json code blocks
- Newlines in code: Use \\n
- Quotes in code: Use \\" 
- Backslash in code: Use \\\\`;

const GEMINI_PLAN_PROMPT = `You are GenUI Planner. Use google_search and url_context to gather accurate information when needed.

Return ONLY valid JSON with this shape:
{
  "type": "grounded_plan",
  "language": "<language of the user>",
  "summary": "short overview",
  "content": "detailed notes or markdown",
  "items": [
    {"title":"...","summary":"...","source_title":"...","source_url":"...","image_hint":"..."}
  ],
  "image_requests": [
    {"id":"img1","prompt":"...","aspect_ratio":"16:9","usage":"hero|card|diagram"}
  ],
  "ui_intent": "layout hints for the UI"
}

Rules:
- Output JSON only. No markdown fences, no code.
- If there are sources, include source_title and source_url in items.
- If images are important, include image_requests with clear prompts.
- Keep it concise and parseable.`;

const OPENAI_PLAN_PROMPT = `You are GenUI Planner. Use the web_search tool to gather accurate information when needed.

Return ONLY valid JSON with this shape:
{
  "type": "grounded_plan",
  "language": "<language of the user>",
  "summary": "short overview",
  "content": "detailed notes or markdown",
  "items": [
    {"title":"...","summary":"...","source_title":"...","source_url":"...","image_hint":"..."}
  ],
  "image_requests": [
    {"id":"img1","prompt":"...","aspect_ratio":"16:9","usage":"hero|card|diagram"}
  ],
  "ui_intent": "layout hints for the UI"
}

Rules:
- Output JSON only. No markdown fences, no code.
- If there are sources, include source_title and source_url in items.
- If images are important, include image_requests with clear prompts.
- Keep it concise and parseable.`;

// Parse LLM response
function parseResponse(content) {
  if (!content || typeof content !== 'string') {
    return [{ type: 'message', content: content || '' }];
  }

  let cleaned = content.trim();

  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
  cleaned = cleaned.replace(/^```\s*/i, '').replace(/\s*```$/i, '');

  const jsonMatch = cleaned.match(/```json\s*([\s\S]*?)\s*```/i);
  if (jsonMatch) {
    cleaned = jsonMatch[1].trim();
  }

  const trimmedCleaned = cleaned.trim();
  const looksLikeJson = trimmedCleaned.startsWith('{') || trimmedCleaned.startsWith('[');

  if (looksLikeJson) {
    try {
      const startIdx = cleaned.indexOf('{');
      const endIdx = cleaned.lastIndexOf('}');
      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        const jsonStr = cleaned.substring(startIdx, endIdx + 1);
        const parsed = JSON.parse(jsonStr);

        if (parsed.type === 'sandbox' && parsed.code) {
          console.log('[Parse] Successfully parsed sandbox JSON');
          return [parsed];
        }

        if (parsed.type) {
          return [parsed];
        }
      }
    } catch (e) {
      console.error('[Parse] JSON parse error:', e.message);

      const codeMatch = cleaned.match(/"App\.js"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      const cssMatch = cleaned.match(/"styles\.css"\s*:\s*"((?:[^"\\]|\\.)*)"/);

      if (codeMatch) {
        console.log('[Parse] Extracted code from malformed JSON');
        try {
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

      return [{ type: 'message', content: 'Failed to parse app response. Please try again.' }];
    }
  }

  if (!looksLikeJson && (cleaned.includes('export default function') || cleaned.includes('function App()'))) {
    console.log('[Parse] Detected raw React code');
    return [{
      type: 'sandbox',
      code: { 'App.js': cleaned, 'styles.css': '' }
    }];
  }

  return [{ type: 'message', content }];
}

function parseJsonFromText(text) {
  if (!text || typeof text !== 'string') return null;

  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function buildAttachmentNote(attachments) {
  if (!attachments || attachments.length === 0) return null;

  const lines = attachments.map(att => {
    const note = att.analysisAvailable === false ? ' (analysis unavailable)' : '';
    return `- ${att.name} (${att.mimeType || 'unknown'}) public_url: ${att.publicUrl}${note}`;
  });

  return `Attachment URLs (use in UI rendering if helpful):\n${lines.join('\n')}`;
}

function buildOpenAIInput(messages, { includeAttachments = true } = {}) {
  const input = [];

  for (const message of messages) {
    const isAssistant = message.role === 'assistant';
    const role = isAssistant ? 'assistant' : 'user';
    const textType = isAssistant ? 'output_text' : 'input_text';
    const parts = [];

    if (!isAssistant && includeAttachments && message.attachments?.length) {
      const openaiAttachments = message.attachments.filter(att => !att.provider || att.provider === 'openai');
      for (const att of openaiAttachments) {
        if (att.fileId && att.kind === 'image') {
          parts.push({ type: 'input_image', file_id: att.fileId });
        } else if (att.fileId && att.kind === 'pdf') {
          parts.push({ type: 'input_file', file_id: att.fileId });
        }
      }

      const note = buildAttachmentNote(message.attachments);
      if (note) {
        parts.push({ type: textType, text: note });
      }
    }

    if (message.content) {
      parts.push({ type: textType, text: message.content });
    }

    if (parts.length > 0) {
      input.push({ role, content: parts });
    }
  }

  return input;
}

function buildOpenAIContextMessage(context) {
  if (!context) return null;

  const payload = JSON.stringify(context, null, 2);
  return {
    role: 'user',
    content: [{
      type: 'input_text',
      text: `Use this context JSON to build the GenUI response. The context is authoritative.\n- Use context.plan.items for cards/links.\n- Do NOT invent or alter URLs.\nContext:\n${payload}`
    }]
  };
}

function buildGeminiContents(messages, { includeAttachments = true } = {}) {
  const contents = [];

  for (const message of messages) {
    const role = message.role === 'assistant' ? 'model' : 'user';
    const parts = [];

    if (includeAttachments && message.attachments?.length) {
      const geminiAttachments = message.attachments.filter(att => !att.provider || att.provider === 'gemini');
      for (const att of geminiAttachments) {
        if (att.fileUri) {
          parts.push({
            file_data: {
              mime_type: att.mimeType,
              file_uri: att.fileUri
            }
          });
        }
      }

      const note = buildAttachmentNote(message.attachments);
      if (note) {
        parts.push({ text: note });
      }
    }

    if (message.content) {
      parts.push({ text: message.content });
    }

    if (parts.length > 0) {
      contents.push({ role, parts });
    }
  }

  return contents;
}

function collectAttachmentContext(messages, provider) {
  const attachments = [];

  for (const message of messages) {
    if (!message.attachments?.length) continue;
    for (const att of message.attachments) {
      if (provider && att.provider && att.provider !== provider) continue;
      attachments.push({
        name: att.name,
        mimeType: att.mimeType,
        kind: att.kind,
        publicUrl: att.publicUrl,
        analysisAvailable: att.analysisAvailable !== false
      });
    }
  }

  return attachments;
}

function dedupeSources(sources) {
  const map = new Map();
  for (const source of sources) {
    if (!source.url) continue;
    if (!map.has(source.url)) {
      map.set(source.url, { ...source });
    } else {
      const existing = map.get(source.url);
      map.set(source.url, { ...existing, ...source });
    }
  }
  return Array.from(map.values());
}

function fallbackImageUrl(seed = 'genui') {
  const safeSeed = String(seed).replace(/[^a-z0-9]+/gi, '-').slice(0, 60) || 'genui';
  return `https://picsum.photos/seed/${safeSeed}/800/500`;
}

function getLastUserText(messages) {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg?.role === 'user' && typeof msg.content === 'string' && msg.content.trim()) {
      return msg.content.trim();
    }
  }
  return '';
}

function isNewsRequest(text) {
  if (!text) return false;
  return /뉴스|news|헤드라인|headline|기사|breaking/i.test(text);
}

function hasExplicitImageRequest(text) {
  if (!text) return false;
  return /이미지\s*생성|그림\s*생성|이미지\s*만들|이미지\s*넣|image\s*generation|generate\s*image|create\s*image|insert\s*image/i.test(text);
}

function wantsVisualAid(text) {
  if (!text) return false;
  return /시각화|visualize|visualisation|diagram|flowchart|인포그래픽|infographic|도식|타임라인|timeline|그래프|chart/i.test(text);
}

function getImagePolicy(text) {
  if (!text) return { mode: 'none', max: 0 };
  if (isNewsRequest(text)) return { mode: 'none', max: 0 };
  if (hasExplicitImageRequest(text)) return { mode: 'explicit', max: 3 };
  if (wantsVisualAid(text)) return { mode: 'assist', max: 2 };
  return { mode: 'none', max: 0 };
}

function wantsWebSearchFromText(text) {
  if (!text) return false;
  return /뉴스|news|검색|search|최신|최근|웹|인터넷|기사|링크|sources/i.test(text);
}

function isLikelyLowValueImageUrl(url) {
  if (!url) return true;
  const lower = url.toLowerCase();
  return (
    lower.includes('logo') ||
    lower.includes('favicon') ||
    lower.includes('sprite') ||
    lower.includes('icon') ||
    lower.includes('placeholder') ||
    lower.includes('spacer') ||
    lower.includes('default') ||
    lower.includes('picsum.photos')
  );
}

function buildImagePromptForItem(item, language = 'en') {
  const title = item?.title || item?.source_title || 'news';
  const summary = item?.summary || item?.content || '';
  const hint = item?.image_hint || '';
  const base = `${title}. ${summary}`.trim();
  const prompt = `Create a high-quality, photojournalistic illustration for: ${base}. ${hint}`.trim();
  return language === 'ko' ? `다음 내용을 시각적으로 설명하는 고품질 일러스트: ${base}. ${hint}`.trim() : prompt;
}

function buildImagePromptFromText(text, language = 'en') {
  const trimmed = String(text || '').trim();
  const base = trimmed.length > 400 ? `${trimmed.slice(0, 400)}...` : trimmed;
  if (!base) return language === 'ko' ? '고품질 일러스트를 생성해줘.' : 'Create a high-quality illustration.';
  return language === 'ko'
    ? `다음 내용을 시각적으로 보여주는 고품질 일러스트: ${base}`
    : `Create a high-quality illustration based on: ${base}`;
}

async function generateImageForPrompt({ prompt, provider }) {
  try {
    if (provider === 'openai') {
      return await generateOpenAIImage({ prompt });
    }
    if (provider === 'gemini') {
      return await generateGeminiImage({ prompt, quality: 'fast' });
    }
  } catch (error) {
    console.warn(`[Image] Generation failed (${provider}):`, error.message);
  }
  return null;
}

async function ensurePlanImages({ plan, provider, max = 3, force = false }) {
  if (!plan?.items || !Array.isArray(plan.items)) return plan;

  let generatedCount = 0;
  const updatedItems = [];
  for (const item of plan.items) {
    const updatedItem = { ...item };
    if (generatedCount < max) {
      const needsImage = force || !updatedItem.image || isLikelyLowValueImageUrl(updatedItem.image);
      if (needsImage) {
        const prompt = buildImagePromptForItem(updatedItem, plan.language);
        const generated = await generateImageForPrompt({ prompt, provider });
        if (generated?.url) {
          updatedItem.image = updatedItem.image && !isLikelyLowValueImageUrl(updatedItem.image)
            ? updatedItem.image
            : generated.url;
          updatedItem.image_fallback = generated.url;
          updatedItem.generated_image = generated.url;
          generatedCount += 1;
        }
      }
    }
    updatedItems.push(updatedItem);
  }

  return {
    ...plan,
    items: updatedItems
  };
}
function normalizeForMatch(text = '') {
  return String(text)
    .toLowerCase()
    .replace(/[\u0000-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreTitleMatch(a, b) {
  const left = normalizeForMatch(a);
  const right = normalizeForMatch(b);
  if (!left || !right) return 0;
  if (left === right) return 3;
  if (left.includes(right) || right.includes(left)) return 2;

  const leftTokens = new Set(left.split(' ').filter(Boolean));
  const rightTokens = new Set(right.split(' ').filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let common = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) common += 1;
  }

  if (common === 0) return 0;
  return common / Math.max(leftTokens.size, rightTokens.size);
}

function pickBestSourceForItem(item, sources, usedUrls = new Set()) {
  if (!sources || sources.length === 0) return null;

  if (item?.source_url) {
    const direct = sources.find(source => source.url === item.source_url);
    if (direct) return direct;
  }

  const preferredTitle = item?.source_title || item?.title || '';
  let best = null;
  let bestScore = 0;

  for (const source of sources) {
    if (!source.url) continue;
    if (usedUrls.has(source.url)) continue;

    const score = Math.max(
      scoreTitleMatch(preferredTitle, source.title),
      scoreTitleMatch(item?.title, source.title)
    );

    if (score > bestScore) {
      bestScore = score;
      best = source;
    }
  }

  if (best) return best;

  const fallback = sources.find(source => source.url && !usedUrls.has(source.url));
  return fallback || sources[0];
}

// Extract sources and images from OpenAI web search response
function extractOpenAISources(output) {
  const sources = [];

  if (!output || !Array.isArray(output)) return sources;

  for (const item of output) {
    if (item.type === 'web_search_call' && item.action?.sources) {
      for (const source of item.action.sources) {
        sources.push({
          title: source.title || '',
          url: source.url || '',
          image: null
        });
      }
    }

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

  return dedupeSources(sources);
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

  return dedupeSources(sources);
}

async function enrichSources(sources, { max = 6 } = {}) {
  const uniqueSources = dedupeSources(sources).slice(0, max);

  const metadataList = await Promise.all(uniqueSources.map(async (source) => {
    if (!source.url) return { source, metadata: null };
    const metadata = await fetchUrlMetadata(source.url, { timeout: 8000 });
    return { source, metadata };
  }));

  const enriched = [];

  for (const { source, metadata } of metadataList) {
    const merged = {
      ...source,
      title: source.title || metadata?.title || '',
      description: metadata?.description || source.description || '',
      image: metadata?.image || source.image || null
    };

    if (merged.image) {
      const cached = await saveRemoteImage({ url: merged.image });
      if (cached?.url) {
        merged.image_cached = cached.url;
      }
    }

    merged.image_fallback = merged.image_cached || fallbackImageUrl(merged.title || merged.url);
    enriched.push(merged);
  }

  return enriched;
}

const OPENAI_FUNCTION_TOOLS = [
  {
    type: 'function',
    name: 'generate_image',
    description: 'Generate an image for the GenUI app and return a public URL.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Detailed image prompt.' },
        aspect_ratio: {
          type: ['string', 'null'],
          description: 'Preferred aspect ratio like 1:1, 16:9, 4:3.'
        }
      },
      required: ['prompt', 'aspect_ratio'],
      additionalProperties: false
    }
  },
  {
    type: 'function',
    name: 'fetch_url_metadata',
    description: 'Fetch title, description, and image metadata for URLs.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: ['string', 'null'],
          description: 'Single URL to fetch metadata for.'
        },
        urls: {
          type: ['array', 'null'],
          items: { type: 'string' },
          description: 'List of URLs to fetch metadata for.'
        }
      },
      required: ['url', 'urls'],
      additionalProperties: false
    }
  }
];

const GEMINI_FUNCTION_DECLARATIONS = [
  {
    name: 'generate_image',
    description: 'Generate an image for the GenUI app and return a public URL.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Detailed image prompt.' },
        aspect_ratio: { type: 'string', description: 'Aspect ratio like 1:1 or 16:9.' },
        image_size: { type: 'string', description: 'Image size: 1K, 2K, or 4K.' },
        quality: { type: 'string', description: 'fast or pro.' }
      },
      required: ['prompt']
    }
  }
];

async function callOpenAIResponse({ model, instructions, input, tools, toolChoice, include }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  const body = {
    model,
    input,
    tools,
    tool_choice: toolChoice,
    include
  };

  if (instructions) {
    body.instructions = instructions;
  }

  const response = await fetchWithRetry('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  }, { maxRetries: 2, timeoutMs: 180000 });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[OpenAI] API Error:', errorText);
    throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

function getOpenAIOutputText(data) {
  if (data.output_text) return data.output_text;

  let content = '';
  if (data.output && Array.isArray(data.output)) {
    for (const item of data.output) {
      if (item.type === 'message' && item.content) {
        for (const part of item.content) {
          if (part.type === 'output_text' || part.text) {
            content += part.text || part.output_text || '';
          }
        }
      }
    }
  }

  return content;
}

function extractOpenAIFunctionCalls(output) {
  if (!output || !Array.isArray(output)) return [];
  return output.filter(item => item.type === 'function_call');
}

async function executeOpenAIToolCalls(toolCalls, { allowImageGeneration = true } = {}) {
  const outputs = [];

  for (const call of toolCalls) {
    try {
      const callId = call.call_id || call.id;
      const args = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : (call.arguments || {});

      if (call.name === 'generate_image') {
        if (!allowImageGeneration) {
          outputs.push({
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify({ error: 'Image generation disabled for this request.' })
          });
          continue;
        }
        const prompt = args.prompt;
        if (!prompt) {
          throw new Error('generate_image requires a prompt');
        }
        if (args.aspect_ratio) {
          args.prompt = `${prompt} (aspect ratio ${args.aspect_ratio})`;
        }
        const image = await generateOpenAIImage({ prompt: args.prompt || prompt });
        outputs.push({
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify({ url: image.url, filename: image.filename })
        });
      } else if (call.name === 'fetch_url_metadata') {
        let urls = [];
        if (Array.isArray(args.urls) && args.urls.length > 0) {
          urls = args.urls;
        } else if (typeof args.url === 'string' && args.url) {
          urls = [args.url];
        }
        const metadata = [];
        for (const url of urls.slice(0, 6)) {
          const info = await fetchUrlMetadata(url, { timeout: 8000 });
          if (info.image) {
            const cached = await saveRemoteImage({ url: info.image });
            if (cached?.url) {
              info.image_cached = cached.url;
            }
          }
          info.image_fallback = info.image_cached || fallbackImageUrl(info.title || info.url);
          metadata.push(info);
        }
        outputs.push({
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify({ results: metadata })
        });
      } else {
        outputs.push({
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify({ error: `Unknown tool: ${call.name}` })
        });
      }
    } catch (error) {
      outputs.push({
        type: 'function_call_output',
        call_id: call.call_id || call.id,
        output: JSON.stringify({ error: error.message })
      });
    }
  }

  return outputs;
}

function shouldIncludeContext(context) {
  if (!context) return false;
  if (context.plan) return true;
  if (Array.isArray(context.sources) && context.sources.length > 0) return true;
  if (Array.isArray(context.attachments) && context.attachments.length > 0) return true;
  if (Array.isArray(context.generated_images) && context.generated_images.length > 0) return true;
  return false;
}

function shouldEnableWebSearch(messages, enableWebSearch) {
  if (enableWebSearch === false) return false;
  if (enableWebSearch === true) return true;

  const lastUserText = getLastUserText(messages);
  if (wantsWebSearchFromText(lastUserText)) return true;
  if (/소설|이야기|시나리오|창작|동화|novel|story|fiction|poem|script/i.test(lastUserText)) {
    return false;
  }

  return true;
}

async function callOpenAIPlan({ messages, model, enableWebSearch }) {
  const input = buildOpenAIInput(messages);
  const tools = enableWebSearch ? [{ type: 'web_search' }] : [];
  const include = enableWebSearch ? ['web_search_call.action.sources'] : undefined;

  let data;
  try {
    data = await callOpenAIResponse({
      model,
      instructions: OPENAI_PLAN_PROMPT,
      input,
      tools,
      toolChoice: 'auto',
      include
    });
  } catch (error) {
    if (enableWebSearch) {
      console.warn('[OpenAI] Plan web_search failed, retrying without tools:', error.message);
      data = await callOpenAIResponse({
        model,
        instructions: OPENAI_PLAN_PROMPT,
        input,
        tools: [],
        toolChoice: 'auto'
      });
    } else {
      throw error;
    }
  }

  const planText = getOpenAIOutputText(data);
  const plan = parseJsonFromText(planText) || {
    type: 'grounded_plan',
    language: 'unknown',
    summary: planText,
    content: '',
    items: [],
    image_requests: [],
    ui_intent: ''
  };

  const sources = extractOpenAISources(data.output);
  const enrichedSources = await enrichSources(sources);
  const lastUserText = getLastUserText(messages);
  const forceSourceItems = wantsWebSearchFromText(lastUserText);
  const basePlan = forceSourceItems || !Array.isArray(plan.items) || plan.items.length === 0
    ? { ...plan, items: buildItemsFromSources(enrichedSources, 6) }
    : plan;
  const planWithImages = attachImagesToPlan(basePlan, enrichedSources);

  return {
    plan: planWithImages,
    sources: enrichedSources
  };
}

async function callOpenAIWithTools({ messages, model, enableWebSearch, context, imagePolicy }) {
  let input = buildOpenAIInput(messages);
  const contextMessage = shouldIncludeContext(context) ? buildOpenAIContextMessage(context) : null;
  if (contextMessage) {
    input = [...input, contextMessage];
  }

  const tools = [...OPENAI_FUNCTION_TOOLS];
  if (enableWebSearch) {
    tools.unshift({ type: 'web_search' });
  }

  const include = enableWebSearch ? ['web_search_call.action.sources'] : undefined;
  let data = await callOpenAIResponse({
    model,
    instructions: SYSTEM_PROMPT,
    input,
    tools,
    toolChoice: 'auto',
    include
  });

  let sources = extractOpenAISources(data.output);

  const allowImageGeneration = imagePolicy?.mode !== 'none';

  for (let attempt = 0; attempt < 4; attempt++) {
    const toolCalls = extractOpenAIFunctionCalls(data.output);
    if (toolCalls.length === 0) break;

    const toolOutputs = await executeOpenAIToolCalls(toolCalls, { allowImageGeneration });
    input = [...input, ...data.output, ...toolOutputs];

    data = await callOpenAIResponse({
      model,
      instructions: SYSTEM_PROMPT,
      input,
      tools,
      toolChoice: 'auto',
      include
    });

    sources = dedupeSources([...sources, ...extractOpenAISources(data.output)]);
  }

  const content = getOpenAIOutputText(data);
  const finalSources = context?.sources ? dedupeSources([...sources, ...context.sources]) : sources;

  return {
    content,
    parsed: parseResponse(content),
    sources: finalSources,
    usage: data.usage
  };
}

async function callGeminiApi({ model, contents, tools, systemPrompt, generationConfig }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const body = {
    contents,
    system_instruction: {
      parts: [{ text: systemPrompt }]
    },
    generationConfig: generationConfig || {
      temperature: 1.0,
      maxOutputTokens: 8192
    }
  };

  if (tools) {
    body.tools = tools;
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetchWithRetry(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  }, { maxRetries: 2, timeoutMs: 90000 });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Gemini] API Error:', response.status, errorText);
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

function getGeminiText(data) {
  let content = '';
  const candidate = data.candidates?.[0];

  if (candidate?.content?.parts) {
    for (const part of candidate.content.parts) {
      if (part.text) {
        content += part.text;
      }
    }
  }

  return content;
}

function getGeminiFunctionCalls(data) {
  const calls = [];
  const parts = data.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part.functionCall) {
      calls.push(part.functionCall);
    }
  }
  return calls;
}

function attachImagesToPlan(plan, sources) {
  if (!plan || !Array.isArray(plan.items)) return plan;

  const usedUrls = new Set();
  let updatedItems = plan.items.map((item) => {
    const source = pickBestSourceForItem(item, sources, usedUrls);
    if (source?.url) {
      usedUrls.add(source.url);
    }

    const fallback = source?.image_fallback || fallbackImageUrl(item.title || item.source_title || item.source_url || 'news');
    const urlChanged = source?.url && item.source_url && item.source_url !== source.url;
    const hasSource = Boolean(source?.url);
    const preferSource = urlChanged || !item.source_url || !item.title;
    const title = preferSource ? (source?.title || item.title || item.source_title || '') : item.title;
    const summary = (preferSource || !item.summary) ? (source?.description || item.summary || '') : item.summary;

    return {
      ...item,
      source_url: hasSource ? source.url : item.source_url,
      source_title: item.source_title || source?.title || item.title || '',
      title,
      summary,
      image: source?.image || item.image || null,
      image_fallback: fallback
    };
  });

  if (updatedItems.length === 0 && sources?.length) {
    updatedItems = sources.slice(0, 6).map((source) => ({
      title: source.title || source.url || 'Source',
      summary: source.description || '',
      source_title: source.title || '',
      source_url: source.url || '',
      image: source.image || null,
      image_fallback: source.image_fallback || fallbackImageUrl(source.title || source.url || 'news')
    }));
  }

  return {
    ...plan,
    items: updatedItems
  };
}

function buildItemsFromSources(sources, max = 6) {
  if (!Array.isArray(sources) || sources.length === 0) return [];
  return sources.slice(0, max).map((source) => ({
    title: source.title || source.url || 'Source',
    summary: source.description || '',
    source_title: source.title || '',
    source_url: source.url || '',
    image: source.image || null,
    image_fallback: source.image_fallback || fallbackImageUrl(source.title || source.url || 'news')
  }));
}

async function callGeminiGroundedPlan({ messages, model }) {
  const contents = buildGeminiContents(messages);
  const tools = [{ google_search: {} }, { url_context: {} }];
  let data;

  try {
    data = await callGeminiApi({
      model,
      contents,
      tools,
      systemPrompt: GEMINI_PLAN_PROMPT
    });
  } catch (error) {
    console.warn('[Gemini] Plan tool combo failed, retrying with google_search only:', error.message);
    try {
      data = await callGeminiApi({
        model,
        contents,
        tools: [{ google_search: {} }],
        systemPrompt: GEMINI_PLAN_PROMPT
      });
    } catch (retryError) {
      console.warn('[Gemini] Plan tool retry failed, falling back to no tools:', retryError.message);
      data = await callGeminiApi({
        model,
        contents,
        systemPrompt: GEMINI_PLAN_PROMPT
      });
    }
  }

  const planText = getGeminiText(data);
  const plan = parseJsonFromText(planText) || {
    type: 'grounded_plan',
    language: 'unknown',
    summary: planText,
    content: '',
    items: [],
    image_requests: [],
    ui_intent: ''
  };

  const sources = extractGeminiSources(data.candidates?.[0]?.groundingMetadata);
  const enrichedSources = await enrichSources(sources);
  const lastUserText = getLastUserText(messages);
  const forceSourceItems = wantsWebSearchFromText(lastUserText);
  const basePlan = forceSourceItems || !Array.isArray(plan.items) || plan.items.length === 0
    ? { ...plan, items: buildItemsFromSources(enrichedSources, 6) }
    : plan;
  const planWithImages = attachImagesToPlan(basePlan, enrichedSources);

  return {
    plan: planWithImages,
    sources: enrichedSources
  };
}

async function callGeminiWithTools({ messages, model, context, imagePolicy }) {
  const baseContents = buildGeminiContents(messages, { includeAttachments: false });

  const contextMessage = {
    role: 'user',
    parts: [{
      text: `Use this context JSON to build the GenUI response. The context is authoritative.\n- Use context.plan.items for cards/links.\n- Do NOT invent or alter URLs.\nContext:\n${JSON.stringify(context, null, 2)}`
    }]
  };

  let contents = [...baseContents, contextMessage];

  const tools = [{ functionDeclarations: GEMINI_FUNCTION_DECLARATIONS }];

  let data = await callGeminiApi({
    model,
    contents,
    tools,
    systemPrompt: SYSTEM_PROMPT
  });

  const allowImageGeneration = imagePolicy?.mode !== 'none';

  for (let attempt = 0; attempt < 4; attempt++) {
    const functionCalls = getGeminiFunctionCalls(data);
    if (functionCalls.length === 0) break;

    const functionResponses = [];
    for (const call of functionCalls) {
      if (call.name === 'generate_image') {
        if (!allowImageGeneration) {
          functionResponses.push({
            functionResponse: {
              name: call.name,
              response: { error: 'Image generation disabled for this request.' }
            }
          });
          continue;
        }
        try {
          if (!call.args?.prompt) {
            throw new Error('generate_image requires a prompt');
          }
          const result = await generateGeminiImage({
            prompt: call.args?.prompt,
            aspectRatio: call.args?.aspect_ratio,
            imageSize: call.args?.image_size,
            quality: call.args?.quality
          });

          functionResponses.push({
            functionResponse: {
              name: call.name,
              response: { url: result.url, filename: result.filename }
            }
          });
        } catch (error) {
          functionResponses.push({
            functionResponse: {
              name: call.name,
              response: { error: error.message }
            }
          });
        }
      } else {
        functionResponses.push({
          functionResponse: {
            name: call.name,
            response: { error: `Unknown tool: ${call.name}` }
          }
        });
      }
    }

    contents = [...contents, data.candidates?.[0]?.content, { role: 'user', parts: functionResponses }];

    data = await callGeminiApi({
      model,
      contents,
      tools,
      systemPrompt: SYSTEM_PROMPT
    });
  }

  const content = getGeminiText(data);

  return {
    content,
    parsed: parseResponse(content),
    sources: context.sources || [],
    usage: data.usageMetadata
  };
}

async function callGeminiFlow({ messages, model, enableWebSearch }) {
  const lastUserText = getLastUserText(messages);
  const imagePolicy = getImagePolicy(lastUserText);
  const allowImages = imagePolicy.mode !== 'none';
  const forceImages = imagePolicy.mode === 'explicit';

  if (enableWebSearch) {
    let baseContext = await callGeminiGroundedPlan({ messages, model });
    const attachments = collectAttachmentContext(messages, 'gemini');
    if (allowImages && baseContext.plan) {
      baseContext = {
        ...baseContext,
        plan: await ensurePlanImages({
          plan: baseContext.plan,
          provider: 'gemini',
          max: imagePolicy.max,
          force: forceImages
        })
      };
    }

    const context = { ...baseContext, attachments };
    if (allowImages && (!context.plan?.items || context.plan.items.length === 0)) {
      const prompt = buildImagePromptFromText(lastUserText, context.plan?.language || 'ko');
      const generated = await generateImageForPrompt({ prompt, provider: 'gemini' });
      if (generated?.url) {
        context.generated_images = [{
          url: generated.url,
          prompt,
          usage: 'inline'
        }];
      }
    }
    return callGeminiWithTools({ messages, model, context, imagePolicy });
  }

  const attachments = collectAttachmentContext(messages, 'gemini');
  const context = { plan: null, sources: [], attachments };
  if (allowImages) {
    const prompt = buildImagePromptFromText(lastUserText, 'ko');
    const generated = await generateImageForPrompt({ prompt, provider: 'gemini' });
    if (generated?.url) {
      context.generated_images = [{
        url: generated.url,
        prompt,
        usage: 'inline'
      }];
    }
  }
  return callGeminiWithTools({ messages, model, context, imagePolicy });
}

async function callOpenAIFlow({ messages, model, enableWebSearch }) {
  const lastUserText = getLastUserText(messages);
  const imagePolicy = getImagePolicy(lastUserText);
  const allowImages = imagePolicy.mode !== 'none';
  const forceImages = imagePolicy.mode === 'explicit';
  const attachments = collectAttachmentContext(messages, 'openai');

  if (enableWebSearch) {
    let baseContext = await callOpenAIPlan({ messages, model, enableWebSearch });
    if (allowImages && baseContext.plan) {
      baseContext = {
        ...baseContext,
        plan: await ensurePlanImages({
          plan: baseContext.plan,
          provider: 'openai',
          max: imagePolicy.max,
          force: forceImages
        })
      };
    }
    const context = { ...baseContext, attachments };
    if (allowImages && (!context.plan?.items || context.plan.items.length === 0)) {
      const prompt = buildImagePromptFromText(lastUserText, 'en');
      const generated = await generateImageForPrompt({ prompt, provider: 'openai' });
      if (generated?.url) {
        context.generated_images = [{
          url: generated.url,
          prompt,
          usage: 'inline'
        }];
      }
    }
    return callOpenAIWithTools({ messages, model, enableWebSearch: false, context, imagePolicy });
  }

  const context = attachments.length > 0 ? { plan: null, sources: [], attachments } : { plan: null, sources: [] };
  if (allowImages) {
    const prompt = buildImagePromptFromText(lastUserText, 'en');
    const generated = await generateImageForPrompt({ prompt, provider: 'openai' });
    if (generated?.url) {
      context.generated_images = [{
        url: generated.url,
        prompt,
        usage: 'inline'
      }];
    }
  }
  return callOpenAIWithTools({ messages, model, enableWebSearch: false, context, imagePolicy });
}

// Main LLM call function
export async function callLLM({
  messages,
  provider = process.env.DEFAULT_LLM_PROVIDER || 'gemini',
  model,
  enableWebSearch = true
}) {
  const config = PROVIDERS[provider];
  if (!config) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  const webSearchEnabled = shouldEnableWebSearch(messages, enableWebSearch);

  if (!model) {
    model = provider === 'openai' ? 'gpt-5-mini-2025-08-07' : 'gemini-3-flash-preview';
  }

  console.log(`[LLM] Provider: ${provider}, Model: ${model}, WebSearch: ${webSearchEnabled}`);

  if (provider === 'openai') {
    return callOpenAIFlow({ messages, model, enableWebSearch: webSearchEnabled });
  }

  if (provider === 'gemini') {
    return callGeminiFlow({ messages, model, enableWebSearch: webSearchEnabled });
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
    const result = await callLLM({ messages: currentMessages, provider, model, enableWebSearch: false });
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
