import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { isServiceRoleConfigured } from "@/lib/audit";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { listarLinks } from "@/lib/paineis/link";
import { podeCompartilhar, podeEditar, podeExportar, veValores } from "@/lib/relatorios/acesso";
import { ehPeriodoDoPainel } from "@/lib/relatorios/catalogo";
import { dataCurta } from "@/lib/relatorios/apresentar";
import { identificaPessoa } from "@/lib/relatorios/config";
import { configsDoPainel } from "@/lib/relatorios/link";
import { funisDosRelatorios, lerPainel } from "@/lib/relatorios/servidor";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { PainelDoUsuario } from "./_painel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Painel" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * FORK MIA (item 9) — O PAINEL (protótipo, tela 5): relatórios salvos e prontos
 * lado a lado, em P, M e G; o período do painel vale para todos, menos para
 * quem marcou "período próprio"; reordenar pelas setas ou arrastando;
 * compartilhar com a equipe e gerar o link para o dono (gestor e
 * administrador). Quem não edita o painel vê o mesmo painel com os números que
 * já vê no CRM, e troca o período só para olhar.
 */
export default async function PainelPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ periodo?: string }>;
}) {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const { id } = await params;
  if (!UUID.test(id)) redirect("/app/relatorios/paineis");
  const busca = await searchParams;
  const t = (texto: string) => traduzir(texto, user.idioma);
  const db = await createClient();
  const painel = await lerPainel(db, activeOrg.orgId, id);
  if (!painel) redirect("/app/relatorios/paineis");
  const { padrao } = await funisDosRelatorios(db, activeOrg.orgId);
  const configs = await configsDoPainel(db, activeOrg.orgId, painel, padrao?.compromissos);
  const gestor = podeCompartilhar(activeOrg.role);
  const link =
    gestor && isServiceRoleConfigured()
      ? ((await listarLinks(createAdminClient(), activeOrg.orgId)).find((l) => l.painelId === painel.id && l.situacao === "ativo") ?? null)
      : null;

  return (
    <PainelDoUsuario
      painel={{ id: painel.id, nome: painel.nome, periodo: painel.periodo, compartilhado: painel.compartilhado, meu: painel.criadoPor === user.id }}
      itens={painel.itens.map((item, i) => {
        const c = configs[i];
        return {
          id: item.id,
          tamanho: item.tamanho,
          periodoProprio: item.periodoProprio,
          posicao: item.posicao,
          relatorioId: item.relatorioId,
          pronto: item.pronto,
          titulo: c ? (c.traduzir ? t(c.titulo) : c.titulo) : null,
          config: c?.config ?? null,
          pessoa: c ? identificaPessoa(c.config) : false,
        };
      })}
      periodoInicial={ehPeriodoDoPainel(busca.periodo) ? busca.periodo : painel.periodo}
      permissoes={{
        editar: podeEditar(painel, { userId: user.id, role: activeOrg.role }),
        compartilhar: gestor,
        exportar: podeExportar(activeOrg.role),
        valores: veValores(activeOrg.role),
      }}
      link={link ? { url: link.url, validoAte: dataCurta(link.validoAte, activeOrg.timezone || "America/Sao_Paulo") } : null}
    />
  );
}
