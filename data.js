// data.js -- CSV fetch and parse (5.0_Computation_Modules.md)
// Exports: parseCsv, fetchTipsData

const BASE_URL = 'https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/TIPS';

export function parseCsv(text) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(s => s.trim());
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(s => s.trim());
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
    return obj;
  });
}

// Fetches TipsYields.csv and RefCPI.csv from R2, parses and types the rows.
// Returns: { yieldsRows, refCpiRows }
// Throws on HTTP errors.
export async function fetchTipsData() {
  const [yieldsRes, refCpiRes] = await Promise.all([
    fetch(BASE_URL + '/TipsYields.csv'),
    fetch(BASE_URL + '/RefCPI.csv'),
  ]);
  if (!yieldsRes.ok) throw new Error('TipsYields.csv: HTTP ' + yieldsRes.status);
  if (!refCpiRes.ok) throw new Error('RefCPI.csv: HTTP ' + refCpiRes.status);

  const yieldsRows = parseCsv(await yieldsRes.text()).map(r => ({
    settlementDate: r.settlementDate,
    cusip:    r.cusip,
    maturity: r.maturity,
    coupon:   parseFloat(r.coupon),
    baseCpi:  parseFloat(r.baseCpi),
    price:    parseFloat(r.price)  || null,
    yield:    parseFloat(r.yield)  || null,
  }));

  const refCpiRows = parseCsv(await refCpiRes.text()).map(r => ({
    date:   r.date,
    refCpi: parseFloat(r.refCpi),
  }));

  return { yieldsRows, refCpiRows };
}
