/**
 * FORK MIA — a AGENDA de um cliente: os tipos de agendamento e a jornada de
 * quem atende.
 *
 * ── O caminho da tela que isto reusa ──────────────────────────────────────
 *
 *   tipo novo       o contrato de `POST /api/v1/agenda/tipos` (`criarSchema`,
 *                   `slugDe`, em `lib/agenda/tipos-de-agendamento.ts`)
 *   alterar tipo    o contrato do `PATCH` da mesma rota (`alterarSchema`): só
 *                   o campo que veio muda, e o slug nunca muda
 *   jornada         `availabilityPatchSchema`, o de
 *                   `PATCH /api/v1/attendants/availability/[user_id]`: a agenda
 *                   da pessoa, em janelas por dia da semana, com o fuso
 *
 * ── O que fica na tela, e por quê ─────────────────────────────────────────
 *
 *  - os PRAZOS da agenda (confirmação, proteção, expiração do pedido): a
 *    função do banco que os grava exige uma pessoa logada e com a verificação
 *    em duas etapas provada na sessão. Um token não tem sessão.
 *  - a conta Google ou Microsoft de quem atende: é acesso, não configuração.
 *  - o tipo "Microsoft Teams": depende da conta Microsoft conectada.
 *  - desativar e reativar um tipo: têm rota própria e trilha própria na tela.
 *
 * ── O lembrete é outra operação ───────────────────────────────────────────
 *
 * Ligar o lembrete de um tipo faz o sistema mandar mensagem no WhatsApp de quem
 * tem horário marcado. É pôr no ar algo que fala com o cliente final, e por
 * isso não entra em "garantir tipos": tem função própria (`ligarLembrete`) e
 * ferramenta própria, que exige a operação de pôr no ar. O tipo nasce com o
 * lembrete desligado, como na tela.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { alterarSchema, criarSchema, slugDe } from "@/lib/agenda/tipos-de-agendamento";
import { audit } from "@/lib/audit";
import { Recusa } from "@/lib/mcp-plataforma/recusa";
import { availabilityPatchSchema } from "@/lib/schemas/routing";

import { chaveDoNome, mesmoConteudo, type Desfecho, type Implantacao } from "./base";
import { acharMembro, lerMembros } from "./equipe";

/** Quantos tipos de agendamento uma chamada aceita. */
export const TETO_DE_TIPOS = 30;

export interface TipoPedido {
  nome: string;
  categoria: string;
  duracao_minutos: number;
  local: string;
  descricao?: string | null;
  detalhes_do_local?: string | null;
  /** E-mail de uma pessoa da equipe: quem atende este tipo por padrão. */
  responsavel_padrao?: string | null;
  exige_confirmacao?: boolean;
  folga_antes_minutos?: number;
  folga_depois_minutos?: number;
  antecedencia_minima_minutos?: number;
  janela_de_agendamento_dias?: number;
  preco_padrao_cents?: number | null;
}

const COLUNAS_DO_TIPO =
  "id, name, slug, description, category, duration_minutes, location_kind, location_details, requires_confirmation, is_active, default_owner_user_id, buffer_before_minutes, buffer_after_minutes, minimum_notice_minutes, booking_window_days, reminder_enabled, reminder_minutes_before, reminder_extra_offsets_minutes, reminder_body, default_price_cents";

export async function lerTipos(admin: SupabaseClient, orgId: string): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await admin
    .from("calendar_event_types")
    .select(COLUNAS_DO_TIPO)
    .eq("organization_id", orgId)
    .order("name");
  if (error) throw new Error(`não consegui ler os tipos de agendamento: ${error.message}`);
  return (data ?? []) as unknown as Array<Record<string, unknown>>;
}

const ROTULO_DO_CAMPO: Record<string, string> = {
  name: "nome",
  category: "categoria",
  duration_minutes: "duração",
  location_kind: "local",
  description: "descrição",
  location_details: "detalhes do local",
  default_owner_user_id: "responsável padrão",
  requires_confirmation: "exige confirmação",
  buffer_before_minutes: "folga antes",
  buffer_after_minutes: "folga depois",
  minimum_notice_minutes: "antecedência mínima",
  booking_window_days: "janela de agendamento",
  default_price_cents: "preço padrão",
  reminder_enabled: "lembrete",
  reminder_minutes_before: "antecedência do lembrete",
  reminder_extra_offsets_minutes: "lembretes extras",
  reminder_body: "mensagem do lembrete",
};

function recusaDoTipo(posicao: number, erro: { issues: Array<{ path: PropertyKey[]; message: string }> }): never {
  const dicas: Record<string, string> = {
    name: "`nome` precisa de 2 a 80 caracteres.",
    category: "`categoria` aceita: consulta, procedimento, retorno, visita, vistoria, reuniao, call, orcamento, demonstracao, outro.",
    duration_minutes: "`duracao_minutos` vai de 5 a 1440.",
    location_kind: "`local` aceita: in_person (presencial), phone (telefone), whatsapp, video_link (link de vídeo), google_meet.",
    booking_window_days: "`janela_de_agendamento_dias` vai de 1 a 365.",
    minimum_notice_minutes: "`antecedencia_minima_minutos` vai de 0 a 43200.",
    buffer_before_minutes: "`folga_antes_minutos` vai de 0 a 720.",
    buffer_after_minutes: "`folga_depois_minutos` vai de 0 a 720.",
  };
  const linhas = erro.issues.map((i) => dicas[String(i.path[0])] ?? i.message);
  throw new Recusa(`tipos[${posicao}] não passou na conferência:\n- ${[...new Set(linhas)].join("\n- ")}`);
}

export async function garantirTiposDeAgendamento(
  c: Implantacao,
  pedidos: TipoPedido[],
): Promise<{ tipos: Array<{ id: string; nome: string; slug: string; desfecho: Desfecho; mudancas: string[] }>; avisos: string[] }> {
  const avisos: string[] = [];
  const existentes = await lerTipos(c.admin, c.orgId);
  const precisaDeEquipe = pedidos.some((p) => p.responsavel_padrao);
  const membros = precisaDeEquipe ? await lerMembros(c.admin, c.orgId) : [];
  const resultado: Array<{ id: string; nome: string; slug: string; desfecho: Desfecho; mudancas: string[] }> = [];

  for (const [i, pedido] of pedidos.entries()) {
    // O pedido em português vira o corpo que a rota recebe: só o que veio.
    const corpo: Record<string, unknown> = {
      name: pedido.nome,
      category: pedido.categoria,
      duration_minutes: pedido.duracao_minutos,
      location_kind: pedido.local,
    };
    if (pedido.descricao !== undefined) corpo.description = pedido.descricao;
    if (pedido.detalhes_do_local !== undefined) corpo.location_details = pedido.detalhes_do_local;
    if (pedido.responsavel_padrao !== undefined) {
      corpo.default_owner_user_id = pedido.responsavel_padrao ? acharMembro(membros, pedido.responsavel_padrao).user_id : null;
    }
    if (pedido.exige_confirmacao !== undefined) corpo.requires_confirmation = pedido.exige_confirmacao;
    if (pedido.folga_antes_minutos !== undefined) corpo.buffer_before_minutes = pedido.folga_antes_minutos;
    if (pedido.folga_depois_minutos !== undefined) corpo.buffer_after_minutes = pedido.folga_depois_minutos;
    if (pedido.antecedencia_minima_minutos !== undefined) corpo.minimum_notice_minutes = pedido.antecedencia_minima_minutos;
    if (pedido.janela_de_agendamento_dias !== undefined) corpo.booking_window_days = pedido.janela_de_agendamento_dias;
    if (pedido.preco_padrao_cents !== undefined) corpo.default_price_cents = pedido.preco_padrao_cents;

    const slug = slugDe(pedido.nome);
    const existente = existentes.find((t) => t.slug === slug || chaveDoNome(String(t.name)) === chaveDoNome(pedido.nome));

    if (!existente) {
      const lido = criarSchema.safeParse(corpo);
      if (!lido.success) recusaDoTipo(i, lido.error);
      const { data, error } = await c.admin
        .from("calendar_event_types")
        .insert({ ...lido.data, organization_id: c.orgId, slug })
        .select("id, slug")
        .single();
      if (error || !data) {
        if (error?.code === "23505") throw new Recusa(`Já existe um tipo com o nome "${pedido.nome}". Chame de novo: ele será atualizado.`);
        throw new Error(`não consegui criar o tipo «${pedido.nome}»: ${error?.message ?? "sem linha"}`);
      }
      const criado = data as { id: string; slug: string };
      void audit({
        actorUserId: c.autorUserId,
        action: "agenda.tipo_criado",
        organizationId: c.orgId,
        resourceType: "calendar_event_types",
        resourceId: criado.id,
        requestId: c.requestId,
        metadata: { nome: lido.data.name, categoria: lido.data.category, duracao: lido.data.duration_minutes, via: "mcp_plataforma" },
      });
      resultado.push({ id: criado.id, nome: pedido.nome, slug: criado.slug, desfecho: "criou", mudancas: [] });
      continue;
    }

    if (existente.is_active === false) {
      avisos.push(`O tipo «${String(existente.name)}» está DESATIVADO. Ele foi atualizado, e reativar é pela tela (Configurações › Agenda).`);
    }
    const lido = alterarSchema.safeParse({ id: String(existente.id), ...corpo });
    if (!lido.success) recusaDoTipo(i, lido.error);
    const { id: _id, ...campos } = lido.data;
    const patch = Object.fromEntries(
      Object.entries(campos).filter(([campo, valor]) => valor !== undefined && !mesmoConteudo(existente[campo], valor)),
    );
    if (Object.keys(patch).length === 0) {
      resultado.push({ id: String(existente.id), nome: String(existente.name), slug: String(existente.slug), desfecho: "ja_estava", mudancas: [] });
      continue;
    }
    const { error } = await c.admin
      .from("calendar_event_types")
      .update(patch)
      .eq("id", String(existente.id))
      .eq("organization_id", c.orgId);
    if (error) throw new Error(`não consegui alterar o tipo «${pedido.nome}»: ${error.message}`);
    void audit({
      actorUserId: c.autorUserId,
      action: "agenda.tipo_alterado",
      organizationId: c.orgId,
      resourceType: "calendar_event_types",
      resourceId: String(existente.id),
      requestId: c.requestId,
      metadata: { campos: Object.keys(patch), via: "mcp_plataforma" },
    });
    resultado.push({
      id: String(existente.id),
      nome: pedido.nome,
      slug: String(existente.slug),
      desfecho: "atualizou",
      mudancas: Object.keys(patch).map((k) => ROTULO_DO_CAMPO[k] ?? k),
    });
  }

  return { tipos: resultado, avisos };
}

// ---------------------------------------------------------------------------
// lembrete do tipo
// ---------------------------------------------------------------------------

export interface PedidoDeLembrete {
  /** Nome, slug ou id do tipo de agendamento. */
  tipo: string;
  ligado: boolean;
  minutos_antes?: number;
  extras_minutos?: number[];
  /** O texto do lembrete. `null` ou vazio volta à frase padrão. */
  mensagem?: string | null;
}

export async function ligarLembrete(
  c: Implantacao,
  pedido: PedidoDeLembrete,
): Promise<{ tipo: { id: string; nome: string }; lembrete_ligado: boolean; desfecho: Desfecho; mudancas: string[] }> {
  const tipos = await lerTipos(c.admin, c.orgId);
  const ref = pedido.tipo.trim();
  const tipo = tipos.find(
    (t) => t.id === ref || t.slug === ref || t.slug === slugDe(ref) || chaveDoNome(String(t.name)) === chaveDoNome(ref),
  );
  if (!tipo) {
    throw new Recusa(
      `Não achei o tipo de agendamento «${ref}». Os tipos são: ${tipos.map((t) => `«${String(t.name)}»`).join(", ") || "nenhum"}. ` +
        "Crie o tipo com plataforma_garantir_tipos_de_agendamento.",
    );
  }

  const lido = alterarSchema.safeParse({
    id: String(tipo.id),
    reminder_enabled: pedido.ligado,
    ...(pedido.minutos_antes !== undefined ? { reminder_minutes_before: pedido.minutos_antes } : {}),
    ...(pedido.extras_minutos !== undefined ? { reminder_extra_offsets_minutes: pedido.extras_minutos } : {}),
    ...(pedido.mensagem !== undefined ? { reminder_body: pedido.mensagem } : {}),
  });
  if (!lido.success) {
    throw new Recusa(
      "O lembrete não passou na conferência: `minutos_antes` e cada item de `extras_minutos` vão de 15 a 10080 (7 dias), e `mensagem` cabe em 1000 caracteres.",
    );
  }
  const { id: _id, ...campos } = lido.data;
  const patch = Object.fromEntries(
    Object.entries(campos).filter(([campo, valor]) => valor !== undefined && !mesmoConteudo(tipo[campo], valor)),
  );
  if (Object.keys(patch).length === 0) {
    return { tipo: { id: String(tipo.id), nome: String(tipo.name) }, lembrete_ligado: pedido.ligado, desfecho: "ja_estava", mudancas: [] };
  }
  const { error } = await c.admin
    .from("calendar_event_types")
    .update(patch)
    .eq("id", String(tipo.id))
    .eq("organization_id", c.orgId);
  if (error) throw new Error(`não consegui gravar o lembrete: ${error.message}`);
  void audit({
    actorUserId: c.autorUserId,
    action: "agenda.tipo_alterado",
    organizationId: c.orgId,
    resourceType: "calendar_event_types",
    resourceId: String(tipo.id),
    requestId: c.requestId,
    metadata: { campos: Object.keys(patch), via: "mcp_plataforma" },
  });
  return {
    tipo: { id: String(tipo.id), nome: String(tipo.name) },
    lembrete_ligado: pedido.ligado,
    desfecho: "atualizou",
    mudancas: Object.keys(patch).map((k) => ROTULO_DO_CAMPO[k] ?? k),
  };
}

// ---------------------------------------------------------------------------
// jornada de quem atende
// ---------------------------------------------------------------------------

export interface PedidoDeJornada {
  /** E-mail (ou id) de uma pessoa que JÁ faz parte da equipe. */
  pessoa: string;
  fuso?: string;
  /** Janelas de atendimento: dia 0 (domingo) a 6 (sábado), "HH:MM" a "HH:MM". Lista vazia = sem restrição. */
  janelas?: Array<{ dia: number; inicio: string; fim: string }>;
  disponivel?: boolean;
  capacidade?: number;
}

export async function definirJornada(
  c: Implantacao,
  fusoDaEmpresa: string,
  pedido: PedidoDeJornada,
): Promise<{ pessoa: { user_id: string; email: string | null }; desfecho: Desfecho; mudancas: string[] }> {
  const membro = acharMembro(await lerMembros(c.admin, c.orgId), pedido.pessoa);

  const { data: atual, error: readErr } = await c.admin
    .from("attendant_availability")
    .select("user_id, is_available, capacity, schedule")
    .eq("organization_id", c.orgId)
    .eq("user_id", membro.user_id)
    .maybeSingle();
  if (readErr) throw new Error(`não consegui ler a jornada: ${readErr.message}`);
  const linha = atual as { is_available: boolean; capacity: number; schedule: { timezone?: string; windows?: unknown[] } | null } | null;

  const entrada: Record<string, unknown> = {};
  if (pedido.janelas !== undefined || pedido.fuso !== undefined) {
    entrada.schedule = {
      timezone: pedido.fuso ?? linha?.schedule?.timezone ?? fusoDaEmpresa,
      windows:
        pedido.janelas !== undefined
          ? pedido.janelas.map((j) => ({ dow: j.dia, start: j.inicio, end: j.fim }))
          : (linha?.schedule?.windows ?? []),
    };
  }
  if (pedido.disponivel !== undefined) entrada.is_available = pedido.disponivel;
  if (pedido.capacidade !== undefined) entrada.capacity = pedido.capacidade;

  const lido = availabilityPatchSchema.safeParse(entrada);
  if (!lido.success) {
    throw new Recusa(
      "A jornada não passou na conferência. Informe ao menos um de `janelas`, `disponivel` ou `capacidade`. " +
        'Cada janela é { "dia": 1, "inicio": "08:00", "fim": "18:00" }: dia de 0 (domingo) a 6 (sábado), hora em "HH:MM" de 24 horas, com o fim depois do início. ' +
        '`fuso` é o nome da região sem acento (ex.: "America/Sao_Paulo"). `capacidade` vai de 1 a 1000.',
    );
  }

  const mudancas: string[] = [];
  if (lido.data.schedule !== undefined && !mesmoConteudo(linha?.schedule ?? {}, lido.data.schedule)) mudancas.push("jornada");
  if (lido.data.is_available !== undefined && lido.data.is_available !== (linha?.is_available ?? false)) mudancas.push("disponível");
  if (lido.data.capacity !== undefined && lido.data.capacity !== (linha?.capacity ?? 5)) mudancas.push("capacidade");
  if (linha && mudancas.length === 0) {
    return { pessoa: { user_id: membro.user_id, email: membro.email }, desfecho: "ja_estava", mudancas: [] };
  }

  const { error } = await c.admin.from("attendant_availability").upsert(
    {
      organization_id: c.orgId,
      user_id: membro.user_id,
      updated_at: new Date().toISOString(),
      ...(lido.data.is_available !== undefined ? { is_available: lido.data.is_available } : {}),
      ...(lido.data.capacity !== undefined ? { capacity: lido.data.capacity } : {}),
      ...(lido.data.schedule !== undefined ? { schedule: lido.data.schedule } : {}),
    },
    { onConflict: "organization_id,user_id" },
  );
  if (error) throw new Error(`não consegui gravar a jornada: ${error.message}`);

  void audit({
    action: "attendant.availability_changed",
    actorUserId: c.autorUserId,
    organizationId: c.orgId,
    resourceType: "attendant_availability",
    resourceId: membro.user_id,
    requestId: c.requestId,
    metadata: { target_user_id: membro.user_id, changed_by_self: false, fields_changed: Object.keys(lido.data), via: "mcp_plataforma" },
  });
  return { pessoa: { user_id: membro.user_id, email: membro.email }, desfecho: linha ? "atualizou" : "criou", mudancas };
}
