import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

if (!GEMINI_API_KEY) {
  console.warn("⚠️ Falta GEMINI_API_KEY en .env");
}

app.use(express.json({ limit: "15mb" }));
app.use(express.static("public"));

const shoppingSchema = {
  type: "OBJECT",
  properties: {
    local: { type: "STRING" },
    products: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          nombre: { type: "STRING" },
          cantidad: { type: "NUMBER" },
          precio: { type: "NUMBER" },
          moneda: { type: "STRING", enum: ["USD", "BS"] },
          tipoPrecio: { type: "STRING", enum: ["UNITARIO", "TOTAL"] }
        },
        required: ["nombre", "cantidad", "precio", "moneda", "tipoPrecio"]
      }
    }
  },
  required: ["local", "products"]
};

async function geminiGenerate(parts, { jsonSchema = null } = {}) {
  if (!GEMINI_API_KEY) throw new Error("El servidor no tiene configurada GEMINI_API_KEY.");

  const body = { contents: [{ role: "user", parts }] };

  if (jsonSchema) {
    body.generationConfig = {
      responseMimeType: "application/json",
      responseSchema: jsonSchema
    };
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY
      },
      body: JSON.stringify(body)
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || `Gemini HTTP ${response.status}`);
  }

  const text = data?.candidates?.[0]?.content?.parts
    ?.map(p => p.text || "")
    .join("")
    .trim();

  if (!text) throw new Error("Gemini no devolvió contenido.");
  return text;
}

function shoppingPrompt({ transcript, rate, defaultStore }) {
  return `
Eres un extractor de compras venezolanas. Convierte lenguaje hablado coloquial a datos estructurados.
NO converses, NO inventes productos y NO inventes precios.

TRANSCRIPCIÓN:
"""${transcript}"""

CONTEXTO:
- Tienda por defecto: "${defaultStore || "GENERAL"}"
- Tasa BCV informativa: ${rate} Bs/USD.
- NO conviertas monedas. Devuelve la moneda que realmente dijo el usuario.

REGLAS:
1. Tienda, producto, cantidad, precio y moneda pueden aparecer EN CUALQUIER ORDEN.
2. Una frase puede contener MUCHOS productos. Sepáralos correctamente.
3. "bolos", "bolívares", "bs" => BS.
4. "dólar", "dólares", "divisas", "verdes" => USD cuando expresen precio.
5. Interpreta: "dólar veinte"=1.20 USD; "uno con veinte"=1.20; "dólar y medio"=1.50; "dos y medio"=2.50; "dos con cincuenta"=2.50.
6. "dos harinas a un dólar" normalmente significa cantidad 2, precio unitario 1 USD.
7. "dos harinas por dos dólares", "todo por", "en total" normalmente significa precio TOTAL.
8. "cada uno", "cada una", "c/u", "a X" normalmente significa UNITARIO.
9. Si hay una repetición inmediata causada por reconocimiento de voz, NO dupliques el producto.
10. Si dos menciones son realmente compras diferentes, consérvalas.
11. Conserva la marca: "harina PAN" => HARINA PAN; "arroz Mary" => ARROZ MARY.
12. Devuelve nombres y local en MAYÚSCULAS.
13. Si no se menciona local, usa "${defaultStore || "GENERAL"}".
14. Si una cantidad no se menciona, usa 1.
15. Un precio debe asociarse al producto semánticamente más cercano y coherente, no por posición rígida.
16. Si el usuario corrige algo ("no, eran dos", "mejor a 150 bolos"), toma la corrección más reciente y no dupliques.

EJEMPLOS:
"En Forum dos harinas PAN a dólar veinte cada una, queso 150 bolos y tres refrescos a dos con cincuenta"
=> FORUM:
- HARINA PAN, 2, 1.20, USD, UNITARIO
- QUESO, 1, 150, BS, UNITARIO
- REFRESCO, 3, 2.50, USD, UNITARIO

"Leche 120 bolívares, dos pastas a dólar y medio y un aceite en 3 dólares, todo en Central Madeirense"
=> CENTRAL MADEIRENSE, tres productos separados.
`;
}

app.post("/api/parse-shopping", async (req, res) => {
  try {
    const { transcript, rate, defaultStore } = req.body || {};
    if (!String(transcript || "").trim()) {
      return res.status(400).json({ error: "Transcripción vacía." });
    }
    const text = await geminiGenerate(
      [{ text: shoppingPrompt({ transcript, rate, defaultStore }) }],
      { jsonSchema: shoppingSchema }
    );
    const result = JSON.parse(text);
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || "Error procesando voz." });
  }
});

app.post("/api/scan-receipt", async (req, res) => {
  try {
    const { imageDataUrl, rate, defaultStore } = req.body || {};
    const match = String(imageDataUrl || "").match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) return res.status(400).json({ error: "Imagen inválida." });

    const prompt = `
Analiza esta foto de una factura o ticket de compra venezolano.
Extrae local, productos, cantidades y precios. No inventes información.
Si el ticket muestra un precio por unidad, usa UNITARIO. Si solo muestra total de línea para varias unidades, usa TOTAL.
Usa USD solo si el ticket identifica claramente dólares; en otro caso usa BS.
Tienda por defecto si no se lee: "${defaultStore || "GENERAL"}".
La tasa ${rate} Bs/USD es solo contexto; NO conviertas monedas.
Nombres y local en MAYÚSCULAS.
`;

    const text = await geminiGenerate(
      [
        { text: prompt },
        { inline_data: { mime_type: match[1], data: match[2] } }
      ],
      { jsonSchema: shoppingSchema }
    );

    res.json(JSON.parse(text));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || "Error leyendo factura." });
  }
});

app.post("/api/assistant", async (req, res) => {
  try {
    const { question, cart = [], budget = 0, currency = "USD", rate = 1 } = req.body || {};
    if (!String(question || "").trim()) return res.status(400).json({ error: "Pregunta vacía." });

    const cartSummary = cart.slice(0, 80).map(x =>
      `${x.cant || 1} x ${x.nombre} - ${Number(x.tUSD || 0).toFixed(2)} USD / ${Number(x.tBS || 0).toFixed(2)} Bs`
    ).join("\n");

    const prompt = `
Eres el asistente de compras y cocina de Mercado Manu.
Responde en español venezolano claro, útil y breve.
No inventes precios externos ni información que no esté en el carrito.
Presupuesto: ${budget} ${currency}
Tasa: ${rate} Bs/USD

Carrito:
${cartSummary || "(vacío)"}

Pregunta:
${question}
`;

    const text = await geminiGenerate([{ text: prompt }]);
    res.json({ text });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || "Error del asistente." });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, model: GEMINI_MODEL, keyConfigured: Boolean(GEMINI_API_KEY) });
});

app.listen(PORT, () => {
  console.log(`Mercado Manu: http://localhost:${PORT}`);
});
