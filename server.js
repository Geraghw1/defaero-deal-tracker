const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const XLSX = require('xlsx');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const isProduction = process.env.NODE_ENV === 'production';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  // eslint-disable-next-line no-console
  console.error('Missing DATABASE_URL. Set your Supabase Postgres connection string.');
  process.exit(1);
}

const shouldUseSsl =
  process.env.DATABASE_SSL === 'true' ||
  process.env.PGSSLMODE === 'require' ||
  databaseUrl.includes('supabase.co');

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: shouldUseSsl ? { rejectUnauthorized: false } : false
});

const upload = multer({ storage: multer.memoryStorage() });
const docsUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

app.use(express.json());
app.use(
  session({
    name: 'defaero.sid',
    secret: process.env.SESSION_SECRET || crypto.randomBytes(24).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction,
      maxAge: 1000 * 60 * 60 * 12
    }
  })
);
app.use(express.static(path.join(__dirname, 'public')));

if (isProduction) {
  app.set('trust proxy', 1);
}

function toPgPlaceholders(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => {
    index += 1;
    return `$${index}`;
  });
}

async function query(sql, params = []) {
  const compiled = toPgPlaceholders(sql);
  return pool.query(compiled, params);
}

async function run(sql, params = []) {
  const result = await query(sql, params);
  return {
    id: result.rows?.[0]?.id || null,
    changes: result.rowCount || 0
  };
}

async function all(sql, params = []) {
  const result = await query(sql, params);
  return result.rows;
}

async function get(sql, params = []) {
  const result = await query(sql, params);
  return result.rows[0] || null;
}

const stageValues = ['sourcing', 'quoted', 'sampled', 'negotiating', 'committed', 'won', 'lost'];
const statusValues = ['open', 'won', 'lost'];
const dealTypeValues = ['supplier_offer', 'customer_need', 'matched_deal'];

function normalizeStage(value) {
  const stage = (value || 'sourcing').toString().trim().toLowerCase();
  return stageValues.includes(stage) ? stage : 'sourcing';
}

function normalizeStatus(value) {
  const status = (value || 'open').toString().trim().toLowerCase();
  return statusValues.includes(status) ? status : 'open';
}

function normalizeDealType(value) {
  const dealType = (value || 'supplier_offer').toString().trim().toLowerCase();
  return dealTypeValues.includes(dealType) ? dealType : 'supplier_offer';
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePrice(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/,/g, '');
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function sanitizeOpportunity(payload = {}) {
  return {
    deal_type: normalizeDealType(payload.deal_type),
    supplier: (payload.supplier || '').toString().trim(),
    product: (payload.product || '').toString().trim(),
    customer: (payload.customer || '').toString().trim(),
    qty_needed: parseNumber(payload.qty_needed),
    supplier_price: parsePrice(payload.supplier_price),
    target_sell_price: parsePrice(payload.target_sell_price),
    incoterms: (payload.incoterms || '').toString().trim(),
    country_of_origin: (payload.country_of_origin || '').toString().trim(),
    intermediary: (payload.intermediary || '').toString().trim(),
    deal_contacts: (payload.deal_contacts || '').toString().trim(),
    stage: normalizeStage(payload.stage),
    status: normalizeStatus(payload.status),
    confidence: Math.max(0, Math.min(100, parseInt(payload.confidence || 50, 10) || 50)),
    owner: (payload.owner || '').toString().trim(),
    notes: (payload.notes || '').toString().trim(),
    euc_text: (payload.euc_text || payload.euc || '').toString().trim(),
    next_action: (payload.next_action || '').toString().trim(),
    updated_at: new Date().toISOString()
  };
}

function loadUsers() {
  const raw = process.env.APP_USERS || 'owner:change-me,partner:change-me-too';
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const splitAt = entry.indexOf(':');
      if (splitAt < 1) return null;
      const username = entry.slice(0, splitAt).trim();
      const password = entry.slice(splitAt + 1).trim();
      if (!username || !password) return null;
      return { username, password };
    })
    .filter(Boolean);
}

const users = loadUsers();

function requireAuth(req, res, next) {
  if (!req.session.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

async function initDb() {
  await run(`
    CREATE TABLE IF NOT EXISTS opportunities (
      id BIGSERIAL PRIMARY KEY,
      deal_type TEXT NOT NULL DEFAULT 'supplier_offer',
      supplier TEXT NOT NULL,
      product TEXT NOT NULL,
      customer TEXT DEFAULT '',
      qty_needed DOUBLE PRECISION,
      supplier_price DOUBLE PRECISION,
      target_sell_price DOUBLE PRECISION,
      incoterms TEXT,
      country_of_origin TEXT,
      intermediary TEXT,
      deal_contacts TEXT,
      stage TEXT NOT NULL DEFAULT 'sourcing',
      status TEXT NOT NULL DEFAULT 'open',
      confidence INTEGER NOT NULL DEFAULT 50,
      owner TEXT,
      notes TEXT,
      euc_text TEXT,
      next_action TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS opportunity_documents (
      id BIGSERIAL PRIMARY KEY,
      opportunity_id BIGINT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT,
      size_bytes BIGINT,
      file_data BYTEA NOT NULL,
      uploaded_by TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      CONSTRAINT fk_opportunity
        FOREIGN KEY(opportunity_id)
        REFERENCES opportunities(id)
        ON DELETE CASCADE
    )
  `);
}

app.post('/api/auth/login', (req, res) => {
  const username = (req.body.username || '').toString().trim();
  const password = (req.body.password || '').toString();

  const match = users.find((entry) => entry.username === username && entry.password === password);
  if (!match) {
    res.status(401).json({ error: 'Invalid username or password' });
    return;
  }

  req.session.user = { username: match.username };
  res.json({ user: req.session.user });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.status(204).send();
  });
});

app.get('/api/auth/me', (req, res) => {
  res.json({ user: req.session.user || null });
});

app.get('/api/opportunities', requireAuth, async (req, res) => {
  try {
    const { q = '', stage = '', status = '', owner = '', deal_type = '' } = req.query;
    const filters = [];
    const params = [];

    if (q) {
      filters.push('(supplier ILIKE ? OR product ILIKE ? OR customer ILIKE ? OR notes ILIKE ? OR euc_text ILIKE ? OR next_action ILIKE ? OR deal_contacts ILIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like, like, like, like, like);
    }

    if (stage && stageValues.includes(stage)) {
      filters.push('stage = ?');
      params.push(stage);
    }

    if (status && statusValues.includes(status)) {
      filters.push('status = ?');
      params.push(status);
    }

    if (deal_type && dealTypeValues.includes(deal_type)) {
      filters.push('deal_type = ?');
      params.push(deal_type);
    }

    if (owner) {
      filters.push('owner ILIKE ?');
      params.push(`%${owner}%`);
    }

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const rows = await all(
      `SELECT * FROM opportunities ${whereClause} ORDER BY updated_at DESC, id DESC`,
      params
    );
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch opportunities', detail: err.message });
  }
});

app.get('/api/summary', requireAuth, async (_req, res) => {
  try {
    const [counts, pipeline] = await Promise.all([
      all('SELECT status, COUNT(*)::int as count FROM opportunities GROUP BY status'),
      get("SELECT ROUND(SUM(COALESCE(target_sell_price, 0) * COALESCE(qty_needed, 0))::numeric, 2) AS total_pipeline FROM opportunities WHERE status = 'open'")
    ]);

    const summary = { open: 0, won: 0, lost: 0, total_pipeline: Number(pipeline?.total_pipeline || 0) };
    counts.forEach((entry) => {
      summary[entry.status] = Number(entry.count);
    });

    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load summary', detail: err.message });
  }
});

app.post('/api/opportunities', requireAuth, async (req, res) => {
  try {
    const input = sanitizeOpportunity(req.body);
    if (!input.supplier || !input.product) {
      res.status(400).json({ error: 'supplier and product are required' });
      return;
    }

    if (!input.owner) {
      input.owner = req.session.user.username;
    }

    const timestamp = new Date().toISOString();
    const result = await run(
      `INSERT INTO opportunities (
        deal_type, supplier, product, customer, qty_needed, supplier_price, target_sell_price,
        incoterms, country_of_origin, intermediary, deal_contacts,
        stage, status, confidence, owner, notes, euc_text, next_action, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [
        input.deal_type,
        input.supplier,
        input.product,
        input.customer,
        input.qty_needed,
        input.supplier_price,
        input.target_sell_price,
        input.incoterms,
        input.country_of_origin,
        input.intermediary,
        input.deal_contacts,
        input.stage,
        input.status,
        input.confidence,
        input.owner,
        input.notes,
        input.euc_text,
        input.next_action,
        timestamp,
        timestamp
      ]
    );

    const row = await get('SELECT * FROM opportunities WHERE id = ?', [result.id]);
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create opportunity', detail: err.message });
  }
});

app.put('/api/opportunities/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Invalid ID' });
      return;
    }

    const existing = await get('SELECT * FROM opportunities WHERE id = ?', [id]);
    if (!existing) {
      res.status(404).json({ error: 'Opportunity not found' });
      return;
    }

    const input = sanitizeOpportunity({ ...existing, ...req.body });
    if (!input.supplier || !input.product) {
      res.status(400).json({ error: 'supplier and product are required' });
      return;
    }

    await run(
      `UPDATE opportunities SET
        deal_type = ?,
        supplier = ?,
        product = ?,
        customer = ?,
        qty_needed = ?,
        supplier_price = ?,
        target_sell_price = ?,
        incoterms = ?,
        country_of_origin = ?,
        intermediary = ?,
        deal_contacts = ?,
        stage = ?,
        status = ?,
        confidence = ?,
        owner = ?,
        notes = ?,
        euc_text = ?,
        next_action = ?,
        updated_at = ?
      WHERE id = ?`,
      [
        input.deal_type,
        input.supplier,
        input.product,
        input.customer,
        input.qty_needed,
        input.supplier_price,
        input.target_sell_price,
        input.incoterms,
        input.country_of_origin,
        input.intermediary,
        input.deal_contacts,
        input.stage,
        input.status,
        input.confidence,
        input.owner,
        input.notes,
        input.euc_text,
        input.next_action,
        input.updated_at,
        id
      ]
    );

    const row = await get('SELECT * FROM opportunities WHERE id = ?', [id]);
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update opportunity', detail: err.message });
  }
});

app.delete('/api/opportunities/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Invalid ID' });
      return;
    }

    const result = await run('DELETE FROM opportunities WHERE id = ?', [id]);
    if (!result.changes) {
      res.status(404).json({ error: 'Opportunity not found' });
      return;
    }

    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete opportunity', detail: err.message });
  }
});

app.post('/api/import-xlsx', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Upload a .xlsx file as "file"' });
      return;
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const firstSheet = workbook.Sheets[sheetName];

    // Your workbook has title rows first; headers start on row 4.
    const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: '', range: 3 });

    let imported = 0;
    for (const row of rows) {
      const supplier = row.Supplier || row.supplier || '';
      const product = row['Product '] || row.Product || row.product || '';
      if (!supplier || !product) {
        continue;
      }

      const contacts = row['Who is involved in the deal'] || row['Who is involved in the deal?'] || '';
      const mapped = sanitizeOpportunity({
        deal_type: 'supplier_offer',
        supplier,
        product,
        customer: row.Customer || row.customer || '',
        supplier_price: row['Price (Currency)'] || row.Price || '',
        target_sell_price: row['Target Sell Price'] || row.TargetSellPrice || '',
        incoterms: row.Incoterms || row.incoterms || '',
        country_of_origin: row['Country of Origin (COO)'] || row['Country of Origin'] || '',
        intermediary: row.Intermediary || row.intermediary || '',
        deal_contacts: contacts,
        owner: req.session.user.username,
        notes: row.Notes || row.notes || '',
        euc_text: row.EUC || row.euc || '',
        stage: row.Stage || 'sourcing',
        status: row.Status || 'open'
      });

      const now = new Date().toISOString();
      await run(
        `INSERT INTO opportunities (
          deal_type, supplier, product, customer, qty_needed, supplier_price, target_sell_price,
          incoterms, country_of_origin, intermediary, deal_contacts,
          stage, status, confidence, owner, notes, euc_text, next_action, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          mapped.deal_type,
          mapped.supplier,
          mapped.product,
          mapped.customer,
          mapped.qty_needed,
          mapped.supplier_price,
          mapped.target_sell_price,
          mapped.incoterms,
          mapped.country_of_origin,
          mapped.intermediary,
          mapped.deal_contacts,
          mapped.stage,
          mapped.status,
          mapped.confidence,
          mapped.owner,
          mapped.notes,
          mapped.euc_text,
          mapped.next_action,
          now,
          now
        ]
      );
      imported += 1;
    }

    res.json({ imported, rows_read: rows.length, sheet: sheetName });
  } catch (err) {
    res.status(500).json({ error: 'Import failed', detail: err.message });
  }
});

app.get('/api/opportunities/:id/documents', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Invalid opportunity ID' });
      return;
    }

    const rows = await all(
      `SELECT id, opportunity_id, original_name, mime_type, size_bytes, uploaded_by, created_at
       FROM opportunity_documents
       WHERE opportunity_id = ?
       ORDER BY created_at DESC, id DESC`,
      [id]
    );
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch documents', detail: err.message });
  }
});

app.post('/api/opportunities/:id/documents', requireAuth, docsUpload.single('file'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Invalid opportunity ID' });
      return;
    }

    const opportunity = await get('SELECT id FROM opportunities WHERE id = ?', [id]);
    if (!opportunity) {
      res.status(404).json({ error: 'Opportunity not found' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'Upload a document as "file"' });
      return;
    }

    const createdAt = new Date().toISOString();
    const result = await run(
      `INSERT INTO opportunity_documents (
        opportunity_id, original_name, mime_type, size_bytes, file_data, uploaded_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [
        id,
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
        req.file.buffer,
        req.session.user.username,
        createdAt
      ]
    );

    const row = await get(
      `SELECT id, opportunity_id, original_name, mime_type, size_bytes, uploaded_by, created_at
       FROM opportunity_documents WHERE id = ?`,
      [result.id]
    );
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: 'Document upload failed', detail: err.message });
  }
});

app.get('/api/documents/:id/download', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Invalid document ID' });
      return;
    }

    const doc = await get('SELECT original_name, mime_type, file_data FROM opportunity_documents WHERE id = ?', [id]);
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.original_name)}"`);
    res.send(doc.file_data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to download document', detail: err.message });
  }
});

app.delete('/api/documents/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Invalid document ID' });
      return;
    }

    const result = await run('DELETE FROM opportunity_documents WHERE id = ?', [id]);
    if (!result.changes) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete document', detail: err.message });
  }
});

initDb()
  .then(() => {
    app.listen(PORT, HOST, () => {
      // eslint-disable-next-line no-console
      console.log(`Deal tracker running at http://${HOST}:${PORT}`);
    });
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to initialize database', err);
    process.exit(1);
  });
