# QuickBooks Online API — R&D

Sandbox scripts for QuickBooks Online. Includes OAuth connect + create bill with dummy data.

## Structure

```
rnd/
├── config/
│   ├── .env              # sandbox credentials (gitignored)
│   ├── .env.example
│   └── tokens.json       # saved after OAuth (gitignored)
├── src/
│   ├── server.js         # OAuth connect on :3000
│   ├── createBill.js     # create dummy bill in sandbox
│   ├── qboClient.js
│   ├── tokenStore.js
│   └── config.js
└── package.json
```

## Setup

1. Put sandbox keys in `config/.env` (already done for this R&D).
2. In [Intuit Developer](https://developer.intuit.com/) app settings, set Redirect URI to:
   `http://localhost:3000/callback`
3. Install deps:

```bash
cd rnd
npm install
```

## Create a dummy bill (sandbox)

```bash
# Terminal 1 — start OAuth server
npm start

# Browser — authorize a sandbox company
# http://localhost:3000/connect

# Terminal 2 — create bill with dummy data
npm run create-bill
```

The script will:

1. Find or create vendor `RND Dummy Vendor`
2. Pick an Expense account from the sandbox company
3. Create a bill (~$175.49) with two dummy line items

## Notes

- Uses **sandbox** only (`QBO_ENVIRONMENT=sandbox`)
- Development credentials do not access live production companies
