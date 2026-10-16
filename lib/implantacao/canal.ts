/**
 * FORK MIA — os AJUSTES DE UMA CONEXÃO (número de WhatsApp) de um cliente que
 * chegaram do upstream 1.74 a 1.80: os dias da prospecção, guardar o histórico
 * do número e a pausa agendada.
 *
 * ── O que esta operação NUNCA toca ────────────────────────────────────────
 *
 * Credencial, token, número de telefone, nome da sessão e o pareamento da
 * conexão: conectar e reconectar é com a pessoa do cliente, na tela Conexões. O
 * ritmo de envio (intervalos, janelas, teto diário, aquecimento) também fica na
 * tela: aqui só entram os três ajustes de baixo, cada um pela gravação da tela.
 *
 * ── O caminho da tela que cada ajuste espelha ─────────────────────────────
 *
 *   dias da prospecção  `PUT /api/v1/ai/pacing` (Conexões › Proteção de envio,
 *                       0642): `pacingKnobsUpdateSchema`, a janela RESULTANTE
 *                       conferida (`effectiveKnobs`, `windowIsValid`), o upsert
 *                       em `channel_knobs` e a auditoria `ai.pacing_knobs_updated`.
 *                       Só a prospecção lê estes dias; resposta, disparo em
 *                       massa e retomada seguem a janela do número.
 *   guardar histórico   `PATCH /api/v1/channel-sessions/[id]/acervo` (#999):
 *                       `salvarAcervoDoCanal`, a mesma função, que grava a
 *                       opção em `channel_sessions.metadata` e tenta aplicá-la
 *                       na sessão do transporte; a auditoria `channel.acervo_updated`.
 *                       Só existe para número conectado por QR Code.
 *   pausa agendada      `POST /api/v1/channel-schedules` e `DELETE .../[id]`
 *                       (#2388, 0626): a janela de manutenção, com as mesmas
 *                       recusas (no futuro, fim depois do início, até 24 horas),
 *                       gravada em `channel_schedules`; quem pausa e retoma é o
 *                       cron `channel-pause-scheduler`, como na tela.
 *
 * ── O que é diferente da tela, e por quê ──────────────────────────────────
 *
 * 1. Só o que veio muda, e o que veio igual responde `ja_estava`. A pausa
 *    agendada igual a uma que já está marcada (mesmo número, mesmo início, mesmo
 *    fim) não é marcada de novo.
 * 2. DESLIGAR o histórico de um número que o guarda pede confirmação escrita: a
 *    tela avisa que isso pode apagar o que o canal já guardou, e aqui o aviso é a
 *    recusa que pede `confirmo_apagar_historico_guardado: true`.
 * 3. A hora da pausa pode vir sem fuso ("2026-10-20T23:00"): vale o fuso da
 *    empresa, como na tela (que monta o instante com o fuso do banco).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { instanteDe } from "@/lib/agenda/fuso";
import { effectiveKnobs, pacingKnobsUpdateSchema, windowIsValid, type ChannelKnobsRow } from "@/lib/ai/pacing-knobs";
import { lerGuardarHistorico, salvarAcervoDoCanal } from "@/lib/channels/acervo-do-historico";
import { nomeDoCanal } from "@/lib/channels/estado";
import { conexaoGuardaHistorico } from "@/lib/channels/conexao-guarda-historico";
import { Recusa } from "@/lib/mcp-plataforma/recusa";

import { chaveDoNome, type Desfecho, type Implantacao } from "./base";

/** Todos os dias: o padrão da coluna (0642) para a conexão que nunca escolheu. */
export const TODOS_OS_DIAS = [0, 1, 2, 3, 4, 5, 6] as const;

/** Uma janela de manutenção não vira plano: acima de 24h é outra coisa (a régua da rota). */
const DURACAO_MAXIMA_MS = 24 * 60 * 60 * 1000;

const COLUNAS_DO_CANAL = "id, display_name, phone_number, status, provider, metadata, archived_at";

const COLUNAS_DOS_AJUSTES =
  "channel_session_id, throttle_ms, jitter_max_ms, window_start_hour, window_end_hour, resposta_start_hour, resposta_end_hour, allow_sunday, prospeccao_dias, timezone, warmup_daily_caps, number_activated_at, atraso_notar_ms, ms_por_caractere, atraso_minimo_ms, atraso_maximo_ms";

export interface CanalDaEmpresa {
  id: string;
  display_name: string | null;
  phone_number: string | null;
  status: string | null;
  provider: string | null;
  metadata: Record<string, unknown> | null;
}

export interface PedidoDeCanal {
  /** Id, nome ou telefone da conexão. */
  canal?: string;
  dias_da_prospeccao?: number[];
  guardar_historico?: boolean;
  confirmo_apagar_historico_guardado?: boolean;
  pausa_agendada?: { inicio: string; fim: string; todos_os_numeros?: boolean };
  cancelar_pausa_agendada?: string;
  /**
   * .81 — o NOME INTERNO da conexão (upstream 1.81, `PATCH /channel-sessions/[id]/name`):
   * só a equipe vê; o nome público no provedor não muda.
   */
  nome_interno?: string;
  /**
   * .81 — corrigir os horários de uma pausa agendada que AINDA NÃO começou
   * (upstream 1.81, `PATCH /channel-schedules/[id]`): os dois horários, com a
   * mesma régua de criar.
   */
  ajustar_pausa_agendada?: { id: string; inicio: string; fim: string };
}

export interface AgendaDePausaLida {
  id: string;
  /** O id da conexão; `null` quando a janela é de todos os números. */
  numero_id: string | null;
  numero: string | null;
  todos_os_numeros: boolean;
  inicio: string;
  fim: string;
  situacao: string;
}

export async function lerCanais(admin: SupabaseClient, orgId: string): Promise<CanalDaEmpresa[]> {
  const { data, error } = await admin
    .from("channel_sessions")
    .select(COLUNAS_DO_CANAL)
    .eq("organization_id", orgId)
    .is("archived_at", null);
  if (error) throw new Error(`não consegui ler as conexões: ${error.message}`);
  return (data ?? []) as unknown as CanalDaEmpresa[];
}

function soDigitos(texto: string): string {
  return texto.replace(/\D/g, "");
}

/** A conexão por id, nome ou telefone, ou a recusa que diz quais existem. */
export function acharCanal(canais: CanalDaEmpresa[], referencia: string): CanalDaEmpresa {
  const ref = referencia.trim();
  const porId = canais.find((x) => x.id === ref);
  if (porId) return porId;
  const digitos = soDigitos(ref);
  const candidatos = canais.filter(
    (x) =>
      chaveDoNome(nomeDoCanal(x)) === chaveDoNome(ref) ||
      (x.display_name !== null && chaveDoNome(x.display_name) === chaveDoNome(ref)) ||
      (digitos.length >= 8 && x.phone_number !== null && soDigitos(x.phone_number).endsWith(digitos.slice(-8))),
  );
  if (candidatos.length === 1) return candidatos[0]!;
  const lista = canais.map((x) => `«${nomeDoCanal(x)}»${x.phone_number ? ` (${x.phone_number})` : ""} id ${x.id}`);
  throw new Recusa(
    candidatos.length > 1
      ? `Mais de uma conexão casa com «${ref}». Informe o id: ${lista.join("; ")}.`
      : canais.length === 0
        ? "Esta organização ainda não tem conexão de WhatsApp. Conectar o número é com uma pessoa, em Conexões (/app/connections)."
        : `Não achei a conexão «${ref}». As conexões são: ${lista.join("; ")}.`,
  );
}

/** Os dias da prospecção como o motor os lê: os gravados, ou todos (o padrão da 0642). */
export function diasDaProspeccaoDe(linha: { prospeccao_dias?: number[] | null } | null | undefined): number[] {
  const dias = linha?.prospeccao_dias;
  if (!Array.isArray(dias) || dias.length === 0) return [...TODOS_OS_DIAS];
  return [...new Set(dias.map(Number))].sort((a, b) => a - b);
}

export async function lerAjustesDosCanais(admin: SupabaseClient, orgId: string): Promise<Map<string, ChannelKnobsRow>> {
  const { data, error } = await admin.from("channel_knobs").select(COLUNAS_DOS_AJUSTES).eq("organization_id", orgId);
  if (error) throw new Error(`não consegui ler os ajustes das conexões: ${error.message}`);
  return new Map(
    ((data ?? []) as unknown as Array<ChannelKnobsRow & { channel_session_id: string }>).map((k) => [k.channel_session_id, k]),
  );
}

export async function lerPausasAgendadas(admin: SupabaseClient, orgId: string, canais: CanalDaEmpresa[]): Promise<AgendaDePausaLida[]> {
  const { data, error } = await admin
    .from("channel_schedules")
    .select("id, channel_session_id, starts_at, ends_at, status")
    .eq("organization_id", orgId)
    .in("status", ["scheduled", "running"])
    .order("starts_at", { ascending: true });
  if (error) throw new Error(`não consegui ler as pausas agendadas: ${error.message}`);
  return ((data ?? []) as Array<{ id: string; channel_session_id: string | null; starts_at: string; ends_at: string; status: string }>).map((a) => {
    const canal = a.channel_session_id ? canais.find((x) => x.id === a.channel_session_id) : null;
    return {
      id: a.id,
      numero_id: a.channel_session_id,
      numero: canal ? nomeDoCanal(canal) : a.channel_session_id,
      todos_os_numeros: a.channel_session_id === null,
      inicio: a.starts_at,
      fim: a.ends_at,
      situacao: a.status === "running" ? "pausando agora" : "marcada",
    };
  });
}

const HORA_SEM_FUSO = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

/** O instante pedido: com fuso, vale o que veio; sem fuso, a hora de parede no fuso da empresa. */
export function instanteDaPausa(texto: string, fusoDaEmpresa: string, campo: string): Date {
  const t = texto.trim();
  const parede = HORA_SEM_FUSO.exec(t);
  const instante = parede
    ? instanteDe(
        {
          ano: Number(parede[1]),
          mes: Number(parede[2]),
          dia: Number(parede[3]),
          hora: Number(parede[4]),
          minuto: Number(parede[5]),
          segundo: parede[6] ? Number(parede[6]) : 0,
        },
        fusoDaEmpresa,
      )
    : new Date(t);
  if (Number.isNaN(instante.getTime())) {
    throw new Recusa(
      `\`${campo}\` não é uma data e hora válida ("${texto}"). Use "AAAA-MM-DDTHH:MM" na hora da empresa (${fusoDaEmpresa}), ex.: "2026-10-20T23:00", ou com o fuso, ex.: "2026-10-20T23:00:00-03:00".`,
    );
  }
  return instante;
}

export interface CanalConfigurado {
  canal: { id: string; nome: string } | null;
  desfecho: Desfecho;
  mudancas: string[];
  dias_da_prospeccao?: number[];
  guardar_historico?: { ligado: boolean; aplicado_na_conexao: boolean | null };
  pausa_agendada?: AgendaDePausaLida & { desfecho: Desfecho };
  pausa_cancelada?: { id: string; desfecho: "atualizou" | "ja_estava" };
  pausa_ajustada?: { id: string; inicio: string; fim: string; desfecho: "atualizou" | "ja_estava" };
  nome_interno?: { nome: string; desfecho: "atualizou" | "ja_estava" };
  avisos: string[];
}

export async function configurarCanal(c: Implantacao, fusoDaEmpresa: string, pedido: PedidoDeCanal): Promise<CanalConfigurado> {
  const avisos: string[] = [];
  const mudancas: string[] = [];
  const canais = await lerCanais(c.admin, c.orgId);
  const precisaDoCanal =
    pedido.dias_da_prospeccao !== undefined ||
    pedido.guardar_historico !== undefined ||
    pedido.nome_interno !== undefined ||
    (pedido.pausa_agendada !== undefined && pedido.pausa_agendada.todos_os_numeros !== true);
  if (precisaDoCanal && !pedido.canal) {
    throw new Recusa(
      "Informe `canal`: o id, o nome ou o telefone da conexão. " +
        (canais.length > 0
          ? `As conexões são: ${canais.map((x) => `«${nomeDoCanal(x)}»${x.phone_number ? ` (${x.phone_number})` : ""}`).join("; ")}.`
          : "Esta organização ainda não tem conexão: conectar é com uma pessoa, em Conexões (/app/connections)."),
    );
  }
  const canal = pedido.canal ? acharCanal(canais, pedido.canal) : null;
  const r: CanalConfigurado = {
    canal: canal ? { id: canal.id, nome: nomeDoCanal(canal) } : null,
    desfecho: "ja_estava",
    mudancas,
    avisos,
  };

  // ── o nome interno: o caminho de `PATCH /api/v1/channel-sessions/[id]/name` (.81) ──
  if (pedido.nome_interno !== undefined && canal) {
    const nome = pedido.nome_interno.trim();
    if (nome.length < 1 || nome.length > 80) {
      throw new Recusa("Informe um nome interno com até 80 caracteres. Ex.: \"WA | Recepção\". Só a equipe vê; o nome público no provedor não muda.");
    }
    const anterior = canal.display_name;
    if (anterior === nome) {
      r.nome_interno = { nome, desfecho: "ja_estava" };
    } else {
      const { data, error } = await c.admin
        .from("channel_sessions")
        .update({ display_name: nome })
        .eq("organization_id", c.orgId)
        .eq("id", canal.id)
        .is("archived_at", null)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(`não consegui salvar o nome da conexão: ${error.message}`);
      if (!data) throw new Recusa("A conexão foi arquivada ou não existe mais nesta organização.");
      void audit({
        action: "channel.renamed",
        actorUserId: c.autorUserId,
        organizationId: c.orgId,
        resourceType: "channel_session",
        resourceId: canal.id,
        requestId: c.requestId,
        metadata: { previous_display_name: anterior, display_name: nome, via: "mcp_plataforma" },
      });
      mudancas.push("nome interno");
      r.nome_interno = { nome, desfecho: "atualizou" };
      r.canal = { id: canal.id, nome };
    }
  }

  // ── os dias da prospecção: o caminho de `PUT /api/v1/ai/pacing` ──────────
  if (pedido.dias_da_prospeccao !== undefined && canal) {
    const conferido = pacingKnobsUpdateSchema.safeParse({ channel_session_id: canal.id, prospeccao_dias: pedido.dias_da_prospeccao });
    if (!conferido.success) {
      throw new Recusa("`dias_da_prospeccao` é uma lista de 1 a 7 dias, de 0 (domingo) a 6 (sábado). Ex.: [1, 2, 3, 4, 5] para segunda a sexta.");
    }
    const dias = [...new Set(conferido.data.prospeccao_dias ?? [])].sort((a, b) => a - b);
    const { data: atual, error } = await c.admin
      .from("channel_knobs")
      .select(COLUNAS_DOS_AJUSTES)
      .eq("organization_id", c.orgId)
      .eq("channel_session_id", canal.id)
      .maybeSingle();
    if (error) throw new Error(`não consegui ler os ajustes da conexão: ${error.message}`);
    const linha = (atual as unknown as ChannelKnobsRow | null) ?? null;
    const atuais = diasDaProspeccaoDe(linha);
    r.dias_da_prospeccao = dias;
    if (atuais.join(",") !== dias.join(",")) {
      // A janela RESULTANTE, como a rota confere antes de gravar qualquer campo.
      const mesclado: ChannelKnobsRow = {
        ...(linha ?? {
          throttle_ms: null,
          jitter_max_ms: null,
          window_start_hour: null,
          window_end_hour: null,
          resposta_start_hour: null,
          resposta_end_hour: null,
          atraso_notar_ms: null,
          ms_por_caractere: null,
          atraso_minimo_ms: null,
          atraso_maximo_ms: null,
          allow_sunday: null,
          prospeccao_dias: null,
          timezone: null,
          warmup_daily_caps: null,
        }),
        prospeccao_dias: dias,
      };
      const efetivo = effectiveKnobs(mesclado);
      if (!windowIsValid(efetivo.windowStartHour, efetivo.windowEndHour) || !windowIsValid(efetivo.respostaStartHour, efetivo.respostaEndHour)) {
        throw new Recusa(
          "A janela de envio gravada nesta conexão está invertida (o início depois do fim), e a tela recusa qualquer ajuste até ela ser corrigida. " +
            "Uma pessoa corrige em Conexões › Proteção de envio (/app/connections), e depois chame de novo.",
        );
      }
      const { error: erroAoGravar } = await c.admin
        .from("channel_knobs")
        .upsert({ organization_id: c.orgId, channel_session_id: canal.id, prospeccao_dias: dias }, { onConflict: "organization_id,channel_session_id" });
      if (erroAoGravar) throw new Error(`não consegui gravar os dias da prospecção: ${erroAoGravar.message}`);
      void audit({
        action: "ai.pacing_knobs_updated",
        actorUserId: c.autorUserId,
        organizationId: c.orgId,
        resourceType: "channel_knobs",
        resourceId: canal.id,
        requestId: c.requestId,
        metadata: { prospeccao_dias: dias, daily_message_limit: null, turnos_reprogramados: 0, via: "mcp_plataforma" },
      });
      mudancas.push("dias da prospecção");
      avisos.push(
        "Os dias valem só para a PRIMEIRA abordagem da prospecção, dentro da janela de disparo do número: fora do dia marcado o envio espera a próxima abertura, sem gastar o limite do dia. " +
          "Resposta a quem escreveu, disparo em massa e retomada seguem a janela do número.",
      );
    }
  }

  // ── guardar o histórico: o caminho de `PATCH .../acervo` ─────────────────
  if (pedido.guardar_historico !== undefined && canal) {
    if (!conexaoGuardaHistorico(canal.provider)) {
      throw new Recusa(
        `A conexão «${nomeDoCanal(canal)}» não é um número conectado por QR Code, e guardar o histórico só existe para esse tipo de conexão (é o transporte do QR que guarda). ` +
          "O número oficial e as redes sociais não têm esta opção.",
      );
    }
    const atual = lerGuardarHistorico(canal.metadata);
    if (atual !== pedido.guardar_historico) {
      if (!pedido.guardar_historico && pedido.confirmo_apagar_historico_guardado !== true) {
        throw new Recusa(
          `A conexão «${nomeDoCanal(canal)}» guarda o histórico do número, e DESLIGAR num número já pareado pode apagar o que o canal já guardou (a tela avisa o mesmo). ` +
            "Se é isso mesmo, chame de novo com `confirmo_apagar_historico_guardado: true`.",
        );
      }
      const salvo = await salvarAcervoDoCanal(c.admin, c.orgId, canal.id, pedido.guardar_historico);
      if (!salvo) throw new Recusa(`A conexão «${nomeDoCanal(canal)}» não existe mais nesta organização. Confira em plataforma_ver_configuracao, seção canais.`);
      void audit({
        action: "channel.acervo_updated",
        actorUserId: c.autorUserId,
        organizationId: c.orgId,
        resourceType: "channel_session",
        resourceId: canal.id,
        requestId: c.requestId,
        metadata: { guardar_historico: salvo.guardar_historico, aplicado: salvo.aplicado, via: "mcp_plataforma" },
      });
      mudancas.push("guardar o histórico");
      r.guardar_historico = { ligado: salvo.guardar_historico, aplicado_na_conexao: salvo.aplicado };
      if (salvo.guardar_historico) {
        avisos.push(
          "Guardar o histórico ficou LIGADO. O histórico anterior (cerca de 1 ano) só vem quando a opção está ligada NA vinculação; num número já pareado, guarda daqui em diante, e a conexão reinicia por alguns segundos. " +
            "O histórico fica no servidor do canal, fora do alcance da anonimização do CRM, e não aparece no inbox.",
        );
      }
      if (!salvo.aplicado) {
        avisos.push("A opção ficou salva, mas a conexão não respondeu agora: ela vale na próxima subida da sessão.");
      }
    } else {
      r.guardar_historico = { ligado: atual, aplicado_na_conexao: null };
    }
  }

  // ── a pausa agendada: o caminho de `POST /api/v1/channel-schedules` ──────
  if (pedido.pausa_agendada !== undefined) {
    const todos = pedido.pausa_agendada.todos_os_numeros === true;
    if (todos && canais.length === 0) {
      throw new Recusa("Esta organização não tem conexão para pausar. Conectar é com uma pessoa, em Conexões (/app/connections).");
    }
    const inicio = instanteDaPausa(pedido.pausa_agendada.inicio, fusoDaEmpresa, "pausa_agendada.inicio");
    const fim = instanteDaPausa(pedido.pausa_agendada.fim, fusoDaEmpresa, "pausa_agendada.fim");
    if (fim.getTime() <= inicio.getTime()) {
      throw new Recusa("A janela termina antes de começar: escolha um fim depois do início.");
    }
    if (fim.getTime() - inicio.getTime() > DURACAO_MAXIMA_MS) {
      throw new Recusa(
        "A janela de manutenção não pode durar mais de 24h: para uma pausa longa, uma pessoa faz a pausa manual em Conexões e desfaz quando voltar.",
      );
    }
    if (inicio.getTime() <= Date.now()) {
      throw new Recusa(
        "A janela precisa começar no futuro. Para pausar agora, uma pessoa usa a pausa manual em Conexões: a pausa agendada é para a janela de manutenção.",
      );
    }
    const canalDaPausa = todos ? null : canal!.id;
    const { data: vivas, error } = await c.admin
      .from("channel_schedules")
      .select("id, channel_session_id, starts_at, ends_at, status")
      .eq("organization_id", c.orgId)
      .in("status", ["scheduled", "running"]);
    if (error) throw new Error(`não consegui ler as pausas agendadas: ${error.message}`);
    const igual = ((vivas ?? []) as Array<{ id: string; channel_session_id: string | null; starts_at: string; ends_at: string; status: string }>).find(
      (a) =>
        (a.channel_session_id ?? null) === canalDaPausa &&
        new Date(a.starts_at).getTime() === inicio.getTime() &&
        new Date(a.ends_at).getTime() === fim.getTime(),
    );
    const retrato = (id: string, situacao: string): AgendaDePausaLida => ({
      id,
      numero_id: canalDaPausa,
      numero: todos ? null : nomeDoCanal(canal!),
      todos_os_numeros: todos,
      inicio: inicio.toISOString(),
      fim: fim.toISOString(),
      situacao: situacao === "running" ? "pausando agora" : "marcada",
    });
    if (igual) {
      r.pausa_agendada = { ...retrato(igual.id, igual.status), desfecho: "ja_estava" };
    } else {
      const { data: criada, error: erroAoCriar } = await c.admin
        .from("channel_schedules")
        .insert({
          organization_id: c.orgId,
          channel_session_id: canalDaPausa,
          starts_at: inicio.toISOString(),
          ends_at: fim.toISOString(),
          status: "scheduled",
          created_by: c.autorUserId,
        })
        .select("id, status")
        .maybeSingle();
      if (erroAoCriar || !criada) throw new Error(`não consegui marcar a pausa: ${erroAoCriar?.message ?? "sem linha"}`);
      const linha = criada as { id: string; status: string };
      void audit({
        action: "channel.schedule_created",
        actorUserId: c.autorUserId,
        organizationId: c.orgId,
        resourceType: "channel_schedule",
        resourceId: linha.id,
        requestId: c.requestId,
        metadata: { starts_at: inicio.toISOString(), ends_at: fim.toISOString(), channel_session_id: canalDaPausa, via: "mcp_plataforma" },
      });
      mudancas.push("pausa agendada");
      r.pausa_agendada = { ...retrato(linha.id, linha.status), desfecho: "criou" };
      avisos.push(
        `Na janela marcada ${todos ? "TODOS os números ficam pausados" : "o número fica pausado"}: o que chega é guardado e volta à fila na retomada, e nada sai por ${todos ? "eles" : "ele"} ` +
          "(nem resposta da IA, nem follow-up, nem automação). Quem pausa e retoma é o sistema, no início e no fim. Cancelar: `cancelar_pausa_agendada` com o id.",
      );
    }
  }

  // ── cancelar uma pausa agendada: o caminho de `DELETE .../[id]` ──────────
  if (pedido.cancelar_pausa_agendada !== undefined) {
    const id = pedido.cancelar_pausa_agendada.trim();
    const { data: agenda, error } = await c.admin
      .from("channel_schedules")
      .select("id, status")
      .eq("organization_id", c.orgId)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`não consegui ler a pausa agendada: ${error.message}`);
    if (!agenda) {
      throw new Recusa(`Não existe pausa agendada com o id ${id} nesta organização. As marcadas estão em plataforma_ver_configuracao, seção canais.`);
    }
    const status = (agenda as { status: string }).status;
    if (status === "done") throw new Recusa("Esta janela já terminou: cancelar não desfaz o que ela fez.");
    if (status === "cancelled") {
      r.pausa_cancelada = { id, desfecho: "ja_estava" };
    } else {
      const { data, error: erroAoCancelar } = await c.admin
        .from("channel_schedules")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("organization_id", c.orgId)
        .eq("id", id)
        .in("status", ["scheduled", "running"])
        .select("id");
      if (erroAoCancelar) throw new Error(`não consegui cancelar a pausa: ${erroAoCancelar.message}`);
      const mudou = ((data ?? []) as unknown[]).length > 0;
      if (mudou) {
        void audit({
          action: "channel.schedule_cancelled",
          actorUserId: c.autorUserId,
          organizationId: c.orgId,
          resourceType: "channel_schedule",
          resourceId: id,
          requestId: c.requestId,
          metadata: { status_anterior: status, via: "mcp_plataforma" },
        });
        mudancas.push("pausa cancelada");
        if (status === "running") {
          avisos.push(
            "A janela estava pausando: cancelar tira a retomada automática, e o que ela já pausou continua pausado. Uma pessoa retoma pela pausa manual em Conexões.",
          );
        }
      }
      r.pausa_cancelada = { id, desfecho: mudou ? "atualizou" : "ja_estava" };
    }
  }

  // ── ajustar uma pausa agendada: o caminho de `PATCH .../[id]` (.81) ──────
  if (pedido.ajustar_pausa_agendada !== undefined) {
    const id = pedido.ajustar_pausa_agendada.id.trim();
    const inicio = instanteDaPausa(pedido.ajustar_pausa_agendada.inicio, fusoDaEmpresa, "ajustar_pausa_agendada.inicio");
    const fim = instanteDaPausa(pedido.ajustar_pausa_agendada.fim, fusoDaEmpresa, "ajustar_pausa_agendada.fim");
    const recusa = recusaDaJanela(inicio, fim);
    if (recusa) throw new Recusa(recusa);
    const { data: agenda, error } = await c.admin
      .from("channel_schedules")
      .select("id, status, starts_at, ends_at")
      .eq("organization_id", c.orgId)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`não consegui ler a pausa agendada: ${error.message}`);
    if (!agenda) {
      throw new Recusa(`Não existe pausa agendada com o id ${id} nesta organização. As marcadas estão em plataforma_ver_configuracao, seção canais.`);
    }
    const linha = agenda as { status: string; starts_at: string; ends_at: string };
    if (linha.status !== "scheduled") {
      throw new Recusa(
        "Só dá para ajustar uma pausa que ainda não começou: uma em andamento já pausou conexões, e uma encerrada ou cancelada é passado.",
      );
    }
    if (
      new Date(linha.starts_at).getTime() === inicio.getTime() &&
      new Date(linha.ends_at).getTime() === fim.getTime()
    ) {
      r.pausa_ajustada = { id, inicio: inicio.toISOString(), fim: fim.toISOString(), desfecho: "ja_estava" };
    } else {
      // O filtro de status é a trava contra a corrida com o relógio (a janela
      // que abriu agora vira `running`), como na rota.
      const { data, error: erroAoAjustar } = await c.admin
        .from("channel_schedules")
        .update({ starts_at: inicio.toISOString(), ends_at: fim.toISOString(), updated_at: new Date().toISOString() })
        .eq("organization_id", c.orgId)
        .eq("id", id)
        .eq("status", "scheduled")
        .select("id");
      if (erroAoAjustar) throw new Error(`não consegui ajustar a pausa: ${erroAoAjustar.message}`);
      if (((data ?? []) as unknown[]).length === 0) {
        throw new Recusa("A pausa mudou de estado enquanto era ajustada (a janela abriu). Leia de novo em plataforma_ver_configuracao, seção canais.");
      }
      void audit({
        action: "channel.schedule_updated",
        actorUserId: c.autorUserId,
        organizationId: c.orgId,
        resourceType: "channel_schedule",
        resourceId: id,
        requestId: c.requestId,
        metadata: { starts_at: inicio.toISOString(), ends_at: fim.toISOString(), via: "mcp_plataforma" },
      });
      mudancas.push("pausa ajustada");
      r.pausa_ajustada = { id, inicio: inicio.toISOString(), fim: fim.toISOString(), desfecho: "atualizou" };
    }
  }

  r.desfecho = mudancas.length > 0 ? "atualizou" : "ja_estava";
  return r;
}

/**
 * A régua da janela, a mesma de `validarJanela` da rota do upstream (1.81: criar
 * e EDITAR recusam o mesmo), com a frase que diz ao implantador o que fazer.
 */
function recusaDaJanela(inicio: Date, fim: Date): string | null {
  if (fim.getTime() <= inicio.getTime()) return "A janela termina antes de começar: escolha um fim depois do início.";
  if (fim.getTime() - inicio.getTime() > DURACAO_MAXIMA_MS) {
    return "A janela de manutenção não pode durar mais de 24h: para uma pausa longa, uma pessoa faz a pausa manual em Conexões e desfaz quando voltar.";
  }
  if (inicio.getTime() <= Date.now()) {
    return "A janela precisa começar no futuro. Para pausar agora, uma pessoa usa a pausa manual em Conexões: a pausa agendada é para a janela de manutenção.";
  }
  return null;
}
