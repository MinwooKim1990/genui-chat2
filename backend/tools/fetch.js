import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced'
});

// Configure turndown to handle common elements
turndownService.addRule('removeScripts', {
  filter: ['script', 'style', 'noscript', 'iframe', 'nav', 'footer', 'header'],
  replacement: () => ''
});

// Fetch page and convert to markdown
export async function fetchPage(url, options = {}) {
  const { timeout = 8000, maxLength = 10000 } = options;

  try {
    // Validate URL
    const parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('Invalid URL protocol');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return {
        url,
        title: 'Non-HTML Content',
        content: `This URL returns ${contentType} content which cannot be converted to markdown.`,
        success: false
      };
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Extract metadata
    const title = $('title').text().trim() ||
      $('meta[property="og:title"]').attr('content') ||
      $('h1').first().text().trim() ||
      'Untitled';

    const description = $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content') ||
      '';

    // Remove unwanted elements
    $('script, style, noscript, iframe, nav, footer, header, aside, .ad, .advertisement, .sidebar, [role="navigation"], [role="banner"], [role="complementary"]').remove();

    // Get main content
    let mainContent = $('main, article, [role="main"], .content, .post, .entry').first();
    if (!mainContent.length) {
      mainContent = $('body');
    }

    // Convert to markdown
    let markdown = turndownService.turndown(mainContent.html() || '');

    // Clean up excessive whitespace
    markdown = markdown
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\s+|\s+$/gm, '')
      .trim();

    // Truncate if too long
    if (markdown.length > maxLength) {
      markdown = markdown.slice(0, maxLength) + '\n\n... (content truncated)';
    }

    return {
      url,
      title,
      description,
      content: markdown,
      success: true
    };

  } catch (error) {
    console.error(`Fetch error for ${url}:`, error.message);

    // Return graceful fallback
    return {
      url,
      title: 'Fetch Failed',
      content: `Unable to fetch content from ${url}. Error: ${error.message}`,
      success: false,
      error: error.message
    };
  }
}

function resolveUrl(baseUrl, maybeRelative) {
  try {
    return new URL(maybeRelative, baseUrl).toString();
  } catch {
    return maybeRelative;
  }
}

// Fetch page metadata (title/description/image)
export async function fetchUrlMetadata(url, options = {}) {
  const { timeout = 8000 } = options;

  try {
    const parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('Invalid URL protocol');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const title = $('meta[property="og:title"]').attr('content') ||
      $('meta[name="twitter:title"]').attr('content') ||
      $('title').text().trim() ||
      '';

    const description = $('meta[property="og:description"]').attr('content') ||
      $('meta[name="twitter:description"]').attr('content') ||
      $('meta[name="description"]').attr('content') ||
      '';

    const image = $('meta[property="og:image"]').attr('content') ||
      $('meta[name="twitter:image"]').attr('content') ||
      $('meta[property="og:image:url"]').attr('content') ||
      '';

    return {
      url,
      title: title.trim(),
      description: description.trim(),
      image: image ? resolveUrl(url, image) : null,
      success: true
    };
  } catch (error) {
    return {
      url,
      title: '',
      description: '',
      image: null,
      success: false,
      error: error.message
    };
  }
}
