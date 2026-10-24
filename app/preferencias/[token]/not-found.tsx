/**
 * FORK MIA (.89) — o link de preferências que não serve: malformado, adulterado
 * ou de um envio que não existe. A MESMA página, com 404, em todos os casos:
 * quem varre endereços não aprende nada.
 */
import { traduzir } from "@/lib/i18n/dicionario";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";
import { idiomaDoVisitante } from "@/lib/i18n/idiomaAnonimo";

export default async function PreferenciasIndisponiveis() {
  const idioma = await idiomaDoVisitante(null);
  const t = (texto: string) => traduzir(texto, idioma);
  return (
    <IdiomaProvider locale={idioma}>
      <div className="flex min-h-screen items-center justify-center bg-bg p-6 text-text">
        <div className="w-full max-w-md rounded-lg border border-border bg-surface p-8 shadow-sm">
          <h1 className="text-xl font-semibold">{t("Este link não está disponível")}</h1>
          <p className="mt-2 text-sm text-text-muted">
            {t(
              "Use o link de um e-mail mais recente. Se quiser sair da lista, responda a qualquer e-mail pedindo.",
            )}
          </p>
        </div>
      </div>
    </IdiomaProvider>
  );
}
