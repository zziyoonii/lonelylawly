const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const oc = process.env.LAW_API_OC;
  if (!oc) {
    return res.status(200).json({ ocConfigured: false, connected: false });
  }

  const path = `/DRF/lawSearch.do?OC=${encodeURIComponent(oc)}&target=law&type=JSON&query=${encodeURIComponent('개인정보보호법')}&display=3&sort=efdes`;

  const rawResponse = await new Promise((resolve) => {
    const reqHttp = https.request({
      hostname: 'www.law.go.kr',
      path,
      method: 'GET',
      timeout: 10000,
    }, (r) => {
      let data = '';
      r.setEncoding('utf8');
      r.on('data', chunk => { data += chunk; });
      r.on('end', () => resolve({ status: r.statusCode, body: data.substring(0, 500) }));
    });
    reqHttp.on('timeout', () => { reqHttp.destroy(); resolve({ status: 'timeout', body: '' }); });
    reqHttp.on('error', (e) => resolve({ status: 'error', body: e.message }));
    reqHttp.end();
  });

  let parsed = null;
  try { parsed = JSON.parse(rawResponse.body); } catch {}

  res.status(200).json({
    ocConfigured: true,
    httpStatus: rawResponse.status,
    rawPreview: rawResponse.body,
    parsed: parsed ? '파싱 성공' : '파싱 실패',
  });
};
