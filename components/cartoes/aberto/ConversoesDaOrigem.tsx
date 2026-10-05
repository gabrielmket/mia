"use client";

/**
 * FORK MIA — o que cada plataforma de anúncio ficou sabendo deste negócio, na
 * seção Origem do cartão aberto (docs/fork/conversoes-da-meta.md).
 *
 * Por plataforma (Meta e Google Ads): o que foi informado e quando ("Lead
 * qualificado informado à Meta em 28/09", "Compra informada à Meta em 29/09 ·
 * R$ 1.500"), ou por que não foi. Desde a .72 os eventos de etapa da Meta são os
 * da régua do upstream (0524), lidos do mesmo livro-razão. A plataforma sem envio nenhum diz se o negócio
 * veio dela: é a resposta que quem atende precisa dar ao cliente que pergunta
 * "por que a Meta não ficou sabendo desta venda?".
 *
 * Só desenho: o que cada linha é vem pronto de `lib/cartoes/cartao-aberto-servidor.ts`,
 * que lê o livro-razão das conversões.
 */
import Link from "next/link";
import { format } from "date-fns";

import { useActiveOrg, useUser } from "@/hooks/auth/AuthProvider";
import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { ROLE_RANK } from "@/lib/auth/types";
import type { CartaoAberto, ConversaoDoNegocio } from "@/lib/cartoes/cartao-aberto";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

type Plataforma = "meta_ads" | "google_ads";
type Situacao = ConversaoDoNegocio["situacao"];

const PLATAFORMAS: readonly Plataforma[] = ["meta_ads", "google_ads"];

const NOME_DA_PLATAFORMA: Record<Plataforma, string> = { meta_ads: "Meta", google_ads: "Google Ads" };

/** O selo curto de cada situação. "Compra" é a única palavra feminina da lista. */
const SELO: Record<Situacao, { m: string; f: string }> = {
  enviada: { m: "informado", f: "informada" },
  aguardando: { m: "aguardando", f: "aguardando" },
  falha: { m: "recusado", f: "recusada" },
  nao_enviada: { m: "não informado", f: "não informada" },
};

const FRASE: Record<Plataforma, Record<Situacao, { m: string; f: string }>> = {
  meta_ads: {
    enviada: { m: "informado à Meta em", f: "informada à Meta em" },
    aguardando: { m: "na fila para ir à Meta", f: "na fila para ir à Meta" },
    falha: { m: "recusado pela Meta em", f: "recusada pela Meta em" },
    nao_enviada: { m: "não informado à Meta", f: "não informada à Meta" },
  },
  google_ads: {
    enviada: { m: "informado ao Google Ads em", f: "informada ao Google Ads em" },
    aguardando: { m: "na fila para ir ao Google Ads", f: "na fila para ir ao Google Ads" },
    falha: { m: "recusado pelo Google Ads em", f: "recusada pelo Google Ads em" },
    nao_enviada: { m: "não informado ao Google Ads", f: "não informada ao Google Ads" },
  },
};

const SEM_ENVIO: Record<Plataforma, { naoVeio: string; veio: string }> = {
  meta_ads: {
    naoVeio: "Nada foi informado à Meta: este negócio não veio de um anúncio desta plataforma.",
    veio: "Nada foi informado à Meta até agora.",
  },
  google_ads: {
    naoVeio: "Nada foi informado ao Google Ads: este negócio não veio de um anúncio desta plataforma.",
    veio: "Nada foi informado ao Google Ads até agora.",
  },
};

/** O porquê curto de não ter ido (a explicação longa mora em Configurações › Conversões). */
const MOTIVO_CURTO: Record<string, string> = {
  sem_valor: "o negócio fechou sem valor",
  sem_conexao: "nenhuma conta de anúncios conectada",
  conexao_desabilitada: "a conexão está desligada",
  credencial_incompleta: "a conexão está incompleta",
  cifra_indisponivel: "falta a chave de criptografia do servidor",
  plataforma_sem_transporte: "plataforma sem envio de conversão",
  evento_de_teste: "evento de teste",
  recusado_pela_plataforma: "a plataforma recusou",
  sem_atribuicao: "sem clique de anúncio",
};

const COR: Record<Situacao, string> = {
  enviada: "bg-success-bg text-success-fg",
  aguardando: "bg-info-bg text-info-fg",
  falha: "bg-error-bg text-error-fg",
  nao_enviada: "bg-surface-muted text-text-muted",
};

export function ConversoesDaOrigem({ origem }: { origem: CartaoAberto["origem"] }) {
  const t = useT();
  const locale = useLocaleDeData();
  const user = useUser();
  const activeOrg = useActiveOrg();
  // O histórico mora em Configurações › Conversões, que é tela de administrador.
  const podeAbrirOHistorico =
    user.is_platform_admin || (activeOrg ? ROLE_RANK[activeOrg.role] >= ROLE_RANK.admin : false);

  return (
    <div className="mt-3 flex flex-col gap-2" data-testid="conversoes-da-origem">
      <p className="text-xs font-medium text-text">{t("O que cada plataforma ficou sabendo")}</p>
      {PLATAFORMAS.map((plataforma) => {
        // Do mais antigo para o mais novo: é a ordem em que o funil andou.
        const envios = origem.conversoes
          .filter((c) => c.plataforma === plataforma)
          .sort((a, b) => (a.quando ?? "").localeCompare(b.quando ?? ""));
        return (
          <div key={plataforma} data-plataforma={plataforma}>
            <p className="text-[11px] uppercase tracking-wide text-text-muted">{NOME_DA_PLATAFORMA[plataforma]}</p>
            {envios.length === 0 ? (
              <p className="text-xs text-text-muted">
                {t(origem.origemPorPlataforma[plataforma] ? SEM_ENVIO[plataforma].veio : SEM_ENVIO[plataforma].naoVeio)}
              </p>
            ) : (
              <ul className="space-y-1">
                {envios.map((c) => {
                  const genero = c.evento === "Purchase" ? "f" : "m";
                  const dia = c.quando ? format(new Date(c.quando), "dd/MM", { locale }) : null;
                  const comData = c.situacao === "enviada" || c.situacao === "falha";
                  const porque =
                    c.situacao === "falha"
                      ? (c.detalhe ?? (c.motivo ? MOTIVO_CURTO[c.motivo] : null))
                      : c.situacao === "nao_enviada" && c.motivo
                        ? MOTIVO_CURTO[c.motivo]
                        : null;
                  return (
                    <li key={`${c.plataforma}-${c.evento}`} className="flex flex-wrap items-baseline gap-x-1.5 text-xs">
                      <span className={cn("rounded-full px-1.5 py-0.5 text-[11px]", COR[c.situacao])}>
                        {t(SELO[c.situacao][genero])}
                      </span>
                      <span className="min-w-0 break-words">
                        {t(c.rotulo)} {t(FRASE[plataforma][c.situacao][genero])}
                        {comData && dia ? ` ${dia}` : ""}
                        {c.valorCentavos !== null && c.situacao !== "nao_enviada"
                          ? ` · ${formatCents(c.valorCentavos, c.moeda ?? "BRL")}`
                          : ""}
                        {porque ? `: ${c.situacao === "falha" && c.detalhe ? porque : t(porque)}` : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
      {podeAbrirOHistorico ? (
        <Link
          href="/app/settings/conversoes?aba=historico"
          className="self-start text-xs text-text-muted underline underline-offset-2 hover:text-text"
        >
          {t("Ver o histórico de envios")}
        </Link>
      ) : null}
    </div>
  );
}
