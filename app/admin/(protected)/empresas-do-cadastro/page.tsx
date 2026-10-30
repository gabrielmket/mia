import Link from "next/link";
import { notFound } from "next/navigation";

import { CardDeCobranca } from "@/components/admin/tenants/CardDeCobranca";
import { Card } from "@/components/ui/card";
import { loadAuthUser } from "@/lib/auth/server";
import { modoDeCadastro } from "@/lib/auth/politica-de-cadastro";
import { traduzir } from "@/lib/i18n/dicionario";
// FORK MIA (.91): o "o que falta" e a empresa que espera o número, pela fonte do Início do cliente.
import { lerEmpresasEsperandoONumero } from "@/lib/onboarding/primeiros-passos-para-a-time";
import { lerCardDeCobranca } from "@/lib/planos-mia/card-de-cobranca";
import {
  lerDetalheDaEmpresa,
  lerEmpresasDoCadastro,
  lerNumerosEsperando,
  lerPedidosDeCadastro,
  numerosDoTopo,
  type LinhaDaEmpresa,
} from "@/lib/planos-mia/empresas-do-cadastro";
import { ROTULO_DO_MODULO_DO_PLANO } from "@/lib/planos-mia/catalogo";
import { rotuloDaOrigem } from "@/lib/planos-mia/modulos";
import { ultimosRecados } from "@/lib/planos-mia/recados";
import {
  FRASE_DO_PROXIMO_PASSO,
  ROTULO_DA_SITUACAO,
  type SituacaoDaEmpresa,
} from "@/lib/planos-mia/situacao";
import { createAdminClient } from "@/lib/supabase/admin";
// FORK MIA (.96, segunda frente): quem se cadastrou e não pagou (docs/fork/area-de-cobranca.md).
import { funilDoCadastro, situacoesDoPagamento } from "@/lib/pagamento-inicial/cadastro-sem-pagamento";
import {
  ROTULO_DA_SITUACAO_DO_PAGAMENTO,
  type ChaveDaSituacaoNaLista,
  type SituacaoDoPagamentoNaLista,
} from "@/lib/pagamento-inicial/situacao-na-lista";

import { ApagarCadastro } from "./_apagar";
import { PedidosDoCadastro } from "./_pedidos";

export const metadata = { title: "Empresas do cadastro" };
export const dynamic = "force-dynamic";

/**
 * FORK MIA (.90) — AS EMPRESAS QUE ENTRARAM SOZINHAS, do lado da Time
 * (protótipo da jornada de assinatura, tela 5; docs/fork/jornada-de-assinatura.md).
 *
 * Números no topo, filtros por situação e "só quem entrou sozinho", a tabela com
 * origem, plano, situação, primeiros passos e o próximo passo da régua; os
 * pedidos esperando aprovação (com o plano e o que a empresa faz); os números
 * oficiais esperando ligação; e, da empresa escolhida, a régua e o card Cobrança
 * do upstream, REUSADO como está (as ações são as rotas do dono). Só lê: quem
 * decide é a régua do upstream, a ação do pedido (`decideRegistrationRequest`) e
 * o card. Os filtros moram no endereço, para a tela funcionar sem JavaScript.
 *
 * O layout de `(protected)` já roda `requirePlatformAdmin()`; o gate local fica
 * porque um layout pode ser movido (mesma decisão de `/admin/cadastro`).
 */
const ROTULO_DO_FILTRO = {
  todas: "Todas",
  teste: "Em teste",
  emdia: "Em dia",
  atraso: "Em atraso",
  suspensa: "Suspensas",
  cancelada: "Canceladas",
  isenta: "Isentas",
} as const;
type Filtro = keyof typeof ROTULO_DO_FILTRO;
const FILTROS = Object.keys(ROTULO_DO_FILTRO) as Filtro[];

const CLASSE_DA_SITUACAO: Record<SituacaoDaEmpresa, string> = {
  teste: "bg-info-bg text-info-fg",
  emdia: "bg-success-bg text-success-fg",
  atraso: "bg-warning-bg text-warning-fg",
  prazo: "bg-info-bg text-info-fg",
  suspensa: "bg-error-bg text-error-fg",
  cancelada: "bg-muted text-muted-foreground",
  isenta: "bg-muted text-muted-foreground",
};

/** FORK MIA (.91): o nome de cada item do "o que falta" (as chaves do rótulo do cliente). */
const ROTULO_DO_ITEM: Record<string, string> = {
  dados_da_empresa: "Dados da empresa",
  whatsapp: "Número de WhatsApp",
  agente: "Agente de IA",
  funil: "Funil de vendas",
  followup: "Follow-up",
  ensaio: "Ensaio",
  equipe: "Equipe",
  plano: "Plano e cobrança",
};

/** FORK MIA (.96): a cor de cada situação do pagamento. */
const CLASSE_DO_PAGAMENTO: Record<ChaveDaSituacaoNaLista, string> = {
  pago: "bg-success-bg text-success-fg",
  pix_gerado: "bg-info-bg text-info-fg",
  boleto_em_compensacao: "bg-warning-bg text-warning-fg",
  cartao_recusado: "bg-error-bg text-error-fg",
  cartao_em_analise: "bg-info-bg text-info-fg",
  aguardando: "bg-info-bg text-info-fg",
  sem_cobranca: "bg-muted text-muted-foreground",
  sem_pagamento_ha_dias: "bg-muted text-muted-foreground",
  teste_cartao: "bg-info-bg text-info-fg",
  teste_pix: "bg-info-bg text-info-fg",
};

function noFiltro(l: LinhaDaEmpresa, filtro: string): boolean {
  if (filtro === "todas") return true;
  if (filtro === "atraso") return l.situacao === "atraso" || l.situacao === "prazo";
  return l.situacao === filtro;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ filtro?: string; todas?: string; empresa?: string }>;
}) {
  const usuario = await loadAuthUser();
  if (!usuario?.is_platform_admin) notFound();
  const idioma = usuario.idioma;
  const t = (s: string) => traduzir(s, idioma);
  const sp = await searchParams;
  const filtro: Filtro = FILTROS.find((k) => k === sp.filtro) ?? "todas";
  const soQuemEntrouSozinho = sp.todas !== "1";

  const admin = createAdminClient();
  const agora = new Date();
  const [linhas, pedidos, numeros, modo, recados, empresasEsperando, funil] = await Promise.all([
    lerEmpresasDoCadastro(admin, agora),
    lerPedidosDeCadastro(admin),
    lerNumerosEsperando(admin),
    modoDeCadastro(),
    ultimosRecados(admin),
    lerEmpresasEsperandoONumero(admin).catch(() => []),
    // FORK MIA (.96): o funil dos últimos 30 dias.
    funilDoCadastro(admin, agora),
  ]);
  const base = soQuemEntrouSozinho ? linhas.filter((l) => l.origem === "cadastro") : linhas;
  const lista = base.filter((l) => noFiltro(l, filtro));
  // FORK MIA (.96): a situação do pagamento de cada empresa e o nome curto de quem
  // pode ser apagada (a confirmação do "Apagar o cadastro"). Leitura que falha
  // deixa a coluna vazia, sem derrubar a tela.
  const pagamentos: Map<string, SituacaoDoPagamentoNaLista> = await situacoesDoPagamento(
    admin,
    lista.map((l) => ({ id: l.id, entrou: l.entrou })),
    agora,
  ).catch(() => new Map());
  const apagaveis = lista.filter((l) => pagamentos.get(l.id)?.pode_apagar).map((l) => l.id);
  const slugs = new Map<string, string>(
    apagaveis.length > 0
      ? (((await admin.from("organizations").select("id, slug").in("id", apagaveis)).data ?? []) as Array<{ id: string; slug: string }>).map(
          (o) => [o.id, o.slug],
        )
      : [],
  );
  const topo = numerosDoTopo(base, pedidos.length, agora);
  const escolhida =
    lista.find((l) => l.id === sp.empresa)?.id ??
    linhas.find((l) => l.id === sp.empresa)?.id ??
    lista[0]?.id ??
    null;
  const [detalhe, card] = escolhida
    ? await Promise.all([
        lerDetalheDaEmpresa(admin, escolhida, agora),
        lerCardDeCobranca(admin, escolhida),
      ])
    : [null, null];

  const data = new Intl.DateTimeFormat(idioma, {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
  const dataHora = new Intl.DateTimeFormat(idioma, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  });
  const brl = new Intl.NumberFormat(idioma, {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
  const fmt = (iso: string | null) => (iso ? data.format(new Date(iso)) : "—");
  const proximo = (l: LinhaDaEmpresa) =>
    t(FRASE_DO_PROXIMO_PASSO[l.proximo.tipo])
      .replace("{data}", fmt(l.proximo.em))
      .replace("{suspensao}", fmt(l.proximo.suspensao_em));
  const link = (mudar: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const atual: Record<string, string | null> = {
      filtro,
      todas: soQuemEntrouSozinho ? null : "1",
      empresa: escolhida,
    };
    for (const [k, v] of Object.entries({ ...atual, ...mudar })) if (v) p.set(k, v);
    const q = p.toString();
    return `/admin/empresas-do-cadastro${q ? `?${q}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("Empresas do cadastro")}</h1>
        <p className="text-sm text-muted-foreground">
          {t(
            "Quem entrou sozinho pela página de preços e pelo cadastro: situação, plano, primeiros passos e o próximo passo da régua.",
          )}
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-jornada="numeros">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">{t("Aguardando aprovação")}</p>
          <p className="text-2xl font-semibold">{topo.aguardando}</p>
          <p className="text-xs text-muted-foreground">
            {modo === "com_aprovacao"
              ? t("modo com aprovação")
              : modo === "aberto"
                ? t("modo aberto")
                : t("modo só por convite")}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">{t("Em teste")}</p>
          <p className="text-2xl font-semibold">{topo.em_teste}</p>
          <p className="text-xs text-muted-foreground">
            {t("{n} de {m} testes que acabaram viraram assinatura")
              .replace("{n}", String(topo.viraram_assinatura))
              .replace("{m}", String(topo.testes_que_acabaram))}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">{t("Em dia")}</p>
          <p className="text-2xl font-semibold">{topo.em_dia}</p>
          <p className="text-xs text-muted-foreground">
            {t("{valor} por mês").replace("{valor}", brl.format(topo.receita_mensal_cents / 100))}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">{t("Em atraso · suspensas")}</p>
          <p className="text-2xl font-semibold">
            {topo.em_atraso} · {topo.suspensas}
          </p>
          <p className="text-xs text-muted-foreground">{t("a régua cuida sozinha")}</p>
        </Card>
      </section>

      {/* FORK MIA (.96): o funil do cadastro (protótipo "Pagamento no início", tela 4). */}
      <section className="space-y-2" data-jornada="funil-do-cadastro">
        <h2 className="text-sm font-semibold">{t("Funil do cadastro, últimos 30 dias")}</h2>
        {funil === null ? (
          <p className="text-sm text-muted-foreground">{t("Não deu para contar o funil agora.")}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {(
              [
                [funil.escolheram_plano, t("escolheram um plano no site")],
                [funil.criaram_conta, t("criaram a conta")],
                [funil.pagaram, t("pagaram")],
                [funil.esperando_pagamento, t("esperando o pagamento")],
                [funil.sem_pagamento_ha_mais_de_30_dias, t("sem pagamento há mais de 30 dias")],
              ] as const
            ).map(([n, rotulo], i) => (
              <Card key={i} className="p-4">
                <p className="text-2xl font-semibold tabular-nums">{n}</p>
                <p className="text-xs text-muted-foreground">{rotulo}</p>
              </Card>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {t("Nada é apagado sozinho: o cadastro sem pagamento há mais de 30 dias ganha o botão Apagar o cadastro, com a verificação em duas etapas.")}
        </p>
      </section>

      <nav
        className="flex flex-wrap items-center gap-2 text-sm"
        aria-label={t("Filtros")}
        data-jornada="filtros"
      >
        {FILTROS.map((k) => (
          <Link
            key={k}
            href={link({ filtro: k, empresa: null })}
            aria-current={filtro === k ? "page" : undefined}
            className={`rounded-md border px-3 py-1 ${filtro === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
          >
            {t(ROTULO_DO_FILTRO[k])}
          </Link>
        ))}
        <Link
          href={link({ todas: soQuemEntrouSozinho ? "1" : null, empresa: null })}
          className="ml-auto rounded-md border px-3 py-1 hover:bg-muted"
        >
          {soQuemEntrouSozinho
            ? t("Mostrar também as implantadas pela Time")
            : t("Só quem entrou sozinho")}
        </Link>
      </nav>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <Card className="overflow-x-auto p-0" data-jornada="empresas">
            {lista.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                {t("Nenhuma empresa nesta situação.")}
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">{t("Empresa")}</th>
                    <th className="px-3 py-2 font-medium">{t("Entrou")}</th>
                    <th className="px-3 py-2 font-medium">{t("Origem")}</th>
                    <th className="px-3 py-2 font-medium">{t("Plano")}</th>
                    <th className="px-3 py-2 font-medium">{t("Situação")}</th>
                    <th className="px-3 py-2 font-medium">{t("Situação do pagamento")}</th>
                    <th className="px-3 py-2 font-medium">{t("Primeiros passos")}</th>
                    <th className="px-3 py-2 font-medium">{t("Próximo da régua")}</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((l) => (
                    <tr
                      key={l.id}
                      className={`border-b align-top ${l.id === escolhida ? "bg-muted" : ""}`}
                      data-empresa={l.id}
                    >
                      <td className="px-3 py-2">
                        <Link
                          href={link({ empresa: l.id })}
                          className="font-medium underline-offset-2 hover:underline"
                        >
                          {l.nome}
                        </Link>
                      </td>
                      <td className="px-3 py-2">{fmt(l.entrou)}</td>
                      <td className="px-3 py-2">
                        {l.origem === "cadastro"
                          ? t("cadastro próprio")
                          : l.origem === "implantacao"
                            ? t("implantação")
                            : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {l.plano?.nome ?? "—"}
                        {l.plano_agendado && (
                          <span className="block text-xs text-muted-foreground">
                            {t("vira {plano} em {data}")
                              .replace("{plano}", l.plano_agendado.nome)
                              .replace("{data}", fmt(l.plano_agendado.em))}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-md px-2 py-0.5 text-xs ${CLASSE_DA_SITUACAO[l.situacao]}`}
                        >
                          {t(ROTULO_DA_SITUACAO[l.situacao])}
                        </span>
                      </td>
                      <td className="px-3 py-2" data-pagamento-na-lista={pagamentos.get(l.id)?.chave ?? "nenhum"}>
                        {(() => {
                          const p = pagamentos.get(l.id);
                          if (!p) return <span className="text-muted-foreground">—</span>;
                          const forma =
                            p.forma === "pix" ? t("Pix") : p.forma === "cartao" ? t("cartão") : p.forma === "boleto" ? t("boleto") : null;
                          const detalhe =
                            p.chave === "pago"
                              ? p.pago_em
                                ? t("pago em {data}").replace("{data}", fmt(p.pago_em))
                                : null
                              : p.chave === "boleto_em_compensacao" && p.vence_em
                                ? t("vence em {data}").replace("{data}", fmt(`${p.vence_em}T12:00:00-03:00`))
                                : p.chave === "cartao_recusado"
                                  ? t("tentou {n} vezes").replace("{n}", String(p.recusas))
                                  : p.chave === "pix_gerado" && p.gerada_em
                                    ? t("gerado em {data}").replace("{data}", fmt(p.gerada_em))
                                    : p.chave === "sem_pagamento_ha_dias"
                                      ? p.gerada_em
                                        ? t("cobrança gerada em {data}").replace("{data}", fmt(p.gerada_em))
                                        : t("nunca gerou cobrança")
                                      : null;
                          return (
                            <>
                              <span className={`rounded-md px-2 py-0.5 text-xs ${CLASSE_DO_PAGAMENTO[p.chave]}`}>
                                {t(ROTULO_DA_SITUACAO_DO_PAGAMENTO[p.chave]).replace("{dias}", String(p.dias))}
                                {p.chave === "pago" && forma ? ` · ${forma}` : ""}
                              </span>
                              {detalhe ? <span className="block text-xs text-muted-foreground">{detalhe}</span> : null}
                              {p.fim_do_teste ? (
                                <span className="block text-xs text-muted-foreground">{t("o teste acabou sem pagamento")}</span>
                              ) : null}
                              {p.pode_apagar && slugs.get(l.id) ? (
                                <ApagarCadastro orgId={l.id} nome={l.nome} slug={slugs.get(l.id)!} dias={p.dias} />
                              ) : null}
                            </>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2">
                        {l.passos.feitos}/{l.passos.de}
                        {l.o_que_falta ? (
                          <span className="block text-xs text-muted-foreground">
                            {t("faltam {n} de {m}")
                              .replace("{n}", String(l.o_que_falta.faltam))
                              .replace("{m}", String(l.o_que_falta.total))}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-xs">{proximo(l)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <PedidosDoCadastro pedidos={pedidos} modoComAprovacao={modo === "com_aprovacao"} />

          <Card className="space-y-3 p-4" data-jornada="numeros-oficiais">
            <h2 className="text-sm font-semibold">{t("Números oficiais esperando ligação")}</h2>
            {empresasEsperando.length > 0 ? (
              <ul className="space-y-2 text-sm" data-jornada="empresas-esperando-o-numero">
                {empresasEsperando.map((e) => (
                  <li key={e.organization_id} className="rounded-md border border-dashed p-3">
                    <span className="block font-medium">{e.nome}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t("Empresa esperando a Time ligar o número")}
                      {e.desde
                        ? ` · ${t("Entrou com o Facebook em {data}").replace("{data}", dataHora.format(new Date(e.desde)))}`
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {numeros.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("Nenhum número esperando.")}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {numeros.map((n) => (
                  <li key={n.id} className="rounded-md border p-3">
                    <span className="block font-medium">
                      {n.conta ?? t("Conta da Meta sem nome")}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {t("Entrou com o Facebook em {data}").replace(
                        "{data}",
                        dataHora.format(new Date(n.chegou)),
                      )}{" "}
                      · {n.waba}
                      {n.numero ? ` · ${n.numero}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              {t(
                "Confira o nome da conta da Meta antes de ligar: ligar errado faz a conversa de um cliente sair pelo número de outro. A ligação é à mão, de propósito.",
              )}{" "}
              <Link href="/admin/cadastro-incorporado" className="underline underline-offset-2">
                {t("Abrir o cadastro incorporado")}
              </Link>
            </p>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="space-y-3 p-4" data-jornada="empresa-escolhida">
            {!detalhe ? (
              <p className="text-sm text-muted-foreground">{t("Escolha uma empresa na lista.")}</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold">{detalhe.nome}</h2>
                  <span
                    className={`rounded-md px-2 py-0.5 text-xs ${CLASSE_DA_SITUACAO[detalhe.situacao]}`}
                  >
                    {t(ROTULO_DA_SITUACAO[detalhe.situacao])}
                  </span>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">{t("Quem administra")}</dt>
                  <dd>
                    {detalhe.administra
                      ? [detalhe.administra.nome, detalhe.administra.email]
                          .filter(Boolean)
                          .join(" · ")
                      : "—"}
                  </dd>
                  <dt className="text-muted-foreground">{t("Plano")}</dt>
                  <dd>
                    {detalhe.plano
                      ? `${detalhe.plano.nome} · ${brl.format(detalhe.plano.preco_cents / 100)}/${detalhe.plano.intervalo === "ano" ? t("ano") : t("mês")}`
                      : t("nenhum (isenta)")}
                  </dd>
                  <dt className="text-muted-foreground">{t("Entrou")}</dt>
                  <dd>
                    {fmt(detalhe.entrou)} ·{" "}
                    {detalhe.origem === "cadastro"
                      ? t("cadastro próprio")
                      : detalhe.origem === "implantacao"
                        ? t("implantação pela Time")
                        : "—"}
                  </dd>
                  <dt className="text-muted-foreground">{t("Primeiros passos")}</dt>
                  <dd>
                    {t("{n} de {m}")
                      .replace("{n}", String(detalhe.passos.feitos))
                      .replace("{m}", String(detalhe.passos.de))}
                  </dd>
                  <dt className="text-muted-foreground">{t("O que falta")}</dt>
                  <dd data-jornada="o-que-falta-da-empresa">
                    {detalhe.o_que_falta_agora === null ? (
                      t("não deu para contar agora")
                    ) : detalhe.o_que_falta_agora.faltam === 0 ? (
                      t("não falta nada")
                    ) : (
                      <>
                        {t("faltam {n} de {m}")
                          .replace("{n}", String(detalhe.o_que_falta_agora.faltam))
                          .replace("{m}", String(detalhe.o_que_falta_agora.total))}
                        {detalhe.o_que_falta
                          ? ` (${t("ao entrar, {n}").replace("{n}", String(detalhe.o_que_falta.ao_entrar))})`
                          : ""}
                        <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                          {detalhe.o_que_falta_agora.itens.map((i) => (
                            <li key={i.chave}>
                              {t(ROTULO_DO_ITEM[i.chave] ?? "Follow-up")} ·{" "}
                              {i.coluna === "posso_completar"
                                ? t("o assistente prepara")
                                : i.quem === "time_company"
                                  ? t("a Time faz")
                                  : t("o cliente faz")}
                              {i.depende_de
                                ? ` · ${t("depois de: {item}").replace("{item}", t(ROTULO_DO_ITEM[i.depende_de] ?? "Agente de IA"))}`
                                : ""}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </dd>
                  <dt className="text-muted-foreground">{t("Módulos")}</dt>
                  <dd>
                    {detalhe.modulos.length === 0
                      ? t("nenhum")
                      : detalhe.modulos
                          .map(
                            (m) =>
                              `${t(ROTULO_DO_MODULO_DO_PLANO[m.modulo].rotulo)} (${t(rotuloDaOrigem(m))})`,
                          )
                          .join(", ")}
                  </dd>
                  <dt className="text-muted-foreground">{t("Próximo da régua")}</dt>
                  <dd>{proximo(detalhe)}</dd>
                </dl>
                {detalhe.regua.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      {t("A régua desta empresa")}
                    </p>
                    <ol className="space-y-1 text-sm">
                      {detalhe.regua.map((p) => (
                        <li
                          key={`${p.em}-${p.titulo}`}
                          className={p.estado === "depois" ? "text-muted-foreground" : ""}
                          data-ponto={p.estado}
                        >
                          {fmt(p.em)} · {t(p.titulo)}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                <Link
                  href={`/admin/tenants/${detalhe.id}`}
                  className="text-sm underline underline-offset-2"
                >
                  {t("Abrir no painel da empresa")}
                </Link>
              </>
            )}
          </Card>

          {detalhe && card && <CardDeCobranca orgId={detalhe.id} {...card} />}

          <Card className="space-y-2 p-4" data-jornada="recados">
            <h2 className="text-sm font-semibold">{t("Recados no zap da Time")}</h2>
            {recados.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("Nenhum recado ainda.")}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {recados.map((r) => (
                  <li
                    key={`${r.enviado_em}-${r.texto}`}
                    className="rounded-md border p-2 whitespace-pre-line"
                  >
                    {r.texto.replace(/\*/g, "")}
                    <span className="block text-xs text-muted-foreground">
                      {dataHora.format(new Date(r.enviado_em))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              {t(
                "O mesmo grupo interno que recebe os chamados do assistente. Só o nome da empresa e o que fazer, nunca dado do cliente final.",
              )}
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
