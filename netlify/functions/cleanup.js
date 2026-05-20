// cleanup.js — elimina archivos expirados (se ejecuta cada hora automáticamente)
const { createClient } = require('@supabase/supabase-js');

exports.handler = async () => {
  console.log('[cleanup] Iniciando limpieza de archivos expirados...');
  try {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // Buscar todos los transfers expirados
    const { data: expired, error: fetchErr } = await sb
      .from('transfers')
      .select('id, storage_path, filename')
      .lt('expires_at', new Date().toISOString());

    if (fetchErr) throw fetchErr;

    if (!expired || expired.length === 0) {
      console.log('[cleanup] No hay archivos expirados.');
      return { statusCode: 200 };
    }

    console.log(`[cleanup] Eliminando ${expired.length} archivo(s)...`);

    // Eliminar del storage
    const paths = expired.map(t => t.storage_path);
    const { error: stErr } = await sb.storage.from('transfers').remove(paths);
    if (stErr) console.error('[cleanup] Error en storage:', stErr.message);

    // Eliminar de la tabla
    const ids = expired.map(t => t.id);
    const { error: dbErr } = await sb.from('transfers').delete().in('id', ids);
    if (dbErr) throw dbErr;

    expired.forEach(t => console.log(`  ✓ ${t.filename} (${t.id})`));
    console.log(`[cleanup] Limpiezas completadas: ${expired.length}`);
    return { statusCode: 200 };
  } catch (e) {
    console.error('[cleanup] Error:', e.message);
    return { statusCode: 500 };
  }
};
