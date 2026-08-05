const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env') });

const config = {
  port: Number(process.env.PORT || 3000),
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:4000',
  qboClientId: process.env.QBO_CLIENT_ID,
  qboClientSecret: process.env.QBO_CLIENT_SECRET,
  qboRedirectUri: process.env.QBO_REDIRECT_URI || 'http://localhost:3000/auth/callback',
  qboEnvironment: (process.env.QBO_ENVIRONMENT || 'sandbox').toLowerCase(),
  tokenStorePath: path.join(__dirname, '../tokens.json'),
};

function assertQuickBooksConfig() {
  if (!config.qboClientId || !config.qboClientSecret) {
    throw new Error('Missing QBO_CLIENT_ID or QBO_CLIENT_SECRET in backend/.env');
  }
}

module.exports = {
  config,
  assertQuickBooksConfig,
};
