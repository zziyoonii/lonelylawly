const { fetchUrlWithFallback } = require('../lib/fetchUrl');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET만 지원합니다' });
    return;
  }

  const targetUrl = req.query?.url;
  if (!targetUrl) {
    res.status(400).json({ error: 'url 파라미터가 필요합니다' });
    return;
  }

  try {
    const { text, source } = await fetchUrlWithFallback(targetUrl);
    res.status(200).json({ success: true, text, length: text.length, source, cached: false });
  } catch (e) {
    console.error('[크롤링 오류]', e.message);
    res.status(500).json({ error: e.message });
  }
};
