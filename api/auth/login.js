module.exports = async (req, res) => {
  const clientId = 'n02R5IdYlrnRUvByY9JCbIqB9L04hedI';
  const redirectUri = 'https://arrow-badge-shop.vercel.app/api/auth/callback';

  const osmAuthUrl = 'https://www.onlinescoutmanager.co.uk/oauth/authorize?' +
    'client_id=' + clientId +
    '&response_type=code' +
    '&redirect_uri=' + encodeURIComponent(redirectUri);

  res.writeHead(302, { Location: osmAuthUrl });
  res.end();
};
