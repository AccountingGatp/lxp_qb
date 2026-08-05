const XLSX = require('xlsx');

class SheetValidationError extends Error {
  constructor(errors) {
    const list = Array.isArray(errors) ? errors : [errors];
    super(`Invalid input sheet:\n- ${list.join('\n- ')}`);
    this.name = 'SheetValidationError';
    this.errors = list;
  }
}

const EXPECTED_META_LABELS = ['Vendor', 'Date', 'Ref #', 'Invoice Amount'];

const EXPECTED_COLUMNS = [
  'Product Name',
  'SKU #',
  'Manufacturer',
  'Type',
  'Strain',
  'Net Weight',
  'Tier (If Applicable)',
  'Genetics',
  'Type ID',
  'Mfg Date',
  'Days',
  'New Item',
  'Status',
  'Inv Qty',
  'Act. Qty',
  'Cost/Unit',
  'Received Amount',
  'Retail Price/Unit',
  'Retail Value',
];

const COLUMN_KEYS = {
  productname: 'productName',
  'sku#': 'sku',
  sku: 'sku',
  manufacturer: 'manufacturer',
  type: 'type',
  strain: 'strain',
  netweight: 'netWeight',
  'tierifapplicable': 'tier',
  genetics: 'genetics',
  typeid: 'typeId',
  mfgdate: 'mfgDate',
  days: 'days',
  newitem: 'newItem',
  status: 'status',
  invqty: 'qty',
  'act.qty': 'actQty',
  'cost/unit': 'cost',
  receivedamount: 'receivedAmount',
  'retailprice/unit': 'unitPrice',
  retailvalue: 'retailValue',
};

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9/.]/g, '');
}

function displayHeader(value) {
  return String(value || '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'number') {
    return value;
  }

  const cleaned = String(value).replace(/[$,%\s,]/g, '');
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatSheetDate(value) {
  if (!value && value !== 0) {
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
  }

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) {
      return null;
    }

    return `${parsed.y}-${pad2(parsed.m)}-${pad2(parsed.d)}`;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
      const [, month, day, year] = slashMatch;
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }

    const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    }
  }

  const parsedDate = new Date(value);
  if (!Number.isNaN(parsedDate.getTime())) {
    return `${parsedDate.getFullYear()}-${pad2(parsedDate.getMonth() + 1)}-${pad2(parsedDate.getDate())}`;
  }

  return null;
}

function getFirstDayOfMonth(dateValue) {
  const match = String(dateValue).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return `${match[1]}-${match[2]}-01`;
  }

  return null;
}

function findMetaRow(rows, label) {
  const wanted = normalizeHeader(label);

  for (let i = 0; i < Math.min(rows.length, 10); i += 1) {
    const cell = normalizeHeader(String(rows[i][0] || '').replace(/:$/, ''));
    if (cell === wanted) {
      return { rowIndex: i, value: rows[i][1] };
    }
  }

  return null;
}

function findTableHeaderIndex(rows) {
  return rows.findIndex((row) => {
    const normalized = row.map((cell) => normalizeHeader(displayHeader(cell)));
    return normalized.includes('productname') && (normalized.includes('sku#') || normalized.includes('sku'));
  });
}

function validateMeta(rows) {
  const errors = [];
  const meta = {};

  EXPECTED_META_LABELS.forEach((label) => {
    const found = findMetaRow(rows, label);
    if (!found) {
      errors.push(`Missing required header field "${label}".`);
      return;
    }

    if (found.value === undefined || found.value === null || String(found.value).trim() === '') {
      errors.push(`Header field "${label}" is empty.`);
      return;
    }

    meta[normalizeHeader(label)] = found.value;
  });

  // Reject unexpected first-column meta labels in the top block.
  for (let i = 0; i < Math.min(rows.length, 4); i += 1) {
    const label = displayHeader(String(rows[i][0] || '').replace(/:$/, ''));
    if (!label) {
      continue;
    }

    const allowed = EXPECTED_META_LABELS.some(
      (expected) => normalizeHeader(expected) === normalizeHeader(label)
    );
    if (!allowed) {
      errors.push(
        `Unexpected header label "${label}" at row ${i + 1}. Expected one of: ${EXPECTED_META_LABELS.join(', ')}.`
      );
    }
  }

  return { errors, meta };
}

function validateColumns(headerRow) {
  const errors = [];
  const actual = headerRow
    .map((cell) => displayHeader(cell))
    .filter((cell) => cell !== '');

  const expectedNormalized = EXPECTED_COLUMNS.map(normalizeHeader);
  const actualNormalized = actual.map(normalizeHeader);

  if (actualNormalized.length !== expectedNormalized.length) {
    errors.push(
      `Column count mismatch. Expected ${EXPECTED_COLUMNS.length} columns, found ${actualNormalized.length}.`
    );
  }

  expectedNormalized.forEach((expected, index) => {
    const actualValue = actualNormalized[index];
    if (actualValue !== expected) {
      errors.push(
        `Column ${index + 1} mismatch. Expected "${EXPECTED_COLUMNS[index]}", found "${actual[index] || '(missing)'}".`
      );
    }
  });

  // Extra unexpected columns beyond expected length
  for (let i = expectedNormalized.length; i < actualNormalized.length; i += 1) {
    errors.push(`Unexpected extra column ${i + 1}: "${actual[i]}".`);
  }

  return errors;
}

function mapHeaderKeys(headerRow) {
  return headerRow.map((cell) => COLUMN_KEYS[normalizeHeader(displayHeader(cell))] || null);
}

function extractRows(rows, headerIndex) {
  const headerRow = rows[headerIndex];
  const mappedHeaders = mapHeaderKeys(headerRow);
  const dataRows = [];
  const errors = [];
  let sawProductRow = false;

  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const rawRow = rows[i];
    const nonEmptyCount = rawRow.filter((value) => String(value || '').trim() !== '').length;

    if (nonEmptyCount === 0) {
      if (sawProductRow) {
        break;
      }
      continue;
    }

    const rowObject = {};
    mappedHeaders.forEach((key, index) => {
      if (key) {
        rowObject[key] = rawRow[index];
      }
    });

    const sku = String(rowObject.sku || '').trim();
    const productName = String(rowObject.productName || '').trim();
    const status = String(rowObject.status || '').trim();

    // End of product table: later sheet content (pivots/totals) has no SKU.
    if (!sku) {
      if (sawProductRow) {
        break;
      }
      continue;
    }

    sawProductRow = true;

    if (!productName) {
      errors.push(`Row ${i + 1} (SKU ${sku}): Product Name is required.`);
      continue;
    }

    if (!status) {
      errors.push(`Row ${i + 1} (SKU ${sku}): Status is required.`);
      continue;
    }

    if (status.toLowerCase() !== 'approved') {
      errors.push(`Row ${i + 1} (SKU ${sku}): Status must be "Approved", found "${status}".`);
      continue;
    }

    const quantity = parseNumber(rowObject.actQty) ?? parseNumber(rowObject.qty);
    const cost = parseNumber(rowObject.cost);
    const unitPrice = parseNumber(rowObject.unitPrice);
    const retailValue = parseNumber(rowObject.retailValue);
    const receivedAmount = parseNumber(rowObject.receivedAmount);

    if (!quantity || quantity <= 0) {
      errors.push(`Row ${i + 1} (SKU ${sku}): Act. Qty / Inv Qty must be a positive number.`);
      continue;
    }

    if (cost === null || cost < 0) {
      errors.push(`Row ${i + 1} (SKU ${sku}): Cost/Unit must be a valid number.`);
      continue;
    }

    dataRows.push({
      rowNumber: i + 1,
      sku,
      productName,
      quantity,
      cost,
      unitPrice,
      retailValue,
      receivedAmount,
      amount: Number((quantity * cost).toFixed(2)),
      status,
      raw: rowObject,
    });
  }

  return { dataRows, errors };
}

function parseWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false, raw: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new SheetValidationError(['No worksheet found in the uploaded file.']);
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: '',
    blankrows: false,
  });

  if (!rows.length) {
    throw new SheetValidationError(['The first worksheet is empty.']);
  }

  const validationErrors = [];

  const { errors: metaErrors, meta } = validateMeta(rows);
  validationErrors.push(...metaErrors);

  const headerIndex = findTableHeaderIndex(rows);
  if (headerIndex === -1) {
    validationErrors.push(
      'Could not find the product table header row. Expected columns starting with "Product Name" and "SKU #".'
    );
    throw new SheetValidationError(validationErrors);
  }

  if (headerIndex !== 4) {
    validationErrors.push(
      `Product table header must be on row 5. Found header on row ${headerIndex + 1}.`
    );
  }

  validationErrors.push(...validateColumns(rows[headerIndex]));

  const vendor = String(meta.vendor || '').trim();
  const ref = String(meta.ref || '').trim();
  const date = formatSheetDate(meta.date);
  const invoiceAmount = parseNumber(meta.invoiceamount);

  if (!date) {
    validationErrors.push('Header field "Date" is invalid. Expected a valid date.');
  }

  if (invoiceAmount === null) {
    validationErrors.push('Header field "Invoice Amount" must be a valid number.');
  }

  const { dataRows, errors: rowErrors } = extractRows(rows, headerIndex);
  validationErrors.push(...rowErrors);

  if (!dataRows.length && rowErrors.length === 0) {
    validationErrors.push('No valid inventory rows were found in the first worksheet.');
  }

  if (dataRows.length && invoiceAmount !== null) {
    const totalAmount = Number(
      dataRows.reduce((sum, row) => sum + row.amount, 0).toFixed(2)
    );
    if (Math.abs(totalAmount - invoiceAmount) > 0.01) {
      validationErrors.push(
        `Invoice Amount mismatch. Header says ${invoiceAmount}, but row totals are ${totalAmount}.`
      );
    }
  }

  if (validationErrors.length) {
    throw new SheetValidationError(validationErrors);
  }

  return {
    sheetName,
    header: {
      vendor,
      ref,
      date,
      invoiceAmount,
      markAmount: invoiceAmount,
      inventoryStartDate: date ? getFirstDayOfMonth(date) : null,
    },
    rows: dataRows,
    warnings: [],
  };
}

module.exports = {
  parseWorkbook,
  SheetValidationError,
  EXPECTED_COLUMNS,
  EXPECTED_META_LABELS,
};
