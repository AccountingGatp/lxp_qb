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
  mongoUri: process.env.MONGODB_URI,
  b2: {
    keyId: process.env.B2_KEY_ID,
    applicationKey: process.env.B2_APPLICATION_KEY || process.env.B2_APP_KEY,
    bucket: process.env.B2_BUCKET,
    region: process.env.B2_REGION || 'us-west-004',
    endpoint: process.env.B2_ENDPOINT || '',
    maxFileBytes: Number(process.env.B2_MAX_FILE_BYTES || 50 * 1024 * 1024),
  },
};

function isB2Configured() {
  return Boolean(
    config.b2.keyId &&
      config.b2.applicationKey &&
      config.b2.bucket &&
      config.b2.endpoint
  );
}

function assertQuickBooksConfig() {
  if (!config.qboClientId || !config.qboClientSecret) {
    throw new Error('Missing QBO_CLIENT_ID or QBO_CLIENT_SECRET in backend/.env');
  }
}

module.exports = {
  config,
  assertQuickBooksConfig,
  isB2Configured,
};
