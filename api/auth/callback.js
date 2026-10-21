module.exports = async (req, res) => {
  const { code } = req.query;
  const clientId = 'n02R5IdYlrnRUvByY9JCbIqB9L04hedI';
  const clientSecret = 'HDbm5uCLTpU7ZmiIugNu6ianB3cnal78wpXJ4BP1QrrgFcexHBb0nIl3pwrm1Wks';
  const appUrl = 'https://arrow-badge-shop.vercel.app';
  const redirectUri = `${appUrl}/api/auth/callback`;

  if (!code) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(400).send('Authorization code missing from OSM redirect.');
  }

  try {
    // 1. Exchange the code for an Access Token
    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('client_id', clientId.trim());
    params.append('client_secret', clientSecret.trim());
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
      return res.status(400).send('<h3>Failed to obtain token from OSM:</h3><pre>' + JSON.stringify(tokenData, null, 2) + '</pre>');
    }

    const accessToken = tokenData.access_token;

    // 2. Fetch the user's roles and sections from OSM
    const userRes = await fetch('https://www.onlinescoutmanager.co.uk/api.php?action=getUserRoles', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const userData = await userRes.json();

    // 3. Display successful connection & sections returned
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>OSM Connection Successful</title>
        <style>
          body { font-family: sans-serif; max-width: 750px; margin: 3rem auto; padding: 0 1rem; line-height: 1.5; color: #333; }
          .header { background: #4d2177; color: white; padding: 1.5rem; border-radius: 8px; }
          pre { background: #f4f4f4; padding: 1rem; border-radius: 4px; overflow-x: auto; font-size: 13px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h2 style="margin:0;">✅ OSM OAuth Handshake Succeeded!</h2>
          <p style="margin:5px 0 0; opacity:0.9;">Successfully retrieved token and connected to leader account.</p>
        </div>
        <h3>Sections / Roles Available in this Account:</h3>
        <pre>${JSON.stringify(userData, null, 2)}</pre>
      </body>
      </html>
    `);

  } catch (err) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send('<h3>OAuth Error</h3><pre>' + (err.stack || err.message) + '</pre>');
  }
};
