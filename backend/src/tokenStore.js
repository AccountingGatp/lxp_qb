const mongoose = require('mongoose');
const { connectMongo } = require('./db');

const TOKEN_DOC_ID = 'qbo_sandbox_tokens';

const qboTokenSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    access_token: { type: String, required: true },
    refresh_token: { type: String, required: true },
    token_type: { type: String, default: 'bearer' },
    expires_in: { type: Number },
    x_refresh_token_expires_in: { type: Number },
    realmId: { type: String, required: true },
    created_at: { type: String },
    updated_at: { type: String },
  },
  {
    collection: 'qbo_tokens',
    versionKey: false,
  }
);

const QboToken =
  mongoose.models.QboToken || mongoose.model('QboToken', qboTokenSchema);

async function saveTokens(token) {
  await connectMongo();

  const payload = {
    _id: TOKEN_DOC_ID,
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    token_type: token.token_type || 'bearer',
    expires_in: token.expires_in,
    x_refresh_token_expires_in: token.x_refresh_token_expires_in,
    realmId: token.realmId || token.realm_id,
    created_at: token.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (!payload.realmId) {
    throw new Error('realmId missing from token response');
  }

  await QboToken.findByIdAndUpdate(TOKEN_DOC_ID, payload, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true,
  });

  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    token_type: payload.token_type,
    expires_in: payload.expires_in,
    x_refresh_token_expires_in: payload.x_refresh_token_expires_in,
    realmId: payload.realmId,
    created_at: payload.created_at,
    updated_at: payload.updated_at,
  };
}

async function loadTokens() {
  await connectMongo();

  const doc = await QboToken.findById(TOKEN_DOC_ID).lean();
  if (!doc) {
    return null;
  }

  return {
    access_token: doc.access_token,
    refresh_token: doc.refresh_token,
    token_type: doc.token_type || 'bearer',
    expires_in: doc.expires_in,
    x_refresh_token_expires_in: doc.x_refresh_token_expires_in,
    realmId: doc.realmId,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  };
}

module.exports = {
  saveTokens,
  loadTokens,
};
