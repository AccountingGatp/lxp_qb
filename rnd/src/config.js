const path = require('path');
const dotenv = require('dotenv');
const OAuthClient = require('intuit-oauth');

dotenv.config({ path: path.join(__dirname, '../config/.env') });

const clientId = process.env.QBO_CLIENT_ID;
const clientSecret = process.env.QBO_CLIENT_SECRET;
const redirectUri = process.env.QBO_REDIRECT_URI || 'http://localhost:3000/callback';
const environment = (process.env.QBO_ENVIRONMENT || 'sandbox').toLowerCase();

if (!clientId || !clientSecret) {
  throw new Error('Missing QBO_CLIENT_ID or QBO_CLIENT_SECRET in config/.env');
}

function createOAuthClient() {
  return new OAuthClient({
    clientId,
    clientSecret,
    environment, // 'sandbox' | 'production'
    redirectUri,
  });
}

function getApiBaseUrl() {
  return environment === 'production'
    ? OAuthClient.environment.production
    : OAuthClient.environment.sandbox;
}

module.exports = {
  clientId,
  clientSecret,
  redirectUri,
  environment,
  createOAuthClient,
  getApiBaseUrl,
  tokenStorePath: path.join(__dirname, '../config/tokens.json'),
};
