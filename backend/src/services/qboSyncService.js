const { qboRequest } = require('../qboClient');

function escapeQboValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function queryQbo(entity, whereClause, maxresults = 100) {
  const query = `select * from ${entity}${whereClause ? ` where ${whereClause}` : ''} maxresults ${maxresults}`;
  const encoded = encodeURIComponent(query);
  const data = await qboRequest('GET', `/query?query=${encoded}`);
  const rows = data?.QueryResponse?.[entity];

  if (!rows) {
    return [];
  }

  return Array.isArray(rows) ? rows : [rows];
}

async function queryOne(entity, whereClause) {
  const rows = await queryQbo(entity, whereClause, 1);
  return rows[0] || null;
}

async function findOrCreateVendor(displayName) {
  const safeName = displayName || 'Uploaded XLSX Vendor';
  const existing = await queryOne('Vendor', `DisplayName = '${escapeQboValue(safeName)}'`);
  if (existing) {
    return { vendor: existing, created: false };
  }

  const created = await qboRequest('POST', '/vendor', {
    DisplayName: safeName,
    CompanyName: safeName,
  });

  return { vendor: created.Vendor, created: true };
}

async function findAccount(whereClauses) {
  for (const clause of whereClauses) {
    const account = await queryOne('Account', clause);
    if (account) {
      return account;
    }
  }

  return null;
}

async function getRequiredAccounts() {
  const incomeAccount = await findAccount([
    "AccountSubType = 'SalesOfProductIncome' and Active = true",
    "AccountType = 'Income' and Active = true",
  ]);
  const expenseAccount = await findAccount([
    "AccountSubType = 'SuppliesMaterialsCogs' and Active = true",
    "AccountType = 'Cost of Goods Sold' and Active = true",
    "AccountType = 'Expense' and Active = true",
  ]);
  const assetAccount = await findAccount([
    "AccountSubType = 'Inventory' and Active = true",
    "AccountType = 'Other Current Asset' and Active = true",
  ]);

  if (!incomeAccount || !expenseAccount || !assetAccount) {
    throw new Error('Missing one or more required QBO accounts (income, expense/COGS, inventory asset).');
  }

  return { incomeAccount, expenseAccount, assetAccount };
}

async function getNonTaxableCode() {
  try {
    const codes = await queryQbo('TaxCode', 'Active = true', 100);
    const match = codes.find((code) => {
      const name = String(code.Name || '').toUpperCase().replace(/[\s_-]/g, '');
      return name === 'NON' || name === 'NONTAX' || name.includes('NONTAX');
    });

    // Only return a real company tax-code Id. Never send the literal "NON"
    // string as a Ref value — US QBO expects a numeric Id (or no TaxCodeRef).
    if (match?.Id && /^\d+$/.test(String(match.Id))) {
      return match;
    }

    return null;
  } catch (_error) {
    // US companies without tax codes (or TaxCode query unsupported) are fine.
    return null;
  }
}

async function findInventoryItemBySku(sku) {
  const bySku = await queryOne('Item', `Sku = '${escapeQboValue(sku)}'`);
  if (bySku) {
    return bySku;
  }

  // Fallback: older items may have been created with Name = SKU.
  return queryOne('Item', `Name = '${escapeQboValue(sku)}'`);
}

async function createInventoryItem(row, accounts, inventoryStartDate) {
  // US QuickBooks: Taxable=false is the supported way to mark inventory non-taxable.
  // Do not send SalesTaxCodeRef: "NON" — that causes ValidationFault 2090 Invalid Number.
  const payload = {
    Name: row.productName || row.sku,
    Sku: row.sku,
    Type: 'Inventory',
    Taxable: false,
    IncomeAccountRef: { value: String(accounts.incomeAccount.Id) },
    ExpenseAccountRef: { value: String(accounts.expenseAccount.Id) },
    AssetAccountRef: { value: String(accounts.assetAccount.Id) },
    TrackQtyOnHand: true,
    QtyOnHand: row.quantity,
    InvStartDate: inventoryStartDate,
    "TaxClassificationRef": {
      "value": "EUC-99990101-V1-00020000"
   }
 
    // UnitPrice: 0,
    // PurchaseCost: 0,
  };

  const response = await qboRequest('POST', '/item', payload);
  return response.Item;
}

async function ensureItemIsNonTaxable(item) {
  if (item.Taxable === false) {
    return { item, updated: false };
  }

  const response = await qboRequest('POST', `/item?operation=update`, {
    Id: item.Id,
    SyncToken: item.SyncToken,
    sparse: true,
    Taxable: false,
  });

  return { item: response.Item || item, updated: true };
}

async function ensureInventoryItems(rows, inventoryStartDate) {
  const accounts = await getRequiredAccounts();
  const nonTaxableCode = await getNonTaxableCode();
  const createdItems = [];
  const reusedItems = [];
  const updatedTaxItems = [];
  const itemMap = new Map();

  for (const row of rows) {
    if (itemMap.has(row.sku)) {
      continue;
    }

    const existing = await findInventoryItemBySku(row.sku);
    if (existing) {
      const { item, updated } = await ensureItemIsNonTaxable(existing);
      itemMap.set(row.sku, item);
      reusedItems.push({
        sku: row.sku,
        itemId: item.Id,
        name: item.Name,
        taxable: false,
        taxUpdated: updated,
      });
      if (updated) {
        updatedTaxItems.push({ sku: row.sku, itemId: item.Id });
      }
      continue;
    }

    const created = await createInventoryItem(row, accounts, inventoryStartDate);
    itemMap.set(row.sku, created);
    createdItems.push({
      sku: row.sku,
      itemId: created.Id,
      name: created.Name,
      taxable: false,
    });
  }

  return {
    itemMap,
    createdItems,
    reusedItems,
    updatedTaxItems,
    nonTaxableCode,
  };
}

function buildBillPayload(parsedFile, vendorId, itemMap, nonTaxableCode) {
  const lineItems = parsedFile.rows.map((row) => {
    const item = itemMap.get(row.sku);
    const detail = {
      ItemRef: { value: String(item.Id) },
      Qty: row.quantity,
      UnitPrice: row.cost,
      BillableStatus: 'NotBillable',
    };

    // Only attach TaxCodeRef when QBO returned a real numeric tax-code Id.
    if (nonTaxableCode?.Id && /^\d+$/.test(String(nonTaxableCode.Id))) {
      detail.TaxCodeRef = { value: String(nonTaxableCode.Id) };
    }

    return {
      Amount: row.amount,
      Description: row.productName || row.sku,
      DetailType: 'ItemBasedExpenseLineDetail',
      ItemBasedExpenseLineDetail: detail,
    };
  });

  const payload = {
    VendorRef: { value: String(vendorId) },
    TxnDate: parsedFile.header.date || new Date().toISOString().slice(0, 10),
    PrivateNote: `Uploaded from worksheet ${parsedFile.sheetName}`,
    Line: lineItems,
  };

  if (parsedFile.header.ref) {
    payload.DocNumber = parsedFile.header.ref;
  }

  return payload;
}

async function createBillFromParsedFile(parsedFile) {
  const { vendor, created: vendorCreated } = await findOrCreateVendor(parsedFile.header.vendor);
  const {
    itemMap,
    createdItems,
    reusedItems,
    updatedTaxItems,
    nonTaxableCode,
  } = await ensureInventoryItems(
    parsedFile.rows,
    parsedFile.header.inventoryStartDate || parsedFile.header.date
  );
  const billPayload = buildBillPayload(parsedFile, vendor.Id, itemMap, nonTaxableCode);
  const billResponse = await qboRequest('POST', '/bill', billPayload);
  const bill = billResponse.Bill;

  return {
    vendor: {
      id: vendor.Id,
      name: vendor.DisplayName || parsedFile.header.vendor,
      created: vendorCreated,
    },
    createdItems,
    reusedItems,
    updatedTaxItems,
    tax: {
      mode: 'non_taxable',
      method: 'Taxable=false',
      taxCode: nonTaxableCode?.Name || null,
    },
    bill: {
      id: bill.Id,
      docNumber: bill.DocNumber,
      totalAmt: bill.TotalAmt,
      txnDate: bill.TxnDate,
    },
    payloadSummary: {
      totalRows: parsedFile.rows.length,
      totalAmount: parsedFile.rows.reduce((sum, row) => sum + row.amount, 0),
    },
  };
}

module.exports = {
  createBillFromParsedFile,
};
