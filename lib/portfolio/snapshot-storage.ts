// Guardado del "último estado conocido" en el dispositivo (localStorage). Sin imports: lo usan
// componentes de cliente y no puede arrastrar el motor ni decimal.js al navegador. Lo lee la
// pantalla sin conexión (`public/pwa/offline.js`, que repite la clave: hay un test que las compara).

export const SNAPSHOT_KEY = "pt:snapshot:v1";

/** Guarda el estado ya serializado. El almacenamiento puede no estar (modo privado, cuota): se ignora. */
export function saveSnapshot(json: string): void {
  try {
    localStorage.setItem(SNAPSHOT_KEY, json);
  } catch {
    /* sin almacenamiento: la pantalla sin conexión simplemente no muestra el estado */
  }
}

/** Borra el estado guardado (al llegar a /login: sesión cerrada o vencida, o cambio de persona). */
export function clearSnapshot(): void {
  try {
    localStorage.removeItem(SNAPSHOT_KEY);
  } catch {
    /* nada que borrar */
  }
}
