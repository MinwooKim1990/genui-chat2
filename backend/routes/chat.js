import { Router } from 'express';
import { callLLM, generateWithRepair } from '../services/llm.js';

const router = Router();

function sendSseEvent(res, event, payload) {
  if (res.writableEnded) return;
  res.write(`event: ${event}\n`);
  if (payload !== undefined) {
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    res.write(`data: ${data}\n\n`);
  } else {
    res.write('\n');
  }
}

// Main chat endpoint
router.post('/', async (req, res) => {
  try {
    const { messages, provider, model, enableWebSearch } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array required' });
    }

    console.log(`[Chat] Request: provider=${provider}, model=${model}, messages=${messages.length}`);

    // Call LLM with web search enabled
    let result = await callLLM({
      messages,
      provider,
      model,
      enableWebSearch: enableWebSearch !== undefined ? enableWebSearch : true
    });

    console.log(`[Chat] Response: parsed=${result.parsed?.length}, sources=${result.sources?.length}`);

    const hasSandbox = Array.isArray(result.parsed) && result.parsed.some(item => item.type === 'sandbox' && item.code);
    if (!hasSandbox) {
      console.warn('[Chat] Missing sandbox response, attempting one repair pass.');
      const retryMessages = [
        ...messages,
        { role: 'assistant', content: result.content || '' },
        { role: 'user', content: 'Your previous response was invalid or missing the required JSON. Output ONLY valid JSON with type "sandbox", and keep the code concise.' }
      ];
      result = await callLLM({
        messages: retryMessages,
        provider,
        model,
        enableWebSearch: enableWebSearch !== undefined ? enableWebSearch : true
      });
    }

    res.json({
      content: result.content,
      parsed: result.parsed,
      sources: result.sources || [],
      usage: result.usage
    });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Streaming chat endpoint (SSE)
router.post('/stream', async (req, res) => {
  let pingInterval;
  let closed = false;

  try {
    const { messages, provider, model, enableWebSearch } = req.body;

    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: 'Messages array required' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (res.flushHeaders) res.flushHeaders();

    sendSseEvent(res, 'ready', { ok: true });

    pingInterval = setInterval(() => {
      sendSseEvent(res, 'ping', { t: Date.now() });
    }, 15000);

    req.on('close', () => {
      closed = true;
      clearInterval(pingInterval);
    });

    console.log(`[Chat] Stream request: provider=${provider}, model=${model}, messages=${messages.length}`);

    let result = await callLLM({
      messages,
      provider,
      model,
      enableWebSearch: enableWebSearch !== undefined ? enableWebSearch : true
    });

    console.log(`[Chat] Stream response: parsed=${result.parsed?.length}, sources=${result.sources?.length}`);

    const hasSandbox = Array.isArray(result.parsed) && result.parsed.some(item => item.type === 'sandbox' && item.code);
    if (!hasSandbox) {
      console.warn('[Chat] Stream missing sandbox response, attempting one repair pass.');
      const retryMessages = [
        ...messages,
        { role: 'assistant', content: result.content || '' },
        { role: 'user', content: 'Your previous response was invalid or missing the required JSON. Output ONLY valid JSON with type "sandbox", and keep the code concise.' }
      ];
      result = await callLLM({
        messages: retryMessages,
        provider,
        model,
        enableWebSearch: enableWebSearch !== undefined ? enableWebSearch : true
      });
    }

    if (!closed) {
      sendSseEvent(res, 'result', {
        content: result.content,
        parsed: result.parsed,
        sources: result.sources || [],
        usage: result.usage
      });
    }
  } catch (error) {
    console.error('Chat stream error:', error);
    if (!closed) {
      sendSseEvent(res, 'error', { error: error.message });
    }
  } finally {
    clearInterval(pingInterval);
    if (!closed) res.end();
  }
});

// Error repair endpoint
router.post('/repair', async (req, res) => {
  try {
    const { messages, error, provider, model } = req.body;

    if (!messages || !error) {
      return res.status(400).json({ error: 'Messages and error required' });
    }

    const result = await generateWithRepair({
      messages,
      provider,
      model,
      error
    });

    res.json({
      content: result.content,
      parsed: result.parsed,
      sources: result.sources || [],
      usage: result.usage
    });
  } catch (error) {
    console.error('Repair error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
