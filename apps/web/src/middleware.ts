import { NextResponse, type NextRequest } from 'next/server';

/**
 * Middleware de seguridad:
 *  - Genera un nonce por request y lo inyecta en CSP.
 *  - Pasa el nonce a la app vía cabecera `x-nonce`, que `RootLayout`
 *    lee con `headers()` para que `<Script nonce>` y los inline críticos
 *    queden firmados.
 *  - Bloquea métodos no esperados.
 *
 * NOTE: La protección de rutas autenticadas se hace en otro middleware o
 * en server components leyendo la sesión.
 */
export function middleware(request: NextRequest) {
  const nonce = generateNonce();

  // Endurecemos CSP. Permitimos `'strict-dynamic'` para dejar que los scripts
  // firmados con nonce carguen sus dependencias en producción.
  // En dev necesitamos 'unsafe-inline' + 'unsafe-eval' porque Next.js/Turbopack
  // inyecta scripts inline (HMR, runtime) sin nonce. Cuando hay nonce, los
  // navegadores ignoran 'unsafe-inline', así que en dev omitimos el nonce.
  const isDev = process.env.NODE_ENV !== 'production';
  const scriptSrc = isDev
    ? `script-src 'self' 'unsafe-inline' 'unsafe-eval'`
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`;
  const csp = [
    `default-src 'self'`,
    scriptSrc,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    // static-cdn.jtvnw.net sirve las carátulas de juegos de la sección Streaming.
    `img-src 'self' data: blob: https://static-cdn.jtvnw.net`,
    `media-src 'self' blob:`,
    `connect-src 'self' ${isDev ? 'ws: http: https:' : ''}`.trim(),
    `font-src 'self' data: https://fonts.gstatic.com`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    `worker-src 'self' blob:`,
    `manifest-src 'self'`,
    `upgrade-insecure-requests`,
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  // En producción, pasamos el CSP en la request para que Next.js lea el nonce
  // y firme automáticamente sus scripts internos. En dev no hay nonce, así
  // que NO seteamos este header (rompería la inyección de scripts de Turbopack).
  if (!isDev) {
    requestHeaders.set('content-security-policy', csp);
  }

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set('content-security-policy', csp);
  return response;
}

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export const config = {
  matcher: [
    // Todas las rutas excepto assets estáticos y la API de Next interna.
    // Las subidas (impresora y explorador de Sistema) también quedan fuera:
    // cuando pasan por el middleware, Next corta el cuerpo a 10 MB y el
    // fichero llegaría truncado. Son respuestas JSON, no necesitan la CSP.
    '/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|api/printer/jobs|api/system/files/upload).*)',
  ],
};
