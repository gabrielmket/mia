import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { isServiceRoleConfigured } from "@/lib/audit";
import { traduzir } from "@/lib/i18n/dicionario";
import { podeCompartilhar, podeEditar, podeExportar } from "@/lib/relatorios/acesso";
import { idsDePessoa, nomesDaEquipe } from "@/lib/relatorios/equipe";
import { nomeDoPronto, RELATORIOS_PRONTOS } from "@/lib/relatorios/prontos";
import { funisDosRelatorios, listarRelatorios } from "@/lib/relatorios/servidor";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { ListaDeRelatorios } from "./_client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Relatórios" };

/**
 * FORK MIA (item 9) — RELATÓRIOS (protótipo, tela 1): as abas Prontos (os
 * doze painéis do item 8, agora abertos: dá para ver a conta, copiar e mudar
 * o que quiser; o original nunca muda) e Meus relatórios (os da pessoa e os
 * que alguém compartilhou com a equipe), com busca e "Novo relatório".
 *
 * Mora ao lado de Painéis prontos (`/app/paineis`), no grupo Análise: os
 * painéis prontos são a pergunta do dono, prontos para olhar; aqui é onde
 * a equipe monta as próprias perguntas, com o mesmo motor de conta.
 */
export default async function RelatoriosPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const t = (texto: string) => traduzir(texto, user.idioma);
  const db = await createClient();
  const [relatorios, { padrao }] = await Promise.all([
    listarRelatorios(db, activeOrg.orgId),
    funisDosRelatorios(db, activeOrg.orgId),
  ]);
  const nomes = isServiceRoleConfigured()
    ? await nomesDaEquipe(createAdminClient(), activeOrg.orgId, idsDePessoa(relatorios.map((r) => r.criadoPor)))
    : {};

  return (
    <ListaDeRelatorios
      prontos={RELATORIOS_PRONTOS.map((p) => ({ ...p, nome: nomeDoPronto(p, padrao?.compromissos, t) }))}
      relatorios={relatorios.map((r) => ({
        id: r.id,
        nome: r.nome,
        config: r.config,
        compartilhado: r.compartilhado,
        atualizadoEm: r.atualizadoEm,
        meu: r.criadoPor === user.id,
        criadoPorNome: r.criadoPor ? (nomes[r.criadoPor] ?? null) : null,
        podeEditar: podeEditar(r, { userId: user.id, role: activeOrg.role }),
      }))}
      permissoes={{ compartilhar: podeCompartilhar(activeOrg.role), exportar: podeExportar(activeOrg.role) }}
    />
  );
}
