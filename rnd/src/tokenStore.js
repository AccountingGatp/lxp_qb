const fs = require('fs');
const { tokenStorePath } = require('./config');

function saveTokens(token) {
  const payload = {
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    token_type: token.token_type,
    expires_in: token.expires_in,
    x_refresh_token_expires_in: token.x_refresh_token_expires_in,
    realmId: token.realmId || token.realm_id,
    created_at: new Date().toISOString(),
  };

  if (!payload.realmId) {
    throw new Error('realmId missing from token response');
  }

  fs.writeFileSync(tokenStorePath, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

function loadTokens() {
  if (!fs.existsSync(tokenStorePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(tokenStorePath, 'utf8'));
}

module.exports = { saveTokens, loadTokens };
