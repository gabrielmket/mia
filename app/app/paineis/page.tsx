import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { GradeDePaineis } from "@/components/paineis/CartoesDosPaineis";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { tagDeIdioma } from "@/lib/i18n/datas";
import {
  ehPeriodoDosPaineis,
  FRASE_DO_PERIODO,
  PERIODOS_DOS_PAINEIS,
  PERIODO_PADRAO,
  ROTULO_DO_PERIODO,
} from "@/lib/paineis/catalogo";
import { calcularPaineis } from "@/lib/paineis/calcular";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Painéis prontos" };

/**
 * FORK MIA (item 8) — PAINÉIS PRONTOS: os doze painéis do protótipo aprovado
 * em 15/10/2026 (tela 6), dentro do sistema.
 *
 * ── Onde mora, e por que aqui ──────────────────────────────────────────────
 *
 * No grupo Análise, ao lado de Desempenho (`/app/metrics`, do upstream), e não
 * dentro dele: Desempenho é o DIAGNÓSTICO da operação (atrito, perdas por
 * etapa e categoria, previsão por mês e moeda, performance por atendente, por
 * canal), e continua como o upstream o desenhou. Aqui é a pergunta do DONO,
 * uma por cartão, e é exatamente o que o link para o dono mostra lá fora: a
 * mesma grade, o mesmo cálculo (`lib/paineis/calcular.ts`). Nada de Desempenho
 * é repetido com outra conta: a previsão daqui segue a mesma regra de
 * `lib/leads/previsao.ts`, agora somada no banco e sem o teto de 1000 linhas.
 *
 * ── Quem vê o quê ──────────────────────────────────────────────────────────
 *
 * Todo membro abre. A conta é do banco (`fn_mia_relatorio`, `security
 * invoker`), com o cliente da SESSÃO: o atendente vê os negócios e as
 * conversas que já vê no CRM (a RLS do upstream), gestor e administrador veem
 * a empresa. O cartão de anúncios é de gestor e administrador (o piso da tela
 * de Conversões); para os outros, ele diz isso em vez de sumir. "Compartilhar
 * com o dono do negócio" é de gestor e administrador.
 *
 * Período e funil vêm da URL (`?periodo=30&funil=<id>`), e as escolhas são
 * links: a tela funciona sem JavaScript e o endereço pode ser guardado.
 */
export default async function PaineisPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; funil?: string }>;
}) {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  const idioma = user.idioma;
  const t = (texto: string) => traduzir(texto, idioma);
  const busca = await searchParams;
  const periodo = ehPeriodoDosPaineis(busca.periodo) ? busca.periodo : PERIODO_PADRAO;
  const pipelineId = typeof busca.funil === "string" && /^[0-9a-f-]{36}$/i.test(busca.funil) ? busca.funil : null;
  const gestor = ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager;

  const calculados = await calcularPaineis(await createClient(), {
    organizationId: activeOrg.orgId,
    periodo,
    pipelineId,
    valores: true,
  });

  const endereco = (p: string, f: string | null) =>
    `/app/paineis?periodo=${encodeURIComponent(p)}${f ? `&funil=${encodeURIComponent(f)}` : ""}`;
  const funilAtual = calculados.funil?.id ?? null;

  return (
    <div className="flex h-full flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{t("Painéis prontos")}</h1>
          <p className="text-sm text-text-muted">
            {calculados.empresa.nome} · {t(FRASE_DO_PERIODO[periodo])}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* FORK MIA (item 9): o montador de relatórios, ao lado dos painéis prontos. */}
          <Link
            href="/app/relatorios"
            className="inline-flex min-h-11 items-center rounded-sm border border-border px-4 text-sm font-medium hover:bg-surface-elevated lg:min-h-9"
          >
            {t("Montar relatório")}
          </Link>
          <Link
            href="/app/paineis/funil"
            className="inline-flex min-h-11 items-center rounded-sm border border-border px-4 text-sm font-medium hover:bg-surface-elevated lg:min-h-9"
          >
            {t("Análise do funil")}
          </Link>
          {gestor ? (
            <Link
              href="/app/paineis/links"
              className="inline-flex min-h-11 items-center rounded-sm bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 lg:min-h-9"
            >
              {t("Compartilhar com o dono do negócio")}
            </Link>
          ) : null}
        </div>
      </header>

      <nav aria-label={t("Período")} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-text-muted">{t("Período")}</span>
          {PERIODOS_DOS_PAINEIS.map((p) => (
            <Link
              key={p}
              href={endereco(p, pipelineId)}
              aria-current={p === periodo ? "page" : undefined}
              className={
                p === periodo
                  ? "inline-flex min-h-11 items-center rounded-full bg-primary px-4 text-base text-primary-foreground lg:min-h-8 lg:text-sm"
                  : "inline-flex min-h-11 items-center rounded-full border border-border px-4 text-base hover:bg-surface-elevated lg:min-h-8 lg:text-sm"
              }
            >
              {t(ROTULO_DO_PERIODO[p])}
            </Link>
          ))}
        </div>
        {calculados.funis.length > 1 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-text-muted">{t("Funil")}</span>
            {calculados.funis.map((f) => (
              <Link
                key={f.id}
                href={endereco(periodo, f.id)}
                aria-current={f.id === funilAtual ? "page" : undefined}
                className={
                  f.id === funilAtual
                    ? "inline-flex min-h-11 max-w-full items-center truncate rounded-full bg-primary px-4 text-base text-primary-foreground lg:min-h-8 lg:text-sm"
                    : "inline-flex min-h-11 max-w-full items-center truncate rounded-full border border-border px-4 text-base hover:bg-surface-elevated lg:min-h-8 lg:text-sm"
                }
              >
                {f.nome}
              </Link>
            ))}
          </div>
        ) : null}
      </nav>

      <GradeDePaineis
        calculados={calculados}
        f={{ t, tag: tagDeIdioma(idioma), moeda: calculados.empresa.moeda }}
        acoes={{ funil: { href: "/app/paineis/funil", rotulo: t("Ver a análise do funil") } }}
      />

      <p className="text-xs text-text-muted">
        {t(
          "Números somados no banco, com todos os registros do período, no fuso da empresa. Ganhos e perdidos contam pela data em que fecharam; abertos, pela data em que entraram; a agenda, pelo dia marcado.",
        )}
      </p>
    </div>
  );
}
