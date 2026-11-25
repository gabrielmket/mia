"use client";

/**
 * FORK MIA (MIA-218) · a linha das três contagens no cartão do Modelo de IA
 * (docs/fork/ia-da-plataforma.md).
 *
 * `empresas` vem do GET de `/api/v1/admin/modelo-de-ia` (`contarEmpresas`,
 * MIA-217): só as empresas que operam. É a mesma conta da `/health`, do
 * relatório interno e do MCP (`plataforma_ver_ia_das_empresas`).
 *
 * `null` = a leitura falhou: nada aparece, porque "0 sem chave" chutado é
 * exatamente o silêncio que deixou empresas sem IA por semanas (MIA-215).
 */
import { useT } from "@/hooks/i18n/useT";
import type { ContagemDeEmpresas } from "@/hooks/useModeloDeIa";

export function ContagemDasEmpresas({ empresas }: { empresas: ContagemDeEmpresas | null | undefined }) {
  const t = useT();
  if (!empresas) return null;
  // Cada frase passa por t() como literal (a cerca do espanhol lê o fonte); o número entra depois.
  const comN = (frase: string, valor: number) => frase.replace("{n}", () => String(valor));

  return (
    <div className="space-y-1" data-testid="contagem-das-empresas">
      <p className="text-sm">
        {comN(t("{n} seguem a plataforma"), empresas.seguem)} ·{" "}
        {comN(t("{n} com escolha própria"), empresas.propria)} ·{" "}
        <span className={empresas.sem_chave > 0 ? "font-medium text-error-fg" : undefined}>
          {comN(t("{n} sem chave"), empresas.sem_chave)}
        </span>
      </p>
      {empresas.sem_chave > 0 && (
        <p className="text-xs text-error-fg" data-testid="empresas-sem-chave">
          {t(
            "Empresa sem chave não responde com IA. Para ver quais: plataforma_ver_ia_das_empresas no MCP de plataforma.",
          )}
        </p>
      )}
    </div>
  );
}
