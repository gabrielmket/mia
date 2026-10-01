"use client";

/**
 * FORK MIA — a seção "Documentos e obrigações" do cartão aberto e das fichas.
 *
 * O mesmo componente nos três lugares, porque é o mesmo registro: mexer no
 * item pela ficha da empresa muda no cartão de todo negócio dela.
 *
 *   cartão aberto      Do negócio · Da empresa (herdado) · Do contato (herdado)
 *   ficha da empresa   Da empresa · Dos contatos da empresa · Dos negócios dela
 *   ficha do contato   Do contato · Da empresa (herdado)
 *
 * A situação é calculada pelas datas (`lib/obrigacoes/situacao.ts`), com o
 * "hoje" do fuso da empresa que a leitura devolve.
 */
import { useMemo, useState } from "react";

import { Secao } from "@/components/cartoes/aberto/Secao";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";
import { useObrigacoes } from "@/hooks/obrigacoes/useObrigacoes";
import { grupoNaEmpresa, grupoNoContato, grupoNoNegocio, type GrupoDaObrigacao } from "@/lib/obrigacoes/heranca";
import { porUrgencia } from "@/lib/obrigacoes/situacao";
import type { EscopoDaLeitura, ObrigacaoNaTela } from "@/lib/obrigacoes/tipos";
import { FolhaDaObrigacao, type PedidoDeFolha } from "./FolhaDaObrigacao";
import { FormularioDeObrigacao } from "./FormularioDeObrigacao";
import { LinhaDaObrigacao, PropostaDoAgente } from "./pecas";

type EscopoComDono = Exclude<EscopoDaLeitura, { tipo: "lista" }>;

export function SecaoDeObrigacoes({
  escopo,
  mostrarPropostas = true,
  id,
}: {
  escopo: EscopoComDono;
  /** No cartão aberto as propostas do agente ficam no Foco, e não aqui. */
  mostrarPropostas?: boolean;
  id?: string;
}) {
  const t = useT();
  const leitura = useObrigacoes(escopo);
  const { data: membros } = useAssignableMembers(true);
  const [folha, setFolha] = useState<PedidoDeFolha | null>(null);
  const [adicionando, setAdicionando] = useState(false);

  const dados = leitura.data;
  const grupos = useMemo(() => {
    const vazio: Record<GrupoDaObrigacao, ObrigacaoNaTela[]> = { negocio: [], empresa: [], contato: [] };
    if (!dados) return vazio;
    const { contexto } = dados;
    const contatosDaEmpresa = new Set(contexto.contatos_da_empresa.map((c) => c.id));
    for (const item of porUrgencia(dados.itens, dados.hoje)) {
      let grupo: GrupoDaObrigacao | null = null;
      if (escopo.tipo === "negocio" && contexto.negocio) {
        grupo = grupoNoNegocio(item, contexto.negocio);
      } else if (escopo.tipo === "empresa") {
        // O que não é da empresa nem de um contato dela veio por um negócio dela.
        grupo = grupoNaEmpresa(item, { id: escopo.id, contatos: contatosDaEmpresa, negocios: new Set(item.lead_id ? [item.lead_id] : []) });
      } else if (escopo.tipo === "contato" && contexto.contato) {
        grupo = grupoNoContato(item, contexto.contato);
      }
      if (grupo) vazio[grupo].push(item);
    }
    return vazio;
  }, [dados, escopo]);

  const nomeDe = (userId: string | null) => (userId ? (membros?.find((m) => m.user_id === userId)?.full_name ?? null) : null);
  const total = grupos.negocio.length + grupos.empresa.length + grupos.contato.length;
  const comProposta = dados ? dados.itens.filter((i) => i.proposta) : [];

  const grupo = (titulo: string, itens: ObrigacaoNaTela[], vazio: string, herdado = false) => (
    <div data-grupo-de-obrigacoes={titulo}>
      <h4 className="mb-0.5 mt-2 flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-text-muted">
        <span className="min-w-0 break-words">{titulo}</span>
        {herdado ? <span className="rounded-full bg-surface-muted px-1.5 text-[10px] font-normal">{t("herdado")}</span> : null}
      </h4>
      {itens.length === 0 ? (
        <p className="text-xs text-text-muted">{vazio}</p>
      ) : (
        <ul className="divide-y divide-border">
          {itens.map((item) => (
            <LinhaDaObrigacao
              key={item.id}
              item={item}
              hoje={dados!.hoje}
              nomeDoResponsavel={nomeDe(item.responsavel_user_id)}
              aoAbrir={(i) => setFolha({ id: i.id })}
              aoReceber={(i) => setFolha({ id: i.id, receber: true })}
            />
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <Secao
      titulo={t("Documentos e obrigações")}
      contagem={dados ? total : null}
      id={id}
      testid="documentos-e-obrigacoes"
      acoes={
        dados ? (
          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => setAdicionando(true)}>
            {t("Adicionar")}
          </Button>
        ) : null
      }
    >
      {leitura.isLoading ? <p className="text-xs text-text-muted">{t("Carregando…")}</p> : null}
      {leitura.isError ? (
        <p className="text-xs text-warning-fg">{t("Não consegui carregar os documentos e obrigações. Tente de novo em instantes.")}</p>
      ) : null}
      {dados ? (
        <>
          <p className="text-[11px] text-text-muted">
            {escopo.tipo === "negocio"
              ? t("A situação é calculada pelas datas, ninguém digita. O que é da empresa e do contato aparece aqui por herança.")
              : escopo.tipo === "empresa"
                ? t("Um item mexido aqui aparece igual no cartão aberto de todos os negócios desta empresa.")
                : t("O que é do contato acompanha a pessoa em qualquer negócio em que ela é o contato.")}
          </p>
          {mostrarPropostas && comProposta.length > 0 ? (
            <div className="mt-2 space-y-2">
              {comProposta.map((item) => (
                <PropostaDoAgente
                  key={item.id}
                  item={item}
                  proposta={item.proposta!}
                  aoConfirmar={(i, proposta) => setFolha({ id: i.id, receber: true, proposta })}
                />
              ))}
            </div>
          ) : null}
          {escopo.tipo === "negocio" ? (
            <>
              {grupo(t("Do negócio"), grupos.negocio, t("Nada ligado só a este negócio."))}
              {dados.contexto.empresa
                ? grupo(`${t("Da empresa")} · ${dados.contexto.empresa.nome}`, grupos.empresa, t("A empresa não tem itens."), true)
                : null}
              {dados.contexto.contato
                ? grupo(`${t("Do contato")} · ${dados.contexto.contato.nome}`, grupos.contato, t("O contato não tem itens."), true)
                : null}
            </>
          ) : escopo.tipo === "empresa" ? (
            <>
              {grupo(t("Da empresa"), grupos.empresa, t("A empresa não tem itens."))}
              {grupo(t("Dos contatos da empresa"), grupos.contato, t("Nenhum contato tem itens."))}
              {grupos.negocio.length > 0 ? grupo(t("Dos negócios da empresa"), grupos.negocio, "") : null}
            </>
          ) : (
            <>
              {grupo(t("Do contato"), grupos.contato, t("O contato não tem itens."))}
              {dados.contexto.empresa
                ? grupo(`${t("Da empresa")} · ${dados.contexto.empresa.nome}`, grupos.empresa, t("A empresa não tem itens."), true)
                : null}
            </>
          )}
          <FormularioDeObrigacao
            aberto={adicionando}
            aoFechar={() => setAdicionando(false)}
            contexto={dados.contexto}
            hoje={dados.hoje}
            aoAdicionar={(novoId) => setFolha({ id: novoId })}
          />
        </>
      ) : null}
      <FolhaDaObrigacao pedido={folha} aoFechar={() => setFolha(null)} />
    </Secao>
  );
}
