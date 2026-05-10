const fs = require('fs');
const path = require('path');

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const ocConfigured = !!process.env.LAW_API_OC;

  let cacheData = null;
  try {
    const cacheFile = path.join(__dirname, '..', 'lib', 'law-data-cache.json');
    cacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  } catch {
    // 캐시 파일 없음
  }

  if (!cacheData) {
    return res.status(200).json({
      ocConfigured,
      cacheBuilt: false,
      message: '빌드 캐시 없음. LAW_API_OC 설정 후 Vercel 재배포 필요',
    });
  }

  res.status(200).json({
    ocConfigured,
    cacheBuilt: true,
    builtAt: cacheData.builtAt,
    hasData: !!cacheData.summary,
    preview: cacheData.summary ? cacheData.summary.substring(0, 300) : '데이터 없음 (빌드 시 LAW_API_OC 오류)',
  });
};
