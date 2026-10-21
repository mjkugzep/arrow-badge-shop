module.exports = async (req, res) => {
  const clientId = 'M5UYnGYeMrZltUTM6LslWKTKLrrC8FQI';
  const redirectUri = 'https://arrow-badge-shop.vercel.app/api/auth/callback';

  // Construct OSM authorization URL directly
  const osmAuthUrl = 'https://www.onlinescoutmanager.co.uk/oauth/authorize?' +
    'client_id=' + clientId +
    '&response_type=code' +
    '&redirect_uri=' + encodeURIComponent(redirectUri);

  res.writeHead(302, { Location: osmAuthUrl });
  res.end();
};
