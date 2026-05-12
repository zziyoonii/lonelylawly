const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ ok: false, error: 'GEMINI_API_KEY 환경변수 없음' });
  }

  const body = JSON.stringify({
    contents: [{ parts: [{ text: 'hi' }] }],
  });

  return new Promise((resolve) => {
    const req2 = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 15000,
    }, (r) => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            res.status(200).json({ ok: false, error: parsed.error.message, code: parsed.error.code });
          } else {
            res.status(200).json({ ok: true, message: 'Gemini API 정상 작동 중' });
          }
        } catch {
          res.status(200).json({ ok: false, error: '응답 파싱 실패', raw: data.substring(0, 200) });
        }
        resolve();
      });
    });
    req2.on('timeout', () => { req2.destroy(); res.status(200).json({ ok: false, error: '타임아웃' }); resolve(); });
    req2.on('error', (e) => { res.status(200).json({ ok: false, error: e.message }); resolve(); });
    req2.write(body);
    req2.end();
  });
};
