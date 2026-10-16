import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { isServiceRoleConfigured } from "@/lib/audit";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { tagDeIdioma } from "@/lib/i18n/datas";
import { traduzir } from "@/lib/i18n/dicionario";
import { podeExportar } from "@/lib/relatorios/acesso";
import { idsDePessoa, nomesDaEquipe } from "@/lib/relatorios/equipe";
import { listarExportacoes } from "@/lib/relatorios/servidor";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Registro de exportações" };

/**
 * FORK MIA (item 9) — O REGISTRO DE EXPORTAÇÕES (protótipo, tela 6): quem,
 * quando, o quê e quantas linhas. Só gestor e administrador veem; a RLS da
 * 9040 confere de novo.
 */
export default async function ExportacoesPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (!podeExportar(activeOrg.role)) redirect("/app/relatorios");
  const t = (texto: string) => traduzir(texto, user.idioma);
  const tag = tagDeIdioma(user.idioma);
  const exportacoes = await listarExportacoes(await createClient(), activeOrg.orgId);
  const nomes = isServiceRoleConfigured()
    ? await nomesDaEquipe(createAdminClient(), activeOrg.orgId, idsDePessoa(exportacoes.map((x) => x.userId)))
    : {};

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <nav aria-label={t("Caminho")} className="text-sm text-text-muted">
        <Link href="/app/relatorios" className="inline-flex min-h-11 items-center hover:underline lg:min-h-0">
          {t("Relatórios")}
        </Link>{" "}
        / {t("Registro de exportações")}
      </nav>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Registro de exportações")}</h1>
        <p className="text-sm text-text-muted">
          {t("Cada planilha que saiu do sistema: quem, quando e o quê. A lista por trás de um número leva nome e telefone de cliente.")}
        </p>
      </header>
      {exportacoes.length === 0 ? (
        <p className="rounded-md border border-border p-4 text-sm text-text-muted">{t("Nenhuma exportação ainda.")}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-elevated text-left text-text-muted">
                <th className="px-3 py-2 font-medium">{t("Quem")}</th>
                <th className="px-3 py-2 font-medium">{t("Quando")}</th>
                <th className="px-3 py-2 font-medium">{t("O quê")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("Linhas")}</th>
              </tr>
            </thead>
            <tbody>
              {exportacoes.map((x) => (
                <tr key={x.id} className="border-b border-border/60">
                  <td className="px-3 py-2">{x.userId ? (nomes[x.userId] ?? t("Pessoa fora da equipe")) : t("Pessoa fora da equipe")}</td>
                  <td className="px-3 py-2 tabular-nums">{new Date(x.criadoEm).toLocaleString(tag)}</td>
                  <td className="px-3 py-2">
                    {x.relatorioNome} · {x.tipo === "lista" ? `${t("lista de")} ${x.grupo ?? t("tudo")}` : t("relatório")}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{x.linhas}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
