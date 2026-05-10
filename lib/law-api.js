const https = require('https');

const LAW_QUERIES = [
  '개인정보보호법',
  '개인정보 보호법 시행령',
  '약관의 규제에 관한 법률',
  '전자상거래 등에서의 소비자보호에 관한 법률',
];

const CACHE_MS = 24 * 60 * 60 * 1000; // 24시간
let cache = null;
let cacheTime = 0;

function fetchLawList(oc, query) {
  return new Promise((resolve) => {
    const path = `/DRF/lawSearch.do?OC=${encodeURIComponent(oc)}&target=law&type=JSON&query=${encodeURIComponent(query)}&display=5&sort=efdes`;
    const req = https.request({
      hostname: 'www.law.go.kr',
      path,
      method: 'GET',
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LawFormBot/1.0)',
        'Accept': 'application/json',
      },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          let list = json?.law ?? json?.Law ?? [];
          if (!Array.isArray(list)) list = list ? [list] : [];
          resolve(list.slice(0, 3).map(l => ({
            name: l.법령명한글 ?? l['법령명한글'] ?? l.법령명 ?? '',
            effDate: l.시행일자 ?? l['시행일자'],
            pubDate: l.공포일자 ?? l['공포일자'],
            amend: l.제개정구분명 ?? l['제개정구분명'] ?? '',
          })).filter(l => l.name));
        } catch {
          resolve([]);
        }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve([]); });
    req.on('error', () => resolve([]));
    req.end();
  });
}

async function fetchLawSummary(oc) {
  if (cache && Date.now() - cacheTime < CACHE_MS) return cache;

  const ocVal = oc || process.env.LAW_API_OC;
  if (!ocVal) return '';

  const results = [];
  for (const q of LAW_QUERIES) {
    const list = await fetchLawList(ocVal, q);
    if (list.length > 0) {
      const lines = list.map(l => {
        const eff = String(l.effDate || '').replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
        return `- ${l.name}: ${l.amend || '현행'} (시행 ${eff})`;
      });
      results.push(`[${q}]\n${lines.join('\n')}`);
    }
  }

  cache = results.length > 0 ? results.join('\n\n') : '';
  cacheTime = Date.now();
  return cache;
}

module.exports = { fetchLawSummary };
