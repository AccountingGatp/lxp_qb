const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { config } = require('./config');
const { createOAuthClient } = require('./qboClient');
const { saveTokens, loadTokens } = require('./tokenStore');
const { parseWorkbook } = require('./services/xlsxParser');
const { createBillFromParsedFile } = require('./services/qboSyncService');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const app = express();

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'qbo-upload-backend',
    environment: config.qboEnvironment,
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

app.post('/api/uploads/xlsx', upload.single('file'), async (req, res) => {
  try {
    const tokens = await loadTokens();
    if (!tokens) {
      return res.status(401).json({
        ok: false,
        error: 'Connect QuickBooks before uploading a file.',
        reconnectUrl: `${req.protocol}://${req.get('host')}/auth/connect`,
      });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Please upload an XLSX file in the `file` field.' });
    }

    const parsed = parseWorkbook(req.file.buffer);
    const result = await createBillFromParsedFile(parsed);

    return res.json({
      ok: true,
      fileName: req.file.originalname,
      parsed: {
        sheetName: parsed.sheetName,
        header: parsed.header,
        rows: parsed.rows,
        warnings: parsed.warnings,
      },
      sync: result,
    });
  } catch (error) {
    const details =
      error.detail ||
      error.error_description ||
      error.message ||
      'Unexpected upload processing error.';

    console.error('Upload failed:', details, error.fault || '');

    return res.status(Number(error.code) === 401 ? 401 : 500).json({
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
});

module.exports = { app };
