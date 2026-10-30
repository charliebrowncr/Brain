// Canavida — Cloudflare Worker (API del asistente)
// Rutas: GET /api/reserva?nombre=&apellidos=   POST /api/chat
// Secretos: LODGIFY_API_KEY   Bindings: AI (Workers AI), DB (D1)

import APP_HTML from './index.html';

const WAZE = 'https://www.waze.com/en/live-map/directions/cr/provincia-de-puntarenas/uvita/canavida-villas-and-resort?place=ChIJz3gMGphXoY8R1QERaYsYZdg';
const norm = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json' } });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/api/reserva') return reserva(url, env);
    if (url.pathname === '/api/chat' && req.method === 'POST') return chat(await req.json(), env);
    return new Response(APP_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function lodgify(path, env) {
  for (let intento = 0; intento < 3; intento++) {
    const r = await fetch('https://api.lodgify.com' + path, {
      headers: { 'X-ApiKey': env.LODGIFY_API_KEY.trim(), accept: 'application/json' }
    });
    if (r.status === 429) { await sleep((Number(r.headers.get('retry-after')) || 2) * 1000); continue; }
    if (!r.ok) throw new Error('Lodgify respondió ' + r.status + (r.status === 401 ? ' (clave incorrecta)' : ''));
    return r.json();
  }
  throw new Error('Lodgify está limitando las consultas, intente en unos minutos');
}

// Lista de reservas (en curso + próximas), guardada 10 minutos en D1 para no saturar Lodgify
async function reservas(env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS cache (k TEXT PRIMARY KEY, v TEXT, t INTEGER)').run();
  const row = await env.DB.prepare('SELECT v, t FROM cache WHERE k = ?').bind('bookings').first();
  if (row && Date.now() - row.t < 10 * 60 * 1000) return JSON.parse(row.v);
  const items = [];
  for (const filtro of ['Current', 'Upcoming']) {
    for (let page = 1; page <= 4; page++) {
      const d = await lodgify(`/v2/reservations/bookings?stayFilter=${filtro}&page=${page}&size=50&includeExternal=true`, env);
      const list = d.items || [];
      for (const b of list) {
        const room = b.rooms?.[0] || {};
        items.push({
          id: b.id, name: b.guest?.name || '', arrival: b.arrival, departure: b.departure,
          villa: room.name || b.property_name || 'Canavida',
          guests: room.guest_breakdown ? (room.guest_breakdown.adults || 0) + (room.guest_breakdown.children || 0) : (room.people || 1)
        });
      }
      if (list.length < 50) break;
    }
  }
  await env.DB.prepare('INSERT OR REPLACE INTO cache (k, v, t) VALUES (?, ?, ?)').bind('bookings', JSON.stringify(items), Date.now()).run();
  return items;
}

async function reserva(url, env) {
  const nombre = norm(url.searchParams.get('nombre'));
  const apellidos = norm(url.searchParams.get('apellidos'));
  if (!nombre || !apellidos) return json({ notFound: true });
  if (!env.LODGIFY_API_KEY) return json({ error: 'Falta el secreto LODGIFY_API_KEY en Cloudflare' }, 500);
  let items;
  try { items = await reservas(env); } catch (e) { return json({ error: e.message }, 502); }
  const partes = apellidos.split(/\s+/).filter(Boolean);
  const b = items.find(x => { const n = norm(x.name); return n.includes(nombre) && partes.some(a => n.includes(a)); });
  if (!b) return json({ notFound: true, revisadas: items.length });
  const [first, ...rest] = b.name.trim().split(/\s+/);
  return json({ first, last: rest.join(' '), villa: b.villa, arrival: b.arrival, departure: b.departure, guests: b.guests, code: String(b.id) });
}

async function chat({ reserva: r, messages = [] }, env) {
  // "Aprendizaje": el equipo agrega respuestas a la tabla knowledge (D1) y el asistente las usa.
  const { results: kb = [] } = await env.DB.prepare('SELECT pregunta, respuesta FROM knowledge ORDER BY id DESC LIMIT 40').all();
  const system = `Eres el asistente de pre-llegada de Canavida Villas & Resort (Uvita, Costa Rica). Responde breve, cálido, en el idioma del huésped, sin emojis.
Huésped: ${r?.first} ${r?.last}. Villa: ${r?.villa}. Llegada: ${r?.arrival}. Salida: ${r?.departure}. Huéspedes: ${r?.guests}.
Ruta Waze: ${WAZE}. IMPORTANTE: 1) Tomar la entrada frente a Mystic Sushi o la entrada de Invictus. 2) Recomendable 4x4 pero la calle está en buen estado.
Nunca des precios de tours; el equipo los confirma al reservar.
Conocimiento del equipo:\n${kb.map(k => `- ${k.pregunta}: ${k.respuesta}`).join('\n')}
Si no sabes algo, dilo y ofrece pasar la consulta al equipo.`;
  const out = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
    messages: [{ role: 'system', content: system }, ...messages.slice(-12)]
  });
  const last = messages[messages.length - 1]?.content || '';
  await env.DB.prepare('INSERT INTO conversaciones (reserva, pregunta, respuesta, fecha) VALUES (?, ?, ?, ?)')
    .bind(r?.code || '', last, out.response, new Date().toISOString()).run();
  return json({ reply: out.response });
}
