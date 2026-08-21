# Mercado Manu

Proyecto PWA de compras con:
- carrito y presupuesto en USD/Bs;
- dictado de varios productos en una sola frase;
- interpretación coloquial venezolana mediante Gemini;
- eliminación de duplicados generados por reconocimiento provisional/final;
- escaneo de factura mediante cámara + Gemini;
- historial y lista de faltantes en localStorage;
- service worker para cargar la interfaz sin conexión;
- API key guardada en el servidor, no en el HTML.

## Requisitos
- Node.js 18 o superior.
- Una API key de Google Gemini.
- Para dictado por voz: Chrome/Chromium con permiso de micrófono. En Android funciona mejor instalado o abierto por HTTPS.

## Instalar
1. Copia `.env.example` a `.env`.
2. Coloca tu clave en `GEMINI_API_KEY`.
3. En la carpeta del proyecto ejecuta:
   npm install
4. Inicia:
   npm start
5. Abre:
   http://localhost:3000

## Instalar como app (PWA)
Para que Android muestre “Instalar app”, sirve el proyecto por HTTPS (por ejemplo desde Render, Railway, Fly.io u otro hosting Node compatible). Chrome podrá instalarlo desde su menú.

## Notas
- La interfaz puede abrirse offline después de la primera carga, pero las funciones Gemini y la tasa BCV necesitan internet.
- La API key nunca debe copiarse a `public/index.html`.
- `GEMINI_MODEL` puede cambiarse desde `.env` si Google retira o reemplaza el modelo.
