import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { AjustesDoRaioX, ConexaoDoRaioX, RevisaoDoRelatorio } from "@/components/raio-x/AcoesDoRaioX";
import { RelatorioDaTime } from "@/components/raio-x/RelatorioDoRaioX";
import { ROTULO_DA_FASE, ROTULO_DA_ORIGEM_NA_LISTA, ROTULO_DA_SITUACAO, ROTULO_DA_SITUACAO_DO_PEDIDO, ROTULO_DE_QUEM_ATENDE, ROTULO_DO_TIPO } from "@/components/raio-x/rotulos";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { tagDeIdioma } from "@/lib/i18n/datas";
import { traduzir } from "@/lib/i18n/dicionario";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { acaoVer } from "@/lib/raio-x/acoes";
import { lerRelatorio } from "@/lib/raio-x/banco";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Raio-X do atendimento" };
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ relatorio?: string }>;
}

/**
 * FORK MIA (.101) · /admin/raio-x/[id]: o detalhe (protótipo, tela 4). O andamento
 * da leitura, o link de conexão, o aceite, o relatório em rascunho com a revisão
 * e o link do dono, a evolução desde o anterior e as ações (desconectar agora,
 * encerrar). `?relatorio=` escolhe outro relatório do mesmo raio-X.
 *
 * FORK MIA (.102): no CLIENTE ATIVO o andamento são os passos do protótipo de
 * 05/11/2026 (tela 4): "Autorizado por …", "Leu as conversas da conta",
 * "Transcreveu os áudios", "Analisando as conversas" e "Rascunho pronto". Não
 * há conexão: o link é só de autorização.
 */
export default async function DetalheDoRaioXPage({ params, searchParams }: PageProps) {
  const { user } = await requirePlatformAdmin();
  const idioma = normalizarIdioma((user.user_metadata?.locale as string | undefined) ?? null);
  const t = (s: string) => traduzir(s, idioma);
  const tag = tagDeIdioma(idioma);
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const admin = createAdminClient();
  const d = await acaoVer(admin, id);
  if (!d) notFound();
  const busca = await searchParams;
  const relatorio = d.relatorios.find((r) => r.id === busca.relatorio) ?? d.relatorios[0] ?? null;
  const anterior = relatorio?.comparacao?.anteriorId ? await lerRelatorio(admin, relatorio.comparacao.anteriorId) : null;
  const { data: empresas } = await admin.from("organizations").select("id, display_name, legal_name").order("display_name").limit(1000);
  const r = d.raioX;
  const data = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(tag, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(iso)) : "·";
  const conectado = Boolean(r.conectadoEm && !r.desconectadoEm);
  const daMia = r.fonte === "conversas_da_mia";
  const dia = (iso: string | null, menosUmMs = false) =>
    iso ? new Intl.DateTimeFormat(tag, { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(Date.parse(iso) - (menosUmMs ? 1 : 0))) : "·";
  const reais = (centavos: number) => new Intl.NumberFormat(tag, { style: "currency", currency: "BRL" }).format(centavos / 100);
  const versaoDoTermo = (v: string) => (v === "cliente_ativo_v1" ? t("termo “cliente ativo” v1") : `${t("termo")} ${v}`);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-sm text-text-muted">
          <Link href="/admin/raio-x" className="underline">
            {t("Raio-X do atendimento")}
          </Link>
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{r.empresa}</h1>
        {daMia ? (
          <p className="text-sm text-text-muted" data-raio-x="cabecalho-da-mia">
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{t("Conversas da MIA")}</span> · {t(r.segmentoRotulo)} ·{" "}
            {r.numeros.map((n) => `${n.rotulo}${n.oficial ? ` (${t("API oficial")})` : ""}`).join(", ")} · {t(ROTULO_DO_TIPO[r.tipo])} ·{" "}
            {dia(r.periodoInicio)} {t("a")} {dia(r.periodoFim, true)}
          </p>
        ) : (
          <p className="text-sm text-text-muted">
            {t(r.segmentoRotulo)} · {r.whatsappParaLer} · {t(ROTULO_DO_TIPO[r.tipo])} · {t("últimos {n} dias").replace("{n}", String(r.periodoDias))} ·{" "}
            {t(ROTULO_DE_QUEM_ATENDE[r.quemAtende as keyof typeof ROTULO_DE_QUEM_ATENDE] ?? ROTULO_DE_QUEM_ATENDE.humano)}
          </p>
        )}
        <p className="text-sm">
          <span className="rounded-full bg-surface-elevated px-2 py-0.5 text-xs" data-raio-x-situacao={r.situacao}>
            {t(ROTULO_DA_SITUACAO[r.situacao])}
          </span>
        </p>
      </header>

      {/* FORK MIA (.106): o raio-X do cadastro (quem pediu, o lead no CRM da Time, a entrega e os pedidos). */}
      {d.origem !== "time" || d.conta ? (
        <section className="space-y-3 rounded-lg border border-border bg-surface p-5" data-raio-x="quem-pediu">
          <h2 className="text-base font-semibold">
            {t("Quem pediu")}{" "}
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-normal text-primary" data-raio-x-origem={d.origem}>
              {t(ROTULO_DA_ORIGEM_NA_LISTA[d.origem])}
            </span>
          </h2>
          {d.conta ? (
            <ul className="space-y-1 text-sm">
              <li>
                {d.conta.nome} · {d.conta.email} · {t("WhatsApp da pessoa:")} {d.conta.telefoneParaLer}
              </li>
              <li className="text-text-muted">
                {t("Lead no CRM da Time:")}{" "}
                {d.conta.crmLeadId
                  ? `${t("criado em")} ${data(d.conta.crmEnviadoEm)}`
                  : d.conta.crmErro === "sem_fonte"
                    ? t("não entrou: falta a variável RAIO_X_FONTE_DO_CRM")
                    : d.conta.crmErro
                      ? `${t("não entrou")} (${d.conta.crmErro})`
                      : t("ainda não")}
              </li>
            </ul>
          ) : (
            <p className="text-sm text-text-muted">{t("A conta de quem pediu foi apagada.")}</p>
          )}
          <p className="text-sm text-text-muted">
            {d.semHistoricoEm
              ? `${t("Fechou sem histórico em")} ${data(d.semHistoricoEm)} · ${t("a grátis não contou")}`
              : d.entregueEm
                ? `${t("Relatório enviado direto para a pessoa em")} ${data(d.entregueEm)} · ${t("sem a revisão da Time")}`
                : t("O relatório do cadastro sai revisado e vai direto para a pessoa; a Time é avisada.")}
          </p>
          {d.pedidos.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm" data-raio-x="pedidos">
                <thead>
                  <tr className="text-left text-text-muted">
                    <th className="p-2 font-medium">{t("Pedido")}</th>
                    <th className="p-2 font-medium">{t("Valor")}</th>
                    <th className="p-2 font-medium">{t("Situação")}</th>
                    <th className="p-2 font-medium">{t("Raio-X")}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.pedidos.map((p) => (
                    <tr key={p.id} className="border-t border-border">
                      <td className="p-2">
                        {data(p.created_at)} · {t(p.tipo === "mensal" ? "mensal" : "avulsa")}
                      </td>
                      <td className="p-2">{p.valor_centavos === null ? t("sem preço") : reais(p.valor_centavos)}</td>
                      <td className="p-2">
                        {t(ROTULO_DA_SITUACAO_DO_PEDIDO[p.situacao])}
                        {p.pago_em ? ` · ${data(p.pago_em)}` : ""}
                        {p.erro ? ` · ${p.erro}` : ""}
                      </td>
                      <td className="p-2">
                        {p.raio_x_id && p.raio_x_id !== r.id ? (
                          <Link href={`/admin/raio-x/${p.raio_x_id}`} className="underline">
                            {t("o raio-X do pedido")}
                          </Link>
                        ) : p.raio_x_id === r.id ? (
                          t("este")
                        ) : (
                          "·"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      {r.numeroDiferente ? (
        <p className="rounded-md bg-error-bg p-3 text-sm text-error-fg">
          {t("O dono conectou um número diferente do cadastrado. A conexão foi derrubada e nada foi lido. Ele pode conectar de novo com o número certo.")}
        </p>
      ) : null}

      {daMia ? (
        <section className="space-y-3 rounded-lg border border-border bg-surface p-5" data-raio-x="andamento-da-mia">
          <h2 className="text-base font-semibold">{t("Andamento")}</h2>
          {d.conexao ? (
            <ConexaoDoRaioX raioXId={r.id} link={d.conexao.link} mensagem={d.conexao.mensagem} vivo={d.conexao.vivo} expiraEm={d.conexao.expiraEm} autorizacao />
          ) : null}
          <ol className="space-y-2 text-sm">
            {(() => {
              const a = d.analiseDaConta;
              const leu = r.situacao === "analisando" || r.situacao === "pronto" || (r.situacao === "encerrado" && Boolean(a?.conversas));
              const transcreveu = leu && (a?.audiosPendentes ?? 0) === 0 && (r.situacao === "pronto" || (a?.analisadas ?? 0) > 0);
              const pronto = d.relatorios.length > 0;
              const passos: Array<{ feito: boolean; agora: boolean; titulo: string; detalhe: string }> = [
                {
                  feito: Boolean(d.aceite),
                  agora: !d.aceite,
                  titulo: d.aceite ? t("Autorizado por {nome}").replace("{nome}", d.aceite.nome) : t("Aguardando o dono autorizar"),
                  detalhe: d.aceite
                    ? [d.aceite.email, data(d.aceite.aceito_em), versaoDoTermo(d.aceite.termo_versao)].filter(Boolean).join(" · ")
                    : t("O link vale 48 horas."),
                },
                {
                  feito: leu,
                  agora: r.situacao === "lendo",
                  titulo: t("Leu as conversas da conta"),
                  detalhe: t("{c} conversas com clientes, {m} mensagens, {n} números")
                    .replace("{c}", String(d.andamento.conversasLidas))
                    .replace("{m}", String(d.andamento.mensagensLidas))
                    .replace("{n}", String(r.numeros.length)),
                },
                {
                  feito: transcreveu,
                  agora: leu && !transcreveu && !pronto,
                  titulo: t("Transcreveu os áudios"),
                  detalhe: t("{n} áudios · {r}").replace("{n}", String(a?.audiosTranscritos ?? 0)).replace("{r}", reais(a?.custoTranscricaoCentavos ?? 0)),
                },
                {
                  feito: pronto,
                  agora: r.situacao === "analisando" && transcreveu,
                  titulo: t("Analisando as conversas"),
                  detalhe: t("{x} de {y} · {r} até agora, teto {teto}")
                    .replace("{x}", String(a?.analisadas ?? 0))
                    .replace("{y}", String(a?.conversas ?? 0))
                    .replace("{r}", reais(d.custo.centavos))
                    .replace("{teto}", reais(d.custo.tetoCentavos)),
                },
                {
                  feito: pronto,
                  agora: false,
                  titulo: t("Rascunho pronto para a Time revisar"),
                  detalhe: t("o link do dono só sai depois da revisão"),
                },
              ];
              return passos.map((p, i) => (
                <li key={p.titulo} className="flex gap-3" data-raio-x-passo={i + 1} data-raio-x-passo-feito={p.feito ? "sim" : "nao"}>
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${p.feito ? "bg-success-bg text-success-fg" : p.agora ? "bg-primary text-primary-foreground" : "bg-surface-elevated text-text-muted"}`}
                    aria-hidden="true"
                  >
                    {p.feito ? "✓" : i + 1}
                  </span>
                  <span>
                    <b>{p.titulo}</b>
                    <span className="block text-xs text-text-muted">{p.detalhe}</span>
                  </span>
                </li>
              ));
            })()}
          </ol>
          <p className="text-xs text-text-muted">
            {r.conversasApagadasEm
              ? `${t("Transcrições e análise apagadas em")} ${data(r.conversasApagadasEm)}`
              : r.apagarConversasEm
                ? `${t("Transcrições e análise apagam em")} ${data(r.apagarConversasEm)}`
                : t("Nada é conectado: as conversas ficam na conta, e o raio-X guarda só os números e os trechos anonimizados.")}
          </p>
        </section>
      ) : (
      <section className="space-y-3 rounded-lg border border-border bg-surface p-5">
        <h2 className="text-base font-semibold">{t("Conexão")}</h2>
        {d.conexao ? (
          <ConexaoDoRaioX raioXId={r.id} link={d.conexao.link} mensagem={d.conexao.mensagem} vivo={d.conexao.vivo} expiraEm={d.conexao.expiraEm} />
        ) : null}
        <ul className="space-y-1 text-sm text-text-muted">
          <li>
            {t("Autorização:")}{" "}
            {d.aceite
              ? [d.aceite.nome, d.aceite.email, data(d.aceite.aceito_em), versaoDoTermo(d.aceite.termo_versao)].filter(Boolean).join(" · ")
              : t("ainda não aceita")}
          </li>
          <li>
            {t("Conectado em:")} {data(r.conectadoEm)}
            {r.desconectadoEm ? ` · ${t("desconectado em")} ${data(r.desconectadoEm)}` : ""}
            {r.desconectarEm && !r.desconectadoEm ? ` · ${t("cai sozinha em")} ${data(r.desconectarEm)}` : ""}
          </li>
          <li>
            {t("Conversas lidas:")}{" "}
            {r.conversasApagadasEm
              ? `${t("apagadas em")} ${data(r.conversasApagadasEm)}`
              : r.apagarConversasEm
                ? `${t("apagam em")} ${data(r.apagarConversasEm)}`
                : t("guardadas até 30 dias depois do relatório")}
          </li>
        </ul>
        {r.situacao === "lendo" || r.situacao === "analisando" ? (
          <div className="space-y-1" data-raio-x="andamento">
            <div className="h-2 overflow-hidden rounded-full bg-surface-elevated" role="progressbar" aria-valuenow={d.andamento.percentual ?? 0} aria-valuemin={0} aria-valuemax={100}>
              <span className="block h-2 rounded-full bg-primary" style={{ width: `${d.andamento.percentual ?? 0}%` }} />
            </div>
            <p className="text-sm text-text-muted">
              {r.situacao === "analisando"
                ? t("Leitura concluída. Transcrevendo os áudios e analisando as conversas.")
                : `${t(ROTULO_DA_FASE[(d.andamento.fase ?? "sincronizando") as keyof typeof ROTULO_DA_FASE] ?? ROTULO_DA_FASE.sincronizando)} · ${d.andamento.conversasLidas} ${t("conversas lidas")} · ${d.andamento.mensagensLidas} ${t("mensagens")}`}
            </p>
          </div>
        ) : null}
      </section>
      )}

      <section className="space-y-3 rounded-lg border border-border bg-surface p-5">
        <h2 className="text-base font-semibold">{t("Ajustes")}</h2>
        <p className="text-sm text-text-muted">
          {t("Custo até aqui:")}{" "}
          <b>{new Intl.NumberFormat(tag, { style: "currency", currency: "BRL" }).format(d.custo.centavos / 100)}</b> · {t("teto")}{" "}
          {new Intl.NumberFormat(tag, { style: "currency", currency: "BRL" }).format(d.custo.tetoCentavos / 100)}
        </p>
        <AjustesDoRaioX
          raioXId={r.id}
          encerrado={r.situacao === "encerrado"}
          conectado={conectado}
          // FORK MIA (.105): ler de novo = pronto, pela conexão, conectado e sem
          // relatório revisado deste período (a ação confere tudo de novo).
          podeLerDeNovo={
            r.situacao === "pronto" &&
            r.fonte === "conexao" &&
            conectado &&
            !d.relatorios.some((x) => x.situacao === "revisado" && r.periodoInicio !== null && Date.parse(x.periodo_inicio) === Date.parse(r.periodoInicio))
          }
          organizationId={r.organizationId}
          tetoCentavos={r.tetoCentavos}
          empresas={((empresas ?? []) as Array<{ id: string; display_name: string | null; legal_name: string | null }>).map((org) => ({
            id: org.id,
            nome: org.display_name || org.legal_name || org.id,
          }))}
        />
      </section>

      {relatorio ? (
        <>
          <section className="space-y-3 rounded-lg border border-border bg-surface p-5">
            <h2 className="text-base font-semibold">
              {t("Relatório")} {relatorio.sequencia} · {data(relatorio.created_at)}
            </h2>
            {d.relatorios.length > 1 ? (
              <nav className="flex flex-wrap gap-2 text-sm" aria-label={t("Relatórios deste raio-X")}>
                {d.relatorios.map((x) => (
                  <Link
                    key={x.id}
                    href={`/admin/raio-x/${r.id}?relatorio=${x.id}`}
                    aria-current={x.id === relatorio.id ? "page" : undefined}
                    className={x.id === relatorio.id ? "rounded-full bg-primary px-3 py-1 text-primary-foreground" : "rounded-full border border-border px-3 py-1"}
                  >
                    {x.competencia ? x.competencia.slice(0, 7) : `#${x.sequencia}`}
                  </Link>
                ))}
              </nav>
            ) : null}
            {anterior ? (
              <p className="flex flex-wrap gap-3 text-sm">
                <a href="#evolucao" className="underline" data-raio-x="ver-antes-e-depois">
                  {t("Ver antes e depois")}
                </a>
                <Link href={`/admin/raio-x/${anterior.raio_x_id}?relatorio=${anterior.id}`} className="underline" data-raio-x="relatorio-anterior">
                  {t("Ver o relatório anterior")}
                </Link>
              </p>
            ) : null}
            <RevisaoDoRelatorio
              raioXId={r.id}
              relatorioId={relatorio.id}
              revisado={relatorio.situacao === "revisado"}
              notas={relatorio.notas_da_time}
              links={d.links.filter((l) => l.relatorioId === relatorio.id)}
            />
          </section>
          <RelatorioDaTime dados={relatorio.dados} comparacao={relatorio.comparacao} custoCentavos={Number(relatorio.custo_centavos)} t={t} tag={tag} />
        </>
      ) : (
        <p className="rounded-md border border-border bg-surface p-5 text-sm text-text-muted">
          {t("O relatório aparece aqui quando a leitura e a análise terminarem.")}
        </p>
      )}
    </div>
  );
}
