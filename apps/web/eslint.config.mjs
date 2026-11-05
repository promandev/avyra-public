// Configuración plana de ESLint 9.
//
// Next 16 eliminó el subcomando `next lint`, así que `pnpm lint` llamaba a
// `next` con "lint" como si fuera un directorio y fallaba siempre. Ahora se
// invoca a `eslint` directamente y las reglas de Next llegan por su preset, que
// ya viene en formato plano (`eslint-config-next` exporta un array).
import next from 'eslint-config-next';
import nextTypescript from 'eslint-config-next/typescript';

const config = [
  ...next,
  ...nextTypescript,
  {
    // Ni la salida del build ni las dependencias se revisan. `.next/**` ya lo
    // ignora el preset, pero se repite aquí para que quede a la vista.
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'],
  },
  {
    rules: {
      // El proyecto usa `!` en sitios donde la consulta a la base ya garantiza
      // el valor (por ejemplo `haEntityId` tras filtrar por `isNotNull`), y no
      // hay forma de expresarlo en el tipo.
      '@typescript-eslint/no-non-null-assertion': 'off',

      // ── Deuda pendiente, a propósito en `warn` ────────────────────────────
      //
      // eslint-plugin-react-hooks 7 trae reglas que antes no existían y que
      // marcan 31 sitios del código que ya estaba escrito y funcionando: sobre
      // todo el `useEffect(() => setMounted(true), [])` que evita el desajuste
      // de hidratación, repetido por media interfaz.
      //
      // Se dejan en `warn` para que `pnpm lint` sirva de puerta al código nuevo
      // sin arrastrar un refactor de 24 efectos de pantallas que no se están
      // tocando. Siguen saliendo en cada pasada, así que no se olvidan: cuando
      // se limpien, esto vuelve a `error`.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
    },
  },
];

export default config;
