module.exports = async (req, res) => {
  const clientId = process.env.OSM_OAUTH_CLIENT_ID || 'M5UYnGYeMrZltUTM6LslWKTKLrrC8FQI';
  const appUrl = process.env.APP_URL || 'https://arrow-badge-shop.vercel.app';
  const redirectUri = encodeURIComponent(`${appUrl}/api/auth/callback`);

  // Redirect the leader directly to OSM's OAuth authorization page
  const osmAuthUrl = `https://www.onlinescoutmanager.co.uk/oauth/authorize?client_id=${clientId}&response_type=code&redirect_uri=${redirectUri}&scope=section:badge:admin`;

  res.writeHead(302, { Location: osmAuthUrl });
  res.end();
};