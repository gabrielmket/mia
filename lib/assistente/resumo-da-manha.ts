/**
 * FORK MIA (.88) — O RESUMO DA MANHÃ: em dia útil, às 8h no fuso da empresa, o
 * plano do dia de cada pessoa que ligou o seu, já pronto no assistente, com um
 * aviso no sino (regra "Resumo da manhã" do protótipo).
 *
 * ── Sem IA nenhuma ──────────────────────────────────────────────────────────
 *
 * O resumo é montado pelas MESMAS leituras do turno (`leituras/*.ts`) e pela
 * MESMA ordem do "por onde eu começo" (`prioridades.ts`), em texto fixo. Não
 * gasta IA: são as perguntas que a pessoa faria toda manhã, respondidas pelo
 * sistema.
 *
 * ── O cliente de serviço e o escopo ─────────────────────────────────────────
 *
 * Aqui não há sessão (é o cron). O cliente é o de serviço, e o ESCOPO é o que
 * impede o resumo de mostrar mais do que a pessoa vê: o atendente recebe só o
 * que é dele (dono da tarefa, do compromisso, da conversa, do negócio); gestor
 * e administrador, a empresa, que é o que já veem nas telas. Nenhum texto de
 * conversa entra.
 *
 * ── Quem recebe ─────────────────────────────────────────────────────────────
 *
 * Quem ligou o seu (`mia_assistente_preferencias.resumo_da_manha`), mais, nas
 * empresas que pediram o padrão ligado (`mia_assistente_config`), quem não
 * escolheu nada. A empresa tem de estar operante e o papel tem de usar o
 * assistente. Um resumo por pessoa por dia: a trava é a conversa do dia.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { diaDaSemanaLocal } from "@/lib/agenda/fuso";
import type { Role } from "@/lib/auth/types";
import { eHoraDaVarredura } from "@/lib/automation/cron-de-data";
import { traduzir } from "@/lib/i18n/dicionario";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { perfilDoPais } from "@/lib/legal/perfil-do-pais";
import { logger } from "@/lib/logger";
import { ehOperante } from "@/lib/organizacao/operante";
import { fusoUtilizavel } from "@/lib/tempo/fusos";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";

import { avisarNoSino } from "./avisos";
import { configDaLinha, janelaDoDia, papelUsaOAssistente } from "./config";
import { escopoDoPapel, type PessoaDaEquipe } from "./leituras/comum";
import { lerLeads } from "./leituras/leads";
import { lerPerformance } from "./leituras/performance";
import { lerRotinaDoDia } from "./leituras/rotina";
import { prioridadesDoDia, textoDoResumoDaManha } from "./prioridades";
import type { AcaoDoAssistente } from "./tipos";
// FORK MIA (.93): a trilha pausada no resumo e a retenção das trilhas.
import { expurgarTrilhasVencidas, lembreteDaTrilhaPausada } from "./trilhas/lembrete";

export const HORA_DO_RESUMO = 8;
/** Teto de pessoas por rodada: o que passar fica para a próxima hora, no mesmo dia não. */
const TETO_POR_RODADA = 400;

export interface ResultadoDoResumo {
  escritos: number;
  empresas: number;
  pulados: Record<string, number>;
}

interface Candidato {
  organizationId: string;
  userId: string;
}

/** A empresa está no dia útil das 8h? Sábado, domingo e feriado nacional não. */
export function eHoraDoResumo(agora: Date, fuso: string, pais: string | null): boolean {
  if (!eHoraDaVarredura(agora, fuso, HORA_DO_RESUMO)) return false;
  const dia = diaDaSemanaLocal(agora, fuso);
  if (dia === 0 || dia === 6) return false;
  const { dia: hoje } = janelaDoDia(agora, fuso);
  return !perfilDoPais(pais).calendario.feriados.includes(hoje);
}

export async function escreverResumosDaManha(admin: SupabaseClient, agora: Date): Promise<ResultadoDoResumo> {
  const pulados: Record<string, number> = {};
  const pular = (motivo: string) => {
    pulados[motivo] = (pulados[motivo] ?? 0) + 1;
  };

  // ── quem pode receber ──
  const [{ data: prefs }, { data: configsLigadas }] = await Promise.all([
    admin.from("mia_assistente_preferencias").select("organization_id, user_id, resumo_da_manha").limit(10_000),
    admin
      .from("mia_assistente_config")
      .select("organization_id")
      .eq("resumo_da_manha_padrao", true)
      .eq("ligado", true)
      .limit(5_000),
  ]);
  const escolhas = (prefs ?? []) as Array<{ organization_id: string; user_id: string; resumo_da_manha: boolean }>;
  const orgsComPadrao = new Set(((configsLigadas ?? []) as Array<{ organization_id: string }>).map((c) => c.organization_id));
  const orgIds = new Set<string>([...escolhas.filter((e) => e.resumo_da_manha).map((e) => e.organization_id), ...orgsComPadrao]);
  if (orgIds.size === 0) return { escritos: 0, empresas: 0, pulados };

  let escritos = 0;
  let empresas = 0;
  const lista = [...orgIds];
  for (let i = 0; i < lista.length; i += 100) {
    const lote = lista.slice(i, i + 100);
    const { data: orgs } = await admin
      .from("organizations")
      .select("id, status, timezone, country, locale")
      .in("id", lote);
    for (const org of (orgs ?? []) as Array<{ id: string; status: string; timezone: string | null; country: string | null; locale: string | null }>) {
      if (escritos >= TETO_POR_RODADA) break;
      if (!ehOperante(org.status)) {
        pular("organizacao_parada");
        continue;
      }
      const fuso = fusoUtilizavel(org.timezone);
      let naHora = false;
      try {
        naHora = eHoraDoResumo(agora, fuso, org.country);
      } catch {
        pular("fuso_invalido");
        continue;
      }
      if (!naHora) continue;

      const { data: configLinha } = await admin
        .from("mia_assistente_config")
        .select("ligado, papeis, perguntas_por_pessoa_por_dia, resumo_da_manha_padrao")
        .eq("organization_id", org.id)
        .maybeSingle();
      const config = configDaLinha(configLinha as Record<string, unknown> | null);
      if (!config.ligado) {
        pular("assistente_desligado");
        continue;
      }

      const { data: vinculosBrutos } = await admin
        .from("user_organizations")
        .select("user_id, role")
        .eq("organization_id", org.id)
        .is("revoked_at", null)
        .limit(500);
      const vinculos = (vinculosBrutos ?? []) as Array<{ user_id: string; role: string }>;
      const escolhaDe = new Map(escolhas.filter((e) => e.organization_id === org.id).map((e) => [e.user_id, e.resumo_da_manha]));
      const candidatos: Array<Candidato & { papel: Role }> = vinculos
        .filter((v) => papelUsaOAssistente(config, v.role))
        .filter((v) => escolhaDe.get(v.user_id) ?? config.resumoDaManhaPadrao)
        .map((v) => ({ organizationId: org.id, userId: v.user_id, papel: v.role as Role }));
      if (candidatos.length === 0) continue;
      empresas += 1;

      const nomes = await nomesDosAtendentes(vinculos.map((v) => v.user_id));
      const equipe: PessoaDaEquipe[] = vinculos.map((v) => ({
        user_id: v.user_id,
        nome: (nomes.get(v.user_id) ?? "").trim() || "Pessoa sem nome",
        papel: v.role as Role,
      }));
      const idioma = normalizarIdioma(org.locale);
      const t = (texto: string) => traduzir(texto, idioma);
      const { inicio, dia } = janelaDoDia(agora, fuso);

      for (const c of candidatos) {
        if (escritos >= TETO_POR_RODADA) break;
        // A trava de um por dia: a conversa do resumo de hoje.
        const { count } = await admin
          .from("mia_assistente_conversas")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", org.id)
          .eq("user_id", c.userId)
          .eq("origem", "resumo_da_manha")
          .gte("created_at", inicio.toISOString());
        if ((count ?? 0) > 0) {
          pular("ja_escrito_hoje");
          continue;
        }
        try {
          const escopo = escopoDoPapel(c.papel, c.userId);
          const rotina = await lerRotinaDoDia(admin, {
            organizationId: org.id,
            escopo,
            fuso,
            agora,
            equipe,
            veNumeros: c.papel === "admin",
          });
          const [leads, performance] = await Promise.all([
            lerLeads(admin, { organizationId: org.id, escopo, papel: c.papel, agora, equipe }).catch(() => null),
            lerPerformance(admin, { organizationId: org.id, escopo, periodo: "mes", agora, fuso, equipe }).catch(() => null),
          ]);
          const prioridades = prioridadesDoDia({ rotina, leads, performance, idioma }, t);
          const primeiroNome = (equipe.find((p) => p.user_id === c.userId)?.nome ?? "").split(/\s+/)[0] ?? "";
          // FORK MIA (.93): a trilha pausada, lembrada uma vez (decisão 11; nunca no WhatsApp).
          const lembrete = await lembreteDaTrilhaPausada(admin, {
            organizationId: org.id,
            userId: c.userId,
            inicioDoDia: inicio,
            t,
          }).catch(() => null);
          const resumo = textoDoResumoDaManha({ primeiroNome, rotina, prioridades }, t);
          const texto = lembrete ? `${resumo}\n\n${lembrete.texto}` : resumo;
          const acoes: AcaoDoAssistente[] = [
            ...prioridades.slice(0, 4).map((p) => ({ tipo: "ir" as const, rotulo: p.rotulo, href: p.href })),
            ...(lembrete ? [lembrete.acao] : []),
          ];

          const { data: conversa } = await admin
            .from("mia_assistente_conversas")
            .insert({
              organization_id: org.id,
              user_id: c.userId,
              titulo: `${t("Resumo da manhã")} · ${dia.slice(8, 10)}/${dia.slice(5, 7)}`,
              origem: "resumo_da_manha",
            })
            .select("id")
            .single();
          const conversaId = (conversa as { id: string } | null)?.id;
          if (!conversaId) {
            pular("nao_gravou");
            continue;
          }
          await admin.from("mia_assistente_mensagens").insert({
            organization_id: org.id,
            conversa_id: conversaId,
            user_id: c.userId,
            tipo: "resumo_da_manha",
            texto,
            fontes: [...new Set([...rotina.fontes, ...(leads?.fontes ?? []), ...(performance?.fontes ?? [])])],
            acoes,
            contatos: [...new Set([...rotina.contatos, ...(leads?.contatos ?? [])])],
          });
          if (lembrete) await lembrete.marcar().catch(() => undefined);
          await admin
            .from("mia_assistente_preferencias")
            .update({ ultimo_resumo_em: dia })
            .eq("organization_id", org.id)
            .eq("user_id", c.userId);
          await avisarNoSino(admin, {
            organizationId: org.id,
            paraUserId: c.userId,
            titulo: t("Seu resumo da manhã está pronto no assistente."),
            corpo: prioridades[0]?.texto ?? null,
            refKind: "mia_assistente_resumo",
            refId: conversaId,
            severidade: "info",
          });
          escritos += 1;
        } catch (erro) {
          pular("leitura_falhou");
          logger.warn("[assistente] o resumo da manhã de uma pessoa falhou", {
            organizationId: org.id,
            erro: erro instanceof Error ? erro.message : String(erro),
          });
        }
      }
    }
  }
  return { escritos, empresas, pulados };
}

/** A retenção do assistente (9051), chamada pela mesma rodada. */
export async function expurgarAssistenteVencido(
  admin: SupabaseClient,
): Promise<{ mensagens: number; conversas: number; chamados: number } | null> {
  const { data, error } = await admin.rpc("fn_mia_expurgar_assistente_vencido", {
    p_retencao_dias: 90,
    p_limite: 5000,
  });
  if (error) {
    logger.warn("[assistente] a retenção do assistente falhou", { erro: error.message });
    return null;
  }
  // FORK MIA (.93): o progresso das trilhas parado há mais de um ano (9090).
  const trilhas = await expurgarTrilhasVencidas(admin).catch(() => null);
  if (trilhas === null) logger.warn("[assistente] a retenção das trilhas falhou");
  const r = (data ?? {}) as { mensagens?: number; conversas?: number; chamados?: number };
  return { mensagens: r.mensagens ?? 0, conversas: r.conversas ?? 0, chamados: r.chamados ?? 0 };
}
