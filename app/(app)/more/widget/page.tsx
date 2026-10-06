import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CopyButton } from "@/components/app/copy-button";
import { Notice, PageHeader } from "@/components/app/stat";
import {
  RevokeWidgetTokenForm,
  WidgetTokenForm,
} from "@/components/app/widget-token-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionUser } from "@/lib/db/auth";
import { createClient } from "@/lib/db/server";
import { formatDate, formatDateTime } from "@/lib/portfolio/format";
import {
  ALL_PORTFOLIOS,
  ALL_PORTFOLIOS_LABEL,
} from "@/lib/portfolio/portfolio-scope";
import { listPortfolios } from "@/lib/portfolio/queries";
import { appOrigin } from "@/lib/widget/origin";
import { SCRIPT_NAME, buildScriptableScript } from "@/lib/widget/script";
import { getWidgetTokenInfo } from "@/lib/widget/status";

const SCRIPTABLE_URL = "https://apps.apple.com/app/scriptable/id1405459188";

/**
 * Widget para iPhone (docs/widget-iphone.md): el código personal, el script para Scriptable y el
 * paso a paso. El script es el mismo para todos; el código no se vuelve a mostrar después de crearlo.
 */
export default async function WidgetPage() {
  const supabase = await createClient();
  if (!(await getSessionUser(supabase))) redirect("/login");

  const requestHeaders = await headers();
  const origin = appOrigin(
    requestHeaders.get("host"),
    requestHeaders.get("x-forwarded-proto"),
  );
  const [portfolios, token] = await Promise.all([
    listPortfolios(supabase),
    getWidgetTokenInfo(supabase),
  ]);

  const options =
    portfolios.length > 1
      ? [
          { value: ALL_PORTFOLIOS, label: ALL_PORTFOLIOS_LABEL },
          ...portfolios.map((p) => ({ value: p.id, label: p.name })),
        ]
      : [];
  const shows =
    token === null
      ? null
      : token.portfolioId === null
        ? portfolios.length > 1
          ? ALL_PORTFOLIOS_LABEL
          : null
        : (portfolios.find((p) => p.id === token.portfolioId)?.name ?? null);
  // Un código de un solo portafolio, con más de uno: el Parameter no le sirve para elegir otro.
  const scopedTo =
    token !== null && token.portfolioId !== null && portfolios.length > 1
      ? shows
      : null;
  const script = origin ? buildScriptableScript(origin) : null;

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title="Widget para iPhone"
        subtitle="Tu valor total y el cambio del día en la pantalla de inicio, sin abrir la app."
      />

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">Tu código</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {token ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Estado</dt>
              <dd>Activo</dd>
              {shows && (
                <>
                  <dt className="text-muted-foreground">Muestra</dt>
                  <dd className="truncate">{shows}</dd>
                </>
              )}
              <dt className="text-muted-foreground">Creado</dt>
              <dd>{formatDate(token.createdAt)}</dd>
              <dt className="text-muted-foreground">Último uso</dt>
              <dd>
                {token.lastUsedAt
                  ? formatDateTime(token.lastUsedAt)
                  : "Todavía no se usó"}
              </dd>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">
              Todavía no tenés un código. El widget lo necesita para leer tu
              resumen; solo sirve para eso, no para entrar a la app.
            </p>
          )}
          {scopedTo && (
            <Notice tone="info">
              Este código muestra solo «{scopedTo}»: con él, cada widget muestra
              ese portafolio aunque escribas otro nombre en Parameter. Para
              tener un widget por portafolio, creá uno nuevo con «
              {ALL_PORTFOLIOS_LABEL}».
            </Notice>
          )}
          <WidgetTokenForm options={options} hasToken={token !== null} />
          {token && <RevokeWidgetTokenForm />}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">Paso a paso</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
            <li>
              Instalá{" "}
              <a
                href={SCRIPTABLE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline underline-offset-2"
              >
                Scriptable
              </a>{" "}
              desde la App Store (es gratis).
            </li>
            <li>
              Creá tu código acá arriba y copialo.
              {portfolios.length > 1 && (
                <>
                  {" "}
                  Si querés un widget por portafolio, elegí «
                  {ALL_PORTFOLIOS_LABEL}» (ver más abajo).
                </>
              )}
            </li>
            <li>Copiá el script de abajo.</li>
            <li>
              En Scriptable tocá <strong>+</strong>, pegá el script y ponele de
              nombre «{SCRIPT_NAME}» (tocando el título de arriba).
            </li>
            <li>
              Tocá ▶︎ para ejecutarlo: te pide el código. Pegalo y tocá Guardar.
              Vas a ver cómo queda el widget.
            </li>
            <li>
              En la pantalla de inicio, mantené apretado un espacio vacío →{" "}
              <strong>Editar</strong> → <strong>Agregar widget</strong> →
              Scriptable. Elegí el tamaño y agregalo.
            </li>
            <li>
              Mantené apretado el widget → <strong>Editar widget</strong> → en
              Script elegí «{SCRIPT_NAME}».
            </li>
          </ol>
          {portfolios.length > 1 && (
            <div className="mt-3 flex flex-col gap-1 rounded-lg bg-muted px-3 py-2 text-sm">
              <p className="font-medium">Un widget por portafolio</p>
              <p className="text-muted-foreground">
                Con un código de «{ALL_PORTFOLIOS_LABEL}», cada widget puede
                mostrar uno distinto: en <strong>Editar widget</strong>, en{" "}
                <strong>Parameter</strong>, escribí el nombre del portafolio
                (por ejemplo «{portfolios[1]?.name}»). Vacío muestra todos
                juntos. Agregá un widget por cada portafolio, con el mismo
                script y el mismo código.
              </p>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            También funciona en la pantalla de bloqueo (el widget rectangular de
            Scriptable). Para cambiar o borrar el código del teléfono, volvé a
            ejecutar el script en Scriptable.
          </p>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">El script</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {script ? (
            <>
              <p className="text-sm text-muted-foreground">
                Es el mismo para todos: no lleva tu código.
              </p>
              <p className="text-sm text-muted-foreground">
                ¿Ya tenés el widget y hay una versión nueva? Copialo de nuevo,
                abrí «{SCRIPT_NAME}» en Scriptable, seleccioná todo y pegá
                encima. El código no hace falta volver a cargarlo.
              </p>
              <textarea
                readOnly
                value={script}
                rows={6}
                aria-label="Script para Scriptable"
                className="w-full min-w-0 resize-none rounded-lg border bg-muted/40 px-2.5 py-2 font-mono text-xs"
                spellCheck={false}
              />
              <CopyButton text={script} label="Copiar script" />
            </>
          ) : (
            <Notice tone="error">
              No pudimos armar el script. Probá de nuevo en un momento.
            </Notice>
          )}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">Antes de usarlo</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
            <li>
              El widget muestra montos en la pantalla de inicio (y en la de
              bloqueo, si lo ponés ahí): cualquiera que vea tu teléfono los ve.
            </li>
            <li>
              Si perdés el teléfono o compartiste el código sin querer, revocalo
              acá: el widget deja de mostrar tus datos al instante.
            </li>
            <li>
              Las cotizaciones se actualizan solas cada 2 horas como mucho,
              cuando el widget se refresca (eso lo decide iPhone: suele ser cada
              15 a 60 minutos). Para la del momento, abrí la app y tocá
              «Actualizar precios».
            </li>
            <li>
              Scriptable es una app de otra empresa. El código solo permite leer
              este resumen: no deja cargar ni borrar operaciones, ni ver tu
              historial.
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
