---
name: Avyra
description: Panel privado de una casa que se lee de un vistazo, con la casa tiñendo la interfaz según lo que está sirviendo.
colors:
  primary: "hsl(258 84% 56%)"
  primary-dark: "hsl(262 92% 70%)"
  primary-foreground: "hsl(0 0% 100%)"
  primary-foreground-dark: "hsl(252 45% 8%)"
  background: "hsl(250 40% 98%)"
  background-dark: "hsl(252 34% 6%)"
  foreground: "hsl(250 45% 11%)"
  foreground-dark: "hsl(250 30% 96%)"
  card: "hsl(0 0% 100%)"
  card-dark: "hsl(252 28% 10%)"
  muted: "hsl(250 30% 94%)"
  muted-dark: "hsl(252 20% 16%)"
  muted-foreground: "hsl(250 12% 45%)"
  muted-foreground-dark: "hsl(250 14% 66%)"
  accent: "hsl(250 35% 94%)"
  accent-dark: "hsl(252 22% 17%)"
  border: "hsl(250 22% 88%)"
  border-dark: "hsl(252 20% 20%)"
  destructive: "hsl(356 75% 52%)"
  destructive-dark: "hsl(356 80% 62%)"
  state-light: "hsl(43 96% 50%)"
  state-light-dark: "hsl(45 96% 58%)"
  state-light-fg: "hsl(35 92% 32%)"
  state-light-fg-dark: "hsl(45 96% 72%)"
  state-heat: "hsl(18 92% 54%)"
  state-heat-dark: "hsl(20 95% 60%)"
  state-heat-fg: "hsl(15 85% 38%)"
  state-heat-fg-dark: "hsl(24 95% 72%)"
  state-cool: "hsl(192 92% 45%)"
  state-cool-dark: "hsl(190 95% 55%)"
  state-cool-fg: "hsl(196 90% 30%)"
  state-cool-fg-dark: "hsl(190 95% 70%)"
  state-live: "hsl(152 65% 38%)"
  state-live-dark: "hsl(152 70% 48%)"
  state-live-fg: "hsl(152 65% 26%)"
  state-live-fg-dark: "hsl(152 70% 62%)"
  on-state: "hsl(250 45% 11%)"
typography:
  display:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "clamp(2.25rem, 1.4rem + 3.4vw, 3.75rem)"
    fontWeight: 600
    lineHeight: 1.02
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "clamp(1.75rem, 1.2rem + 2.2vw, 2.5rem)"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.03em"
  numeral:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "3rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.04em"
    fontFeature: "'tnum' 1"
  title:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.375
  label:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.375
rounded:
  sm: "calc(0.75rem - 4px)"
  md: "calc(0.75rem - 2px)"
  lg: "0.75rem"
  xl: "0.75rem"
  2xl: "1rem"
  3xl: "1.5rem"
  full: "9999px"
spacing:
  gap-grid: "0.75rem"
  gap-section: "2.5rem"
  card-x: "1.25rem"
  container-pad: "1rem"
components:
  surface-card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.3xl}"
    padding: "0.75rem 1.25rem"
  light-switch-off:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.2xl}"
    padding: "0.75rem 1rem"
    height: "3.75rem"
  light-switch-on:
    backgroundColor: "{colors.state-light}"
    textColor: "{colors.on-state}"
    rounded: "{rounded.2xl}"
    padding: "0.75rem 1rem"
    height: "3.75rem"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    padding: "0.625rem 1rem"
  input-field:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.75rem"
---

# Design System: Avyra

## Overview

**Creative North Star: "La casa que se lee de un vistazo"** (propuesta, no confirmada por el usuario)

Avyra es una superficie de lectura antes que de control: un fondo lila con un halo violeta de marca, sobre el que la casa se cuenta como una frase y cada aparato aparece como uno más de su tipo, con su única cifra o su único interruptor. El color no decora: es el estado. Calentando se tiñe de ámbar, enfriando de cian, luz encendida de oro, robot limpiando de verde, y lo mismo hace el halo del fondo. Lo que no está sirviendo se queda neutro, de modo que el color que se ve es siempre información.

La densidad es holgada y táctil: texto base de 17 px (18 px y 19 px en pantallas anchas), piezas altas con esquinas muy redondeadas, números grandes y tabulares. El tono es doméstico y cálido, no de panel técnico. El usuario ha descartado explícitamente que se lea como una app genérica de domótica, que cueste toques extra o que resulte fría o técnica.

El sistema tiene dos generaciones conviviendo, y conviene decirlo claro. La portada (`/dashboard`) usa superficies opacas con borde fino, sin tarjeta de héroe. El resto de secciones y el login siguen usando el vidrio esmerilado heredado (`.glass`, `.surface-hero`). Ambas comparten la misma paleta, la misma tipografía y el mismo fondo ambiental. Si el vidrio acaba sustituido por la superficie opaca fuera de la portada está sin decidir.

**Key Characteristics:**
- Color de estado solo en lo que sirve; neutro en lo que solo está encendido o en espera.
- Frase de la casa como titular, con cada cláusula en el color de su subsistema.
- Cifras grandes, tabulares, en Geist Sans.
- Superficies opacas con borde fino en la portada; vidrio heredado en el resto.
- Fondo ambiental reactivo (cuatro halos y grano) que respira 1,6 s al cambiar de estado.
- Claro y oscuro con los mismos nombres de token.

## Colors

Una base lila casi neutra con un violeta de marca, y cuatro colores de estado cálidos y fríos que solo aparecen cuando algo trabaja. Los valores normativos son los de la cabecera YAML (HSL; las claves con sufijo `-dark` son los de `.dark`).

### Primary
- **Violeta Avyra** (`primary`, `primary-dark`): marca, enlaces "Ver todo", foco (`ring`), selección, marcador de sección activa, botón principal, halo de marca siempre presente y punto de aviso reciente de cámara. En oscuro sube a más claro y luminoso para mantener contraste.

### Neutral
- **Lila de fondo** (`background`): suelo de toda la app, con un velo violeta radial arriba.
- **Tinta violácea** (`foreground`): texto principal; es el mismo tono que `on-state`.
- **Superficie de tarjeta** (`card`): blanco en claro, violeta casi negro en oscuro; relleno opaco de `.surface`.
- **Gris lavanda** (`muted`, `muted-foreground`, `accent`): rellenos suaves, texto secundario y hover (`accent/60`).
- **Filo lila** (`border`): borde fino de superficies (a 70 % en `.surface`, 50 % en `.glass`).
- **Rojo de fallo** (`destructive`): errores de formulario, aparato en error y batería baja del robot.

### Estado del hogar
- **Oro luz** (`state-light`): luz encendida; relleno completo del interruptor y halo ambiental de luces.
- **Ámbar calor** (`state-heat`): calefacción sirviendo; borde y tinte de la tarjeta de clima y halo inferior izquierdo.
- **Cian frío** (`state-cool`): aire sirviendo; mismo tratamiento que el calor.
- **Verde vivo** (`state-live`): cámara activa (punto), robot limpiando (tinte).
- **Variantes `-fg`** (`state-light-fg`, `state-heat-fg`, `state-cool-fg`, `state-live-fg`): el color de estado a plena saturación no llega a contraste como texto sobre fondo claro, así que todo texto teñido usa su `-fg` (más oscuro en claro, más claro en oscuro).
- **Tinta sobre estado** (`on-state`): tinta oscura sobre un relleno de estado a plena saturación, en ambos temas, porque esos rellenos son siempre claros.

### Named Rules
**The Serving-Only Rule.** El color de estado aparece solo en lo que está sirviendo (calentando, enfriando, limpiando, luz encendida), nunca en lo que meramente está encendido o en espera. Es la misma regla que tiñe el halo del fondo. Un clima encendido en espera es neutro.

**The Heat-Is-Amber Rule.** El ámbar significa calefacción y nada más. Los avisos recientes de cámara usan `primary`; la batería baja y los errores usan `destructive`.

**The Readable-Tint Rule.** Todo texto sobre una superficie teñida, o que adopta el color de un estado, usa la variante `-fg`; el relleno pleno de estado solo lleva `on-state`.

## Typography

**Display Font:** Geist Sans (con `system-ui, sans-serif`)
**Body Font:** Geist Sans
**Label/Mono Font:** Geist Mono (`ui-monospace`), declarada pero no usada en la portada; las cifras de la portada van en Sans a propósito porque la mono tabular separa demasiado la coma decimal.

**Character:** Una sola familia geométrica y limpia, con la jerarquía hecha de tamaño y peso (600 para titulares y cifras, 500 para nombres) y de interletrado negativo en lo grande. Escala base de html: 17 px, 18 px desde 1280 px, 19 px desde 1920 px; todo se mide en rem, así que espaciados y proporciones acompañan.

### Hierarchy
- **Display** (600, `clamp(2.25rem, 1.4rem + 3.4vw, 3.75rem)`, 1.02): `text-display`, escala de titular para pantallas protagonistas.
- **Headline** (600, `clamp(1.75rem, 1.2rem + 2.2vw, 2.5rem)`, 1.08, -0.03em): `text-display-sm`; la frase de la casa (h1) y el título del login.
- **Numeral** (600, 2,25 rem móvil / 3 rem desde `sm`, 1, -0.04em, tabular): temperatura de cada aparato de clima. La temperatura interior de la cabecera sube a 3,75 rem (`sm`) y 4,5 rem (`md`), 1,5 rem en móvil.
- **Title** (600, 1,125 rem, -0.025em): título de grupo (h2) de la portada, con recuento en `text-sm` normal y tabular ("3/6").
- **Body** (400-500, 1 rem, 1.375): nombres de aparato (500, máximo 2 líneas).
- **Label** (400-500, 0,875 rem, 1.375): línea de estado, saludo, enlaces "Ver todo"; el texto de ayuda mínimo es 0,75 rem.

### Named Rules
**The Tabular Numerals Rule.** Toda cifra que se compara (temperaturas, baterías, recuentos) lleva `.tnum` (`tabular-nums` y `'tnum' 1`).

**The Sentence Is the Headline Rule.** El h1 de la portada es la frase de la casa; cada cláusula se tiñe con el `-fg` de su subsistema y las cláusulas sin estado no llevan color.

## Layout

Contenedor centrado con 1 rem de relleno (`container`, tope 1400 px en 2xl) y, en la portada, `md:px-8 xl:px-10`, `py-8` en móvil y `py-12` desde `md`. Ritmo vertical entre grupos de 2,5 rem (3 rem desde `md`); dentro de un grupo, rejillas con hueco de 0,75 rem.

En escritorio la navegación es una barra lateral fija a pantalla completa con scroll propio; en móvil, una barra superior fija y un cajón de 18 rem a la izquierda. La portada se organiza por tipo de aparato, nunca por estancia: la cabecera (saludo, frase, temperatura interior), el clima (1 columna, 2 desde `sm`, 3 desde `xl`), y luego luces y un lado con cámaras y aspirador (luces 3fr / lateral 2fr desde `xl`; si no hay lateral, las luces ocupan todo el ancho). Los grupos sin aparatos no se pintan y los que quedan se reparten el ancho. Las luces van en 2 columnas en móvil y 3 desde `md`.

Los grupos de la portada no son tarjetas: llevan un titular, un recuento opcional y un enlace "Ver todo"; las piezas de dentro ya son superficies y no se anidan.

## Elevation & Depth

Híbrido. Los planos se separan por relleno y borde fino más una sombra muy difusa y baja, no por sombras duras. La profundidad real la pone el fondo ambiental: capas fijas de halos radiales (marca siempre; luz, calor y frío según el estado), grano fino de ruido SVG en superposición y deriva lenta de 26 a 38 s.

### Shadow Vocabulary
- **Superficie opaca** (`.surface`: `0 1px 2px hsl(250 45% 11% / 0.04), 0 10px 24px -18px hsl(250 45% 11% / 0.2)`; en oscuro `0 1px 2px hsl(252 60% 2% / 0.4), 0 12px 28px -18px hsl(252 60% 2% / 0.8)`): tarjetas de la portada, relleno `card` opaco, borde `border/70`.
- **Vidrio heredado** (`.glass`: `card/60`, `backdrop-filter: blur(20px) saturate(150%)`, borde `border/50`, filo de luz superior de 1 px): tarjetas de las otras secciones. No se usa en la portada.
- **Superficie elevada heredada** (`.surface-hero`: vidrio con `rounded-3xl` y una sombra teñida de `primary` de `0 24px 64px -24px`): login y piezas protagonistas de otras secciones. No se usa en la portada.

### Named Rules
**The Opaque Home Rule.** Las superficies de la portada son opacas: el estado se lee por el tinte de la pieza y un fondo translúcido lo ensucia. El vidrio queda fuera de la portada.

**The No-Hard-Shadow Rule.** No hay sombras duras ni con desplazamiento. Las sombras son difusas, con desplazamiento Y y extensión negativa.

## Shapes

Esquinas muy redondeadas y piezas altas. La base `--radius` es 0,75 rem (`lg`), con `md` = 10 px y `sm` = 8 px en tokens de Tailwind. En la portada las tarjetas de clima, cámaras y aspirador usan `rounded-3xl` (1,5 rem), los interruptores de luz `rounded-2xl` (1 rem), y los enlaces de navegación `rounded-xl`. Botones e inputs del login usan `rounded-md`. Los indicadores son círculos completos (`rounded-full`, punto de 10 px en cámaras, 6 px en el menú). Todo borde es de 1 px, y un aparato sin conexión pasa a borde discontinuo y fondo transparente.

## Components

### Tarjeta de clima
Una pieza por aparato, calefacción y aire juntos, del mismo tamaño y enlazada a su sección.
- **Forma:** `.surface`, `rounded-3xl`, alto mínimo 4,75 rem (6,5 rem desde `sm`), relleno `px-5` y `py-3` (`py-4` desde `sm`).
- **Contenido:** nombre (500, 2 líneas) y línea de estado (0,875 rem) a la izquierda; temperatura en Numeral a la derecha.
- **Estados:** en reposo, hover `accent/60`. Sirviendo, borde `state-heat/45` o `state-cool/45` con fondo al 10 % (hover 14 %) y estado en `-fg` y peso 500. Apagada, la cifra en `muted-foreground`; sin lectura, "—".
- **Texto de estado:** "Calentando hasta 21,5°" en marcha; "En espera · 21°" en reposo.

### Interruptor de luz
Se enciende y se apaga desde la portada, con la misma acción que la sección de Luces.
- **Forma:** `rounded-2xl`, alto mínimo 3,75 rem, icono de bombilla de 20 px, nombre y estado en dos líneas.
- **Apagado:** `.surface` neutra, hover `accent/60`, bombilla en `muted-foreground`.
- **Encendido:** relleno completo `state-light` sin borde, texto `on-state` y bombilla rellena.
- **Estados especiales:** pulsación `scale(0.98)`, cargando con spinner, sin conexión con borde discontinuo y fondo transparente, fallo con anillo `destructive`. Es un `aria-pressed` con anuncio `aria-live` del estado.

### Fila de cámara y de robot
Filas simples dentro de una sola `.surface`, sin imagen.
- **Cámaras:** lista dividida por `divide-border/70`, fila de 3,75 rem con punto de estado (verde activa, violeta `primary` con aviso de menos de 15 min, gris desactivada), nombre, último aviso con tiempo relativo y chevron.
- **Aspirador:** tarjeta `rounded-3xl`; limpiando se tiñe de `state-live` (borde 45 %, fondo 10 %), error de `destructive`; batería en cifra grande tabular.

### Navegación
Barra lateral con velo violeta arriba; en móvil, barra superior translúcida y cajón. Texto de 0,875 rem, secundario de 13 px.
- **Enlace:** `rounded-xl`, relleno `px-3 py-2.5`, icono de 16 px. Activo: fondo `primary/10`, texto `foreground`, marcador vertical de 3 px en `primary`, icono en `primary`. Reposo: `muted-foreground`; hover `accent/60`.
- **Punto vivo:** punto de 6 px con pulso (`animate-pulse-ring`) junto a luces, calefacción y aire cuando hay algo sirviendo, en el color de ese subsistema.
- **Acordeón de domótica:** se despliega solo si hay una sección activa dentro y conserva el aviso al cerrarse. Móvil con punto `primary` en el botón del menú.

### Botones y campos (login)
- **Botón principal:** `bg-primary`, `text-primary-foreground`, `rounded-md`, `px-4 py-2.5`, `text-sm` 500, hover a opacidad 90 %.
- **Botón secundario:** borde `border`, `rounded-md`, hover `accent`.
- **Campo:** `rounded-md`, borde `border`, fondo `background/50`, `px-3 py-2`, foco con borde `ring` y anillo `ring/30`; el error es un bloque `destructive/10` con borde `destructive/50`.

### Movimiento
Transiciones de color de 300 ms (`ease-out`), halos ambientales de 1,6 s, entrada `fade-in-up` de 0,45 s con escalonado de 70 ms. `prefers-reduced-motion` detiene la deriva del fondo, el brillo y el pulso, y anula los retardos del escalonado.

## Do's and Don'ts

### Do:
- **Do** aplicar color de estado solo a lo que sirve, y teñir tanto la pieza como su texto con la variante `-fg`.
- **Do** agrupar los aparatos por tipo, con cada uno como par de su tipo y con su nombre propio; la casa no tiene estancias.
- **Do** pintar las cifras con `.tnum` y en Geist Sans.
- **Do** usar `.surface` opaca con borde fino en la portada y no anidar una tarjeta dentro de otra.
- **Do** dejar la acción más frecuente a un toque (luces como interruptor en la portada).
- **Do** respetar `prefers-reduced-motion` en cualquier animación nueva y mantener la base de 17/18/19 px.
- **Do** omitir los grupos sin aparatos.

### Don't:
- **Don't** usar ámbar para nada que no sea calefacción.
- **Don't** mostrar imágenes de cámara en la portada, ni en directo ni en captura.
- **Don't** usar vidrio, anillos, diales ni tarjeta de héroe en la portada.
- **Don't** hacer que la portada parezca una app genérica de domótica, ni más fría o técnica de lo que es.
- **Don't** añadir toques para llegar a lo más frecuente.
- **Don't** ordenar la portada por estancias.
- **Don't** colorear algo solo porque está encendido; en espera es neutro.

### Defectos y deriva no canonizados
- `vacuum-tile.tsx` fija el rojo de batería baja como valor literal (`hsl(356 75% 38%)`) en lugar de un token; es una deriva, no una regla de color.
- El login y el botón principal llevan `shadow-lg shadow-primary/20` y un resplandor de logo de `0 0 36px`; son residuos del vidrio heredado, no vocabulario de sombras.
- `.text-gradient` existe pero la portada no lo usa; no se documenta como patrón.
