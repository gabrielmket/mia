/**
 * OS DOIS GATILHOS POR TEMPO (issue #1540) — a varredura.
 *
 * `lead.silent_for` (N dias sem mensagem, com direção) e `lead.stage_stale`
 * (N dias na mesma etapa) são AUSÊNCIA de acontecimento: silêncio não gera
 * linha nenhuma no `event_log`, então ninguém os emite — só o relógio. Este
 * cron existe para transformar a parada em ACONTECIMENTO, e quem decide o que
 * fazer com ele é a automação da organização (etiqueta, tarefa, mover o card).
 *
 * ═══ O MODELO É O DA `lead-date-field-due` ═══
 *
 * Regras primeiro, organização depois (só quem tem regra ATIVA paga a
 * varredura), trava no `event_log` pelo par `regra:negócio:ÂNCORA`, evento
 * DIRIGIDO a uma regra pelo `rule_id` no payload. O que muda é a âncora:
 *
 *   - silêncio: o instante da última mensagem da direção escolhida
 *     (`conversations.last_*_at`), ou o nascimento do negócio;
 *   - etapa parada: `crm_leads.stage_changed_at` (carimbada por trigger, 0071).
 *
 * A âncora é o REARME: mensagem nova muda a âncora, card arrastado muda a
 * âncora, e a trava volta a deixar a regra elegível — uma tarefa por EPISÓDIO
 * de silêncio, e não "uma tarefa para sempre" (o defeito que este par de
 * gatilhos foi desenhado para não repetir).
 *
 * ═══ POR QUE NÃO HORA LOCAL ═══
 *
 * O gatilho de data do funil só age na hora da organização porque "hoje" é uma
 * data no fuso de quem opera. Silêncio e etapa parada são DURAÇÃO medida em
 * relógio de máquina (`agora - âncora >= N*24h`), e duração não tem fuso — a
 * varredura pode rodar de hora em hora para toda organização.
 *
 * ═══ PROTEÇÃO DE AGENDA ═══
 *
 * Opt-in por regra (`proteger_pela_agenda`): negócio com compromisso futuro não
 * gera lembrete, pelo MESMO caminho das ações de mensagem
 * (`lib/agenda/protecao-followup.ts`). Opt-in porque há operação que quer o
 * lembrete mesmo com reunião marcada — e a recusa seria invisível.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { protecaoAgendaSupabase } from "@/lib/agenda/protecao-followup";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { TAMANHO_DO_LOTE, TETO_POR_ORGANIZACAO } from "@/lib/automation/cron-de-data";
import {
  GATILHO_ETAPA_PARADA,
  GATILHO_SILENCIO,
  ancoraDaEtapa,
  ancoraDoSilencio,
  chaveDeDisparoTemporal,
  colunaDaDirecao,
  configDaEtapaParada,
  configDoSilencio,
  naoDisparadosTemporais,
} from "@/lib/automation/gatilhos-de-tempo";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { lerTodasAsPaginas } from "@/lib/leitura/todas-as-paginas";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Regra = {
  id: string;
  organization_id: string;
  trigger_event: string;
  trigger_config: unknown;
};

type Candidato = { leadId: string; contactId: string | null; ancora: string };

/**
 * FORK MIA (MIA-369) — os tetos das duas leituras que antes iam sem `range`.
 * Cada uma é lida INTEIRA, página a página (`lerTodasAsPaginas`), na ordem de
 * `id`; acabou o teto sem prova de fim, a leitura falha FECHADA (nunca trata
 * metade como tudo). Em 28/11/2026 a produção tinha 0 regras destes dois
 * gatilhos e 0 linhas deles no `event_log` (10 regras na instalação inteira).
 */
/** As regras de silêncio e de etapa parada ativas da instalação: 20 mil é folga larga. */
const PAGINAS_DAS_REGRAS = 20;
/** A trava de UM lote de 100 negócios numa regra, já filtrada pela âncora mais antiga do lote. */
const PAGINAS_DA_TRAVA = 20;
/**
 * Folga do recorte da trava por `created_at`. O aviso de uma âncora nasce
 * DEPOIS dela (a âncora é um instante passado, gravado pelo banco, e o aviso só
 * sai N dias depois), então nenhum aviso que importa tem `created_at` antes da
 * âncora mais antiga do lote. Um dia a menos não muda a conta e cobre qualquer
 * diferença de relógio.
 */
const FOLGA_DO_RECORTE_MS = 86_400_000;

type AvisoAnterior = { entity_id: string; payload: unknown };

/** A mesma divisão dos crons irmãos: lotes de 50, teto por organização. */
function emLotes<T>(itens: T[], tamanho: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const admin = createAdminClient();
  const agora = new Date();

  // FORK MIA (MIA-369) — as regras INTEIRAS, página a página, na ordem de `id`.
  // Antes era uma leitura só, sem `range`: o PostgREST corta em 1000 linhas sem
  // avisar, e a regra que ficasse fora da página nunca disparava.
  const regras = await lerTodasAsPaginas<Regra>(
    (de, ate, pedirContagem) =>
      admin
        .from("automation_rules")
        .select("id, organization_id, trigger_event, trigger_config", pedirContagem ? { count: "exact" } : undefined)
        .in("trigger_event", [GATILHO_SILENCIO, GATILHO_ETAPA_PARADA])
        .eq("is_active", true)
        .order("id", { ascending: true })
        .range(de, ate),
    { paginasMaximas: PAGINAS_DAS_REGRAS },
  );

  if (regras.erro || regras.truncado) {
    logger.error("[lead-time-triggers] consulta de regras falhou", {
      error: regras.erro ?? `leitura cortada: mais de ${regras.linhas.length} regras`,
      requestId,
    });
    return fail("internal_error", "Falha ao buscar regras.", 500, { requestId });
  }

  const todasAsRegras = regras.linhas;
  if (todasAsRegras.length === 0) {
    return ok({ organizacoes: 0, regras: 0, examinados: 0, emitidos: 0, pulados: {} }, { requestId });
  }

  const orgsComRegra = [...new Set(todasAsRegras.map((r) => r.organization_id))];
  // FORK MIA (MIA-369) — TODAS as empresas com regra, em lotes de 100 (uma linha
  // por id, então cada lote cabe numa resposta). Antes só o primeiro lote era
  // lido: a 101ª empresa com regra de tempo ficava de fora calada.
  const organizacoes: Array<{ id: string }> = [];
  for (let i = 0; i < orgsComRegra.length; i += TAMANHO_DO_LOTE) {
    const { data: lote } = await admin
      .from("organizations")
      .select("id")
      .in("id", orgsComRegra.slice(i, i + TAMANHO_DO_LOTE));
    organizacoes.push(...((lote ?? []) as Array<{ id: string }>));
  }

  let emitidos = 0;
  let examinados = 0;
  const pulados: Record<string, number> = {};
  const pular = (motivo: string, quantos = 1) => {
    pulados[motivo] = (pulados[motivo] ?? 0) + quantos;
  };

  for (const organizacao of organizacoes) {
    const org = organizacao.id;

    for (const regra of todasAsRegras) {
      if (regra.organization_id !== org) continue;

      const ehSilencio = regra.trigger_event === GATILHO_SILENCIO;
      const silencio = ehSilencio ? configDoSilencio(regra.trigger_config) : null;
      const etapa = ehSilencio ? null : configDaEtapaParada(regra.trigger_config);
      if ((ehSilencio && !silencio) || (!ehSilencio && !etapa)) {
        // Linha torta (preenchida à mão, ou de antes de a tela existir) não
        // casa com nada e não impede as irmãs de rodar.
        pular("config_invalida");
        continue;
      }

      const candidatos: Candidato[] = [];

      // ═══ O TETO É O TAMANHO DA PÁGINA, NÃO O FIM DA VARREDURA (#1540) ═══
      //
      // `limit(TETO)` sem cursor varre os 200 mais ANTIGOS e para ali. Em 201
      // negócios abertos em silêncio, os 200 mais antigos voltam a ocupar a
      // janela a cada rodada como `ja_emitido`, e o mais novo nunca recebe o
      // evento: a regra está salva, o operador espera, e nada acontece — sem
      // erro e sem log. O cursor (`id > último`) anda página a página até o
      // fim do conjunto, e a ordem é por `id`, que é TOTAL: `created_at` empatado
      // (mesmo segundo, importação em lote) deixaria a página seguinte repetir
      // ou pular linha.
      //
      // Por que o corte não vai para o SQL no silêncio: a âncora é a última
      // MENSAGEM, que pode ser anterior ao próprio negócio (contato que já
      // falava antes de o card nascer). `created_at <= agora - N dias`
      // deixaria de fora justamente o contato que nunca respondeu. Na etapa
      // parada o corte JÁ está no SQL (`stage_changed_at <= corte`), porque
      // ali a âncora é a coluna filtrada.
      let falhouNaConsulta = false;

      if (silencio) {
        const coluna = colunaDaDirecao(silencio.direcao);
        let cursor: string | null = null;

        for (;;) {
          let consulta = admin
            .from("crm_leads")
            .select("id, contact_id, created_at")
            .eq("organization_id", org)
            .eq("status", "open")
            .not("contact_id", "is", null)
            .order("id", { ascending: true })
            .limit(TETO_POR_ORGANIZACAO);
          if (cursor) consulta = consulta.gt("id", cursor);
          if (silencio.pipeline_id) consulta = consulta.eq("pipeline_id", silencio.pipeline_id);

          const { data: leads, error } = await consulta;
          if (error) {
            logger.error("[lead-time-triggers] consulta de negócios falhou", {
              organization_id: org,
              rule_id: regra.id,
              error: error.message,
              requestId,
            });
            pular("consulta_falhou");
            falhouNaConsulta = true;
            break;
          }
          if (!leads?.length) break;

          const contatos = [...new Set(leads.map((l) => l.contact_id as string))];
          // As conversas da PÁGINA, não das páginas juntas: o `.in()` do
          // PostgREST é uma lista na URL, e junção de páginas num só `in()`
          // trocaria o teto por um URL que o banco recusa.
          const { data: conversas, error: erroConversas } = await admin
            .from("conversations")
            .select(`contact_id, ${coluna}`)
            .eq("organization_id", org)
            .in("contact_id", contatos)
            .limit(1_000);
          if (erroConversas) {
            pular("consulta_falhou");
            falhouNaConsulta = true;
            break;
          }

          // Um contato pode ter várias conversas: a âncora é a MAIS RECENTE delas.
          const ultimaPorContato = new Map<string, string>();
          for (const conversa of (conversas ?? []) as unknown as Array<Record<string, unknown>>) {
            const valor = conversa[coluna];
            if (typeof valor !== "string" || !valor) continue;
            const atual = ultimaPorContato.get(conversa.contact_id as string);
            if (!atual || valor > atual) ultimaPorContato.set(conversa.contact_id as string, valor);
          }

          for (const lead of leads) {
            const ancora = ancoraDoSilencio(
              ultimaPorContato.get(lead.contact_id as string) ?? null,
              lead.created_at as string,
              agora,
              silencio.dias,
            );
            if (ancora) candidatos.push({ leadId: lead.id as string, contactId: lead.contact_id as string, ancora });
          }

          if (leads.length < TETO_POR_ORGANIZACAO) break;
          cursor = leads[leads.length - 1]!.id as string;
        }
        if (falhouNaConsulta) continue;

        if (candidatos.length && silencio.proteger_pela_agenda) {
          const protecoes = await protecaoAgendaSupabase(
            admin,
            org,
            candidatos.map((c) => c.contactId!).filter(Boolean),
            agora,
          );
          let bloqueados = 0;
          for (const candidato of [...candidatos]) {
            const protecao = candidato.contactId ? protecoes.get(candidato.contactId) : undefined;
            if (protecao?.adiar) {
              bloqueados += 1;
              candidatos.splice(candidatos.indexOf(candidato), 1);
            }
          }
          if (bloqueados) pular("agenda", bloqueados);
        }
      } else if (etapa) {
        const corte = new Date(agora.getTime() - etapa.dias * 86_400_000).toISOString();
        let cursor: string | null = null;

        for (;;) {
          let consulta = admin
            .from("crm_leads")
            .select("id, contact_id, stage_changed_at")
            .eq("organization_id", org)
            .eq("status", "open")
            .not("stage_changed_at", "is", null)
            .lte("stage_changed_at", corte)
            .order("id", { ascending: true })
            .limit(TETO_POR_ORGANIZACAO);
          if (cursor) consulta = consulta.gt("id", cursor);
          if (etapa.pipeline_id) consulta = consulta.eq("pipeline_id", etapa.pipeline_id);
          if (etapa.stage_id) consulta = consulta.eq("stage_id", etapa.stage_id);

          const { data: leads, error } = await consulta;
          if (error) {
            logger.error("[lead-time-triggers] consulta de negócios falhou", {
              organization_id: org,
              rule_id: regra.id,
              error: error.message,
              requestId,
            });
            pular("consulta_falhou");
            falhouNaConsulta = true;
            break;
          }

          for (const lead of leads ?? []) {
            const ancora = ancoraDaEtapa(lead.stage_changed_at as string | null, agora, etapa.dias);
            if (ancora) candidatos.push({ leadId: lead.id as string, contactId: lead.contact_id as string | null, ancora });
          }

          if (!leads || leads.length < TETO_POR_ORGANIZACAO) break;
          cursor = leads[leads.length - 1]!.id as string;
        }
        if (falhouNaConsulta) continue;

        if (candidatos.length && etapa.proteger_pela_agenda) {
          const contatos = candidatos.map((c) => c.contactId).filter((c): c is string => Boolean(c));
          const protecoes = await protecaoAgendaSupabase(admin, org, contatos, agora);
          for (const candidato of [...candidatos]) {
            const protecao = candidato.contactId ? protecoes.get(candidato.contactId) : undefined;
            if (protecao?.adiar) {
              candidatos.splice(candidatos.indexOf(candidato), 1);
              pular("agenda");
            }
          }
        }
      }

      if (candidatos.length === 0) continue;
      examinados += candidatos.length;

      // Quem já disparou ESTA regra COM A MESMA ÂNCORA não dispara de novo.
      const jaEmitidos = new Set<string>();
      let travaIlegivel: string | null = null;
      for (const lote of emLotes(candidatos, TAMANHO_DO_LOTE)) {
        // FORK MIA (MIA-369) — FILTRADA e lida inteira. Antes era uma leitura
        // só, sem `range`, de todo aviso desta regra para os 100 negócios: um
        // aviso por negócio e ÂNCORA, que acumula a cada silêncio novo. Passou
        // de 1000, o aviso que ficava fora da página parecia não dado, e o
        // mesmo episódio disparava de novo.
        //
        // O filtro: só conta o aviso cuja âncora é a do candidato, e esse aviso
        // nasceu depois dela. Então o que tem `created_at` antes da âncora mais
        // antiga do lote (menos a folga) não pode travar ninguém e fica fora da
        // leitura (o índice `event_log_org_type_idx` cobre o recorte). O que
        // sobra, os episódios recentes, vem página a página.
        const maisAntiga = Math.min(...lote.map((c) => Date.parse(c.ancora)));
        const desde = new Date(maisAntiga - FOLGA_DO_RECORTE_MS).toISOString();
        const lidos = await lerTodasAsPaginas<AvisoAnterior>(
          (de, ate, pedirContagem) =>
            admin
              .from("event_log")
              .select("entity_id, payload", pedirContagem ? { count: "exact" } : undefined)
              .eq("organization_id", org)
              .eq("event_type", regra.trigger_event)
              .eq("payload->>rule_id", regra.id)
              .in("entity_id", lote.map((c) => c.leadId))
              .gte("created_at", desde)
              .order("id", { ascending: true })
              .range(de, ate),
          { paginasMaximas: PAGINAS_DA_TRAVA },
        );
        // Trava ilegível ou cortada não é trava vazia: a regra fica de fora
        // desta rodada (falha fechada) em vez de repetir o episódio.
        if (lidos.erro || lidos.truncado) {
          travaIlegivel = lidos.erro ?? `leitura cortada: mais de ${lidos.linhas.length} avisos num lote`;
          break;
        }
        for (const anterior of lidos.linhas) {
          const payload = anterior.payload as { ancora?: unknown } | null;
          if (typeof payload?.ancora !== "string" || !payload.ancora) continue;
          jaEmitidos.add(chaveDeDisparoTemporal(regra.id, anterior.entity_id as string, payload.ancora));
        }
      }

      if (travaIlegivel) {
        logger.error("[lead-time-triggers] leitura da trava falhou", {
          organization_id: org,
          rule_id: regra.id,
          error: travaIlegivel,
          requestId,
        });
        pular("trava_ilegivel", candidatos.length);
        continue;
      }

      const novos = naoDisparadosTemporais(candidatos, jaEmitidos, regra.id);
      if (novos.length < candidatos.length) pular("ja_emitido", candidatos.length - novos.length);

      for (const candidato of novos) {
        const { error: erroEvento } = await admin.rpc("emit_event" as never, {
          p_event_type: regra.trigger_event,
          p_entity_kind: "crm_lead",
          p_entity_id: candidato.leadId,
          // `rule_id` faz o evento valer só para a regra que o pediu; `ancora`
          // é a trava — a varredura seguinte lê os dois do `event_log`.
          p_payload: {
            rule_id: regra.id,
            dias: silencio?.dias ?? etapa?.dias ?? null,
            ancora: candidato.ancora,
            ...(silencio
              ? { direcao: silencio.direcao, silencio_desde: candidato.ancora }
              : { etapa_desde: candidato.ancora }),
          },
          p_metadata: { actor_kind: "system", source: "cron/lead-time-triggers" },
          p_organization_id: org,
        });
        if (erroEvento) {
          logger.error("[lead-time-triggers] emit_event falhou", {
            organization_id: org,
            rule_id: regra.id,
            lead_id: candidato.leadId,
            error: erroEvento.message,
            requestId,
          });
          pular("emissao_falhou");
          continue;
        }
        emitidos += 1;
      }
    }
  }

  // Rodada que não emitiu NÃO é mutação e não audita — a lei está no CLAUDE.md
  // §Audit log (`cron-audita-so-quando-ha-efeito` varre as rotas deste dir).
  if (emitidos > 0) {
    await audit({
      action: "lead.gatilho_de_tempo_emitido",
      resourceType: "automation_rule",
      metadata: { emitidos, examinados, pulados },
      requestId,
    });
  }

  return ok(
    {
      organizacoes: organizacoes.length,
      regras: todasAsRegras.length,
      examinados,
      emitidos,
      pulados,
    },
    { requestId },
  );
}

export const GET = handle;
export const POST = handle;
