# Comprobación manual (Fases 4, 5 y 6)

Lo único que no se puede automatizar sin un navegador: ver la app con tus ojos, en el teléfono. Los números de la sección 8.3 del spec ya se comprueban por HTTP con una sesión real (`pnpm build && pnpm test:live`); esta lista es para que los veas vos y para revisar el aspecto.

## Antes de empezar

```bash
pnpm dev          # http://localhost:3000
```

Ingresá con tu email: te llega un **código de 6 dígitos** al correo (puede tardar un minuto; mirá en spam). Escribilo en la pantalla y entrás. Si perdiste la pantalla del código (por ejemplo, el iPhone recargó la app mientras mirabas el correo), escribí tu email y tocá **Ya tengo un código**: no hace falta pedir otro.

**Para verla a 390 px** usá el modo dispositivo de las herramientas de desarrollo del navegador (Chrome: F12 → ícono de celular → iPhone 12/13/14). Para verla en el teléfono real usá la dirección de Vercel (sección 7): el iPhone exige HTTPS para instalar una app.

## 1. Importar operaciones

1. **Más → Importar operaciones (CSV)** (o **Actividad → Importar CSV**). Arriba está la guía del formato, con la plantilla para descargar.
2. **Delta:** elegí un export de Delta (para probar, `lib/engine/__fixtures__/delta_export.csv`) y tocá **Ver vista previa**.
3. La vista previa tiene que decir: **Formato: Delta**, **operaciones nuevas** (las compras, ventas y depósitos), **filas ignoradas** por ser "patas de efectivo automáticas de Delta" (es a propósito), **0 con error**, y 10 **instrumentos nuevos** (o menos si ya existían) y "Cómo quedaría tu portafolio":

   | Dato                       | Valor esperado |
   | -------------------------- | -------------- |
   | Efectivo                   | 882,745        |
   | Costo base de las abiertas | 8.664,27       |
   | Ganancia realizada         | 247,015        |
   | Posiciones abiertas        | 5              |

   Abrí **Ver las N operaciones que se van a cargar**: fechas día/mes/año, tipo, símbolo, cantidad y precio.

4. **Confirmar importación.** Te lleva a **Posiciones** con un aviso de que los precios se descargan en segundo plano.

### Formato simple, planilla y errores (desde el teléfono y la compu)

1. **Descargar la plantilla (CSV)**, abrila en Excel o Google Sheets, borrá los ejemplos y cargá dos o tres operaciones tuyas. Guardala como CSV y subila: **Formato: Portfolio Tracker**. Si subís la plantilla sin tocar, tiene que rechazar las 5 filas de ejemplo.
2. **Pegar filas:** copiá las celdas de la planilla (con la fila de encabezados) y pegalas en la pestaña **Pegar filas**. Probá con fechas `09/03/2026` y precios con coma (`575,24`): la vista previa tiene que mostrarlos como 09/03/2026 y US$ 575,24.
3. **Errores:** poné una fecha `31/02/2026`, un tipo raro y un símbolo mal escrito (`APPL`). Tienen que salir agrupados, con la fila y cómo arreglarlos, y no se puede confirmar.
4. **Repetidas:** volvé a subir lo mismo: «ya importadas», nada que confirmar. Cargá una compra a mano y subí un CSV con esa misma compra (otro precio): aparece «Parecen repetir operaciones que ya tenés» y no se importa salvo que tildes **Importar igual**.
5. **Deshacer:** al final de la pantalla, **Importaciones anteriores → Deshacer importación → Sí, deshacer**. Se borran solo las de esa importación (no lo cargado a mano). Si después importaste una venta que depende de esas compras, avisa y no deja.
6. **Ida y vuelta:** **Más → Exportar todas las operaciones (CSV)** y volvelo a subir: todo figura como ya importado.

## 2. Ver los números en pantalla

En **Posiciones**, debajo de cada tarjeta dice "Exacto: …" con el valor sin redondear:

| Posición | Cantidad | Costo base (exacto) |
| -------- | -------- | ------------------- |
| VOO      | 8,95     | 5.724,77            |
| SOXX     | 4        | 2.069,5             |
| FSLY     | 30       | 346,8               |
| ILF      | 12       | 331,6               |
| NFLX     | 2        | 191,6               |

- **Costo base (abiertas):** 8.664,27 · **Efectivo:** 882,745 · **Realizado (todas):** 247,015.
- **Mostrar posiciones cerradas (5):** MELI +180,55 · URTH +42,70 · KOS +11,14 · QCOM +7,52 · TTWO +5,11.
- Si alguna posición dice **Sin precio**: esperá unos segundos y actualizá la página (se descarga en segundo plano); si sigue, tocá **Actualizar precios** en Inicio (se puede una vez cada 5 minutos).

## 3. Alta manual

**Actividad → Agregar**: Compra · símbolo `DDOG` (aparece en la lista mientras escribís) · cantidad `2` · precio `251,41` · comisión `1,00` · fecha `23/09/2026`. Guardar.

**Precio de referencia:** al elegir el símbolo (tocá la sugerencia), el campo **Precio** se llena solo con la cotización actual y abajo dice de cuándo es («Precio actual de DDOG: US$ … (fecha y hora)»). Si escribís vos el precio y después cambiás de símbolo, tu precio no se pisa y aparece **Usar este precio**. Un símbolo que no existe avisa «No encontramos cotización». Al editar una operación ya guardada no se toca el precio.

Resultado esperado: DDOG con **costo base 503,82** y el **efectivo baja a 378,925**. Un símbolo nuevo puede tardar unos segundos en tener precio: puede aparecer un instante el aviso "Falta el precio de DDOG" y desaparecer al actualizar la página. En el detalle de DDOG tiene que verse el gráfico con el punto verde de la compra.

## 4. Cosas para mirar

- **Editar y borrar:** tocá una operación en Actividad. Probá cambiarle la cantidad y guardar; probá eliminar una compra que sostiene una venta posterior (tiene que rechazarlo con un mensaje claro).
- **Filtros de Actividad:** por tipo, símbolo y fechas. En el iPhone **Desde** y **Hasta** van cada uno en su renglón, sin pisarse ni salirse de la tarjeta.
- **Exportar CSV:** **Actividad → Exportar CSV** descarga todas tus operaciones.
- **Detalle de una posición** (tocá VOO): gráfico de precio con puntos verdes (compras) y rojos (ventas) y una línea punteada con tu costo promedio.
- **A 390 px:** que nada se corte ni haya scroll horizontal, que la navegación de abajo no tape contenido (en el iPhone, que respete la barra inferior) y que los botones se puedan tocar con el pulgar.
- **Colores:** ganancias y pérdidas llevan además signo y flecha (▲ ▼).
- **Composición (Inicio):** la torta con una porción por posición y el efectivo en gris; la lista de abajo con porcentaje y monto. Tocá **Tipo** para agrupar en Acciones / ETF / Efectivo. Los porcentajes tienen que sumar 100 %.

## 5. Rendimiento (Fase 5)

En **Inicio**, la tarjeta **Rendimiento** (aparece unos instantes después del resto, mientras se leen los precios):

- **Períodos** (1S, 1M, 3M, YTD, 1A, Todo): cambian el gráfico y los cuatro datos. Los que son más largos que tu historial (por ejemplo YTD y 1A si empezaste en marzo) muestran lo mismo que Todo y dicen "(todo el historial)".
- **Ganancia / Valor / vs S&P 500:** "Ganancia" (la que se ve al abrir) es cuánto ganaste o perdiste en dólares desde el inicio del período, verde arriba del cero y rojo abajo: depositar o retirar no cuenta como ganancia ni como pérdida. "Valor" es el valor total en dólares (sube a saltos cuando depositás); "vs S&P 500" son tu portafolio y el S&P 500 (con dividendos) en base 100 desde el inicio del período.
- **Datos:** TWR (rendimiento ponderado por tiempo, no le afectan los depósitos), XIRR (tasa anual ponderada por dinero; en períodos de menos de 30 días dice "Muy corto para una tasa anual"), S&P 500 y la diferencia en puntos porcentuales.
- Referencia: con el CSV de Delta importado y **sin** el DDOG cargado a mano (a los cierres del 24/09/2026, desde el 06/03/2026): TWR +16,48 %, XIRR +28,06 %, S&P 500 +13,48 %, diferencia +3,00 pp. Con el DDOG y con precios más nuevos los números cambian un poco.
- Si no aparece el S&P 500: tocá **Actualizar precios** (baja el historial del benchmark en segundo plano) y recargá.
- **Durante la rueda (lunes a viernes, de 10:30 a 17:00 en Montevideo):** tocá **Actualizar precios** sin recargar. Cambian el valor total y la ganancia de arriba **y también** el gráfico de Rendimiento, el TWR, el XIRR, el S&P 500, «Rendimiento por mes», el riesgo y los minigráficos. La leyenda dice «cierres al 24/09/2026 y cotización del 25/09/2026 11:47» y la **Ganancia del período** de «Todo» tiene que ser igual a la **Ganancia total** de arriba. Ese último punto es la cotización del momento, no un cierre: al terminar la rueda el cron guarda el cierre y la leyenda vuelve a decir solo «cierres al …».
- Fuera de la rueda (noche, fin de semana) no hay punto en vivo: el gráfico llega al último cierre, que es lo mismo que muestra el valor de arriba. Si el S&P 500 no se pudo actualizar, tampoco hay punto en vivo (para no comparar días distintos): tocá **Actualizar precios** de nuevo pasados 5 minutos.

## 5b. Inicio completo (Inicio v2)

De arriba abajo, con el CSV de Delta importado y sin el DDOG (a los cierres del 24/09/2026 los números son los de referencia; con precios más nuevos cambian un poco):

- **Tarjeta del valor total:** debajo del cambio del día, **Ganancia total** (con su porcentaje "sobre lo aportado") y **Aportado neto** (depósitos menos retiros: **US$ 9.300,00**). La ganancia total es el valor total menos lo aportado y **tiene que ser igual a Ganancia no realizada + Ganancia realizada (+ Dividendos)**: hoy ≈ +945,51 = 490,48 + 247,02. Si falta el precio de alguna posición no se muestra (el total sería parcial).
- **Ganancia por posición:** barras que salen del centro (verde a la derecha, rojo a la izquierda) con el monto de cada símbolo, abiertas y **cerradas** (MELI +180,55 y URTH +42,70 son exactos). **Total** suma lo realizado, lo no realizado y los dividendos; la suma de abajo tiene que ser la Ganancia total de arriba. **Hoy** muestra lo que aportó cada posición al cambio del día (suma = el "Hoy" de la primera tarjeta). Con más de 8 posiciones las de menor peso se agrupan en "Otras", pero una pérdida grande nunca se esconde ahí.
- **Tus posiciones:** las 5 más grandes con un minigráfico de los últimos 30 días, el cambio de hoy y la ganancia sobre el costo. Tocar una abre su detalle.
- **Rendimiento por mes:** barras de tu portafolio (negro) y del S&P 500 (azul) por mes calendario; el primer mes cuenta desde tu primera operación y el último sigue en curso (lo dice abajo). "Ver los valores de cada mes" abre la tabla con los porcentajes exactos.
- **Riesgo** (plegado; tocá para abrir): caída máxima (hoy ≈ −5,47 %, del 09/03 al 30/03, recuperada el 08/04), caída actual, mejor y peor día (≈ +2,74 % el 31/03 y −2,98 % el 05/06), volatilidad anual (≈ 14,15 %) y el gráfico de caídas desde el máximo. Con menos de un año de historia lo dice: son números orientativos.
- **Casos raros para probar:** una cuenta con solo un depósito (sin posiciones ni tendencias), una compra sin ningún depósito (no aparece la ganancia total) y una cuenta con todo vendido (solo posiciones cerradas). Ninguna debería mostrar errores.

## 6. Watchlist (Fase 6)

Pestaña **Watchlist** (la estrella, entre Posiciones y Actividad):

- **Seguir un símbolo:** escribí `AAPL` (aparecen sugerencias, con la lista completa a la vista y los nombres largos cortados con «…») y tocá **Seguir**. Si el símbolo es nuevo tarda unos segundos en tener precio: la fila dice "Sin precio todavía"; actualizá la página. También sirve `brk.b` (se convierte en `BRK-B`).
- **Cada fila:** precio, cambio del día con signo y flecha, un minigráfico de los últimos 60 cierres (gris a propósito) y la barra del **rango de 52 semanas** (mínimo a la izquierda, máximo a la derecha, el punto es el precio). Es el rango de cierres diarios, no de los extremos dentro del día.
- **Tocá la fila** para abrir el detalle: precio, rango, gráfico de un año y **Dejar de seguir**. Sin costos ni operaciones porque no tenés una posición. Los símbolos que sí tenés también tienen el botón **Seguir** en su detalle.
- **Quitar de la lista:** tocá la ✕ de la fila: pregunta "¿Quitar X?" con **Sí, quitar** y **Cancelar** (la ✕ sola no quita nada).
- **Límites:** 50 símbolos; símbolo repetido ("Ya seguís X") o inexistente (mensaje de error) no rompen nada.
- **Actualizar precios** (arriba a la derecha) también refresca los símbolos seguidos (1 vez cada 5 minutos).

## 6b. Ficha de un activo: gráfico con rangos, datos de la empresa y ganancias

Tocá una posición (por ejemplo **AAPL**) o un símbolo de la Watchlist:

- **Evolución del precio:** arriba **1S · 1M · 1A** (arranca en 1A). Al tocar **1S** o **1M** se pide el detalle del día (tarda una fracción de segundo) y cambian el gráfico y el texto «En 1 semana: ▲ +US$ …». Volver a un rango ya visto es instantáneo. Las marcas del eje son fechas (`21/09`, o `09/25` en 1A).
- **52 semanas superpuesto:** en **1A** hay dos líneas punteadas con «Máx. 52 sem.» y «Mín. 52 sem.» y su valor, con las etiquetas afuera de la franja y del lado donde la curva no las pisa. En **1S** y **1M** la línea solo aparece si el máximo o el mínimo quedan dentro de la escala del período. Debajo siempre está la barra «Rango de 52 semanas» con el precio marcado.
- **Datos de la empresa:** cierre anterior, apertura, rangos, volumen, capitalización («US$ 4,98 billones»), P/E, BPA, dividendo, acciones, P/B… Un ETF (**VOO**) dice «Datos del fondo» y trae patrimonio, valor de la cuota, categoría y retorno del año.
- **Ganancias** (solo acciones): cuatro barras con el BPA real, una rayita con el consenso y «Superó / En línea / No llegó». Un ETF no tiene esa tarjeta.
- En un símbolo que **solo seguís** ya no hay la tarjeta suelta «Rango de 52 semanas» ni «Precio de cierre (1 año)»: están dentro de «Evolución del precio».
- Los datos de la empresa vienen de Yahoo con hasta una hora de demora y son informativos. Si Yahoo falla, la tarjeta dice «No pudimos traer los datos ahora» y el resto de la ficha funciona igual.

## 7. La app instalada en el iPhone (Fase 6)

Dirección: **la URL del proyecto en Vercel** (`vercel project ls`; apunta a la base de desarrollo `finance-dev` hasta la Fase 7). Hacelo con **Safari** (no Chrome) en el iPhone:

1. Abrí la dirección y pedí el código con tu email. **Fijate en el correo:** que llegue (mirá también en spam), cómo se ve (remitente, asunto "Tu código de ingreso a Portfolio Tracker", el código grande) y cuánto tarda. Escribí el código y entrá.
2. **Compartir → Agregar a pantalla de inicio.** El ícono es un fondo casi negro con un trazo de gráfico blanco y el nombre "Portfolio".
3. **Abrí la app desde el ícono:** tiene que abrirse **sin la barra de Safari**. Mirá la barra de estado de arriba (hora, batería): ¿se ve bien sobre el fondo, tanto en claro como en oscuro? Si no se lee o queda una franja de otro color, avisame (se ajusta con `statusBarStyle`).
4. **Ingresar dentro de la app instalada:** cerrá la sesión (**Más → Cerrar sesión**) y volvé a entrar con un código nuevo. Las cookies de la app instalada son aparte de las de Safari: acá es donde el enlace de antes fallaba y el código no. Al pedir el código, el teclado numérico y la sugerencia del código que llegó por correo (arriba del teclado) tienen que aparecer. Si al ir al correo la app se recarga y volvés a la pantalla del email, escribí el email y tocá **Ya tengo un código**.
5. **Modo avión:** con la app abierta activá el modo avión y tocá otra pestaña o cerrala y abrila de nuevo: tiene que aparecer **"Sin conexión"** con el último estado de Inicio (valor total, cambio, efectivo, posiciones) y la hora en que se guardó. Al volver la conexión, **Reintentar**.
6. **Modo oscuro:** cambiá el aspecto del iPhone (Ajustes → Pantalla y brillo): la app lo sigue sola. Revisá Inicio, Watchlist y el ingreso en los dos modos.
7. **Watchlist:** agregar y quitar un símbolo desde el teléfono. Que el teclado no tape el botón **Seguir** y que la navegación de abajo respete la barra inferior.
8. **Cerrar sesión borra lo guardado:** después de cerrar sesión, modo avión y abrir la app: la pantalla sin conexión ya no muestra tu valor total.

Anotá lo que se vea raro (sobre todo la barra de estado y el correo): son las dos cosas que no se pueden comprobar sin el teléfono.

## Límites conocidos

- Una sola cuenta y una sola watchlist.
- Los datos de la empresa son de Yahoo (no oficial): pueden faltar campos o cambiar sin aviso. El consenso de ganancias trae 4 trimestres, no 5.
- Editar o borrar una operación importada: si volvés a subir el archivo original, se crea de nuevo.
- Las importaciones anteriores a «Deshacer importación» no se pueden deshacer (no guardaban de qué importación salió cada operación).
- El código de ingreso permite 5 intentos cada 15 minutos por email; si alguien los gasta, esa persona espera 15 minutos.
- Sin notificaciones push ni interruptor manual de modo oscuro (sigue al sistema).
