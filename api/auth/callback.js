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
      const termRes = await fetch('https://www.onlinescoutmanager.co.uk/api.php?action=getTerms', {
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
