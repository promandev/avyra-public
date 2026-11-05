#!/usr/bin/env node

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL no definida.');
  console.error('Ejecuta: node --env-file=apps/web/.env.local scripts/query-users.mjs');
  process.exit(1);
}

const { default: postgres } = await import('postgres');

const sql = postgres(DATABASE_URL, { max: 1 });

console.log('📊 Usuarios registrados en la base de datos:\n');

try {
  const users = await sql`
    SELECT
      id,
      email,
      display_name as "displayName",
      is_admin as "isAdmin",
      email_verified_at as "emailVerifiedAt",
      created_at as "createdAt",
      updated_at as "updatedAt"
    FROM users
    ORDER BY created_at ASC
  `;

  if (users.length === 0) {
    console.log('❌ No hay usuarios registrados.');
  } else {
    console.log(`✅ Total de usuarios: ${users.length}\n`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      console.log(`\n${i + 1}. Email: ${user.email}`);
      console.log(`   ID: ${user.id}`);
      console.log(`   Nombre: ${user.displayName || '(no definido)'}`);
      console.log(`   Admin: ${user.isAdmin ? '✓ Sí' : '✗ No'}`);
      console.log(`   Email verificado: ${user.emailVerifiedAt ? '✓ Sí' : '✗ No'}`);
      console.log(`   Creado: ${new Date(user.createdAt).toLocaleString('es-ES')}`);
      console.log(`   Última actualización: ${new Date(user.updatedAt).toLocaleString('es-ES')}`);
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }

} catch (error) {
  console.error('❌ Error conectando a la base de datos:');
  console.error(error.message);
  process.exit(1);
} finally {
  await sql.end();
}
