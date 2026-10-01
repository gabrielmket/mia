"use client";

/**
 * FORK MIA — a FOLHA de um item de Documentos e obrigações.
 *
 * O detalhe do item: a situação calculada e a trilha dela, as datas, quem
 * entrega, a recorrência, o arquivo (em área privada), os botões da situação, o
 * painel de RECEBER (o "válido até" sugerido pela validade do tipo, a prévia do
 * próximo ciclo e o arquivo), a antecedência dos avisos e o histórico: ciclos
 * anteriores, avisos que as automações dispararam e propostas do agente.
 *
 * Abre por cima do cartão aberto, das fichas e da lista: é o mesmo registro em
 * todo lugar, então mexer aqui muda em todos.
 */
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useT } from "@/hooks/i18n/useT";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";
import { useAcoesDeObrigacao, useDetalheDaObrigacao } from "@/hooks/obrigacoes/useObrigacoes";
import { receberRenova, textoDoProximoCiclo, validadeSugerida } from "@/lib/obrigacoes/ciclo";
import { comoDia, diaPorExtenso, type Dia } from "@/lib/obrigacoes/datas";
import { ROTULOS_DOS_GATILHOS_DE_OBRIGACAO, ehGatilhoDeObrigacao } from "@/lib/obrigacoes/gatilhos";
import {
  ROTULO_DA_SITUACAO,
  SITUACOES_DA_ATIVIDADE,
  SITUACOES_DO_DOCUMENTO,
  mesesDaRecorrencia,
  situacao,
  textoDaRecorrencia,
  textoDaSituacao,
} from "@/lib/obrigacoes/situacao";
import {
  ROTULO_DA_CATEGORIA,
  ROTULO_DE_QUEM_ENTREGA,
  type ObrigacaoNaTela,
  type PropostaPendente,
} from "@/lib/obrigacoes/tipos";
import { cn } from "@/lib/utils";
import { BotoesDoItem, ClipeDoArquivo, PropostaDoAgente, SeloDaSituacao } from "./pecas";

export interface PedidoDeFolha {
  id: string;
  /** Abre já no painel de receber. */
  receber?: boolean;
  /** O recebimento vem da proposta do agente: o arquivo é o da conversa. */
  proposta?: PropostaPendente | null;
}

const ROTULO_DA_DECISAO = {
  confirmada: "confirmada por uma pessoa",
  recusada: "recusada: não era o documento",
  superada: "substituída por outro recebimento",
} as const;

export function FolhaDaObrigacao({ pedido, aoFechar }: { pedido: PedidoDeFolha | null; aoFechar: () => void }) {
  const t = useT();
  const detalhe = useDetalheDaObrigacao(pedido?.id ?? null);
  const { data: membros } = useAssignableMembers(true);
  const acoes = useAcoesDeObrigacao();
  const [recebendo, setRecebendo] = useState(Boolean(pedido?.receber));
  const [proposta, setProposta] = useState<PropostaPendente | null>(pedido?.proposta ?? null);
  // Pedido novo (outro item, ou o mesmo já no painel de receber): o estado da
  // folha recomeça. Ajuste durante o render, e não num efeito, para a folha
  // nunca pintar um quadro com o estado do pedido anterior.
  const [pedidoVisto, setPedidoVisto] = useState(pedido);
  if (pedidoVisto !== pedido) {
    setPedidoVisto(pedido);
    setRecebendo(Boolean(pedido?.receber));
    setProposta(pedido?.proposta ?? null);
  }

  const dados = detalhe.data;
  const item = dados?.item;
  const hoje = dados?.hoje;
  const nomeDe = (id: string | null) => (id ? (membros?.find((m) => m.user_id === id)?.full_name ?? null) : null);

  return (
    <Sheet open={pedido !== null} onOpenChange={(aberto) => !aberto && aoFechar()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-xl" data-testid="folha-da-obrigacao">
        <SheetHeader className="pb-2 pr-8">
          <SheetDescription className="text-[11px]">
            {item ? t(ROTULO_DA_CATEGORIA[item.categoria]) : t("Documentos e obrigações")}
          </SheetDescription>
          <SheetTitle className="break-words text-base leading-6">{item?.nome ?? t("Carregando…")}</SheetTitle>
        </SheetHeader>

        {detalhe.isLoading ? <p className="text-xs text-text-muted">{t("Carregando…")}</p> : null}
        {detalhe.isError ? (
          <p className="text-xs text-warning-fg">{t("Não consegui carregar este item. Tente de novo em instantes.")}</p>
        ) : null}

        {item && hoje ? (
          <div className="space-y-4">
            <nav aria-label={t("Ligado a")} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-text-muted">
              <span>{t("Ligado a")}</span>
              {item.vinculos.negocio ? (
                <Link href={`/app/leads/${item.vinculos.negocio.id}`} className="rounded-full bg-surface-muted px-2 py-0.5 hover:text-text">
                  {t("Negócio")} · {item.vinculos.negocio.titulo}
                </Link>
              ) : null}
              {item.vinculos.empresa ? (
                <Link href={`/app/empresas/${item.vinculos.empresa.id}`} className="rounded-full bg-surface-muted px-2 py-0.5 hover:text-text">
                  {t("Empresa")} · {item.vinculos.empresa.nome}
                </Link>
              ) : null}
              {item.vinculos.contato ? (
                <Link href={`/app/contacts/${item.vinculos.contato.id}`} className="rounded-full bg-surface-muted px-2 py-0.5 hover:text-text">
                  {t("Contato")} · {item.vinculos.contato.nome}
                </Link>
              ) : null}
            </nav>

            {item.proposta && !recebendo ? (
              <PropostaDoAgente
                item={item}
                proposta={item.proposta}
                aoConfirmar={(_, p) => {
                  setProposta(p);
                  setRecebendo(true);
                }}
              />
            ) : null}

            <section className="space-y-2">
              <p className="flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
                <SeloDaSituacao item={item} hoje={hoje} />
                <span>{textoDaSituacao(item, hoje, t)}</span>
              </p>
              <TrilhaDaSituacao item={item} hoje={hoje} />
              <dl className="grid grid-cols-[minmax(110px,max-content)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
                {item.categoria === "atividade" ? (
                  <>
                    <Campo rotulo={t("Próxima data")}>{diaPorExtenso(item.proxima_em) || t("não se repete")}</Campo>
                    <Campo rotulo={t("Última feita")}>{diaPorExtenso(item.feita_em) || t("ainda não feita")}</Campo>
                  </>
                ) : (
                  <>
                    <Campo rotulo={t("Pedido em")}>{diaPorExtenso(item.pedido_em) || t("sem pedido em aberto")}</Campo>
                    <Campo rotulo={t("Prazo para entregar")}>{diaPorExtenso(item.prazo_em) || t("sem prazo")}</Campo>
                    <Campo rotulo={t("Recebido em")}>{diaPorExtenso(item.recebido_em) || t("não recebido")}</Campo>
                    <Campo rotulo={t("Válido até")}>{diaPorExtenso(item.valido_ate) || t("sem validade")}</Campo>
                  </>
                )}
                <Campo rotulo={t("Quem entrega")}>{t(ROTULO_DE_QUEM_ENTREGA[item.quem_entrega])}</Campo>
                <Campo rotulo={t("Recorrência")}>{textoDaRecorrencia(item, t)}</Campo>
                <Campo rotulo={t("Responsável")}>{nomeDe(item.responsavel_user_id) ?? t("sem responsável")}</Campo>
                {item.categoria === "documento" ? (
                  <Campo rotulo={t("Arquivo")}>
                    {item.tem_arquivo ? (
                      <span className="inline-flex flex-wrap items-center gap-1">
                        <ClipeDoArquivo item={item} />
                        <span className="break-all">{item.arquivo_nome ?? t("arquivo")}</span>
                        <span className="text-[11px] text-text-muted">
                          · {t("Área privada; apagado junto com o contato num pedido de esquecimento.")}
                        </span>
                      </span>
                    ) : (
                      t("sem arquivo")
                    )}
                  </Campo>
                ) : null}
                {item.observacao ? <Campo rotulo={t("Observação")}>{item.observacao}</Campo> : null}
              </dl>

              {recebendo ? (
                <PainelDeReceber
                  item={item}
                  hoje={hoje}
                  proposta={proposta}
                  aoCancelar={() => {
                    setRecebendo(false);
                    setProposta(null);
                  }}
                  aoConcluir={() => {
                    setRecebendo(false);
                    setProposta(null);
                  }}
                />
              ) : (
                <div className="flex flex-wrap gap-1">
                  <BotoesDoItem
                    item={item}
                    hoje={hoje}
                    aoReceber={() => {
                      setProposta(null);
                      setRecebendo(true);
                    }}
                  />
                </div>
              )}
            </section>

            <AntecedenciaDosAvisos key={[item.id, item.avisos_dias.join(","), item.dias_sem_resposta].join(":")} item={item} />

            <section className="space-y-1.5" data-testid="historico-da-obrigacao">
              <h3 className="text-xs font-medium uppercase tracking-wide text-text-muted">{t("Histórico do item")}</h3>
              {dados.ciclos.length + dados.avisos.length + dados.propostas.length === 0 ? (
                <p className="text-xs text-text-muted">{t("Primeiro ciclo. Ainda não há histórico.")}</p>
              ) : (
                <ul className="space-y-1 text-xs text-text">
                  {dados.avisos.map((a) => (
                    <li key={a.id}>
                      {a.segurado
                        ? `${t("Aviso segurado: há um arquivo do cliente esperando confirmação")}`
                        : `${diaPorExtenso(a.disparado_em?.slice(0, 10))} · ${t("aviso disparado")}`}
                      {" · "}
                      {ehGatilhoDeObrigacao(a.gatilho) ? t(ROTULOS_DOS_GATILHOS_DE_OBRIGACAO[a.gatilho]) : a.gatilho}
                      {a.regra ? ` · ${a.regra}` : ""}
                    </li>
                  ))}
                  {dados.propostas.map((p) => (
                    <li key={p.id}>
                      {diaPorExtenso(p.criada_em.slice(0, 10))} · {t("o agente propôs um arquivo")}
                      {p.arquivo_nome ? ` “${p.arquivo_nome}”` : ""} · {t(ROTULO_DA_DECISAO[p.situacao])}
                    </li>
                  ))}
                  {dados.ciclos.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-1">
                      <span>
                        {t("Ciclo")} {c.ciclo} ·{" "}
                        {c.como === "feita"
                          ? `${t("previsto para")} ${diaPorExtenso(c.proxima_em)} · ${t("feita em")} ${diaPorExtenso(c.feita_em)}`
                          : `${c.recebido_em ? `${t("recebido em")} ${diaPorExtenso(c.recebido_em)}` : t("sem data de recebimento")}${
                              c.valido_ate ? ` · ${t("válido até")} ${diaPorExtenso(c.valido_ate)}` : ""
                            }`}
                      </span>
                      {c.tem_arquivo ? <ClipeDoArquivo item={{ id: item.id, arquivo_nome: c.arquivo_nome }} cicloId={c.id} /> : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="border-t border-border pt-3">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-text-muted"
                disabled={acoes.editar.isPending}
                onClick={() => {
                  if (!window.confirm(t("Arquivar este item? Ele sai das listas; o histórico e o arquivo ficam guardados."))) return;
                  acoes.editar.mutate(
                    { id: item.id, campos: { arquivado: true } },
                    {
                      onSuccess: () => {
                        toast.success(t("Item arquivado."));
                        aoFechar();
                      },
                    },
                  );
                }}
              >
                {t("Arquivar item")}
              </Button>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-text-muted">{rotulo}</dt>
      <dd className="min-w-0 break-words text-text">{children}</dd>
    </>
  );
}

/** A trilha: por onde o item passa, com a situação de hoje em destaque. */
function TrilhaDaSituacao({ item, hoje }: { item: ObrigacaoNaTela; hoje: Dia }) {
  const t = useT();
  const atual = situacao(item, hoje);
  const cadeia = item.categoria === "atividade" ? SITUACOES_DA_ATIVIDADE : SITUACOES_DO_DOCUMENTO;
  const repete = mesesDaRecorrencia(item) > 0;
  return (
    <ol className="flex flex-wrap items-center gap-1 text-[11px]" aria-label={t("Situação calculada pelas datas")} data-testid="trilha-da-situacao">
      {cadeia.map((s, i) => (
        <li key={s} className="flex items-center gap-1">
          {i > 0 ? <span aria-hidden className="text-text-muted">›</span> : null}
          <span
            aria-current={s === atual ? "step" : undefined}
            className={cn(
              "rounded-full px-2 py-0.5",
              s === atual ? "bg-accent/10 font-medium text-accent" : "bg-surface-muted text-text-muted",
            )}
          >
            {t(ROTULO_DA_SITUACAO[s])}
          </span>
        </li>
      ))}
      {item.categoria === "documento" ? (
        <li className="flex items-center gap-1">
          <span aria-hidden className="text-text-muted">↺</span>
          <span className={cn("rounded-full px-2 py-0.5", item.renovado_em ? "bg-success-bg text-success-fg" : "bg-surface-muted text-text-muted")}>
            {t("renovado (novo ciclo)")}
          </span>
        </li>
      ) : repete ? (
        <li className="flex items-center gap-1 text-text-muted">
          <span aria-hidden>↺</span>
          {t("o próximo ciclo nasce sozinho")}
        </li>
      ) : null}
    </ol>
  );
}

function PainelDeReceber({
  item,
  hoje,
  proposta,
  aoCancelar,
  aoConcluir,
}: {
  item: ObrigacaoNaTela;
  hoje: Dia;
  proposta: PropostaPendente | null;
  aoCancelar: () => void;
  aoConcluir: () => void;
}) {
  const t = useT();
  const acoes = useAcoesDeObrigacao();
  const sugerida = validadeSugerida(item, hoje);
  const [validade, setValidade] = useState<string>(sugerida ?? "");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const validoAte = comoDia(validade);
  const ocupado = acoes.receber.isPending || acoes.decidirProposta.isPending;

  function concluir(mensagem: string) {
    toast.success(mensagem);
    aoConcluir();
  }
  const resumo = (renovou: boolean) =>
    `${t("Recebido.")}${
      validoAte
        ? ` ${mesesDaRecorrencia(item) > 0 ? t("Próximo ciclo: vence em") : t("Válido até")} ${diaPorExtenso(validoAte)}.`
        : ""
    }${renovou ? ` ${t("O ciclo anterior foi para o histórico.")}` : ""}`;

  return (
    <div className="space-y-2 rounded-md border border-border p-3" data-testid="painel-de-receber">
      <p className="text-xs font-medium text-text">
        {t("Registrar recebimento")} · {diaPorExtenso(hoje)}
      </p>
      <div className="space-y-1">
        <Label htmlFor="receber-validade" className="text-xs">
          {t("Válido até")}
          {sugerida ? "" : ` (${t("opcional")})`}
        </Label>
        <Input id="receber-validade" type="date" value={validade} onChange={(e) => setValidade(e.target.value)} className="h-8 text-xs" />
      </div>
      {proposta ? (
        <p className="text-[11px] text-text-muted">
          {t("Arquivo")}: {proposta.arquivo_nome ?? t("o arquivo da conversa")} · {t("copiado da conversa do WhatsApp para a área privada.")}
        </p>
      ) : (
        <div className="space-y-1">
          <Label htmlFor="receber-arquivo" className="text-xs">
            {t("Arquivo (opcional, fica em área privada)")}
          </Label>
          <Input
            id="receber-arquivo"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.doc,.docx,.xls,.xlsx"
            onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
            className="h-8 text-xs"
          />
        </div>
      )}
      <p className="text-[11px] text-text-muted">{textoDoProximoCiclo(item, validoAte, t)}</p>
      {validade && !validoAte ? <p className="text-[11px] text-warning-fg">{t("Esta data não existe no calendário.")}</p> : null}
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          className="h-7 text-xs"
          disabled={ocupado || (validade !== "" && !validoAte)}
          onClick={() => {
            if (proposta) {
              acoes.decidirProposta.mutate(
                { propostaId: proposta.id, decisao: "confirmar", validoAte },
                {
                  onSuccess: (r) =>
                    concluir(
                      resumo(Boolean(r.renovou)) +
                        (r.arquivo_copiado === false
                          ? ` ${t("O arquivo da conversa não estava mais disponível: o item foi recebido sem arquivo.")}`
                          : ""),
                    ),
                },
              );
              return;
            }
            acoes.receber.mutate({ id: item.id, validoAte, arquivo }, { onSuccess: (r) => concluir(resumo(r.renovou)) });
          }}
        >
          {t("Confirmar recebimento")}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={aoCancelar}>
          {t("Cancelar")}
        </Button>
      </div>
      {receberRenova(item) ? null : (
        <p className="text-[11px] text-text-muted">{t("Primeiro recebimento deste item.")}</p>
      )}
    </div>
  );
}

function AntecedenciaDosAvisos({ item }: { item: ObrigacaoNaTela }) {
  const t = useT();
  const acoes = useAcoesDeObrigacao();
  // Quem chama remonta este bloco (pela `key`) quando o item ou os avisos gravados mudam.
  const [avisos, setAvisos] = useState<string[]>(() => [0, 1, 2].map((i) => (item.avisos_dias[i] ? String(item.avisos_dias[i]) : "")));
  const [semResposta, setSemResposta] = useState(() => String(item.dias_sem_resposta));

  const atividade = item.categoria === "atividade";
  return (
    <section className="space-y-2" data-testid="avisos-da-obrigacao">
      <h3 className="text-xs font-medium uppercase tracking-wide text-text-muted">{t("Antecedência dos avisos")}</h3>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-text">
        <span>{t("Avisar")}</span>
        {[0, 1, 2].map((i) => (
          <Input
            key={i}
            type="number"
            min={1}
            max={3650}
            value={avisos[i]}
            aria-label={`${i + 1}º ${t("aviso, dias antes")}`}
            onChange={(e) => setAvisos((antes) => antes.map((v, j) => (j === i ? e.target.value : v)))}
            className="h-7 w-16 text-xs"
          />
        ))}
        <span>{atividade ? t("dias antes da próxima data") : t("dias antes de vencer")}</span>
      </div>
      {atividade ? null : (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-text">
          <span>{t("Avisar se foi pedido há")}</span>
          <Input
            type="number"
            min={1}
            max={365}
            value={semResposta}
            aria-label={t("dias sem receber")}
            onChange={(e) => setSemResposta(e.target.value)}
            className="h-7 w-16 text-xs"
          />
          <span>{t("dias sem receber")}</span>
        </div>
      )}
      <p className="text-[11px] text-text-muted">
        {atividade
          ? t("A situação \"pendente\" começa no maior aviso. Quem manda a mensagem é a automação (tela Automações).")
          : t("A situação \"vencendo\" começa no maior aviso. Quem manda a mensagem é a automação (tela Automações).")}
      </p>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        disabled={acoes.editar.isPending}
        onClick={() => {
          const dias = avisos.map(Number).filter((n) => Number.isInteger(n) && n > 0);
          const sr = Number(semResposta);
          acoes.editar.mutate(
            {
              id: item.id,
              campos: {
                avisos_dias: [...new Set(dias)].sort((a, b) => b - a),
                ...(!atividade && Number.isInteger(sr) && sr > 0 ? { dias_sem_resposta: sr } : {}),
              },
            },
            { onSuccess: () => toast.success(t("Avisos salvos. A situação foi recalculada.")) },
          );
        }}
      >
        {t("Salvar avisos")}
      </Button>
    </section>
  );
}
