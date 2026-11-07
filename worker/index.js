/*
 * VIMAR Traslados: servidor de reservas y pagos (Cloudflare Worker).
 *
 * El precio se decide acá, nunca en el navegador, y una reserva solo pasa a "paid"
 * después de consultarle el pago directamente a Mercado Pago.
 *
 * Configuración (ver LEEME.md):
 *   MP_ACCESS_TOKEN  secreto: credencial de la cuenta de Mercado Pago de VIMAR
 *   RESEND_API_KEY   secreto: para avisarle a VIMAR por email de cada reserva pagada
 *   NOTIFY_EMAIL     email que recibe las reservas pagadas
 *   SITE_URL         dirección del sitio, sin barra final
 *   RESERVAS         base de datos KV de Cloudflare
 */

const SERVICES = {
  "aeropuerto-madryn": { name: "Traslado Aeropuerto de Puerto Madryn", price: 45000 },
  "aeropuerto-trelew": { name: "Traslado Aeropuerto de Trelew", price: 150000 },
};

const MP_API = "https://api.mercadopago.com";
const DAY = 24 * 60 * 60;
const PENDING_TTL = 7 * DAY; // sin pagar: se borra sola a la semana
const AFTER_TRIP_TTL = 30 * DAY; // pagada: se borra 30 días después del viaje
const CHECKOUT_MINUTES = 120; // tiempo para completar el pago

const json = (body, status, cors) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...cors },
  });

// Fecha de hoy en Argentina (aaaa-mm-dd), sin depender de la zona horaria del servidor
const todayInArgentina = () => new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);

const clean = (value, max) =>
  String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, max);

function parseBooking(raw) {
  const service = SERVICES[raw?.servicio] ? raw.servicio : "";
  const booking = {
    nombre: clean(raw?.nombre, 120),
    servicio: service,
    vuelo: clean(raw?.vuelo, 20).toUpperCase(),
    origen: clean(raw?.origen, 200),
    destino: clean(raw?.destino, 200),
    fecha: clean(raw?.fecha, 10),
    hora: clean(raw?.hora, 5),
    pasajeros: clean(raw?.pasajeros, 2),
    contacto: clean(raw?.contacto, 120),
    mensaje: String(raw?.mensaje ?? "").trim().slice(0, 1000),
  };

  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(booking.fecha) && !Number.isNaN(Date.parse(booking.fecha));
  const valid =
    booking.nombre &&
    service &&
    booking.origen &&
    booking.destino &&
    validDate &&
    booking.fecha >= todayInArgentina() &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(booking.hora) &&
    /^[1-3]$/.test(booking.pasajeros) && // máximo 3 pasajeros por viaje, con el mismo precio

    booking.contacto;
  return valid ? booking : null;
}

// Código corto para hablar de la reserva, sin caracteres que se confunden (0/O, 1/I)
function ticketCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return "VIM-" + [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

async function createBooking(request, env, cors) {
  let raw;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "invalid_request" }, 400, cors);
  }
  const booking = parseBooking(raw);
  if (!booking) return json({ error: "invalid_booking" }, 422, cors);

  const service = SERVICES[booking.servicio];
  const id = crypto.randomUUID();
  const record = {
    id,
    code: ticketCode(),
    status: "pending",
    amount: service.price,
    serviceName: service.name,
    createdAt: new Date().toISOString(),
    booking,
  };
  // Se guarda antes de cobrar: un pago nunca puede llegar sin sus datos
  await saveRecord(env, record);

  const ticketUrl = `${env.SITE_URL}/ticket.html?id=${id}`;
  const workerUrl = new URL(request.url).origin;
  // Hora de Argentina con su huso, el formato que pide Mercado Pago
  const expiresAt = new Date(Date.now() + CHECKOUT_MINUTES * 60 * 1000 - 3 * 60 * 60 * 1000)
    .toISOString()
    .replace("Z", "-03:00");

  const response = await fetch(`${MP_API}/checkout/preferences`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.MP_ACCESS_TOKEN}`,
      "content-type": "application/json",
      "x-idempotency-key": id,
    },
    body: JSON.stringify({
      items: [{ id: booking.servicio, title: service.name, quantity: 1, unit_price: service.price, currency_id: "ARS" }],
      external_reference: id,
      back_urls: { success: ticketUrl, pending: ticketUrl, failure: ticketUrl },
      auto_return: "approved",
      notification_url: `${workerUrl}/api/mp/webhook`,
      statement_descriptor: "VIMAR TRASLADOS",
      // Sin pago en efectivo: se acredita días después y el viaje puede ser antes
      payment_methods: { excluded_payment_types: [{ id: "ticket" }, { id: "atm" }] },
      expires: true,
      expiration_date_to: expiresAt,
    }),
  });
  if (!response.ok) {
    console.error("Mercado Pago rechazó la preferencia", response.status, await response.text());
    return json({ error: "payment_unavailable" }, 502, cors);
  }
  const preference = await response.json();
  return json({ id, checkoutUrl: preference.init_point }, 201, cors);
}

async function saveRecord(env, record) {
  // La fecha del viaje se toma como UTC: alcanza, porque el margen es de 30 días
  const expiration =
    record.status === "pending"
      ? Math.floor(Date.now() / 1000) + PENDING_TTL
      : Math.floor(Date.parse(record.booking.fecha) / 1000) + AFTER_TRIP_TTL;
  await env.RESERVAS.put(`reserva:${record.id}`, JSON.stringify(record), { expiration });
}

const loadRecord = (env, id) => env.RESERVAS.get(`reserva:${id}`, "json");

/*
 * Consulta el pago en Mercado Pago y actualiza la reserva.
 * Devuelve null si Mercado Pago no conoce ese pago; lanza un error si no se pudo consultar.
 */
async function syncPayment(env, paymentId, expectedBookingId) {
  const response = await fetch(`${MP_API}/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { authorization: `Bearer ${env.MP_ACCESS_TOKEN}` },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Mercado Pago respondió ${response.status}`);

  const payment = await response.json();
  const bookingId = payment.external_reference;
  // Un pago de otra reserva no puede confirmar esta
  if (!bookingId || (expectedBookingId && bookingId !== expectedBookingId)) return null;

  const record = await loadRecord(env, bookingId);
  if (!record) {
    console.error("Pago sin reserva guardada", payment.id, bookingId);
    return null;
  }

  if (payment.status === "approved") {
    if (payment.transaction_amount < record.amount || payment.currency_id !== "ARS") {
      console.error("Monto o moneda no coinciden", payment.id, payment.transaction_amount, payment.currency_id);
      return record;
    }
    if (record.status !== "paid") {
      record.status = "paid";
      record.paymentId = String(payment.id);
      record.paidAt = payment.date_approved || new Date().toISOString();
      await saveRecord(env, record);
      await notifyVimar(env, record);
    }
  } else if (["refunded", "charged_back"].includes(payment.status) && record.status === "paid") {
    // Si se devuelve el dinero, el ticket deja de figurar como pagado
    record.status = "refunded";
    await saveRecord(env, record);
  } else if (["rejected", "cancelled"].includes(payment.status) && record.status === "pending") {
    // Sigue pendiente: Mercado Pago deja reintentar con otra tarjeta
    record.lastAttempt = "rejected";
    await saveRecord(env, record);
  }
  return record;
}

// Un fallo del email no puede frenar la confirmación: el pago ya está hecho
async function notifyVimar(env, record) {
  if (!env.RESEND_API_KEY || !env.NOTIFY_EMAIL) {
    console.error("Reserva pagada sin aviso por email: falta configurar RESEND_API_KEY o NOTIFY_EMAIL", record.code);
    return;
  }
  const b = record.booking;
  const lines = [
    `Reserva pagada: ${record.code}`,
    `Total cobrado: $${record.amount.toLocaleString("es-AR")}`,
    `Pago de Mercado Pago: ${record.paymentId}`,
    "",
    `Pasajero: ${b.nombre}`,
    `Contacto: ${b.contacto}`,
    `Servicio: ${record.serviceName}`,
    b.vuelo ? `Vuelo: ${b.vuelo}` : "",
    `Origen: ${b.origen}`,
    `Destino: ${b.destino}`,
    `Fecha: ${b.fecha.split("-").reverse().join("/")}`,
    `Hora estimada: ${b.hora}`,
    `Pasajeros: ${b.pasajeros}`,
    b.mensaje ? `\nMensaje:\n${b.mensaje}` : "",
    "",
    "Hay que contactar al pasajero para confirmar el viaje.",
    `Ticket: ${env.SITE_URL}/ticket.html?id=${record.id}`,
  ];
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: "VIMAR Reservas <onboarding@resend.dev>",
        to: [env.NOTIFY_EMAIL],
        subject: `Reserva pagada ${record.code}: ${b.nombre}, ${b.fecha.split("-").reverse().join("/")} ${b.hora}`,
        text: lines.filter((line, i) => line !== "" || lines[i - 1] !== "").join("\n"),
      }),
    });
    if (!response.ok) console.error("No se pudo enviar el email", response.status, await response.text());
  } catch (error) {
    console.error("No se pudo enviar el email", error);
  }
}

// Mercado Pago avisa acá. El aviso no se toma como prueba: solo dispara la consulta del pago.
async function handleWebhook(request, env) {
  const url = new URL(request.url);
  let body = {};
  try {
    body = await request.json();
  } catch {
    // Algunos avisos traen los datos solo en la dirección
  }
  const type = body.type || url.searchParams.get("type") || url.searchParams.get("topic");
  const paymentId = body.data?.id || url.searchParams.get("data.id") || url.searchParams.get("id");
  if (type !== "payment" || !paymentId) return new Response("ok");

  try {
    await syncPayment(env, paymentId);
    return new Response("ok");
  } catch (error) {
    // Con un error, Mercado Pago vuelve a avisar más tarde
    console.error("Error al consultar el pago", paymentId, error);
    return new Response("retry", { status: 500 });
  }
}

async function getTicket(url, env, id, cors) {
  let record = await loadRecord(env, id);
  if (!record) return json({ error: "not_found" }, 404, cors);

  // Al volver de Mercado Pago el aviso puede no haber llegado: se consulta el pago de una vez
  const paymentId = url.searchParams.get("payment_id");
  if (record.status === "pending" && /^\d+$/.test(paymentId || "")) {
    try {
      record = (await syncPayment(env, paymentId, id)) || record;
    } catch (error) {
      console.error("Error al consultar el pago", paymentId, error);
    }
  }
  return json(
    {
      code: record.code,
      status: record.status,
      lastAttempt: record.lastAttempt || null,
      amount: record.amount,
      serviceName: record.serviceName,
      paidAt: record.paidAt || null,
      booking: record.booking,
    },
    200,
    cors
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      "access-control-allow-origin": env.SITE_URL,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      vary: "origin",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    try {
      if (url.pathname === "/api/mp/webhook" && request.method === "POST") return await handleWebhook(request, env);
      if (url.pathname === "/api/reservas" && request.method === "POST") return await createBooking(request, env, cors);

      const ticket = url.pathname.match(/^\/api\/reservas\/([0-9a-f-]{36})$/);
      if (ticket && request.method === "GET") return await getTicket(url, env, ticket[1], cors);

      return json({ error: "not_found" }, 404, cors);
    } catch (error) {
      console.error(error);
      return json({ error: "server_error" }, 500, cors);
    }
  },
};
