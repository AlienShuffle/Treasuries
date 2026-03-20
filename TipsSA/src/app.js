// TIPS Seasonal Adjustment (TipsSA) Frontend Logic

const R2_BASE_URL = 'https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev';
const YIELDS_CSV_URL = `${R2_BASE_URL}/TIPS/TipsYields.csv`;
const REF_CPI_CSV_URL = `${R2_BASE_URL}/TIPS/RefCpiNsaSa.csv`;

// --- Outlier Adjustments (SAO) ---
const outlierAdjustments = {
  '91282CEJ6': { type: 'fit', label: 'Apr 2027' }, // Fit to curve
  '9128282L3': { type: 'bump', bp: 5, label: 'Jul 2027' } // Bump up 5bps
};

// --- Helpers ---
function parseCsv(text) {
  const result = [];
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return result;

  const parseRow = (line) => {
    const parts = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') inQuotes = !inQuotes;
      else if (char === ',' && !inQuotes) {
        parts.push(cur.trim());
        cur = '';
      } else {
        cur += char;
      }
    }
    parts.push(cur.trim());
    return parts.map(p => p.replace(/^"|"$/g, '').trim());
  };

  const headers = parseRow(lines[0]);
  for (let i = 1; i < lines.length; i++) {
    const values = parseRow(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => {
      if (h) obj[h] = values[idx];
    });
    result.push(obj);
  }
  return result;
}

function localDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Yield calculation (actual/actual)
function yieldFromPrice(cleanPrice, coupon, settleDateStr, maturityStr) {
  if (!cleanPrice || cleanPrice <= 0) return null;
  const settle = localDate(settleDateStr);
  const mature = localDate(maturityStr);
  if (settle >= mature) return null;

  const semiCoupon = (coupon / 2) * 100;
  const matMon = mature.getMonth() + 1;
  const cm1 = matMon <= 6 ? matMon : matMon - 6;
  const cm2 = cm1 + 6;

  function nextCouponOnOrAfter(d) {
    const candidates = [];
    for (let y = d.getFullYear() - 1; y <= d.getFullYear() + 1; y++) {
      candidates.push(new Date(y, cm1 - 1, 15));
      candidates.push(new Date(y, cm2 - 1, 15));
    }
    candidates.sort((a, b) => a - b);
    return candidates.find(c => c >= d && c <= mature) || null;
  }

  const nextCoupon = nextCouponOnOrAfter(settle);
  if (!nextCoupon) return null;
  const lastCoupon = new Date(nextCoupon.getFullYear(), nextCoupon.getMonth() - 6, 15);

  const days = (a, b) => (b - a) / 86400000;
  const E = days(lastCoupon, nextCoupon);
  const A = days(lastCoupon, settle);
  const DSC = days(settle, nextCoupon);
  const accrued = semiCoupon * (A / E);
  const dirtyPrice = cleanPrice + accrued;
  const w = DSC / E;

  const coupons = [];
  let d = new Date(nextCoupon);
  while (d <= mature) {
    coupons.push(new Date(d));
    d = new Date(d.getFullYear(), d.getMonth() + 6, 15);
  }
  const N = coupons.length;
  if (N === 0) return null;

  function pv(y) {
    const r = y / 2;
    let s = 0;
    for (let k = 0; k < N; k++) {
      const cf = k === N - 1 ? semiCoupon + 100 : semiCoupon;
      s += cf / Math.pow(1 + r, w + k);
    }
    return s;
  }
  function dpv(y) {
    const r = y / 2;
    let s = 0;
    for (let k = 0; k < N; k++) {
      const cf = k === N - 1 ? semiCoupon + 100 : semiCoupon;
      s += (-cf * (w + k)) / (2 * Math.pow(1 + r, w + k + 1));
    }
    return s;
  }

  let y = coupon > 0.005 ? coupon : 0.02;
  for (let i = 0; i < 200; i++) {
    const diff = pv(y) - dirtyPrice;
    if (Math.abs(diff) < 1e-10) break;
    const deriv = dpv(y);
    if (Math.abs(deriv) < 1e-15) break;
    y -= diff / deriv;
  }
  return y;
}

let rawYieldsData = null;
let rawRefCpiData = null;
let schwabPrices = null;

async function init() {
  const statusEl = document.getElementById('status');
  
  try {
    console.log('Fetching:', YIELDS_CSV_URL, REF_CPI_CSV_URL);
    const [yieldsRes, refCpiRes] = await Promise.all([
      fetch(YIELDS_CSV_URL).catch(e => ({ ok: false, error: e })),
      fetch(REF_CPI_CSV_URL).catch(e => ({ ok: false, error: e }))
    ]);

    if (!yieldsRes.ok) {
      const err = yieldsRes.error ? yieldsRes.error.message : `Status ${yieldsRes.status}`;
      throw new Error(`Failed to fetch yields: ${err} (${YIELDS_CSV_URL})`);
    }
    if (!refCpiRes.ok) {
      const err = refCpiRes.error ? refCpiRes.error.message : `Status ${refCpiRes.status}`;
      throw new Error(`Failed to fetch RefCPI data: ${err} (${REF_CPI_CSV_URL})`);
    }

    rawYieldsData = parseCsv(await yieldsRes.text());
    rawRefCpiData = parseCsv(await refCpiRes.text());

    console.log('Data loaded:', rawYieldsData.length, 'yields,', rawRefCpiData.length, 'CPI rows');
    processAndRender();

  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    statusEl.className = 'error';
    console.error('Initialization failed:', err);
  }
}

function processAndRender() {
  if (!rawYieldsData || !rawRefCpiData) return;

  const statusEl = document.getElementById('status');
  const infoEl = document.getElementById('info-strip');
  const priceSourceEl = document.getElementById('priceSource');

  const settleDateStr = rawYieldsData[0]?.settlementDate;
  infoEl.textContent = `Prices as of ${settleDateStr} · Reference CPI / SA factors from R2`;
  priceSourceEl.style.display = schwabPrices ? 'block' : 'none';

  // 1. Initial Processing
  const allProcessed = rawYieldsData.map(bond => {
    const coupon = parseFloat(bond.coupon);
    let price = parseFloat(bond.price);
    if (schwabPrices && schwabPrices.has(bond.cusip)) price = schwabPrices.get(bond.cusip);

    const mmddSettle = bond.settlementDate.slice(5, 10);
    const mmddMature = bond.maturity.slice(5, 10);

    const saSettle = parseFloat(rawRefCpiData.find(r => r["Ref CPI Date"].includes(`-${mmddSettle}`))?.["SA Factor"]);
    const saMature = parseFloat(rawRefCpiData.find(r => r["Ref CPI Date"].includes(`-${mmddMature}`))?.["SA Factor"]);

    if (!saSettle || !saMature) return null;

    const askYield = yieldFromPrice(price, coupon, bond.settlementDate, bond.maturity);
    const saYield = yieldFromPrice(price * (saSettle / saMature), coupon, bond.settlementDate, bond.maturity);

    return { ...bond, coupon, price, askYield, saYield, maturityDate: localDate(bond.maturity) };
  }).filter(b => b !== null).sort((a, b) => a.maturityDate - b.maturityDate);

  // 2. Apply SAO (Outlier Adjustments)
  allProcessed.forEach((bond, i) => {
    bond.saoYield = bond.saYield;
    const adj = outlierAdjustments[bond.cusip];
    if (adj) {
      if (adj.type === 'fit') {
        const prev = allProcessed[i-1], next = allProcessed[i+1];
        if (prev && next) bond.saoYield = (prev.saYield + next.saYield) / 2;
        else if (prev) bond.saoYield = prev.saYield;
        else if (next) bond.saoYield = next.saYield;
      } else if (adj.type === 'bump') {
        bond.saoYield += adj.bp / 10000;
      }
    }
    bond.diffBps = (bond.saYield - bond.askYield) * 10000;
  });

  // 3. Range Filter Dropdowns
  const startSel = document.getElementById('startMaturity');
  const endSel = document.getElementById('endMaturity');
  
  if (startSel.options.length === 0) {
    allProcessed.forEach((b, i) => {
      const opt = (selected) => {
        const o = document.createElement('option');
        o.value = b.maturity; o.textContent = fmtMMM(b.maturity);
        if (selected) o.selected = true;
        return o;
      };
      startSel.appendChild(opt(i === 0));
      endSel.appendChild(opt(i === allProcessed.length - 1));
    });
    
    const trigger = () => processAndRender();
    startSel.onchange = trigger;
    endSel.onchange = trigger;
  }

  const startDate = localDate(startSel.value);
  const endDate = localDate(endSel.value);
  const filteredBonds = allProcessed.filter(b => b.maturityDate >= startDate && b.maturityDate <= endDate);

  renderTable(filteredBonds);
  renderChart(filteredBonds);
  statusEl.textContent = `Successfully loaded ${filteredBonds.length} TIPS bonds.`;
}

document.getElementById('schwabFile').addEventListener('change', async (e) => {
  if (!e.target.files.length) {
    schwabPrices = null;
    processAndRender();
    return;
  }

  try {
    const text = await e.target.files[0].text();
    const rows = parseCsv(text);
    const priceMap = new Map();
    const seenCusips = new Set();

    rows.forEach(row => {
      const desc = row["Description"] || "";
      const cusipMatch = desc.match(/[A-Z0-9]{9}/);
      if (cusipMatch) {
        const cusip = cusipMatch[0];
        if (!seenCusips.has(cusip)) {
          const price = parseFloat((row["Price"] || "").replace(/,/g, ''));
          if (!isNaN(price)) priceMap.set(cusip, price);
          seenCusips.add(cusip);
        }
      }
    });

    if (priceMap.size === 0) {
      alert("No valid prices found in the Schwab CSV.");
      e.target.value = '';
      return;
    }

    schwabPrices = priceMap;
    processAndRender();
  } catch (err) {
    alert("Error parsing Schwab CSV: " + err.message);
  }
});

function fmtMMM(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function renderTable(bonds) {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = bonds.map(b => `
    <tr>
      <td>${fmtMMM(b.maturity)}</td>
      <td>${b.cusip}</td>
      <td>${(b.coupon * 100).toFixed(3)}%</td>
      <td>${b.price.toFixed(3)}</td>
      <td>${(b.askYield * 100).toFixed(3)}%</td>
      <td>${(b.saYield * 100).toFixed(3)}%</td>
      <td class="${b.diffBps >= 0 ? 'pos' : 'neg'}">${b.diffBps.toFixed(1)}</td>
    </tr>
  `).join('');
}

let chart = null;
function renderChart(bonds) {
  const ctx = document.getElementById('yieldChart').getContext('2d');
  const labels = bonds.map(b => fmtMMM(b.maturity));
  const askYields = bonds.map(b => (b.askYield * 100).toFixed(3));
  const saYields = bonds.map(b => (b.saYield * 100).toFixed(3));
  const saoYields = bonds.map(b => (b.saoYield * 100).toFixed(3));

  if (chart) chart.destroy();

  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Ask Yield (%)',
          data: askYields,
          borderColor: '#94a3b8',
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          pointRadius: 2,
          tension: 0.1
        },
        {
          label: 'SA Yield (%)',
          data: saYields,
          borderColor: '#94a3b8',
          borderDash: [5, 5],
          backgroundColor: 'transparent',
          borderWidth: 1,
          pointRadius: 0,
          tension: 0.1
        },
        {
          label: 'SAO Yield (%)',
          data: saoYields,
          borderColor: '#1a56db',
          backgroundColor: 'transparent',
          borderWidth: 2.5,
          pointRadius: 3,
          tension: 0.1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { display: true, title: { display: true, text: 'Maturity' } },
        y: { display: true, title: { display: true, text: 'Yield (%)' } }
      },
      plugins: {
        zoom: {
          pan: { enabled: true, mode: 'x' },
          zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' }
        },
        tooltip: {
          callbacks: {
            label: (context) => `${context.dataset.label}: ${context.parsed.y}%`
          }
        }
      }
    }
  });

  document.getElementById('resetZoom').onclick = () => chart.resetZoom();
}

init();
