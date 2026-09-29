"use client";
/**
 * FORK MIA — um disparo pelo NÚMERO OFICIAL, por dentro (1.21.0-mia.58).
 *
 * No molde do detalhe de Campanhas do upstream (`app/app/campaigns/[id]`): a
 * volta para a lista, o nome com o estado ao lado, o que custou, as ações que
 * cabem no estado atual e, embaixo, quem recebeu e quem não recebeu.
 *
 * O cabeçalho sai da mesma consulta da lista (`useBroadcasts`, até 100 disparos
 * e já reconsultada a cada 15s enquanto algum anda) em vez de uma rota nova de
 * detalhe: são os mesmos campos, e uma segunda fonte para eles divergiria da
 * lista no primeiro disparo que mudasse de estado entre as duas leituras.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";

import { EstadoDaCampanha } from "@/components/campanhas/EstadoDaCampanha";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { useBroadcasts } from "@/hooks/useBroadcasts";
import { doDisparoOficial } from "@/lib/broadcast/lista-unificada";
import { formatCentsBRL } from "@/lib/money";
import { ArrowBendUpLeft, ShieldCheck } from "@/lib/ui/icons";

import { AcoesDoOficial } from "./AcoesDoOficial";
import { TelaDaCampanha } from "./TelaDaCampanha";
import { fraseDoMotivo } from "./textos";

export function DetalheDoOficial({ id }: { id: string }) {
  const t = useT();
  const idioma = useTagDeIdioma();
  const router = useRouter();
  const lista = useBroadcasts();
  const c = lista.data?.find((x) => x.id === id) ?? null;
  const linha = c ? doDisparoOficial(c) : null;

  return (
    <div className="space-y-4 p-6">
      <div>
        <Link
          href="/app/broadcast"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-text"
        >
          <ArrowBendUpLeft size={14} aria-hidden />
          {t("Broadcast")}
        </Link>
      </div>

      {lista.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : c && linha ? (
        <header className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{c.nome}</h1>
            <EstadoDaCampanha status={linha.status} />
            <Badge variant="neutral">
              <ShieldCheck size={12} weight="bold" aria-hidden />
              {t("Número oficial (Meta)")}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {t("Modelo")} {c.template_name} ({c.template_language}) · {t("criada")}{" "}
            {new Date(c.created_at).toLocaleString(idioma, { dateStyle: "short", timeStyle: "short" })}
            {c.status === "agendada" && c.agendado_para
              ? ` · ${t("Sai em")} ${new Date(c.agendado_para).toLocaleString(idioma)}`
              : ""}
          </p>
          {/*
            O CUSTO, com o preço que ficou gravado no disparo — não o de hoje: o
            extrato cobra pelo preço do dia em que a lista foi montada, e mostrar
            outro faria a tela discordar do extrato.
          */}
          <p className="text-sm" data-custo>
            {c.preco_cents === null
              ? t("Sem preço gravado neste disparo.")
              : `${c.andamento.total} ${t("na lista")} × ${formatCentsBRL(c.preco_cents)} = ${formatCentsBRL(
                  c.preco_cents * c.andamento.total,
                )}`}
          </p>
          {c.motivo_da_parada ? (
            <p className="text-sm text-warning-fg">
              {fraseDoMotivo(c.motivo_da_parada, t, t("O disparo parou antes do fim."))}
            </p>
          ) : null}
          <AcoesDoOficial campanha={c} aoExcluir={() => router.push("/app/broadcast")} />
        </header>
      ) : (
        // Fora da lista (excluído, ou mais velho que os 100 da lista): o que
        // saiu continua conferível embaixo; só as ações não aparecem.
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">{t("Campanha")}</h1>
        </header>
      )}

      <TelaDaCampanha id={id} />
    </div>
  );
}
