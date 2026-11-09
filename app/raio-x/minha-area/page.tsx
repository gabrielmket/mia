/**
 * FORK MIA (.107) — /raio-x/minha-area: a ÁREA de quem pediu o Raio-X
 * (protótipo aprovado em 06/11/2026, tela 6). Os raio-X da conta (análise,
 * período, conversas, nota, situação, abrir), a conexão do número (desconectar
 * agora, só do raio-X dela; conectar o que ainda espera) e "Pedir nova análise".
 *
 * Rota pública (`lib/auth/public-paths.ts`), mas a identidade é o cookie
 * ASSINADO da área: sem ele (ou com a conta apagada), volta para a entrada. Ao
 * abrir, relê no Asaas os pedidos em aberto da conta (o "já paguei" sem botão),
 * com um teto de espera para a página não travar.
 */
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AcoesDaConexao, BotaoDeSair } from "@/components/raio-x/AreaDoRaioX";
import { tagDeIdioma } from "@/lib/i18n/datas";
import { traduzir } from "@/lib/i18n/dicionario";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";
import { idiomaDoVisitante } from "@/lib/i18n/idiomaAnonimo";
import { NOME_DO_COOKIE } from "@/lib/raio-x/acesso";
import { contaDoCookie, raioXDaArea, type SituacaoNaArea } from "@/lib/raio-x/area";
import { pedidosDaConta, relerPedidosDaConta } from "@/lib/raio-x/pedidos";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: { absolute: "Meus Raio-X" },
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

const ROTULO_DA_SITUACAO: Record<SituacaoNaArea, string> = {
  aguardando_conectar: "esperando conectar",
  link_vencido: "o link de conexão venceu",
  lendo: "lendo as conversas",
  analisando: "preparando o relatório",
  pronto: "pronto",
  sem_historico: "sem histórico (não contou)",
  encerrado: "encerrado",
};

const ROTULO_DO_PEDIDO = { interesse: "a equipe vai falar com você", aguardando: "aguardando o pagamento", pago: "pago", cancelado: "cancelado" } as const;

export default async function MinhaAreaPage() {
  const admin = createAdminClient();
  const conta = await contaDoCookie(admin, (await cookies()).get(NOME_DO_COOKIE)?.value);
  if (!conta) redirect("/raio-x/entrar");
  await Promise.race([relerPedidosDaConta(admin, conta.id), new Promise((pronto) => setTimeout(pronto, 4_000))]).catch(() => undefined);
  const [lista, pedidos] = await Promise.all([raioXDaArea(admin, conta), pedidosDaConta(admin, conta.id)]);
  const idioma = await idiomaDoVisitante(null);
  const t = (s: string) => traduzir(s, idioma);
  const tag = tagDeIdioma(idioma);
  const dia = (iso: string | null) => (iso ? new Intl.DateTimeFormat(tag, { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(iso)) : "·");
  const nota = (n: number | null) => (n === null ? "·" : new Intl.NumberFormat(tag, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(n));
  const reais = (c: number | null) => (c === null ? "" : new Intl.NumberFormat(tag, { style: "currency", currency: "BRL" }).format(c / 100));
  const atual = lista[0] ?? null;
  const total = lista.length;

  return (
    <IdiomaProvider locale={idioma}>
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-5 bg-bg px-4 py-8 text-text" data-raio-x="minha-area">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">{atual?.empresa ?? t("Meus Raio-X")}</h1>
          <p className="text-sm text-text-muted">
            {conta.nome} · {conta.email} · <BotaoDeSair />
          </p>
        </header>

        {atual ? (
          <section className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3 rounded-lg border border-border bg-surface p-5" data-raio-x="conexao-da-area">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold">
                  {t("WhatsApp")} {atual.whatsappParaLer}
                </h2>
                <span className={`rounded-full px-2 py-0.5 text-xs ${atual.conexao.conectado ? "bg-success-bg text-success-fg" : "bg-surface-elevated text-text-muted"}`}>
                  {atual.conexao.conectado ? t("conectado") : atual.situacao === "aguardando_conectar" || atual.situacao === "link_vencido" ? t("esperando conectar") : t("desconectado")}
                </span>
              </div>
              <p className="text-sm text-text-muted">
                {atual.conexao.conectado
                  ? atual.conexao.caiEm
                    ? t("A conexão cai sozinha em {data}, 7 dias depois do relatório. Pode tirar antes em Aparelhos conectados no celular, ou aqui.").replace("{data}", dia(atual.conexao.caiEm))
                    : t("A conexão fica enquanto a leitura precisar. Pode tirar antes em Aparelhos conectados no celular, ou aqui.")
                  : atual.situacao === "aguardando_conectar" || atual.situacao === "link_vencido"
                    ? t("Falta conectar o WhatsApp para a leitura começar.")
                    : t("Nenhum aparelho do Raio-X conectado a este número.")}
              </p>
              <AcoesDaConexao
                raioXId={atual.id}
                conectado={atual.conexao.conectado}
                podeConectar={atual.situacao === "aguardando_conectar" || atual.situacao === "link_vencido"}
              />
            </div>
            <div className="space-y-3 rounded-lg border border-border bg-surface p-5">
              <h2 className="text-base font-semibold">{t("Próxima análise")}</h2>
              <p className="text-sm text-text-muted">{t("Compare com esta e veja se o atendimento melhorou.")}</p>
              <Link href="/raio-x/minha-area/nova" className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground" data-raio-x="nova-analise">
                {t("Pedir nova análise")}
              </Link>
            </div>
          </section>
        ) : (
          <p className="rounded-lg border border-border bg-surface p-5 text-sm text-text-muted">
            {t("Ainda não há um Raio-X nesta conta.")}{" "}
            <a href="/raio-x/gratis" className="underline">
              {t("Fazer o cadastro grátis")}
            </a>
          </p>
        )}

        {lista.length > 0 ? (
          <section className="space-y-3 rounded-lg border border-border bg-surface p-5">
            <h2 className="text-base font-semibold">{t("Meus Raio-X")}</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-text-muted">
                    <th className="p-2 font-medium">{t("Análise")}</th>
                    <th className="p-2 font-medium">{t("Período")}</th>
                    <th className="p-2 text-right font-medium">{t("Conversas")}</th>
                    <th className="p-2 text-right font-medium">{t("Nota")}</th>
                    <th className="p-2 font-medium">{t("Situação")}</th>
                    <th className="p-2" />
                  </tr>
                </thead>
                <tbody>
                  {lista.map((x, i) => (
                    <tr key={x.id} className="border-t border-border" data-raio-x-da-area={x.id}>
                      <td className="p-2">
                        {total - i}ª ·{" "}
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                          {x.gratis ? t("grátis") : x.tipo === "mensal" ? t("mensal") : t("avulsa")}
                        </span>
                      </td>
                      <td className="p-2">{x.periodo ? `${dia(x.periodo.inicio)} ${t("a")} ${dia(x.periodo.fim)}` : "·"}</td>
                      <td className="p-2 text-right tabular-nums">{x.conversas ?? "·"}</td>
                      <td className="p-2 text-right tabular-nums">{nota(x.nota)}</td>
                      <td className="p-2">
                        <span className="rounded-full bg-surface-elevated px-2 py-0.5 text-xs" data-raio-x-situacao-da-area={x.situacao}>
                          {t(ROTULO_DA_SITUACAO[x.situacao])}
                        </span>
                      </td>
                      <td className="p-2">
                        {x.relatorioId ? (
                          <Link href={`/raio-x/minha-area/${x.id}`} className="underline" data-raio-x="abrir">
                            {t("Abrir")}
                          </Link>
                        ) : x.conexao.link ? (
                          <a href={x.conexao.link} className="underline">
                            {t("Conectar")}
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {pedidos.length > 0 ? (
          <section className="space-y-2 rounded-lg border border-border bg-surface p-5" data-raio-x="pedidos-da-area">
            <h2 className="text-base font-semibold">{t("Pedidos de nova análise")}</h2>
            <ul className="space-y-1 text-sm">
              {pedidos.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2">
                  <span>
                    {dia(p.created_at)} · {p.tipo === "mensal" ? t("mensal") : t("avulsa")}
                    {p.valor_centavos !== null ? ` · ${reais(p.valor_centavos)}` : ""}
                  </span>
                  <span className="rounded-full bg-surface-elevated px-2 py-0.5 text-xs">{t(ROTULO_DO_PEDIDO[p.situacao])}</span>
                  {p.situacao === "aguardando" && p.link_pagamento ? (
                    <a href={p.link_pagamento} className="underline" rel="noopener noreferrer">
                      {t("Pagar")}
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <p className="rounded-md border border-border bg-surface-elevated p-3 text-sm">
          {t("Quer que alguém responda esses clientes no minuto em que chamam? Fale com a equipe da Time Company pelo WhatsApp do cadastro: a MIA atende, qualifica e marca a visita na hora.")}
        </p>
      </main>
    </IdiomaProvider>
  );
}
