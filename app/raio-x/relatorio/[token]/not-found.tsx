/**
 * FORK MIA (.101) — o link do relatório do raio-X que não serve: malformado,
 * inexistente, vencido, revogado ou de relatório não revisado. A MESMA página, com 404:
 * quem varre endereços não aprende nada, e quem recebeu um link que acabou sabe o
 * que fazer.
 */
import { traduzir } from "@/lib/i18n/dicionario";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";
import { idiomaDoVisitante } from "@/lib/i18n/idiomaAnonimo";

export default async function RelatorioIndisponivel() {
  const idioma = await idiomaDoVisitante(null);
  const t = (texto: string) => traduzir(texto, idioma);
  return (
    <IdiomaProvider locale={idioma}>
      <div className="flex min-h-screen items-center justify-center bg-bg p-6 text-text">
        <div className="w-full max-w-md rounded-lg border border-border bg-surface p-8 shadow-sm">
          <h1 className="text-xl font-semibold">{t("Este link não está disponível")}</h1>
          <p className="mt-2 text-sm text-text-muted">
            {t("Ele pode ter vencido ou ter sido encerrado por quem enviou. Peça um link novo a quem mandou.")}
          </p>
        </div>
      </div>
    </IdiomaProvider>
  );
}
