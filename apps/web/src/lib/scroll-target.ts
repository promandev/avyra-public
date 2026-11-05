/**
 * Identificador del contenedor que hace scroll en el panel.
 *
 * En escritorio el scroll ya no es el de la ventana: la barra lateral queda
 * fija y el que se desplaza es `<main>`. Cualquier cosa que quiera reaccionar
 * al scroll o moverlo (por ejemplo el botón de volver arriba) tiene que mirar
 * ese elemento y no `window`.
 *
 * Vive en su propio módulo, sin directiva, para que puedan importarlo tanto el
 * layout (servidor) como los componentes de cliente.
 */
export const MAIN_SCROLL_ID = 'dashboard-scroll';
