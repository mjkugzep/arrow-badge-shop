const fs = require('fs');
const path = require('path');

// ==========================================
// 1. CONFIGURATION & DISTRICT DETAILS
// ==========================================
const OSM_CLIENT_ID = 'e8c874ed-8441-4c77-b2c7-558828d3051e';
const SUMUP_API_KEY = 'sup_sk_RfDk9vk70dazaoQ9rm2SxmADYN9fnqrTe';
const SUMUP_MERCHANT_CODE = 'MCDTTADM';
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
  try {
    // -----------------------------------------------------------
    // POST: Create SumUp Checkout Session
    // -----------------------------------------------------------
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      await new Promise(resolve => req.on('end', resolve));

      let payload = {};
      try { 
        payload = JSON.parse(body || '{}'); 
      } catch (e) {
        return res.status(400).json({ error: 'Invalid JSON payload' });
      }

      if (payload.action === 'create_sumup') {
        const apiKey = (SUMUP_API_KEY || '').trim();
        const mCode = (SUMUP_MERCHANT_CODE || 'MCDTTADM').trim();

        if (!apiKey) {
          return res.status(400).json({ 
            error: 'SUMUP_API_KEY is missing.' 
          });
        }

        const sumupBody = {
          checkout_reference: String(payload.orderRef).slice(0, 50),
          amount: parseFloat(payload.amount),
          currency: 'GBP',
          merchant_code: mCode,
          description: String(payload.description || 'Arrow District Badges').slice(0, 100)
        };

        const sumupRes = await fetch('https://api.sumup.com/v0.1/checkouts', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + apiKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(sumupBody)
        });

        const rawText = await sumupRes.text();
        let checkoutData = {};
        try {
          checkoutData = JSON.parse(rawText);
        } catch (e) {
          checkoutData = { raw_body: rawText };
        }

        if (!sumupRes.ok) {
          return res.status(400).json({ 
            error: 'HTTP ' + sumupRes.status + ' - ' + JSON.stringify(checkoutData, null, 2) 
          });
        }

        return res.status(200).json(checkoutData);
      }

      return res.status(400).json({ error: 'Unknown action' });
    }

    // -----------------------------------------------------------
    // GET: Handle OSM Redirect
    // -----------------------------------------------------------
    const rawUrl = req.url || '';
    const match = rawUrl.match(/[?&]order_url=([^&]+)/);
    const orderUrl = match ? decodeURIComponent(match[1]) : req.query.order_url;

    if (!orderUrl) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send('<h3>Arrow District Scout Shop</h3><p>Waiting for an OSM test order.</p>');
    }

    // Fetch order from OSM within 5 minutes
    const osmEndpoint = 'https://www.onlinescoutmanager.co.uk' + orderUrl;
    const osmResponse = await fetch(osmEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Arrow-District-Badge-Shop/1.0'
      },
      body: 'client_id=' + encodeURIComponent((OSM_CLIENT_ID || '').trim())
    });

    const osmData = await osmResponse.json();

    if (!osmData || !osmData.status) {
      const errorMsg = typeof osmData?.error === 'object' ? JSON.stringify(osmData.error, null, 2) : (osmData?.error || 'Session expired or invalid Client ID');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send('<h3>OSM Error</h3><pre>' + errorMsg + '</pre>');
    }

    const sections = osmData.data.sections || [osmData.data.section];
    const badges = osmData.data.badges || [];

    const available = [];
    const unavailable = [];
    let grandTotal = 0;
    let totalBadges = 0;

    badges.forEach(b => {
      if (!b.stock_code) {
        unavailable.push(b);
      } else {
        const unitPrice = PRICE_MAP[b.stock_code] !== undefined ? PRICE_MAP[b.stock_code] : DEFAULT_BADGE_PRICE;
        const lineTotal = unitPrice * b.quantity;
        grandTotal += lineTotal;
        totalBadges += b.quantity;
        available.push({
          ...b,
          unitPrice: unitPrice.toFixed(2),
          lineTotal: lineTotal.toFixed(2)
        });
      }
    });

    const orderRef = 'ARROW-' + Date.now().toString().slice(-6);

    // Build Warning HTML (OSM mandatory first-screen rule)
    let warningHtml = '';
    if (unavailable.length > 0) {
      const listItems = unavailable.map(b => '<li>' + b.name + ' (Level ' + b.level + ') — Qty: ' + b.quantity + '</li>').join('');
      warningHtml = '<div class="warning">' +
        '<h3 style="margin:0 0 6px; color:#856404;">⚠️ Items Unable to be Fulfilled</h3>' +
        '<p style="margin:0 0 8px; font-size:14px;">The following custom or unmapped items cannot be supplied through the automated shop and have been excluded from this order:</p>' +
        '<ul style="margin:0; padding-left:20px;">' + listItems + '</ul>' +
      '</div>';
    }

    // Build ONLY the Table HTML (no duplicate form here)
    let tableHtml = '';
    if (available.length > 0) {
      const rows = available.map(b =>
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
      tableHtml = '<p><i>No fulfillable items mapped in this order. Please map badges in your OSM control panel.</i></p>';
    }

    // Read template.html from project directory
    const templatePath = path.join(process.cwd(), 'template.html');
    let html = fs.readFileSync(templatePath, 'utf8');

    // Fill in template placeholders
    html = html
      .replace(/{{SECTIONS}}/g, sections.join(', ').toUpperCase())
      .replace(/{{ORDER_REF}}/g, orderRef)
      .replace(/{{WARNING_HTML}}/g, warningHtml)
      .replace(/{{TABLE_HTML}}/g, tableHtml)
      .replace(/{{ITEMS_PAYLOAD}}/g, JSON.stringify(available))
      .replace(/{{GRAND_TOTAL}}/g, grandTotal.toFixed(2))
      .replace(/{{WEB3FORMS_KEY}}/g, WEB3FORMS_KEY)
      .replace(/{{DISTRICT_BANK}}/g, JSON.stringify(DISTRICT_BANK));

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);

  } catch (err) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send('<h3>Server Error</h3><pre>' + (err ? err.stack || err.message : 'Unknown error') + '</pre>');
  }
};