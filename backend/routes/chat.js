import { Router } from 'express';
import { callLLM, generateWithRepair } from '../services/llm.js';

const router = Router();

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
