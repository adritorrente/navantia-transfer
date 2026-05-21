// create-upload.js — genera URL firmada para subir directamente a Supabase Storage
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100_000, 32, 'sha256').toString('hex');
}

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
const MAX_MB  = 100;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: HEADERS, body: 'Method Not Allowed' };

  try {
    const { filename, filesize, mimetype, password } = JSON.parse(event.body || '{}');

    if (!filename || !filesize)
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Faltan parámetros (filename, filesize).' }) };

    if (filesize > MAX_MB * 1024 * 1024)
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: `Archivo demasiado grande. Máximo ${MAX_MB} MB.` }) };

    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // ID corto y legible (12 chars hex)
    const id  = crypto.randomBytes(6).toString('hex');
    const ext = filename.includes('.') ? filename.split('.').pop().toLowerCase().slice(0, 10) : 'bin';
    const storagePath = `${id}.${ext}`;
    const expiresAt   = new Date(Date.now() + 48 * 3600 * 1000).toISOString();

    // Crear URL firmada de subida (el browser sube directamente a Supabase)
    const { data: urlData, error: urlErr } = await sb.storage
      .from('transfers')
      .createSignedUploadUrl(storagePath);

    if (urlErr) return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: urlErr.message }) };

    // Hash de contraseña opcional (PBKDF2, salt = id)
    const password_hash = password ? hashPassword(password, id) : null;

    // Guardar metadatos en la tabla transfers
    const { error: dbErr } = await sb.from('transfers').insert({
      id, filename, filesize,
      mimetype:      mimetype || 'application/octet-stream',
      storage_path:  storagePath,
      expires_at:    expiresAt,
      password_hash,
    });

    if (dbErr) return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: dbErr.message }) };

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ transferId: id, signedUrl: urlData.signedUrl, token: urlData.token }),
    };
  } catch (e) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: e.message }) };
  }
};
