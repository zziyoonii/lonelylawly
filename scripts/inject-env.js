const fs = require('fs');
const path = require('path');
const http = require('http');

const publicDir = path.join(__dirname, '..', 'public');
const gaId = process.env.GA_MEASUREMENT_ID || '';
const adsenseId = process.env.ADSENSE_CLIENT_ID || '';
const canonicalUrl = (
  process.env.CANONICAL_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
).replace(/\/$/, '');

// index.html 치환
const indexPath = path.join(publicDir, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
html = html.replace(
  '<!-- {{GA4_SCRIPT}} -->',
  gaId
    ? `<!-- GA4 --><script async src="https://www.googletagmanager.com/gtag/js?id=${gaId}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${gaId}',{send_page_view:true});</script>`
    : '<!-- GA4: GA_MEASUREMENT_ID 미설정 -->'
);
html = html.replace(
  '<!-- {{ADSENSE_SCRIPT}} -->',
  adsenseId
    ? `<!-- AdSense --><script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsenseId}" crossorigin="anonymous"></script>`
    : '<!-- AdSense: ADSENSE_CLIENT_ID 미설정 -->'
);
html = html.replace(
  '{{CANONICAL_LINK}}',
  canonicalUrl ? `<link rel="canonical" href="${canonicalUrl}">` : ''
);
const tossLink = process.env.TOSS_TRANSFER_LINK || 'supertoss://send?bank=092&accountNo=100007262511';
html = html.replace(/\{\{TOSS_TRANSFER_LINK\}\}/g, tossLink);
fs.writeFileSync(indexPath, html);

// robots.txt, sitemap.xml 생성
const base = canonicalUrl || 'https://lawform-beta.vercel.app';
fs.writeFileSync(
  path.join(publicDir, 'robots.txt'),
  `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`
);
fs.writeFileSync(
  path.join(publicDir, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${base}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url></urlset>`
);

console.log('[inject-env] GA:', gaId ? 'OK' : 'skip', '| AdSense:', adsenseId ? 'OK' : 'skip', '| Canonical:', canonicalUrl || 'skip', '| Toss:', tossLink ? 'OK' : 'skip');

// 빌드 시점에 법령 데이터 미리 가져오기
const LAW_QUERIES = [
  '개인정보보호법',
  '개인정보 보호법 시행령',
  '약관의 규제에 관한 법률',
  '전자상거래 등에서의 소비자보호에 관한 법률',
];

function fetchLawList(oc, query) {
  return new Promise((resolve) => {
    const reqPath = `/DRF/lawSearch.do?OC=${encodeURIComponent(oc)}&target=law&type=JSON&query=${encodeURIComponent(query)}&display=5&sort=efdes`;
    const req = http.request({
      hostname: 'www.law.go.kr',
      path: reqPath,
      method: 'GET',
      timeout: 15000,
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

async function buildLawCache() {
  const oc = process.env.LAW_API_OC;
  if (!oc) {
    console.log('[law-cache] LAW_API_OC 미설정 — 법령 캐시 건너뜀');
    return;
  }

  const results = [];
  for (const q of LAW_QUERIES) {
    const list = await fetchLawList(oc, q);
    if (list.length > 0) {
      const lines = list.map(l => {
        const eff = String(l.effDate || '').replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
        return `- ${l.name}: ${l.amend || '현행'} (시행 ${eff})`;
      });
      results.push(`[${q}]\n${lines.join('\n')}`);
    }
  }

  const summary = results.join('\n\n');
  const cacheFile = path.join(__dirname, '..', 'lib', 'law-data-cache.json');
  fs.writeFileSync(cacheFile, JSON.stringify({ summary, builtAt: new Date().toISOString() }, null, 2));

  if (summary) {
    console.log('[law-cache] 법령 데이터 저장 완료 ✓');
  } else {
    console.log('[law-cache] 법령 API 응답 없음 — 빈 캐시 저장');
  }
}

buildLawCache().catch(e => console.warn('[law-cache] 오류:', e.message));
