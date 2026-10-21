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
  const { code, section_id } = req.query;
  const redirectUri = `${APP_URL}/api/auth/callback`;

  if (!code && !section_id) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(400).send('Authorization code missing.');
  }

  try {
    // 1. Exchange OAuth code for Access Token
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

    const accessToken = tokenData.access_token;

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

    // Pick the chosen section (or the first section with badge permissions)
    let selectedRole = roles.find(r => r.sectionid === section_id) || roles.find(r => r.permissions && r.permissions.badge > 0) || roles[0];

    const groupName = selectedRole.groupname || 'Arrow District';
    const sectionName = selectedRole.sectionname || 'Scouts';
    const sectionId = selectedRole.sectionid;

    // 3. Fetch Badges Due / Needed for this Section from OSM
    let availableBadges = [];
    try {
      const badgeRes = await fetch(`https://www.onlinescoutmanager.co.uk/ext/badges/records/?action=getBadgesDue&sectionid=${sectionId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'User-Agent': 'Arrow-District-Badge-Shop/1.0'
        }
      });
      const badgeData = await badgeRes.json();

      // Check if OSM returned due items
      if (badgeData && badgeData.items && Array.isArray(badgeData.items)) {
        badgeData.items.forEach(item => {
          const qty = parseInt(item.needed || item.quantity || 1, 10);
          const price = PRICE_MAP[item.stock_code] !== undefined ? PRICE_MAP[item.stock_code] : DEFAULT_BADGE_PRICE;
          availableBadges.push({
            name: item.badge_name || item.name || 'Badge',
            stock_code: item.stock_code || 'BADGE',
            level: item.level || 1,
            quantity: qty,
            unitPrice: price.toFixed(2),
            lineTotal: (qty * price).toFixed(2)
          });
        });
      }
    } catch (e) {
      console.warn('Could not pull automated badges:', e);
    }

    // 4. Calculate Totals
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
          <p style="margin:0 0 6px;"><b>Connected to OSM!</b> No badges currently marked as "Due / Need to Buy" in section <b>${groupName} (${sectionName})</b>.</p>
          <p style="margin:0; font-size:13px; color:#666;">You can mark badges as due in your OSM badge records, or specify extra badges needed in the collection notes below.</p>
        </div>
      `;
    }

    // Read template.html
    const templatePath = path.join(process.cwd(), 'template.html');
    let html = fs.readFileSync(templatePath, 'utf8');

    // Pre-populate template with Leader's actual OSM Group & Section
    html = html
      .replace(/{{SECTIONS}}/g, `${groupName} - ${sectionName}`)
      .replace(/{{ORDER_REF}}/g, orderRef)
      .replace(/{{WARNING_HTML}}/g, '')
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
