const express = require('express');
const { createOAuthClient, redirectUri, environment } = require('./config');
const { saveTokens } = require('./tokenStore');

const ACCOUNTING_SCOPE = 'com.intuit.quickbooks.accounting';
const app = express();
const PORT = 3000;

app.get('/', (_req, res) => {
  res.type('html').send(`
    <h1>QBO Sandbox R&amp;D</h1>
    <p>Environment: <strong>${environment}</strong></p>
    <ol>
      <li><a href="/connect">Connect to QuickBooks Sandbox</a></li>
      <li>After auth, run: <code>npm run create-bill</code></li>
    </ol>
    <p>Redirect URI must match Intuit app settings: <code>${redirectUri}</code></p>
  `);
});

app.get('/connect', (_req, res) => {
  const oauthClient = createOAuthClient();
  const authUri = oauthClient.authorizeUri({
    scope: [ACCOUNTING_SCOPE],
    state: 'qbo-rnd',
  });
  res.redirect(authUri);
});

app.get('/callback', async (req, res) => {
  try {
    const oauthClient = createOAuthClient();
    const authResponse = await oauthClient.createToken(req.url);
    const token = authResponse.getToken();
    const realmId = req.query.realmId || token.realmId;

    saveTokens({ ...token, realmId });

    res.type('html').send(`
      <h1>Connected</h1>
      <p>Sandbox company realmId: <code>${realmId}</code></p>
      <p>Tokens saved. In another terminal run:</p>
      <pre>npm run create-bill</pre>
      <p><a href="/">Home</a></p>
    `);
  } catch (err) {
    console.error(err);
    res.status(500).send(`OAuth failed: ${err.message}`);
  }
});

app.listen(PORT, () => {
  console.log(`QBO R&D server listening on http://localhost:${PORT}`);
  console.log(`1) Open http://localhost:${PORT}/connect`);
  console.log(`2) Authorize a sandbox company`);
  console.log(`3) Run: npm run create-bill`);
});
