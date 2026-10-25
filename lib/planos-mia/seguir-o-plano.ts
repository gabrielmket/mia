/**
 * FORK MIA (.90) — OS MÓDULOS SEGUEM O PLANO: o registro, o aviso e a véspera.
 *
 * Quem decide se um módulo vale é a pergunta ao banco (`modulos.ts`), na hora.
 * Aqui mora o que a EMPRESA fica sabendo: quando o plano liga ou desliga um
 * módulo, uma linha no histórico (`mia_modulos_do_plano_registro`, pela
 * `fn_mia_seguir_o_plano`, sob trava por empresa) e um aviso na Central de quem
 * administra; e, 7 dias antes de uma descida de plano desligar um módulo, o
 * aviso por e-mail e na Central.
 *
 * Os PONTOS DE LIGAÇÃO com a cobrança do upstream (cada um com `FORK MIA`):
 *   - a releitura (`lib/cobranca/sincronizar.ts`): o aviso do provedor e a
 *     reconciliação de 6 h passam por ela — upgrade pago, renovação que aplica o
 *     plano agendado, cancelamento;
 *   - a troca no teste grátis (`lib/cobranca/troca.ts`), que vale na hora;
 *   - a rodada horária (`lib/cobranca/rodada.ts`): segue o plano em todas as
 *     empresas (a rede de segurança) e dá o aviso dos 7 dias;
 *   - o card Cobrança do dono (atribuir, trocar e isentar) e o MCP.
 * Um gancho perdido atrasa o AVISO, nunca o módulo: a pergunta é a verdade.
 *
 * Nada aqui lança: o aviso é informação, e a cobrança não pode parar por ele.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { diaEMes } from "@/lib/cobranca/avisos";
import { enviarAvisoAosAdmins } from "@/lib/cobranca/emails";
import { traduzir } from "@/lib/i18n/dicionario";
import { normalizarIdioma, type Idioma } from "@/lib/i18n/idiomas";
import { logger } from "@/lib/logger";
import { ehOperante } from "@/lib/organizacao/operante";

import { ehModuloDoPlano, MODULOS_DO_PLANO, ROTULO_DO_MODULO_DO_PLANO, type ModuloDoPlano } from "./catalogo";

/** De onde veio a mudança (a coluna `motivo` do registro). */
export type MotivoDaMudanca =
  | "releitura"
  | "troca"
  | "rodada"
  | "plano_editado"
  | "atribuicao"
  | "isencao"
  | "cadastro";

export interface MudancaDeModulo {
  modulo: ModuloDoPlano;
  acao: "ligou" | "desligou";
}

const DIA_MS = 86_400_000;
/** A antecedência do aviso de que uma descida de plano vai desligar módulo. */
export const ANTECEDENCIA_DO_AVISO_DE_SAIDA_DIAS = 7;

interface OrgDoAviso {
  id: string;
  locale: string | null;
  timezone: string | null;
  status: string;
}

async function lerOrg(admin: SupabaseClient, orgId: string): Promise<OrgDoAviso | null> {
  const { data } = await admin.from("organizations").select("id, locale, timezone, status").eq("id", orgId).maybeSingle();
  return (data as OrgDoAviso | null) ?? null;
}

async function nomeDoPlanoDaEmpresa(admin: SupabaseClient, orgId: string): Promise<string | null> {
  const { data: a } = await admin.from("cobranca_assinaturas").select("plano_id").eq("organization_id", orgId).maybeSingle();
  const planoId = (a as { plano_id?: string } | null)?.plano_id;
  if (!planoId) return null;
  const { data: p } = await admin.from("cobranca_planos").select("nome").eq("id", planoId).maybeSingle();
  return (p as { nome?: string } | null)?.nome ?? null;
}

const nomeDoModulo = (m: ModuloDoPlano, idioma: Idioma) => traduzir(ROTULO_DO_MODULO_DO_PLANO[m].rotulo, idioma);

/** O texto de cada mudança, no idioma da empresa. Puro; exportado para os testes. */
export function textoDaMudanca(
  m: MudancaDeModulo,
  plano: string | null,
  idioma: Idioma,
): { titulo: string; corpo: string } {
  const t = (s: string) => traduzir(s, idioma);
  const nome = nomeDoModulo(m.modulo, idioma);
  if (m.acao === "ligou") {
    return {
      titulo: t("{modulo} ligado pelo plano {plano}").replace("{modulo}", nome).replace("{plano}", plano ?? t("da empresa")),
      corpo: t("O {modulo} entrou no plano da empresa e já aparece no menu.").replace("{modulo}", nome),
    };
  }
  return {
    titulo: t("{modulo} desligado: saiu do plano").replace("{modulo}", nome),
    corpo: t(
      "O plano da empresa não inclui mais o {modulo}. A tela e o envio param; os dados ficam guardados. Para voltar, troque de plano em Plano e cobrança.",
    ).replace("{modulo}", nome),
  };
}

async function avisarNaCentral(
  admin: SupabaseClient,
  orgId: string,
  aviso: { titulo: string; corpo: string; severidade: "info" | "warn" },
): Promise<void> {
  // `other` com a referência `plano`: o botão leva a Plano e cobrança, só para
  // quem administra (lib/ai/inbox-destino.ts). Não usa `kind = 'cobranca'` de
  // propósito: lá a régua do upstream fecha e deduplica os avisos dela.
  const { error } = await admin.from("agent_inbox_items").insert({
    organization_id: orgId,
    kind: "other",
    severity: aviso.severidade,
    title: aviso.titulo.slice(0, 200),
    body: aviso.corpo.slice(0, 1000),
    ref_kind: "plano",
    ref_id: orgId,
  });
  if (error) logger.warn("planos-mia: aviso da Central não gravado", { organization_id: orgId, codigo: error.code ?? null });
}

/**
 * Grava o que mudou desde a última vez e avisa a empresa. Rodar de novo sem
 * mudança não grava nem avisa (a função do banco compara com o histórico).
 * NUNCA LANÇA; devolve as mudanças (vazio na falha).
 */
export async function seguirOPlano(
  admin: SupabaseClient,
  orgId: string,
  motivo: MotivoDaMudanca,
): Promise<MudancaDeModulo[]> {
  try {
    const { data, error } = await admin.rpc("fn_mia_seguir_o_plano", { p_org: orgId, p_motivo: motivo });
    if (error) {
      logger.warn("planos-mia: seguir o plano falhou", { organization_id: orgId, motivo, codigo: error.code ?? null });
      return [];
    }
    const mudancas = (Array.isArray(data) ? (data as Array<{ modulo?: unknown; acao?: unknown }>) : [])
      .filter((x): x is MudancaDeModulo => typeof x.modulo === "string" && ehModuloDoPlano(x.modulo) && (x.acao === "ligou" || x.acao === "desligou"));
    if (mudancas.length === 0) return [];

    const [org, plano] = await Promise.all([lerOrg(admin, orgId), nomeDoPlanoDaEmpresa(admin, orgId)]);
    const idioma = normalizarIdioma(org?.locale ?? null);
    for (const m of mudancas) {
      const texto = textoDaMudanca(m, plano, idioma);
      await avisarNaCentral(admin, orgId, { ...texto, severidade: m.acao === "desligou" ? "warn" : "info" });
    }
    void audit({
      action: "planos_mia.modulos_seguiram_o_plano",
      actorUserId: null,
      bypassedRls: true,
      organizationId: orgId,
      resourceType: "mia_modulos_do_plano_registro",
      resourceId: orgId,
      metadata: { motivo, mudancas },
    });
    return mudancas;
  } catch (erro) {
    logger.warn("planos-mia: seguir o plano falhou", {
      organization_id: orgId,
      motivo,
      detalhe: erro instanceof Error ? erro.message : String(erro),
    });
    return [];
  }
}

/**
 * A rede de segurança da rodada horária: segue o plano em toda empresa com
 * assinatura e em toda que já teve módulo pelo plano (a que ficou isenta precisa
 * do "desligou"). Devolve quantas mudaram. Nunca lança.
 */
export async function seguirOPlanoEmTodas(admin: SupabaseClient): Promise<number> {
  try {
    const [assinaturas, registro] = await Promise.all([
      admin.from("cobranca_assinaturas").select("organization_id").limit(10_000),
      admin.from("mia_modulos_do_plano_registro").select("organization_id").eq("acao", "ligou").limit(10_000),
    ]);
    if (assinaturas.error || registro.error) return 0;
    const orgs = new Set<string>([
      ...((assinaturas.data ?? []) as Array<{ organization_id: string }>).map((l) => l.organization_id),
      ...((registro.data ?? []) as Array<{ organization_id: string }>).map((l) => l.organization_id),
    ]);
    let mudaram = 0;
    for (const org of orgs) {
      if ((await seguirOPlano(admin, org, "rodada")).length > 0) mudaram += 1;
    }
    return mudaram;
  } catch {
    return 0;
  }
}

interface AgendadaParaDescer {
  organization_id: string;
  plano_id: string;
  plano_agendado_id: string;
  proximo_vencimento: string;
}

/** Os módulos que saem numa troca de `atual` para `agendado` (puro). A liberação à mão fica. */
export function modulosQueSaem(
  doAtual: readonly ModuloDoPlano[],
  doAgendado: readonly ModuloDoPlano[],
  aMao: ReadonlySet<string>,
): ModuloDoPlano[] {
  return MODULOS_DO_PLANO.filter((m) => doAtual.includes(m) && !doAgendado.includes(m) && !aMao.has(m));
}

/**
 * O aviso de 7 dias antes de uma descida de plano desligar módulo: e-mail para
 * quem administra e aviso na Central, uma vez por troca agendada (a trava é a
 * chave em `platform_avisos_enviados`). Devolve quantos avisos saíram. Nunca lança.
 */
export async function avisarModulosQueSaem(admin: SupabaseClient, agora: Date = new Date()): Promise<number> {
  try {
    const limite = new Date(agora.getTime() + ANTECEDENCIA_DO_AVISO_DE_SAIDA_DIAS * DIA_MS).toISOString();
    const { data, error } = await admin
      .from("cobranca_assinaturas")
      .select("organization_id, plano_id, plano_agendado_id, proximo_vencimento")
      .not("plano_agendado_id", "is", null)
      .gt("proximo_vencimento", agora.toISOString())
      .lte("proximo_vencimento", limite);
    if (error) return 0;
    const candidatas = (data ?? []) as AgendadaParaDescer[];
    if (candidatas.length === 0) return 0;

    const planos = [...new Set(candidatas.flatMap((c) => [c.plano_id, c.plano_agendado_id]))];
    const [lados, nomes] = await Promise.all([
      admin.from("mia_plano_modulos").select("plano_id, modulos").in("plano_id", planos),
      admin.from("cobranca_planos").select("id, nome").in("id", planos),
    ]);
    if (lados.error || nomes.error) return 0;
    const modulosDe = new Map(
      ((lados.data ?? []) as Array<{ plano_id: string; modulos: string[] | null }>).map((l) => [
        l.plano_id,
        (l.modulos ?? []).filter(ehModuloDoPlano),
      ]),
    );
    const nomeDe = new Map(((nomes.data ?? []) as Array<{ id: string; nome: string }>).map((p) => [p.id, p.nome]));

    let avisos = 0;
    for (const c of candidatas) {
      const { data: mao } = await admin
        .from("organization_modules")
        .select("modulo")
        .eq("organization_id", c.organization_id)
        .is("revoked_at", null);
      const saem = modulosQueSaem(
        modulosDe.get(c.plano_id) ?? [],
        modulosDe.get(c.plano_agendado_id) ?? [],
        new Set(((mao ?? []) as Array<{ modulo: string }>).map((l) => l.modulo)),
      );
      if (saem.length === 0) continue;
      const chave = `jornada:modulos_saem:${c.organization_id}:${c.plano_agendado_id}:${c.proximo_vencimento.slice(0, 10)}`;
      const { data: ja } = await admin.from("platform_avisos_enviados").select("chave").eq("chave", chave).maybeSingle();
      if (ja) continue;
      const org = await lerOrg(admin, c.organization_id);
      if (!org || !ehOperante(org.status)) continue;
      const idioma = normalizarIdioma(org.locale);
      const t = (s: string) => traduzir(s, idioma);
      const nomesDosModulos = saem.map((m) => nomeDoModulo(m, idioma)).join(", ");
      const dia = diaEMes(new Date(c.proximo_vencimento), idioma, org.timezone);
      const texto = {
        titulo: t("Sai do plano em {data}: {modulos}").replace("{modulos}", nomesDosModulos).replace("{data}", dia),
        corpo: t(
          "A troca para o plano {plano} vale na renovação, em {data}. Nesse dia sai do plano: {modulos}. Os dados ficam guardados. Para manter, fique no plano atual em Plano e cobrança.",
        )
          .replace("{plano}", nomeDe.get(c.plano_agendado_id) ?? "")
          .replace("{data}", dia)
          .replace("{modulos}", nomesDosModulos),
        severidade: "warn" as const,
      };
      // A trava ANTES do envio: na dúvida entre avisar duas vezes e uma, uma.
      const { error: erroDaTrava } = await admin
        .from("platform_avisos_enviados")
        .insert({ chave, enviado_em: agora.toISOString(), detalhe: { organizacao: c.organization_id, modulos: saem } });
      if (erroDaTrava) continue;
      await avisarNaCentral(admin, c.organization_id, texto);
      await enviarAvisoAosAdmins(admin, { id: c.organization_id, idioma }, texto, null);
      void audit({
        action: "planos_mia.aviso_de_modulo_saindo",
        actorUserId: null,
        bypassedRls: true,
        organizationId: c.organization_id,
        resourceType: "cobranca_assinatura",
        resourceId: c.organization_id,
        metadata: { modulos: saem, plano_agendado_id: c.plano_agendado_id, vale_em: c.proximo_vencimento },
      });
      avisos += 1;
    }
    return avisos;
  } catch (erro) {
    logger.warn("planos-mia: aviso dos 7 dias falhou", { detalhe: erro instanceof Error ? erro.message : String(erro) });
    return 0;
  }
}
