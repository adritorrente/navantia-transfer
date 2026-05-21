// get-file.js — devuelve info del archivo y URL firmada de descarga
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100_000, 32, 'sha256').toString('hex');
}

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS };

  try {
    const id = event.queryStringParameters?.id;
    if (!id) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'ID requerido.' }) };

    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    const { data: transfer, error } = await sb
      .from('transfers').select('*').eq('id', id).single();

    if (error || !transfer)
      return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'Archivo no encontrado.' }) };

    if (new Date(transfer.expires_at) < new Date())
      return { statusCode: 410, headers: HEADERS, body: JSON.stringify({ error: 'Este enlace ha expirado y el archivo fue eliminado.' }) };

    // ── Protección por contraseña ──────────────────────────
    if (transfer.password_hash) {
      const pw = event.queryStringParameters?.password;
      if (!pw) {
        // Devolver solo metadata básica; el cliente mostrará el formulario de clave
        return {
          statusCode: 200,
          headers: HEADERS,
          body: JSON.stringify({
            requiresPassword: true,
            filename:  transfer.filename,
            filesize:  transfer.filesize,
            expiresAt: transfer.expires_at,
          }),
        };
      }
      const hash = hashPassword(pw, transfer.id);
      if (hash !== transfer.password_hash) {
        return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Contraseña incorrecta.' }) };
      }
    }

    // URL firmada de descarga válida 10 minutos
    // Si tiene disfraz, el receptor descarga con el nombre camuflado
    const downloadName = transfer.disguise_name || transfer.filename;
    const { data: dlData, error: dlErr } = await sb.storage
      .from('transfers')
      .createSignedUrl(transfer.storage_path, 600, {
        download: downloadName,
      });

    if (dlErr) return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: dlErr.message }) };

    // Incrementar contador
    await sb.from('transfers')
      .update({ download_count: (transfer.download_count || 0) + 1 })
      .eq('id', id);

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({
        filename:      transfer.filename,
        filesize:      transfer.filesize,
        mimetype:      transfer.mimetype,
        expiresAt:     transfer.expires_at,
        downloadCount: transfer.download_count || 0,
        downloadUrl:   dlData.signedUrl,
        disguiseName:  transfer.disguise_name || null,
      }),
    };
  } catch (e) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: e.message }) };
  }
};
