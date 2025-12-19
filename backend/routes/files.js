import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { uploadOpenAIFile, uploadGeminiFile } from '../services/files.js';
import { UPLOADS_DIR, ensureMediaDirs, publicUrlForPath } from '../services/media.js';

const router = Router();

ensureMediaDirs();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    const safeName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, safeName);
  }
});

const upload = multer({ storage });

const OPENAI_MAX_FILE_BYTES = 50 * 1024 * 1024;

function detectKind(mimeType = '') {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('text/')) return 'text';
  return 'other';
}

function validateOpenAIFile(file) {
  const kind = detectKind(file.mimetype);

  if (kind === 'pdf' || kind === 'image') {
    if (file.size > OPENAI_MAX_FILE_BYTES) {
      throw new Error('OpenAI file inputs must be 50MB or smaller');
    }
    return { kind, supported: true };
  }

  return { kind, supported: false };
}

router.post('/upload', upload.array('files'), async (req, res) => {
  const provider = (req.query.provider || 'gemini').toString().toLowerCase();
  const files = req.files || [];

  if (!files.length) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  const results = [];

  for (const file of files) {
    const kind = detectKind(file.mimetype);
    const publicUrl = publicUrlForPath(`/media/uploads/${file.filename}`);

    const result = {
      id: `${file.filename}`,
      name: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      provider,
      kind,
      publicUrl,
      analysisAvailable: true
    };

    try {
      if (provider === 'openai') {
        const validation = validateOpenAIFile(file);
        result.kind = validation.kind;
        if (!validation.supported) {
          result.analysisAvailable = false;
          result.warning = 'OpenAI supports PDF and image inputs only. File will be available for UI rendering but not analysis.';
        } else {
          const purpose = validation.kind === 'image' ? 'vision' : 'user_data';
          const uploadResult = await uploadOpenAIFile({
            filePath: file.path,
            filename: file.originalname,
            mimeType: file.mimetype,
            purpose
          });
          result.fileId = uploadResult.fileId;
          result.purpose = uploadResult.purpose;
        }
      } else if (provider === 'gemini') {
        const uploadResult = await uploadGeminiFile({
          filePath: file.path,
          mimeType: file.mimetype,
          displayName: file.originalname
        });
        result.fileUri = uploadResult.fileUri;
        result.mimeType = uploadResult.mimeType || file.mimetype;
        result.fileName = uploadResult.name;
      } else {
        result.analysisAvailable = false;
        result.warning = `Unknown provider: ${provider}`;
      }
    } catch (error) {
      result.analysisAvailable = false;
      result.error = error.message;
    }

    results.push(result);
  }

  res.json({ files: results });
});

export default router;
