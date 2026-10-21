const fs = require('fs');
const path = require('path');

const CLIENT_ID = 'n02R5IdYlrnRUvByY9JCbIqB9L04hedI';
const CLIENT_SECRET = 'HDbm5uCLTpU7ZmiIugNu6ianB3cnal78wpXJ4BP1QrrgFcexHBb0nIl3pwrm1Wks';
const APP_URL = 'https://arrow-badge-shop.vercel.app';
const WEB3FORMS_KEY = '454aaffb-de18-4c39-a511-398c15397a9b';

const DISTRICT_BANK = {
  accountName: 'Arrow Scout District',
  sortCode: '30-99-50',
  accountNumber: '37451768',
  bankName: 'Lloyds Bank'
};

const DEFAULT_BADGE_PRICE = 0.90;
const PRICE_MAP = {};

module.exports = async (req, res) => {
  const { code, section_id, token } = req.query;
  const redirectUri = `${APP_URL}/api/auth/callback`;

  let accessToken = token;

  try {
    // 1. Exchange OAuth code for Access Token if needed
    if (code && !accessToken) {
      const params = new URLSearchParams();
      params.append('grant_type', 'authorization_code');
      params.append('client_id', CLIENT_ID.trim());
      params.append('client_secret', CLIENT_SECRET.trim());
      params.append('redirect_uri', redirectUri);
      params.append('code', code.trim());

      const tokenRes = await fetch('https://www.onlinescoutmanager.co.uk/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Arrow-District-Badge-Shop/1.0'
        },
        body: params.toString()
      });

      const tokenData = await tokenRes.json();
      if (!tokenData || !tokenData.access_token) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send(`
          <body style="font-family:sans-serif; max-width:600px; margin:3rem auto; padding:1rem; line-height:1.5;">
            <div style="background:#fee2e2; border:1px solid #f87171; padding:1.5rem; border-radius:8px;">
              <h3 style="margin-top:0; color:#991b1b;">⚠️ OSM Login Code Expired or Already Used</h3>
              <p>OSM login authorization codes are strictly single-use and expire within a couple of minutes.</p>
              <p><a href="/api/auth/login" style="background:#4d2177; color:white; padding:10px 18px; border-radius:5px; text-decoration:none; font-weight:bold; display:inline-block;">Click Here to Log In Again</a></p>
            </div>
          </body>
        `);
      }
      accessToken = tokenData.access_token;
    }

    if (!accessToken) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(`
        <body style="font-family:sans-serif; max-width:600px; margin:3rem auto; padding:1rem;">
          <h3>No OSM Session Active</h3>
          <p><a href="/api/auth/login" style="background:#4d2177; color:white; padding:10px 18px; border-radius:5px; text-decoration:none;">Log In via OSM</a></p>
        </body>
      `);
    }

    // 2. Fetch Leader Roles & Sections
    const userRes = await fetch('https://www.onlinescoutmanager.co.uk/api.php?action=getUserRoles', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const roles = await userRes.json();
    if (!roles || !Array.isArray(roles) || roles.length === 0) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send('<h3>No scout sections found for this login.</h3>');
    }

    // Pick selected role or first available
    let selectedRole = (section_id ? roles.find(r => String(r.sectionid) === String(section_id)) : null) || roles[0];

    const currentSectionId = selectedRole.sectionid;
    const currentGroupName = selectedRole.groupname || 'Arrow District';
    const currentSectionName = selectedRole.sectionname || 'Scouts';
    const currentSectionType = (selectedRole.section || selectedRole.section_type || 'scouts').toLowerCase();

    // 3. Fetch Terms to find active term_id
    let termId = '';
    try {
      const termRes = await fetch(`https://www.onlinescoutmanager.co.uk/api.php?action=getTerms`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });
      const termData = await termRes.json();
      if (termData && termData[currentSectionId] && termData[currentSectionId].length > 0) {
        const termsList = termData[currentSectionId];
        const active = termsList.find(t => !t.past) || termsList[termsList.length - 1];
        termId = active.termid;
      }
    } catch (e) {
      console.warn('Could not fetch terms list:', e);
    }

    // 4. Query Badges to Buy from OSM
    let availableBadges = [];
    let stockStatus = null;
    let rawStockResponse = null;

    const stockParams = new URLSearchParams();
    stockParams.append('action', 'getBadgeStock');
    stockParams.append('section', currentSectionType);
    stockParams.append('section_id', String(currentSectionId));
    if (termId) {
      stockParams.append('term_id', String(termId));
    }
    stockParams.append('seeIfShared', 'y');

    const osmStockUrl = `https://www.onlinescoutmanager.co.uk/ext/badges/stock/?${stockParams.toString()}`;

    try {
      const stockRes = await fetch(osmStockUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'User-Agent': 'Arrow-District-Badge-Shop/1.0'
        }
      });

      stockStatus = stockRes.status;
      rawStockResponse = await stockRes.json();

      if (rawStockResponse && Array.isArray(rawStockResponse.items)) {
        rawStockResponse.items.forEach(item => {
          const buyCount = parseInt(item.buy, 10) || 0;
          const dueCount = parseInt(item.due, 10) || 0;
          const count = buyCount > 0 ? buyCount : dueCount;

          if (count > 0) {
            const stockCode = item.shortname || item.badge_id_level || 'BADGE';
            const price = PRICE_MAP[stockCode] !== undefined ? PRICE_MAP[stockCode] : DEFAULT_BADGE_PRICE;

            availableBadges.push({
              name: item.name,
              stock_code: stockCode,
              level: item.level || 1,
              quantity: count,
              unitPrice: price.toFixed(2),
              lineTotal: (count * price).toFixed(2)
            });
          }
        });
      }
    } catch (e) {
      rawStockResponse = { error: e.message };
    }

    // 5. Section Switcher Bar
    let sectionOptions = roles.map(r => {
      const isSel = String(r.sectionid) === String(currentSectionId) ? 'selected' : '';
      return `<option value="${r.sectionid}" ${isSel}>${r.groupname} - ${r.sectionname}</option>`;
    }).join('');

    const sectionSwitcherHtml = `
      <div style="background:#f3e8ff; border:1px solid #d8b4fe; padding:12px 16px; border-radius:8px; margin-bottom:1.5rem; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
        <div>
          <span style="font-size:13px; color:#581c87; font-weight:bold;">Active Section:</span>
          <b style="color:#3b0764; margin-left:5px;">${currentGroupName} (${currentSectionName})</b>
        </div>
        <div>
          <label style="font-size:12px; color:#581c87; font-weight:bold; margin-right:6px;">Select Section to Order For:</label>
          <select onchange="window.location.href='/api/auth/callback?token=${accessToken}&section_id=' + this.value" style="padding:6px 10px; border-radius:4px; border:1px solid #c084fc; font-size:13px; font-weight:bold; background:white;">
            ${sectionOptions}
          </select>
        </div>
      </div>
    `;

    // 6. Diagnostics Box
    const diagnosticHtml = `
      <div style="background:#fff7ed; border:1px solid #fed7aa; padding:1rem; border-radius:6px; margin-bottom:1.5rem; font-size:13px; color:#9a3412;">
        <h4 style="margin:0 0 8px;">🔍 OSM API Diagnostics</h4>
        <b>Request URL:</b> <code>${osmStockUrl.replace(/&/g, '&amp;')}</code><br>
        <b>HTTP Status:</b> <code>${stockStatus}</code><br>
        <b>Term ID:</b> <code>${termId || 'None detected'}</code><br>
        <b>Badges Parsed:</b> <code>${availableBadges.length}</code><br>
        <details style="margin-top:8px;">
          <summary style="cursor:pointer; font-weight:bold;">Click to View Raw Stock Response</summary>
          <pre style="background:#fff; border:1px solid #fdba74; padding:8px; border-radius:4px; max-height:220px; overflow:auto; color:#333;">${JSON.stringify(rawStockResponse, null, 2)}</pre>
        </details>
      </div>
    `;

    // 7. Calculate Totals
    let grandTotal = 0;
    let totalBadges = 0;
    availableBadges.forEach(b => {
      grandTotal += parseFloat(b.lineTotal);
      totalBadges += b.quantity;
    });

    const orderRef = 'ARROW-' + Date.now().toString().slice(-6);

    let tableHtml = '';
    if (availableBadges.length > 0) {
      const rows = availableBadges.map(b =>
        '<tr>' +
          '<td><b>' + b.name + '</b></td>' +
          '<td><code>' + b.stock_code + '</code></td>' +
          '<td>' + b.level + '</td>' +
          '<td class="text-right">' + b.quantity + '</td>' +
          '<td class="text-right">&pound;' + b.unitPrice + '</td>' +
          '<td class="text-right">&pound;' + b.lineTotal + '</td>' +
        '</tr>'
      ).join('');

      tableHtml = '<table>' +
        '<tr><th>Badge Name</th><th>SKU</th><th>Level</th><th class="text-right">Qty</th><th class="text-right">Unit Price</th><th class="text-right">Total</th></tr>' +
        rows +
        '<tr style="background:#fafafa; font-weight:bold;"><td colspan="3">Grand Total (' + totalBadges + ' badges)</td><td class="text-right">' + totalBadges + '</td><td></td><td class="text-right">&pound;' + grandTotal.toFixed(2) + '</td></tr>' +
      '</table>';
    } else {
      tableHtml = '<p><i>No badges currently flagged with a buy/due quantity in this section.</i></p>';
    }

    // Safely resolve template.html
    let html = '';
    const possiblePaths = [
      path.join(process.cwd(), 'template.html'),
      path.join(__dirname, '..', '..', 'template.html'),
      path.join(__dirname, 'template.html')
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        html = fs.readFileSync(p, 'utf8');
        break;
      }
    }

    if (!html) {
      throw new Error('template.html could not be located in serverless environment.');
    }

    html = html
      .replace(/{{SECTIONS}}/g, `${currentGroupName} - ${currentSectionName}`)
      .replace(/{{ORDER_REF}}/g, orderRef)
      .replace(/{{WARNING_HTML}}/g, sectionSwitcherHtml + diagnosticHtml)
      .replace(/{{TABLE_HTML}}/g, tableHtml)
      .replace(/{{ITEMS_PAYLOAD}}/g, JSON.stringify(availableBadges))
      .replace(/{{GRAND_TOTAL}}/g, grandTotal.toFixed(2))
      .replace(/{{WEB3FORMS_KEY}}/g, WEB3FORMS_KEY)
      .replace(/{{DISTRICT_BANK}}/g, JSON.stringify(DISTRICT_BANK));

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);

  } catch (err) {
    res.setHeader('Content-Type', 'text/html; charset=utf-
