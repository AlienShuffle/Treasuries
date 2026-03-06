/**
 * Script to check TreasuryDirect FedInvest Historical Prices.
 * Monitors for the appearance of non-zero end-of-day prices.
 * POSTs to securityPriceDetail with a date, requests CSV format.
 */

const URL = "https://www.treasurydirect.gov/GA-FI/FedInvest/securityPriceDetail";

function mostRecentWeekday() {
    // Use ET timezone so date matches FedInvest (which publishes by ET date)
    const etStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const [y, m, d] = etStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const day = date.getDay();
    if (day === 0) date.setDate(date.getDate() - 2);
    if (day === 6) date.setDate(date.getDate() - 1);
    return date;
}

async function fetchHistoricalPrices() {
    const date  = mostRecentWeekday();
    const day   = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year  = String(date.getFullYear());

    console.log(`Checking Historical Prices for ${year}-${month}-${day} at ${new Date().toLocaleTimeString()}...`);

    const body = new URLSearchParams({
        priceDateDay: day, priceDateMonth: month, priceDateYear: year,
        fileType: 'csv', csv: 'CSV FORMAT'
    });

    const res = await fetch(URL, { method: 'POST', body });
    if (!res.ok) throw new Error(`FedInvest HTTP ${res.status}`);
    const text = await res.text();

    const lines = text.trim().split('\n').filter(l => l.trim());
    if (lines.length < 2) {
        console.log("Could not find data rows. The site might be down or format changed.");
        return;
    }

        const HEADERS = ['CUSIP', 'Type', 'Coupon', 'Maturity', 'col5', 'Buy', 'Sell', 'EOD'];
    const dataRows = lines.slice(0, 5);
    let dataFound = false;

    const parsed = dataRows.map(line => line.split(',').map(s => s.trim()));
    const colWidths = HEADERS.map((h, i) => Math.max(h.length, ...parsed.map(r => (r[i] || '').length)));
    const fmt = row => row.map((v, i) => (v || '').padEnd(colWidths[i])).join('  ');

    console.log('--- First 5 Data Rows ---');
    console.log(fmt(HEADERS));
    console.log(colWidths.map(w => '-'.repeat(w)).join('  '));
    parsed.forEach(cells => {
        console.log(fmt(cells));
        const eod = parseFloat(cells[7]);
        if (!isNaN(eod) && eod !== 0) dataFound = true;
    });

    console.log("------------------------");
    console.log(dataFound
        ? "STATUS: Non-zero end-of-day prices DETECTED."
        : "STATUS: Only zeros or no data found in the EOD price column.");
}

fetchHistoricalPrices().catch(err => { console.error("Error:", err.message); process.exit(1); });
