/**
 * FORK MIA — o cenário dos testes do MCP de implantação: uma instalação de
 * mentira, com UMA organização fictícia recém-criada, e um cliente MCP falando
 * com o servidor de plataforma em memória.
 *
 * O banco é o de `tests/helpers/banco-em-memoria.ts` (tabelas de verdade em
 * memória), com as funções do banco que a implantação chama escritas em JS:
 * elas fazem aqui o MESMO efeito que as do Postgres fazem lá, para o teste
 * medir o que foi gravado em qual linha, e não o que a resposta diz. A prova
 * contra o Postgres de verdade mora em
 * `tests/invariants/mcp-de-implantacao-ponta-a-ponta.test.ts`.
 *
 * Nenhum dado daqui é de cliente real: empresa fictícia, e-mails
 * `@exemplo.invalid` (domínio reservado, que nenhum servidor aceita).
 */
import { randomUUID } from "node:crypto";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { PROVIDERS_DE_MENSAGEM } from "@/lib/channels/capabilities";
import { bancoEmMemoria, type Linha, type RpcDeMentira } from "@/tests/helpers/banco-em-memoria";

export const ORG = "0a000000-0000-4000-8000-000000000001";
export const OUTRA_ORG = "0a000000-0000-4000-8000-000000000002";
export const AUTOR = "0b000000-0000-4000-8000-000000000001";
export const TOKEN = "0c000000-0000-4000-8000-000000000001";
export const FUNIL_SEMEADO = "0d000000-0000-4000-8000-000000000001";
export const NUMERO = "0e000000-0000-4000-8000-000000000001";

/** Todas as operações de escrita da implantação: o token de quem implanta de ponta a ponta. */
export const TODAS_AS_OPERACOES = [
  "criar_cliente",
  "liberar_modulo",
  "implantar_configuracao",
  "colocar_no_ar",
  "convidar_equipe",
];

/** O funil de e-commerce que o gatilho de seed entrega a toda organização nova. */
function funilSemeado(orgId: string): { funis: Linha[]; etapas: Linha[] } {
  const etapas: Array<[string, string, boolean, boolean]> = [
    ["Carrinho abandonado", "carrinho_abandonado", false, false],
    ["Aguardando pagamento", "aguardando_pagamento", false, false],
    ["Pago", "pago", true, false],
    ["Em separação", "em_separacao", false, false],
    ["Enviado", "enviado", false, false],
    ["Entregue", "entregue", false, false],
    ["Pós-venda", "pos_venda", false, false],
    ["Cancelado", "cancelado", false, true],
  ];
  return {
    funis: [
      {
        id: FUNIL_SEMEADO,
        organization_id: orgId,
        name: "Pedidos",
        slug: "pedidos",
        description: null,
        position: 1000,
        is_default: true,
        is_client_pipeline: false,
        is_archived: false,
        vocabulary: {},
        settings: { fields: [], lost_reasons: [] },
      },
    ],
    etapas: etapas.map(([name, slug, won, lost], i) => ({
      id: randomUUID(),
      organization_id: orgId,
      pipeline_id: FUNIL_SEMEADO,
      name,
      slug,
      position: (i + 1) * 1000,
      is_won: won,
      is_lost: lost,
      is_archived: false,
      win_probability: null,
      agent_stage_hint: null,
      avisar_na_central: false,
      expected_duration_hours: null,
      color: null,
    })),
  };
}

/** As funções do banco que a implantação chama, com o efeito que têm no Postgres. */
const RPCS: Record<string, RpcDeMentira> = {
  fn_aplicar_quadro_do_onboarding: (args, db) => {
    const funil = (db.crm_pipelines ?? []).find(
      (f) => f.id === args.p_pipeline_id && f.organization_id === args.p_organization_id,
    );
    if (!funil) return { data: { ok: false, motivo: "funil_nao_encontrado" }, error: null };
    const negocios = (db.crm_leads ?? []).filter((l) => l.pipeline_id === funil.id).length;
    if (negocios > 0) return { data: { ok: false, motivo: "funil_com_negocios", quantos: negocios }, error: null };
    db.crm_stages = (db.crm_stages ?? []).filter((e) => e.pipeline_id !== funil.id);
    for (const e of args.p_etapas as Linha[]) {
      db.crm_stages.push({
        id: randomUUID(),
        organization_id: args.p_organization_id,
        pipeline_id: funil.id,
        name: e.nome,
        slug: e.slug,
        position: e.position,
        is_won: e.is_won === true,
        is_lost: e.is_lost === true,
        is_archived: false,
        win_probability: null,
        agent_stage_hint: e.agent_stage_hint ?? null,
        avisar_na_central: false,
        expected_duration_hours: null,
        color: null,
      });
    }
    funil.name = args.p_nome;
    funil.slug = args.p_slug;
    return { data: { ok: true, etapas: (args.p_etapas as unknown[]).length }, error: null };
  },

  fn_publish_ai_agent_version: (args, db) => {
    const agente = (db.ai_agents ?? []).find((a) => a.id === args.p_agent_id && a.organization_id === args.p_org_id);
    const versao = (db.ai_agent_versions ?? []).find((v) => v.id === args.p_version_id && v.agent_id === args.p_agent_id);
    if (!agente) return { data: null, error: { message: "agent_not_found", code: "P0001" } };
    if (!versao) return { data: null, error: { message: "version_not_found", code: "P0001" } };
    const numero = (db.channel_sessions ?? []).find((s) => s.id === versao.channel_session_id);
    if (!numero) return { data: null, error: { message: "channel_session_not_found", code: "P0001" } };
    if (numero.status !== "WORKING") return { data: null, error: { message: "channel_session_offline", code: "P0001" } };
    const anterior = (agente.published_version_id as string | null) ?? null;
    for (const v of db.ai_agent_versions ?? []) {
      if (v.id === anterior) v.status = "superseded";
    }
    const publicadoEm = new Date().toISOString();
    versao.status = "published";
    versao.published_at = publicadoEm;
    agente.published_version_id = versao.id;
    return {
      data: [{ agent_id: agente.id, version_id: versao.id, previous_version_id: anterior, published_at: publicadoEm }],
      error: null,
    };
  },

  fn_publish_followup_flow_version: (args, db) => {
    const fluxo = (db.followup_flow_pointers ?? []).find((f) => f.id === args.p_pointer && f.organization_id === args.p_org);
    if (!fluxo) return { data: null, error: { message: "pointer_not_found" } };
    const id = randomUUID();
    (db.followup_flow_versions ??= []).push({ id, organization_id: args.p_org, pointer_id: fluxo.id, graph: args.p_graph });
    fluxo.status = "active";
    fluxo.active_version_id = id;
    return { data: id, error: null };
  },

  fn_mia_e_demonstracao: (args, db) => ({
    data: (db.organizations ?? []).find((o) => o.id === args.p_org)?.demonstracao === true,
    error: null,
  }),
};

export interface OpcoesDoCenario {
  /** A organização é a empresa de demonstração. */
  demonstracao?: boolean;
  /** A organização já tem um número de WhatsApp conectado. */
  comNumero?: boolean;
  /** O número é o OFICIAL (tem conta de WhatsApp Business). */
  numeroOficial?: boolean;
  /** O teto de linhas por resposta do PostgREST (1000 em produção). Ausente = sem corte. */
  maxRows?: number;
}

/** Uma organização fictícia como `plataforma_criar_cliente` a deixa: com o funil semeado e o criador como admin. */
export function cenarioDaImplantacao(opcoes: OpcoesDoCenario = {}) {
  const semeado = funilSemeado(ORG);
  const banco = bancoEmMemoria(
    {
      organizations: [
        {
          id: ORG,
          display_name: "Clínica Exemplo",
          legal_name: "Clínica Exemplo LTDA",
          slug: "clinica-exemplo",
          cnpj: null,
          status: "active",
          timezone: "America/Sao_Paulo",
          locale: "pt-BR",
          currency: "BRL",
          country: null,
          media_retention_days: 365,
          dpo_email: null,
          privacy_policy_url: null,
          settings: {},
          onboarded_at: null,
          updated_at: "2026-01-01T00:00:00.000000+00:00",
          demonstracao: opcoes.demonstracao === true,
        },
      ],
      platform_api_tokens: [{ id: TOKEN, created_by: AUTOR }],
      user_organizations: [
        { id: randomUUID(), organization_id: ORG, user_id: AUTOR, role: "admin", accepted_at: "2026-01-01T00:00:00Z", revoked_at: null, created_at: "2026-01-01T00:00:00Z" },
      ],
      crm_pipelines: semeado.funis,
      crm_stages: semeado.etapas,
      // O par de IA que a plataforma definiu, e o catálogo que o confirma.
      platform_ia: [{ id: 1, provider: "openai", model_id: "modelo-da-plataforma" }],
      ai_models: [{ provider: "openai", model_id: "modelo-da-plataforma", supports_tools: true, deprecated_at: null }],
      channel_sessions: opcoes.comNumero
        ? [
            {
              id: NUMERO,
              organization_id: ORG,
              display_name: "Recepção",
              phone_number: "+5500900000001",
              status: "WORKING",
              // Um provedor de mensagem qualquer: o teste não depende de qual.
              provider: PROVIDERS_DE_MENSAGEM[0],
              archived_at: null,
              waha_session_name: null,
              e_numero_de_avisos: false,
              meta_waba_id: opcoes.numeroOficial ? "conta-oficial-ficticia" : null,
              created_at: "2026-01-01T00:00:00Z",
            },
          ]
        : [],
    },
    RPCS,
    { maxRows: opcoes.maxRows },
  );

  // O que o PostgREST não alcança e o código pede ao GoTrue e ao Storage.
  const usuarios = new Map<string, { email: string; nome: string }>([
    [AUTOR, { email: "implantador@exemplo.invalid", nome: "Pessoa Implantadora" }],
  ]);
  const cliente = Object.assign(banco.cliente, {
    auth: {
      admin: {
        getUserById: async (id: string) => {
          const u = usuarios.get(id);
          return { data: { user: u ? { id, email: u.email, user_metadata: { full_name: u.nome } } : null }, error: null };
        },
      },
    },
    storage: {
      from: () => ({ upload: async () => ({ data: { path: "guardado" }, error: null }) }),
    },
  });

  return { banco, cliente, usuarios };
}

export interface RespostaDaFerramenta {
  erro: boolean;
  texto: string;
  /** O JSON da resposta, quando a ferramenta devolveu um. */
  dados: Record<string, unknown>;
}

/**
 * Um cliente MCP ligado ao servidor de plataforma, em memória. É o caminho
 * inteiro: `tools/list`, a guarda da operação, a conferência dos argumentos, o
 * handler e a resposta em texto, como o Claude Code veria.
 */
export async function clienteMcp(
  criarServidor: (token: { tokenId: string; operacoes: string[] }, requestId: string) => { connect: (t: never) => Promise<void> },
  operacoes: string[],
) {
  const servidor = criarServidor({ tokenId: TOKEN, operacoes }, "req-teste");
  const [ladoDoCliente, ladoDoServidor] = InMemoryTransport.createLinkedPair();
  await servidor.connect(ladoDoServidor as never);
  const cliente = new Client({ name: "teste-de-implantacao", version: "0.0.0" });
  await cliente.connect(ladoDoCliente);

  return {
    listar: async () => (await cliente.listTools()).tools,
    chamar: async (nome: string, args: Record<string, unknown> = {}): Promise<RespostaDaFerramenta> => {
      const r = (await cliente.callTool({ name: nome, arguments: args })) as {
        isError?: boolean;
        content: Array<{ type: string; text: string }>;
      };
      const texto = r.content.map((c) => c.text).join("\n");
      let dados: Record<string, unknown> = {};
      try {
        dados = JSON.parse(texto) as Record<string, unknown>;
      } catch {
        // Recusa em texto corrido: `dados` fica vazio, `texto` carrega a frase.
      }
      return { erro: r.isError === true, texto, dados };
    },
    fechar: () => cliente.close(),
  };
}
