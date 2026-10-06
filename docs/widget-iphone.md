# Widget para iPhone (guía)

Cómo ver tu valor total y el cambio del día en la pantalla de inicio del iPhone sin abrir Portfolio Tracker. La misma guía, con el script listo para copiar, está en la pantalla **Más → Widget para iPhone**. El detalle técnico está en `docs/decisions.md`, «Widget de iPhone con Scriptable».

iPhone no deja que una app web tenga widgets propios, así que se usa **Scriptable**, una app gratuita que dibuja widgets con un script.

## Paso a paso

1. Instalá **Scriptable** desde la App Store (gratis).
2. En Portfolio Tracker, entrá a **Más → Widget para iPhone** y tocá **Crear mi código**. Si tenés más de un portafolio, elegí cuál muestra (o todos juntos). **Copiá el código**: no se vuelve a mostrar.
3. En la misma pantalla, tocá **Copiar script**.
4. En Scriptable tocá **+**, pegá el script y ponele de nombre **Portfolio** (tocando el título de arriba).
5. Tocá ▶︎ para ejecutarlo: te pide el código. Pegalo y tocá **Guardar**. Vas a ver cómo queda el widget.
6. En la pantalla de inicio, mantené apretado un espacio vacío → **Editar** → **Agregar widget** → **Scriptable**. Elegí el tamaño y agregalo.
7. Mantené apretado el widget → **Editar widget** → en **Script** elegí **Portfolio**.

También se puede poner en la pantalla de bloqueo, con el widget rectangular de Scriptable.

## Qué muestra

| Tamaño             | Contenido                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------- |
| Chico              | Valor total y cambio del día                                                                 |
| Mediano            | Lo mismo, más la ganancia total y tus 4 posiciones de mayor valor con cuánto se movieron hoy |
| Grande             | Lo mismo, con hasta 6 posiciones, su valor y cuánto se movieron hoy                          |
| Pantalla bloqueada | Valor total y cambio del día en %                                                            |

Abajo dice cuándo se actualizó («Actualizado 19:53»). Si los precios no son de hoy (un fin de semana o antes de que abra la bolsa), agrega de qué día son: «precios al 03/10».

Al tocar el widget se abre la app.

## Un widget por portafolio

Con un mismo código podés tener un widget para cada portafolio, por ejemplo uno de acciones y otro de cripto:

1. Creá el código con **Todos los portafolios** (es la opción de arriba del selector).
2. Agregá un widget de Scriptable por cada portafolio, todos con el script **Portfolio**.
3. En cada uno, mantenelo apretado → **Editar widget** → en **Parameter** escribí el nombre del portafolio tal como está en la app. Las mayúsculas y los espacios de los bordes no importan.

Con **Parameter** vacío, el widget muestra todos juntos. Si el nombre no coincide con ningún portafolio tuyo, el widget dice «No encontré «…»». Un código creado para **un solo** portafolio muestra solo ese, aunque escribas otro nombre: sirve para limitar qué deja ver el código.

## Preguntas frecuentes

- **¿Cada cuánto se actualiza?** El iPhone decide cuándo redibujarlo, en general cada 15 a 60 minutos. Cada vez, si las cotizaciones de tus posiciones tienen **2 horas o más**, el widget pide las nuevas. Así los precios tienen como mucho unas 2 horas de atraso (más lo que tarde el iPhone). Para ver la cotización del momento, abrí la app y tocá **Actualizar precios**.
- **Dice «Código revocado o incorrecto».** El código se revocó o se reemplazó por otro. Creá uno nuevo en **Más → Widget para iPhone** y volvé a ejecutar el script en Scriptable: elegí **Cambiar el código**.
- **Dice «Sin conexión».** Muestra lo último que pudo leer y vuelve a probar solo.
- **Quiero que muestre otro portafolio.** Si tu código es de «Todos los portafolios», escribí el nombre en el **Parameter** del widget (ver «Un widget por portafolio»). Si es de un solo portafolio, creá uno nuevo de «Todos» y cambialo en Scriptable (ejecutá el script → **Cambiar el código**).
- **Actualicé el script y no cambió nada.** El script vive en el teléfono: cuando haya una versión nueva, copiala de nuevo desde **Más → Widget para iPhone** y reemplazá todo el contenido del script en Scriptable. El código no hay que volver a cargarlo.
- **Lo uso en dos teléfonos.** Usá el mismo código en los dos. Si creás uno nuevo, el anterior deja de funcionar en todos lados.

## Seguridad

- El código **solo permite leer el resumen** que ves en el widget: no deja entrar a la app, ni cargar o borrar operaciones, ni ver tu historial.
- Queda guardado en el Keychain de Scriptable, en tu teléfono. En nuestra base solo se guarda una huella (hash), no el código.
- Si perdés el teléfono o compartiste el código sin querer, entrá a **Más → Widget para iPhone** y tocá **Revocar el código**.
- El widget muestra montos en la pantalla: cualquiera que vea tu teléfono los ve, sobre todo si lo ponés en la pantalla de bloqueo.
- Scriptable es una app de otra empresa.
