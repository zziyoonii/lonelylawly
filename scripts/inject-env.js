const fs = require('fs');
const path = require('path');

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
