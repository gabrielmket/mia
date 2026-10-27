/**
 * FORK MIA (.93) — GET/POST /api/v1/assistente/trilhas: o "Me mostra como".
 *
 *   GET   as trilhas que a empresa vê, com a situação de cada uma PARA A PESSOA
 *         (feita, pausada no passo N, nova, esperando outra, sem o módulo), a
 *         recomendada, o "Me mostra como" ligado ou não e quem pode fazer o que
 *         não é do papel dela (o "Pedir a quem pode").
 *   POST  `acao`: comecar, retomar, avancar, pausar, conferir (as leituras do
 *         sistema de um passo), ja_fiz (o objetivo da trilha) e pergunta (a
 *         pessoa perguntou ao assistente durante o passo: só a contagem).
 *
 * Tudo pela SESSÃO (a regra da .88: o assistente não tem acesso próprio). A RLS
 * da 9090 deixa a pessoa gravar só a própria linha. As conferências leem com o
 * login de quem está na trilha; o diretório de nomes da equipe é o mesmo que o
 * assistente já usa (`lib/assistente/diretorio.ts`).
 *
 * Nada aqui gasta IA, e "feita" só é gravada depois que o sistema conferiu.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { lerConfigDoAssistente, papelUsaOAssistente } from "@/lib/assistente/config";
import { diretorioDaEquipe } from "@/lib/assistente/diretorio";
import { IDS_DAS_TRILHAS, papelFaz, TRILHAS, trilhaPorId, type IdDaTrilha } from "@/lib/assistente/trilhas/catalogo";
import { situacoesDasTrilhas, trilhaRecomendada } from "@/lib/assistente/trilhas/estado";
import {
  avancarTrilha,
  comecarTrilha,
  conferirObjetivo,
  conferirPasso,
  contarNoPasso,
  lerConfigDasTrilhas,
  lerProgressoDaPessoa,
  pausarTrilha,
  trilhasFeitasNaEmpresa,
} from "@/lib/assistente/trilhas/progresso";
import { requireRole } from "@/lib/auth/require-role";
import { roleAtLeast, type Role } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { moduloLiberado } from "@/lib/modulos/liberacao";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "mia_assistente_trilhas" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;
  const papel = authz.org.role as Role;
  const db = await createClient();

  const configDoAssistente = await lerConfigDoAssistente(db, orgId);
  if (!papelUsaOAssistente(configDoAssistente, papel)) {
    return ok({ disponivel: false, me_mostra_como: false, trilhas: [], recomendada: null, quem_pode: null }, { requestId });
  }

  const config = await lerConfigDasTrilhas(db, orgId);
  const [progresso, feitasNaEmpresa, disparador, emailMarketing] = await Promise.all([
    lerProgressoDaPessoa(db, orgId, authz.user.id),
    trilhasFeitasNaEmpresa(db, { organizationId: orgId, userId: authz.user.id, desligadas: config.desligadas }),
    moduloLiberado(db, orgId, "disparador").catch(() => false),
    moduloLiberado(db, orgId, "email_marketing").catch(() => false),
  ]);
  const modulos = new Set<string>([...(disparador ? ["disparador"] : []), ...(emailMarketing ? ["email_marketing"] : [])]);

  // Quem terminou cada trilha da empresa: a RLS da 9090 mostra as linhas da
  // equipe a gestor e administrador; o atendente vê só a dele.
  const equipe = await diretorioDaEquipe(orgId).catch(() => []);
  const nomeDe = new Map(equipe.map((p) => [p.user_id, p.nome]));
  const quemFez = new Map<IdDaTrilha, string>();
  const daEmpresa = TRILHAS.filter((t) => t.daEmpresa).map((t) => t.id);
  const { data: feitas } = await db
    .from("mia_assistente_trilhas")
    .select("trilha, user_id, feita_em")
    .eq("organization_id", orgId)
    .eq("situacao", "feita")
    .in("trilha", daEmpresa)
    .order("feita_em", { ascending: false })
    .limit(50);
  for (const f of (feitas ?? []) as Array<{ trilha: IdDaTrilha; user_id: string }>) {
    if (!quemFez.has(f.trilha) && nomeDe.has(f.user_id)) quemFez.set(f.trilha, nomeDe.get(f.user_id)!);
  }

  const situacoes = situacoesDasTrilhas({ papel, progresso, feitasNaEmpresa, quemFez, modulos, config });
  const primeiro = (min: Role) =>
    equipe.find((p) => p.user_id !== authz.user.id && roleAtLeast(p.papel, min) && (min !== "manager" || p.papel === "manager")) ??
    equipe.find((p) => p.user_id !== authz.user.id && roleAtLeast(p.papel, min)) ??
    null;
  const pessoa = (p: { user_id: string; nome: string } | null) => (p ? { user_id: p.user_id, nome: p.nome } : null);

  return ok(
    {
      disponivel: true,
      papel,
      me_mostra_como: config.meMostraComo,
      recomendada: trilhaRecomendada(situacoes, config),
      trilhas: situacoes.map((s) => ({
        id: s.id,
        estado: s.estado,
        passo: s.passo,
        de: s.de,
        quando: s.quando,
        feita_na_empresa: s.feitaNaEmpresa,
        quem_fez: s.quemFez,
        do_papel: s.doPapel,
        esperando: s.esperando,
      })),
      quem_pode: { manager: pessoa(primeiro("manager")), admin: pessoa(primeiro("admin")) },
    },
    { requestId },
  );
}

const corpoSchema = z
  .object({
    acao: z.enum(["comecar", "retomar", "avancar", "pausar", "conferir", "ja_fiz", "pergunta"]),
    trilha: z.enum(IDS_DAS_TRILHAS),
    passo: z.number().int().min(0).max(49).optional(),
    de_novo: z.boolean().optional(),
  })
  .strict();

export async function POST(req: NextRequest): Promise<Response> {
  // O acompanhamento do suporte não anda na trilha em nome da pessoa.
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "mia_assistente_trilhas" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;
  const papel = authz.org.role as Role;

  const parsed = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", t("Pedido inválido."), 422, { requestId });
  const trilha = trilhaPorId(parsed.data.trilha)!;
  const db = await createClient();

  const configDoAssistente = await lerConfigDoAssistente(db, orgId);
  if (!papelUsaOAssistente(configDoAssistente, papel)) {
    return fail("forbidden", t("O assistente está desligado para o seu papel nesta empresa."), 403, { requestId });
  }
  const config = await lerConfigDasTrilhas(db, orgId);
  if (!config.meMostraComo || config.desligadas.includes(trilha.id)) {
    return fail("conflict", t("Esta trilha está desligada nesta empresa."), 409, { requestId });
  }
  // O MESMO papel da tela: quem não faz lê os passos e pede a quem pode.
  if (!papelFaz(trilha, papel)) {
    return fail("forbidden", t("Esta trilha é de outro papel. Veja os passos e peça a quem pode."), 403, { requestId });
  }

  const ctx = { organizationId: orgId, userId: authz.user.id, trilha, passo: parsed.data.passo ?? 0 };
  try {
    switch (parsed.data.acao) {
      case "comecar":
        return ok({ progresso: await comecarTrilha(db, { ...ctx, deNovo: parsed.data.de_novo === true }) }, { requestId });
      case "retomar":
        return ok({ progresso: await comecarTrilha(db, ctx) }, { requestId });
      case "avancar":
        return ok({ progresso: await avancarTrilha(db, ctx) }, { requestId });
      case "pausar":
        return ok({ progresso: await pausarTrilha(db, ctx) }, { requestId });
      case "conferir":
        return ok(await conferirPasso(db, ctx), { requestId });
      case "ja_fiz":
        return ok(await conferirObjetivo(db, ctx), { requestId });
      case "pergunta":
        await contarNoPasso(db, { ...ctx, coluna: "perguntas_no_passo" });
        return ok({ contou: true }, { requestId });
    }
  } catch {
    return fail("unavailable", t("Não deu para guardar o passo agora."), 503, { requestId });
  }
  return fail("validation_failed", t("Pedido inválido."), 422, { requestId });
}
