const loginCard = document.getElementById('loginCard');
const appContent = document.getElementById('appContent');
const authState = document.getElementById('authState');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const form = document.getElementById('opportunityForm');
const rowsEl = document.getElementById('rows');
const summaryEl = document.getElementById('summary');
const importForm = document.getElementById('importForm');
const importResultEl = document.getElementById('importResult');
const documentForm = document.getElementById('documentForm');
const documentResultEl = document.getElementById('documentResult');
const documentListEl = document.getElementById('documentList');
const docOpportunityIdEl = document.getElementById('docOpportunityId');
const documentFileEl = document.getElementById('documentFile');
const formTitle = document.getElementById('formTitle');
const submitBtn = document.getElementById('submitBtn');
const cancelEditBtn = document.getElementById('cancelEdit');

const filters = {
  q: document.getElementById('search'),
  deal_type: document.getElementById('dealTypeFilter'),
  stage: document.getElementById('stageFilter'),
  status: document.getElementById('statusFilter'),
  owner: document.getElementById('ownerFilter')
};

let editingId = null;
let currentUser = null;
let opportunitiesCache = [];

function money(value) {
  if (value === null || value === undefined || value === '') return '-';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  }).format(Number(value));
}

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function formatBytes(value) {
  if (!value || value < 1) return '-';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function serializeForm(formEl) {
  const data = new FormData(formEl);
  return Object.fromEntries(data.entries());
}

function setLoggedOut() {
  currentUser = null;
  authState.innerHTML = '';
  loginCard.hidden = false;
  appContent.hidden = true;
}

function setLoggedIn(user) {
  currentUser = user;
  authState.innerHTML = `<span class="pill">Signed in as ${user.username}</span> <button id="logoutBtn" class="ghost" type="button">Log out</button>`;
  loginCard.hidden = true;
  appContent.hidden = false;
  document.getElementById('logoutBtn').addEventListener('click', logout);
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, options);
  if (res.status === 401) {
    setLoggedOut();
    throw new Error('Unauthorized');
  }
  return res;
}

function toQueryString() {
  const params = new URLSearchParams();
  if (filters.q.value) params.set('q', filters.q.value.trim());
  if (filters.deal_type.value) params.set('deal_type', filters.deal_type.value);
  if (filters.stage.value) params.set('stage', filters.stage.value);
  if (filters.status.value) params.set('status', filters.status.value);
  if (filters.owner.value) params.set('owner', filters.owner.value.trim());
  const query = params.toString();
  return query ? `?${query}` : '';
}

async function fetchSummary() {
  const res = await apiFetch('/api/summary');
  const summary = await res.json();

  summaryEl.innerHTML = `
    <article class="metric"><div class="label">Open</div><div class="value">${summary.open || 0}</div></article>
    <article class="metric"><div class="label">Won</div><div class="value">${summary.won || 0}</div></article>
    <article class="metric"><div class="label">Lost</div><div class="value">${summary.lost || 0}</div></article>
    <article class="metric"><div class="label">Open Pipeline</div><div class="value">${money(summary.total_pipeline || 0)}</div></article>
  `;
}

function renderRows(items) {
  if (!items.length) {
    rowsEl.innerHTML = '<tr><td colspan="11" class="muted">No opportunities found.</td></tr>';
    return;
  }

  rowsEl.innerHTML = items
    .map(
      (item) => `
      <tr>
        <td><span class="pill">${item.deal_type.replace('_', ' ')}</span></td>
        <td>${item.supplier}</td>
        <td>${item.product}</td>
        <td>${item.customer || '-'}</td>
        <td>${money(item.supplier_price)}</td>
        <td>${item.incoterms || '-'}</td>
        <td>${item.country_of_origin || '-'}</td>
        <td><span class="pill status-${item.status}">${item.status}</span></td>
        <td>${item.owner || '-'}</td>
        <td>${formatDate(item.updated_at)}</td>
        <td>
          <button type="button" class="ghost" data-action="edit" data-id="${item.id}">Edit</button>
          <button type="button" class="danger" data-action="delete" data-id="${item.id}">Delete</button>
        </td>
      </tr>
    `
    )
    .join('');
}

async function fetchOpportunities() {
  const res = await apiFetch(`/api/opportunities${toQueryString()}`);
  const payload = await res.json();
  opportunitiesCache = payload.data || [];
  renderRows(opportunitiesCache);
  renderDocumentOpportunityOptions(opportunitiesCache);
}

function resetForm() {
  form.reset();
  form.confidence.value = 50;
  form.deal_type.value = 'supplier_offer';
  editingId = null;
  formTitle.textContent = 'Add Opportunity';
  submitBtn.textContent = 'Save Opportunity';
  cancelEditBtn.hidden = true;
}

function renderDocumentOpportunityOptions(items) {
  const previousValue = docOpportunityIdEl.value;
  docOpportunityIdEl.innerHTML = '<option value="">Select opportunity</option>';
  items.forEach((item) => {
    const option = document.createElement('option');
    option.value = String(item.id);
    option.textContent = `#${item.id} - ${item.supplier} / ${item.product}`;
    docOpportunityIdEl.appendChild(option);
  });

  if (editingId && items.some((item) => Number(item.id) === Number(editingId))) {
    docOpportunityIdEl.value = String(editingId);
  } else if (previousValue && items.some((item) => String(item.id) === previousValue)) {
    docOpportunityIdEl.value = previousValue;
  }

  if (docOpportunityIdEl.value) {
    loadDocumentsForOpportunity(docOpportunityIdEl.value);
  } else {
    documentListEl.textContent = 'Select an opportunity to view documents.';
  }
}

async function loadDocumentsForOpportunity(opportunityId) {
  if (!opportunityId) {
    documentListEl.textContent = 'Select an opportunity to view documents.';
    return;
  }

  const res = await apiFetch(`/api/opportunities/${opportunityId}/documents`);
  const body = await res.json();
  const docs = body.data || [];

  if (!docs.length) {
    documentListEl.textContent = 'No documents uploaded for this opportunity yet.';
    return;
  }

  documentListEl.innerHTML = docs
    .map(
      (doc) => `
      <div class="doc-item">
        <a href="/api/documents/${doc.id}/download" target="_blank" rel="noopener">${doc.original_name}</a>
        <span class="muted">${formatBytes(doc.size_bytes)} · ${doc.uploaded_by || '-'} · ${formatDate(doc.created_at)}</span>
        <button type="button" class="danger" data-doc-delete="${doc.id}">Delete</button>
      </div>
    `
    )
    .join('');
}

async function loadOpportunityIntoForm(id) {
  const res = await apiFetch('/api/opportunities');
  const payload = await res.json();
  const item = (payload.data || []).find((entry) => Number(entry.id) === Number(id));
  if (!item) return;

  editingId = item.id;
  formTitle.textContent = `Edit Opportunity #${item.id}`;
  submitBtn.textContent = 'Update Opportunity';
  cancelEditBtn.hidden = false;
  docOpportunityIdEl.value = String(item.id);
  await loadDocumentsForOpportunity(item.id);

  Object.keys(item).forEach((key) => {
    if (form.elements[key]) {
      form.elements[key].value = item[key] ?? '';
    }
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function refreshData() {
  await Promise.all([fetchSummary(), fetchOpportunities()]);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = serializeForm(form);
  const method = editingId ? 'PUT' : 'POST';
  const endpoint = editingId ? `/api/opportunities/${editingId}` : '/api/opportunities';

  const res = await apiFetch(endpoint, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const err = await res.json();
    alert(err.error || 'Failed to save opportunity');
    return;
  }

  resetForm();
  await refreshData();
});

cancelEditBtn.addEventListener('click', resetForm);

rowsEl.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const { action, id } = button.dataset;
  if (action === 'edit') {
    await loadOpportunityIntoForm(id);
    return;
  }

  if (action === 'delete') {
    if (!window.confirm('Delete this opportunity?')) return;
    const res = await apiFetch(`/api/opportunities/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      alert('Delete failed');
      return;
    }
    await refreshData();
  }
});

Object.values(filters).forEach((input) => {
  input.addEventListener('input', () => {
    fetchOpportunities();
  });
  input.addEventListener('change', () => {
    fetchOpportunities();
  });
});

importForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const fileInput = document.getElementById('xlsxFile');
  const file = fileInput.files?.[0];

  if (!file) {
    importResultEl.textContent = 'Please choose a file to import.';
    return;
  }

  const data = new FormData();
  data.append('file', file);

  importResultEl.textContent = 'Importing...';

  const res = await apiFetch('/api/import-xlsx', { method: 'POST', body: data });
  const body = await res.json();

  if (!res.ok) {
    importResultEl.textContent = body.error || 'Import failed';
    return;
  }

  importResultEl.textContent = `Imported ${body.imported} rows from sheet \"${body.sheet}\" (read ${body.rows_read} rows).`;
  fileInput.value = '';
  await refreshData();
});

documentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const opportunityId = docOpportunityIdEl.value;
  const file = documentFileEl.files?.[0];

  if (!opportunityId) {
    documentResultEl.textContent = 'Choose an opportunity first.';
    return;
  }
  if (!file) {
    documentResultEl.textContent = 'Choose a file to upload.';
    return;
  }

  const payload = new FormData();
  payload.append('file', file);
  documentResultEl.textContent = 'Uploading...';

  const res = await apiFetch(`/api/opportunities/${opportunityId}/documents`, {
    method: 'POST',
    body: payload
  });

  let body = {};
  try {
    body = await res.json();
  } catch (_error) {
    body = {};
  }

  if (!res.ok) {
    documentResultEl.textContent = body.error || 'Upload failed.';
    return;
  }

  documentResultEl.textContent = `Uploaded ${body.original_name || file.name}`;
  documentFileEl.value = '';
  await loadDocumentsForOpportunity(opportunityId);
});

docOpportunityIdEl.addEventListener('change', async () => {
  documentResultEl.textContent = '';
  await loadDocumentsForOpportunity(docOpportunityIdEl.value);
});

documentListEl.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-doc-delete]');
  if (!button) return;
  const docId = button.dataset.docDelete;
  if (!window.confirm('Delete this document?')) return;
  const res = await apiFetch(`/api/documents/${docId}`, { method: 'DELETE' });
  if (!res.ok) {
    documentResultEl.textContent = 'Delete failed.';
    return;
  }
  documentResultEl.textContent = 'Document deleted.';
  await loadDocumentsForOpportunity(docOpportunityIdEl.value);
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.textContent = '';
  const payload = serializeForm(loginForm);

  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const body = await res.json();
  if (!res.ok) {
    loginError.textContent = body.error || 'Login failed';
    return;
  }

  setLoggedIn(body.user);
  await refreshData();
});

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  setLoggedOut();
}

async function boot() {
  const res = await fetch('/api/auth/me');
  const body = await res.json();
  if (!body.user) {
    setLoggedOut();
    return;
  }

  setLoggedIn(body.user);
  await refreshData();
}

boot();
