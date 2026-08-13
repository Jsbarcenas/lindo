/**
 * Las medidas del cromo, en función de la pantalla que toque.
 *
 * Estaban escritas como constantes en píxeles porque el único destino era una
 * ventana de escritorio. Dentro del WebView de un móvil en horizontal el
 * viewport es de unos 914x411 px CSS: el ancho da de sobra y **el alto es lo
 * escaso**, así que una barra lateral vertical con pastillas de 56px se come
 * medio juego. De ahí que la altura pese tanto como la anchura en lo de abajo.
 *
 * Un objeto y no un número suelto para que el ancho de la barra de pestañas y
 * el `calc(100vw - …)` que la acompaña no puedan volver a desincronizarse.
 */

/** el punto donde una pantalla deja de ser una ventana de escritorio */
export const COMPACT = '@media (max-width: 900px), (max-height: 540px)'

/** y donde ya es un móvil en horizontal */
export const TIGHT = '@media (max-height: 440px)'

/** columna de pestañas de las opciones, y el ancho que le queda al contenido */
export const OPTION_TABS_WIDTH = { normal: '150px', compact: '104px' }

export const optionTabsSx = {
  width: OPTION_TABS_WIDTH.normal,
  flexShrink: 0,
  [COMPACT]: { width: OPTION_TABS_WIDTH.compact }
}

/** lo que sobra al lado de esa columna, en sincronía con ella */
export const besideOptionTabsSx = {
  width: `calc(100vw - ${OPTION_TABS_WIDTH.normal})`,
  [COMPACT]: { width: `calc(100vw - ${OPTION_TABS_WIDTH.compact})` }
}
