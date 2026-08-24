const { randomUUID } = require('crypto');
const {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { config, isB2Configured } = require('../config');

const KEY_PREFIX = 'uploads/';
const ALLOWED_EXTENSIONS = ['.xlsx', '.xls'];

let client;

function getClient() {
  if (!isB2Configured()) {
    throw new Error(
      'Backblaze B2 is not configured. Set B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET, and B2_ENDPOINT.'
    );
  }

  if (!client) {
    client = new S3Client({
      region: config.b2.region,
      endpoint: config.b2.endpoint,
      credentials: {
        accessKeyId: config.b2.keyId,
        secretAccessKey: config.b2.applicationKey,
      },
      // AWS SDK v3 default checksums break Backblaze S3-compatible uploads.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  return client;
}

function getExtension(fileName) {
  const match = String(fileName || '')
    .toLowerCase()
    .match(/\.[a-z0-9]+$/);
  return match ? match[0] : '';
}

function sanitizeFileName(fileName) {
  const base = String(fileName || 'upload.xlsx')
    .split(/[/\\]/)
    .pop();
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  return cleaned || 'upload.xlsx';
}

function assertAllowedSpreadsheet(fileName, contentType, fileSize) {
  const extension = getExtension(fileName);
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    const error = new Error('Only .xlsx or .xls files are allowed.');
    error.statusCode = 400;
    throw error;
  }

  if (fileSize && Number(fileSize) > config.b2.maxFileBytes) {
    const error = new Error(
      `File is too large. Maximum size is ${Math.floor(config.b2.maxFileBytes / (1024 * 1024))} MB.`
    );
    error.statusCode = 400;
    throw error;
  }

  if (
    contentType &&
    contentType !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' &&
    contentType !== 'application/vnd.ms-excel' &&
    contentType !== 'application/octet-stream'
  ) {
    const error = new Error('Unsupported spreadsheet content type.');
    error.statusCode = 400;
    throw error;
  }
}

function assertOwnedKey(key) {
  const value = String(key || '');
  if (!value.startsWith(KEY_PREFIX) || value.includes('..')) {
    const error = new Error('Invalid upload key.');
    error.statusCode = 400;
    throw error;
  }
}

async function createPresignedUpload({ fileName, contentType, fileSize }) {
  assertAllowedSpreadsheet(fileName, contentType, fileSize);

  const safeName = sanitizeFileName(fileName);
  const key = `${KEY_PREFIX}${Date.now()}-${randomUUID()}/${safeName}`;
  const type =
    contentType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  const uploadUrl = await getSignedUrl(
    getClient(),
    new PutObjectCommand({
      Bucket: config.b2.bucket,
      Key: key,
      ContentType: type,
    }),
    { expiresIn: 60 }
  );

  return {
    key,
    uploadUrl,
    contentType: type,
    expiresIn: 60,
  };
}

async function downloadObject(key) {
  assertOwnedKey(key);

  const response = await getClient().send(
    new GetObjectCommand({
      Bucket: config.b2.bucket,
      Key: key,
    })
  );

  const bytes = await response.Body.transformToByteArray();
  return Buffer.from(bytes);
}

async function deleteObject(key) {
  assertOwnedKey(key);

  try {
    await getClient().send(
      new DeleteObjectCommand({
        Bucket: config.b2.bucket,
        Key: key,
      })
    );
  } catch (error) {
    console.error('Failed to delete Backblaze object:', key, error.message);
  }
}

module.exports = {
  isB2Configured,
  createPresignedUpload,
  downloadObject,
  deleteObject,
};
