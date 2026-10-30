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

async function reserva(url, env) {
  const nombre = norm(url.searchParams.get('nombre'));
  const apellidos = norm(url.searchParams.get('apellidos'));
  if (!nombre || !apellidos) return json({ notFound: true });
  // Reservas próximas de Lodgify (API v2)
  const r = await fetch('https://api.lodgify.com/v2/reservations/bookings?stayFilter=Upcoming&size=100&includeExternal=true', {
    headers: { 'X-ApiKey': env.LODGIFY_API_KEY, accept: 'application/json' }
  });
  if (!r.ok) return json({ error: 'lodgify' }, 502);
  const { items = [] } = await r.json();
  const b = items.find(x => {
    const n = norm(x.guest?.name);
    return n.includes(nombre) && apellidos.split(/\s+/).some(a => n.includes(a));
  });
  if (!b) return json({ notFound: true });
  const [first, ...rest] = (b.guest.name || '').split(' ');
  return json({
    first, last: rest.join(' '),
    villa: b.rooms?.[0]?.name || b.property_name || 'Canavida',
    arrival: b.arrival, departure: b.departure,
    guests: b.rooms?.[0]?.people || b.guests || 1,
    code: String(b.id)
  });
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
