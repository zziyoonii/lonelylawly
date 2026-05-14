const { callGemini } = require('../lib/gemini');
const { callClaude } = require('../lib/claude');
const { jsonrepair } = require('jsonrepair');

const rateLimit = new Map();
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW = 60 * 60 * 1000;
function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimit.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimit.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST만 지원합니다' });
    return;
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) {
    res.status(429).json({ error: '요청이 너무 많습니다. 1시간 후 다시 시도해주세요.' });
    return;
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    res.status(400).json({ error: 'JSON 형식이 올바르지 않습니다' });
    return;
  }

  let { tosText, ppText, plan, model } = body;
  if (!plan) {
    res.status(400).json({ error: '기획안이 없습니다' });
    return;
  }

  if (plan.length > 5000) plan = plan.substring(0, 5000);

  try {
    const useModel = model === 'haiku' ? 'haiku' : 'gemini';
    const raw = useModel === 'haiku'
      ? await callClaude(tosText || '', ppText || '', plan)
      : await callGemini(tosText || '', ppText || '', plan);

    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('JSON 파싱 실패. 응답: ' + cleaned.substring(0, 200));

    let jsonStr = match[0]
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/,(\s*[}\]])/g, '$1');

    let result;
    try {
      result = JSON.parse(jsonStr);
    } catch {
      try {
        jsonStr = jsonrepair(jsonStr);
        result = JSON.parse(jsonStr);
      } catch (e2) {
        throw new Error('JSON 파싱 실패. AI 응답 형식 오류: ' + e2.message);
      }
    }
    res.status(200).json({ success: true, result });
  } catch (e) {
    console.error('[분석 오류]', e.message);
    res.status(500).json({ error: e.message });
  }
};
