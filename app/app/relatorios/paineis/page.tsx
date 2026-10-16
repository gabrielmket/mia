import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { podeCompartilhar } from "@/lib/relatorios/acesso";
import { listarPaineis } from "@/lib/relatorios/servidor";
import { createClient } from "@/lib/supabase/server";

import { NovoPainel } from "./_novo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Meus painéis" };

/**
 * FORK MIA (item 9) — os painéis montados no montador: os da pessoa e os
 * compartilhados com a equipe (a RLS da 9040 decide), e "Novo painel".
 */
export default async function PaineisDoUsuarioPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const t = (texto: string) => traduzir(texto, user.idioma);
  const paineis = await listarPaineis(await createClient(), activeOrg.orgId);

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <nav aria-label={t("Caminho")} className="text-sm text-text-muted">
        <Link href="/app/relatorios" className="inline-flex min-h-11 items-center hover:underline lg:min-h-0">
          {t("Relatórios")}
        </Link>{" "}
        / {t("Meus painéis")}
      </nav>
      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{t("Meus painéis")}</h1>
          <p className="text-sm text-text-muted">
            {t("Relatórios salvos lado a lado, em três tamanhos. O período do painel vale para todos, menos para quem marcou período próprio.")}
          </p>
        </div>
        <NovoPainel />
      </header>

      {paineis.length === 0 ? (
        <p className="rounded-md border border-border p-4 text-sm text-text-muted">
          {t("Nenhum painel ainda. Crie um aqui ou, no editor de um relatório, use \"Adicionar a um painel\".")}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {paineis.map((p) => (
            <li key={p.id}>
              <Link href={`/app/relatorios/paineis/${p.id}`} className="flex min-h-11 flex-col gap-2 rounded-md border border-border bg-surface p-4 hover:border-accent">
                <span className="font-semibold">{p.nome}</span>
                <span className="text-sm text-text-muted">
                  {p.itens.length} {t(p.itens.length === 1 ? "relatório" : "relatórios")} ·{" "}
                  {p.compartilhado ? t("Compartilhado com a equipe") : p.criadoPor === user.id ? t("Só para você") : t("Só da pessoa")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {podeCompartilhar(activeOrg.role) ? null : (
        <p className="text-xs text-text-muted">{t("Compartilhar com a equipe e gerar link para o dono é para gestor e administrador.")}</p>
      )}
    </div>
  );
}
