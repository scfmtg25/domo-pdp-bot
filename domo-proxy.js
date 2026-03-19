// netlify/functions/domo-proxy.js
// This runs server-side so there's no CORS issue.
// It forwards requests to Domo's API on behalf of the browser.

const https = require('https');
const http = require('http');

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Domo-Instance, X-Domo-Client-Id, X-Domo-Client-Secret, X-Domo-Token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const { action, instance, clientId, clientSecret, token, datasetId, branchNum, userIds, email } = body;

    if (!instance) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing instance' }) };
    }

    // ── ACTION: get_token ─────────────────────────────────────────────
    if (action === 'get_token') {
      const result = await domoRequest({
        method: 'GET',
        hostname: `${instance}.domo.com`,
        path: '/oauth/token?grant_type=client_credentials&scope=data',
        auth: `${clientId}:${clientSecret}`,
      });
      return { statusCode: 200, headers, body: JSON.stringify(result) };
    }

    // ── ACTION: get_user ──────────────────────────────────────────────
    if (action === 'get_user') {
      const result = await domoRequest({
        method: 'GET',
        hostname: `${instance}.domo.com`,
        path: `/api/identity/v1/users?q=${encodeURIComponent(email)}&limit=5`,
        token,
      });
      return { statusCode: 200, headers, body: JSON.stringify(result) };
    }

    // ── ACTION: create_pdp ────────────────────────────────────────────
    if (action === 'create_pdp') {
      const payload = JSON.stringify({
        name: `Branch ${branchNum}`,
        type: 'user',
        filters: [{ column: 'Full Branch Name', values: [branchNum], operator: 'EQUALS', not: false }],
        users: userIds.map(id => ({ id })),
        groups: []
      });
      const result = await domoRequest({
        method: 'POST',
        hostname: `${instance}.domo.com`,
        path: `/api/data/v1/datasources/${datasetId}/policies`,
        token,
        body: payload,
      });
      return { statusCode: 200, headers, body: JSON.stringify(result) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};

// ── Helper: make HTTPS request to Domo ───────────────────────────────────
function domoRequest({ method, hostname, path, auth, token, body }) {
  return new Promise((resolve, reject) => {
    const reqHeaders = {
      'Accept': 'application/json',
    };
    if (auth) {
      reqHeaders['Authorization'] = 'Basic ' + Buffer.from(auth).toString('base64');
    }
    if (token) {
      reqHeaders['Authorization'] = 'Bearer ' + token;
    }
    if (body) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(body);
    }

    const options = { method, hostname, path, headers: reqHeaders };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ _raw: data, _status: res.statusCode });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
