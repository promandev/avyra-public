/**
 * Robot aspirador visto desde arriba. lucide no trae uno, así que se dibuja con
 * su misma rejilla de 24px y trazo de 2 para que no desentone junto al resto.
 */
export function VacuumIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M6.5 8.5a7 7 0 0 1 11 0" />
      <circle cx="12" cy="14" r="2" />
    </svg>
  );
}
