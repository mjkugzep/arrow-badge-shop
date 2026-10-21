module.exports = async (req, res) => {
  const { code } = req.query;
  const clientId = 'n02R5IdYlrnRUvByY9JCbIqB9L04hedI';
  const clientSecret = 'HDbm5uCLTpU7ZmiIugNu6ianB3cnal78wpXJ4BP1QrrgFcexHBb0nIl3pwrm1Wks';
  const appUrl = process.env.APP_URL || 'https://arrow-badge-shop.vercel.app';
  const redirectUri = `${appUrl}/api/auth/callback`;

  if (!code) {
    return res.status(400).send('Authorization code missing from OSM redirect.');
  }

  try {
    // 1. Exchange the code for an Access Token
    const tokenRes = await fetch('https://www.onlinescoutmanager.co.uk/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code: code
      }).toString()
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return res.status(400).send('Failed to obtain token from OSM: ' + JSON.stringify(tokenData));
    }

    const accessToken = tokenData.access_token;

    // 2. Fetch the user's roles / sections
    const userRes = await fetch('https://www.onlinescoutmanager.co.uk/api.php?action=getUserRoles', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const userData = await userRes.json();

    // Store token in an encrypted/session cookie or redirect back to checkout with token
    res.writeHead(302, {
      'Set-Cookie': `osm_token=${accessToken}; Path=/; HttpOnly; Secure; SameSite=Lax`,
      'Location': `/api/order?source=oauth`
    });
    res.end();

  } catch (err) {
    res.status(500).send('OAuth Error: ' + err.message);
  }
};
