const { fetchLawSummary } = require('../lib/law-api');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const ocConfigured = !!process.env.LAW_API_OC;

  if (!ocConfigured) {
    return res.status(200).json({ ocConfigured: false, connected: false });
  }

  try {
    const summary = await fetchLawSummary();
    if (summary) {
      res.status(200).json({ ocConfigured: true, connected: true, preview: summary.substring(0, 200) });
    } else {
      res.status(200).json({ ocConfigured: true, connected: false, error: '데이터 없음 (OC 키 오류 가능성)' });
    }
  } catch (e) {
    res.status(200).json({ ocConfigured: true, connected: false, error: e.message });
  }
};
