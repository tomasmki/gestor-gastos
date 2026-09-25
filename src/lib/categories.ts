export const CATEGORIES = [
  "Supermercado",
  "Comida y delivery",
  "Transporte",
  "Hogar y servicios",
  "Suscripciones",
  "Salud",
  "Compras",
  "Viajes",
  "Entretenimiento",
  "Transferencias",
  "Otros",
] as const;

export type Category = (typeof CATEGORIES)[number];

// Reglas por palabra clave sobre la descripción / nombre del comercio.
const RULES: [Category, RegExp][] = [
  ["Supermercado", /\b(coto|carrefour|dia|supermercado|supermercados|jumbo|disco|vea|changomas|chango mas|la anonima|walmart|makro|vital|diarco)\b/i],
  ["Comida y delivery", /\b(rappi|pedidos ?ya|mc ?donald'?s|burger king|mostaza|starbucks|havanna|cafe|resto|restaurant|parrilla|pizzeria|heladeria|cerveceria|grido|freddo)\b/i],
  ["Transporte", /\b(uber|cabify|didi|sube|ypf|shell|axion|puma energy|peaje|ausa|autopista|estacionamiento|parking)\b/i],
  ["Suscripciones", /\b(netflix|spotify|disney|hbo|prime video|amazon prime|youtube|apple\.com|icloud|google \*|chatgpt|openai|anthropic|claude\.ai|paramount|crunchyroll)\b/i],
  ["Hogar y servicios", /\b(edenor|edesur|metrogas|naturgy|aysa|telecom|movistar|claro|fibertel|telecentro|flow|expensas|abl|arba|agip)\b/i],
  ["Salud", /\b(farmacia|farmacity|osde|swiss medical|galeno|omint|medicus|hospital|clinica|odontolog)/i],
  ["Compras", /\b(mercadolibre|mercado libre|falabella|fravega|garbarino|musimundo|easy|sodimac|zara|nike|adidas|dexter|amazon)\b/i],
  ["Viajes", /\b(airbnb|booking|despegar|almundo|aerolineas|flybondi|jetsmart|latam|hotel|hostel)\b/i],
  ["Entretenimiento", /\b(cine|hoyts|cinemark|showcase|ticketek|all ?access|passline|steam|playstation|xbox|nintendo)\b/i],
  ["Transferencias", /\b(transferencia|transferiste|enviaste dinero)\b/i],
];

export function categorize(description: string): Category | null {
  for (const [category, re] of RULES) if (re.test(description)) return category;
  return null;
}

// Categorías de Splitwise (vienen en inglés desde la API).
const SPLITWISE: Record<string, Category> = {
  groceries: "Supermercado",
  "dining out": "Comida y delivery",
  liquor: "Comida y delivery",
  "food and drink": "Comida y delivery",
  taxi: "Transporte",
  "bus/train": "Transporte",
  car: "Transporte",
  "gas/fuel": "Transporte",
  parking: "Transporte",
  bicycle: "Transporte",
  transportation: "Transporte",
  plane: "Viajes",
  hotel: "Viajes",
  rent: "Hogar y servicios",
  mortgage: "Hogar y servicios",
  electricity: "Hogar y servicios",
  "heat/gas": "Hogar y servicios",
  water: "Hogar y servicios",
  "tv/phone/internet": "Hogar y servicios",
  cleaning: "Hogar y servicios",
  utilities: "Hogar y servicios",
  home: "Hogar y servicios",
  "household supplies": "Compras",
  furniture: "Compras",
  electronics: "Compras",
  clothing: "Compras",
  gifts: "Compras",
  "medical expenses": "Salud",
  movies: "Entretenimiento",
  music: "Entretenimiento",
  games: "Entretenimiento",
  sports: "Entretenimiento",
  entertainment: "Entretenimiento",
};

export function categorizeSplitwise(splitwiseCategory: string | undefined, description: string): Category {
  const mapped = splitwiseCategory ? SPLITWISE[splitwiseCategory.toLowerCase()] : undefined;
  return mapped ?? categorize(description) ?? "Otros";
}
