import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { AjustesDoRaioX, ConexaoDoRaioX, RevisaoDoRelatorio } from "@/components/raio-x/AcoesDoRaioX";
import { RelatorioDaTime } from "@/components/raio-x/RelatorioDoRaioX";
import { ROTULO_DA_FASE, ROTULO_DA_SITUACAO, ROTULO_DE_QUEM_ATENDE, ROTULO_DO_TIPO } from "@/components/raio-x/rotulos";
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

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-sm text-text-muted">
          <Link href="/admin/raio-x" className="underline">
            {t("Raio-X do atendimento")}
          </Link>
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{r.empresa}</h1>
        <p className="text-sm text-text-muted">
          {t(r.segmentoRotulo)} · {r.whatsappParaLer} · {t(ROTULO_DO_TIPO[r.tipo])} · {t("últimos {n} dias").replace("{n}", String(r.periodoDias))} ·{" "}
          {t(ROTULO_DE_QUEM_ATENDE[r.quemAtende as keyof typeof ROTULO_DE_QUEM_ATENDE] ?? ROTULO_DE_QUEM_ATENDE.humano)}
        </p>
        <p className="text-sm">
          <span className="rounded-full bg-surface-elevated px-2 py-0.5 text-xs" data-raio-x-situacao={r.situacao}>
            {t(ROTULO_DA_SITUACAO[r.situacao])}
          </span>
        </p>
      </header>

      {r.numeroDiferente ? (
        <p className="rounded-md bg-error-bg p-3 text-sm text-error-fg">
          {t("O dono conectou um número diferente do cadastrado. A conexão foi derrubada e nada foi lido. Ele pode conectar de novo com o número certo.")}
        </p>
      ) : null}

      <section className="space-y-3 rounded-lg border border-border bg-surface p-5">
        <h2 className="text-base font-semibold">{t("Conexão")}</h2>
        {d.conexao ? (
          <ConexaoDoRaioX raioXId={r.id} link={d.conexao.link} mensagem={d.conexao.mensagem} vivo={d.conexao.vivo} expiraEm={d.conexao.expiraEm} />
        ) : null}
        <ul className="space-y-1 text-sm text-text-muted">
          <li>
            {t("Autorização:")}{" "}
            {d.aceite
              ? `${d.aceite.nome} · ${data(d.aceite.aceito_em)} · ${t("termo")} ${d.aceite.termo_versao}`
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
              <p className="text-sm">
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
