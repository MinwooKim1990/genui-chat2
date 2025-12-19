import fs from 'fs';
import fetch from 'node-fetch';
import FormData from 'form-data';

export async function uploadOpenAIFile({ filePath, filename, mimeType, purpose }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  const form = new FormData();
  form.append('purpose', purpose);
  form.append('file', fs.createReadStream(filePath), {
    filename,
    contentType: mimeType
  });

  const response = await fetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      ...form.getHeaders()
    },
    body: form
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI file upload error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return {
    fileId: data.id,
    purpose
  };
}

export async function uploadGeminiFile({ filePath, mimeType, displayName }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const stats = await fs.promises.stat(filePath);

  const initResponse = await fetch('https://generativelanguage.googleapis.com/upload/v1beta/files', {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': `${stats.size}`,
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      file: {
        display_name: displayName
      }
    })
  });

  if (!initResponse.ok) {
    const errorText = await initResponse.text();
    throw new Error(`Gemini upload init error (${initResponse.status}): ${errorText}`);
  }

  const uploadUrl = initResponse.headers.get('x-goog-upload-url');
  if (!uploadUrl) {
    throw new Error('Gemini upload init did not return upload URL');
  }

  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': `${stats.size}`,
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize'
    },
    body: fs.createReadStream(filePath)
  });

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    throw new Error(`Gemini file upload error (${uploadResponse.status}): ${errorText}`);
  }

  const data = await uploadResponse.json();
  const file = data.file || {};

  return {
    fileUri: file.uri,
    mimeType: file.mimeType,
    name: file.name
  };
}
