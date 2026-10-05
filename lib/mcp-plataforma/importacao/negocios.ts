/**
 * IMPORTAR NEGÓCIOS — o que completa uma migração: o funil do cliente como ele
 * estava no outro CRM, inclusive o que já foi ganho e o que já foi perdido.
 *
 * ── A chave de reexecução ─────────────────────────────────────────────────
 *
 * `crm_leads` já tem lugar para o identificador de outro sistema: as colunas
 * `source` e `external_id`, com o índice único `uniq_crm_leads_org_source_external`
 * (é o que a captação por webhook e os leads dos formulários da Meta usam). A
 * importação grava `source = "importacao:<origem>"` e `external_id = <id no CRM
 * de origem>`: a segunda rodada acha o negócio em vez de criar outro, e duas
 * chamadas simultâneas não duplicam porque quem garante é o banco.
 *
 * ── Por que o negócio NASCE na etapa final, e nunca é movido ──────────────
 *
 * Um negócio ganho, criado pela tela, passa por três atos: nasce, é movido e é
 * fechado. Cada um emite um evento (`lead.created`, `lead.stage_changed`,
 * `lead.won`), e são esses eventos que acordam a automação de entrada em etapa,
 * o follow-up de etapa, o aviso da equipe e a CONVERSÃO enviada à Meta e ao
 * Google (`lib/conversoes/`). Migrar 300 vendas antigas mandaria 300 conversões
 * de hoje para as plataformas de anúncio.
 *
 * Aqui o negócio é inserido DIRETO na etapa em que estava. O gatilho do banco
 * (`fn_crm_lead_close_on_stage`) resolve sozinho se ele é aberto, ganho ou
 * perdido pela etapa, e o gatilho que emite `lead.won`/`lead.lost` só roda em
 * UPDATE. O `lead.created` é calado na origem por `importacao_silenciosa`
 * (`lib/leads/importacao-silenciosa.ts`). Sem evento, não há consumidor.
 *
 * Pelo mesmo motivo, na REEXECUÇÃO a importação nunca muda a etapa, a situação
 * nem o dono de um negócio que já existe: essas três mudanças são UPDATE que o
 * banco transforma em evento. Ela avisa a diferença e deixa a decisão para a
 * tela, onde mover um negócio tem o efeito que quem move espera.
 *
 * ── A data de criação ─────────────────────────────────────────────────────
 *
 * Negócio FECHADO (ganho ou perdido) leva a data de criação e a de fechamento
 * do CRM de origem: é o que faz a venda de março aparecer em março.
 *
 * Negócio ABERTO nasce com a data da importação, e a original fica guardada em
 * `source_metadata.importacao.criado_em`. A automação "N dias sem mensagem"
 * (`cron/lead-time-triggers`) usa o nascimento do negócio como âncora quando
 * ainda não houve conversa: um negócio aberto com a data de três meses atrás
 * dispararia essa regra na primeira varredura depois da importação, para a
 * base inteira de uma vez.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { createLeadHandler } from "@/app/api/v1/leads/_handler";
import { ApiError } from "@/lib/api/types";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { audit } from "@/lib/audit";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { camposDoFunil } from "@/lib/leads/campos-do-funil";
import type { ImportacaoSilenciosaDoNegocio } from "@/lib/leads/importacao-silenciosa";
import { motivosDoFunil, OUTRO } from "@/lib/leads/motivos-de-perda-do-funil";
import { apenasDigitos } from "@/lib/schemas/empresas";
import { CANONICAL_LOST_REASONS, createLeadSchema, rotuloDoMotivoDePerda } from "@/lib/schemas/leads";
import { precoParaCentavos } from "@/lib/schemas/produtos";
import { normalizePhoneBR } from "@/lib/webhooks/inbound";

import {
  chaveDoNome,
  Coletor,
  dataDeOrigem,
  ehObjeto,
  emFrase,
  explicarProblemaDoSchema,
  listaDeItens,
  mesmoValor,
  modoQuandoJaExiste,
  organizacaoDaImportacao,
  origemDaImportacao,
  pareceUuid,
  registrarImportacao,
  requestIdDe,
  somarEtiquetas,
  sourceDaImportacao,
  texto,
} from "./base";
import { redigirLote } from "./auditoria";
import { acharContatoPorEmail, acharContatoPorTelefone } from "./contatos";
import { EmpresasDaBase } from "./empresas";
import { OPERACAO_IMPORTAR_BASE } from "./operacoes";
import type { ContextoDaFerramenta, FerramentaDeImportacao, QuandoJaExiste, ResultadoDoLote } from "./tipos";

export const TETO_DE_NEGOCIOS = 100;

type Situacao = "aberto" | "ganho" | "perdido";

export const EXEMPLO_DE_NEGOCIO = {
  id_de_origem: "n-8841",
  titulo: "Reforma do apartamento 402",
  funil: "Comercial",
  etapa: "Proposta enviada",
  situacao: "aberto",
  valor: 12500.5,
  moeda: "BRL",
  dono_email: "vendedor@empresa.exemplo.invalid",
  contato_telefone: "(11) 99999-8888",
  empresa_cnpj: "12.345.678/0001-90",
  etiquetas: ["quente"],
  campos: { prazo: "junho" },
  criado_em: "2026-03-14",
  previsao_de_fechamento: "2026-11-30",
  nota: "No CRM antigo: pediu orçamento em três versões.",
};

const CAMPO_DO_NEGOCIO: Record<string, string> = {
  title: "titulo",
  description: "descricao",
  value_cents: "valor",
  currency: "moeda",
  expected_close_date: "previsao_de_fechamento",
  tags: "etiquetas",
};

// ── os funis da organização ───────────────────────────────────────────────

interface Etapa {
  id: string;
  pipeline_id: string;
  name: string;
  position: number;
  is_won: boolean;
  is_lost: boolean;
}

interface Funil {
  id: string;
  name: string;
  settings: Record<string, unknown>;
  etapas: Etapa[];
}

async function funisDaOrganizacao(admin: SupabaseClient, orgId: string): Promise<Funil[]> {
  const [funis, etapas] = await Promise.all([
    admin
      .from("crm_pipelines")
      .select("id, name, settings, position")
      .eq("organization_id", orgId)
      .eq("is_archived", false)
      .order("position", { ascending: true }),
    admin
      .from("crm_stages")
      .select("id, pipeline_id, name, position, is_won, is_lost")
      .eq("organization_id", orgId)
      .eq("is_archived", false)
      .order("position", { ascending: true }),
  ]);
  if (funis.error) throw new Error(`não consegui ler os funis: ${funis.error.message}`);
  if (etapas.error) throw new Error(`não consegui ler as etapas: ${etapas.error.message}`);
  const todas = (etapas.data ?? []) as unknown as Etapa[];
  return ((funis.data ?? []) as unknown as Array<{ id: string; name: string; settings: unknown }>).map((f) => ({
    id: f.id,
    name: f.name,
    settings: ehObjeto(f.settings) ? f.settings : {},
    etapas: todas.filter((e) => e.pipeline_id === f.id),
  }));
}

function acharFunil(funis: readonly Funil[], bruto: string): Funil | null {
  if (pareceUuid(bruto)) return funis.find((f) => f.id === bruto.trim()) ?? null;
  const chave = chaveDoNome(bruto);
  return funis.find((f) => chaveDoNome(f.name) === chave) ?? null;
}

function acharEtapa(funil: Funil, bruto: string): Etapa | null {
  if (pareceUuid(bruto)) return funil.etapas.find((e) => e.id === bruto.trim()) ?? null;
  const chave = chaveDoNome(bruto);
  return funil.etapas.find((e) => chaveDoNome(e.name) === chave) ?? null;
}

const abertas = (funil: Funil) => funil.etapas.filter((e) => !e.is_won && !e.is_lost);

/** "Novo, Proposta enviada (abertas); Ganho (ganho); Perdido (perda)" — para a recusa ensinar. */
function etapasEmFrase(funil: Funil): string {
  const grupo = (rotulo: string, etapas: Etapa[]) =>
    etapas.length > 0 ? `${rotulo}: ${emFrase(etapas.map((e) => e.name))}` : null;
  return (
    [
      grupo("abertas", abertas(funil)),
      grupo("de ganho", funil.etapas.filter((e) => e.is_won)),
      grupo("de perda", funil.etapas.filter((e) => e.is_lost)),
    ]
      .filter(Boolean)
      .join("; ") || "(o funil não tem etapas)"
  );
}

// ── a equipe ──────────────────────────────────────────────────────────────

/**
 * As pessoas que podem ser DONAS de negócio, por e-mail.
 *
 * Quem pode: vínculo não revogado e papel acima de `viewer` (a mesma régua que
 * `createLeadHandler` aplica ao receber `owner_user_id`). O e-mail mora no
 * Auth, não numa tabela do produto: é lido pessoa a pessoa, como faz a tela da
 * equipe (`GET /api/v1/team`).
 */
async function equipePorEmail(admin: SupabaseClient, orgId: string): Promise<Map<string, string>> {
  const { data, error } = await admin
    .from("user_organizations")
    .select("user_id, role")
    .eq("organization_id", orgId)
    .is("revoked_at", null);
  if (error) throw new Error(`não consegui ler a equipe: ${error.message}`);
  const porEmail = new Map<string, string>();
  for (const membro of (data ?? []) as Array<{ user_id: string; role: string }>) {
    if (membro.role === "viewer") continue;
    const { data: achado } = await admin.auth.admin.getUserById(membro.user_id);
    const email = achado?.user?.email?.trim().toLowerCase();
    if (email) porEmail.set(email, membro.user_id);
  }
  return porEmail;
}

// ── ler um item ───────────────────────────────────────────────────────────

interface NegocioLido {
  id_de_origem: string;
  titulo: string;
  descricao: string | null;
  funil: string;
  etapa: string | null;
  situacao: Situacao;
  valor_cents: number | null;
  moeda: string | null;
  dono_email: string | null;
  contato_telefone: string | null;
  contato_email: string | null;
  empresa_cnpj: string | null;
  empresa_nome: string | null;
  etiquetas: string[];
  campos: Record<string, unknown>;
  criado_em: string | null;
  fechado_em: string | null;
  previsao_de_fechamento: string | null;
  motivo_de_perda: string | null;
  canal: string | null;
  nota: string | null;
  avisos: string[];
}

type Leitura =
  | { ok: true; negocio: NegocioLido }
  | { ok: false; campo: string; esperado: string; exemplo?: string };

const SITUACOES: Record<string, Situacao> = {
  aberto: "aberto",
  aberta: "aberto",
  open: "aberto",
  ganho: "ganho",
  ganha: "ganho",
  won: "ganho",
  perdido: "perdido",
  perdida: "perdido",
  lost: "perdido",
};

/** Lê e valida UM negócio. Puro: não toca o banco. */
export function lerNegocio(item: unknown): Leitura {
  if (!ehObjeto(item)) {
    return {
      ok: false,
      campo: "(item)",
      esperado: "cada negócio é um objeto.",
      exemplo: JSON.stringify({ id_de_origem: "n-8841", titulo: "Plano anual", funil: "Comercial", etapa: "Novo" }),
    };
  }
  const avisos: string[] = [];

  const idDeOrigem = texto(item.id_de_origem, 200);
  if (!idDeOrigem) {
    return {
      ok: false,
      campo: "id_de_origem",
      esperado:
        "é obrigatório: o identificador do negócio no sistema de origem. É por ele que a reexecução reconhece o negócio; " +
        "sem ele, repetir a importação duplicaria o funil. Numa planilha sem id, use o número da linha.",
      exemplo: '"n-8841"',
    };
  }
  const titulo = texto(item.titulo, 400);
  if (!titulo) {
    return { ok: false, campo: "titulo", esperado: "todo negócio precisa de um título.", exemplo: '"Reforma do apartamento 402"' };
  }
  const funil = texto(item.funil, 200);
  if (!funil) {
    return {
      ok: false,
      campo: "funil",
      esperado: "é obrigatório: o NOME do funil que recebe o negócio, como aparece na tela.",
      exemplo: '"Comercial"',
    };
  }

  let situacao: Situacao = "aberto";
  const situacaoBruta = texto(item.situacao, 40);
  if (situacaoBruta) {
    const lida = SITUACOES[chaveDoNome(situacaoBruta)];
    if (!lida) {
      return { ok: false, campo: "situacao", esperado: 'aceita só "aberto", "ganho" ou "perdido".', exemplo: '"ganho"' };
    }
    situacao = lida;
  }

  // O valor vem na UNIDADE da moeda (12500.5 = doze mil e quinhentos e cinquenta
  // centavos). Texto passa pela régua do catálogo (`precoParaCentavos`), que
  // recusa o que não sabe ler em vez de chutar.
  let valorCents: number | null = null;
  if (item.valor !== undefined && item.valor !== null && item.valor !== "") {
    if (typeof item.valor === "number" && Number.isFinite(item.valor) && item.valor >= 0) {
      valorCents = Math.round(item.valor * 100);
    } else if (typeof item.valor === "string") {
      valorCents = precoParaCentavos(item.valor);
    }
    if (valorCents === null) {
      return {
        ok: false,
        campo: "valor",
        esperado:
          "deveria ser o valor na unidade da moeda, como número (12500.5) ou como texto no formato brasileiro (\"12.500,50\"). Não é em centavos.",
        exemplo: "12500.5",
      };
    }
  }

  let moeda: string | null = null;
  const moedaBruta = texto(item.moeda, 10);
  if (moedaBruta) {
    moeda = moedaBruta.toUpperCase();
    if (!/^[A-Z]{3}$/.test(moeda)) {
      return { ok: false, campo: "moeda", esperado: "deveria ser o código de três letras da moeda.", exemplo: '"BRL"' };
    }
  }

  let etiquetas: string[] = [];
  if (item.etiquetas !== undefined && item.etiquetas !== null) {
    if (!Array.isArray(item.etiquetas) || item.etiquetas.some((e) => typeof e !== "string")) {
      return { ok: false, campo: "etiquetas", esperado: "deveria ser uma lista de textos.", exemplo: '["quente", "retorno"]' };
    }
    etiquetas = [...new Set((item.etiquetas as string[]).map((e) => e.trim()).filter(Boolean))];
  }

  if (item.campos !== undefined && item.campos !== null && !ehObjeto(item.campos)) {
    return { ok: false, campo: "campos", esperado: "deveria ser um objeto de campo e valor.", exemplo: '{ "prazo": "junho" }' };
  }

  const data = (campo: string): { ok: true; valor: string | null } | { ok: false } => {
    const bruto = item[campo];
    if (bruto === undefined || bruto === null || bruto === "") return { ok: true, valor: null };
    const lida = dataDeOrigem(bruto);
    return lida ? { ok: true, valor: lida } : { ok: false };
  };
  const criadoEm = data("criado_em");
  if (!criadoEm.ok) {
    return { ok: false, campo: "criado_em", esperado: "deveria ser uma data.", exemplo: '"2026-03-14" ou "14/03/2026"' };
  }
  const fechadoEm = data("fechado_em");
  if (!fechadoEm.ok) {
    return { ok: false, campo: "fechado_em", esperado: "deveria ser uma data.", exemplo: '"2026-04-02" ou "02/04/2026"' };
  }
  const previsao = data("previsao_de_fechamento");
  if (!previsao.ok) {
    return { ok: false, campo: "previsao_de_fechamento", esperado: "deveria ser uma data.", exemplo: '"2026-11-30"' };
  }
  const agora = Date.now();
  if (criadoEm.valor && Date.parse(criadoEm.valor) > agora + 86_400_000) {
    return { ok: false, campo: "criado_em", esperado: "a data de criação não pode estar no futuro.", exemplo: '"2026-03-14"' };
  }
  if (fechadoEm.valor && Date.parse(fechadoEm.valor) > agora + 86_400_000) {
    return { ok: false, campo: "fechado_em", esperado: "a data de fechamento não pode estar no futuro.", exemplo: '"2026-04-02"' };
  }
  if (criadoEm.valor && fechadoEm.valor && Date.parse(fechadoEm.valor) < Date.parse(criadoEm.valor)) {
    return { ok: false, campo: "fechado_em", esperado: "o fechamento não pode ser anterior à criação do negócio.", exemplo: '"2026-04-02"' };
  }

  const telefoneBruto = texto(item.contato_telefone, 60);
  const telefone = telefoneBruto ? normalizePhoneBR(telefoneBruto) : null;
  if (telefoneBruto && !telefone) {
    avisos.push("`contato_telefone` não é um número válido e foi ignorado ao procurar o contato.");
  }
  const cnpj = apenasDigitos(texto(item.empresa_cnpj, 40) ?? "");
  if (cnpj && cnpj.length !== 14) avisos.push("`empresa_cnpj` não tem 14 dígitos e foi ignorado ao procurar a empresa.");

  const descricao = texto(item.descricao, 4000);
  // O MESMO schema do negócio criado pela tela: tamanho do título e da
  // descrição, valor inteiro e não negativo, moeda de três letras.
  const parsed = createLeadSchema.safeParse({
    pipeline_id: "00000000-0000-4000-8000-000000000000",
    stage_id: "00000000-0000-4000-8000-000000000000",
    title: titulo,
    description: descricao,
    value_cents: valorCents,
    ...(moeda ? { currency: moeda } : {}),
    expected_close_date: previsao.valor ? previsao.valor.slice(0, 10) : null,
    tags: etiquetas,
  });
  if (!parsed.success) {
    return { ok: false, ...explicarProblemaDoSchema(parsed.error.issues[0]!, CAMPO_DO_NEGOCIO) };
  }

  return {
    ok: true,
    negocio: {
      id_de_origem: idDeOrigem,
      titulo,
      descricao,
      funil,
      etapa: texto(item.etapa, 200),
      situacao,
      valor_cents: valorCents,
      moeda,
      dono_email: texto(item.dono_email, 320)?.toLowerCase() ?? null,
      contato_telefone: telefone,
      contato_email: texto(item.contato_email, 320)?.toLowerCase() ?? null,
      empresa_cnpj: cnpj.length === 14 ? cnpj : null,
      empresa_nome: texto(item.empresa_nome, 200),
      etiquetas,
      campos: ehObjeto(item.campos) ? item.campos : {},
      criado_em: criadoEm.valor,
      fechado_em: fechadoEm.valor,
      previsao_de_fechamento: previsao.valor ? previsao.valor.slice(0, 10) : null,
      motivo_de_perda: texto(item.motivo_de_perda, 500),
      canal: texto(item.canal, 120),
      nota: texto(item.nota, 4000),
      avisos,
    },
  };
}

// ── a etapa de destino ────────────────────────────────────────────────────

type Destino =
  | { ok: true; etapa: Etapa; perdidoNaEtapa: Etapa | null }
  | { ok: false; campo: string; esperado: string };

/**
 * A etapa em que o negócio NASCE, pela situação e pela etapa informadas.
 *
 * No produto, quem decide se um negócio está aberto, ganho ou perdido é a
 * ETAPA (o gatilho `fn_crm_lead_close_on_stage`). Então a situação que veio do
 * CRM de origem escolhe a etapa de destino:
 *
 *  - aberto  → a etapa informada, que tem de ser uma etapa aberta;
 *  - ganho   → a etapa de ganho do funil;
 *  - perdido → a etapa de perda do funil; a etapa aberta informada vira "em que
 *              etapa o negócio morreu" (`lost_from_stage_id`), que é o que o
 *              relatório de perdas pergunta.
 *
 * Etapa que não existe é RECUSA com a lista das que existem, nunca criação: um
 * erro de digitação viraria uma coluna nova no quadro do cliente.
 */
export function etapaDeDestino(funil: Funil, negocio: Pick<NegocioLido, "etapa" | "situacao">): Destino {
  const informada = negocio.etapa ? acharEtapa(funil, negocio.etapa) : null;
  if (negocio.etapa && !informada) {
    return {
      ok: false,
      campo: "etapa",
      esperado:
        `não existe a etapa "${negocio.etapa}" no funil "${funil.name}". As etapas deste funil são: ${etapasEmFrase(funil)}. ` +
        "Use o nome de uma delas, ou crie a etapa antes (ferramentas de funil da implantação, ou a tela Funis).",
    };
  }

  if (negocio.situacao === "aberto") {
    if (!informada) {
      return {
        ok: false,
        campo: "etapa",
        esperado:
          `negócio aberto precisa da etapa. As etapas abertas do funil "${funil.name}" são: ${emFrase(abertas(funil).map((e) => e.name))}.`,
      };
    }
    if (informada.is_won || informada.is_lost) {
      return {
        ok: false,
        campo: "situacao",
        esperado:
          `a etapa "${informada.name}" é de ${informada.is_won ? "ganho" : "perda"}, e o negócio veio como aberto. ` +
          `Mande situacao: "${informada.is_won ? "ganho" : "perdido"}", ou uma etapa aberta: ${emFrase(abertas(funil).map((e) => e.name))}.`,
      };
    }
    return { ok: true, etapa: informada, perdidoNaEtapa: null };
  }

  const querGanho = negocio.situacao === "ganho";
  const finais = funil.etapas.filter((e) => (querGanho ? e.is_won : e.is_lost));
  const final = informada && finais.some((e) => e.id === informada.id) ? informada : finais[0];
  if (!final) {
    return {
      ok: false,
      campo: "situacao",
      esperado:
        `o funil "${funil.name}" não tem etapa de ${querGanho ? "ganho" : "perda"}, e é a etapa que diz ao produto que o negócio foi ` +
        `${querGanho ? "ganho" : "perdido"}. Crie a etapa antes (ferramentas de funil da implantação, ou a tela Funis).`,
    };
  }
  if (informada && querGanho && informada.is_lost) {
    return { ok: false, campo: "etapa", esperado: `a etapa "${informada.name}" é de perda, e o negócio veio como ganho.` };
  }
  if (informada && !querGanho && informada.is_won) {
    return { ok: false, campo: "etapa", esperado: `a etapa "${informada.name}" é de ganho, e o negócio veio como perdido.` };
  }
  const aberta = informada && !informada.is_won && !informada.is_lost ? informada : null;
  return { ok: true, etapa: final, perdidoNaEtapa: querGanho ? null : aberta };
}

const MOTIVO_DE_SISTEMA = "moved_to_another_pipeline";

/**
 * O motivo de perda que o FUNIL aceita, a partir do texto do CRM de origem.
 *
 * O banco recusa motivo fora da lista (`fn_validate_lost_reason_required`):
 * os que o funil cadastrou mais os canônicos do produto. Os do funil vêm
 * primeiro (é a lista que o cliente escreveu para o negócio dele); os canônicos
 * casam pela chave ou pelo rótulo em português. Texto que não casa com nenhum
 * entra como "Outro motivo", e o texto original vai para a nota de histórico:
 * nada se perde, e nenhum motivo é inventado no funil do cliente.
 *
 * `moved_to_another_pipeline` fica de fora: é o motivo de SISTEMA da troca de
 * funil, que os relatórios não contam como perda. Aceitá-lo de uma lista
 * tiraria perdas reais da métrica.
 */
export function motivoDePerdaDoFunil(
  funil: Funil,
  bruto: string | null,
): { motivo: string; original: string | null } {
  if (!bruto) return { motivo: OUTRO, original: null };
  const opcoes = [...motivosDoFunil(funil.settings), ...CANONICAL_LOST_REASONS.filter((m) => m !== MOTIVO_DE_SISTEMA)];
  const chave = chaveDoNome(bruto);
  const achado = opcoes.find(
    (valor) => chaveDoNome(valor) === chave || chaveDoNome(rotuloDoMotivoDePerda(valor)) === chave,
  );
  return achado ? { motivo: achado, original: null } : { motivo: OUTRO, original: bruto };
}

// ── reexecução ────────────────────────────────────────────────────────────

interface NegocioNaBase {
  id: string;
  title: string;
  description: string | null;
  pipeline_id: string;
  stage_id: string;
  status: string;
  value_cents: number | string | null;
  currency: string | null;
  expected_close_date: string | null;
  tags: string[] | null;
  custom_fields: Record<string, unknown> | null;
  contact_id: string | null;
  empresa_id: string | null;
  owner_user_id: string | null;
}

const COLUNAS_DO_NEGOCIO =
  "id, title, description, pipeline_id, stage_id, status, value_cents, currency, expected_close_date, tags, " +
  "custom_fields, contact_id, empresa_id, owner_user_id";

/**
 * O valor de uma coluna como texto comparável.
 *
 * Uma coluna `date` chega como texto pelo PostgREST e como `Date` pelo driver
 * direto do Postgres; `value_cents` (bigint) chega como número num e como texto
 * no outro. Comparar sem igualar a forma faria a reexecução enxergar diferença
 * onde não há.
 */
function comoTexto(valor: unknown): string {
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return String(valor);
}

/**
 * O que a reexecução pode mudar num negócio que já existe.
 *
 * Só campos de DADO. Etapa, situação e dono ficam de fora de propósito: mudar
 * qualquer um dos três é um UPDATE que o banco transforma em evento
 * (`lead.won`, `lead.lost`, `lead.assigned`), e a importação não emite evento.
 */
export function mudancasDoNegocio(
  atual: NegocioNaBase,
  novo: NegocioLido,
  modo: QuandoJaExiste,
  vinculos: { contatoId: string | null; empresaId: string | null },
): { patch: Record<string, unknown>; naoAplicados: string[] } {
  const patch: Record<string, unknown> = {};
  const naoAplicados: string[] = [];

  const escalar = (coluna: keyof NegocioNaBase, veio: string | number | null, rotulo: string) => {
    if (veio === null || veio === "") return;
    const havia = atual[coluna];
    const vazio = havia === null || havia === undefined || havia === "";
    if (!vazio && comoTexto(havia) === comoTexto(veio)) return;
    if (vazio || modo === "atualizar") patch[coluna] = veio;
    else naoAplicados.push(rotulo);
  };

  escalar("title", novo.titulo, "titulo");
  escalar("description", novo.descricao, "descricao");
  escalar("value_cents", novo.valor_cents, "valor");
  if (novo.moeda) escalar("currency", novo.moeda, "moeda");
  escalar("expected_close_date", novo.previsao_de_fechamento, "previsao_de_fechamento");

  const etiquetas = somarEtiquetas(atual.tags ?? [], novo.etiquetas);
  if (etiquetas.length !== (atual.tags ?? []).length) patch.tags = etiquetas;

  const camposAtuais = atual.custom_fields ?? {};
  const camposNovos: Record<string, unknown> = { ...camposAtuais };
  let mudouCampo = false;
  for (const [chave, valor] of Object.entries(novo.campos)) {
    if (!(chave in camposAtuais)) {
      camposNovos[chave] = valor;
      mudouCampo = true;
    } else if (!mesmoValor(camposAtuais[chave], valor)) {
      if (modo === "atualizar") {
        camposNovos[chave] = valor;
        mudouCampo = true;
      } else {
        naoAplicados.push(`campos.${chave}`);
      }
    }
  }
  if (mudouCampo) patch.custom_fields = camposNovos;

  // Contato e empresa só PREENCHEM. Trocar o contato de um negócio que já tem
  // um é passar a negociação de uma pessoa para outra.
  if (vinculos.contatoId && !atual.contact_id) patch.contact_id = vinculos.contatoId;
  else if (vinculos.contatoId && atual.contact_id !== vinculos.contatoId) naoAplicados.push("contato");
  if (vinculos.empresaId && !atual.empresa_id) patch.empresa_id = vinculos.empresaId;
  else if (vinculos.empresaId && atual.empresa_id !== vinculos.empresaId) naoAplicados.push("empresa");

  return { patch, naoAplicados };
}

// ── a importação ──────────────────────────────────────────────────────────

/** Os campos personalizados na chave que o funil conhece, e os que ele não conhece. */
function camposPeloFunil(
  funil: Funil,
  campos: Record<string, unknown>,
): { campos: Record<string, unknown>; desconhecidos: string[] } {
  const definidos = camposDoFunil(funil.settings);
  const saida: Record<string, unknown> = {};
  const desconhecidos: string[] = [];
  for (const [nome, valor] of Object.entries(campos)) {
    const chave = chaveDoNome(nome);
    const definicao = definidos.find((d) => chaveDoNome(d.key) === chave || chaveDoNome(d.label) === chave);
    if (definicao) saida[definicao.key] = valor;
    else {
      saida[nome] = valor;
      desconhecidos.push(nome);
    }
  }
  return { campos: saida, desconhecidos };
}

export async function importarNegocios(
  ctx: ContextoDaFerramenta,
  args: Record<string, unknown>,
): Promise<ResultadoDoLote> {
  const organizacao = await organizacaoDaImportacao(ctx.admin, args.organization_id);
  const itens = listaDeItens(args, "negocios", TETO_DE_NEGOCIOS, EXEMPLO_DE_NEGOCIO);
  const modo = modoQuandoJaExiste(args.quando_ja_existe);
  const origem = origemDaImportacao(args.origem, true) as string;
  const requestId = requestIdDe(ctx);
  const orgId = organizacao.id;
  const source = sourceDaImportacao(origem);

  const funis = await funisDaOrganizacao(ctx.admin, orgId);
  const coletor = new Coletor();
  let equipe: Map<string, string> | null = null;
  let empresas: EmpresasDaBase | null = null;

  const handlerCtx: HandlerCtx = {
    organization_id: orgId,
    actor: { type: "user", id: ctx.autorUserId, role: "admin" },
    requestId,
  };

  for (let i = 0; i < itens.length; i += 1) {
    const posicao = i + 1;
    const lido = lerNegocio(itens[i]);
    if (!lido.ok) {
      coletor.recusar(posicao, lido.campo, lido.esperado, lido.exemplo);
      continue;
    }
    const novo = lido.negocio;
    const avisos = [...novo.avisos];

    const funil = acharFunil(funis, novo.funil);
    if (!funil) {
      coletor.recusar(
        posicao,
        "funil",
        `não existe o funil "${novo.funil}" neste cliente. Os funis são: ${emFrase(funis.map((f) => f.name))}. ` +
          "Use o nome de um deles, ou crie o funil antes (ferramentas de funil da implantação, ou a tela Funis). " +
          "A importação não cria funil nem etapa.",
      );
      continue;
    }
    const destino = etapaDeDestino(funil, novo);
    if (!destino.ok) {
      coletor.recusar(posicao, destino.campo, destino.esperado);
      continue;
    }

    try {
      // Os vínculos: contato e empresa precisam EXISTIR (a ordem da migração é
      // empresas → contatos → negócios). O que não é achado vira aviso, e a
      // reexecução liga depois que a base for completada.
      let contatoId: string | null = null;
      if (novo.contato_telefone || novo.contato_email) {
        const achado =
          (novo.contato_telefone ? await acharContatoPorTelefone(ctx.admin, orgId, novo.contato_telefone) : null) ??
          (novo.contato_email ? await acharContatoPorEmail(ctx.admin, orgId, novo.contato_email) : null);
        if (achado && !achado.is_anonymized) contatoId = achado.id;
        else {
          avisos.push(
            "O contato deste negócio não está na base, e o negócio entrou sem contato. Importe o contato com " +
              "plataforma_importar_contatos e repita esta chamada: a reexecução faz a ligação.",
          );
        }
      }
      let empresaId: string | null = null;
      if (novo.empresa_cnpj || novo.empresa_nome) {
        empresas ??= await EmpresasDaBase.carregar(ctx, orgId);
        const achada = empresas.achar(novo.empresa_nome, novo.empresa_cnpj).empresa;
        if (achada) empresaId = achada.id;
        else {
          avisos.push(
            "A empresa deste negócio não está na base, e o negócio entrou sem empresa. Importe a empresa com " +
              "plataforma_importar_empresas e repita esta chamada: a reexecução faz a ligação.",
          );
        }
      }

      const { campos, desconhecidos } = camposPeloFunil(funil, novo.campos);
      if (desconhecidos.length > 0) {
        avisos.push(
          `O funil "${funil.name}" não tem os campos ${emFrase(desconhecidos)}: o valor foi gravado, mas só aparece na tela ` +
            "depois que o campo for criado no funil com essa mesma chave.",
        );
      }

      const { data: jaExiste, error: erroBusca } = await ctx.admin
        .from("crm_leads")
        .select(COLUNAS_DO_NEGOCIO)
        .eq("organization_id", orgId)
        .eq("source", source)
        .eq("external_id", novo.id_de_origem)
        .maybeSingle();
      if (erroBusca) throw new Error(`não consegui procurar o negócio: ${erroBusca.message}`);

      if (jaExiste) {
        const atual = jaExiste as unknown as NegocioNaBase;
        const { patch, naoAplicados } = mudancasDoNegocio(atual, { ...novo, campos }, modo, { contatoId, empresaId });
        if (naoAplicados.length > 0) {
          avisos.push(
            `O negócio já tem outro valor em: ${naoAplicados.join(", ")}. Mantive o que estava` +
              (naoAplicados.every((c) => c === "contato" || c === "empresa")
                ? " (contato e empresa de um negócio só são preenchidos, nunca trocados, pela importação)."
                : '. Para substituir, repita com quando_ja_existe: "atualizar".'),
          );
        }
        if (atual.pipeline_id !== funil.id || atual.stage_id !== destino.etapa.id) {
          avisos.push(
            "O negócio já está na base em outra etapa (ou outro funil) e não foi movido. Mover muda a situação e dispara " +
              "os efeitos de etapa (automação, follow-up, conversão): faça pela tela, negócio a negócio.",
          );
        }
        if (Object.keys(patch).length === 0) {
          coletor.registrar(posicao, "ja_estava", { id: atual.id, avisos });
          continue;
        }
        const { data: gravado, error: erroUpdate } = await ctx.admin
          .from("crm_leads")
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq("organization_id", orgId)
          .eq("id", atual.id)
          .select("id")
          .maybeSingle();
        if (erroUpdate || !gravado) {
          coletor.recusar(posicao, "(gravação)", `o banco recusou a atualização: ${erroUpdate?.message ?? "o negócio não está mais na base"}.`);
          continue;
        }
        await audit({
          action: "lead.updated",
          actorUserId: ctx.autorUserId,
          organizationId: orgId,
          resourceType: "crm_lead",
          resourceId: atual.id,
          requestId,
          // Só os NOMES dos campos, como a edição pela tela.
          metadata: { actor_type: "user", via: "importacao", fields: Object.keys(patch) },
        });
        coletor.registrar(posicao, "atualizou", { id: atual.id, avisos });
        continue;
      }

      // O dono, pelo e-mail de quem é da equipe. Quem não é achado não vira
      // dono: o negócio entra sem responsável e a resposta diz por quê.
      let donoId: string | null = null;
      if (novo.dono_email) {
        equipe ??= await equipePorEmail(ctx.admin, orgId);
        donoId = equipe.get(novo.dono_email) ?? null;
        if (!donoId) {
          avisos.push(
            "O dono informado não é uma pessoa ativa da equipe deste cliente (ou só tem acesso de leitura): o negócio entrou " +
              "sem responsável. Convide a pessoa pela tela Equipe e atribua o negócio por lá.",
          );
        }
      }

      const fechado = novo.situacao !== "aberto";
      const historia: ImportacaoSilenciosaDoNegocio = {};
      const notas: string[] = [];
      if (fechado) {
        if (novo.fechado_em) {
          historia.closed_at = novo.fechado_em;
          // Sem a criação de origem, o negócio nasceria HOJE e teria fechado
          // antes de existir. A data mais antiga que se conhece dele é a do
          // fechamento.
          historia.created_at = novo.criado_em ?? novo.fechado_em;
          if (!novo.criado_em) avisos.push("O negócio veio sem `criado_em`: a criação ficou igual à data de fechamento.");
        } else {
          if (novo.criado_em) historia.created_at = novo.criado_em;
          avisos.push("O negócio veio fechado sem `fechado_em`: a data de fechamento ficou sendo a da importação.");
        }
      } else if (novo.fechado_em) {
        avisos.push("`fechado_em` foi ignorado: o negócio veio como aberto.");
      }
      if (novo.situacao === "perdido") {
        const { motivo, original } = motivoDePerdaDoFunil(funil, novo.motivo_de_perda);
        historia.lost_reason = motivo;
        if (destino.perdidoNaEtapa) historia.lost_from_stage_id = destino.perdidoNaEtapa.id;
        if (original) {
          notas.push(`Motivo de perda no sistema de origem: ${original}`);
          avisos.push(
            `O motivo de perda informado não está cadastrado no funil "${funil.name}": entrou como "Outro motivo", e o texto ` +
              "original ficou na nota de histórico do negócio.",
          );
        } else if (!novo.motivo_de_perda) {
          avisos.push('O negócio veio perdido sem `motivo_de_perda`: entrou como "Outro motivo".');
        }
      }
      if (novo.nota) notas.unshift(novo.nota);

      let criado: Record<string, unknown>;
      try {
        criado = await createLeadHandler(ctx.admin, handlerCtx, {
          pipeline_id: funil.id,
          stage_id: destino.etapa.id,
          title: novo.titulo,
          description: novo.descricao,
          contact_id: contatoId,
          empresa_id: empresaId,
          value_cents: novo.valor_cents,
          ...(novo.moeda ? { currency: novo.moeda } : {}),
          ...(donoId ? { owner_user_id: donoId } : {}),
          expected_close_date: novo.previsao_de_fechamento,
          tags: novo.etiquetas,
          source,
          external_id: novo.id_de_origem,
          custom_fields: campos,
          source_metadata: {
            importacao: {
              origem,
              id_de_origem: novo.id_de_origem,
              importado_em: new Date().toISOString(),
              ...(novo.criado_em ? { criado_em: novo.criado_em } : {}),
              ...(novo.canal ? { canal: novo.canal } : {}),
            },
          },
          // A presença deste campo é o que CALA o `lead.created`.
          importacao_silenciosa: historia,
        },
        // Migrar uma base não é criar negócio novo: o histórico entra como era
        // no CRM de origem, e a régua de campos obrigatórios da etapa (upstream
        // 1.73, #2295) vale para quem mexe no negócio daqui para frente.
        { exigirCamposDaEtapa: false });
      } catch (err) {
        const mensagem = err instanceof ApiError ? err.message || err.code : err instanceof Error ? err.message : "falha inesperada";
        coletor.recusar(
          posicao,
          "(gravação)",
          /duplicate key|uniq_crm_leads_org_source_external/i.test(mensagem)
            ? "este negócio foi gravado por outra chamada enquanto esta rodava. Repita a chamada: ele será reconhecido."
            : `o negócio não pôde ser criado: ${mensagem}.`,
        );
        continue;
      }
      const leadId = String(criado.id);

      // A nota de histórico entra na linha do tempo do negócio pelo mesmo
      // caminho de `POST /api/v1/leads/[id]/notas`: tipo `note`, texto no
      // `payload` (nunca no `reason`, que a tela mostra em qualquer lugar).
      if (notas.length > 0) {
        const atividade = await emitLeadActivity(ctx.admin, {
          organizationId: orgId,
          leadId,
          contactId: contatoId,
          type: "note",
          sourceModule: "crm",
          sourceId: leadId,
          actor: handlerCtx.actor,
          reason: "Nota interna",
          payload: { texto: notas.join("\n\n").slice(0, 4000), fixada: false, importada_de: origem },
        });
        if (!atividade.ok) {
          avisos.push("O negócio entrou, mas a nota de histórico não pôde ser gravada. Repetir a chamada não a recria: anote pela tela.");
        }
      }
      coletor.registrar(posicao, "criou", { id: leadId, avisos });
    } catch (err) {
      coletor.recusar(posicao, "(gravação)", err instanceof Error ? `${err.message}.` : "falha inesperada.");
    }
  }

  await registrarImportacao(ctx, {
    organizacao,
    ferramenta: "plataforma_importar_negocios",
    tipo: "negocios",
    origem,
    coletor,
    requestId,
    extra: { quando_ja_existe: modo },
  });

  return coletor.resultado(organizacao);
}

export const FERRAMENTA_IMPORTAR_NEGOCIOS: FerramentaDeImportacao = {
  name: "plataforma_importar_negocios",
  description:
    "Importa NEGÓCIOS (os cartões do funil) da base de outro CRM para um cliente da plataforma, inclusive os que já foram " +
    "ganhos ou perdidos. É o passo 5 de uma migração: equipe → funis → empresas → contatos → negócios → materiais. O funil " +
    "e as etapas precisam EXISTIR antes (a importação não os cria: funil ou etapa desconhecidos são recusados com a lista dos " +
    "que existem), e os contatos e as empresas também, para o negócio nascer ligado a eles.\n\n" +
    `Teto: ${TETO_DE_NEGOCIOS} negócios por chamada. Lista maior: chame várias vezes; a resposta traz as contagens.\n\n` +
    "Pode ser repetida sem duplicar: o negócio é reconhecido por `origem` + `id_de_origem` (use sempre a mesma origem). A " +
    "resposta diz, item a item (posição começando em 1), se criou, atualizou, já estava igual ou recusou e por quê. Um item " +
    "ruim não derruba os outros. Na reexecução só dados são atualizados (título, valor, etiquetas, campos, vínculos vazios): " +
    "etapa, situação e dono de um negócio que já existe NÃO são mexidos.\n\n" +
    "O que NÃO faz: não envia mensagem, não inscreve em follow-up, não dispara automação de negócio criado, de entrada em etapa " +
    "nem de ganho, não cria tarefa, não avisa a equipe e não registra conversão para a Meta ou o Google, nem para negócio " +
    "importado como ganho. Negócio fechado leva a data de criação e de fechamento de origem; negócio aberto nasce com a data " +
    "de hoje (a original fica guardada), para não disparar regra por tempo de silêncio.",
  inputSchema: {
    organization_id: z.string().describe("O id do cliente que recebe a base (de plataforma_listar_clientes)."),
    origem: z
      .string()
      .describe(
        'De qual sistema a base vem, em minúsculas e sem espaço (ex.: "rdstation", "pipedrive", "planilha"). É metade da ' +
          "chave que impede duplicar: use SEMPRE o mesmo nome nas reexecuções.",
      ),
    negocios: z
      .array(z.unknown())
      .describe(
        `Até ${TETO_DE_NEGOCIOS} negócios. Cada um: id_de_origem (obrigatório), titulo (obrigatório), funil (obrigatório, pelo NOME), ` +
          'etapa (pelo NOME; obrigatória para negócio aberto), situacao ("aberto" é o padrão, "ganho" ou "perdido"), valor (na ' +
          "unidade da moeda: 12500.5, não em centavos), moeda (três letras; sem isso vale a do cliente), dono_email (pessoa da " +
          "equipe), contato_telefone e/ou contato_email, empresa_cnpj e/ou empresa_nome, etiquetas (lista), campos (objeto com os " +
          "campos do funil, pela chave ou pelo nome do campo), criado_em, fechado_em e previsao_de_fechamento (datas), " +
          "motivo_de_perda (texto), canal, descricao e nota (vira uma nota no histórico do negócio). " +
          `Exemplo: ${JSON.stringify(EXEMPLO_DE_NEGOCIO)}`,
      ),
    quando_ja_existe: z
      .string()
      .optional()
      .describe(
        '"completar" (padrão): só preenche o que está vazio no negócio que já existe. "atualizar": o que veio preenchido ' +
          "substitui o que havia. Nos dois, etiqueta só soma, e etapa, situação e dono nunca são mexidos.",
      ),
  },
  operacao: OPERACAO_IMPORTAR_BASE,
  exemplo: { organization_id: "00000000-0000-4000-8000-000000000001", origem: "rdstation", negocios: [EXEMPLO_DE_NEGOCIO] },
  handler: importarNegocios,
  redigirParaAuditoria: redigirLote(["organization_id", "origem", "quando_ja_existe"], ["negocios"]),
};
