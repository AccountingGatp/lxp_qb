/**
 * Fetch all Inventory items from QuickBooks Online sandbox and print to console.
 *
 * Prereq: authorize once via `npm start` → http://localhost:3000/connect
 */

const { qboRequest } = require('./qboClient');

async function fetchAllInventory() {
  const items = [];
  let startPosition = 1;
  const pageSize = 100;

  while (true) {
    const q = encodeURIComponent(
      `select * from Item where Type = 'Inventory' startposition ${startPosition} maxresults ${pageSize}`
    );
    const data = await qboRequest('GET', `/query?query=${q}`);
    const page = data?.QueryResponse?.Item || [];
    const batch = Array.isArray(page) ? page : [page];

    if (!batch.length) break;

    items.push(...batch);

    if (batch.length < pageSize) break;
    startPosition += pageSize;
  }

  return items;
}

async function main() {
  console.log('Fetching all inventory items from sandbox...\n');

  const items = await fetchAllInventory();

  if (!items.length) {
    console.log('No inventory items found.');
    return;
  }

  console.log(`Found ${items.length} inventory item(s):\n`);

  items.forEach((item, i) => {
    console.log(
      `${i + 1}. Id=${item.Id}  Name=${item.Name}  ` +
        `QtyOnHand=${item.QtyOnHand ?? '-'}  ` +
        `UnitPrice=${item.UnitPrice ?? '-'}  ` +
        `PurchaseCost=${item.PurchaseCost ?? '-'}  ` +
        `Active=${item.Active}`
    );
  });

  console.log('\n--- Full JSON ---\n');
  console.log(JSON.stringify(items, null, 2));
}

main().catch((err) => {
  console.error('\nFailed to fetch inventory:');
  console.error(
    err.detail ||
      err.error_description ||
      JSON.stringify(err.fault || err.authResponse?.json || err.authResponse?.body || err, null, 2) ||
      err.message
  );
  process.exit(1);
});
