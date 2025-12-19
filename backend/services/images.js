import fetch from 'node-fetch';
import { saveBase64Image } from './media.js';

const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-5-mini-2025-08-07';
const OPENAI_IMAGE_FALLBACK_MODEL = process.env.OPENAI_IMAGE_FALLBACK_MODEL || 'gpt-5-mini-2025-08-07';
const GEMINI_IMAGE_MODEL_FAST = process.env.GEMINI_IMAGE_MODEL_FAST || 'gemini-2.5-flash-image';
const GEMINI_IMAGE_MODEL_PRO = process.env.GEMINI_IMAGE_MODEL_PRO || 'gemini-3-pro-image-preview';

function shouldFallbackModel(errorMessage = '') {
  const msg = String(errorMessage);
  return msg.includes('not supported with the Responses API') || msg.includes('model_not_found');
}

async function requestOpenAIImage({ model, prompt }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      input: prompt,
      tools: [{ type: 'image_generation' }]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI image generation error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const imageCall = (data.output || []).find((item) => item.type === 'image_generation_call');
  const base64 = imageCall?.result;

  if (!base64) {
    throw new Error('OpenAI image generation returned no image data');
  }

  return saveBase64Image({ provider: 'openai', base64 });
}

export async function generateOpenAIImage({ prompt }) {
  try {
    return await requestOpenAIImage({ model: OPENAI_IMAGE_MODEL, prompt });
  } catch (error) {
    if (OPENAI_IMAGE_FALLBACK_MODEL && OPENAI_IMAGE_FALLBACK_MODEL !== OPENAI_IMAGE_MODEL && shouldFallbackModel(error.message)) {
      console.warn(`[Image] Falling back to ${OPENAI_IMAGE_FALLBACK_MODEL} for image generation.`);
      return await requestOpenAIImage({ model: OPENAI_IMAGE_FALLBACK_MODEL, prompt });
    }
    throw error;
  }
}

export async function generateGeminiImage({ prompt, aspectRatio, imageSize, quality = 'fast' }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const model = quality === 'pro' ? GEMINI_IMAGE_MODEL_PRO : GEMINI_IMAGE_MODEL_FAST;

  const generationConfig = {
    responseModalities: ['TEXT', 'IMAGE']
  };

  if (aspectRatio || imageSize) {
    generationConfig.imageConfig = {};
    if (aspectRatio) generationConfig.imageConfig.aspectRatio = aspectRatio;
    if (imageSize) generationConfig.imageConfig.imageSize = imageSize;
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini image generation error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  const inlineData = parts.find((part) => part.inlineData?.data)?.inlineData?.data;

  if (!inlineData) {
    throw new Error('Gemini image generation returned no image data');
  }

  return saveBase64Image({ provider: 'gemini', base64: inlineData });
}
