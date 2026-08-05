/**
 * Create a Bill in QuickBooks Online sandbox with dummy data.
 *
 * Prereq: authorize once via `npm start` → http://localhost:3000/connect
 */

const { qboRequest } = require('./qboClient');

async function queryOne(entity, whereClause) {
  const q = encodeURIComponent(`select * from ${entity} where ${whereClause} maxresults 1`);
  const data = await qboRequest('GET', `/query?query=${q}`);
  const rows = data?.QueryResponse?.[entity];
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function findOrCreateVendor() {
  const existing = await queryOne('Vendor', "DisplayName = 'RND Dummy Vendor'");
  if (existing) {
    console.log(`Using existing vendor Id=${existing.Id}`);
    return existing;
  }

  const created = await qboRequest('POST', '/vendor', {
    DisplayName: 'RND Dummy Vendor',
    CompanyName: 'RND Dummy Vendor LLC',
    PrimaryEmailAddr: { Address: 'dummy.vendor@example.com' },
    BillAddr: {
      Line1: '123 Sandbox Street',
      City: 'Mountain View',
      CountrySubDivisionCode: 'CA',
      PostalCode: '94043',
      Country: 'USA',
    },
  });

  console.log(`Created vendor Id=${created.Vendor.Id}`);
  return created.Vendor;
}

async function findExpenseAccount() {
  // Prefer a typical expense account; fall back to any Expense account
  const preferred = await queryOne(
    'Account',
    "AccountType = 'Expense' and Active = true"
  );
  if (preferred) {
    console.log(`Using expense account Id=${preferred.Id} (${preferred.Name})`);
    return preferred;
  }
  throw new Error('No active Expense account found in sandbox company');
}

function buildDummyBill(vendorId, accountId) {
  const today = new Date();
  const due = new Date(today);
  due.setDate(due.getDate() + 30);

  const fmt = (d) => d.toISOString().slice(0, 10);

  return {
    VendorRef: { value: String(vendorId) },
    TxnDate: fmt(today),
    DueDate: fmt(due),
    PrivateNote: 'RND dummy bill created via API',
    DocNumber: `RND-${Date.now().toString().slice(-6)}`,
    Line: [
      {
        Amount: 125.5,
        DetailType: 'AccountBasedExpenseLineDetail',
        Description: 'Dummy office supplies',
        AccountBasedExpenseLineDetail: {
          AccountRef: { value: String(accountId) },
          BillableStatus: 'NotBillable',
        },
      },
      {
        Amount: 49.99,
        DetailType: 'AccountBasedExpenseLineDetail',
        Description: 'Dummy shipping fee',
        AccountBasedExpenseLineDetail: {
          AccountRef: { value: String(accountId) },
          BillableStatus: 'NotBillable',
        },
      },
    ],
  };
}

async function main() {
  console.log('Creating sandbox bill with dummy data...');

  const vendor = await findOrCreateVendor();
  const account = await findExpenseAccount();
  const billPayload = buildDummyBill(vendor.Id, account.Id);

  console.log('Bill payload:', JSON.stringify(billPayload, null, 2));

  const result = await qboRequest('POST', '/bill', billPayload);
  const bill = result.Bill;

  console.log('\nBill created successfully in sandbox:');
  console.log(`  Id:        ${bill.Id}`);
  console.log(`  DocNumber: ${bill.DocNumber}`);
  console.log(`  Vendor:    ${bill.VendorRef?.name || vendor.DisplayName}`);
  console.log(`  TotalAmt:  ${bill.TotalAmt}`);
  console.log(`  TxnDate:   ${bill.TxnDate}`);
  console.log(`  DueDate:   ${bill.DueDate}`);
  console.log('\nFull response:', JSON.stringify(bill, null, 2));
}

main().catch((err) => {
  console.error('\nFailed to create bill:');
  console.error(err.authResponse?.json || err.authResponse?.body || err.message || err);
  process.exit(1);
});
