/**
 * FORK MIA · AS EMPRESAS DE DEMONSTRAÇÃO — a forma de UMA semente.
 *
 * O motor (`aplicar.ts`) é um só e recebe uma `SementeDeDemonstracao`: os dados
 * fictícios de uma empresa inteira. Há cinco, uma por segmento
 * (`segmentos/`):
 *
 *  - `bancada`: a "Empresa Modelo · Demonstração", com os dez funis de
 *    segmentos misturados. É a bancada de teste; os ids dela são os de antes
 *    (sem prefixo), para a empresa que já está em produção ser renovada, e não
 *    duplicada;
 *  - `construtora`, `clinica-odonto`, `industria`, `academia`: uma empresa por
 *    segmento, cada uma parecendo o negócio do cliente que vai vê-la.
 *
 * Tudo aqui é inventado e escrito para NUNCA bater em pessoa real: telefone do
 * DDD 00 (que não existe), e-mail `@exemplo.invalid` (RFC 2606) e CNPJ com os
 * dígitos verificadores errados de propósito (`cnpjFalso`).
 */
import type { LeadStage } from "@/lib/agent-engine/agent/lead-state";
import type { NichoDeModelo } from "@/lib/followup/modelos";
import type { ChaveDeModulo } from "@/lib/modulos/vendaveis";
import type { SegmentoDeObrigacao } from "@/lib/obrigacoes/catalogo";
import type { CategoriaDePerda } from "@/lib/schemas/leads";
import type { CustomFieldDef } from "@/lib/schemas/settings";

/** As empresas de demonstração, na ordem em que o MCP e o terminal as listam. */
export const SEGMENTOS_DE_DEMONSTRACAO = ["bancada", "construtora", "clinica-odonto", "industria", "academia"] as const;
export type SegmentoDeDemonstracao = (typeof SEGMENTOS_DE_DEMONSTRACAO)[number];

export function ehSegmentoDeDemonstracao(valor: unknown): valor is SegmentoDeDemonstracao {
  return typeof valor === "string" && (SEGMENTOS_DE_DEMONSTRACAO as readonly string[]).includes(valor);
}

// ─── A equipe ───────────────────────────────────────────────────────────────
//
// Pessoas fictícias, SEM senha e bloqueadas: existem para serem donas de
// negócio, de tarefa e de compromisso. Ninguém entra no sistema com elas. O
// e-mail delas é único na instalação inteira (`auth.users`), então o NOME de
// cada uma não se repete entre as sementes (o teste cobra).

export type PapelNaEquipe = "manager" | "agent";

export interface PessoaDaEquipe {
  chave: string;
  nome: string;
  papel: PapelNaEquipe;
  trilha: number;
}

/** A chave de uma pessoa da equipe, ou `"ia"` (o agente de IA da semente). */
export type DonoDoNegocio = string;

/** O agente de IA fictício. Nasce SEM versão publicada: não responde ninguém. */
export interface AgenteDaSemente {
  /** Parte do id estável (`agente:<chave>`). */
  chave: string;
  nome: string;
  descricao: string;
  prompt: string;
}

// ─── Empresas e contatos ────────────────────────────────────────────────────

export interface EmpresaDaSemente {
  chave: string;
  nome: string;
  site: string | null;
  cidade: string;
  uf: string;
  setor: string;
  observacoes: string | null;
  tags: string[];
  /** Só dígitos, com os verificadores errados (`cnpjFalso`). */
  cnpj?: string;
  /** Campos a mais da ficha da empresa (`crm_empresas.custom_fields`), além do setor. */
  campos?: Record<string, unknown>;
}

export interface ContatoDaSemente {
  chave: string;
  nome: string;
  /** Número sequencial do telefone falso (`telefoneFalso`). */
  n: number;
  /** Sem e-mail em alguns, de propósito: é o normal de quem chega pelo WhatsApp. */
  comEmail: boolean;
  empresa?: EmpresaDaSemente["chave"];
  cargo?: string;
  setor?: string;
  /** Na empresa, é quem decide (vai para `company_people.is_decision_maker`). */
  decisor?: boolean;
  tags?: string[];
}

// ─── Origens ────────────────────────────────────────────────────────────────
//
// Os valores de `source` e as etiquetas são OS DO PRODUTO (ver `ORIGENS` em
// aplicar.ts): `meta_ads` e `Meta_ads`/`Formulario_Meta`, `google_ads`/
// `Google_ads`, `site`, `indicacao`.

export type OrigemDoNegocio = "meta_formulario" | "meta_clique_whatsapp" | "google" | "site" | "indicacao";

// ─── Funis ──────────────────────────────────────────────────────────────────

/** A chave do funil dentro da semente (o slug dele é `demo-<chave>`). */
export type ChaveDoFunil = string;

/**
 * Uma coluna do quadro. `passo` é a que passo do funil da IA ela corresponde
 * (`crm_stages.agent_stage_hint`): `null` quando só pessoas movem o card ali.
 * O banco não deixa dois passos iguais no mesmo funil. `fim` marca a coluna de
 * ganho ou de perda.
 */
export interface EtapaDaSemente {
  chave: string;
  nome: string;
  passo: LeadStage | null;
  fim?: "won" | "lost";
  /** Chance de fechar, de 0 a 100. Ausente: a do passo (`aplicar.ts`). */
  probabilidade?: number;
  /** Quanto tempo o card costuma ficar aqui, em horas (o radar de risco usa). */
  prazoHoras?: number;
}

export interface MotivoDePerdaDaSemente {
  label: string;
  categoria: CategoriaDePerda;
}

export interface NegocioDaSemente {
  titulo: string;
  /**
   * A etapa onde o card está, pela CHAVE da etapa. Nos funis que saem de um
   * quadro pronto, a chave é o passo (`new`, `qualified`, `won`…).
   */
  passo: string;
  contato: ContatoDaSemente["chave"];
  valorReais: number | null;
  dono: DonoDoNegocio;
  origem: OrigemDoNegocio;
  /** Há quantos dias o negócio nasceu. */
  criadoHaDias: number;
  /** Há quantos dias está nesta etapa. */
  naEtapaHaDias: number;
  campos?: Record<string, unknown>;
  tags?: string[];
  /** A próxima ação: vira tarefa com prazo ligada ao card. */
  proximaAcao?: { titulo: string; emDias: number; prioridade?: "low" | "medium" | "high" | "urgent" };
  motivoDaPerda?: string;
  motivoDoGanho?: string;
  nota?: string;
}

export interface FunilDaSemente {
  chave: ChaveDoFunil;
  nome: string;
  descricao: string;
  /** De qual quadro pronto do onboarding (`PACOTES`) saem as etapas. Ausente = `etapas`. */
  pacote?: string;
  etapas?: EtapaDaSemente[];
  nichoDeFollowup: NichoDeModelo | null;
  vocabulario: {
    lead: string;
    lead_plural: string;
    deal: string;
    deal_plural: string;
    won: string;
    lost: string;
  };
  campos: CustomFieldDef[];
  motivosDePerda: MotivoDePerdaDaSemente[];
  motivosDeGanho: string[];
  /** Vencer aqui é dinheiro entrando? Ver `vitoria_e_receita` em lib/schemas/settings.ts. */
  vitoriaEReceita: boolean;
  negocios: NegocioDaSemente[];
}

// ─── Conversas com a IA ─────────────────────────────────────────────────────

export interface MensagemDaSemente {
  /** `cliente` = inbound; `ia` = a IA respondeu; `equipe` = uma pessoa respondeu. */
  de: "cliente" | "ia" | "equipe";
  texto: string;
  /** Minutos depois do início da conversa. */
  min: number;
}

export interface ConversaDaSemente {
  chave: string;
  contato: ContatoDaSemente["chave"];
  /** Há quantos dias a conversa começou. */
  comecouHaDias: number;
  mensagens: MensagemDaSemente[];
  /** Onde a IA deixou o lead (`lead_state`). */
  passo: LeadStage;
  qualificacao: { budget?: string; authority?: string; need?: string; timeline?: string };
  proximaAcao: string | null;
  /** A ficha que a IA escreveu (`lead_notes`). */
  ficha: { headline: string; body: string } | null;
  /** A IA passou a conversa para uma pessoa (`passagens_de_atendimento`). */
  passagem?: { titulo: string; resumo: string; ultimaFala: string; reconhecidaPor?: PessoaDaEquipe["chave"] };
  /** Quem está com a conversa agora. */
  com: DonoDoNegocio;
  /**
   * Status de ciclo de vida GRAVADO. Escrever o status segue permitido; o que a
   * cerca `fila-tem-uma-definicao-so` proíbe é DECIDIR quem atende por ele, e
   * aqui nada decide nada: é só o dado semeado (ver `CONVERSA_COM_A_IA`).
   */
  status: "open" | "ai_handling" | "claimed" | "resolved";
  etiquetas?: string[];
}

// ─── Agenda ─────────────────────────────────────────────────────────────────

/**
 * Um tipo de agendamento a mais. `consulta`, `reuniao` e `atendimento` o banco
 * já semeia em toda empresa nova. `categoria` é o vocabulário de
 * `calendar_event_types_category_check`.
 */
export interface TipoDeAgendaDaSemente {
  slug: string;
  nome: string;
  categoria:
    | "consulta"
    | "procedimento"
    | "retorno"
    | "visita"
    | "vistoria"
    | "reuniao"
    | "call"
    | "orcamento"
    | "demonstracao"
    | "outro";
  duracao: number;
}

export interface CompromissoDaSemente {
  chave: string;
  titulo: string;
  /** O slug de um tipo de agendamento: os três do banco ou um de `tiposDeAgenda`. */
  tipo: string;
  contato: ContatoDaSemente["chave"];
  dono: PessoaDaEquipe["chave"];
  /** Dias a partir de hoje (negativo = passado) e hora local de São Paulo. */
  emDias: number;
  hora: string;
  duracaoMin: number;
  status: "pending" | "confirmed" | "completed" | "no_show" | "cancelled";
  local: "in_person" | "phone" | "whatsapp";
  criadoPor: "user" | "ai";
  nota?: string;
}

// ─── Tarefas soltas (além das "próximas ações" dos negócios) ──────────────

export interface TarefaDaSemente {
  chave: string;
  titulo: string;
  descricao?: string;
  dono: PessoaDaEquipe["chave"];
  /** `null` = sem prazo. */
  emDias: number | null;
  prioridade: "low" | "medium" | "high" | "urgent";
  status: "pending" | "in_progress" | "done" | "cancelled";
  contato?: ContatoDaSemente["chave"];
}

// ─── Follow-ups ─────────────────────────────────────────────────────────────

/**
 * Um modelo de follow-up instalado na demonstração, e a etapa que o dispara
 * (para os modelos de gatilho por etapa; nos outros a etapa só passa pela
 * montagem do gatilho, que a ignora).
 */
export interface FollowupDaSemente {
  /** O id do modelo em `lib/followup/modelos`. */
  modelo: string;
  funil: ChaveDoFunil;
  /** A CHAVE da etapa no funil. */
  etapa: string;
}

export interface InscricaoDaSemente {
  chave: string;
  /** O id do modelo de follow-up instalado (lib/followup/modelos). */
  modelo: string;
  contato: ContatoDaSemente["chave"];
  status: "active" | "waiting_reply" | "completed" | "cancelled";
  /** O nó do grafo em que a inscrição está. */
  no: string;
  passos: number;
  comecouHaDias: number;
  /** Próxima avaliação em horas a partir de agora (só active/waiting_reply). */
  proximaEmHoras?: number;
  desfecho?: "converted" | "replied" | "exhausted" | "opted_out" | "handoff";
  motivoDoCancelamento?: string;
}

// ─── Documentos e obrigações (migration 9018, docs/fork/obrigacoes.md) ──────

export interface ObrigacaoDaSemente {
  chave: string;
  /** O nome de um modelo de `lib/obrigacoes/catalogo.ts`, do segmento da semente. */
  tipo: string;
  empresa?: EmpresaDaSemente["chave"];
  contato?: ContatoDaSemente["chave"];
  /** O título de um negócio do funil das obrigações. */
  negocio?: string;
  responsavel: PessoaDaEquipe["chave"];
  /** Dias a partir de hoje (negativo = no passado). */
  pedidoEmDias?: number;
  prazoEmDias?: number;
  recebidoEmDias?: number;
  validoAteEmDias?: number;
  proximaEmDias?: number;
  feitaEmDias?: number;
  observacao?: string;
  /** Os ciclos que já terminaram, do mais antigo para o mais novo. */
  ciclos?: Array<{ recebidoEmDias?: number; validoAteEmDias?: number; proximaEmDias?: number; feitaEmDias?: number }>;
  /** O agente reconheceu um arquivo na conversa e espera uma pessoa confirmar. */
  proposta?: { conversa: ConversaDaSemente["chave"]; arquivo: string };
}

export interface ObrigacoesDaSemente {
  /** O funil que recebe o catálogo de tipos. */
  funil: ChaveDoFunil;
  /** O modelo de tipos (`lib/obrigacoes/catalogo.ts`) instalado no funil. */
  segmento: SegmentoDeObrigacao;
  itens: ObrigacaoDaSemente[];
}

// ─── Produtos e serviços (`catalog_products`) ──────────────────────────────

export interface ProdutoDaSemente {
  /** O código do catálogo: a identidade do produto dentro da empresa. */
  codigo: string;
  nome: string;
  descricao: string;
  marca?: string;
  categoria: string;
  precoReais: number;
  custoReais?: number;
  /** `false` para serviço e plano: quem não conta estoque continua aparecendo para o agente. */
  controlaEstoque: boolean;
  quantidade?: number;
}

// ─── A semente inteira ──────────────────────────────────────────────────────

export interface SementeDeDemonstracao {
  segmento: SegmentoDeDemonstracao;
  /** Como o segmento se chama para quem escolhe ("Construtora e imobiliária"). */
  rotulo: string;
  /** O que esta demonstração mostra, em uma frase (vai para o MCP e o terminal). */
  oQueMostra: string;
  /** O nome que aparece na lista de empresas (`organizations.display_name`). */
  nome: string;
  razaoSocial: string;
  /** Estável: é por ele que o terminal e o MCP acham a empresa. */
  slug: string;
  /**
   * O prefixo dos ids estáveis (`ids.ts`). Vazio SÓ na bancada, cujos ids são
   * os de antes desta separação: trocar seria duplicar a empresa em produção.
   */
  prefixoDosIds: string;
  /** O nome da sessão-âncora do canal (único na instalação). */
  sessaoDoCanal: string;
  telefoneDoCanal: string;
  modoDeVenda: "b2b" | "b2c";
  /** O nome do formulário da Meta nas origens dos negócios. */
  formularioDaMeta: string;
  /** O lugar dos compromissos presenciais (`location_details`). */
  enderecoFicticio: string;
  equipe: PessoaDaEquipe[];
  /** Quem cria as tarefas, os follow-ups e as obrigações, e recebe as tarefas dos cards da IA. */
  gestor: PessoaDaEquipe["chave"];
  agente: AgenteDaSemente;
  /** Módulos vendidos liberados para as telas aparecerem (nada sai deles). */
  modulos: ChaveDeModulo[];
  empresas: EmpresaDaSemente[];
  contatos: ContatoDaSemente[];
  funis: FunilDaSemente[];
  /** O funil que abre primeiro (`crm_pipelines.is_default`). */
  funilPadrao: ChaveDoFunil;
  conversas: ConversaDaSemente[];
  tiposDeAgenda: TipoDeAgendaDaSemente[];
  compromissos: CompromissoDaSemente[];
  tarefas: TarefaDaSemente[];
  followups: FollowupDaSemente[];
  inscricoes: InscricaoDaSemente[];
  obrigacoes: ObrigacoesDaSemente | null;
  produtos: ProdutoDaSemente[];
}
