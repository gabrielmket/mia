"use client";

/**
 * FORK MIA — a lista geral de Obrigações (a agenda de renovações da carteira).
 *
 * Quatro contadores que são também filtros (vencidos, vencendo em 30 dias,
 * pedidos sem resposta, em dia), os filtros de situação, tipo, responsável,
 * "vence em" e "ligado a", a ordem por urgência, e a linha que leva ao negócio
 * ou à ficha dona do item. "Abrir item" abre a folha dele aqui mesmo.
 *
 * Os filtros são da tela: a lista inteira vem numa leitura e a situação é
 * calculada no navegador pela mesma função pura que o servidor usa.
 */
import Link from "next/link";
import { useMemo, useState } from "react";

import { FolhaDaObrigacao, type PedidoDeFolha } from "@/components/obrigacoes/FolhaDaObrigacao";
import { FormularioDeObrigacao } from "@/components/obrigacoes/FormularioDeObrigacao";
import { ClipeDoArquivo, SeloDaSituacao } from "@/components/obrigacoes/pecas";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";
import { useObrigacoes } from "@/hooks/obrigacoes/useObrigacoes";
import {
  CONTADORES_DA_LISTA,
  FILTROS_ZERADOS,
  LIGADO_A_DO_FILTRO,
  PRAZOS_DO_FILTRO,
  aoClicarNoContador,
  contadorLigado,
  passaNaLista,
  type FiltrosDaLista,
  type LigadoADoFiltro,
  type PrazoDoFiltro,
} from "@/lib/obrigacoes/lista";
import {
  ROTULO_DA_SITUACAO,
  SITUACOES,
  contarObrigacoes,
  porUrgencia,
  textoDaRecorrencia,
  textoDaSituacao,
  type Situacao,
} from "@/lib/obrigacoes/situacao";
import { ROTULO_CURTO_DE_QUEM_ENTREGA, ROTULO_DA_CATEGORIA, type ObrigacaoNaTela } from "@/lib/obrigacoes/tipos";
import { cn } from "@/lib/utils";

const ROTULO_DO_PRAZO = {
  todos: "Qualquer data",
  vencidos: "Vencidos",
  "7": "7 dias",
  "15": "15 dias",
  "30": "30 dias",
  "60": "60 dias",
} as const satisfies Record<PrazoDoFiltro, string>;

const ROTULO_DO_LIGADO = {
  todos: "Tudo",
  negocio: "Negócio",
  empresa: "Empresa",
  contato: "Contato",
} as const satisfies Record<LigadoADoFiltro, string>;

const COR_DO_CONTADOR = {
  perigo: "text-error-fg",
  alerta: "text-warning-fg",
  info: "text-accent",
  ok: "text-success-fg",
} as const;

const SELETOR = "h-8 rounded-md border border-border bg-background px-2 text-xs";

/** Para onde a linha leva: o negócio, ou a ficha dona do item. */
function destinoDoItem(item: ObrigacaoNaTela): string {
  if (item.vinculos.negocio) return `/app/leads/${item.vinculos.negocio.id}`;
  if (item.vinculos.empresa) return `/app/empresas/${item.vinculos.empresa.id}`;
  return `/app/contacts/${item.vinculos.contato?.id ?? ""}`;
}

export function ObrigacoesClient() {
  const t = useT();
  const leitura = useObrigacoes({ tipo: "lista" });
  const { data: membros } = useAssignableMembers(true);
  const [filtros, setFiltros] = useState<FiltrosDaLista>(FILTROS_ZERADOS);
  const [folha, setFolha] = useState<PedidoDeFolha | null>(null);
  const [adicionando, setAdicionando] = useState(false);

  const dados = leitura.data;
  const hoje = dados?.hoje ?? "";
  const itens = useMemo(() => dados?.itens ?? [], [dados]);
  const contadores = useMemo(() => (dados ? contarObrigacoes(itens, dados.hoje) : null), [dados, itens]);
  const visiveis = useMemo(
    () => (dados ? porUrgencia(itens.filter((i) => passaNaLista(i, filtros, dados.hoje)), dados.hoje) : []),
    [dados, itens, filtros],
  );
  const nomes = useMemo(() => [...new Set(itens.map((i) => i.nome))].sort((a, b) => a.localeCompare(b)), [itens]);
  const nomeDe = (id: string | null) => (id ? (membros?.find((m) => m.user_id === id)?.full_name ?? null) : null);
  const filtrado = JSON.stringify(filtros) !== JSON.stringify(FILTROS_ZERADOS);
  const mudar = (patch: Partial<FiltrosDaLista>) => setFiltros((f) => ({ ...f, ...patch }));

  return (
    <div className="flex h-full flex-col gap-4 p-6" data-testid="lista-de-obrigacoes">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{t("Obrigações")}</h1>
          <p className="text-sm text-text-muted">
            {t("A agenda de renovações da carteira: documentos e atividades recorrentes de todos os negócios, empresas e contatos, do mais urgente para o menos.")}
          </p>
        </div>
        <Button onClick={() => setAdicionando(true)} disabled={!dados}>
          {t("Adicionar")}
        </Button>
      </header>

      {leitura.isLoading ? <p className="text-sm text-text-muted">{t("Carregando…")}</p> : null}
      {leitura.isError ? (
        <p className="text-sm text-warning-fg">{t("Não consegui carregar as obrigações. Tente de novo em instantes.")}</p>
      ) : null}

      {dados && contadores ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="contadores-de-obrigacoes">
            {CONTADORES_DA_LISTA.map((c) => (
              <button
                key={c.chave}
                type="button"
                aria-pressed={contadorLigado(c.chave, filtros)}
                data-contador={c.chave}
                onClick={() => setFiltros((f) => aoClicarNoContador(c.chave, f))}
                className={cn(
                  "rounded-lg border px-3 py-2 text-left transition-colors hover:border-border-strong",
                  contadorLigado(c.chave, filtros) ? "border-accent bg-accent/10" : "border-border",
                )}
              >
                <span className="block text-[11px] text-text-muted">{t(c.rotulo)}</span>
                <span className={cn("mt-0.5 block text-lg font-semibold tabular-nums", COR_DO_CONTADOR[c.tom])}>
                  {contadores[c.chave]}
                </span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-3 text-xs" data-testid="filtros-de-obrigacoes">
            <label className="flex flex-col gap-1">
              <span className="text-text-muted">{t("Situação")}</span>
              <select
                value={filtros.situacao}
                onChange={(e) => mudar({ situacao: e.target.value as Situacao | "todas" })}
                className={SELETOR}
              >
                <option value="todas">{t("Todas")}</option>
                {SITUACOES.map((s) => (
                  <option key={s} value={s}>
                    {t(ROTULO_DA_SITUACAO[s])}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-text-muted">{t("Tipo")}</span>
              <select value={filtros.tipo} onChange={(e) => mudar({ tipo: e.target.value })} className={SELETOR}>
                <option value="todos">{t("Todos os tipos")}</option>
                <option value="documento">{t("Só documentos")}</option>
                <option value="atividade">{t("Só atividades recorrentes")}</option>
                {nomes.map((nome) => (
                  <option key={nome} value={nome}>
                    {nome}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-text-muted">{t("Responsável")}</span>
              <select value={filtros.responsavel} onChange={(e) => mudar({ responsavel: e.target.value })} className={SELETOR}>
                <option value="todos">{t("Todos")}</option>
                {(membros ?? []).map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.full_name ?? t("Sem nome")}
                  </option>
                ))}
              </select>
            </label>
            <div role="group" aria-label={t("Vence em")} className="flex flex-col gap-1">
              <span className="text-text-muted">{t("Vence em")}</span>
              <div className="flex flex-wrap gap-1">
                {PRAZOS_DO_FILTRO.map((p) => (
                  <Chip key={p} ligado={filtros.prazo === p} aoClicar={() => mudar({ prazo: p, rapido: "" })}>
                    {t(ROTULO_DO_PRAZO[p])}
                  </Chip>
                ))}
              </div>
            </div>
            <div role="group" aria-label={t("Ligado a")} className="flex flex-col gap-1">
              <span className="text-text-muted">{t("Ligado a")}</span>
              <div className="flex flex-wrap gap-1">
                {LIGADO_A_DO_FILTRO.map((l) => (
                  <Chip key={l} ligado={filtros.ligado === l} aoClicar={() => mudar({ ligado: l })}>
                    {t(ROTULO_DO_LIGADO[l])}
                  </Chip>
                ))}
              </div>
            </div>
            {filtrado ? (
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setFiltros(FILTROS_ZERADOS)}>
                {t("Limpar filtros")}
              </Button>
            ) : null}
          </div>

          <p className="text-[11px] text-text-muted">
            {visiveis.length} {t("de")} {itens.length} {t("itens")} · {t("ordenados por urgência")} ·{" "}
            {t("clique na linha para abrir o negócio ou a ficha a que o item pertence")}
            {dados.cortada ? ` · ${t("a lista passou do teto: use os filtros dos negócios e das fichas para ver o restante")}` : ""}
          </p>

          <div className="min-h-0 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead className="bg-surface-muted text-[11px] text-text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">{t("Item")}</th>
                  <th className="px-3 py-2 font-medium">{t("Ligado a")}</th>
                  <th className="px-3 py-2 font-medium">{t("Situação")}</th>
                  <th className="px-3 py-2 font-medium">{t("A data que importa")}</th>
                  <th className="px-3 py-2 font-medium">{t("Quem entrega")}</th>
                  <th className="px-3 py-2 font-medium">{t("Recorrência")}</th>
                  <th className="px-3 py-2 font-medium">{t("Responsável")}</th>
                  <th className="px-3 py-2 font-medium">{t("Arquivo")}</th>
                  <th className="px-3 py-2 font-medium">{t("Ação")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visiveis.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-6 text-center text-text-muted">
                      {itens.length === 0
                        ? t("Nenhum documento ou atividade ainda. Adicione o primeiro aqui, no cartão de um negócio ou na ficha de uma empresa.")
                        : t("Nada com estes filtros.")}
                    </td>
                  </tr>
                ) : (
                  visiveis.map((item) => (
                    <tr key={item.id} data-obrigacao={item.id} className="align-top hover:bg-surface-muted">
                      <td className="px-3 py-2">
                        <Link href={destinoDoItem(item)} className="font-medium text-text hover:underline">
                          {item.nome}
                        </Link>
                        <span className="block text-[11px] text-text-muted">{t(ROTULO_DA_CATEGORIA[item.categoria])}</span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col gap-0.5">
                          {item.vinculos.negocio ? (
                            <Link href={`/app/leads/${item.vinculos.negocio.id}`} className="hover:underline">
                              <span className="text-text-muted">{t("negócio")}</span> {item.vinculos.negocio.titulo}
                            </Link>
                          ) : null}
                          {item.vinculos.empresa ? (
                            <Link href={`/app/empresas/${item.vinculos.empresa.id}`} className="hover:underline">
                              <span className="text-text-muted">{t("empresa")}</span> {item.vinculos.empresa.nome}
                            </Link>
                          ) : null}
                          {item.vinculos.contato ? (
                            <Link href={`/app/contacts/${item.vinculos.contato.id}`} className="hover:underline">
                              <span className="text-text-muted">{t("contato")}</span> {item.vinculos.contato.nome}
                            </Link>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <SeloDaSituacao item={item} hoje={hoje} />
                      </td>
                      <td className="px-3 py-2">{textoDaSituacao(item, hoje, t)}</td>
                      <td className="px-3 py-2">{t(ROTULO_CURTO_DE_QUEM_ENTREGA[item.quem_entrega])}</td>
                      <td className="px-3 py-2">{textoDaRecorrencia(item, t)}</td>
                      <td className="px-3 py-2">{nomeDe(item.responsavel_user_id) ?? t("sem responsável")}</td>
                      <td className="px-3 py-2">
                        {item.tem_arquivo ? <ClipeDoArquivo item={item} /> : <span className="text-text-muted">{t("sem")}</span>}
                      </td>
                      <td className="px-3 py-2">
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setFolha({ id: item.id })}>
                          {t("Abrir item")}
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <FormularioDeObrigacao
            aberto={adicionando}
            aoFechar={() => setAdicionando(false)}
            contexto={dados.contexto}
            hoje={dados.hoje}
            aoAdicionar={(id) => setFolha({ id })}
          />
        </>
      ) : null}
      <FolhaDaObrigacao pedido={folha} aoFechar={() => setFolha(null)} />
    </div>
  );
}

function Chip({ ligado, aoClicar, children }: { ligado: boolean; aoClicar: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={ligado}
      onClick={aoClicar}
      className={cn(
        "h-8 rounded-full border px-3 text-xs transition-colors",
        ligado ? "border-accent bg-accent/10 font-medium text-accent" : "border-border text-text-muted hover:text-text",
      )}
    >
      {children}
    </button>
  );
}
