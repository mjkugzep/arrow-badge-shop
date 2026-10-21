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

    // Determine current section
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

    // Direct Embedded HTML (Zero filesystem reads -> Impossible to 404 or 500)
    const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <title>Arrow District Badge Shop - Checkout</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script type="text/javascript" src="https://gateway.sumup.com/gateway/ecom/card/v2/sdk.js"></script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 820px; margin: 2rem auto; padding: 0 1rem; color: #333; line-height: 1.5; }
    .header { background: #4d2177; color: white; padding: 1.5rem; border-radius: 8px; margin-bottom: 1.5rem; }
    .warning { background: #fff3cd; border-left: 5px solid #ffc107; padding: 1rem; margin-bottom: 1.5rem; border-radius: 4px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 1.5rem; }
    th, td { padding: 10px 12px; border: 1px solid #ddd; text-align: left; font-size: 14px; }
    th { background: #f8f9fa; }
    .text-right { text-align: right; }
    .checkout-box { background: #fdfdfd; border: 1px solid #e2e8f0; padding: 1.5rem; border-radius: 8px; margin-top: 1rem; }
    .btn { background: #008751; color: white; border: none; padding: 12px 22px; font-size: 15px; border-radius: 6px; cursor: pointer; display: inline-block; }
    .btn:hover { background: #006e41; }
    .btn-bacs { background: #4d2177; margin-left: 10px; }
    .btn-bacs:hover { background: #3c195e; }
    .btn-print { background: #4d2177; color: white; padding: 10px 18px; border-radius: 6px; text-decoration: none; border: none; cursor: pointer; font-size: 14px; font-weight: bold; display: inline-block; margin-bottom: 1rem; }
    .btn-print:hover { background: #3c195e; }
    .form-group { margin-bottom: 14px; }
    .form-group label { display: block; font-size: 13px; font-weight: bold; margin-bottom: 5px; }
    .form-group input, .form-group textarea, .form-group select { width: 100%; max-width: 500px; padding: 8px 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px; box-sizing: border-box; font-family: inherit; background: white; }
    .form-row { display: flex; gap: 15px; flex-wrap: wrap; }
    .form-row .form-group { flex: 1; min-width: 240px; }
    .invoice-card { background: #f0fdf4; border: 1px solid #bbf7d0; padding: 1.5rem; border-radius: 8px; margin: 1.5rem 0; }
    .invoice-card.bacs { background: #eff6ff; border-color: #bfdbfe; }
    @media print {
      .btn-print { display: none !important; }
      body { margin: 0; padding: 0; max-width: 100%; }
    }
  </style>
</head>
<body>
  <div id="mainView">
    <div class="header">
      <h1 style="margin:0; font-size:24px;">Arrow District Scout Shop</h1>
      <p style="margin:5px 0 0; opacity:0.9;">Section: <b>${currentGroupName} - ${currentSectionName}</b> | Order Ref: <b>#${orderRef}</b></p>
    </div>

    ${sectionSwitcherHtml}
    ${diagnosticHtml}

    <h3>Order Items</h3>
    ${tableHtml}

    <div class="checkout-box">
      <h3 style="margin-top:0;">Leader Contact & Collection Details</h3>
      
      <div class="form-group">
        <label>Leader Name:</label>
        <input type="text" id="leaderName" placeholder="e.g. Skip Smith" required>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label>Scout Group / Unit:</label>
          <select id="leaderGroup" required>
            <option value="">-- Select Your Group --</option>
            <option value="1st Chandler's Ford (Brickfield Lane)">1st Chandler's Ford (Brickfield Lane)</option>
            <option value="1st Eastleigh">1st Eastleigh</option>
            <option value="1st Fair Oak">1st Fair Oak</option>
            <option value="2nd Chandler's Ford (Ramalley)">2nd Chandler's Ford (Ramalley)</option>
            <option value="3rd Chandler's Ford (U.R.C.)">3rd Chandler's Ford (U.R.C.)</option>
            <option value="4th Chandler's Ford (Hiltingbury)">4th Chandler's Ford (Hiltingbury)</option>
            <option value="4th Eastleigh">4th Eastleigh</option>
            <option value="7th Chandler's Ford">7th Chandler's Ford</option>
            <option value="7th Eastleigh (2nd Fair Oak)">7th Eastleigh (2nd Fair Oak)</option>
            <option value="11th Eastleigh (North Stoneham)">11th Eastleigh (North Stoneham)</option>
            <option value="12th Eastleigh (1st Bishopstoke)">12th Eastleigh (1st Bishopstoke)</option>
            <option value="Bishopstoke Sea Scouts (13th Eastleigh)">Bishopstoke Sea Scouts (13th Eastleigh)</option>
            <option value="14th Eastleigh">14th Eastleigh</option>
            <option value="15th Chandler's Ford (Allbrook & Otterbourne)">15th Chandler's Ford (Allbrook & Otterbourne)</option>
            <option disabled>────────── Explorer Units ──────────</option>
            <option value="Cobra Explorer Scouts">Cobra Explorer Scouts</option>
            <option value="Fusion Explorer Scouts">Fusion Explorer Scouts</option>
            <option value="Gecko Explorer Scouts">Gecko Explorer Scouts</option>
            <option value="Kayoss Explorer Scouts">Kayoss Explorer Scouts</option>
            <option value="Panthers Explorer Scouts">Panthers Explorer Scouts</option>
            <option value="Phoenix Explorer Scouts">Phoenix Explorer Scouts</option>
            <option value="Pleiades Explorer Scouts">Pleiades Explorer Scouts</option>
            <option value="Scorpion Explorer Scouts">Scorpion Explorer Scouts</option>
            <option disabled>────────── Other ──────────</option>
            <option value="Arrow District (Network / Team)">Arrow District (Network / Team)</option>
            <option value="Other / Out of District">Other / Out of District</option>
          </select>
        </div>

        <div class="form-group">
          <label>Section:</label>
          <select id="leaderSection" required>
            <option value="Squirrels">Squirrels</option>
            <option value="Beavers">Beavers</option>
            <option value="Cubs">Cubs</option>
            <option value="Scouts">Scouts</option>
            <option value="Explorers">Explorers</option>
            <option value="Network">Network</option>
            <option value="Whole Group (Multiple Sections)">Whole Group (Multiple Sections)</option>
          </select>
        </div>
      </div>

      <div class="form-group">
        <label>Email:</label>
        <input type="email" id="leaderEmail" placeholder="skip@example.org.uk" required>
      </div>

      <div class="form-group">
        <label>Message / Collection Arrangements for Badge Secretary:</label>
        <textarea id="leaderNotes" rows="3" placeholder="e.g. Will collect Thursday evening from Allbrook Hill, or please leave in Group pigeon hole."></textarea>
      </div>

      <h3 style="margin-top:1.5rem;">Payment Method</h3>
      <p style="font-size:14px; color:#666;">Pay securely online with Debit/Credit Card or Apple/Google Pay via SumUp, or generate a BACS invoice for your Group Treasurer.</p>

      <div id="payment-buttons">
        <button class="btn" id="cardBtn" onclick="startSumUpPayment()">💳 Pay &pound;${grandTotal.toFixed(2)} with Card</button>
        <button class="btn btn-bacs" id="bacsBtn" onclick="requestBACS()">🏛️ Request BACS Invoice</button>
      </div>

      <div id="sumup-card-container" style="display:none; margin-top:1.5rem; max-width:440px;">
        <h4>Enter Card Details</h4>
        <div id="sumup-card"></div>
      </div>
    </div>
  </div>

  <div id="thankYouView" style="display:none;">
    <div class="header" style="background:#008751;">
      <h1 style="margin:0; font-size:24px;">Thank You for Your Order!</h1>
      <p style="margin:5px 0 0; opacity:0.9;">Order Reference: <b id="tyOrderRef"></b></p>
    </div>

    <button class="btn-print" onclick="window.print()">🖨️ Print / Save Receipt as PDF</button>

    <div id="tyStatusCard" class="invoice-card"></div>
    <h3>Order Summary</h3>
    <div id="tyItemsTable"></div>
    <div style="background:#f8f9fa; padding:1rem; border-radius:6px; margin:1rem 0; font-size:14px;">
      <b>Leader / Group:</b> <span id="tyLeader"></span><br>
      <b>Contact Email:</b> <span id="tyEmail"></span><br>
      <b>Collection / Delivery Notes:</b> <span id="tyNotes"></span>
    </div>

    <button class="btn-print" onclick="window.print()">🖨️ Print / Save Receipt as PDF</button>
  </div>

  <script>
    var itemsPayload = ${JSON.stringify(availableBadges)};
    var orderRef = "${orderRef}";
    var grandTotal = ${grandTotal.toFixed(2)};
    var web3formsKey = "${WEB3FORMS_KEY}";
    var districtBank = ${JSON.stringify(DISTRICT_BANK)};
    var incomingSections = "${currentGroupName} - ${currentSectionName}";

    window.addEventListener("DOMContentLoaded", function() {
      var sSelect = document.getElementById("leaderSection");
      var lower = incomingSections.toLowerCase();
      if (lower.indexOf("squirrel") !== -1) sSelect.value = "Squirrels";
      else if (lower.indexOf("beaver") !== -1) sSelect.value = "Beavers";
      else if (lower.indexOf("cub") !== -1) sSelect.value = "Cubs";
      else if (lower.indexOf("scout") !== -1) sSelect.value = "Scouts";
      else if (lower.indexOf("explorer") !== -1) sSelect.value = "Explorers";
      else if (lower.indexOf("network") !== -1) sSelect.value = "Network";
    });

    function validateLeader() {
      var name = document.getElementById("leaderName").value.trim();
      var email = document.getElementById("leaderEmail").value.trim();
      var group = document.getElementById("leaderGroup").value;
      var section = document.getElementById("leaderSection").value;

      if (!name || !email) {
        alert("Please enter your Name and Email.");
        return false;
      }
      if (!group) {
        alert("Please select your Scout Group / Unit from the dropdown list.");
        return false;
      }

      return {
        leaderName: name,
        leaderEmail: email,
        leaderGroup: group + " - " + section,
        leaderNotes: (document.getElementById("leaderNotes").value.trim() || "None specified")
      };
    }

    async function sendEmailNotification(paymentType, leaderInfo) {
      var summary = "";
      for (var i = 0; i < itemsPayload.length; i++) {
        var item = itemsPayload[i];
        summary += item.quantity + "x " + item.name + " [SKU: " + item.stock_code + ", Lvl: " + item.level + "] = £" + (item.quantity * item.unitPrice).toFixed(2) + "\\n";
      }

      var bacsDetails = (paymentType.indexOf("BACS") !== -1)
        ? "\\nBACS PAYMENT INSTRUCTIONS FOR GROUP TREASURER:\\n" +
          "Account Name  : " + districtBank.accountName + "\\n" +
          "Sort Code     : " + districtBank.sortCode + "\\n" +
          "Account Number: " + districtBank.accountNumber + "\\n" +
          "Payment Ref   : " + orderRef + "\\n"
        : "";

      var bodyText =
        "ARROW DISTRICT SCOUT SHOP - BADGE ORDER\\n" +
        "----------------------------------------\\n" +
        "Order Ref     : #" + orderRef + "\\n" +
        "Date          : " + new Date().toLocaleDateString("en-GB") + "\\n" +
        "Status        : " + paymentType + "\\n\\n" +
        "LEADER & COLLECTION DETAILS:\\n" +
        "Leader Name   : " + leaderInfo.leaderName + "\\n" +
        "Group/Section : " + leaderInfo.leaderGroup + "\\n" +
        "Leader Email  : " + leaderInfo.leaderEmail + "\\n" +
        "Collection Note: " + leaderInfo.leaderNotes + "\\n\\n" +
        "PICKING LIST:\\n" +
        summary + "\\n" +
        "----------------------------------------\\n" +
        "Grand Total   : £" + grandTotal.toFixed(2) + "\\n" +
        "----------------------------------------\\n" +
        bacsDetails + "\\n" +
        (paymentType.indexOf("BACS") !== -1
          ? "ACTION: Badge Secretary to verify BACS transfer before releasing badges."
          : "CONFIRMED: Paid online via SumUp card payment.");

      try {
        var res = await fetch("https://api.web3forms.com/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({
            access_key: web3formsKey,
            subject: "[Badge Order] #" + orderRef + " - " + leaderInfo.leaderGroup + " (" + paymentType + ")",
            from_name: "Arrow District Badge Shop",
            email: leaderInfo.leaderEmail,
            message: bodyText
          })
        });
        var data = await res.json();
        console.log("Web3Forms dispatch:", data);
      } catch (err) {
        console.error("Email notification error:", err);
      }
    }

    function showThankYouScreen(paymentType, leaderInfo) {
      document.getElementById("mainView").style.display = "none";
      document.getElementById("thankYouView").style.display = "block";
      document.getElementById("tyOrderRef").innerText = "#" + orderRef;
      document.getElementById("tyLeader").innerText = leaderInfo.leaderName + " (" + leaderInfo.leaderGroup + ")";
      document.getElementById("tyEmail").innerText = leaderInfo.leaderEmail;
      document.getElementById("tyNotes").innerText = leaderInfo.leaderNotes;

      var statusCard = document.getElementById("tyStatusCard");
      if (paymentType.indexOf("BACS") !== -1) {
        statusCard.className = "invoice-card bacs";
        statusCard.innerHTML = "<h3 style='margin-top:0; color:#1e40af;'>🏛️ BACS Invoice & Payment Details</h3>" +
          "<p>Your order has been recorded. Please save or print this page and forward the details below to your <b>Group Treasurer</b> to complete BACS payment:</p>" +
          "<table style='background:white; max-width:400px;'>" +
            "<tr><td><b>Account Name:</b></td><td>" + districtBank.accountName + "</td></tr>" +
            "<tr><td><b>Sort Code:</b></td><td>" + districtBank.sortCode + "</td></tr>" +
            "<tr><td><b>Account No:</b></td><td>" + districtBank.accountNumber + "</td></tr>" +
            "<tr><td><b>Payment Reference:</b></td><td><code>" + orderRef + "</code></td></tr>" +
            "<tr><td><b>Total Due:</b></td><td><b>&pound;" + grandTotal.toFixed(2) + "</b></td></tr>" +
          "</table>";
      } else {
        statusCard.className = "invoice-card";
        statusCard.innerHTML = "<h3 style='margin-top:0; color:#166534;'>✅ Payment Received via SumUp</h3>" +
          "<p>Thank you! Your payment of <b>&pound;" + grandTotal.toFixed(2) + "</b> has been confirmed. The Badge Secretary has received your picking slip and collection notes.</p>";
      }

      var tyTable = "<table style='margin-top:10px;'><tr><th>Badge</th><th>SKU</th><th class='text-right'>Qty</th><th class='text-right'>Total</th></tr>";
      for (var i = 0; i < itemsPayload.length; i++) {
        var item = itemsPayload[i];
        tyTable += "<tr><td>" + item.name + "</td><td><code>" + item.stock_code + "</code></td><td class='text-right'>" + item.quantity + "</td><td class='text-right'>&pound;" + (item.quantity * item.unitPrice).toFixed(2) + "</td></tr>";
      }
      var totalQty = itemsPayload.reduce(function(a, b) { return a + b.quantity; }, 0);
      tyTable += "<tr style='font-weight:bold; background:#fafafa;'><td colspan='2'>Total Due</td><td class='text-right'>" + totalQty + "</td><td class='text-right'>&pound;" + grandTotal.toFixed(2) + "</td></tr></table>";
      document.getElementById("tyItemsTable").innerHTML = tyTable;
      window.scrollTo(0, 0);
    }

    async function startSumUpPayment() {
      var leader = validateLeader();
      if (!leader) return;

      var btn = document.getElementById("cardBtn");
      btn.disabled = true;
      btn.innerText = "Initializing payment...";
      try {
        var res = await fetch('/api/order', {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create_sumup",
            orderRef: orderRef,
            amount: grandTotal,
            description: "Arrow District Badges"
          })
        });

        var data = await res.json();
        if (!res.ok || !data.id) {
          alert("Payment error: " + (data.error || "Could not start SumUp checkout."));
          btn.disabled = false;
          btn.innerText = "💳 Pay £" + grandTotal.toFixed(2) + " with Card";
          return;
        }

        document.getElementById("sumup-card-container").style.display = "block";
        document.getElementById("payment-buttons").style.display = "none";

        SumUpCard.mount({
          id: "sumup-card",
          checkoutId: data.id,
          onResponse: async function (type) {
            if (type === "success") {
              await sendEmailNotification("PAID ONLINE (SumUp Card)", leader);
              showThankYouScreen("PAID ONLINE (SumUp Card)", leader);
            } else if (type === "error") {
              alert("Payment declined or encountered an error.");
            }
          }
        });

      } catch (e) {
        alert("Error: " + e.message);
        btn.disabled = false;
        btn.innerText = "💳 Pay £" + grandTotal.toFixed(2) + " with Card";
      }
    }

    async function requestBACS() {
      var leader = validateLeader();
      if (!leader) return;

      var btn = document.getElementById("bacsBtn");
      btn.disabled = true;
      btn.innerText = "Generating Invoice...";
      await sendEmailNotification("AWAITING BACS PAYMENT", leader);
      showThankYouScreen("AWAITING BACS PAYMENT", leader);
    }
  </script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(fullHtml);

  } catch (err) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send('<h3>Server Error in Callback:</h3><pre>' + (err.stack || err.message) + '</pre>');
  }
};
