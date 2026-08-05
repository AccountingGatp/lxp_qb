const { createOAuthClient, getApiBaseUrl } = require('./config');
const { loadTokens, saveTokens } = require('./tokenStore');

async function getAuthorizedClient() {
  const stored = loadTokens();
  if (!stored) {
    throw new Error(
      'No saved tokens. Run `npm start`, open http://localhost:3000/connect, then authorize the sandbox company.'
    );
  }

  const oauthClient = createOAuthClient();
  let activeToken = {
    access_token: stored.access_token,
    refresh_token: stored.refresh_token,
    token_type: stored.token_type || 'bearer',
    expires_in: stored.expires_in,
    x_refresh_token_expires_in: stored.x_refresh_token_expires_in,
    realmId: stored.realmId,
  };
  oauthClient.setToken(activeToken);

  if (!oauthClient.isAccessTokenValid()) {
    const refreshResponse = await oauthClient.refreshUsingToken(stored.refresh_token);
    const refreshed = refreshResponse.getJson();
    const saved = saveTokens({ ...refreshed, realmId: refreshed.realmId || stored.realmId });
    activeToken = {
      access_token: saved.access_token,
      refresh_token: saved.refresh_token,
      token_type: saved.token_type || 'bearer',
      expires_in: saved.expires_in,
      x_refresh_token_expires_in: saved.x_refresh_token_expires_in,
      realmId: saved.realmId,
    };
    oauthClient.setToken(activeToken);
  }

  return { oauthClient, realmId: activeToken.realmId };
}

async function qboRequest(method, path, body) {
  const { oauthClient, realmId } = await getAuthorizedClient();
  const url = `${getApiBaseUrl()}v3/company/${realmId}${path}`;

  const response = await oauthClient.makeApiCall({
    url,
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body,
  });

  return response.json ?? response.data ?? JSON.parse(response.body);
}

module.exports = { getAuthorizedClient, qboRequest };
