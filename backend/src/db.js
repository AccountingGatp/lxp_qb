const mongoose = require('mongoose');
const { config } = require('./config');

let connecting = null;

async function connectMongo() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (!config.mongoUri) {
    throw new Error('Missing MONGODB_URI in backend/.env');
  }

  if (!connecting) {
    connecting = mongoose.connect(config.mongoUri, {
      serverSelectionTimeoutMS: 10000,
    });
  }

  await connecting;
  return mongoose.connection;
}

module.exports = {
  connectMongo,
};
