/**
 * Fetch all Bills from QuickBooks Online sandbox and print to console.
 *
 * Prereq: authorize once via `npm start` → http://localhost:3000/connect
 */

const { qboRequest } = require('./qboClient');

async function fetchAllBills() {
  const bills = [];
  let startPosition = 1;
  const pageSize = 100;

  while (true) {
    const q = encodeURIComponent(
      `select * from Bill startposition ${startPosition} maxresults ${pageSize}`
    );
    const data = await qboRequest('GET', `/query?query=${q}`);
    const page = data?.QueryResponse?.Bill || [];
    const batch = Array.isArray(page) ? page : [page];

    if (!batch.length) break;

    bills.push(...batch);

    if (batch.length < pageSize) break;
    startPosition += pageSize;
  }

  return bills;
}

async function main() {
  console.log('Fetching all bills from sandbox...\n');

  const bills = await fetchAllBills();

  if (!bills.length) {
    console.log('No bills found.');
    return;
  }

  console.log(`Found ${bills.length} bill(s):\n`);

  bills.forEach((bill, i) => {
    console.log(
      `${i + 1}. Id=${bill.Id}  DocNumber=${bill.DocNumber || '-'}  ` +
        `Vendor=${bill.VendorRef?.name || bill.VendorRef?.value || '-'}  ` +
        `TotalAmt=${bill.TotalAmt}  TxnDate=${bill.TxnDate}  Balance=${bill.Balance}`
    );
  });

  console.log('\n--- Full JSON ---\n');
  console.log(JSON.stringify(bills, null, 2));
}

main().catch((err) => {
  console.error('\nFailed to fetch bills:');
  console.error(err.authResponse?.json || err.authResponse?.body || err.message || err);
  process.exit(1);
});
