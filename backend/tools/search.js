import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

// DuckDuckGo HTML search (no API key required)
async function searchDuckDuckGo(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
    timeout: 8000
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo search failed: ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const results = [];

  $('.result').each((i, el) => {
    if (i >= 5) return false; // Limit to 5 results

    const $el = $(el);
    const titleEl = $el.find('.result__title a');
    const snippetEl = $el.find('.result__snippet');

    const title = titleEl.text().trim();
    const url = titleEl.attr('href');
    const snippet = snippetEl.text().trim();

    if (title && url) {
      // Clean DuckDuckGo redirect URL
      let cleanUrl = url;
      if (url.includes('uddg=')) {
        const match = url.match(/uddg=([^&]+)/);
        if (match) {
          cleanUrl = decodeURIComponent(match[1]);
        }
      }

      results.push({ title, url: cleanUrl, snippet });
    }
  });

  return results;
}

// Brave Search API (free tier)
async function searchBrave(query) {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    throw new Error('Brave Search API key not configured');
  }

  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`;

  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'X-Subscription-Token': apiKey
    },
    timeout: 8000
  });

  if (!response.ok) {
    throw new Error(`Brave search failed: ${response.status}`);
  }

  const data = await response.json();

  return (data.web?.results || []).slice(0, 5).map(r => ({
    title: r.title,
    url: r.url,
    snippet: r.description
  }));
}

// Main search function with fallback
export async function webSearch(query) {
  try {
    // Try Brave first if API key is available
    if (process.env.BRAVE_SEARCH_API_KEY) {
      try {
        const results = await searchBrave(query);
        if (results.length > 0) {
          return { source: 'brave', results };
        }
      } catch (braveError) {
        console.warn('Brave search failed, falling back to DuckDuckGo:', braveError.message);
      }
    }

    // Fall back to DuckDuckGo
    const results = await searchDuckDuckGo(query);
    return { source: 'duckduckgo', results };

  } catch (error) {
    console.error('Search error:', error);
    return {
      source: 'error',
      results: [],
      error: error.message
    };
  }
}
