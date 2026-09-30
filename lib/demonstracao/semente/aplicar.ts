/**
 * FORK MIA · CLIENTE MODELO — grava a "Empresa Modelo · Demonstração".
 *
 * Idempotente: cada linha tem id estável (`ids.ts`) e entra por
 * `insert … on conflict (id) do update`. Rodar de novo NÃO duplica nada — e
 * renova as datas (a agenda "de amanhã" continua sendo de amanhã, os
 * follow-ups em andamento voltam a esperar a próxima mensagem).
 *
 * Tudo numa transação: ou a empresa inteira fica de pé, ou nada muda.
 *
 * ⚠️ A marca `demonstracao` vem PRIMEIRO, no insert da empresa. Daí em diante a
 * trava da 9010 vale para tudo o que esta semente grava: o histórico de
 * mensagens entra como já entregue (`read`/`received`), nunca em fila; o
 * número do WhatsApp nasce arquivado; os destinos de fora não existem.
 *
 * A semente NÃO é tráfego. Os gatilhos do banco emitem eventos
 * (`message.received`, `lead.created`…) a cada linha gravada, e os workers
 * reagiriam a eles como a um cliente de verdade — resposta da IA, regra de
 * automação, conversão. No fim, os eventos que ESTA transação emitiu são
 * marcados como consumidos (`semente-cliente-modelo`).
 *
 * O que ela reaproveita do produto, em vez de copiar:
 *  - os quadros prontos do onboarding (`PACOTES`) para as etapas dos funis;
 *  - os modelos de follow-up por segmento (`MODELOS_DE_FOLLOWUP`), validados
 *    pelas MESMAS regras da rota que os instala e do botão Publicar;
 *  - o schema das configurações do funil (`pipelineConfigPatchSchema`) para
 *    campos personalizados e motivos de perda;
 *  - a montagem da linha da timeline (`buildLeadActivityRow`).
 *
 * TODO(cliente modelo): documentos e obrigações. O produto ainda não tem onde
 * guardá-los por empresa — quando tiver, a semente ganha o bloco.
 */
import type pg from "pg";

import type { Actor } from "@/lib/api/handlers/types";
import { flowGraphSchema, type FlowGraph } from "@/lib/followup/graph-schema";
import { triggerConfigSchema } from "@/lib/followup/api-schemas";
import { validateFlowForPublish } from "@/lib/followup/validate-publish";
import { MODELOS_DE_FOLLOWUP, type ModeloDeFollowup, type NichoDeModelo } from "@/lib/followup/modelos";
import { buildLeadActivityRow, stageChangeReason } from "@/lib/leads/activity-emitter";
import { MODULO_DOS_LEADS_DA_META } from "@/lib/leads-da-meta/modulo";
import type { ChaveDeModulo } from "@/lib/modulos/vendaveis";
import { PACOTES } from "@/lib/onboarding/pacotes-de-funil";
import { pipelineConfigPatchSchema } from "@/lib/schemas/settings";

import {
  AGENTE_DE_IA,
  COMPROMISSOS,
  CONTATOS,
  CONVERSAS,
  EMPRESAS,
  EQUIPE,
  FUNIS,
  INSCRICOES,
  NOME_DA_EMPRESA,
  RAZAO_SOCIAL,
  SESSAO_DO_CANAL,
  SLUG_DA_EMPRESA,
  TAREFAS,
  TELEFONE_DO_CANAL,
  emailFalso,
  telefoneFalso,
  type ChaveDoFunil,
  type EtapaDaSemente,
  type FunilDaSemente,
  type NegocioDaSemente,
  type OrigemDoNegocio,
} from "./dados";
import { idEstavel } from "./ids";

// ─── os ids ─────────────────────────────────────────────────────────────────

export const ID_DA_EMPRESA = idEstavel("organizacao");

const slug = (texto: string) =>
  texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const ID = {
  usuario: (k: string) => idEstavel(`usuario:${k}`),
  agente: idEstavel("agente:sofia"),
  canal: idEstavel("canal:whatsapp"),
  empresa: (k: string) => idEstavel(`empresa:${k}`),
  companhia: (k: string) => idEstavel(`companhia:${k}`),
  pessoa: (k: string) => idEstavel(`pessoa:${k}`),
  vinculo: (k: string) => idEstavel(`vinculo:${k}`),
  contato: (k: string) => idEstavel(`contato:${k}`),
  funil: (k: string) => idEstavel(`funil:${k}`),
  etapa: (f: string, e: string) => idEstavel(`etapa:${f}:${e}`),
  negocio: (f: string, titulo: string) => idEstavel(`negocio:${f}:${slug(titulo)}`),
  atividade: (negocio: string, tipo: string) => idEstavel(`atividade:${negocio}:${tipo}`),
  tarefa: (k: string) => idEstavel(`tarefa:${k}`),
  conversa: (k: string) => idEstavel(`conversa:${k}`),
  mensagem: (k: string, i: number) => idEstavel(`mensagem:${k}:${i}`),
  estado: (k: string) => idEstavel(`estado:${k}`),
  transicao: (k: string, i: number) => idEstavel(`transicao:${k}:${i}`),
  nota: (k: string) => idEstavel(`nota:${k}`),
  passagem: (k: string) => idEstavel(`passagem:${k}`),
  fluxo: (m: string) => idEstavel(`fluxo:${m}`),
  versao: (m: string) => idEstavel(`versao:${m}`),
  inscricao: (k: string) => idEstavel(`inscricao:${k}`),
  eventoDaInscricao: (k: string, i: number) => idEstavel(`evento-da-inscricao:${k}:${i}`),
  tipoDeAgenda: (k: string) => idEstavel(`tipo-de-agenda:${k}`),
  compromisso: (k: string) => idEstavel(`compromisso:${k}`),
  modulo: (k: string) => idEstavel(`modulo:${k}`),
};

/** Quem consome os eventos que a semente emite: ninguém — ver o cabeçalho. */
export const CONSUMIDOR_DA_SEMENTE = "semente-cliente-modelo";

// ─── as origens, com o vocabulário do produto ───────────────────────────────
//
// Os valores são os de `lib/leads-da-meta/gravar.ts` (`meta_ads`, `Meta_ads`,
// `Formulario_Meta`) e de `lib/leads/nascimento-do-lead.ts` (`google_ads`,
// `Google_ads`, `site`). Copiados, e não importados, porque aqueles módulos
// carregam o cliente do Supabase e as variáveis do servidor; quem garante que
// continuam iguais é tests/unit/cliente-modelo-semente.test.ts.
export const ORIGENS: Record<
  OrigemDoNegocio,
  { source: string; tags: string[]; metadata: (chave: string) => Record<string, unknown> }
> = {
  meta_formulario: {
    source: "meta_ads",
    tags: ["Meta_ads", "Formulario_Meta"],
    metadata: () => ({
      canal: "formulario_da_meta",
      form_name: "Formulário · Empresa Modelo (demonstração)",
      campaign_name: "Campanha de demonstração",
    }),
  },
  meta_clique_whatsapp: {
    source: "meta_ads",
    tags: ["Meta_ads"],
    metadata: (chave) => ({
      canal: "clique_para_whatsapp",
      ctwa_clid: `demonstracao-${chave}`,
      ad_name: "Anúncio de demonstração",
    }),
  },
  google: {
    source: "google_ads",
    tags: ["Google_ads"],
    metadata: (chave) => ({ gclid: `demonstracao-${chave}`, campaign: "Pesquisa · demonstração" }),
  },
  site: {
    source: "site",
    tags: [],
    metadata: () => ({ utm_source: "site", utm_medium: "organico", pagina: "/contato" }),
  },
  indicacao: {
    source: "indicacao",
    tags: ["indicacao"],
    metadata: () => ({ indicado_por: "Cliente da carteira (fictício)" }),
  },
};

const FUNIL_DO_NICHO: Record<NichoDeModelo, ChaveDoFunil> = {
  geral: "generico",
  clinica: "clinica",
  imobiliario: "imobiliaria",
  automotivo: "automotivo",
  academia: "academia",
  servicos_b2b: "servicos",
};

// ─── a escrita ──────────────────────────────────────────────────────────────

class Json {
  constructor(readonly valor: unknown) {}
}
const json = (valor: unknown) => new Json(valor);

type Valor = string | number | boolean | null | Date | string[] | Json;
type Linha = Record<string, Valor>;

async function gravar(
  db: pg.ClientBase,
  tabela: string,
  linha: Linha,
  opcoes: { conflito?: string; manter?: string[]; nada?: boolean } = {},
): Promise<void> {
  const colunas = Object.keys(linha);
  const valores = colunas.map((c) => {
    const v = linha[c];
    return v instanceof Json ? JSON.stringify(v.valor) : v;
  });
  const marcadores = colunas.map((c, i) => (linha[c] instanceof Json ? `$${i + 1}::jsonb` : `$${i + 1}`));
  const conflito = opcoes.conflito ?? "id";
  const fixas = new Set([...conflito.split(",").map((c) => c.trim()), "id", ...(opcoes.manter ?? [])]);
  const atualizar = colunas.filter((c) => !fixas.has(c)).map((c) => `${c} = excluded.${c}`);
  const acao = opcoes.nada || atualizar.length === 0 ? "do nothing" : `do update set ${atualizar.join(", ")}`;
  await db.query(
    `insert into ${tabela} (${colunas.join(", ")}) values (${marcadores.join(", ")}) on conflict (${conflito}) ${acao}`,
    valores,
  );
}

// ─── o tempo ────────────────────────────────────────────────────────────────

const HORA = 3_600_000;
const DIA = 24 * HORA;
/** O Brasil não tem horário de verão desde 2019: São Paulo é UTC-3 o ano todo. */
const UTC_MENOS_TRES = 3;

/** Um instante `dias` a partir de hoje, na hora LOCAL de São Paulo (`"16:00"`). */
function naHoraLocal(agora: Date, dias: number, hora: string): Date {
  const local = new Date(agora.getTime() - UTC_MENOS_TRES * HORA);
  const [h, m] = hora.split(":").map(Number);
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + dias, h! + UTC_MENOS_TRES, m!),
  );
}

const dataIso = (d: Date) => d.toISOString().slice(0, 10);

// ─── os funis ───────────────────────────────────────────────────────────────

function etapasDoFunil(funil: FunilDaSemente): EtapaDaSemente[] {
  if (funil.etapas) return funil.etapas;
  const pacote = PACOTES.find((p) => p.id === funil.pacote);
  if (!pacote) throw new Error(`cliente modelo: quadro pronto "${funil.pacote}" não existe mais no onboarding`);
  return pacote.proposta.etapas.map((e) => {
    if (!e.passo) throw new Error(`cliente modelo: etapa sem passo no quadro "${funil.pacote}"`);
    return {
      chave: e.passo,
      nome: e.nome,
      passo: e.passo,
      ...(e.passo === "won" || e.passo === "lost" ? { fim: e.passo } : {}),
    };
  });
}

/** O `settings` do funil, conferido pelo MESMO schema que a tela de configuração usa. */
function configuracaoDoFunil(funil: FunilDaSemente): Record<string, unknown> {
  const config = pipelineConfigPatchSchema.parse({
    fields: funil.campos,
    lost_reasons: funil.motivosDePerda,
    won_reasons: funil.motivosDeGanho,
    vitoria_e_receita: funil.vitoriaEReceita,
  });
  return {
    ...config,
    canonical_tags: [],
    identity_resolution: { fields_in_priority_order: ["cpf", "phone_e164", "email"] },
  };
}

const PROBABILIDADE: Record<string, number> = {
  new: 10,
  contacted: 20,
  qualifying: 35,
  qualified: 55,
  negotiating: 75,
};
const PRAZO_DA_ETAPA: Record<string, number> = {
  new: 24,
  contacted: 48,
  qualifying: 72,
  qualified: 72,
  negotiating: 96,
};
const CORES = ["#94a3b8", "#60a5fa", "#2892d0", "#1651a0", "#7c3aed", "#16a34a", "#dc2626", "#f59e0b"];

// ─── a semente ──────────────────────────────────────────────────────────────

export interface OpcoesDaSemente {
  /** O "agora" das datas relativas. Padrão: o relógio. */
  agora?: Date;
  /**
   * E-mails de usuários que JÁ existem na instalação e ganham acesso de admin à
   * empresa de demonstração (quem vai mostrar o produto). E-mail que não existe
   * vira aviso no resumo, não erro.
   */
  emailsDeAcesso?: readonly string[];
}

export interface ResumoDaSemente {
  organizacaoId: string;
  contagens: Record<string, number>;
  avisos: string[];
}

export async function aplicarSemente(db: pg.ClientBase, opcoes: OpcoesDaSemente = {}): Promise<ResumoDaSemente> {
  const agora = opcoes.agora ?? new Date();
  const avisos: string[] = [];

  await db.query("begin");
  try {
    const {
      rows: [inicio],
    } = await db.query<{ agora: Date }>("select now() as agora");

    await conferirQueOEspacoEDaSemente(db);
    await gravarEquipe(db, agora);
    await gravarEmpresa(db, agora);
    await gravarAcesso(db, opcoes.emailsDeAcesso ?? [], avisos);
    await gravarModulos(db);
    await gravarCanalEAgente(db, agora);
    await gravarEmpresasEContatos(db, agora);
    const etapas = await gravarFunis(db);
    await gravarNegocios(db, agora, etapas);
    await gravarConversas(db, agora);
    await gravarFollowups(db, agora, etapas);
    await gravarAgenda(db, agora);
    await gravarTarefasSoltas(db, agora);
    await neutralizarOsEventos(db, inicio!.agora);

    const contagens = await contar(db);
    await db.query("commit");
    return { organizacaoId: ID_DA_EMPRESA, contagens, avisos };
  } catch (erro) {
    await db.query("rollback");
    throw erro;
  }
}

/** O slug é da semente? Se outra empresa o usa, a semente para em vez de tomar o lugar dela. */
async function conferirQueOEspacoEDaSemente(db: pg.ClientBase): Promise<void> {
  const { rows } = await db.query<{ id: string; demonstracao: boolean }>(
    "select id, demonstracao from public.organizations where slug = $1 or id = $2",
    [SLUG_DA_EMPRESA, ID_DA_EMPRESA],
  );
  for (const r of rows) {
    if (r.id !== ID_DA_EMPRESA) {
      throw new Error(
        `cliente modelo: o slug "${SLUG_DA_EMPRESA}" já é de outra empresa (${r.id}). A semente não toma o lugar dela.`,
      );
    }
  }
}

async function gravarEquipe(db: pg.ClientBase, agora: Date): Promise<void> {
  const { rows } = await db.query<{ column_name: string }>(
    `select column_name from information_schema.columns where table_schema = 'auth' and table_name = 'users'`,
  );
  const colunas = new Set(rows.map((r) => r.column_name));
  const criadoEm = new Date(agora.getTime() - 60 * DIA);

  for (const p of EQUIPE) {
    // Sem senha e bloqueado: é dono de card, não gente que entra no sistema.
    const completa: Linha = {
      instance_id: "00000000-0000-0000-0000-000000000000",
      id: ID.usuario(p.chave),
      aud: "authenticated",
      role: "authenticated",
      email: emailFalso(p.nome),
      encrypted_password: "",
      raw_app_meta_data: json({ provider: "email", providers: ["email"], demonstracao: true }),
      raw_user_meta_data: json({ full_name: p.nome, demonstracao: true }),
      created_at: criadoEm,
      updated_at: criadoEm,
      confirmation_token: "",
      recovery_token: "",
      email_change_token_new: "",
      email_change: "",
      banned_until: new Date("2999-12-31T00:00:00.000Z"),
    };
    const linha: Linha = {};
    for (const [c, v] of Object.entries(completa)) if (colunas.has(c)) linha[c] = v;
    await gravar(db, "auth.users", linha, { manter: ["created_at", "encrypted_password"] });
  }
}

async function gravarEmpresa(db: pg.ClientBase, agora: Date): Promise<void> {
  await db.query(
    `insert into public.organizations
       (id, slug, legal_name, display_name, status, timezone, locale, demonstracao, onboarded_at, settings)
     values ($1, $2, $3, $4, 'active', 'America/Sao_Paulo', 'pt-BR', true, $5, $6::jsonb)
     on conflict (id) do update
       set legal_name = excluded.legal_name,
           display_name = excluded.display_name,
           status = 'active',
           demonstracao = true,
           onboarded_at = coalesce(public.organizations.onboarded_at, excluded.onboarded_at),
           settings = public.organizations.settings || excluded.settings`,
    [
      ID_DA_EMPRESA,
      SLUG_DA_EMPRESA,
      RAZAO_SOCIAL,
      NOME_DA_EMPRESA,
      new Date(agora.getTime() - 45 * DIA),
      JSON.stringify({ modo_de_venda: "b2b" }),
    ],
  );
  // O banco semeia "Pedidos" (e-commerce) em toda empresa nova. Aqui ele sai
  // de cena: arquivado, e o funil geral da semente passa a ser o padrão.
  await db.query(
    `update public.crm_pipelines set is_default = false, is_archived = true
      where organization_id = $1 and slug = 'pedidos'`,
    [ID_DA_EMPRESA],
  );
}

async function gravarAcesso(db: pg.ClientBase, emails: readonly string[], avisos: string[]): Promise<void> {
  for (const p of EQUIPE) {
    await gravar(
      db,
      "public.user_organizations",
      {
        user_id: ID.usuario(p.chave),
        organization_id: ID_DA_EMPRESA,
        role: p.papel,
        accepted_at: new Date("2026-08-01T12:00:00.000Z"),
        revoked_at: null,
        calendar_trilha: p.trilha,
      },
      { conflito: "user_id, organization_id" },
    );
  }
  for (const bruto of emails) {
    const email = bruto.trim().toLowerCase();
    if (!email) continue;
    const { rows } = await db.query<{ id: string }>("select id from auth.users where lower(email) = $1", [email]);
    if (!rows[0]) {
      avisos.push(`acesso: não existe usuário com o e-mail ${email} nesta instalação`);
      continue;
    }
    await gravar(
      db,
      "public.user_organizations",
      {
        user_id: rows[0].id,
        organization_id: ID_DA_EMPRESA,
        role: "admin",
        accepted_at: new Date(),
        revoked_at: null,
      },
      { conflito: "user_id, organization_id", manter: ["accepted_at"] },
    );
  }
}

async function gravarModulos(db: pg.ClientBase): Promise<void> {
  // Os módulos pagos ficam LIBERADOS para a demonstração mostrar as telas; o
  // envio deles continua travado pela 9010.
  const liberados: ChaveDeModulo[] = ["disparador", MODULO_DOS_LEADS_DA_META];
  for (const modulo of liberados) {
    await db.query(
      `insert into public.organization_modules (id, organization_id, modulo, note)
       select $1, $2, $3, 'Cliente modelo: liberado para a demonstração (nada sai dela).'
        where not exists (
          select 1 from public.organization_modules
           where organization_id = $2 and modulo = $3 and revoked_at is null
        )
       on conflict (id) do nothing`,
      [ID.modulo(modulo), ID_DA_EMPRESA, modulo],
    );
  }
}

async function gravarCanalEAgente(db: pg.ClientBase, agora: Date): Promise<void> {
  // O número existe só para ancorar as conversas (a FK é obrigatória), e nasce
  // ARQUIVADO: para o produto ele não é número de ninguém, e a trava da 9010 não
  // deixa desarquivar.
  await gravar(
    db,
    "public.channel_sessions",
    {
      id: ID.canal,
      organization_id: ID_DA_EMPRESA,
      provider: "waha",
      waha_session_name: SESSAO_DO_CANAL,
      webhook_secret_encrypted: "\\x00",
      status: "STOPPED",
      status_reason: "Número fictício da empresa de demonstração: nunca conecta.",
      phone_number: TELEFONE_DO_CANAL,
      display_name: "WhatsApp da demonstração (fictício)",
      archived_at: new Date(agora.getTime() - 30 * DIA),
      metadata: json({ demonstracao: true }),
    },
    { manter: ["archived_at", "webhook_secret_encrypted"] },
  );

  // A Sofia existe para ser dona de card e de conversa. Sem versão publicada: não responde ninguém.
  await gravar(db, "public.ai_agents", {
    id: ID.agente,
    organization_id: ID_DA_EMPRESA,
    name: AGENTE_DE_IA.nome,
    description: AGENTE_DE_IA.descricao,
    system_prompt: AGENTE_DE_IA.prompt,
    is_active: true,
    is_default: true,
  });
}

async function gravarEmpresasEContatos(db: pg.ClientBase, agora: Date): Promise<void> {
  for (const e of EMPRESAS) {
    // As DUAS entidades de empresa do produto: a da MIA (`crm_empresas`, a da
    // ficha do contato e do card) e a do módulo B2B do upstream (`companies` +
    // `people`, a da prospecção).
    await gravar(db, "public.crm_empresas", {
      id: ID.empresa(e.chave),
      organization_id: ID_DA_EMPRESA,
      nome: e.nome,
      site: e.site,
      email: `contato@${slug(e.nome)}.exemplo.invalid`,
      endereco: `${e.cidade} · ${e.uf} (endereço fictício)`,
      observacoes: e.observacoes,
      tags: e.tags,
      custom_fields: json({ setor: e.setor }),
    });
    await gravar(db, "public.companies", {
      id: ID.companhia(e.chave),
      organization_id: ID_DA_EMPRESA,
      legal_name: `${e.nome} (fictícia)`,
      trade_name: e.nome,
      city: e.cidade,
      state: e.uf,
      email: `contato@${slug(e.nome)}.exemplo.invalid`,
      enrichment_status: "completed",
      main_cnae_description: e.setor,
    });
  }

  // A origem do contato é a do negócio mais antigo dele.
  const origemDoContato = new Map<string, { origem: OrigemDoNegocio; criadoHaDias: number }>();
  for (const f of FUNIS) {
    for (const n of f.negocios) {
      const atual = origemDoContato.get(n.contato);
      if (!atual || n.criadoHaDias > atual.criadoHaDias) {
        origemDoContato.set(n.contato, { origem: n.origem, criadoHaDias: n.criadoHaDias });
      }
    }
  }

  for (const c of CONTATOS) {
    const origem = origemDoContato.get(c.chave);
    const o = origem ? ORIGENS[origem.origem] : null;
    const criado = new Date(agora.getTime() - ((origem?.criadoHaDias ?? 30) + 1) * DIA);
    let pessoa: string | null = null;
    if (c.empresa) {
      pessoa = ID.pessoa(c.chave);
      await gravar(db, "public.people", {
        id: pessoa,
        organization_id: ID_DA_EMPRESA,
        full_name: c.nome,
        normalized_name: slug(c.nome).replace(/-/g, " "),
        email: c.comEmail ? emailFalso(c.nome) : null,
      });
    }
    await gravar(
      db,
      "public.contacts",
      {
        id: ID.contato(c.chave),
        organization_id: ID_DA_EMPRESA,
        name: c.nome,
        display_name: c.nome.split(" ")[0]!,
        email: c.comEmail ? emailFalso(c.nome) : null,
        phone_number: telefoneFalso(c.n),
        tags: [...new Set([...(c.tags ?? []), ...(o?.tags ?? [])])],
        source: o?.source ?? "manual",
        source_metadata: json(o ? o.metadata(c.chave) : {}),
        empresa_id: c.empresa ? ID.empresa(c.empresa) : null,
        cargo: c.cargo ?? null,
        setor: c.setor ?? null,
        person_id: pessoa,
        created_at: criado,
        last_activity_at: new Date(agora.getTime() - Math.min(origem?.criadoHaDias ?? 30, 3) * DIA),
      },
      { manter: ["created_at"] },
    );
    if (c.empresa && pessoa) {
      await gravar(
        db,
        "public.company_people",
        {
          id: ID.vinculo(c.chave),
          organization_id: ID_DA_EMPRESA,
          company_id: ID.companhia(c.empresa),
          person_id: pessoa,
          job_title: c.cargo ?? null,
          department: c.setor ?? null,
          is_decision_maker: c.decisor === true,
          is_primary: c.decisor === true,
        },
        { conflito: "company_id, person_id" },
      );
    }
  }
}

type EtapasGravadas = Map<ChaveDoFunil, Map<string, { id: string; nome: string; fim?: "won" | "lost" }>>;

async function gravarFunis(db: pg.ClientBase): Promise<EtapasGravadas> {
  const gravadas: EtapasGravadas = new Map();
  let posicao = 1000;
  for (const f of FUNIS) {
    await gravar(
      db,
      "public.crm_pipelines",
      {
        id: ID.funil(f.chave),
        organization_id: ID_DA_EMPRESA,
        name: f.nome,
        slug: `demo-${f.chave}`,
        description: f.descricao,
        is_default: false,
        is_archived: false,
        position: posicao,
        vocabulary: json({ ...f.vocabulario, stage: "Etapa", stage_plural: "Etapas" }),
        settings: json(configuracaoDoFunil(f)),
      },
      { manter: ["is_default"] },
    );
    posicao += 1000;

    const doFunil = new Map<string, { id: string; nome: string; fim?: "won" | "lost" }>();
    const etapas = etapasDoFunil(f);
    for (const [i, e] of etapas.entries()) {
      const id = ID.etapa(f.chave, e.chave);
      await gravar(db, "public.crm_stages", {
        id,
        organization_id: ID_DA_EMPRESA,
        pipeline_id: ID.funil(f.chave),
        name: e.nome,
        slug: slug(e.nome).replace(/-/g, "_").slice(0, 40),
        position: (i + 1) * 1000,
        color: e.fim === "won" ? "#16a34a" : e.fim === "lost" ? "#dc2626" : CORES[i % CORES.length]!,
        is_won: e.fim === "won",
        is_lost: e.fim === "lost",
        agent_stage_hint: e.passo,
        expected_duration_hours: e.fim ? null : (PRAZO_DA_ETAPA[e.passo ?? ""] ?? 72),
        win_probability: e.fim === "won" ? 100 : e.fim === "lost" ? 0 : (PROBABILIDADE[e.passo ?? ""] ?? 50),
      });
      doFunil.set(e.chave, { id, nome: e.nome, ...(e.fim ? { fim: e.fim } : {}) });
    }
    gravadas.set(f.chave, doFunil);
  }

  // O geral é o padrão (o "Pedidos" do banco já saiu de cena em gravarEmpresa).
  await db.query(
    `update public.crm_pipelines set is_default = (id = $2) where organization_id = $1 and is_default is distinct from (id = $2)`,
    [ID_DA_EMPRESA, ID.funil("generico")],
  );
  return gravadas;
}

function ator(dono: NegocioDaSemente["dono"]): Actor {
  return dono === "ia"
    ? { type: "ai_agent", id: "semente-cliente-modelo", role: "agent", agent_id: ID.agente }
    : { type: "user", id: ID.usuario(dono) };
}

async function gravarNegocios(db: pg.ClientBase, agora: Date, etapas: EtapasGravadas): Promise<void> {
  for (const f of FUNIS) {
    const doFunil = etapas.get(f.chave)!;
    const primeira = [...doFunil.values()][0]!;
    for (const [i, n] of f.negocios.entries()) {
      const etapa = doFunil.get(n.passo);
      if (!etapa) throw new Error(`cliente modelo: "${n.titulo}" aponta para a etapa "${n.passo}", que ${f.chave} não tem`);
      const contato = CONTATOS.find((c) => c.chave === n.contato);
      if (!contato) throw new Error(`cliente modelo: contato "${n.contato}" não existe`);
      const id = ID.negocio(f.chave, n.titulo);
      const origem = ORIGENS[n.origem];
      const criado = new Date(agora.getTime() - n.criadoHaDias * DIA - 2 * HORA);
      const naEtapa = new Date(agora.getTime() - n.naEtapaHaDias * DIA - HORA);
      const fechado = etapa.fim ? naEtapa : null;

      await gravar(
        db,
        "public.crm_leads",
        {
          id,
          organization_id: ID_DA_EMPRESA,
          pipeline_id: ID.funil(f.chave),
          stage_id: etapa.id,
          contact_id: ID.contato(n.contato),
          title: n.titulo,
          description: n.nota ?? null,
          position_in_stage: (i + 1) * 1000,
          value_cents: n.valorReais === null ? null : Math.round(n.valorReais * 100),
          currency: "BRL",
          owner_kind: n.dono === "ia" ? "ai" : "user",
          owner_user_id: n.dono === "ia" ? null : ID.usuario(n.dono),
          owner_agent_id: n.dono === "ia" ? ID.agente : null,
          assigned_at: criado,
          last_activity_at: naEtapa,
          expected_close_date: etapa.fim ? null : dataIso(new Date(agora.getTime() + (7 + i * 3) * DIA)),
          closed_at: fechado,
          lost_reason: etapa.fim === "lost" ? (n.motivoDaPerda ?? "other") : null,
          won_reason: etapa.fim === "won" ? (n.motivoDoGanho ?? null) : null,
          source: origem.source,
          source_metadata: json(origem.metadata(n.contato)),
          custom_fields: json(n.campos ?? {}),
          tags: [...new Set([...origem.tags, ...(n.tags ?? [])])],
          created_at: criado,
          stage_changed_at: naEtapa,
          empresa_id: contato.empresa ? ID.empresa(contato.empresa) : null,
        },
        { manter: ["created_at"] },
      );

      // O histórico: nasceu, andou até a etapa de hoje, e o que ficou anotado.
      const quem = ator(n.dono);
      const linhas = [
        {
          chave: "lead_created",
          em: criado,
          input: {
            type: "lead_created" as const,
            reason: `Negócio criado · origem: ${origem.source}`,
            payload: { pipeline_id: ID.funil(f.chave), stage_id: primeira.id, source: origem.source },
          },
        },
        ...(etapa.id !== primeira.id
          ? [
              {
                chave: "stage_changed",
                em: naEtapa,
                input: {
                  type: "stage_changed" as const,
                  reason: stageChangeReason(primeira.nome, etapa.nome),
                  payload: { from_stage_id: primeira.id, to_stage_id: etapa.id, pipeline_id: ID.funil(f.chave) },
                },
              },
            ]
          : []),
        ...(n.nota
          ? [{ chave: "note", em: naEtapa, input: { type: "note" as const, reason: n.nota, payload: {} } }]
          : []),
      ];
      for (const l of linhas) {
        const linha = buildLeadActivityRow({
          organizationId: ID_DA_EMPRESA,
          leadId: id,
          contactId: ID.contato(n.contato),
          sourceModule: "crm",
          sourceId: id,
          actor: quem,
          ...l.input,
        });
        await gravar(db, "public.crm_lead_activities", {
          id: ID.atividade(id, l.chave),
          organization_id: linha.organization_id,
          lead_id: linha.lead_id,
          contact_id: linha.contact_id,
          type: linha.type,
          source_module: linha.source_module,
          source_id: linha.source_id,
          actor_kind: linha.actor_kind,
          actor_agent_id: linha.actor_agent_id,
          performed_by_user_id: linha.performed_by_user_id,
          reason: linha.reason,
          evidence: linha.evidence === null ? null : json(linha.evidence),
          payload: json(linha.payload),
          metadata: json({ semente: "cliente-modelo" }),
          performed_at: l.em,
          created_at: l.em,
        });
      }

      // A próxima ação vira TAREFA com prazo, ligada ao card.
      if (n.proximaAcao) {
        const dono = n.dono === "ia" ? "helena" : n.dono;
        await gravar(db, "public.crm_tasks", {
          id: ID.tarefa(`negocio:${id}`),
          organization_id: ID_DA_EMPRESA,
          title: n.proximaAcao.titulo,
          due_date: naHoraLocal(agora, n.proximaAcao.emDias, "18:00"),
          priority: n.proximaAcao.prioridade ?? "medium",
          status: "pending",
          lead_id: id,
          contact_id: ID.contato(n.contato),
          assigned_to: ID.usuario(dono),
          created_by: ID.usuario("helena"),
        });
      }
    }
  }
}

async function gravarConversas(db: pg.ClientBase, agora: Date): Promise<void> {
  for (const c of CONVERSAS) {
    const ultimoMinuto = Math.max(...c.mensagens.map((m) => m.min));
    const base = new Date(agora.getTime() - c.comecouHaDias * DIA - (ultimoMinuto + 20) * 60_000);
    const emMin = (min: number) => new Date(base.getTime() + min * 60_000);
    const ultima = c.mensagens[c.mensagens.length - 1]!;
    const entradas = c.mensagens.filter((m) => m.de === "cliente");
    const saidas = c.mensagens.filter((m) => m.de !== "cliente");
    const comIa = c.com === "ia";
    const id = ID.conversa(c.chave);
    const contato = ID.contato(c.contato);

    await gravar(
      db,
      "public.conversations",
      {
        id,
        organization_id: ID_DA_EMPRESA,
        contact_id: contato,
        channel_session_id: ID.canal,
        channel: "whatsapp",
        status: c.status,
        status_changed_at: emMin(ultimoMinuto),
        assignee_kind: comIa ? "ai" : "user",
        assigned_to_user_id: comIa ? null : ID.usuario(c.com),
        assigned_to_user_name: comIa ? null : (EQUIPE.find((p) => p.chave === c.com)?.nome ?? null),
        assigned_at: emMin(0),
        active_ai_agent_id: ID.agente,
        last_inbound_at: entradas.length ? emMin(entradas[entradas.length - 1]!.min) : null,
        last_outbound_at: saidas.length ? emMin(saidas[saidas.length - 1]!.min) : null,
        last_message_at: emMin(ultimoMinuto),
        last_message_preview: ultima.texto.slice(0, 120),
        unread_count_for_assignee: ultima.de === "cliente" ? 1 : 0,
        tags: c.etiquetas ?? [],
        last_handoff_at: c.passagem ? emMin(ultimoMinuto) : null,
        last_handoff_reason: c.passagem ? "requested_human" : null,
        metadata: json({ demonstracao: true }),
        created_at: emMin(0),
      },
      { manter: ["created_at"] },
    );

    for (const [i, m] of c.mensagens.entries()) {
      const saida = m.de !== "cliente";
      const em = emMin(m.min);
      await gravar(db, "public.messages", {
        id: ID.mensagem(c.chave, i),
        organization_id: ID_DA_EMPRESA,
        conversation_id: id,
        channel_session_id: ID.canal,
        contact_id: contato,
        type: "text",
        direction: saida ? "outbound" : "inbound",
        // Histórico JÁ entregue: a trava da 9010 recusaria qualquer coisa em fila.
        status: saida ? "read" : "received",
        body: m.texto,
        sent_via: m.de === "ia" ? "ai" : m.de === "equipe" ? "user" : "crm",
        sent_by_user_id: m.de === "equipe" && !comIa ? ID.usuario(c.com) : null,
        sent_at: em,
        delivered_at: saida ? new Date(em.getTime() + 5_000) : null,
        read_at: saida ? new Date(em.getTime() + 60_000) : null,
        metadata: json({ demonstracao: true, ...(m.de === "ia" ? { ai_actor_id: ID.agente } : {}) }),
        created_at: em,
      });
    }

    // O que a IA entendeu: o estado do lead, as transições e a ficha.
    await gravar(
      db,
      "public.lead_state",
      {
        id: ID.estado(c.chave),
        organization_id: ID_DA_EMPRESA,
        contact_id: contato,
        stage: c.passo,
        qualification: json(c.qualificacao),
        next_action: c.proximaAcao,
        updated_at: emMin(ultimoMinuto),
      },
      { conflito: "organization_id, contact_id" },
    );
    const caminho = ["new", "contacted", "qualifying", "qualified", "negotiating"];
    const alvo = c.passo === "won" || c.passo === "lost" ? caminho.length : caminho.indexOf(c.passo);
    const passos = [...caminho.slice(0, Math.max(alvo, 0) + 1)];
    if (c.passo === "won" || c.passo === "lost") passos.push(c.passo);
    for (let i = 1; i < passos.length; i += 1) {
      await gravar(db, "public.lead_state_transitions", {
        id: ID.transicao(c.chave, i),
        organization_id: ID_DA_EMPRESA,
        contact_id: contato,
        from_stage: passos[i - 1]!,
        to_stage: passos[i]!,
        reason: "semente do cliente modelo",
        created_at: emMin(Math.round((ultimoMinuto * i) / passos.length)),
      });
    }
    if (c.ficha) {
      await gravar(db, "public.lead_notes", {
        id: ID.nota(c.chave),
        organization_id: ID_DA_EMPRESA,
        contact_id: contato,
        headline: c.ficha.headline,
        body: c.ficha.body,
        created_at: emMin(ultimoMinuto),
        updated_at: emMin(ultimoMinuto),
      });
    }
    if (c.passagem) {
      const quem = c.passagem.reconhecidaPor ? ID.usuario(c.passagem.reconhecidaPor) : null;
      const ultimaDaIa = [...c.mensagens].reverse().find((m) => m.de === "ia");
      const passouEm = emMin(ultimaDaIa?.min ?? ultimoMinuto);
      await gravar(db, "public.passagens_de_atendimento", {
        id: ID.passagem(c.chave),
        organization_id: ID_DA_EMPRESA,
        contact_id: contato,
        conversation_id: id,
        motor: "engine",
        origem: "ferramenta_do_modelo",
        motivo_codigo: "requested_human",
        title: c.passagem.titulo,
        body: c.passagem.resumo,
        notes: c.passagem.ultimaFala,
        content: null,
        tentativas: json([]),
        cliente_avisado: true,
        criado_em: passouEm,
        reconhecido_por: quem,
        reconhecido_em: quem ? new Date(passouEm.getTime() + 30 * 60_000) : null,
      });
    }
  }
}

/** O caminho mais curto de `inicio` até o nó, andando pelas arestas do grafo. */
function caminhoAte(grafo: FlowGraph, alvo: string): string[] {
  const inicio = grafo.nodes.find((n) => n.type === "trigger")?.id;
  if (!inicio) throw new Error("cliente modelo: grafo sem gatilho");
  const anterior = new Map<string, string | null>([[inicio, null]]);
  const fila = [inicio];
  while (fila.length) {
    const atual = fila.shift()!;
    if (atual === alvo) break;
    for (const e of grafo.edges.filter((x) => x.source === atual)) {
      if (!anterior.has(e.target)) {
        anterior.set(e.target, atual);
        fila.push(e.target);
      }
    }
  }
  if (!anterior.has(alvo)) throw new Error(`cliente modelo: o nó "${alvo}" não é alcançável no grafo`);
  const caminho: string[] = [];
  for (let n: string | null = alvo; n; n = anterior.get(n) ?? null) caminho.unshift(n);
  return caminho;
}

async function gravarFollowups(db: pg.ClientBase, agora: Date, etapas: EtapasGravadas): Promise<void> {
  const emUso = new Set(INSCRICOES.map((i) => i.modelo));
  const grafos = new Map<string, FlowGraph>();

  for (const modelo of MODELOS_DE_FOLLOWUP) {
    const funil = etapas.get(FUNIL_DO_NICHO[modelo.nicho])!;
    const passo = /proposta|negociacao|matricula|decisao/.test(modelo.id) ? "negotiating" : "qualified";
    const etapa = funil.get(passo);
    if (!etapa) throw new Error(`cliente modelo: o funil do nicho ${modelo.nicho} não tem a etapa "${passo}"`);

    // As MESMAS três conferências da rota que instala o modelo (from-model).
    const gatilho = triggerConfigSchema.parse(modelo.gatilho({ stageId: etapa.id }));
    const grafo = flowGraphSchema.parse(modelo.grafo);
    const publicavel = validateFlowForPublish(grafo);
    if (!publicavel.ok) throw new Error(`cliente modelo: o modelo ${modelo.id} não passa no Publicar`);
    grafos.set(modelo.id, grafo);

    // Em uso = publicado (há inscrição andando nele); os demais ficam em rascunho,
    // como o produto os instala — a galeria mostra os dois estados.
    const ativo = emUso.has(modelo.id);
    // Nasce rascunho; a versão publicada entra depois (ela aponta para o ponteiro).
    await gravar(
      db,
      "public.followup_flow_pointers",
      {
        id: ID.fluxo(modelo.id),
        organization_id: ID_DA_EMPRESA,
        name: modelo.nome,
        status: "draft",
        active_version_id: null,
        draft_graph: json(grafo),
        handoff_policy: modelo.handoffPolicy,
        trigger_config: json(gatilho),
      },
      { manter: ["status", "active_version_id"] },
    );
    if (ativo) {
      await gravar(db, "public.followup_flow_versions", {
        id: ID.versao(modelo.id),
        organization_id: ID_DA_EMPRESA,
        pointer_id: ID.fluxo(modelo.id),
        graph: json(grafo),
        created_by: ID.usuario("helena"),
      });
    }
    await db.query(
      `update public.followup_flow_pointers set status = $2::text, active_version_id = $3::uuid
        where id = $1 and (status, active_version_id) is distinct from ($2::text, $3::uuid)`,
      [ID.fluxo(modelo.id), ativo ? "active" : "draft", ativo ? ID.versao(modelo.id) : null],
    );
  }

  for (const inscricao of INSCRICOES) {
    const modelo: ModeloDeFollowup | undefined = MODELOS_DE_FOLLOWUP.find((m) => m.id === inscricao.modelo);
    if (!modelo) throw new Error(`cliente modelo: modelo de follow-up "${inscricao.modelo}" não existe`);
    const grafo = grafos.get(modelo.id)!;
    const caminho = caminhoAte(grafo, inscricao.no);
    const vivo = inscricao.status === "active" || inscricao.status === "waiting_reply";
    const comecou = new Date(agora.getTime() - inscricao.comecouHaDias * DIA - 3 * HORA);
    const acabou = vivo ? null : new Date(agora.getTime() - Math.max(inscricao.comecouHaDias - 3, 1) * DIA);
    const conversa = CONVERSAS.find((c) => c.contato === inscricao.contato);
    const id = ID.inscricao(inscricao.chave);

    await gravar(db, "public.followup_enrollments", {
      id,
      organization_id: ID_DA_EMPRESA,
      pointer_id: ID.fluxo(modelo.id),
      version_id: ID.versao(modelo.id),
      contact_id: ID.contato(inscricao.contato),
      conversation_id: conversa ? ID.conversa(conversa.chave) : null,
      current_node_id: inscricao.no,
      status: inscricao.status,
      next_eval_at: vivo ? new Date(agora.getTime() + (inscricao.proximaEmHoras ?? 24) * HORA) : null,
      claimed_until: null,
      attempts: 0,
      last_error: null,
      steps_taken: inscricao.passos,
      outcome: inscricao.desfecho ?? null,
      cancel_reason: inscricao.motivoDoCancelamento ?? null,
      started_at: comecou,
      completed_at: acabou,
    });

    // O dossiê: por onde a inscrição passou até o nó de hoje.
    const passo = (vivo ? 0 : 1) + caminho.length - 1;
    const intervalo = ((acabou ?? agora).getTime() - comecou.getTime()) / Math.max(passo + 1, 2);
    const eventos: { no: string; tipo: string; payload: Record<string, unknown> }[] = [];
    for (let i = 1; i < caminho.length; i += 1) {
      const no = grafo.nodes.find((n) => n.id === caminho[i])!;
      eventos.push({ no: caminho[i - 1]!, tipo: "node_advanced", payload: { next_node_id: no.id } });
      if (no.type === "action") eventos.push({ no: no.id, tipo: "action_sent", payload: {} });
    }
    if (!vivo) {
      eventos.push({
        no: inscricao.no,
        tipo: "flow_completed",
        payload: inscricao.desfecho
          ? { outcome: inscricao.desfecho }
          : { cancel_reason: inscricao.motivoDoCancelamento ?? null },
      });
    }
    for (const [i, e] of eventos.entries()) {
      await gravar(db, "public.followup_enrollment_events", {
        id: ID.eventoDaInscricao(inscricao.chave, i),
        organization_id: ID_DA_EMPRESA,
        enrollment_id: id,
        node_id: e.no,
        event_type: e.tipo,
        payload: json(e.payload),
        created_at: new Date(comecou.getTime() + (i + 1) * (intervalo / Math.max(eventos.length / 2, 1))),
      });
    }
  }
}

async function gravarAgenda(db: pg.ClientBase, agora: Date): Promise<void> {
  // "consulta", "reuniao" e "atendimento" o banco semeia em toda empresa nova.
  const extras = [
    { slug: "visita", nome: "Visita ao imóvel", categoria: "visita", duracao: 60 },
    { slug: "test-drive", nome: "Test drive", categoria: "demonstracao", duracao: 45 },
    { slug: "aula-experimental", nome: "Aula experimental", categoria: "outro", duracao: 60 },
  ];
  for (const [i, t] of extras.entries()) {
    await gravar(
      db,
      "public.calendar_event_types",
      {
        id: ID.tipoDeAgenda(t.slug),
        organization_id: ID_DA_EMPRESA,
        name: t.nome,
        slug: t.slug,
        category: t.categoria,
        duration_minutes: t.duracao,
        position: 4000 + i * 1000,
      },
      { conflito: "organization_id, slug" },
    );
  }
  // Lembrete desligado: ele sairia pela fila de mensagens, que a 9010 recusa, e
  // o cron ficaria tentando. Na demonstração o lembrete aparece desligado.
  await db.query(`update public.calendar_event_types set reminder_enabled = false where organization_id = $1`, [
    ID_DA_EMPRESA,
  ]);
  const { rows: tipos } = await db.query<{ id: string; slug: string; duration_minutes: number }>(
    `select id, slug, duration_minutes from public.calendar_event_types where organization_id = $1`,
    [ID_DA_EMPRESA],
  );

  for (const c of COMPROMISSOS) {
    const tipo = tipos.find((t) => t.slug === c.tipo);
    if (!tipo) throw new Error(`cliente modelo: tipo de agendamento "${c.tipo}" não existe`);
    const inicio = naHoraLocal(agora, c.emDias, c.hora);
    const conversa = CONVERSAS.find((x) => x.contato === c.contato);
    const cancelado = c.status === "cancelled";
    await gravar(db, "public.calendar_appointments", {
      id: ID.compromisso(c.chave),
      organization_id: ID_DA_EMPRESA,
      event_type_id: tipo.id,
      title: c.titulo,
      starts_at: inicio,
      ends_at: new Date(inicio.getTime() + c.duracaoMin * 60_000),
      time_zone: "America/Sao_Paulo",
      status: c.status,
      owner_user_id: ID.usuario(c.dono),
      contact_id: ID.contato(c.contato),
      conversation_id: conversa ? ID.conversa(conversa.chave) : null,
      location_kind: c.local,
      location_details: c.local === "in_person" ? "Unidade da demonstração (endereço fictício)" : null,
      notes: c.nota ?? null,
      cancellation_reason: cancelado ? (c.nota ?? "Cancelado pelo cliente") : null,
      cancelled_at: cancelado ? new Date(inicio.getTime() - DIA) : null,
      created_by_kind: c.criadoPor,
      created_by_user_id: c.criadoPor === "user" ? ID.usuario(c.dono) : null,
      created_by_agent_id: c.criadoPor === "ai" ? ID.agente : null,
      source: c.criadoPor === "ai" ? "mcp" : "ui",
      // Lembrete tratado como já resolvido: nada a disparar para compromisso da demonstração.
      reminder_sent_at: inicio < agora ? new Date(inicio.getTime() - DIA) : null,
    });
  }
}

async function gravarTarefasSoltas(db: pg.ClientBase, agora: Date): Promise<void> {
  for (const t of TAREFAS) {
    await gravar(db, "public.crm_tasks", {
      id: ID.tarefa(t.chave),
      organization_id: ID_DA_EMPRESA,
      title: t.titulo,
      description: t.descricao ?? null,
      due_date: t.emDias === null ? null : naHoraLocal(agora, t.emDias, "18:00"),
      priority: t.prioridade,
      status: t.status,
      lead_id: null,
      contact_id: t.contato ? ID.contato(t.contato) : null,
      assigned_to: ID.usuario(t.dono),
      created_by: ID.usuario("helena"),
    });
  }
}

/**
 * Os eventos que ESTA transação emitiu (gatilhos de mensagem, de negócio…) são
 * histórico fictício, não tráfego: marcados como consumidos, nenhum worker
 * reage a eles. Os eventos de quem usar a demonstração depois seguem normais.
 */
async function neutralizarOsEventos(db: pg.ClientBase, desde: Date): Promise<void> {
  await db.query(
    `update public.event_log
        set status = 'done',
            consumed_by = array(select distinct unnest(consumed_by || array[$3::text])),
            updated_at = now()
      where organization_id = $1
        and created_at >= $2
        and status in ('pending', 'processing')`,
    [ID_DA_EMPRESA, desde, CONSUMIDOR_DA_SEMENTE],
  );
}

async function contar(db: pg.ClientBase): Promise<Record<string, number>> {
  const tabelas = [
    "user_organizations",
    "crm_empresas",
    "companies",
    "company_people",
    "contacts",
    "crm_pipelines",
    "crm_stages",
    "crm_leads",
    "crm_lead_activities",
    "crm_tasks",
    "conversations",
    "messages",
    "lead_state",
    "lead_notes",
    "passagens_de_atendimento",
    "followup_flow_pointers",
    "followup_enrollments",
    "calendar_event_types",
    "calendar_appointments",
  ];
  const contagens: Record<string, number> = {};
  for (const t of tabelas) {
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from public.${t} where organization_id = $1`,
      [ID_DA_EMPRESA],
    );
    contagens[t] = Number(rows[0]!.n);
  }
  return contagens;
}
