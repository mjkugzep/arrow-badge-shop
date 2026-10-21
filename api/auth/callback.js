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
      if (!tokenData.access_token) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(400).send('<h3>Token Error:</h3><pre>' + JSON.stringify(tokenData, null, 2) + '</pre>');
      }
      accessToken = tokenData.access_token;
    }

    if (!accessToken) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send('<h3>Authorization Missing</h3><p><a href="/api/auth/login">Click here to Log In via OSM</a></p>');
    }

    // 2. Fetch Leader's User Roles and Sections
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

    // Determine which section to display (matching section_id or the first section)
    let selectedRole = (section_id ? roles.find(r => String(r.sectionid) === String(section_id)) : null) || roles[0];

    const currentSectionId = selectedRole.sectionid;
    const currentGroupName = selectedRole.groupname || 'Arrow District';
    const currentSectionName = selectedRole.sectionname || 'Scouts';

    // 3. Build Section Switcher Dropdown (Embedded at the top)
    let sectionOptions = roles.map(r => {
      const isSel = String(r.sectionid) === String(currentSectionId) ? 'selected' : '';
      return `<option value="${r.sectionid}" ${isSel}>${r.groupname} - ${r.sectionname}</option>`;
    }).join('');

    const sectionSwitcherHtml = `
      <div style="background:#f3e8ff; border:1px solid #d8b4fe; padding:12px 16px; border-radius:8px; margin-bottom:1.5rem; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
        <div>
          <span style="font-size:13px; color:#581c87; font-weight:bold;">Current Section:</span>
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

   // 4. Query Badges for Selected Section from OSM
    let availableBadges = [];
    let rawDebug = null;

    try {
      // Query OSM's standard badge records endpoint with action=get
      const badgeRes = await fetch(`https://www.onlinescoutmanager.co.uk/ext/badges/records/?action=get&sectionid=${currentSectionId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'User-Agent': 'Arrow-District-Badge-Shop/1.0'
        }
      });
      const badgeData = await badgeRes.json();
      rawDebug = badgeData;

      // Extract badges that have due / completed / order counts
      const badgeList = Array.isArray(badgeData) 
        ? badgeData 
        : (badgeData.items || badgeData.data || badgeData.details || []);

      if (Array.isArray(badgeList) && badgeList.length > 0) {
        badgeList.forEach(item => {
          // Check for any badge flagged as needing to be bought or awarded
          const qty = parseInt(item.due || item.needed || item.to_order || item.order || item.completed || 0, 10);
          if (qty > 0) {
            const price = PRICE_MAP[item.stock_code] !== undefined ? PRICE_MAP[item.stock_code] : DEFAULT_BADGE_PRICE;
            availableBadges.push({
              name: item.badge_name || item.name || 'Badge',
              stock_code: item.stock_code || 'BADGE',
              level: item.level || 1,
              quantity: qty,
              unitPrice: price.toFixed(2),
              lineTotal: (qty * price).toFixed(2)
            });
          }
        });
      }

      // Fallback: If records grid was empty or formatted differently, query the dashboard
      if (availableBadges.length === 0) {
        const dashRes = await fetch(`https://www.onlinescoutmanager.co.uk/ext/dashboard/?action=getDashboard&sectionid=${currentSectionId}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'User-Agent': 'Arrow-District-Badge-Shop/1.0'
          }
        });
        const dashData = await dashRes.json();
        if (dashData && dashData.data && dashData.data.due_badges) {
          rawDebug = { badgeData, dashData: dashData.data.due_badges };
          const dueList = Array.isArray(dashData.data.due_badges) ? dashData.data.due_badges : [];
          dueList.forEach(item => {
            const qty = parseInt(item.count || item.quantity || item.needed || 1, 10);
            availableBadges.push({
              name: item.name || item.badge_name || 'Badge',
              stock_code: item.stock_code || 'BADGE',
              level: item.level || 1,
              quantity: qty,
              unitPrice: DEFAULT_BADGE_PRICE.toFixed(2),
              lineTotal: (qty * DEFAULT_BADGE_PRICE).toFixed(2)
            });
          });
        }
      }
    } catch (e) {
      console.warn('Badge query error:', e);
      rawDebug = { error: e.message };
    }
    // 5. Calculate Totals
    let grandTotal = 0;
    let totalBadges = 0;
    availableBadges.forEach(b => {
      grandTotal += parseFloat(b.lineTotal);
      totalBadges += b.quantity;
    });

    const orderRef = 'ARROW-' + Date.now().toString().slice(-6);

    // Build Table HTML
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
        '<tr>' +
          '<th>Badge Name</th><th>SKU</th><th>Level</th>' +
          '<th class="text-right">Qty</th><th class="text-right">Unit Price</th><th class="text-right">Total</th>' +
        '</tr>' +
        rows +
        '<tr style="background:#fafafa; font-weight:bold;">' +
          '<td colspan="3">Grand Total (' + totalBadges + ' badges)</td>' +
          '<td class="text-right">' + totalBadges + '</td>' +
          '<td></td>' +
          '<td class="text-right">&pound;' + grandTotal.toFixed(2) + '</td>' +
        '</tr>' +
      '</table>';
    } else {
      tableHtml = `
        <div style="background:#f8f9fa; padding:1.2rem; border-radius:6px; margin-bottom:1.5rem; border:1px solid #e9ecef;">
          <p style="margin:0 0 6px;"><b>No badges currently marked as "Need to Buy"</b> in section <b>${currentGroupName} (${currentSectionName})</b>.</p>
          <p style="margin:0 0 10px; font-size:13px; color:#666;">Use the <b>Select Section to Order For</b> dropdown above if your badges are in another section.</p>
          <details style="font-size:12px; color:#777; margin-top:10px;">
            <summary style="cursor:pointer;">View Raw OSM Response for section ${currentSectionId}</summary>
            <pre style="background:#fff; border:1px solid #ddd; padding:8px; border-radius:4px; max-height:200px; overflow:auto;">${JSON.stringify(rawDebug, null, 2)}</pre>
          </details>
        </div>
      `;
    }

    // Read template.html
    const templatePath = path.join(process.cwd(), 'template.html');
    let html = fs.readFileSync(templatePath, 'utf8');

    // Pre-populate template with the chosen section
    html = html
      .replace(/{{SECTIONS}}/g, `${currentGroupName} - ${currentSectionName}`)
      .replace(/{{ORDER_REF}}/g, orderRef)
      .replace(/{{WARNING_HTML}}/g, sectionSwitcherHtml)
      .replace(/{{TABLE_HTML}}/g, tableHtml)
      .replace(/{{ITEMS_PAYLOAD}}/g, JSON.stringify(availableBadges))
      .replace(/{{GRAND_TOTAL}}/g, grandTotal.toFixed(2))
      .replace(/{{WEB3FORMS_KEY}}/g, WEB3FORMS_KEY)
      .replace(/{{DISTRICT_BANK}}/g, JSON.stringify(DISTRICT_BANK));

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);

  } catch (err) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send('<h3>Error Loading Shop:</h3><pre>' + (err.stack || err.message) + '</pre>');
  }
};
