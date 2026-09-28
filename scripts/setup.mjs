// Configuración inicial: pregunta las credenciales y escribe .env.local.
// Uso: npm run setup

import fs from "node:fs";
import readline from "node:readline";

const [major] = process.versions.node.split(".").map(Number);
if (major < 22) {
  console.error(`Necesitás Node.js 22 o más nuevo (tenés ${process.versions.node}). Bajalo de https://nodejs.org`);
  process.exit(1);
}

// Se leen las líneas con un iterador para no perder ninguna si la entrada llega de golpe.
const rl = readline.createInterface({ input: process.stdin });
const lines = rl[Symbol.asyncIterator]();
async function ask(question) {
  process.stdout.write(question);
  const { value, done } = await lines.next();
  // Al arrastrar un archivo a la terminal se pega la ruta entre comillas.
  return done ? "" : value.trim().replace(/^["']|["']$/g, "");
}

let env = fs.readFileSync(fs.existsSync(".env.local") ? ".env.local" : ".env.example", "utf8");
function set(key, value) {
  const line = `${key}=${value}`;
  env = new RegExp(`^${key}=.*$`, "m").test(env) ? env.replace(new RegExp(`^${key}=.*$`, "m"), line) : `${env}\n${line}\n`;
}

console.log("\nConfiguración del gestor de gastos\n");

// Se acepta el Client ID o la ruta al JSON que descarga Google ("Download JSON").
let clientId = await ask("Google Client ID (o arrastrá acá el JSON que descargaste de Google): ");
let clientSecret = "";
if (clientId.toLowerCase().endsWith(".json")) {
  try {
    const json = JSON.parse(fs.readFileSync(clientId, "utf8"));
    const creds = json.web ?? json.installed ?? {};
    clientId = creds.client_id ?? "";
    clientSecret = creds.client_secret ?? "";
    console.log("  ✓ Leí el Client ID y el Client secret del JSON");
  } catch (e) {
    console.error(`  No pude leer el JSON: ${e.message}`);
    process.exit(1);
  }
}
if (!clientId.endsWith(".apps.googleusercontent.com")) {
  console.warn("  ⚠ El Client ID suele terminar en .apps.googleusercontent.com: revisá que esté completo.");
}
if (!clientSecret) clientSecret = await ask("Google Client secret: ");
const splitwiseKey = await ask("Splitwise API key (opcional, Enter para saltear): ");
rl.close();

if (!clientId || !clientSecret) {
  console.error("\nFaltan el Client ID o el Client secret; no se guardó nada.");
  process.exit(1);
}
set("GOOGLE_CLIENT_ID", clientId);
set("GOOGLE_CLIENT_SECRET", clientSecret);
if (splitwiseKey) set("SPLITWISE_API_KEY", splitwiseKey);
fs.writeFileSync(".env.local", env);

console.log(`
✓ Guardado en .env.local

Siguiente paso:
  npm run dev
y abrí http://localhost:3000/conexiones → "Conectar Gmail".
`);
