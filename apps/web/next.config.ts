import type { NextConfig } from 'next';
import path from 'path';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: 'standalone',
  // argon2 uses a native (.node) binary loaded via node-gyp-build's dynamic
  // require. @vercel/nft (Next.js file tracer) can't follow dynamic requires,
  // so the prebuilt binary never makes it into .next/standalone. Marking argon2
  // as external forces Next.js to copy the full package (prebuilds/ included)
  // and require() it at runtime from node_modules instead of bundling it.
  // drizzle-orm + postgres: also kept external so instrumentation.ts can import
  // them via dynamic import() at runtime (standalone node_modules path).
  serverExternalPackages: ['argon2', 'drizzle-orm', 'postgres'],
  experimental: {
    serverActions: {
      // Solo el origen oficial puede invocar Server Actions.
      allowedOrigins: process.env.APP_URL ? [new URL(process.env.APP_URL).host] : [],
    },
  },
  // Explicit redirect for next-intl/config → user's request config.
  // NormalModuleReplacementPlugin fires at beforeResolve (pre-resolution),
  // which is more reliable than resolve.alias for package subpath exports
  // in some webpack 5 + Next.js 16 environments.
  webpack(webpackConfig, { dir, webpack, dev, nextRuntime }) {
    webpackConfig.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /^next-intl\/config$/,
        path.resolve(dir, './src/i18n/request.ts'),
      ),
    );

    // Al existir un middleware, Next compila también `instrumentation.ts` para
    // el runtime Edge. Ahí no hay módulos `node:*`, así que webpack revienta al
    // seguir los import() dinámicos de postgres y del migrador de Drizzle
    // (UnhandledSchemeError). En `next build` no molesta, pero en `next dev`
    // ese fallo marca toda la compilación como rota y Next devuelve su página
    // de error 500 en TODAS las rutas.
    //
    // En Edge esos import() nunca llegan a ejecutarse: `register()` sale
    // pronto salvo que NEXT_RUNTIME sea 'nodejs'. Así que le decimos a webpack
    // que ni los resuelva. Sólo en desarrollo y sólo en la capa Edge, para no
    // alterar en nada la salida de producción: en producción Next resuelve
    // estos paquetes con su propio cargador de externos (`serverExternalPackages`),
    // y de eso dependen las migraciones al arrancar el contenedor.
    if (dev && nextRuntime === 'edge') {
      webpackConfig.plugins.push(
        new webpack.IgnorePlugin({
          resourceRegExp: /^(postgres|drizzle-orm\/postgres-js(\/migrator)?|node:(fs|path|crypto))$/,
        }),
      );
    }

    return webpackConfig;
  },
  // Las cabeceras de seguridad finas (CSP con nonce) se gestionan en
  // `src/middleware.ts`, donde podemos generar un nonce por request.
  // Aquí dejamos solo las estáticas que no dependen del nonce.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(self), microphone=(self), geolocation=(), interest-cohort=()',
          },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
    ];
  },
};

export default withNextIntl(config);
