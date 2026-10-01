"use client";

/**
 * FORK MIA — as peças pequenas de Documentos e obrigações, usadas pelo cartão
 * aberto, pelas fichas, pela folha do item e pela lista geral.
 *
 * Toda régua (situação, urgência, texto) vem de `lib/obrigacoes/situacao.ts`,
 * que é pura e testada dia a dia. Aqui é só desenho.
 */
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { useAcoesDeObrigacao } from "@/hooks/obrigacoes/useObrigacoes";
import { diaPorExtenso, type Dia } from "@/lib/obrigacoes/datas";
import {
  ROTULO_DA_SITUACAO,
  acoesDoItem,
  situacao,
  textoDaRecorrencia,
  textoDaSituacao,
  tomDaSituacao,
  type BotaoDoItem,
  type Tom,
} from "@/lib/obrigacoes/situacao";
import { ROTULO_DA_CATEGORIA, type ObrigacaoNaTela, type PropostaPendente } from "@/lib/obrigacoes/tipos";
import { Paperclip } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

const COR_DO_TOM = {
  ok: "bg-success-bg text-success-fg",
  alerta: "bg-warning-bg text-warning-fg",
  perigo: "bg-error-bg text-error-fg",
  info: "bg-accent/10 text-accent",
  neutro: "bg-surface-muted text-text-muted",
} as const satisfies Record<Tom, string>;

/** O selo da situação CALCULADA: ninguém digita. */
export function SeloDaSituacao({ item, hoje }: { item: ObrigacaoNaTela; hoje: Dia }) {
  const t = useT();
  const s = situacao(item, hoje);
  return (
    <span
      data-situacao={s}
      className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium", COR_DO_TOM[tomDaSituacao(item, hoje)])}
    >
      {t(ROTULO_DA_SITUACAO[s])}
    </span>
  );
}

/** O clipe que abre o arquivo (link assinado de vida curta, pela rota). */
export function ClipeDoArquivo({ item, cicloId }: { item: Pick<ObrigacaoNaTela, "id" | "arquivo_nome">; cicloId?: string }) {
  const t = useT();
  return (
    <a
      href={`/api/v1/obrigacoes/${item.id}/arquivo${cicloId ? `?ciclo=${cicloId}` : ""}`}
      target="_blank"
      rel="noreferrer"
      title={`${t("Abrir o arquivo")}${item.arquivo_nome ? `: ${item.arquivo_nome}` : ""}`}
      aria-label={t("Abrir o arquivo")}
      className="inline-flex shrink-0 items-center text-text-muted hover:text-text"
    >
      <Paperclip size={12} aria-hidden />
    </a>
  );
}

/**
 * O que os botões do item fazem. "Marcar feita" e "Marcar pedido" gravam na
 * hora; "Marcar recebido" abre o painel de receber (quem chama decide como).
 */
export function useBotoesDoItem(aoReceber: (item: ObrigacaoNaTela) => void) {
  const t = useT();
  const acoes = useAcoesDeObrigacao();
  const ocupado = acoes.pedir.isPending || acoes.marcarFeita.isPending;

  function acionar(item: ObrigacaoNaTela, botao: BotaoDoItem) {
    if (botao.acao === "receber") {
      aoReceber(item);
      return;
    }
    if (botao.acao === "feita") {
      acoes.marcarFeita.mutate(item.id, {
        onSuccess: (r) =>
          toast.success(
            r.proxima_em
              ? `${t("Feita. O próximo ciclo nasceu sozinho:")} ${diaPorExtenso(r.proxima_em)}.`
              : t("Feita. Esta atividade não se repete."),
          ),
      });
      return;
    }
    acoes.pedir.mutate(item.id, {
      onSuccess: (r) =>
        toast.success(
          r.modo === "pedido_de_novo"
            ? t("Cobrança registrada. Nada foi enviado ao cliente por aqui.")
            : `${r.modo === "renovacao_pedida" ? t("Renovação pedida.") : t("Pedido registrado.")} ${t("Prazo para entregar:")} ${diaPorExtenso(r.item.prazo_em)}.`,
        ),
    });
  }

  return { acionar, ocupado };
}

export function BotoesDoItem({
  item,
  hoje,
  aoReceber,
  soAPrimaria = false,
}: {
  item: ObrigacaoNaTela;
  hoje: Dia;
  aoReceber: (item: ObrigacaoNaTela) => void;
  /** Na linha da lista só cabe o botão principal; a folha mostra todos. */
  soAPrimaria?: boolean;
}) {
  const t = useT();
  const { acionar, ocupado } = useBotoesDoItem(aoReceber);
  const todos = acoesDoItem(item, hoje);
  const s = situacao(item, hoje);
  // Com tudo em dia, a linha não oferece botão: quem quer renovar abre o item.
  const botoes = soAPrimaria ? (s === "valido" || s === "recebido" || s === "feita" ? [] : todos.slice(0, 1)) : todos;
  if (botoes.length === 0) return null;
  return (
    <>
      {botoes.map((b) => (
        <Button
          key={b.acao}
          size="sm"
          variant={b.primaria ? "default" : "outline"}
          className="h-7 text-xs"
          disabled={ocupado}
          data-acao-da-obrigacao={b.acao}
          onClick={() => acionar(item, b)}
        >
          {t(b.rotulo)}
        </Button>
      ))}
    </>
  );
}

/** Uma linha de item: o nome, o que ele é, a situação e a ação principal. */
export function LinhaDaObrigacao({
  item,
  hoje,
  nomeDoResponsavel,
  aoAbrir,
  aoReceber,
}: {
  item: ObrigacaoNaTela;
  hoje: Dia;
  nomeDoResponsavel: string | null;
  aoAbrir: (item: ObrigacaoNaTela) => void;
  aoReceber: (item: ObrigacaoNaTela) => void;
}) {
  const t = useT();
  const detalhes = [
    t(ROTULO_DA_CATEGORIA[item.categoria]),
    item.quem_entrega === "nos" ? t("nós entregamos") : t("o cliente entrega"),
    textoDaRecorrencia(item, t).toLowerCase(),
    nomeDoResponsavel ? `${t("resp.")} ${nomeDoResponsavel}` : null,
  ].filter(Boolean);
  return (
    <li className="flex flex-col gap-1.5 py-2 sm:flex-row sm:items-start sm:justify-between" data-testid="linha-da-obrigacao" data-obrigacao={item.id}>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-xs font-medium text-text">
          <span className="min-w-0 break-words">{item.nome}</span>
          {item.tem_arquivo ? <ClipeDoArquivo item={item} /> : null}
        </p>
        <p className="text-[11px] text-text-muted">{detalhes.join(" · ")}</p>
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-text-muted">
          <SeloDaSituacao item={item} hoje={hoje} />
          <span className="min-w-0 break-words">{textoDaSituacao(item, hoje, t)}</span>
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        <BotoesDoItem item={item} hoje={hoje} aoReceber={aoReceber} soAPrimaria />
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => aoAbrir(item)}>
          {t("Ver histórico")}
        </Button>
      </div>
    </li>
  );
}

/**
 * A proposta do agente de IA: "o cliente mandou um arquivo; é o documento
 * pedido?". O agente propõe, a pessoa confirma. Ele nunca marca recebido.
 */
export function PropostaDoAgente({
  item,
  proposta,
  aoConfirmar,
}: {
  item: ObrigacaoNaTela;
  proposta: PropostaPendente;
  /** "Sim": abre o painel de receber já com o arquivo da conversa. */
  aoConfirmar: (item: ObrigacaoNaTela, proposta: PropostaPendente) => void;
}) {
  const t = useT();
  const acoes = useAcoesDeObrigacao();
  return (
    <div className="rounded-md border border-accent/40 bg-accent/10 p-2 text-xs" data-testid="proposta-do-agente" data-obrigacao={item.id}>
      <p className="font-medium text-text">
        {t("O cliente enviou um arquivo no WhatsApp")}
        {proposta.arquivo_nome ? `: “${proposta.arquivo_nome}”` : ""}. {t("É este documento:")} {item.nome}?
      </p>
      <p className="mt-0.5 text-[11px] text-text-muted">
        {[proposta.de, diaPorExtenso(proposta.criada_em.slice(0, 10))].filter(Boolean).join(" · ")}
        {proposta.conversation_id ? (
          <>
            {" · "}
            <Link href={`/app/inbox?id=${proposta.conversation_id}`} className="underline underline-offset-2 hover:text-text">
              {t("ver na conversa")}
            </Link>
          </>
        ) : null}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        <Button size="sm" className="h-7 text-xs" onClick={() => aoConfirmar(item, proposta)}>
          {t("Sim, marcar recebido")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={acoes.decidirProposta.isPending}
          onClick={() =>
            acoes.decidirProposta.mutate(
              { propostaId: proposta.id, decisao: "recusar" },
              { onSuccess: () => toast.success(t("Certo. O arquivo fica só na conversa e o item continua pendente.")) },
            )
          }
        >
          {t("Não é")}
        </Button>
      </div>
      <p className="mt-1.5 text-[11px] text-text-muted">{t("O agente propõe, a pessoa confirma. Ele nunca marca recebido sozinho.")}</p>
    </div>
  );
}
