import { Router } from 'express';
import { callLLM, generateWithRepair } from '../services/llm.js';
import { executeTools } from '../tools/index.js';

const router = Router();

// Available tools for the LLM
const AVAILABLE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for information. Use this when you need current data or facts.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'fetch_page',
      description: 'Fetch and extract content from a webpage. Returns markdown.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to fetch'
          }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'calculate',
      description: 'Perform mathematical calculations',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: 'Mathematical expression to evaluate'
          }
        },
        required: ['expression']
      }
    }
  }
];

// Main chat endpoint
router.post('/', async (req, res) => {
  try {
    const { messages, provider, model, repair } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array required' });
    }

    // If repair mode, use generateWithRepair
    if (repair?.error) {
      const result = await generateWithRepair({
        messages,
        provider,
        model,
        error: repair.error
      });
      return res.json(result);
    }

    // Regular chat with tool support
    const result = await callLLM({
      messages,
      provider,
      model,
      tools: AVAILABLE_TOOLS
    });

    // Handle tool calls if present
    if (result.toolCalls && result.toolCalls.length > 0) {
      const toolResults = await executeTools(result.toolCalls);

      // Add tool results to conversation and get final response
      const updatedMessages = [
        ...messages,
        { role: 'assistant', content: result.content, tool_calls: result.toolCalls },
        ...toolResults.map(tr => ({
          role: 'tool',
          tool_call_id: tr.id,
          content: JSON.stringify(tr.result)
        }))
      ];

      const finalResult = await callLLM({
        messages: updatedMessages,
        provider,
        model
      });

      return res.json({
        ...finalResult,
        toolsUsed: toolResults.map(tr => ({
          name: tr.name,
          result: tr.result
        }))
      });
    }

    res.json(result);
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Streaming chat endpoint
router.post('/stream', async (req, res) => {
  try {
    const { messages, provider, model } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array required' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    await callLLM({
      messages,
      provider,
      model,
      stream: true,
      onChunk: (chunk) => {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        if (chunk.done) {
          res.end();
        }
      }
    });
  } catch (error) {
    console.error('Stream error:', error);
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
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

    res.json(result);
  } catch (error) {
    console.error('Repair error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
