const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { config, isB2Configured } = require('./config');
const { createOAuthClient } = require('./qboClient');
const { saveTokens, loadTokens } = require('./tokenStore');
const { parseWorkbook, SheetValidationError } = require('./services/xlsxParser');
const { createBillFromParsedFile } = require('./services/qboSyncService');
const {
  createPresignedUpload,
  downloadObject,
  deleteObject,
} = require('./services/b2Storage');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.b2.maxFileBytes },
});

const app = express();

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json());

function sendUploadError(res, req, error) {
  const details =
    error.detail ||
    error.error_description ||
    error.message ||
    'Unexpected upload processing error.';

  console.error('Upload failed:', details, error.fault || '');

  const isValidation = error instanceof SheetValidationError || error.name === 'SheetValidationError';
  const status =
    String(error.code) === '401'
      ? 401
      : error.statusCode || (isValidation ? 400 : 500);

  return res.status(status).json({
    ok: false,
    error: details,
    errors: error.errors || null,
    fault: error.fault || null,
    reconnectUrl:
      String(error.code) === '401'
        ? `${req.protocol}://${req.get('host')}/auth/connect`
        : undefined,
  });
}

async function requireQboConnection(req, res) {
  const tokens = await loadTokens();
  if (!tokens) {
    res.status(401).json({
      ok: false,
      error: 'Connect QuickBooks before uploading a file.',
      reconnectUrl: `${req.protocol}://${req.get('host')}/auth/connect`,
    });
    return null;
  }

  return tokens;
}

async function processWorkbookBuffer(buffer, fileName) {
  const parsed = parseWorkbook(buffer);
  const result = await createBillFromParsedFile(parsed);

  return {
    ok: true,
    fileName,
    parsed: {
      sheetName: parsed.sheetName,
      header: parsed.header,
      rows: parsed.rows,
      warnings: parsed.warnings,
    },
    sync: result,
  };
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'qbo-upload-backend',
    environment: config.qboEnvironment,
    b2: isB2Configured(),
  });
});

app.get('/auth/status', async (_req, res) => {
  try {
    const tokens = await loadTokens();
    res.json({
      connected: Boolean(tokens),
      realmId: tokens?.realmId || null,
      environment: config.qboEnvironment,
    });
  } catch (error) {
    res.status(500).json({
      connected: false,
      realmId: null,
      environment: config.qboEnvironment,
      error: error.message,
    });
  }
});

app.get('/auth/connect', (_req, res) => {
  const oauthClient = createOAuthClient();
  const authUri = oauthClient.authorizeUri({
    scope: ['com.intuit.quickbooks.accounting'],
    state: 'xlsx-upload-app',
  });
  res.redirect(authUri);
});

app.get('/auth/callback', async (req, res) => {
  try {
    const oauthClient = createOAuthClient();
    const authResponse = await oauthClient.createToken(req.url);
    const token = authResponse.getToken();
    const realmId = req.query.realmId || token.realmId;

    await saveTokens({ ...token, realmId });

    const redirectTo = new URL(config.frontendOrigin);
    redirectTo.searchParams.set('connected', '1');
    redirectTo.searchParams.set('realmId', String(realmId || ''));
    return res.redirect(redirectTo.toString());
  } catch (error) {
    const redirectTo = new URL(config.frontendOrigin);
    redirectTo.searchParams.set('connected', '0');
    redirectTo.searchParams.set('error', error.message || 'OAuth failed');
    return res.redirect(redirectTo.toString());
  }
});

app.post('/api/uploads/b2/presign', async (req, res) => {
  try {
    const tokens = await requireQboConnection(req, res);
    if (!tokens) {
      return;
    }

    if (!isB2Configured()) {
      return res.status(501).json({
        ok: false,
        error:
          'Backblaze B2 is not configured. Set B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET, and B2_ENDPOINT.',
      });
    }

    const { fileName, contentType, fileSize } = req.body || {};
    if (!fileName) {
      return res.status(400).json({ ok: false, error: 'fileName is required.' });
    }

    const signed = await createPresignedUpload({ fileName, contentType, fileSize });
    return res.json({ ok: true, ...signed });
  } catch (error) {
    return sendUploadError(res, req, error);
  }
});

app.post('/api/uploads/xlsx', (req, res, next) => {
  if (req.is('multipart/form-data')) {
    return upload.single('file')(req, res, next);
  }
  return next();
}, async (req, res) => {
  let b2Key = null;

  try {
    const tokens = await requireQboConnection(req, res);
    if (!tokens) {
      return;
    }

    let buffer;
    let fileName;

    if (req.file) {
      buffer = req.file.buffer;
      fileName = req.file.originalname;
    } else if (req.body?.key) {
      b2Key = req.body.key;
      fileName = req.body.fileName || 'upload.xlsx';
      buffer = await downloadObject(b2Key);
    } else {
      return res.status(400).json({
        error: isB2Configured()
          ? 'Upload the spreadsheet to Backblaze first, then send the file key.'
          : 'Please upload an XLSX file in the `file` field.',
      });
    }

    const payload = await processWorkbookBuffer(buffer, fileName);
    return res.json(payload);
  } catch (error) {
    return sendUploadError(res, req, error);
  } finally {
    if (b2Key) {
      await deleteObject(b2Key);
    }
  }
});

module.exports = { app };
