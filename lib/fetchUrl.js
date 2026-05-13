const http = require('http');
const https = require('https');

function fetchUrl(targetUrl, redirectCount = 0) {
  if (redirectCount > 5) return Promise.reject(new Error('리다이렉트 초과'));
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      },
      timeout: 12000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : `${parsed.protocol}//${parsed.hostname}${res.headers.location}`;
        fetchUrl(next, redirectCount + 1).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('요청 시간 초과 (12초)')); });
    req.on('error', reject);
    req.end();
  });
}

function fetchWithBrowserless(targetUrl) {
  const key = process.env.BROWSERLESS_API_KEY;
  if (!key) return Promise.resolve(null);

  const body = JSON.stringify({ url: targetUrl });
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'chrome.browserless.io',
      path: `/content?token=${key}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 30000,
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/data:[a-z/]+;base64,[A-Za-z0-9+/=]+/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function fetchUrlWithFallback(targetUrl) {
  try {
    const html = await fetchUrl(targetUrl);
    const text = htmlToText(html);
    if (text.length >= 200) return text;

    // 내용이 너무 짧으면 JS 렌더링 필요 → Browserless 시도
    const browserlessHtml = await fetchWithBrowserless(targetUrl);
    if (browserlessHtml) {
      const browserlessText = htmlToText(browserlessHtml);
      if (browserlessText.length > text.length) return browserlessText;
    }
    return text;
  } catch (e) {
    // 일반 크롤링 실패 시 Browserless 시도
    const browserlessHtml = await fetchWithBrowserless(targetUrl);
    if (browserlessHtml) return htmlToText(browserlessHtml);
    throw e;
  }
}

module.exports = { fetchUrl, fetchUrlWithFallback, htmlToText };
