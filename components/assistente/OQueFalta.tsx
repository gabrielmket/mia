"use client";

/**
 * FORK MIA (.91) — O BLOCO "O QUE FALTA" dos primeiros passos e do Início.
 *
 * O desenho do upstream (#1941 e a fase 3 do #2860) com a fonte que já existe:
 * o checklist do MCP, no rótulo do cliente (`/api/v1/assistente/o-que-falta`).
 *
 *   - a evolução: "Ao entrar faltavam N · agora faltam M" (os retratos, 9081);
 *   - três colunas: Preenchido, Posso completar (o assistente prepara) e
 *     Preciso confirmar (só a pessoa faz, ou a Time Company);
 *   - a dependência explícita de cada item ("Depende do agente"): enquanto ela
 *     existe, o botão do item fica desligado;
 *   - a linha "Não se aplica agora".
 *
 * Fica no Início até zerar: a rota diz quem vê (`criterio`), e o bloco não
 * aparece para quem não deve.
 */
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useOQueFalta } from "@/hooks/assistente/usePrimeirosPassos";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import type { ColunaDoRotulo, Frase, ItemDoRotulo } from "@/lib/mcp-plataforma/checklist/rotulo-do-cliente";

/** O que o "Pedir ao assistente" de cada peça pergunta. */
export const PEDIDO_DA_PROPOSTA: Record<"agente" | "funil" | "followup", string> = {
  agente: "Monta o agente",
  funil: "Monta o funil",
  followup: "Liga o follow-up",
};

const COLUNAS: ReadonlyArray<{ coluna: ColunaDoRotulo; titulo: string; vazio: string }> = [
  { coluna: "preenchido", titulo: "Preenchido", vazio: "Nada ainda." },
  { coluna: "posso_completar", titulo: "Posso completar", vazio: "Nada que o assistente prepare." },
  { coluna: "preciso_confirmar", titulo: "Preciso confirmar", vazio: "Nada esperando você." },
];

const QUEM: Record<NonNullable<ItemDoRotulo["quem"]>, string> = {
  voce: "Você",
  quem_administra: "Quem administra a empresa",
  time_company: "Time Company",
};

export function OQueFalta({
  administra,
  aoPedirAoAssistente,
}: {
  /** Quem administra roda a rodada que guarda o retrato. */
  administra: boolean;
  /** O botão "Pedir ao assistente" manda a pergunta ao painel do lado. */
  aoPedirAoAssistente?: (pergunta: string) => void;
}) {
  const t = useT();
  const tag = useTagDeIdioma();
  const estado = useOQueFalta({ guardar: administra });
  const dados = estado.data;

  /** O texto da tela: a frase traduzida, com os nomes encaixados. */
  const frase = (f: Frase) => {
    let texto = t(f.texto);
    for (const [nome, valor] of Object.entries(f.vars ?? {})) texto = texto.split(`{${nome}}`).join(t(valor));
    return texto;
  };
  const data = (iso: string) =>
    new Date(iso).toLocaleDateString(tag, { day: "2-digit", month: "2-digit" });

  if (estado.isPending) {
    return (
      <section className="rounded-lg border bg-background p-4 text-sm text-text-muted" aria-busy="true">
        {t("Conferindo o que falta…")}
      </section>
    );
  }
  if (!dados?.criterio.aparece || !dados.rotulo) return null;
  const r = dados.rotulo;
  const aoEntrar = dados.evolucao?.ao_entrar ?? r.contas.faltam;

  return (
    <section className="space-y-3 rounded-lg border bg-background p-4" data-testid="o-que-falta" aria-labelledby="titulo-do-que-falta">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="titulo-do-que-falta" className="text-base font-semibold">
          {t("O que falta")}
        </h2>
        <p className="text-sm">
          {r.contas.faltam === 0 ? (
            <strong>{t("Tudo pronto. Este bloco sai do Início.")}</strong>
          ) : (
            <>
              {t("Ao entrar faltavam")} <strong>{aoEntrar}</strong> · {t("agora faltam")} <strong>{r.contas.faltam}</strong>
            </>
          )}
        </p>
      </header>

      <div className="grid gap-3 md:grid-cols-3">
        {COLUNAS.map((c) => {
          const itens = r.itens.filter((i) => i.coluna === c.coluna);
          return (
            <div key={c.coluna} className="space-y-2" data-coluna={c.coluna}>
              <h3 className="flex items-center gap-2 text-sm font-medium">
                {t(c.titulo)} <Badge variant="neutral">{itens.length}</Badge>
              </h3>
              {itens.length === 0 ? <p className="text-xs text-text-muted">{t(c.vazio)}</p> : null}
              {itens.map((i) => (
                <div key={i.chave} className="space-y-1 rounded-md border p-3 text-sm" data-item={i.chave}>
                  <p className="font-medium">{frase(i.titulo)}</p>
                  <p className="text-xs text-text-muted">
                    {frase(i.detalhe)}
                    {i.quando ? ` (${data(i.quando)})` : ""}
                  </p>
                  {i.consequencia ? <p className="text-xs text-text-muted">{frase(i.consequencia)}</p> : null}
                  {i.depende_de ? (
                    <p className="text-xs font-medium text-warning-fg">{frase(i.depende_de.texto)}</p>
                  ) : null}
                  {i.quem ? (
                    <p className="text-xs">
                      {t("Quem faz:")} <strong>{t(QUEM[i.quem])}</strong>
                    </p>
                  ) : null}
                  {i.proposta && aoPedirAoAssistente ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-11 lg:h-8"
                      disabled={Boolean(i.depende_de)}
                      onClick={() => aoPedirAoAssistente(t(PEDIDO_DA_PROPOSTA[i.proposta!]))}
                    >
                      {t("Pedir ao assistente")}
                    </Button>
                  ) : null}
                  {i.ir && (i.quem === "voce" || i.coluna !== "preciso_confirmar") ? (
                    i.depende_de ? (
                      <Button type="button" size="sm" variant="outline" className="h-11 lg:h-8" disabled>
                        {t(i.ir.rotulo)}
                      </Button>
                    ) : (
                      <Button asChild size="sm" variant="outline" className="h-11 lg:h-8">
                        <Link href={i.ir.href}>{t(i.ir.rotulo)}</Link>
                      </Button>
                    )
                  ) : null}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {r.nao_se_aplica.length > 0 ? (
        <p className="text-xs text-text-muted" data-testid="nao-se-aplica">
          <strong>{t("Não se aplica agora:")}</strong>{" "}
          {r.nao_se_aplica.map((n) => `${frase(n.titulo)} (${frase(n.porque)})`).join("; ")}.{" "}
          {t("Entram aqui quando mudar.")}
        </p>
      ) : null}
    </section>
  );
}
