/**
 * Create an Inventory item in QuickBooks Online sandbox with dummy data.
 *
 * Prereq: authorize once via `npm start` -> http://localhost:3000/connect
 */

const { qboRequest } = require('./qboClient');

async function query(entity, whereClause, maxresults = 10) {
  const q = encodeURIComponent(
    `select * from ${entity}${whereClause ? ` where ${whereClause}` : ''} maxresults ${maxresults}`
  );
  const data = await qboRequest('GET', `/query?query=${q}`);
  const rows = data?.QueryResponse?.[entity];

  if (!rows) {
    return [];
  }

  return Array.isArray(rows) ? rows : [rows];
}

async function queryOne(entity, whereClause) {
  const rows = await query(entity, whereClause, 1);
  return rows[0] || null;
}

async function findIncomeAccount() {
  const account =
    (await queryOne('Account', "AccountSubType = 'SalesOfProductIncome' and Active = true")) ||
    (await queryOne('Account', "AccountType = 'Income' and Active = true"));

  if (!account) {
    throw new Error('No active income account found in sandbox company');
  }

  console.log(`Using income account Id=${account.Id} (${account.Name})`);
  return account;
}

async function findExpenseAccount() {
  const account =
    (await queryOne('Account', "AccountSubType = 'SuppliesMaterialsCogs' and Active = true")) ||
    (await queryOne('Account', "AccountType = 'Cost of Goods Sold' and Active = true")) ||
    (await queryOne('Account', "AccountType = 'Expense' and Active = true"));

  if (!account) {
    throw new Error('No active expense/COGS account found in sandbox company');
  }

  console.log(`Using expense account Id=${account.Id} (${account.Name})`);
  return account;
}

async function findAssetAccount() {
  const account =
    (await queryOne('Account', "AccountSubType = 'Inventory' and Active = true")) ||
    (await queryOne('Account', "AccountType = 'Other Current Asset' and Active = true"));

  if (!account) {
    throw new Error('No active inventory asset account found in sandbox company');
  }

  console.log(`Using asset account Id=${account.Id} (${account.Name})`);
  return account;
}

async function findExistingItem(name) {
  return queryOne('Item', `Name = '${name.replace(/'/g, "\\'")}'`);
}

function buildDummyInventoryItem({ incomeAccountId, expenseAccountId, assetAccountId }) {
  const suffix = Date.now().toString().slice(-6);
  const today = new Date().toISOString().slice(0, 10);

  return {
    Name: `RND Inventory ${suffix}`,
    Type: 'Inventory',
    IncomeAccountRef: { value: String(incomeAccountId) },
    ExpenseAccountRef: { value: String(expenseAccountId) },
    AssetAccountRef: { value: String(assetAccountId) },
    TrackQtyOnHand: true,
    QtyOnHand: 25,
    InvStartDate: today,
    UnitPrice: 299.99,
    PurchaseCost: 180.0,
    Description: 'Dummy sandbox inventory item created via API',
  };
}

async function main() {
  console.log('Creating sandbox inventory item with dummy data...');

  const [incomeAccount, expenseAccount, assetAccount] = await Promise.all([
    findIncomeAccount(),
    findExpenseAccount(),
    findAssetAccount(),
  ]);

  const payload = buildDummyInventoryItem({
    incomeAccountId: incomeAccount.Id,
    expenseAccountId: expenseAccount.Id,
    assetAccountId: assetAccount.Id,
  });

  const existing = await findExistingItem(payload.Name);
  if (existing) {
    console.log(`Inventory item already exists: Id=${existing.Id} Name=${existing.Name}`);
    console.log(JSON.stringify(existing, null, 2));
    return;
  }

  console.log('Inventory payload:', JSON.stringify(payload, null, 2));

  const result = await qboRequest('POST', '/item', payload);
  const item = result.Item;

  console.log('\nInventory item created successfully in sandbox:');
  console.log(`  Id:          ${item.Id}`);
  console.log(`  Name:        ${item.Name}`);
  console.log(`  Type:        ${item.Type}`);
  console.log(`  QtyOnHand:   ${item.QtyOnHand}`);
  console.log(`  UnitPrice:   ${item.UnitPrice}`);
  console.log(`  PurchaseCost:${item.PurchaseCost}`);
  console.log('\nFull response:', JSON.stringify(item, null, 2));
}

main().catch((err) => {
  console.error('\nFailed to create inventory item:');
  console.error(
    err.detail ||
      err.error_description ||
      JSON.stringify(err.fault || err.authResponse?.json || err.authResponse?.body || err, null, 2) ||
      err.message
  );
  process.exit(1);
});
