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

async function findInventoryItem(row) {
  const sku = String(row.sku || '').trim();
  const productName = String(row.productName || '').trim();

  if (sku) {
    const bySku = await queryOne('Item', `Sku = '${escapeQboValue(sku)}'`);
    if (bySku) {
      return bySku;
    }

    // Items may have been created with Name = SKU.
    const byNameSku = await queryOne('Item', `Name = '${escapeQboValue(sku)}'`);
    if (byNameSku) {
      return byNameSku;
    }
  }

  // Older uploads used product name as Item.Name with no Sku field.
  if (productName) {
    const byProductName = await queryOne('Item', `Name = '${escapeQboValue(productName)}'`);
    if (byProductName) {
      return byProductName;
    }
  }

  return null;
}

async function refetchItem(itemId) {
  return queryOne('Item', `Id = '${escapeQboValue(String(itemId))}'`);
}

async function createInventoryItem(row, accounts, inventoryStartDate) {
  // US QuickBooks: Taxable=false is the supported way to mark inventory non-taxable.
  // Do not send SalesTaxCodeRef: "NON" — that causes ValidationFault 2090 Invalid Number.
  // Do not send TaxClassificationRef — that is locale-specific and breaks US sandbox.
  const asOfDate =
    inventoryStartDate ||
    `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}-01`;

  const sku = String(row.sku).trim();
  const productName = String(row.productName || sku).trim();

  const payload = {
    // Put sheet SKU on the item itself (Name + Sku) so bill Product/Service shows the SKU.
    Name: sku,
    Sku: sku,
    Description: productName,
    PurchaseDesc: productName,
    Type: 'Inventory',
    Taxable: false,
    IncomeAccountRef: { value: String(accounts.incomeAccount.Id) },
    ExpenseAccountRef: { value: String(accounts.expenseAccount.Id) },
    AssetAccountRef: { value: String(accounts.assetAccount.Id) },
    TrackQtyOnHand: true,
    // Always create with zero opening stock; bill lines will receive qty later.
    QtyOnHand: 0,
    InvStartDate: asOfDate,
    UnitPrice: Number(row.unitPrice) || 0,
    PurchaseCost: Number(row.cost) || 0,
  };

  const response = await qboRequest('POST', '/item', payload);
  return response.Item;
}

async function sparseUpdateItem(item, fields) {
  const response = await qboRequest('POST', `/item?operation=update`, {
    Id: item.Id,
    SyncToken: item.SyncToken,
    sparse: true,
    ...fields,
  });

  if (response?.Item?.Id) {
    return response.Item;
  }

  // Sparse update can return incomplete bodies; always re-read for a fresh SyncToken.
  const refreshed = await refetchItem(item.Id);
  return refreshed || { ...item, ...fields };
}

async function ensureItemHasSku(item, sku, productName) {
  const wantedSku = String(sku || '').trim();
  const wantedName = String(productName || wantedSku).trim();
  const currentSku = String(item.Sku || '').trim();
  const currentDesc = String(item.Description || '').trim();
  const currentPurchaseDesc = String(item.PurchaseDesc || '').trim();

  const fields = {};
  if (wantedSku && currentSku !== wantedSku) {
    fields.Sku = wantedSku;
  }
  if (wantedName && !currentDesc) {
    fields.Description = wantedName;
  }
  if (wantedName && !currentPurchaseDesc) {
    fields.PurchaseDesc = wantedName;
  }

  if (!Object.keys(fields).length) {
    return { item, updated: false };
  }

  const updatedItem = await sparseUpdateItem(item, fields);
  return { item: updatedItem, updated: true };
}

async function ensureItemIsNonTaxable(item) {
  if (item.Taxable === false) {
    return { item, updated: false };
  }

  const updatedItem = await sparseUpdateItem(item, { Taxable: false });
  return { item: updatedItem, updated: true };
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

    const existing = await findInventoryItem(row);
    if (existing) {
      let item = existing;

      const taxResult = await ensureItemIsNonTaxable(item);
      item = taxResult.item;

      const skuResult = await ensureItemHasSku(item, row.sku, row.productName);
      item = skuResult.item;

      itemMap.set(row.sku, item);
      reusedItems.push({
        sku: row.sku,
        itemId: item.Id,
        name: item.Name,
        itemSku: item.Sku || row.sku,
        taxable: false,
        taxUpdated: taxResult.updated,
        skuUpdated: skuResult.updated,
      });
      if (taxResult.updated) {
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
      itemSku: created.Sku || row.sku,
      taxable: false,
    });
  }

  return {
    itemMap,
    createdItems,
    reusedItems,
    updatedTaxItems,
    nonTaxableCode,
    accounts,
  };
}

function buildBillPayload(parsedFile, vendorId, itemMap, nonTaxableCode) {
  // Use Product/Service (item) lines — not Category/account lines.
  const lineItems = parsedFile.rows.map((row) => {
    const item = itemMap.get(row.sku);
    if (!item?.Id) {
      throw new Error(`Missing QuickBooks item for SKU ${row.sku}`);
    }

    const detail = {
      // ItemRef points at the inventory item that carries the sheet SKU.
      ItemRef: {
        value: String(item.Id),
        name: String(item.Name || row.sku),
      },
      Qty: row.quantity,
      UnitPrice: row.cost,
      BillableStatus: 'NotBillable',
    };

    if (nonTaxableCode?.Id && /^\d+$/.test(String(nonTaxableCode.Id))) {
      detail.TaxCodeRef = { value: String(nonTaxableCode.Id) };
    }

    return {
      Amount: row.amount,
      // Keep SKU visible on the bill line description as well.
      Description: `${row.sku} | ${row.productName || ''}`.trim(),
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

async function findBillByDocNumber(docNumber) {
  if (!docNumber) {
    return null;
  }

  return queryOne('Bill', `DocNumber = '${escapeQboValue(docNumber)}'`);
}

async function assertInvoiceNumberIsUnique(ref) {
  const invoiceNumber = String(ref || '').trim();
  if (!invoiceNumber) {
    const error = new Error('Invoice number (Ref #) is required and must be unique.');
    error.errors = ['Missing Ref # / invoice number in the sheet header.'];
    throw error;
  }

  const existing = await findBillByDocNumber(invoiceNumber);
  if (existing) {
    const error = new Error(
      `Invoice number "${invoiceNumber}" already exists in QuickBooks (Bill Id ${existing.Id}). Do not upload the same invoice again.`
    );
    error.errors = [
      `Duplicate invoice number: ${invoiceNumber}`,
      `Existing Bill Id: ${existing.Id}`,
      `Existing Bill Date: ${existing.TxnDate || '-'}`,
      `Existing Bill Total: ${existing.TotalAmt ?? '-'}`,
    ];
    throw error;
  }

  return invoiceNumber;
}

async function createBillFromParsedFile(parsedFile) {
  await assertInvoiceNumberIsUnique(parsedFile.header.ref);

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
