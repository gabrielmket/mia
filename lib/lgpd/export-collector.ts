/**
 * LGPD export collector — aggregates all personal data the CRM holds about
 * one contact (Art. 18 II — direito de acesso).
 *
 * CLAUDE.md §LGPD: every query filters `organization_id` programmatically
 * (admin client bypasses RLS). PII is NEVER logged — only ids and counts.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { citacaoDaLei, perfilDoPais } from "@/lib/legal/perfil-do-pais";
import { logger } from "@/lib/logger";
import { camposLegiveis, perguntasDosGrafos, type CampoLegivel } from "@/lib/lgpd/campos-personalizados";
import { maskPhone } from "@/lib/lgpd/mask";
import { phoneLookupVariants } from "@/lib/channels/phone-variants";
import type { Json } from "@/lib/database.types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ContactSnapshot {
  id: string;
  name: string | null;
  display_name: string | null;
  email: string | null;
  phone_number: string | null;
  cpf_present: boolean;
  birthdate: string | null;
  is_blocked: boolean;
  is_anonymized: boolean;
  consent: Record<string, unknown> | null;
  tags: string[];
  source: string | null;
  source_metadata: Record<string, unknown> | null;
  // Dado pessoal profissional (migration 0262).
  cargo: string | null;
  setor: string | null;
  // O papel na empresa e se é o contato principal (MIA, migration 9013).
  papel_na_empresa: string | null;
  principal_na_empresa: boolean;
  // A EMPRESA vai pelo NOME, não pelo id. O titular tem direito de saber a que
  // empresa foi vinculado; um uuid não responde isso a ninguém.
  empresa_nome: string | null;
  /**
   * A chave da pessoa numa rede social (redes sociais nativas, 0368 do upstream).
   * Identifica sozinha, então é dado pessoal — e ficava fora deste relatório,
   * que responde "é tudo que temos sobre você". Achada pela catraca
   * lgpd-as-duas-pontas na fusão de 25/09/2026, junto com o outro lado do mesmo
   * buraco: nenhum caminho de anonimização a zerava (o gatilho da MIA zera).
   */
  social_identity: string | null;
  created_at: string;
  last_activity_at: string | null;
  /** Primeiro atendimento marcado. Sobrevive à anonimização: é registro de operação. */
  first_service_at: string | null;
  /**
   * Campos personalizados — onde os roteiros de atendimento gravam o que o
   * cliente respondeu (CPF inclusive). A anonimização já os zera; sem esta
   * linha o titular pedia acesso e não recebia o que o roteiro coletou.
   */
  custom_fields: Record<string, unknown>;
  /** Para o PDF: rótulo da pergunta + valor, sem o CPF (ver `campos-personalizados.ts`). */
  campos_legiveis: CampoLegivel[];
  /** Um roteiro guardou o CPF nos campos (texto, não a coluna cifrada). */
  cpf_informado_na_conversa: boolean;
}

/**
 * O nome da empresa vinculada ao contato, numa leitura PLANA.
 *
 * Já foi um embed (`empresa:crm_empresas(nome)`), e o embed tinha dois defeitos:
 * chega como objeto ou como array conforme a cardinalidade que o PostgREST
 * enxerga, e o coletor também roda sobre clientes que só entendem coluna simples
 * (tests/invariants/agenda-meet-export) — lá o embed derrubava o relatório
 * INTEIRO do titular, não só o campo da empresa. Uma leitura a mais, fechada por
 * organização, não tem nenhum dos dois.
 */
async function nomeDaEmpresa(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  empresaId: unknown,
  requestId: string,
): Promise<string | null> {
  if (typeof empresaId !== "string" || empresaId === "") return null;
  const { data, error } = await admin
    .from("crm_empresas")
    .select("nome")
    .eq("organization_id", organizationId)
    .eq("id", empresaId)
    .maybeSingle();
  if (error) {
    logger.warn("[lgpd-export-worker] empresa load failed", { request_id: requestId, error: error.message });
    return null;
  }
  const nome = (data as { nome?: unknown } | null)?.nome;
  return typeof nome === "string" && nome.trim().length > 0 ? nome : null;
}

export interface ConsentRow {
  scope: string;
  granted: boolean;
  granted_at: string | null;
  source?: string | null;
}

export interface ConversationRow {
  id: string;
  status: string;
  channel: string;
  last_inbound_at: string | null;
  last_message_at: string | null;
  is_group: boolean;
  created_at: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  direction: string;
  type: string;
  status: string;
  body: string | null;
  has_media: boolean;
  /**
   * Transcrição do áudio / texto extraído da mídia (OCR de imagem) que a IA
   * leu (migration 0497). A anonimização o APAGA quando o titular pede
   * eliminação (#1989/#1990); o Art. 18 II exige o oposto — quem pede os
   * próprios dados recebe o texto que a organização leu da mídia dele. O
   * binário nunca vai no pacote (só `has_media`); sem esta coluna o export não
   * trazia nem o texto que a IA efetivamente processou.
   */
  media_derived_text: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface LeadRow {
  id: string;
  pipeline_id: string;
  stage_id: string;
  title: string | null;
  status: string;
  value_cents: number | null;
  currency: string | null;
  created_at: string;
}

export interface OrderRow {
  id: string;
  external_id: string | null;
  external_provider: string | null;
  status: string;
  total_cents: number | null;
  currency: string | null;
  ordered_at: string | null;
}

export interface ActivityRow {
  id: string;
  lead_id: string | null;
  type: string;
  source_module: string | null;
  performed_at: string;
}

/**
 * O resumo que o agente guarda sobre o titular (`lead_checkpoints`).
 *
 * Entra porque a anonimização o REDIGE (migration 0391): o resumo corrido, os
 * compromissos e a próxima ação são texto que o modelo escreveu SOBRE a pessoa,
 * e o que se apaga a pedido do titular é o que se entrega a pedido dele.
 */
export interface CheckpointRow {
  id: string;
  rolling_summary: string;
  commitments: unknown;
  objections: unknown;
  next_action: string | null;
  created_at: string;
}

/**
 * Vínculo do titular com um grupo de WhatsApp (migration 0482).
 *
 * A FK `channel_session_groups.contact_id` só aponta para o CONTATO PLACEHOLDER
 * do grupo (`contacts.kind = 'whatsapp_group'`), nunca para uma pessoa real — é
 * por isso que a redação (`fn_lgpd_cascade_redact_contact`) nulifica `subject`
 * comentando explicitamente que "nulificar não perde nada operacional: número,
 * conversa e liga/desliga ficam". Este bloco espelha a mesma chave
 * (`contact_id = p_contact_id`): quando o titular do pedido É o placeholder do
 * grupo, o Art. 18 II entrega o mesmo `subject` que a anonimização apagaria.
 */
export interface ChannelSessionGroupRow {
  id: string;
  group_chat_id: string;
  subject: string | null;
  enabled: boolean;
  enabled_at: string | null;
  created_at: string;
}

/**
 * Compromisso da agenda do titular.
 *
 * As colunas são as MESMAS que a migration 0184 redige ao anonimizar — e não é
 * coincidência: o que se apaga a pedido do titular é exatamente o que se
 * entrega a pedido dele. `starts_at`/`ends_at`/`status` a 0184 PRESERVA (é
 * registro de operação da clínica), e ainda assim entram aqui: o Art. 18 II é
 * sobre o que a organização sabe A RESPEITO DELE, e "houve consulta em tal dia"
 * é a informação mais legível que este export carrega.
 */
export interface AppointmentRow {
  id: string;
  title: string | null;
  description: string | null;
  notes: string | null;
  location_details: string | null;
  cancellation_reason: string | null;
  starts_at: string;
  ends_at: string;
  time_zone: string;
  status: string;
  google_base_projection?: Json | null;
  google_conflict?: Json | null;
  google_pending_write?: Json | null;
  meeting_url?: string | null;
  meeting_state?: string;
}

/**
 * A comanda do titular (migrations 0350-0359).
 *
 * Entra porque a anonimização APAGA: a 0359 pôs `sales` na cascata de redação
 * (`notes`, `cancel_reason`, `reverse_reason`), e neste repo redigir e exportar
 * andam juntos. Valor, forma de pagamento e datas a cascata PRESERVA — é
 * registro financeiro da organização —, e ainda assim entram aqui pela mesma
 * razão que `starts_at` da agenda entra: "gastei tanto, em tal dia, pago
 * assim" é informação a respeito dele, e é a mais legível deste bloco.
 *
 * Os ITENS não entram: `sale_items.description` é o nome do serviço, não dado
 * de pessoa, e a cascata não o toca — as duas pontas continuam espelhadas.
 */
export interface SaleRow {
  id: string;
  number: number;
  status: string;
  total_cents: number;
  currency: string;
  notes: string | null;
  cancel_reason: string | null;
  reverse_reason: string | null;
  finalized_at: string | null;
  created_at: string;
}

/**
 * Proposta comercial SOBRE a pessoa.
 *
 * A migration 0477 liga `destinatario_nome`, `briefing_json` e
 * `resumo_comercial` à cascata de anonimização, e este bloco é a outra
 * metade — o que se apaga a pedido do titular é o que se entrega a pedido
 * dele.
 */
export interface ProposalRow {
  id: string;
  numero: number | null;
  ano: number | null;
  titulo: string;
  status: string;
  total_cents: number;
  moeda: string;
  valid_until: string | null;
  sent_at: string | null;
  decided_at: string | null;
  destinatario_nome: string | null;
  resumo_comercial: string | null;
  /**
   * Houve um PDF gerado e enviado. O ARQUIVO não vai no pacote — mesma regra
   * de `has_media` das mensagens: o titular o recebeu no WhatsApp, e a
   * anonimização o expurga do Storage (0477). O caminho interno não sai.
   */
  tem_pdf: boolean;
  created_at: string;
}

/**
 * Tarefa combinada SOBRE a pessoa (migration 0210).
 *
 * ⚠️ ESTE BLOCO NASCEU COM A OUTRA METADE, e não depois dela. A migration liga o
 * trigger `trg_redigir_tarefas_ao_anonimizar`, que troca `title` e apaga
 * `description` quando o titular pede apagamento — e neste repo redigir e
 * exportar sempre andam juntos: o que se apaga a pedido do titular é o que se
 * entrega a pedido dele. Foi assim que `calendar_appointments` e
 * `webhook_lead_captures` chegaram aqui, as duas depois do fato, achadas por
 * `tests/unit/lgpd-exporta-o-que-redige.test.ts`.
 *
 * `due_date`, `status` e `priority` vão junto porque o titular tem direito a
 * saber não só que a empresa escreveu algo sobre ele, mas quando ela combinou
 * agir — que é a informação que dá sentido ao texto.
 */
export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  status: string;
  priority: string;
}

/**
 * Captação por webhook — de onde a pessoa veio.
 *
 * ⚠️ ESTA NÃO É DA ENTREGA DO CALENDÁRIO. Ela apareceu porque o gate novo
 * (`tests/unit/lgpd-exporta-o-que-redige.test.ts`) DERIVA a lista das duas
 * pontas em vez de escrevê-la: a mesma classe de defeito tinha duas instâncias,
 * e a segunda ninguém sabia que existia. Uma allowlist fixa teria fechado só a
 * que eu já conhecia.
 *
 * As colunas são exatamente as que `fn_redigir_captacoes_do_contato_anonimizado`
 * zera — inclusive `remote_ip` e `user_agent`, que a LGPD trata como dado
 * pessoal e que a organização guarda a respeito do titular.
 */
export interface CaptureRow {
  id: string;
  source_name: string | null;
  outcome: string;
  captured_name: string | null;
  captured_phone: string | null;
  captured_email: string | null;
  fields: unknown;
  utm: unknown;
  remote_ip: string | null;
  user_agent: string | null;
  received_at: string;
}

/**
 * Contrato de honorários (advocacia) — módulo opcional, ADR-0002 D8: todo
 * módulo com dados declara sua seção de export, mesmo sem estar na cascata de
 * redação (achado da revisão do PR #1578). O vínculo é `lead_id`, não
 * `contact_id` direto — o contrato pertence ao CASO, não à pessoa em geral —
 * por isso deriva dos ids de `leads` já coletados acima, e não de uma consulta
 * própria por contato.
 */
export interface HonorariosContratoRow {
  id: string;
  lead_id: string | null;
  modelo: string;
  valor_fixo_cents: number | null;
  percentual_exito: number | null;
  repasse_advogado_pct: number | null;
  created_at: string;
}

/** O calendário de parcelas do contrato acima — o titular tem direito de ver
 * o que foi combinado e o que já foi pago, do mesmo jeito que vê `sales`. */
export interface HonorariosParcelaRow {
  id: string;
  contrato_id: string;
  numero: number;
  vencimento: string;
  valor_cents: number;
  status: string;
  financial_entry_id: string | null;
}

export interface AuditRow {
  id: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  created_at: string;
}

/** Entrega do link: estado e referência ao compromisso, sem autorização/claim. */
export interface MeetingDeliveryRow {
  id: string;
  status: string;
  created_at: string;
  run_after: string;
  appointment_id: string | null;
}

/** Aviso sobre um compromisso comprovadamente ligado ao titular. */
export interface AppointmentNoticeRow {
  id: string;
  ref_id: string | null;
  title: string;
  body: string | null;
  status: string;
  created_at: string;
  resolved_at: string | null;
}

/**
 * Um caso aberto pela IA sobre o titular — o que ela entendeu quando travou.
 *
 * O vínculo é pela CONVERSA: `agent_cases` não tem FK para `contacts`. `kind`
 * (migration 0248) fica fora da projeção porque `lib/database.types.ts` ainda
 * não o conhece, e selecionar coluna que o tipo não tem é erro de compilação.
 */
export interface CaseRow {
  id: string;
  conversation_id: string;
  status: string;
  title: string;
  summary: string;
  blocker: string;
  source: string;
  opened_at: string;
  closed_at: string | null;
  created_at: string;
}

/** Uma linha do tempo do caso: quem tocou, quando, e o que escreveu. */
export interface CaseEventRow {
  id: string;
  case_id: string;
  kind: string;
  actor_kind: string;
  human_action: string | null;
  body: string | null;
  metadata: unknown;
  created_at: string;
}

/**
 * Uma mensagem da conversa INTERNA da equipe com a IA sobre um caso do titular
 * (migration 0281). O que se apaga a pedido dele é o que se entrega a pedido
 * dele: `body` está na cascata de redação, logo a tabela tem de ser visitada
 * aqui — é o que `tests/unit/lgpd-exporta-o-que-redige.test.ts` cobra.
 *
 * O vínculo é a FK DIRETA `contact_id`, e não a conversa: ela existe nesta
 * tabela exatamente para isso.
 */
export interface CaseChatMessageRow {
  id: string;
  case_id: string;
  turn_id: string;
  author_kind: string;
  body: string | null;
  error_code: string | null;
  created_at: string;
}

/**
 * Uma passagem do atendimento automático para uma pessoa (migration 0291).
 *
 * O que se apaga a pedido do titular é o que se entrega a pedido dele: as quatro
 * colunas de texto estão na cascata de redação, logo a tabela tem de ser
 * visitada aqui — é o que `tests/unit/lgpd-exporta-o-que-redige.test.ts` cobra,
 * derivando as duas pontas da fonte.
 *
 * O vínculo é a FK DIRETA `contact_id`. As colunas de OPERAÇÃO entram junto
 * (`motor`, `origem`, `motivo_codigo`, o par do aviso e o do reconhecimento):
 * o titular tem direito de saber não só o que escreveram sobre ele, mas que a
 * conversa dele foi passada a uma pessoa, por quê, e quando alguém assumiu.
 */
export interface PassagemDeAtendimentoRow {
  id: string;
  conversation_id: string;
  caso_id: string | null;
  motor: string;
  origem: string;
  motivo_codigo: string;
  title: string | null;
  body: string;
  notes: string | null;
  content: string | null;
  tentativas: unknown;
  cliente_avisado: boolean | null;
  aviso_motivo_codigo: string | null;
  criado_em: string;
  reconhecido_em: string | null;
}

/**
 * O registro de que a equipe foi (ou não foi) avisada no WhatsApp sobre um caso
 * do titular — migration 0292.
 *
 * ⚠️ `destino` entra MASCARADO. Ele é o telefone de um FUNCIONÁRIO, não do
 * titular: entregá-lo inteiro num relatório do Art. 18 II trocaria o dado
 * pessoal de uma pessoa pelo de outra. O que o titular tem direito de saber é
 * QUE houve um aviso sobre o atendimento dele, quando, e se chegou.
 *
 * O corpo do aviso não aparece porque ele NÃO É GUARDADO — a tabela tem só o
 * resumo criptográfico, e um hash não reidentifica ninguém.
 */
export interface AvisoDeCasoEntregaRow {
  id: string;
  case_id: string;
  destino_mascarado: string | null;
  status: string;
  erro_codigo: string | null;
  tentativas: number;
  enviado_em: string | null;
  created_at: string;
}

/** Uma demanda do titular — o pedido, seu dono e seu desfecho. */
export interface DemandaRow {
  id: string;
  agent_case_id: string | null;
  origem: string;
  assunto: string | null;
  estado: string;
  dono_kind: string;
  proximo_passo: string | null;
  desfecho: string | null;
  aberta_em: string;
  fechada_em: string | null;
}

/** Uma chamada de voz do titular — o registro, não a gravação (não gravamos). */
export interface VoiceCallRow {
  id: string;
  direction: string;
  peer_phone: string;
  status: string;
  end_reason: string | null;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
}

/**
 * Um atendimento da IA. Sem `tool_calls`: a 0266 o apaga na anonimização, e
 * antes dela o rastro interno traria também buscas e nomes de terceiros.
 */
export interface AiRunRow {
  id: string;
  status: string;
  abort_reason: string | null;
  steps_count: number;
  started_at: string;
  completed_at: string | null;
}

/*
 * `DemandaRow` NÃO é declarada aqui, e isto é resolução de fusão, não descuido.
 *
 * Os dois lados acrescentaram a mesma tabela de forma independente: o nosso
 * fork pela varredura da migration 0266, o upstream pela cascata da 0280. Ficou
 * a declaração do upstream (logo acima, junto de `CaseRow`) porque ela é um
 * SUPERCONJUNTO da nossa — traz também `agent_case_id`, `dono_kind` e
 * `fechada_em`. Duas interfaces com o mesmo nome não compilam, e ficar com a
 * nossa entregaria ao titular MENOS colunas sobre a mesma demanda.
 */

/**
 * Um disparo que chegou a esta pessoa.
 *
 * `phone_e164` vem junto de propósito: depois da anonimização ele é o RÓTULO
 * (a 0266 o substitui, como a 0235 fez em `voice_calls.peer_phone`), e ver o
 * rótulo no próprio relatório é como o titular confere que a exclusão pegou.
 */
export interface BroadcastRecipientRow {
  id: string;
  broadcast_id: string;
  phone_e164: string;
  status: string;
  erro: string | null;
  enviado_em: string | null;
  created_at: string;
}

/**
 * O clique no anúncio que trouxe esta pessoa (`google_ads_click_refs` e
 * `meta_ads_click_refs`, 0306 do upstream).
 *
 * Entra porque a anonimização APAGA: o gatilho da MIA (0266) zera `query_raw` e
 * desliga o contato — e o que se apaga a pedido do titular é o que se entrega a
 * pedido dele. `query_raw` vai inteiro: é a query string crua da landing page, e
 * pode ter o e-mail e o nome da pessoa. Esconder justamente o campo que pode ser
 * dado pessoal seria o relatório mentir no ponto em que mais importa.
 */
export interface AdClickRow {
  rede: "google" | "meta";
  id: string;
  /** O que identifica a campanha: o gclid (Google) ou as chaves de UTM (Meta). */
  campanha: string | Record<string, unknown>;
  query_raw: Record<string, unknown>;
  created_at: string;
  matched_at: string | null;
}

/** Pesquisa e resultado da abordagem ligados ao titular (redação: migration 0370). */
export interface ProspectingCandidateRow {
  id: string;
  campaign_id: string;
  place_id: string;
  phone: string | null;
  data: Json;
  status: string;
  lead_id: string | null;
  conversation_id: string | null;
  attempted_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Uma campanha que falou com este titular (migration 0374).
 *
 * O texto vai junto porque é o que foi DITO a ele; o telefone não, porque ele já
 * está no bloco do contato e repeti-lo só multiplica PII no arquivo entregue.
 */
export interface CampaignRecipientRow {
  id: string;
  campaign_id: string;
  status: string;
  eligibility_status: string;
  exclusion_reason: string | null;
  rendered_body: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  replied_at: string | null;
  opted_out_at: string | null;
}

/**
 * Uma linha da lista de exclusão de campanhas que aponta para este titular
 * (migration 0375).
 *
 * O hash do telefone NÃO entra: ele não diz nada a quem lê e não é dado que o
 * titular reconheça. O que entra é o fato — "este número está fora das
 * campanhas desde tal dia, por tal motivo" —, que é exatamente a informação
 * dele que a organização guarda.
 */
export interface CampaignSuppressionRow {
  id: string;
  address_tail: string | null;
  reason: string | null;
  source: string;
  created_at: string;
}

/** FORK MIA — a linha de `mia_obrigacoes` como o relatório de acesso a lê. */
interface LinhaDeObrigacaoExportada {
  id: string;
  nome: string;
  categoria: string;
  lead_id: string | null;
  contact_id: string | null;
  quem_entrega: string;
  recorrencia: string;
  pedido_em: string | null;
  prazo_em: string | null;
  recebido_em: string | null;
  valido_ate: string | null;
  proxima_em: string | null;
  feita_em: string | null;
  ciclo: number;
  arquivo_nome: string | null;
  arquivo_mime: string | null;
  observacao: string | null;
  created_at: string;
}

/** FORK MIA — um documento ou atividade do titular, com o histórico dele (migration 9018). */
export interface ObrigacaoExportada extends Omit<LinhaDeObrigacaoExportada, "contact_id"> {
  /** O item é da própria pessoa, ou de um negócio dela. */
  ligado_a: "contato" | "negocio";
  ciclos: Array<{
    ciclo: number;
    como: string;
    pedido_em: string | null;
    recebido_em: string | null;
    valido_ate: string | null;
    proxima_em: string | null;
    feita_em: string | null;
    arquivo_nome: string | null;
    encerrado_em: string;
  }>;
  propostas: Array<{ arquivo_nome: string | null; situacao: string; created_at: string; decidida_em: string | null }>;
}

export interface ExportPayload {
  request_id: string;
  organization_id: string;
  /**
   * Razão social do CONTROLADOR (`organizations.legal_name`, `NOT NULL` em
   * `supabase/baseline.sql:1749`). É o que o rodapé do relatório imprime — e é
   * de propósito que NÃO é a marca: ver `lib/lgpd/pdf-renderer.tsx`.
   */
  organization_legal_name: string;
  /** Nome fantasia. Não vai para o rodapé; existe para o JSON do export. */
  organization_display_name: string;
  /** Encarregado da organização; `null` cai no encarregado da INSTALAÇÃO (0341). */
  dpo_email: string | null;
  /**
   * A lei que o documento de acesso cita, pronta (`LGPD Art. 18, II (Lei nº
   * 13.709/2018)`), ou `null` quando o país da organização ainda não tem
   * citação revisada (issue #1033). `null` NÃO cai para a lei brasileira: o
   * documento responde a um direito legal do titular, e afirmar a lei de outro
   * país é pior do que não citar artigo nenhum — o rodapé diz que não há
   * citação revisada em vez de inventar uma.
   */
  lei_citada: string | null;
  /** O rótulo do documento do titular no país ("CPF", "Documento"). */
  documento_rotulo: string;
  generated_at: string;
  no_local_footprint: boolean;
  contact: ContactSnapshot | null;
  consents: ConsentRow[];
  conversations: ConversationRow[];
  messages_count_total: number;
  messages_recent: MessageRow[];
  leads: LeadRow[];
  /**
   * Módulo opcional de honorários (advocacia, ADR-0002). Vazio nas instalações
   * que não o instalaram, ou quando o titular não tem contrato — nunca ausente:
   * campo obrigatório é o que faz um caminho de export novo não compilar se
   * esquecer, a mesma razão de `case_chat_messages`.
   */
  honorarios_contratos: HonorariosContratoRow[];
  honorarios_parcelas: HonorariosParcelaRow[];
  orders: OrderRow[];
  activities: ActivityRow[];
  checkpoints: CheckpointRow[];
  appointments: AppointmentRow[];
  sales: SaleRow[];
  proposals: ProposalRow[];
  tasks: TaskRow[];
  webhook_captures: CaptureRow[];
  audit_log_extract: AuditRow[];
  meeting_deliveries: MeetingDeliveryRow[];
  /** Atendimentos da IA (0266). O rastro interno fica de fora — ver `AiRunRow`. */
  ai_runs: AiRunRow[];
  /** Disparos que chegaram a ela (0266). */
  broadcasts_recebidos: BroadcastRecipientRow[];
  /**
   * FORK MIA — os documentos e as obrigações do titular (migration 9018): os
   * itens ligados a ele e os dos negócios dele, com o histórico dos ciclos e as
   * propostas que o agente registrou a partir de arquivos que ele mandou. A
   * anonimização apaga os itens dele e o arquivo de todos; o que se apaga a
   * pedido dele é o que se entrega a pedido dele (Art. 18 II). O arquivo entra
   * como METADADO (nome e formato): o export é `data.json` + `report.pdf`.
   * Opcional como `conversation_notes`: o tipo é montado à mão nos testes de PDF.
   */
  obrigacoes?: ObrigacaoExportada[];
  /** Por qual anúncio ela chegou — ver `AdClickRow`. */
  cliques_de_anuncio: AdClickRow[];
  appointment_notices: AppointmentNoticeRow[];
  /**
   * Chamadas de voz (migration 0232).
   *
   * Entra porque a anonimização APAGA: a 0235 pôs `voice_calls` na cascata de
   * redação, e o que se apaga a pedido do titular é o que se entrega a pedido
   * dele. Sem este bloco o relatório dizia "houve uma atividade de chamada" na
   * linha do tempo e não mostrava chamada nenhuma — export incoerente com o
   * próprio cascade.
   */
  voice_calls: VoiceCallRow[];
  prospecting_candidates: ProspectingCandidateRow[];
  /**
   * Casos, linha do tempo do caso e demandas (migration 0280).
   *
   * Entram pelo mesmo motivo de `voice_calls`: a 0280 pôs as três na cascata de
   * redação, e o que se apaga a pedido do titular é o que se entrega a pedido
   * dele. Sem os três blocos, o relatório mostrava a conversa e as mensagens e
   * não mencionava que o atendimento tinha parado, o que a IA entendeu do
   * problema dele, nem quem da equipe respondeu — que é a parte em que uma
   * pessoa identificável é DESCRITA por máquina.
   */
  cases: CaseRow[];
  case_events: CaseEventRow[];
  /**
   * Demandas abertas em nome da pessoa (migrations 0266 e 0280) — UM campo só.
   *
   * O nosso fork trouxe este bloco pela varredura da 0266 ("toda tabela com
   * `contact_id` contra todo caminho que anonimiza") e o upstream pela cascata
   * da 0280. Ficou a versão do upstream: mesmo filtro, mesmo teto, e três
   * colunas a mais (`agent_case_id`, `dono_kind`, `fechada_em`). Declarar o
   * campo duas vezes não compila, e a nossa entregaria menos ao titular.
   */
  demandas: DemandaRow[];
  /**
   * O que a equipe PERGUNTOU à IA sobre os casos do titular, e o que ela
   * respondeu. Obrigatório, não opcional: campo obrigatório faz um caminho de
   * export novo NÃO COMPILAR se esquecer, que é a única sincronia que não
   * depende de memória humana.
   */
  case_chat_messages: CaseChatMessageRow[];
  /**
   * As passagens do atendimento dele para uma pessoa. Obrigatório, não
   * opcional, pela mesma razão do campo acima: campo obrigatório faz um caminho
   * de export novo NÃO COMPILAR se esquecer, que é a única sincronia que não
   * depende de memória humana.
   */
  passagens: PassagemDeAtendimentoRow[];
  avisos_de_caso: AvisoDeCasoEntregaRow[];
  /**
   * Campanhas que falaram com o titular (migration 0375).
   *
   * Entra pelo mesmo motivo de `voice_calls`: o trigger
   * `trg_redigir_campanhas_anonimizado` APAGA o texto e o telefone destas linhas
   * quando ele pede anonimização, e o que se apaga a pedido dele é o que se
   * entrega a pedido dele (Art. 18 II). Sem este bloco, alguém que recebeu uma
   * prospecção pediria acesso e não veria a mensagem que recebeu.
   */
  campaign_recipients: CampaignRecipientRow[];
  /**
   * Lista de exclusão de campanhas (migration 0375).
   *
   * Entra pelo mesmo motivo das demais: o trigger
   * `trg_redigir_exclusoes_anonimizado` APAGA o vínculo e os últimos dígitos
   * quando o titular pede anonimização, e o que se apaga a pedido dele é o que
   * se entrega a pedido dele (Art. 18 II).
   */
  campaign_suppressions: CampaignSuppressionRow[];
  /**
   * Grupos de WhatsApp vinculados ao titular (migration 0482) — ver o
   * docstring de `ChannelSessionGroupRow`. Obrigatório, não opcional, pela
   * mesma razão de `case_chat_messages`: campo obrigatório faz um caminho de
   * export novo NÃO COMPILAR se esquecer.
   */
  channel_session_groups: ChannelSessionGroupRow[];
  /**
   * Mensagens que o titular escreveu em GRUPOS de WhatsApp (migration 0482).
   * Moram na conversa do placeholder do grupo, não na dele, então
   * `messages_recent` não as vê. Casadas pelo autor em `metadata.group_sender`
   * — telefone (grafias com e sem o nono dígito) ou lid (`contacts.wa_lid`) —,
   * a mesma chave que a anonimização usa em `fn_redigir_conversas_ao_anonimizar`.
   * Só alcança quem JÁ É contato: o participante sem ficha não tem titular.
   */
  group_messages_authored: MessageRow[];
  /** Rascunhos escritos PARA o titular por outro sistema (0419), apagados na
   *  anonimização. Opcional como `reply_drafts`: o tipo é montado à mão nos testes de PDF. */
  conversation_drafts?: Array<{
    id: string;
    conversation_id: string;
    body: string;
    source: string;
    consumed_at: string | null;
    created_at: string;
  }>;
  /**
   * Notas internas das conversas do titular (#1863, F3) — o texto que a equipe
   * escreveu SOBRE ele e a mídia que anexou junto. Sem FK para `contacts` (só
   * para `conversations`), nenhuma outra leitura alcançaria a tabela; é o mesmo
   * motivo de `conversation_drafts`. A migration 0483 redige `body`, zera
   * `media_storage_path`/`media_mime`/`media_size_bytes` e enfileira o arquivo
   * com o bucket `internal-media` quando ele pede anonimização — o que se apaga
   * a pedido dele é o que se entrega a pedido dele (Art. 18 II). A mídia vem
   * como METADADO (caminho, MIME, bytes): o export é `data.json` + `report.pdf`,
   * e nenhum binário trafega por ele.
   */
  conversation_notes?: Array<{
    id: string;
    conversation_id: string;
    body: string;
    media_storage_path: string | null;
    media_mime: string | null;
    media_size_bytes: number | null;
    created_at: string;
    created_by_name: string | null;
  }>;
  /** Propostas de campo do contato (0123), também APAGADAS na anonimização. */
  contact_field_proposals?: Array<{
    id: string;
    campo: string;
    valor_proposto: string;
    valor_anterior: string | null;
    conversation_id: string | null;
    trecho: string | null;
    status: string;
    proposed_at: string;
    decided_at: string | null;
    motivo_recusa: string | null;
  }>;
  /**
   * Memória da IA sobre o titular (#1957): `lead_notes` guarda `headline` +
   * `body` — o nome e trechos do que a pessoa escreveu. A cascata redige os
   * dois quando ele pede anonimização; o que se apaga a pedido dele é o que se
   * entrega a pedido dele (Art. 18 II). Mesmo escopo da cascata: org + contato.
   */
  lead_notes?: Array<{
    id: string;
    headline: string | null;
    body: string | null;
    created_at: string | null;
    updated_at: string | null;
  }>;
  /**
   * Registro de execução da IA (#1957): de `ai_agent_runs.tool_calls` (jsonb)
   * saem só o nome e os argumentos de cada ferramenta — nome do titular e
   * trechos do que escreveu. O `result` e o texto do passo ficam de fora
   * (podem trazer dado de OUTROS contatos; ver `toolCallsParaOTitular`).
   * Redigido na cascata; entregue no acesso. Org + contato.
   */
  ai_agent_runs?: Array<{
    id: string;
    tool_calls: unknown;
    created_at: string | null;
  }>;
  /**
   * Estado da lead (#1957): `lead_state.next_action` (texto) e `qualification`
   * (jsonb) descrevem o titular por máquina. Redigidos na cascata; entregues
   * no acesso. Org + contato.
   */
  lead_state?: Array<{
    id: string;
    next_action: string | null;
    qualification: unknown;
    updated_at: string | null;
  }>;
  /**
   * Empresas e pessoas (migrations 0448/0449, metade B2B do #1621): a PESSOA
   * para quem o contato aponta, os vínculos dela com empresas e as linhas de
   * planilha que falaram dela. A 0449 redige as três quando o titular pede
   * anonimização; o que se apaga a pedido dele é o que se entrega a pedido dele
   * (Art. 18 II). Opcional como `reply_drafts`: o tipo é montado à mão nos
   * testes de PDF, e quem vigia o esquecimento é
   * `tests/unit/lgpd-exporta-o-que-redige.test.ts`, que lê o catálogo.
   */
  b2b?: {
    pessoa: {
      id: string;
      full_name: string;
      email: string | null;
      notes: string | null;
      created_at: string;
    } | null;
    vinculos: Array<{
      company_id: string;
      job_title: string | null;
      department: string | null;
      is_decision_maker: boolean;
      notes: string | null;
    }>;
    linhas_importadas: Array<{
      id: string;
      batch_id: string;
      row_number: number;
      status: string;
      raw_data: unknown;
      normalized_data: unknown;
      error: string | null;
      created_at: string;
    }>;
  };
  reply_drafts?: Array<{
    id: string;
    status: string;
    original_body: string | null;
    edited_body: string | null;
    approved_body: string | null;
    proposals: unknown;
    feedback: unknown;
    created_at: string;
  }>;
}

// ---------------------------------------------------------------------------
// collectExportData
// ---------------------------------------------------------------------------

interface CollectArgs {
  organizationId: string;
  requestId: string;
  contactId: string | null;
  externalCustomerId: string | null;
  /**
   * O encarregado de dados da INSTALAÇÃO — o piso do da organização, já
   * RESOLVIDO por quem chama.
   *
   * Injetado, e não lido aqui, porque o coletor de LGPD tem de tocar o mínimo:
   * `tests/invariants/agenda-meet-export.test.ts` exige que a coleta sem
   * identificador visite APENAS `organizations`, e consultar a configuração da
   * instalação acrescentaria uma tabela a toda coleta — inclusive à que não vai
   * usar o valor. Quem chama já é assíncrono e já resolve outras coisas da
   * instalação; resolver mais esta ali não custa visita nenhuma aqui.
   */
  dpoDaInstalacao?: string | null;
}

const RECENT_MESSAGES_LIMIT = 100;
const AUDIT_LIMIT = 200;

/** A identidade JURÍDICA da organização — quem responde pelos dados. */
interface Controlador {
  legal_name: string;
  display_name: string;
  dpo_email: string | null;
  /**
   * O país da organização (issue #1033). Lido JUNTO do controlador, na mesma
   * consulta, porque é dele que saem a lei citada e o rótulo do documento: dois
   * `select` na mesma linha divergem no dia em que um ganhar fallback e o outro
   * não — e aqui a divergência sairia impressa num documento entregue a um
   * titular, afirmando a lei de um país com o rótulo de outro.
   */
  country: string | null;
}

/**
 * Lê o controlador. NUNCA lança e nunca inventa: se a leitura falhar, os campos
 * saem vazios e o rodapé mostra o traço de campo ausente. Abortar o export
 * seria trocar um rodapé feio por um SLA legal de D+7 estourado; preencher com
 * o nome do produto seria escrever a entidade errada num documento jurídico.
 */
async function lerControlador(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  requestId: string,
  dpoDaInstalacao: string | null,
): Promise<Controlador> {
  const vazio: Controlador = {
    legal_name: "",
    display_name: "",
    dpo_email: dpoDaInstalacao,
    country: null,
  };
  const { data, error } = await admin
    .from("organizations")
    .select("legal_name, display_name, dpo_email, country")
    .eq("id", organizationId)
    .maybeSingle();
  if (error || !data) {
    logger.warn("[lgpd-export-worker] organization load failed", {
      request_id: requestId,
      error: error?.message ?? "not_found",
    });
    return vazio;
  }
  return {
    legal_name: data.legal_name ?? "",
    display_name: data.display_name ?? "",
    dpo_email: data.dpo_email?.trim() || dpoDaInstalacao,
    country: (data as { country?: string | null }).country ?? null,
  };
}

/**
 * O que o titular recebe de `ai_agent_runs.tool_calls` (#1965): por passo, o
 * nome e os argumentos de cada ferramenta — o que o agente fez com o que a
 * pessoa escreveu. Saem o `result` de cada chamada e o `text` do passo (forma
 * em `lib/ai/runtime/serialize.ts`): o `result` de `crm_search_contacts` traz
 * nome, telefone e e-mail de até 50 OUTROS contatos, e o de
 * `crm_list_appointments` a agenda da organização — entregá-los seria dar ao
 * titular A o dado do titular B. O texto do modelo pode repetir esse resultado.
 * Passo já redigido pela cascata (`redacted: true`, sem `args`) sai como está.
 */
export function toolCallsParaOTitular(toolCalls: unknown): unknown[] {
  const passos = Array.isArray(toolCalls) ? (toolCalls as unknown[]) : [];
  return passos.map((p) => {
    const passo = (p ?? {}) as {
      step?: unknown;
      tool_name?: unknown;
      redacted?: unknown;
      tool_calls?: unknown;
    };
    const chamadas = Array.isArray(passo.tool_calls) ? (passo.tool_calls as unknown[]) : [];
    return {
      ...(passo.step !== undefined ? { step: passo.step } : {}),
      ...(typeof passo.tool_name === "string" ? { tool_name: passo.tool_name } : {}),
      ...(passo.redacted === true ? { redacted: true } : {}),
      tool_calls: chamadas.map((c) => {
        const chamada = (c ?? {}) as { tool_name?: unknown; args?: unknown };
        return {
          tool_name: typeof chamada.tool_name === "string" ? chamada.tool_name : "unknown",
          ...(chamada.args !== undefined ? { args: chamada.args } : {}),
        };
      }),
    };
  });
}

export async function collectExportData(args: CollectArgs): Promise<ExportPayload> {
  const admin = createAdminClient();
  const { organizationId, requestId, externalCustomerId } = args;
  // ANTES do primeiro `return`: o caminho "nenhum dado localizado" também gera
  // um relatório entregue ao titular, e ele precisa nomear o controlador igual.
  const controlador = await lerControlador(admin, organizationId, requestId, args.dpoDaInstalacao ?? null);
  let contactId = args.contactId;

  // Resolve contact_id when only external customer id is provided.
  if (!contactId && externalCustomerId) {
    const { data, error } = await admin
      .from("contacts")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("source", "nuvemshop")
      .eq("source_metadata->>nuvemshop_customer_id", externalCustomerId)
      .maybeSingle();
    if (error) {
      logger.warn("[lgpd-export-worker] resolve-by-external failed", {
        request_id: requestId,
        error: error.message,
      });
    }
    if (data) contactId = data.id;
  }

  // No contact AND no external customer -> empty footprint.
  if (!contactId && !externalCustomerId) {
    return emptyPayload(requestId, organizationId, controlador);
  }

  // Contact snapshot (PII intentionally retained — this report is the data
  // owner's right of access; only logs/metadata stay sanitized).
  //
  // ⚠️ Quem acrescentar coluna de dado pessoal em `contacts` tem DOIS lugares a
  // mexer, e nenhum dos dois reclama sozinho: esta lista (direito de acesso) e
  // `fn_lgpd_cascade_redact_contact` (direito ao esquecimento). O `select`
  // daqui já trouxe `custom_fields` por anos sem que ele chegasse ao relatório,
  // e a função de anonimização nunca o limpou (consertado na migration 0264).
  let contact: ContactSnapshot | null = null;
  let contactLid: string | null = null;
  if (contactId) {
    const { data, error } = await admin
      .from("contacts")
      .select(
        // As colunas dos DOIS lados (o upstream passou a exportar `wa_lid` na
        // v1.61, para achar as mensagens de grupo). `cargo`, `setor` e
        // `empresa` são dado pessoal profissional (0262) e fecham a ponta que a
        // cascata já limpava; `first_service_at` é registro de operação e
        // sobrevive à anonimização. Deixar qualquer um de fora responde "não
        // temos mais nada sobre você" a quem exerce direito de acesso, e a
        // resposta é falsa.
        "id, name, display_name, email, phone_number, wa_lid, cpf_encrypted, birthdate, is_blocked, is_anonymized, consent, tags, source, source_metadata, custom_fields, cargo, setor, papel_na_empresa, principal_na_empresa, empresa_id, social_identity, created_at, last_activity_at, first_service_at",
      )
      .eq("organization_id", organizationId)
      .eq("id", contactId)
      .maybeSingle();
    if (error) {
      logger.warn("[lgpd-export-worker] contact load failed", {
        request_id: requestId,
        error: error.message,
      });
    }
    if (data) {
      const customFields =
        data.custom_fields && typeof data.custom_fields === "object" && !Array.isArray(data.custom_fields)
          ? (data.custom_fields as Record<string, unknown>)
          : {};
      // Os rótulos vêm das perguntas dos roteiros que o contato percorreu. Duas
      // leituras planas (sem embed): o coletor também roda sobre clientes que
      // só entendem coluna simples (tests/invariants/agenda-meet-export).
      const grafos: unknown[] = [];
      const { data: inscricoes, error: inscricoesErr } = await admin
        .from("followup_enrollments")
        .select("version_id")
        .eq("organization_id", organizationId)
        .eq("contact_id", contactId)
        .order("started_at", { ascending: false })
        .limit(50);
      const versaoIds = [
        ...new Set((inscricoes ?? []).flatMap((r) => (r.version_id ? [r.version_id as string] : []))),
      ];
      if (versaoIds.length > 0 && !inscricoesErr) {
        const { data: versoes, error: versoesErr } = await admin
          .from("followup_flow_versions")
          .select("id, graph")
          .eq("organization_id", organizationId)
          .in("id", versaoIds);
        if (versoesErr) {
          logger.warn("[lgpd-export-worker] roteiros load failed", { request_id: requestId, error: versoesErr.message });
        }
        const porId = new Map((versoes ?? []).map((v) => [v.id as string, v.graph]));
        for (const id of versaoIds) grafos.push(porId.get(id)); // o mais recente primeiro
      }
      if (inscricoesErr) {
        logger.warn("[lgpd-export-worker] roteiros load failed", {
          request_id: requestId,
          error: inscricoesErr.message,
        });
      }
      const legiveis = camposLegiveis(customFields, perguntasDosGrafos(grafos));
      contactLid = data.wa_lid ?? null;
      contact = {
        id: data.id,
        name: data.name ?? null,
        display_name: data.display_name ?? null,
        email: data.email ?? null,
        phone_number: data.phone_number ?? null,
        cpf_present: Boolean(data.cpf_encrypted),
        birthdate: data.birthdate ?? null,
        is_blocked: Boolean(data.is_blocked),
        is_anonymized: Boolean(data.is_anonymized),
        consent: (data.consent as Record<string, unknown> | null) ?? null,
        tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
        source: data.source ?? null,
        source_metadata: (data.source_metadata as Record<string, unknown> | null) ?? null,
        cargo: data.cargo ?? null,
        setor: data.setor ?? null,
        papel_na_empresa: (data.papel_na_empresa as string | null) ?? null,
        principal_na_empresa: Boolean(data.principal_na_empresa),
        empresa_nome: await nomeDaEmpresa(admin, organizationId, data.empresa_id, requestId),
        social_identity: data.social_identity ?? null,
        created_at: data.created_at,
        last_activity_at: data.last_activity_at ?? null,
        first_service_at: data.first_service_at ?? null,
        custom_fields: customFields,
        campos_legiveis: legiveis.campos,
        cpf_informado_na_conversa: legiveis.cpfInformado,
      };
    }
  }

  // No `consents` table in current schema; legal basis is in contacts.consent JSONB.
  const consents: ConsentRow[] = [];
  if (contact?.consent && typeof contact.consent === "object") {
    for (const [scope, value] of Object.entries(contact.consent)) {
      if (value && typeof value === "object") {
        const v = value as Record<string, unknown>;
        consents.push({
          scope,
          granted: Boolean(v.granted),
          granted_at: typeof v.granted_at === "string" ? v.granted_at : null,
          source: typeof v.source === "string" ? v.source : null,
        });
      } else {
        consents.push({
          scope,
          granted: Boolean(value),
          granted_at: null,
        });
      }
    }
  }

  // Conversations.
  let conversations: ConversationRow[] = [];
  if (contactId) {
    const { data, error } = await admin
      .from("conversations")
      .select("id, status, channel, last_inbound_at, last_message_at, is_group, created_at")
      .eq("organization_id", organizationId)
      .eq("contact_id", contactId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(500);
    if (error) {
      logger.warn("[lgpd-export-worker] conversations load failed", {
        request_id: requestId,
        error: error.message,
      });
    } else if (data) {
      conversations = data.map((c) => ({
        id: c.id,
        status: c.status,
        channel: c.channel,
        last_inbound_at: c.last_inbound_at,
        last_message_at: c.last_message_at,
        is_group: Boolean(c.is_group),
        created_at: c.created_at,
      }));
    }
  }

  // Messages — count total + sample recent.
  let messages_count_total = 0;
  let messages_recent: MessageRow[] = [];
  if (contactId) {
    const { count, error: countErr } = await admin
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("contact_id", contactId);
    if (countErr) {
      logger.warn("[lgpd-export-worker] messages count failed", {
        request_id: requestId,
        error: countErr.message,
      });
    } else {
      messages_count_total = count ?? 0;
    }

    const { data, error } = await admin
      .from("messages")
      .select("id, conversation_id, direction, type, status, body, media_url, media_derived_text, sent_at, created_at")
      .eq("organization_id", organizationId)
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(RECENT_MESSAGES_LIMIT);
    if (error) {
      logger.warn("[lgpd-export-worker] messages recent load failed", {
        request_id: requestId,
        error: error.message,
      });
    } else if (data) {
      messages_recent = data.map((m) => ({
        id: m.id,
        conversation_id: m.conversation_id,
        direction: m.direction,
        type: m.type,
        status: m.status,
        body: m.body,
        has_media: Boolean(m.media_url),
        media_derived_text: m.media_derived_text ?? null,
        sent_at: m.sent_at,
        created_at: m.created_at,
      }));
    }
  }

  // Leads (direct contact_id FK on crm_leads).
  let leads: LeadRow[] = [];
  if (contactId) {
    const { data, error } = await admin
      .from("crm_leads")
      .select("id, pipeline_id, stage_id, title, status, value_cents, currency, created_at")
      .eq("organization_id", organizationId)
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      logger.warn("[lgpd-export-worker] leads load failed", {
        request_id: requestId,
        error: error.message,
      });
    } else if (data) {
      leads = data;
    }
  }

  // Honorários — módulo opcional (ADR-0002/D8). Deriva dos ids de `leads` já
  // coletados: o contrato é `lead_id`, não `contact_id` direto.
  //
  // Módulo pode não estar instalado nesta instalação — a tabela então não
  // existe (42P01) — e o bloco sai vazio nesse caso, sem falhar o export
  // inteiro por causa de um módulo que a organização nem ligou.
  let honorarios_contratos: HonorariosContratoRow[] = [];
  let honorarios_parcelas: HonorariosParcelaRow[] = [];
  const leadIds = leads.map((l) => l.id);
  if (leadIds.length > 0) {
    const { data, error } = await admin
      .from("honorarios_contratos")
      .select(
        "id, lead_id, modelo, valor_fixo_cents, percentual_exito, repasse_advogado_pct, created_at",
      )
      .eq("organization_id", organizationId)
      .in("lead_id", leadIds);
    // Qualquer OUTRO erro lança: o worker marca a tentativa como falha e tenta de
    // novo, em vez de entregar ao titular um export sem o contrato como se fosse
    // completo (ADR-0002 D8 — seção de módulo ilegível nunca sai como completa).
    if (error) {
      if (error.code !== "42P01") {
        throw new Error(`honorarios_contratos_load_failed: ${error.message}`);
      }
    } else if (data) {
      honorarios_contratos = data;
      const contratoIds = data.map((c) => c.id);
      if (contratoIds.length > 0) {
        const { data: parcelas, error: erroParcelas } = await admin
          .from("honorarios_parcelas")
          .select("id, contrato_id, numero, vencimento, valor_cents, status, financial_entry_id")
          .eq("organization_id", organizationId)
          .in("contrato_id", contratoIds)
          .order("numero", { ascending: true });
        if (erroParcelas) {
          throw new Error(`honorarios_parcelas_load_failed: ${erroParcelas.message}`);
        } else if (parcelas) {
          honorarios_parcelas = parcelas;
        }
      }
    }
  }

  // Orders (contact_id when available, otherwise external_customer_id).
  let orders: OrderRow[] = [];
  {
    let q = admin
      .from("orders")
      .select(
        "id, external_id, external_provider, status, total_cents, currency, ordered_at, contact_id, customer_external_id",
      )
      .eq("organization_id", organizationId)
      .order("ordered_at", { ascending: false, nullsFirst: false })
      .limit(500);
    if (contactId) {
      q = q.eq("contact_id", contactId);
    } else if (externalCustomerId) {
      q = q.eq("customer_external_id", externalCustomerId);
    }
    const { data, error } = await q;
    if (error) {
      logger.warn("[lgpd-export-worker] orders load failed", {
        request_id: requestId,
        error: error.message,
      });
    } else if (data) {
      orders = data.map((o) => ({
        id: o.id,
        external_id: o.external_id,
        external_provider: o.external_provider,
        status: o.status,
        total_cents: o.total_cents,
        currency: o.currency,
        ordered_at: o.ordered_at,
      }));
    }
  }

  // Activities — direct contact_id on crm_lead_activities.
  let activities: ActivityRow[] = [];
  if (contactId) {
    const { data, error } = await admin
      .from("crm_lead_activities")
      .select("id, lead_id, type, source_module, performed_at")
      .eq("organization_id", organizationId)
      .eq("contact_id", contactId)
      .order("performed_at", { ascending: false })
      .limit(500);
    if (error) {
      logger.warn("[lgpd-export-worker] activities load failed", {
        request_id: requestId,
        error: error.message,
      });
    } else if (data) {
      activities = data;
    }
  }

  // Resumos do agente — contact_id direto em lead_checkpoints.
  let checkpoints: CheckpointRow[] = [];
  if (contactId) {
    const { data, error } = await admin
      .from("lead_checkpoints")
      .select("id, rolling_summary, commitments, objections, next_action, created_at")
      .eq("organization_id", organizationId)
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      logger.warn("[lgpd-export-worker] checkpoints load failed", {
        request_id: requestId,
        error: error.message,
      });
    } else if (data) {
      checkpoints = data;
    }
  }

  // Agenda — contact_id direto em calendar_appointments.
  //
  // ⚠️ ESTA METADE FALTAVA, e a outra tinha gate. A migration 0184 declarou esta
  // tabela dado pessoal e ligou o trigger de REDAÇÃO; esta branch escreveu
  // `tests/invariants/agenda-lgpd-alcanca.test.ts` com quatro casos para provar
  // a redação — e ninguém acrescentou a agenda ao EXPORT. O titular exercia o
  // Art. 18 II e recebia um relatório que não mencionava nenhuma consulta que
  // ele marcou. Neste repo, redigir e exportar sempre andaram juntos.
  let appointments: AppointmentRow[] = [];
  if (contactId) {
    const { data, error } = await admin
      .from("calendar_appointments")
      .select(
        "id, title, description, notes, location_details, cancellation_reason, starts_at, ends_at, time_zone, status, google_base_projection, google_conflict, google_pending_write, meeting_url, meeting_state",
      )
      .eq("organization_id", organizationId)
      .eq("contact_id", contactId)
      .order("starts_at", { ascending: false })
      .limit(500);
    if (error) {
      logger.warn("[lgpd-export-worker] appointments load failed", {
        request_id: requestId,
        error: error.message,
      });
    } else if (data) {
      appointments = data;
    }
  }

  // Comandas — contact_id direto em sales (migrations 0350-0359).
  //
  // A 0359 acrescentou esta tabela à cascata de redação; este bloco é a outra
  // metade, escrita no mesmo PR. Sem ele, o titular pediria acesso e receberia
  // um relatório que não menciona nenhuma compra que ele fez — o defeito que
  // `tests/unit/lgpd-exporta-o-que-redige.test.ts` existe para pegar, e que
  // pegou este bloco antes de ele ser escrito.
  let sales: SaleRow[] = [];
  if (contactId) {
    const { data, error } = await admin
      .from("sales")
      .select(
        "id, number, status, total_cents, currency, notes, cancel_reason, reverse_reason, finalized_at, created_at",
      )
      .eq("organization_id", organizationId)
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      logger.warn("[lgpd-export-worker] sales load failed", {
        request_id: requestId,
        error: error.message,
      });
    } else if (data) {
      sales = data;
    }
  }

  // Propostas comerciais — contact_id direto em crm_proposals. A 0477
  // acrescentou destinatario_nome/briefing_json/resumo_comercial à cascata de
  // redação; este bloco é a outra metade — sem ele, o titular pediria acesso
  // e receberia um relatório que não menciona nenhuma proposta que recebeu.
  let proposals: ProposalRow[] = [];
  if (contactId) {
    const { data, error } = await admin
      .from("crm_proposals")
      .select(
        "id, numero, ano, titulo, status, total_cents, moeda, valid_until, sent_at, decided_at, destinatario_nome, resumo_comercial, pdf_path, created_at",
      )
      .eq("organization_id", organizationId)
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      logger.warn("[lgpd-export-worker] proposals load failed", {
        request_id: requestId,
        error: error.message,
      });
    } else if (data) {
      proposals = data.map(({ pdf_path, ...p }) => ({ ...p, tem_pdf: Boolean(pdf_path) }));
    }
  }

  // Empresas e pessoas (0448/0449) — ver o comentário do campo `b2b` no tipo.
  // A pessoa vem de `contacts.person_id`; as linhas de planilha casam pelo
  // contato OU pela pessoa, o MESMO escopo da redação da 0449. Erro lança:
  // um relatório sem este bloco diria ao titular que não guardamos o que
  // guardamos.
  let b2b: ExportPayload["b2b"];
  if (contactId) {
    const { data: vinculo, error: eVinculo } = await admin
      .from("contacts")
      .select("person_id")
      .eq("organization_id", organizationId)
      .eq("id", contactId)
      .maybeSingle();
    if (eVinculo) throw eVinculo;
    const personId = vinculo?.person_id ?? null;
    let pessoa: NonNullable<ExportPayload["b2b"]>["pessoa"] = null;
    let vinculos: NonNullable<ExportPayload["b2b"]>["vinculos"] = [];
    if (personId) {
      const { data: p, error: eP } = await admin
        .from("people")
        .select("id, full_name, email, notes, created_at")
        .eq("organization_id", organizationId)
        .eq("id", personId)
        .maybeSingle();
      if (eP) throw eP;
      pessoa = p;
      const { data: v, error: eV } = await admin
        .from("company_people")
        .select("company_id, job_title, department, is_decision_maker, notes")
        .eq("organization_id", organizationId)
        .eq("person_id", personId)
        .limit(500);
      if (eV) throw eV;
      vinculos = v ?? [];
    }
    const { data: linhas, error: eL } = await admin
      .from("import_rows")
      .select("id, batch_id, row_number, status, raw_data, normalized_data, error, created_at")
      .eq("organization_id", organizationId)
      .or(personId ? `contact_id.eq.${contactId},person_id.eq.${personId}` : `contact_id.eq.${contactId}`)
      .order("created_at", { ascending: false })
      .limit(500);
    if (eL) throw eL;
    if (pessoa || vinculos.length > 0 || (linhas ?? []).length > 0) {
      b2b = { pessoa, vinculos, linhas_importadas: linhas ?? [] };
    }
  }

  // Tarefas — contact_id direto em crm_tasks (migration 0210).
  //
  // O texto que a equipe escreveu sobre o titular ("ligar para Fulano confirmar
  // o orçamento") é dado dele. Se a anonimização o apaga — e ela apaga —, o
  // pedido de acesso tem de entregá-lo.
  let tasks: TaskRow[] = [];
  if (contactId) {
    const { data, error } = await admin
      .from("crm_tasks")
      .select("id, title, description, due_date, status, priority")
      .eq("organization_id", organizationId)
      .eq("contact_id", contactId)
      .order("due_date", { ascending: false })
      .limit(500);
    if (error) {
      logger.warn("[lgpd-export-worker] tasks load failed", {
        request_id: requestId,
        error: error.message,
      });
    } else if (data) {
      tasks = data;
    }
  }

  // Chamadas de voz — `contact_id` direto em `voice_calls` (migration 0232).
  //
  // O que existe aqui é o REGISTRO da ligação, nunca o áudio: gravação está
  // deliberadamente fora do produto (spec 18 §1.2), então não há mídia a
  // enfileirar como acontece com foto e anexo.
  let voice_calls: VoiceCallRow[] = [];
  if (contactId) {
    const { data, error } = await admin
      .from("voice_calls")
      .select(
        "id, direction, peer_phone, status, end_reason, started_at, answered_at, ended_at, duration_ms",
      )
      .eq("organization_id", organizationId)
      .eq("contact_id", contactId)
      .order("started_at", { ascending: false })
      .limit(500);
    if (error) {
      logger.warn("[lgpd-export-worker] voice calls load failed", {
        request_id: requestId,
        error: error.message,
      });
    } else if (data) {
      voice_calls = data as VoiceCallRow[];
    }
  }

  // ── As que a migration 0266 achou, e o gate obrigou a trazer ─────────────
  //
  // O cruzamento que as encontrou: toda tabela com `contact_id` contra todo
  // caminho que anonimiza. Quinze tinham a coluna, onze eram cobertas, uma
  // (`lgpd_requests`) é exceção declarada — e três não eram alcançadas por
  // nada. Passaram a ser redigidas, e neste repositório redigir e exportar
  // andam juntos.
  //
  // A terceira era `demandas`, e ela NÃO é coletada aqui: o upstream trouxe a
  // mesma tabela pela cascata da 0280, no bloco dos casos mais abaixo, com o
  // mesmo filtro por `contact_id`, o mesmo teto de 500 e três colunas a mais.
  // Duas coletas gravariam a mesma variável duas vezes; ficou a mais completa.

  // Atendimentos da IA — o direito de saber que um robô atendeu você.
  //
  // É Art. 20 antes de ser Art. 18 II: decisão automatizada dá direito a saber
  // que houve, quando, e o que ela decidiu fazer. O que NÃO vai é o `tool_calls`
  // — a prosa do modelo e os argumentos de cada ferramenta. Não por ser segredo,
  // mas porque a 0266 o APAGA: depois da anonimização não há o que devolver, e
  // antes dela devolver o rastro interno inteiro entregaria também o nome de
  // quem operou e o conteúdo de outras buscas que o passo tenha feito.
  //
  // Alcança pela conversa além do `contact_id` porque metade das linhas nasce
  // antes de o contato ser resolvido — são justamente as do primeiro contato.
  //
  // FORK MIA: a lista é preenchida mais abaixo, pela MESMA leitura de
  // `ai_agent_runs` que o upstream trouxe na v1.65.0 para os argumentos das
  // ferramentas (#1965). Eram duas consultas à mesma tabela, e a cerca dele
  // (`lgpd-export-ia-e-memoria`) exige uma: a tabela é lida uma vez, e cada
  // parte do arquivo tira dela o que lhe cabe.
  const ai_runs: AiRunRow[] = [];

  // Disparos recebidos — "que campanhas vocês me mandaram" é pergunta de
  // acesso legítima, e no Brasil é a pergunta de quem quer sair de uma lista.
  let broadcasts_recebidos: BroadcastRecipientRow[] = [];
  if (contactId) {
    const { data, error } = await admin
      .from("broadcast_recipients")
      .select("id, broadcast_id, phone_e164, status, erro, enviado_em, created_at")
      .eq("organization_id", organizationId)
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      logger.warn("[lgpd-export-worker] broadcast recipients load failed", {
        request_id: requestId,
        error: error.message,
      });
    } else if (data) {
      broadcasts_recebidos = data as BroadcastRecipientRow[];
    }
  }

  // FORK MIA — documentos e obrigações (migration 9018). O MESMO escopo que o
  // gatilho de anonimização usa (`fn_mia_obrigacoes_do_contato_anonimizado`):
  // os itens ligados à pessoa e os dos negócios dela. É a outra metade do par
  // que `tests/unit/lgpd-exporta-o-que-redige.test.ts` deriva da fonte.
  const obrigacoes: ObrigacaoExportada[] = [];
  if (contactId) {
    const linhas: LinhaDeObrigacaoExportada[] = [];
    const doContato = await admin
      .from("mia_obrigacoes")
      .select("id, nome, categoria, lead_id, contact_id, quem_entrega, recorrencia, pedido_em, prazo_em, recebido_em, valido_ate, proxima_em, feita_em, ciclo, arquivo_nome, arquivo_mime, observacao, created_at")
      .eq("organization_id", organizationId)
      .eq("contact_id", contactId)
      .order("created_at", { ascending: true })
      .limit(500);
    if (doContato.error) {
      logger.warn("[lgpd-export-worker] obrigacoes load failed", { request_id: requestId, error: doContato.error.message });
    } else {
      linhas.push(...((doContato.data ?? []) as LinhaDeObrigacaoExportada[]));
    }
    for (let batch = 0; batch < leadIds.length; batch += 100) {
      const dosNegocios = await admin
        .from("mia_obrigacoes")
        .select("id, nome, categoria, lead_id, contact_id, quem_entrega, recorrencia, pedido_em, prazo_em, recebido_em, valido_ate, proxima_em, feita_em, ciclo, arquivo_nome, arquivo_mime, observacao, created_at")
        .eq("organization_id", organizationId)
        .in("lead_id", leadIds.slice(batch, batch + 100))
        .limit(500);
      if (dosNegocios.error) {
        logger.warn("[lgpd-export-worker] obrigacoes dos negocios load failed", { request_id: requestId, error: dosNegocios.error.message });
        break;
      }
      for (const linha of (dosNegocios.data ?? []) as LinhaDeObrigacaoExportada[]) {
        if (!linhas.some((l) => l.id === linha.id)) linhas.push(linha);
      }
    }
    const idsDasObrigacoes = linhas.map((l) => l.id);
    const ciclosPorItem = new Map<string, ObrigacaoExportada["ciclos"]>();
    for (let batch = 0; batch < idsDasObrigacoes.length; batch += 100) {
      const { data, error } = await admin
        .from("mia_obrigacoes_ciclos")
        .select("obrigacao_id, ciclo, como, pedido_em, recebido_em, valido_ate, proxima_em, feita_em, arquivo_nome, encerrado_em")
        .eq("organization_id", organizationId)
        .in("obrigacao_id", idsDasObrigacoes.slice(batch, batch + 100))
        .order("ciclo", { ascending: true });
      if (error) {
        logger.warn("[lgpd-export-worker] ciclos de obrigacao load failed", { request_id: requestId, error: error.message });
        break;
      }
      for (const { obrigacao_id: item, ...ciclo } of (data ?? []) as Array<ObrigacaoExportada["ciclos"][number] & { obrigacao_id: string }>) {
        ciclosPorItem.set(item, [...(ciclosPorItem.get(item) ?? []), ciclo]);
      }
    }
    const propostasPorItem = new Map<string, ObrigacaoExportada["propostas"]>();
    const propostasDoContato = await admin
      .from("mia_obrigacoes_propostas")
      .select("obrigacao_id, arquivo_nome, situacao, created_at, decidida_em")
      .eq("organization_id", organizationId)
      .eq("contact_id", contactId)
      .order("created_at", { ascending: true })
      .limit(500);
    if (propostasDoContato.error) {
      logger.warn("[lgpd-export-worker] propostas de obrigacao load failed", { request_id: requestId, error: propostasDoContato.error.message });
    } else {
      for (const { obrigacao_id: item, ...proposta } of (propostasDoContato.data ?? []) as Array<ObrigacaoExportada["propostas"][number] & { obrigacao_id: string }>) {
        propostasPorItem.set(item, [...(propostasPorItem.get(item) ?? []), proposta]);
      }
    }
    for (const { contact_id: doTitular, ...linha } of linhas) {
      obrigacoes.push({
        ...linha,
        ligado_a: doTitular === contactId ? "contato" : "negocio",
        ciclos: ciclosPorItem.get(linha.id) ?? [],
        propostas: propostasPorItem.get(linha.id) ?? [],
      });
    }
  }

  // Cliques em anúncio — a pergunta do outro lado do disparo: não "o que vocês
  // me mandaram", mas "por qual anúncio vocês me acharam, e o que guardaram".
  // Dois blocos e não um laço: a catraca lgpd-exporta-o-que-redige reconhece a
  // tabela pelo `.from("nome")` literal, e um nome em variável ficaria invisível.
  const cliques_de_anuncio: AdClickRow[] = [];
  if (contactId) {
    const { data, error } = await admin
      .from("google_ads_click_refs")
      .select("id, gclid, query_raw, created_at, matched_at")
      .eq("organization_id", organizationId)
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      logger.warn("[lgpd-export-worker] google ads click refs load failed", {
        request_id: requestId,
        error: error.message,
      });
    } else if (data) {
      for (const r of data as Array<{
        id: string;
        gclid: string;
        query_raw: Record<string, unknown> | null;
        created_at: string;
        matched_at: string | null;
      }>) {
        cliques_de_anuncio.push({
          rede: "google",
          id: r.id,
          campanha: r.gclid,
          query_raw: r.query_raw ?? {},
          created_at: r.created_at,
          matched_at: r.matched_at,
        });
      }
    }
  }
  if (contactId) {
    const { data, error } = await admin
      .from("meta_ads_click_refs")
      .select("id, utm, query_raw, created_at, matched_at")
      .eq("organization_id", organizationId)
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      logger.warn("[lgpd-export-worker] meta ads click refs load failed", {
        request_id: requestId,
        error: error.message,
      });
    } else if (data) {
      for (const r of data as Array<{
        id: string;
        utm: Record<string, unknown>;
        query_raw: Record<string, unknown> | null;
        created_at: string;
        matched_at: string | null;
      }>) {
        cliques_de_anuncio.push({
          rede: "meta",
          id: r.id,
          campanha: r.utm,
          query_raw: r.query_raw ?? {},
          created_at: r.created_at,
          matched_at: r.matched_at,
        });
      }
    }
  }

  // Campanhas — `contact_id` direto em `campaign_recipients` (migration 0375).
  let campaign_recipients: CampaignRecipientRow[] = [];
  if (contactId) {
    const { data, error } = await admin
      .from("campaign_recipients")
      .select(
        "id, campaign_id, status, eligibility_status, exclusion_reason, rendered_body, sent_at, delivered_at, read_at, replied_at, opted_out_at",
      )
      .eq("organization_id", organizationId)
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      logger.warn("[lgpd-export-worker] campaign recipients load failed", {
        request_id: requestId,
        error: error.message,
      });
    } else if (data) {
      campaign_recipients = data as unknown as CampaignRecipientRow[];
    }
  }

  // Lista de exclusão de campanhas — `contact_id` direto (migration 0375).
  let campaign_suppressions: CampaignSuppressionRow[] = [];
  if (contactId) {
    const { data, error } = await admin
      .from("campaign_suppressions")
      .select("id, address_tail, reason, source, created_at")
      .eq("organization_id", organizationId)
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      logger.warn("[lgpd-export-worker] campaign suppressions load failed", {
        request_id: requestId,
        error: error.message,
      });
    } else if (data) {
      campaign_suppressions = data as unknown as CampaignSuppressionRow[];
    }
  }

  // Grupos de WhatsApp — `contact_id` direto em `channel_session_groups`
  // (migration 0482). Ver o docstring de `ChannelSessionGroupRow`: a FK só
  // aponta para o CONTATO PLACEHOLDER do grupo, então este bloco só devolve
  // linha quando o titular do pedido é esse placeholder — o mesmo escopo que a
  // redação usa (`fn_lgpd_cascade_redact_contact`, `contact_id = p_contact_id`).
  let channel_session_groups: ChannelSessionGroupRow[] = [];
  if (contactId) {
    const { data, error } = await admin
      .from("channel_session_groups")
      .select("id, group_chat_id, subject, enabled, enabled_at, created_at")
      .eq("organization_id", organizationId)
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      logger.warn("[lgpd-export-worker] channel session groups load failed", {
        request_id: requestId,
        error: error.message,
      });
    } else if (data) {
      channel_session_groups = data;
    }
  }

  // Mensagens de grupo escritas pelo titular — ver `group_messages_authored`.
  // Duas consultas (telefone, lid) em vez de um `or` sobre caminho JSON: cada
  // uma é um filtro simples, e a união por id desfaz a mensagem que casa as duas.
  const porId = new Map<string, MessageRow>();
  const telefones = contact?.phone_number ? phoneLookupVariants(contact.phone_number) : [];
  const buscas = [
    telefones.length > 0 ? { campo: "metadata->group_sender->>phone", valores: telefones } : null,
    contactLid ? { campo: "metadata->group_sender->>lid", valores: [contactLid] } : null,
  ];
  for (const busca of buscas) {
    if (!busca) continue;
    const { data, error } = await admin
      .from("messages")
      .select("id, conversation_id, direction, type, status, body, media_url, media_derived_text, sent_at, created_at")
      .eq("organization_id", organizationId)
      .in(busca.campo, busca.valores)
      .order("created_at", { ascending: false })
      .limit(RECENT_MESSAGES_LIMIT);
    if (error) {
      logger.warn("[lgpd-export-worker] group messages load failed", {
        request_id: requestId,
        error: error.message,
      });
      continue;
    }
    for (const m of data ?? []) {
      porId.set(m.id, {
        id: m.id,
        conversation_id: m.conversation_id,
        direction: m.direction,
        type: m.type,
        status: m.status,
        body: m.body,
        has_media: Boolean(m.media_url),
        media_derived_text: m.media_derived_text ?? null,
        sent_at: m.sent_at,
        created_at: m.created_at,
      });
    }
  }
  const group_messages_authored = [...porId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));

  // Captação por webhook — a MESMA classe do bloco acima, achada pelo gate.
  let webhook_captures: CaptureRow[] = [];
  if (contactId) {
    const { data, error } = await admin
      .from("webhook_lead_captures")
      .select(
        "id, source_name, outcome, captured_name, captured_phone, captured_email, fields, utm, remote_ip, user_agent, received_at",
      )
      .eq("organization_id", organizationId)
      .eq("contact_id", contactId)
      .order("received_at", { ascending: false })
      .limit(500);
    if (error) {
      logger.warn("[lgpd-export-worker] webhook captures load failed", {
        request_id: requestId,
        error: error.message,
      });
    } else if (data) {
      webhook_captures = data;
    }
  }

  // Propostas de campo do contato: a anonimização as APAGA, e o valor proposto é
  // dado do titular. Mesmo escopo da função que apaga, com os ids internos fora.
  //
  // POR PÁGINA, não por teto: esta fila a IA alimenta enquanto a conversa dura, e
  // um `limit` faria as mais antigas sumirem do relatório sem ninguém saber. A
  // chave é `id` (única) — ordenar por `proposed_at` deixaria empates decidirem a
  // página. Mesma forma do bloco dos rascunhos, logo acima.
  const contact_field_proposals: NonNullable<ExportPayload["contact_field_proposals"]> = [];
  if (contactId) {
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await admin
        .from("contact_field_proposals")
        .select(
          "id, campo, valor_proposto, valor_anterior, conversation_id, trecho, status, proposed_at, decided_at, motivo_recusa",
        )
        .eq("organization_id", organizationId)
        .eq("contact_id", contactId)
        .order("id")
        .range(offset, offset + 499);
      // Uma falha não pode virar um relatório que diz que não guardamos dados.
      if (error) throw error;
      contact_field_proposals.push(...(data ?? []));
      if (!data || data.length < 500) break;
    }
  }

  // Audit log extract (best-effort: rows where metadata.contact_id matches).
  let audit_log_extract: AuditRow[] = [];
  if (contactId) {
    const { data, error } = await admin
      .from("api_audit_log")
      .select("id, action, resource_type, resource_id, created_at, metadata")
      .eq("organization_id", organizationId)
      .or(`resource_id.eq.${contactId},metadata->>contact_id.eq.${contactId}`)
      .order("created_at", { ascending: false })
      .limit(AUDIT_LIMIT);
    if (error) {
      logger.warn("[lgpd-export-worker] audit load failed", {
        request_id: requestId,
        error: error.message,
      });
    } else if (data) {
      audit_log_extract = data.map((a) => ({
        id: a.id,
        action: a.action,
        resource_type: a.resource_type,
        resource_id: a.resource_id,
        created_at: a.created_at,
      }));
    }
  }

  // A 0226/0229 redige estes registros. Só o FK de contato e os compromissos
  // comprovados abaixo dão escopo: nunca o conteúdo livre de um aviso ou a
  // autorização privada do job. Paginar os IDs evita perder avisos de consultas
  // antigas além do recorte de appointments mostrado no relatório.
  const reply_drafts: NonNullable<ExportPayload["reply_drafts"]> = [];
  if (contactId) {
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await admin
        .from("ai_reply_drafts")
        .select("id,status,original_body,edited_body,approved_body,proposals,feedback,created_at")
        .eq("organization_id", organizationId)
        .eq("contact_id", contactId)
        .order("id")
        .range(offset, offset + 499);
      if (error) throw error;
      reply_drafts.push(...(data ?? []));
      if (!data || data.length < 500) break;
    }
  }
  // Espelha exatamente o escopo da redação 0361: contato + organização.
  // Telefone coincidente sem vínculo não comprova identidade. Tokens de
  // supressão e a autorização de envio permanecem internos, fora da projeção.
  const prospecting_candidates: ProspectingCandidateRow[] = [];
  if (contactId) {
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await admin
        .from("prospecting_candidates")
        .select(
          "id,campaign_id,place_id,phone,data,status,lead_id,conversation_id,attempted_at,error,created_at,updated_at",
        )
        .eq("organization_id", organizationId)
        .eq("contact_id", contactId)
        .order("id")
        .range(offset, offset + 499);
      // Uma falha não pode virar um relatório que diz que não guardamos dados.
      if (error) throw error;
      prospecting_candidates.push(...(data ?? []));
      if (!data || data.length < 500) break;
    }
  }
  // Memória da IA, registros de execução e estado da lead — o que a cascata
  // (#1957) redige a pedido de eliminação, e que o acesso entrega de volta.
  //
  // as três têm `contact_id` + `organization_id` na própria linha, então o
  // escopo sai do mesmo `eq` que a cascata usa — sem depender de derivação
  // por conversa ou lead. `lead_state.qualification` sai íntegro; de
  // `ai_agent_runs.tool_calls` saem os argumentos, não o resultado das
  // ferramentas, que pode trazer dado de outras pessoas (`toolCallsParaOTitular`).
  const lead_notes: NonNullable<ExportPayload["lead_notes"]> = [];
  const ai_agent_runs: NonNullable<ExportPayload["ai_agent_runs"]> = [];
  const lead_state: NonNullable<ExportPayload["lead_state"]> = [];
  if (contactId) {
    // A tabela entra por `.from("<nome>")` literal em quem chama, não por
    // parâmetro: `tests/unit/lgpd-exporta-o-que-redige.test.ts` só reconhece a
    // tabela exportada pelo literal, e um `.from(tabela)` a deixava invisível.
    const lePaginado = async (
      pagina: (
        de: number,
        ate: number,
      ) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
    ): Promise<Record<string, unknown>[]> => {
      const linhas: Record<string, unknown>[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await pagina(offset, offset + 499);
        if (error) throw error;
        linhas.push(...((data ?? []) as unknown as Record<string, unknown>[]));
        if (!data || data.length < 500) break;
      }
      return linhas;
    };
    for (const nota of await lePaginado((de, ate) =>
      admin
        .from("lead_notes")
        .select("id, headline, body, created_at, updated_at")
        .eq("organization_id", organizationId)
        .eq("contact_id", contactId)
        .order("id")
        .range(de, ate),
    )) {
      lead_notes.push(nota as NonNullable<ExportPayload["lead_notes"]>[number]);
    }
    // FORK MIA: a leitura também alcança as conversas do titular (as linhas que
    // nasceram antes de o contato ser resolvido) e traz as colunas dos
    // "Atendimentos da IA" (`ai_runs`, acima). Os argumentos das ferramentas
    // continuam só das linhas com o `contact_id` do titular, como o upstream
    // decidiu: a linha sem contato não é redigida pela cascata dele.
    const idsDeConversaDoTitular = conversations.map((c) => c.id);
    for (const run of await lePaginado((de, ate) => {
      const q = admin
        .from("ai_agent_runs")
        .select(
          "id, tool_calls, created_at, contact_id, status, abort_reason, steps_count, started_at, completed_at",
        )
        .eq("organization_id", organizationId);
      return (
        idsDeConversaDoTitular.length > 0
          ? q.or(
              `contact_id.eq.${contactId},conversation_id.in.(${idsDeConversaDoTitular.join(",")})`,
            )
          : q.eq("contact_id", contactId)
      )
        .order("id")
        .range(de, ate);
    })) {
      ai_runs.push({
        id: run.id as string,
        status: run.status as string,
        abort_reason: (run.abort_reason as string | null) ?? null,
        steps_count: run.steps_count as number,
        started_at: run.started_at as string,
        completed_at: (run.completed_at as string | null) ?? null,
      });
      if (run.contact_id !== contactId) continue;
      ai_agent_runs.push({
        id: run.id as string,
        tool_calls: toolCallsParaOTitular(run.tool_calls),
        created_at: (run.created_at as string | null) ?? null,
      });
    }
    // O teto e a ordem de antes: os 500 atendimentos mais recentes.
    ai_runs.sort((a, b) => (a.started_at < b.started_at ? 1 : a.started_at > b.started_at ? -1 : 0));
    ai_runs.splice(500);
    for (const estado of await lePaginado((de, ate) =>
      admin
        .from("lead_state")
        .select("id, next_action, qualification, updated_at")
        .eq("organization_id", organizationId)
        .eq("contact_id", contactId)
        .order("id")
        .range(de, ate),
    )) {
      lead_state.push(estado as NonNullable<ExportPayload["lead_state"]>[number]);
    }
  }
  // Casos, linha do tempo do caso e demandas — o que a 0280 pôs na cascata.
  //
  // O escopo do CASO é a CONVERSA do titular: `agent_cases` não tem FK para
  // `contacts`. Os ids das conversas são paginados por conta própria em vez de
  // reaproveitar a projeção `conversations` acima — ela tem teto de 500 e existe
  // para o relatório. Usá-la como filtro faria o titular com mais de 500
  // conversas receber um export sem os casos das excedentes, em silêncio.
  const cases: CaseRow[] = [];
  const case_events: CaseEventRow[] = [];
  let demandas: DemandaRow[] = [];
  const case_chat_messages: CaseChatMessageRow[] = [];
  const passagens: PassagemDeAtendimentoRow[] = [];
  const avisos_de_caso: AvisoDeCasoEntregaRow[] = [];
  const conversation_drafts: NonNullable<ExportPayload["conversation_drafts"]> = [];
  const conversation_notes: NonNullable<ExportPayload["conversation_notes"]> = [];
  if (contactId) {
    const pageSize = 500;
    const refBatchSize = 100; // Mantém o filtro IN abaixo dos limites de URL dos proxies.
    const conversationIds: string[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await admin
        .from("conversations")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("contact_id", contactId)
        .order("id")
        .range(offset, offset + pageSize - 1);
      if (error) {
        logger.warn("[lgpd-export-worker] case conversation refs load failed", {
          request_id: requestId,
          error: error.message,
        });
        break;
      }
      for (const conversa of data ?? []) conversationIds.push(conversa.id);
      if (!data || data.length < pageSize) break;
    }
    for (let batch = 0; batch < conversationIds.length; batch += refBatchSize) {
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await admin
          .from("agent_cases")
          .select(
            "id, conversation_id, status, title, summary, blocker, source, opened_at, closed_at, created_at",
          )
          .eq("organization_id", organizationId)
          .in("conversation_id", conversationIds.slice(batch, batch + refBatchSize))
          .order("id")
          .range(offset, offset + pageSize - 1);
        if (error) {
          logger.warn("[lgpd-export-worker] cases load failed", {
            request_id: requestId,
            error: error.message,
          });
          break;
        }
        cases.push(...(data ?? []));
        if (!data || data.length < pageSize) break;
      }
    }
    // A linha do tempo pende do caso já coletado: um `case_id` que não esteja em
    // `cases` seria de outro titular, e é por isso que o escopo sai daqui e não
    // de uma segunda derivação pela conversa.
    const caseIds = cases.map((caso) => caso.id);
    for (let batch = 0; batch < caseIds.length; batch += refBatchSize) {
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await admin
          .from("agent_case_events")
          .select("id, case_id, kind, actor_kind, human_action, body, metadata, created_at")
          .eq("organization_id", organizationId)
          .in("case_id", caseIds.slice(batch, batch + refBatchSize))
          .order("id")
          .range(offset, offset + pageSize - 1);
        if (error) {
          logger.warn("[lgpd-export-worker] case events load failed", {
            request_id: requestId,
            error: error.message,
          });
          break;
        }
        case_events.push(...(data ?? []));
        if (!data || data.length < pageSize) break;
      }
    }
    // Demanda tem FK direta para o contato (`contact_id` é `not null`).
    const { data, error } = await admin
      .from("demandas")
      .select(
        "id, agent_case_id, origem, assunto, estado, dono_kind, proximo_passo, desfecho, aberta_em, fechada_em",
      )
      .eq("organization_id", organizationId)
      .eq("contact_id", contactId)
      .order("aberta_em", { ascending: false })
      .limit(500);
    if (error) {
      logger.warn("[lgpd-export-worker] demandas load failed", {
        request_id: requestId,
        error: error.message,
      });
    } else if (data) {
      demandas = data;
    }
    // A conversa interna sobre o caso (migration 0281). FK direta para o
    // contato, então não passa pelos ids de conversa acima — e paginada, e não
    // com `limit`, porque uma deliberação longa num titular antigo não pode
    // sumir do relatório em silêncio.
    for (let offset = 0; ; offset += pageSize) {
      const { data: pagina, error: erro } = await admin
        .from("agent_case_chat_messages")
        .select("id, case_id, turn_id, author_kind, body, error_code, created_at")
        .eq("organization_id", organizationId)
        .eq("contact_id", contactId)
        .order("id")
        .range(offset, offset + pageSize - 1);
      if (erro) {
        logger.warn("[lgpd-export-worker] case chat messages load failed", {
          request_id: requestId,
          error: erro.message,
        });
        break;
      }
      case_chat_messages.push(...(pagina ?? []));
      if (!pagina || pagina.length < pageSize) break;
    }
    // As passagens para uma pessoa (migration 0291). FK direta para o contato,
    // como a de cima, e paginada pela mesma razão: um titular de dois anos pode
    // ter dezenas, e um `limit` faria as mais antigas sumirem do relatório sem
    // ninguém saber que sumiram.
    for (let offset = 0; ; offset += pageSize) {
      const { data: pagina, error: erro } = await admin
        .from("passagens_de_atendimento")
        // UM literal, sem concatenação: o supabase-js lê a lista de colunas do
        // TIPO da string para inferir a linha, e `"a" + "b"` vira `string` —
        // a linha volta como `GenericStringError` e o `push` não compila.
        .select("id, conversation_id, caso_id, motor, origem, motivo_codigo, title, body, notes, content, tentativas, cliente_avisado, aviso_motivo_codigo, criado_em, reconhecido_em")
        .eq("organization_id", organizationId)
        .eq("contact_id", contactId)
        .order("id")
        .range(offset, offset + pageSize - 1);
      if (erro) {
        logger.warn("[lgpd-export-worker] passagens load failed", {
          request_id: requestId,
          error: erro.message,
        });
        break;
      }
      passagens.push(...(pagina ?? []));
      if (!pagina || pagina.length < pageSize) break;
    }
    // Os rascunhos das conversas do titular — o MESMO escopo que a função de
    // anonimização usa, a partir dos ids já paginados acima: sem FK para
    // `contacts`, nenhuma outra leitura alcançaria a tabela.
    for (let batch = 0; batch < conversationIds.length; batch += refBatchSize) {
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await admin
          .from("conversation_drafts")
          .select("id, conversation_id, body, source, consumed_at, created_at")
          .eq("organization_id", organizationId)
          .in("conversation_id", conversationIds.slice(batch, batch + refBatchSize))
          .order("id")
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        conversation_drafts.push(...(data ?? []));
        if (!data || data.length < pageSize) break;
      }
    }
    // As NOTAS INTERNAS das conversas do titular (migration 0483) — MESMO
    // escopo dos rascunhos, pelos mesmos ids já paginados: `conversation_notes`
    // não tem FK para `contacts`, e sem este bloco o Art. 18 II entregaria um
    // relatório que omita o que a equipe anotou sobre a pessoa. É a outra
    // metade do par que `tests/unit/lgpd-exporta-o-que-redige.test.ts` deriva
    // da fonte (a cascata 0483 passa a redigir esta tabela) e reprova quem
    // redige e não exporta. A mídia entra como metadado — caminho, MIME e
    // bytes — porque o export é `data.json` + `report.pdf`.
    for (let batch = 0; batch < conversationIds.length; batch += refBatchSize) {
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await admin
          .from("conversation_notes")
          // Literal, sem concatenação: o supabase-js lê as colunas do TIPO da
          // string para inferir a linha, e string montada volta como
          // `GenericStringError` e não compila (mesma pegadinha logo acima).
          .select("id, conversation_id, body, media_storage_path, media_mime, media_size_bytes, created_at, created_by_name")
          .eq("organization_id", organizationId)
          .in("conversation_id", conversationIds.slice(batch, batch + refBatchSize))
          .order("id")
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        conversation_notes.push(...(data ?? []));
        if (!data || data.length < pageSize) break;
      }
    }
    // O registro de entrega do aviso ao suporte (migration 0292). O escopo sai
    // dos CASOS já coletados, e não de uma segunda derivação pela conversa: um
    // `case_id` que não esteja em `cases` seria de outro titular.
    //
    // A cascata de LGPD zera `erro_detalhe` desta tabela, e é por isso que ela
    // entra aqui: `tests/unit/lgpd-exporta-o-que-redige.test.ts` deriva as duas
    // pontas da fonte e reprova quem redige e não exporta — o que se apaga a
    // pedido do titular é o que se entrega a pedido dele.
    for (let batch = 0; batch < caseIds.length; batch += refBatchSize) {
      for (let offset = 0; ; offset += pageSize) {
        const { data: pagina, error: erro } = await admin
          .from("entregas_de_aviso_de_caso")
          .select("id, case_id, destino, status, erro_codigo, tentativas, enviado_em, created_at")
          .eq("organization_id", organizationId)
          .in("case_id", caseIds.slice(batch, batch + refBatchSize))
          .order("id")
          .range(offset, offset + pageSize - 1);
        if (erro) {
          logger.warn("[lgpd-export-worker] avisos de caso load failed", {
            request_id: requestId,
            error: erro.message,
          });
          break;
        }
        for (const linha of pagina ?? []) {
          const { destino, ...resto } = linha;
          avisos_de_caso.push({ ...resto, destino_mascarado: maskPhone(destino) });
        }
        if (!pagina || pagina.length < pageSize) break;
      }
    }
  }

  const meeting_deliveries: MeetingDeliveryRow[] = [];
  const appointment_notices: AppointmentNoticeRow[] = [];
  if (contactId) {
    const appointmentIds = new Set<string>();
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await admin
        .from("calendar_appointments")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("contact_id", contactId)
        .order("id")
        .range(offset, offset + pageSize - 1);
      if (error) {
        logger.warn("[lgpd-export-worker] meeting references load failed", {
          request_id: requestId,
        });
        break;
      }
      for (const appointment of data ?? []) appointmentIds.add(appointment.id);
      if (!data || data.length < pageSize) break;
    }
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await admin
        .from("job_queue")
        .select("id,status,created_at,run_after,appointment_id:payload->>appointment_id")
        .eq("organization_id", organizationId)
        .eq("contact_id", contactId)
        .eq("kind", "transactional_delivery")
        .order("id")
        .range(offset, offset + pageSize - 1);
      if (error) {
        logger.warn("[lgpd-export-worker] meeting deliveries load failed", {
          request_id: requestId,
        });
        break;
      }
      for (const job of data ?? [])
        meeting_deliveries.push({
          id: job.id,
          status: job.status,
          created_at: job.created_at,
          run_after: job.run_after,
          appointment_id:
            typeof job.appointment_id === "string" && appointmentIds.has(job.appointment_id)
              ? job.appointment_id
              : null,
        });
      if (!data || data.length < pageSize) break;
    }
    const ids = [...appointmentIds];
    const refBatchSize = 100; // Mantém o filtro IN abaixo dos limites de URL dos proxies.
    for (let batch = 0; batch < ids.length; batch += refBatchSize) {
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await admin
          .from("agent_inbox_items")
          .select("id,ref_id,title,body,status,created_at,resolved_at")
          .eq("organization_id", organizationId)
          .eq("ref_kind", "appointment")
          .in("kind", ["other", "appointment_outcome_required", "appointment_recovery_review"])
          .in("ref_id", ids.slice(batch, batch + refBatchSize))
          .order("id")
          .range(offset, offset + pageSize - 1);
        if (error) {
          logger.warn("[lgpd-export-worker] appointment notices load failed", {
            request_id: requestId,
          });
          break;
        }
        for (const notice of data ?? [])
          appointment_notices.push({
            id: notice.id,
            ref_id: notice.ref_id,
            title: notice.title,
            body: notice.body,
            status: notice.status,
            created_at: notice.created_at,
            resolved_at: notice.resolved_at,
          });
        if (!data || data.length < pageSize) break;
      }
    }
  }

  const perfil = perfilDoPais(controlador.country);

  return {
    request_id: requestId,
    organization_id: organizationId,
    organization_legal_name: controlador.legal_name,
    organization_display_name: controlador.display_name,
    dpo_email: controlador.dpo_email,
    lei_citada: citacaoDaLei(perfil),
    documento_rotulo: perfil.documento.rotulo,
    generated_at: new Date().toISOString(),
    no_local_footprint:
      !contact &&
      conversations.length === 0 &&
      orders.length === 0 &&
      prospecting_candidates.length === 0,
    contact,
    consents,
    conversations,
    messages_count_total,
    messages_recent,
    leads,
    honorarios_contratos,
    honorarios_parcelas,
    orders,
    activities,
    checkpoints,
    appointments,
    sales,
    proposals,
    tasks,
    webhook_captures,
    audit_log_extract,
    reply_drafts,
    meeting_deliveries,
    ai_runs,
    broadcasts_recebidos,
    obrigacoes,
    cliques_de_anuncio,
    appointment_notices,
    voice_calls,
    prospecting_candidates,
    cases,
    case_events,
    demandas,
    case_chat_messages,
    passagens,
    avisos_de_caso,
    campaign_recipients,
    campaign_suppressions,
    channel_session_groups,
    group_messages_authored,
    conversation_drafts,
    conversation_notes,
    contact_field_proposals,
    lead_notes,
    ai_agent_runs,
    lead_state,
    b2b,
  };
}

function emptyPayload(
  requestId: string,
  organizationId: string,
  controlador: Controlador,
): ExportPayload {
  return {
    request_id: requestId,
    organization_id: organizationId,
    organization_legal_name: controlador.legal_name,
    organization_display_name: controlador.display_name,
    dpo_email: controlador.dpo_email,
    lei_citada: citacaoDaLei(perfilDoPais(controlador.country)),
    documento_rotulo: perfilDoPais(controlador.country).documento.rotulo,
    generated_at: new Date().toISOString(),
    no_local_footprint: true,
    contact: null,
    consents: [],
    conversations: [],
    messages_count_total: 0,
    messages_recent: [],
    leads: [],
    honorarios_contratos: [],
    honorarios_parcelas: [],
    orders: [],
    activities: [],
    checkpoints: [],
    appointments: [],
    sales: [],
    proposals: [],
    tasks: [],
    webhook_captures: [],
    audit_log_extract: [],
    meeting_deliveries: [],
    ai_runs: [],
    broadcasts_recebidos: [],
    cliques_de_anuncio: [],
    appointment_notices: [],
    voice_calls: [],
    prospecting_candidates: [],
    cases: [],
    case_events: [],
    demandas: [],
    case_chat_messages: [],
    passagens: [],
    avisos_de_caso: [],
    campaign_recipients: [],
    campaign_suppressions: [],
    channel_session_groups: [],
    group_messages_authored: [],
    lead_notes: [],
    ai_agent_runs: [],
    lead_state: [],
  };
}
