import { Router } from 'express';
import { webSearch } from '../tools/search.js';
import { fetchPage } from '../tools/fetch.js';
import { calculate, formatDate, formatTable, convert } from '../tools/utils.js';

const router = Router();

// Web search endpoint
router.post('/search', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'Query required' });
    }

    const results = await webSearch(query);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Page fetch endpoint
router.post('/fetch', async (req, res) => {
  try {
    const { url, timeout, maxLength } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'URL required' });
    }

    const result = await fetchPage(url, { timeout, maxLength });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Calculate endpoint
router.post('/calculate', (req, res) => {
  try {
    const { expression } = req.body;
    if (!expression) {
      return res.status(400).json({ error: 'Expression required' });
    }

    const result = calculate(expression);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Date format endpoint
router.post('/date', (req, res) => {
  try {
    const { date, format } = req.body;
    const result = formatDate(date, format);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Table format endpoint
router.post('/table', (req, res) => {
  try {
    const { data } = req.body;
    if (!data) {
      return res.status(400).json({ error: 'Data required' });
    }

    const result = formatTable(data);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Unit conversion endpoint
router.post('/convert', (req, res) => {
  try {
    const { value, conversion } = req.body;
    if (value === undefined || !conversion) {
      return res.status(400).json({ error: 'Value and conversion required' });
    }

    const result = convert(value, conversion);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
