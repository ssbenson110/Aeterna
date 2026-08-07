/**
 * Thin API client. Every call returns parsed JSON or throws an ApiError whose
 * message is already written in the product voice, because the server writes
 * its errors that way.
 */

export class ApiError extends Error {
  constructor(status, body) {
    super((body && (body.error || body.message)) || 'Something went wrong. Please try again.');
    this.status = status;
    this.body = body || {};
  }
}

async function request(method, path, body) {
  const options = {
    method,
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
  };
  if (body !== undefined) {
    options.headers['content-type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(path, options);
  } catch {
    throw new ApiError(0, { error: 'We could not reach the server. Check your connection and try again.' });
  }

  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = { error: 'The server sent something we could not read.' }; }
  }
  if (!response.ok) throw new ApiError(response.status, data);
  return data;
}

const qs = (params) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') search.set(key, value);
  }
  const string = search.toString();
  return string ? `?${string}` : '';
};

export const api = {
  meta: () => request('GET', '/api/meta'),
  pricing: () => request('GET', '/api/pricing'),
  verificationScope: () => request('GET', '/api/policies/verification'),
  fairUse: () => request('GET', '/api/policies/fair-use'),

  me: () => request('GET', '/api/auth/me'),
  register: (payload) => request('POST', '/api/auth/register', payload),
  login: (payload) => request('POST', '/api/auth/login', payload),
  logout: () => request('POST', '/api/auth/logout', {}),

  vendors: (params) => request('GET', `/api/vendors${qs(params)}`),
  vendor: (slug) => request('GET', `/api/vendors/${encodeURIComponent(slug)}`),
  createVendor: (payload) => request('POST', '/api/vendors', payload),

  enquiries: () => request('GET', '/api/enquiries'),
  sendEnquiry: (payload) => request('POST', '/api/enquiries', payload),
  respondToEnquiry: (id, decision) => request('POST', `/api/enquiries/${id}/respond`, { decision }),

  planner: () => request('GET', '/api/planner'),
  updateWedding: (payload) => request('PATCH', '/api/planner/wedding', payload),
  rebalanceBudget: () => request('POST', '/api/planner/budget/rebalance', {}),

  addTask: (payload) => request('POST', '/api/planner/checklist', payload),
  updateTask: (id, payload) => request('PATCH', `/api/planner/checklist/${id}`, payload),
  removeTask: (id) => request('DELETE', `/api/planner/checklist/${id}`),

  addBudgetLine: (payload) => request('POST', '/api/planner/budget', payload),
  updateBudgetLine: (id, payload) => request('PATCH', `/api/planner/budget/${id}`, payload),
  removeBudgetLine: (id) => request('DELETE', `/api/planner/budget/${id}`),

  addGuest: (payload) => request('POST', '/api/planner/guests', payload),
  updateGuest: (id, payload) => request('PATCH', `/api/planner/guests/${id}`, payload),
  removeGuest: (id) => request('DELETE', `/api/planner/guests/${id}`),

  addTable: (payload) => request('POST', '/api/planner/tables', payload),
  updateTable: (id, payload) => request('PATCH', `/api/planner/tables/${id}`, payload),
  removeTable: (id) => request('DELETE', `/api/planner/tables/${id}`),

  addTimelineEvent: (payload) => request('POST', '/api/planner/timeline', payload),
  updateTimelineEvent: (id, payload) => request('PATCH', `/api/planner/timeline/${id}`, payload),
  removeTimelineEvent: (id) => request('DELETE', `/api/planner/timeline/${id}`),

  aiStatus: () => request('GET', '/api/ai/status'),
  aiMessages: () => request('GET', '/api/ai/messages'),
  aiChat: (message) => request('POST', '/api/ai/chat', { message }),
  aiClear: () => request('DELETE', '/api/ai/messages'),

  workspaces: () => request('GET', '/api/workspaces'),
  workspace: (weddingId) => request('GET', `/api/workspace/${weddingId}`),
  inviteToWorkspace: (weddingId, payload) => request('POST', `/api/workspace/${weddingId}/invite`, payload),
  joinWorkspace: (token) => request('POST', `/api/workspace/join/${token}`, {}),
  removeWorkspaceMember: (weddingId, memberId) => request('DELETE', `/api/workspace/${weddingId}/members/${memberId}`),
  addWorkspaceTask: (weddingId, payload) => request('POST', `/api/workspace/${weddingId}/tasks`, payload),
  updateWorkspaceTask: (weddingId, taskId, payload) => request('PATCH', `/api/workspace/${weddingId}/tasks/${taskId}`, payload),
  addWorkspaceComment: (weddingId, payload) => request('POST', `/api/workspace/${weddingId}/comments`, payload),
  bookVendor: (payload) => request('POST', '/api/bookings', payload),
  cancelBooking: (vendorId) => request('DELETE', `/api/bookings/${vendorId}`),

  /* ---- admin console ---- */
  adminMeta: () => request('GET', '/api/admin/meta'),
  adminQueue: (params) => request('GET', `/api/admin/queue${qs(params)}`),
  adminRenewals: () => request('GET', '/api/admin/renewals'),
  adminAudit: (params) => request('GET', `/api/admin/audit${qs(params)}`),
  adminVendor: (vendorId) => request('GET', `/api/admin/vendors/${vendorId}`),
  adminStart: (vendorId) => request('POST', `/api/admin/vendors/${vendorId}/start`, {}),
  adminSetCheck: (vendorId, checkKey, payload) =>
    request('POST', `/api/admin/vendors/${vendorId}/checks/${checkKey}`, payload),
  adminRecordInsurance: (vendorId, payload) =>
    request('POST', `/api/admin/vendors/${vendorId}/insurance`, payload),
  adminChase: (vendorId, payload) => request('POST', `/api/admin/vendors/${vendorId}/chase`, payload),
  adminRecompute: (vendorId) => request('POST', `/api/admin/vendors/${vendorId}/recompute`, {}),
  adminSuspend: (vendorId, reason) => request('POST', `/api/admin/vendors/${vendorId}/suspend`, { reason }),
  adminSetNotes: (vendorId, notes) => request('PATCH', `/api/admin/vendors/${vendorId}/notes`, { notes }),
  adminSetAccepting: (vendorId, accepting) =>
    request('PATCH', `/api/admin/vendors/${vendorId}/accepting`, { accepting }),
  adminRemoveImage: (vendorId, uploadId) =>
    request('DELETE', `/api/admin/vendors/${vendorId}/images/${uploadId}`),
  adminSweep: () => request('POST', '/api/admin/sweep', {}),

  /* ---- vendor media and verification ---- */
  myVerification: () => request('GET', '/api/vendors/me/verification'),
  confirmRights: (statement) => request('POST', '/api/vendors/me/rights', { confirmed: true, statement }),
  myImages: () => request('GET', '/api/vendors/me/images'),
  updateImage: (uploadId, payload) => request('PATCH', `/api/vendors/me/images/${uploadId}`, payload),
  removeImage: (uploadId) => request('DELETE', `/api/vendors/me/images/${uploadId}`),

  /**
   * Images go up as raw bytes with the alt text in the query string. Not
   * multipart: there is no dependency to parse it with, and a raw body has no
   * boundary handling to get wrong.
   */
  uploadImage: async (blob, type, alt, makeHero) => {
    const params = new URLSearchParams({ alt: String(alt || '') });
    if (makeHero) params.set('hero', '1');
    const response = await fetch(`/api/vendors/me/images?${params}`, {
      method: 'POST',
      headers: { 'content-type': type, accept: 'application/json' },
      credentials: 'same-origin',
      body: blob,
    });
    const text = await response.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch { data = null; } }
    if (!response.ok) throw new ApiError(response.status, data);
    return data;
  },

  /* ---- vendor CRM ---- */
  crmPipeline: () => request('GET', '/api/crm/pipeline'),
  crmUpdateEnquiry: (enquiryId, payload) => request('PATCH', `/api/crm/enquiries/${enquiryId}`, payload),
  crmSendQuote: (payload) => request('POST', '/api/crm/quotes', payload),
  crmWithdrawQuote: (quoteId) => request('POST', `/api/crm/quotes/${quoteId}/withdraw`, {}),
  crmInvoices: () => request('GET', '/api/crm/invoices'),
  crmRaiseInvoice: (payload) => request('POST', '/api/crm/invoices', payload),
  crmSettleInvoice: (invoiceId, status) => request('PATCH', `/api/crm/invoices/${invoiceId}`, { status }),
  crmAvailability: () => request('GET', '/api/crm/availability'),
  crmAddBlackout: (payload) => request('POST', '/api/crm/availability', payload),
  crmRemoveBlackout: (blackoutId) => request('DELETE', `/api/crm/availability/${blackoutId}`),

  /* ---- approvals, sharing, guests ---- */
  decideQuote: (quoteId, decision) => request('POST', `/api/quotes/${quoteId}/decide`, { decision }),
  getSharing: (weddingId) => request('GET', `/api/workspace/${weddingId}/sharing`),
  setSharing: (weddingId, payload) => request('PATCH', `/api/workspace/${weddingId}/sharing`, payload),
  sendGuestMessage: (payload) => request('POST', '/api/planner/guest-messages', payload),
  guestMessages: () => request('GET', '/api/planner/guest-messages'),
  guestLinks: () => request('GET', '/api/planner/guest-links'),
  rsvpGet: (token) => request('GET', `/api/rsvp/${token}`),
  rsvpPost: (token, payload) => request('POST', `/api/rsvp/${token}`, payload),

  billingStatus: () => request('GET', '/api/billing/status'),
  coupleCheckout: () => request('POST', '/api/billing/couple/checkout', {}),
  vendorCheckout: () => request('POST', '/api/billing/vendor/checkout', {}),
  upgrade: () => request('POST', '/api/billing/couple/upgrade', {}),
  subscribe: () => request('POST', '/api/billing/vendor/subscribe', {}),
};
