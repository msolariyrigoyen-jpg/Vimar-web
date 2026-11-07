# Activar el pago online

Este servidor crea el cobro en Mercado Pago, verifica cada pago y genera los datos del ticket. Mientras `BOOKING_API` esté vacío en `js/main.js`, el sitio sigue enviando todo por WhatsApp.

Las credenciales nunca van en el código, porque el repositorio es público.

## 1. Cuentas
- **Mercado Pago de VIMAR:** en [Tus integraciones](https://www.mercadopago.com.ar/developers/panel/app), crear una aplicación de Checkout Pro. Da credenciales de prueba y de producción.
- **Cloudflare:** cuenta gratuita, para el servidor y la base de datos KV.
- **Resend:** cuenta gratuita registrada con vimartraslados@gmail.com, para el aviso de reservas pagadas. Con la dirección de prueba de Resend solo se puede enviar al email de la cuenta.

## 2. Publicar el servidor
Requiere [Node.js](https://nodejs.org). Desde la carpeta `worker`:

```
npx wrangler login
npx wrangler kv namespace create RESERVAS
```

Copiar el `id` que muestra el segundo comando en `wrangler.toml`, y después:

```
npx wrangler secret put MP_ACCESS_TOKEN
npx wrangler secret put RESEND_API_KEY
npx wrangler deploy
```

Usar primero el Access Token **de prueba** de Mercado Pago. `deploy` muestra la dirección del servidor, por ejemplo `https://vimar-reservas.<cuenta>.workers.dev`.

## 3. Conectar el sitio
En `js/main.js`, poner esa dirección en `BOOKING_API`, sin barra final.

## 4. Probar sin dinero real
Con el token de prueba, hacer estas compras con las tarjetas de prueba de Mercado Pago:
- Pago aprobado: aparece el ticket y llega el email a VIMAR.
- Pago rechazado: no aparece el ticket.
- Pago devuelto: el ticket deja de ser válido.

## 5. Pasar a cobros reales
```
npx wrangler secret put MP_ACCESS_TOKEN
```
Cargar el Access Token **de producción** y hacer un pago real de punta a punta.

## Cambiar precios
Cambiarlos en dos lugares: `SERVICES` en `worker/index.js` (lo que se cobra; requiere `npx wrangler deploy`) y `PRICES` en `js/main.js` (lo que ve el cliente).
