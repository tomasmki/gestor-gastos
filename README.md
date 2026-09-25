# Gestor de gastos

App web personal para ver en un solo lugar lo que gastás:

- **Tarjeta Santander**: lee de tu Gmail los avisos de consumo que manda el banco.
- **Splitwise**: trae los gastos compartidos y cuenta **tu parte** (aunque haya pagado otro).
- **Mercado Pago**: lee los mails de pagos/transferencias y permite importar un CSV.

Los gastos que llegan por más de una vía se detectan como duplicados y no se cuentan dos veces
(ver [Cómo se evitan los duplicados](#cómo-se-evitan-los-duplicados)).

Está pensada para correr **en tu compu** (`localhost`): los datos quedan en un archivo SQLite
local (`data/gastos.db`) y no hay servidores de terceros en el medio.

## Puesta en marcha

Requisitos: Node.js 22 o superior.

```bash
npm install
cp .env.example .env.local   # completá los valores (ver abajo)
npm run dev                  # http://localhost:3000
```

Después, en la app: **Conexiones → Conectar Gmail → Sincronizar ahora**.

Otros comandos: `npm test` (tests), `npm run typecheck`, `npm run build && npm start` (modo producción).

## Configuración

### 1. Gmail (avisos de Santander y Mercado Pago)

La app usa la API oficial de Gmail con permiso de **solo lectura**. Hay que crear credenciales
propias en Google Cloud (es gratis):

1. Entrá a <https://console.cloud.google.com/> y creá un proyecto (p. ej. "gestor-gastos").
2. **APIs y servicios → Biblioteca** → buscá **Gmail API** → **Habilitar**.
3. **Google Auth Platform** (pantalla de consentimiento OAuth):
   - Tipo de usuario: **Externo**. Nombre de la app y tu mail como contacto.
   - En **Público / Audience**, agregá tu cuenta de Gmail como **usuario de prueba**.
4. **Clientes / Credenciales → Crear ID de cliente OAuth** → tipo **Aplicación web**.
   - URI de redireccionamiento autorizado: `http://localhost:3000/api/auth/google/callback`
5. Copiá el *Client ID* y el *Client secret* a `.env.local` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`).

> **Ojo con el modo "Testing"**: mientras la app de Google esté en modo prueba, Google vence el
> acceso cada 7 días y hay que tocar "Conectar Gmail" de nuevo (la app te avisa). Para evitarlo
> podés pasarla a "En producción" sin verificarla: al conectar, Google muestra un aviso de "app no
> verificada" que para uso personal podés aceptar (Avanzado → Ir a la app).

### 2. Santander: que te llegue un mail por cada consumo

Los avisos por mail se configuran desde Online Banking (alertas de consumo con tarjeta de crédito).
Santander trae un **monto mínimo** para avisar (por defecto era de $150.000): bajalo lo más posible
para que llegue un aviso por cada compra; si no, las compras chicas no van a aparecer.

La app busca en Gmail con `from:santander` (se puede cambiar con `SANTANDER_GMAIL_QUERY`).

### 3. Splitwise

1. Entrá a <https://secure.splitwise.com/apps> y tocá **Register your application**
   (nombre y descripción cualquiera; homepage `http://localhost:3000`).
2. En la app registrada, generá una **API key** ("Create API key").
3. Pegala en `.env.local` como `SPLITWISE_API_KEY`.

De cada gasto de Splitwise cuenta **tu parte** (`owed_share`). Los "pagos" (cuando alguien salda
una deuda) no se cuentan porque no son consumo.

### 4. Mercado Pago

Mercado Pago no ofrece una API para ver los pagos que hacés **como usuario** (sus APIs y reportes
están pensados para vendedores que cobran). Por eso hay dos caminos, combinables:

- **Mails (automático)**: si Mercado Pago te manda un mail por cada pago/transferencia, se leen al
  sincronizar Gmail (búsqueda `from:mercadopago`, configurable con `MERCADOPAGO_GMAIL_QUERY`).
  Las transferencias a personas se importan **ignoradas**, porque muchas veces son para saldar
  deudas (que ya cuenta Splitwise); podés tocar "Contar" si alguna era un gasto (p. ej. el alquiler).
- **CSV (manual)**: exportá la actividad desde la web de Mercado Pago e importala en
  **Conexiones → Mercado Pago**. El importador detecta las columnas de fecha, descripción e importe
  por su nombre; si no las reconoce, te muestra los encabezados que encontró.

Los pagos que hacés **en Mercado Pago con la tarjeta Santander** igual llegan por el aviso de
Santander (el comercio aparece como `MERPAGO*...`), así que ese caso ya está cubierto.

## Cómo se evitan los duplicados

Un mismo gasto puede aparecer por más de una fuente. Cuando pasa, el movimiento "cubierto" se
vincula al que tiene el dato correcto y deja de sumar (se ve tachado, con la explicación):

| Situación | Qué cuenta |
|---|---|
| Pagaste la cena ($40.000) con la tarjeta y la cargaste en Splitwise dividida en 4 | Solo tu parte en Splitwise ($10.000); el aviso de Santander queda vinculado |
| Pagó un amigo y te cargó tu parte en Splitwise | Tu parte en Splitwise |
| Pagaste en Mercado Pago con la tarjeta Santander | El pago de Mercado Pago; el aviso `MERPAGO*` queda vinculado |
| Compra con tarjeta que no está en Splitwise | El aviso de Santander |

El vínculo se hace solo cuando coinciden moneda, importe (±1%) y fecha (±5 días con Splitwise,
±3 con Mercado Pago). Si alguno está mal, tocá **Desvincular**; también podés **Ignorar** cualquier
movimiento para que no sume.

## Ajustar la lectura de mails

El formato exacto de los mails de Santander y Mercado Pago no está documentado, así que los
parsers (`src/lib/email/santander.ts` y `src/lib/email/mercadopago.ts`) son heurísticos: buscan el
importe, el comercio y la tarjeta en varias formas posibles. Los mails que parecen gastos pero no
se pudieron interpretar aparecen en **Conexiones → Mails sin procesar**, con el texto completo.

Para mejorar un parser: copiá el texto de uno de esos mails (tapando datos sensibles) como caso de
test en `src/lib/email/parsers.test.ts`, ajustá el parser hasta que pase y tocá **Reprocesar mails
guardados** (vuelve a leer los mails ya descargados, sin pedirlos de nuevo a Gmail).

## Privacidad y seguridad

- `data/gastos.db` tiene tus gastos, el texto de los mails procesados y el token de acceso a Gmail:
  no lo compartas ni lo subas al repo (ya está en `.gitignore`, igual que `.env.local`).
- La app no tiene login porque está pensada para correr solo en `localhost` (`npm run dev` escucha
  únicamente en `localhost`). **No la publiques en internet sin agregarle autenticación.**
- "Desconectar" en Gmail borra el token local y revoca el permiso en Google.

## Estructura

```
src/
  app/                  páginas (Resumen, Conexiones), server actions y OAuth de Google
  lib/
    db.ts               SQLite (esquema y conexión)
    transactions.ts     movimientos, totales y resumen mensual
    matching.ts         detección de duplicados entre fuentes
    gmail.ts            OAuth + API de Gmail
    email/              parsers de mails (Santander, Mercado Pago)
    splitwise.ts        API de Splitwise
    csv-import.ts       importador de CSV
    sync.ts             orquesta la sincronización
    categories.ts       categorías automáticas por comercio
```
