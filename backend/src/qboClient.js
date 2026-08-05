const OAuthClient = require('intuit-oauth');
const { config, assertQuickBooksConfig } = require('./config');
const { loadTokens, saveTokens } = require('./tokenStore');

assertQuickBooksConfig();

function createOAuthClient() {
  return new OAuthClient({
    clientId: config.qboClientId,
    clientSecret: config.qboClientSecret,
    environment: config.qboEnvironment,
    redirectUri: config.qboRedirectUri,
  });
}

function getApiBaseUrl() {
  return config.qboEnvironment === 'production'
    ? OAuthClient.environment.production
    : OAuthClient.environment.sandbox;
}

function formatQboError(error) {
  const faultDetail = error?.fault?.errors?.[0]?.detail;
  const faultMessage = error?.fault?.errors?.[0]?.message;
  const description = error?.description || error?.error_description;
  const code = error?.code || error?.errorcode;

  if (String(code) === '401') {
    const err = new Error(
      'QuickBooks authorization expired (401). Open http://localhost:3000/auth/connect and reconnect the sandbox company.'
    );
    err.code = '401';
    err.fault = error.fault || null;
    return err;
  }

  const message = faultDetail || faultMessage || description || error?.message || 'QuickBooks API error';
  const err = new Error(message);
  err.code = code;
  err.detail = faultDetail || description;
  err.fault = error.fault || null;
  return err;
}

async function getAuthorizedClient({ forceRefresh = false } = {}) {
  const stored = loadTokens();
  if (!stored) {
    throw new Error(
      'No saved tokens. Open http://localhost:3000/auth/connect and authorize a sandbox company.'
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

  const needsRefresh = forceRefresh || !oauthClient.isAccessTokenValid();
  if (needsRefresh) {
    try {
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
    } catch (refreshError) {
      throw formatQboError(refreshError);
    }
  }

  return { oauthClient, realmId: activeToken.realmId };
}

async function qboRequest(method, path, body, { retried = false } = {}) {
  const { oauthClient, realmId } = await getAuthorizedClient();
  const url = `${getApiBaseUrl()}v3/company/${realmId}${path}`;

  try {
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
  } catch (error) {
    if (!retried && String(error.code) === '401') {
      await getAuthorizedClient({ forceRefresh: true });
      return qboRequest(method, path, body, { retried: true });
    }

    throw formatQboError(error);
  }
}

module.exports = {
  createOAuthClient,
  getAuthorizedClient,
  qboRequest,
};
