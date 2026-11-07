/* VIMAR Traslados — comportamiento compartido */

// Número de WhatsApp de VIMAR (formato internacional, sin + ni espacios): 280 505-3537
const WHATSAPP_NUMBER = "5492805053537";

const SERVICES = {
  "aeropuerto-madryn": "Aeropuerto de Puerto Madryn",
  "aeropuerto-trelew": "Aeropuerto de Trelew",
  mensajeria: "Mensajería (presentación de documentación)",
  otros: "Otro servicio (a cotizar)",
};
const AIRPORT_SERVICES = ["aeropuerto-madryn", "aeropuerto-trelew"];

// Links de pago de Mercado Pago (tarjeta de crédito o débito) por servicio
const PAY_LINKS = {
  "aeropuerto-madryn": "https://mpago.la/14FxNVs",
  "aeropuerto-trelew": "https://mpago.la/1Xnpk5W",
};

/* Menú mobile ------------------------------------------------------------ */
const navToggle = document.querySelector(".nav-toggle");
const nav = document.getElementById("site-nav");

if (navToggle && nav) {
  const setOpen = (open) => {
    navToggle.setAttribute("aria-expanded", String(open));
    navToggle.setAttribute("aria-label", open ? "Cerrar menú" : "Abrir menú");
    nav.classList.toggle("is-open", open);
  };
  navToggle.addEventListener("click", () => {
    setOpen(navToggle.getAttribute("aria-expanded") !== "true");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && nav.classList.contains("is-open")) {
      setOpen(false);
      navToggle.focus();
    }
  });
  window.matchMedia("(min-width: 861px)").addEventListener("change", (e) => {
    if (e.matches) setOpen(false);
  });
}

/* Animaciones de entrada al hacer scroll --------------------------------- */
const motionOK = window.matchMedia("(prefers-reduced-motion: no-preference)").matches;

// Texto y bloques que suben al entrar en pantalla (escalonados entre hermanos)
const REVEAL_TEXT = [
  ".planner__intro > :not(.planner__fallback)",
  ".planner__result",
  ".planner__cta",
  ".closing__body > *",
  ".service__body > *",
  ".quote-band .wrap > *",
  ".testimonials-head > *",
  ".marquee",
  ".contact > *",
  ".footer__logo",
  ".footer__grid > *",
];
// Fotos y recuadros que se descubren de arriba hacia abajo
const REVEAL_IMAGE = [".closing__media", ".service__media"];

// La clase se agrega desde acá (no en el HTML): si este script falla, nada queda oculto
if (motionOK && "IntersectionObserver" in window) {
  document.documentElement.classList.add("reveal-ready");

  const mark = (selectors, kind) => {
    document.querySelectorAll(selectors.join(",")).forEach((el) => {
      const siblings = [...el.parentElement.children].filter((s) => s.matches(selectors.join(",")));
      el.dataset.reveal = kind;
      el.style.setProperty("--reveal-delay", `${Math.min(siblings.indexOf(el), 5) * 80}ms`);
    });
  };
  mark(REVEAL_TEXT, "text");
  mark(REVEAL_IMAGE, "image");

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(({ isIntersecting, target }) => {
        if (!isIntersecting) return;
        observer.unobserve(target);
        target.classList.add("is-visible");
        // Al terminar se limpia, para que no interfiera con las transiciones de hover de botones
        setTimeout(() => {
          target.removeAttribute("data-reveal");
          target.classList.remove("is-visible");
          target.style.removeProperty("--reveal-delay");
        }, 1600);
      });
    },
    { threshold: 0.15, rootMargin: "0px 0px -8% 0px" }
  );
  document.querySelectorAll("[data-reveal]").forEach((el) => observer.observe(el));
}

/* Inicio: franja de testimonios ----------------------------------------- */
const marquee = document.querySelector("[data-marquee]");

// Solo se mueve si el visitante no pidió reducir movimiento; si no, queda la fila deslizable
if (marquee && motionOK) {
  const track = marquee.querySelector(".marquee__track");

  // Segunda copia de las tarjetas para que el recorrido sea continuo; se oculta a lectores de pantalla
  [...track.children].forEach((item) => {
    const copy = item.cloneNode(true);
    copy.setAttribute("aria-hidden", "true");
    track.appendChild(copy);
  });
  // Velocidad pareja (~40 px/s) sin importar cuántos testimonios haya
  const setDuration = () => {
    marquee.style.setProperty("--marquee-duration", `${track.scrollWidth / 2 / 40}s`);
  };
  setDuration();
  window.addEventListener("resize", setDuration);
  marquee.classList.add("is-running");
  // Sin botón de pausa (pedido expreso): se frena al pasar el mouse o con foco de teclado (ver CSS)
}

/* Home: ¿Adónde vas? ----------------------------------------------------- */
const planner = document.querySelector("[data-planner]");

// Cuenta desde el número que se ve hasta el nuevo
function countTo(el, target) {
  const to = Number(target);
  const from = Number(el.textContent) || 0;
  if (!motionOK || !to || from === to) {
    el.textContent = target;
    return;
  }
  const start = performance.now();
  const duration = 500;
  const step = (now) => {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

if (planner) {
  // Los radios también llevan data-route/data-km…, así que se busca solo dentro del panel
  const result = planner.querySelector(".planner__result");
  const out = {
    route: result.querySelector("[data-route]"),
    km: result.querySelector("[data-km]"),
    min: result.querySelector("[data-min]"),
    note: result.querySelector("[data-note]"),
    figures: result.querySelector("[data-figures]"),
    quote: result.querySelector("[data-quote]"),
    cta: planner.querySelector("[data-cta]"),
  };

  const render = (input, animate) => {
    const d = input.dataset;
    // Destino sin distancia conocida ("Otros destinos"): se muestra "A cotizar"
    const hasFigures = Boolean(d.km);
    out.route.textContent = d.route;
    if (animate && hasFigures && !out.figures.hidden) {
      countTo(out.km, d.km);
      countTo(out.min, d.min);
    } else {
      out.km.textContent = d.km;
      out.min.textContent = d.min;
    }
    out.figures.hidden = !hasFigures;
    out.quote.hidden = hasFigures;
    out.note.textContent = d.note;
    out.cta.href = `contacto.html?servicio=${d.service}`;

    if (animate) {
      // Reinicia la transición del panel en cada cambio de destino
      result.classList.remove("is-swapping");
      void result.offsetWidth;
      result.classList.add("is-swapping");
    }
  };

  planner.addEventListener("change", (e) => {
    if (e.target.matches("input[type=radio]")) render(e.target, true);
  });
  const checked = planner.querySelector("input[type=radio]:checked");
  if (checked) render(checked);
}

/* Contacto: formulario → WhatsApp ---------------------------------------- */
const form = document.getElementById("booking-form");

if (form) {
  const fields = {
    nombre: form.elements.nombre,
    servicio: form.elements.servicio,
    vuelo: form.elements.vuelo,
    origen: form.elements.origen,
    destino: form.elements.destino,
    fecha: form.elements.fecha,
    hora: form.elements.hora,
    pasajeros: form.elements.pasajeros,
    contacto: form.elements.contacto,
    mensaje: form.elements.mensaje,
  };
  const flightWrap = form.querySelector(".field--flight");
  const passengersWrap = form.querySelector(".field--passengers");
  const status = form.querySelector(".form__status");

  // Preselección desde ?servicio=
  const pre = new URLSearchParams(location.search).get("servicio");
  if (pre && SERVICES[pre]) fields.servicio.value = pre;

  const errorEl = (input) => document.getElementById(`${input.id}-error`);

  function setError(input, msg) {
    input.setAttribute("aria-invalid", "true");
    errorEl(input).textContent = msg;
  }
  function clearError(input) {
    input.removeAttribute("aria-invalid");
    errorEl(input).textContent = "";
  }

  // Campos que dependen del servicio: vuelo (opcional) solo en aeropuertos, pasajeros oculto en mensajería
  const syncByService = () => {
    const service = fields.servicio.value;
    const isAirport = AIRPORT_SERVICES.includes(service);
    flightWrap.hidden = !isAirport;

    const needsPassengers = service !== "mensajeria";
    passengersWrap.hidden = !needsPassengers;
    fields.pasajeros.required = needsPassengers;
    if (!needsPassengers) clearError(fields.pasajeros);
  };
  fields.servicio.addEventListener("change", syncByService);
  syncByService();

  // Fecha de hoy en formato aaaa-mm-dd (hora local): no se puede elegir un día anterior
  const pad = (n) => String(n).padStart(2, "0");
  const now = new Date();
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  fields.fecha.min = today;
  // aaaa-mm-dd → dd/mm/aaaa para el mensaje de WhatsApp
  const formatDate = (iso) => iso.split("-").reverse().join("/");

  const isEmail =(v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
  const isPhone = (v) => /^[+\d][\d\s()-]*$/.test(v) && v.replace(/\D/g, "").length >= 8;

  const validators = {
    nombre: (v) => (v ? "" : "Escribí tu nombre y apellido."),
    servicio: (v) => (v ? "" : "Elegí el tipo de servicio que necesitás."),
    vuelo: () => "", // opcional
    origen: (v) => (v ? "" : "Escribí desde dónde salimos: una dirección, un hotel o el aeropuerto."),
    destino: (v) => (v ? "" : "Escribí a dónde tenemos que llegar."),
    fecha: (v) => {
      if (!v) return "Indicá qué día es el traslado.";
      if (v < today) return "Elegí una fecha de hoy en adelante.";
      return "";
    },
    pasajeros: (v) => {
      if (!fields.pasajeros.required) return "";
      if (!v) return "Indicá cuántas personas viajan.";
      if (!/^\d+$/.test(v) || Number(v) < 1) return "Escribí un número entero, de 1 en adelante.";
      return "";
    },
    hora: (v) => (v ? "" : "Indicá a qué hora te pasamos a buscar (por ejemplo, 06:30)."),
    contacto: (v) => {
      if (!v) return "Dejanos un email o un teléfono para confirmarte la reserva.";
      if (!isEmail(v) && !isPhone(v))
        return "Revisá el dato: tiene que ser un email (nombre@correo.com) o un teléfono con código de área.";
      return "";
    },
    mensaje: () => "",
  };

  const validate = (name) => {
    const input = fields[name];
    const msg = validators[name](input.value.trim());
    msg ? setError(input, msg) : clearError(input);
    return !msg;
  };

  // Validar al salir del campo; si ya tenía error, revalidar mientras escribe
  Object.keys(fields).forEach((name) => {
    const input = fields[name];
    input.addEventListener("blur", () => validate(name));
    input.addEventListener("input", () => {
      if (input.getAttribute("aria-invalid") === "true") validate(name);
    });
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    status.textContent = "";
    const invalid = Object.keys(fields).filter((name) => !validate(name));
    if (invalid.length) {
      fields[invalid[0]].focus();
      return;
    }

    const v = (name) => fields[name].value.trim();
    const lines = [
      "Hola VIMAR Traslados, quiero hacer una consulta.",
      "",
      `Nombre y apellido: ${v("nombre")}`,
      `Servicio: ${SERVICES[v("servicio")]}`,
    ];
    if (!flightWrap.hidden && v("vuelo")) lines.push(`Número de vuelo: ${v("vuelo").toUpperCase()}`);
    lines.push(`Origen: ${v("origen")}`, `Destino: ${v("destino")}`);
    lines.push(`Fecha: ${formatDate(v("fecha"))}`, `Hora estimada: ${v("hora")}`);
    if (fields.pasajeros.required) lines.push(`Pasajeros: ${v("pasajeros")}`);
    lines.push(`Contacto: ${v("contacto")}`);
    if (v("mensaje")) lines.push("", v("mensaje"));

    const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(lines.join("\n"))}`;
    // Con "noopener" window.open siempre devuelve null, así que se corta el opener a mano
    const win = window.open(url, "_blank");
    if (win) win.opener = null;
    else location.href = url;
    status.textContent = "Abrimos WhatsApp con tu mensaje listo. Solo falta que lo envíes desde ahí.";

    // Después de completar los datos, se ofrece el pago con tarjeta del servicio elegido
    const payBox = document.getElementById("form-pay");
    const payLink = document.getElementById("pay-link");
    const link = PAY_LINKS[v("servicio")];
    if (payBox && payLink) {
      if (link) {
        payLink.href = link;
        payBox.style.display = "";
        payBox.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        payBox.style.display = "none";
      }
    }
  });
}
