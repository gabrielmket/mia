/**
 * FORK MIA — as REGRAS de conversão da Meta por etapa do funil (migration 9017):
 * ler e gravar. O vocabulário (eventos, canais, valor) mora em `./eventos`.
 *
 * ── Um caminho de escrita só ────────────────────────────────────────────────
 *
 * `salvarRegrasDaMeta` é chamada pela ação da tela
 * (`app/actions/settings/conversoesDaMeta.ts`) e pelas ferramentas do MCP de
 * plataforma (`lib/implantacao/conversoes.ts`). A conferência da etapa, a
 * coerência do valor e a auditoria são as mesmas nos dois, porque são a mesma
 * função: o que a tela recusa, a ferramenta recusa.
 *
 * ── Só grava o que mudou ────────────────────────────────────────────────────
 *
 * A implantação por ferramenta roda mais de uma vez, e o invariante dela mede o
 * RETRATO do banco: regravar uma linha igual mexeria em `atualizada_em`. Cada
 * etapa volta com `criou`, `atualizou` ou `ja_estava`.
 *
 * ⚠️ Servidor: importa `lib/audit`. Componente de cliente importa só de
 * `./eventos` e `./situacao` (regras puras), nunca daqui.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";

import {
  ehChaveDeEventoDaMeta,
  TETO_DO_VALOR_FIXO_CENTAVOS,
  VALORES_DE_CANAL_DA_META,
  VALORES_DE_MODO_DO_VALOR,
  type CanalDeEntradaDaMeta,
  type ChaveDoEventoDaMeta,
  type ModoDoValor,
  type RegraDaEtapa,
} from "./eventos";

export interface RegraDeConversaoMeta extends RegraDaEtapa {
  id: string;
  stageId: string;
  /** A trava de retroatividade: só o movimento posterior envia. */
  configuradaEm: string;
}

interface LinhaDaRegra {
  id: string;
  stage_id: string;
  evento: string;
  canal: string;
  modo_do_valor: string;
  valor_fixo_centavos: number | null;
  ligada: boolean;
  configurada_em: string;
}

const COLUNAS = "id, stage_id, evento, canal, modo_do_valor, valor_fixo_centavos, ligada, configurada_em";

function paraRegra(l: LinhaDaRegra): RegraDeConversaoMeta | null {
  // Evento que o código não conhece mais (lista encolheu): a regra não vale.
  // Mandar "o primeiro da lista" no lugar informaria à Meta o evento errado.
  if (!ehChaveDeEventoDaMeta(l.evento)) return null;
  return {
    id: l.id,
    stageId: l.stage_id,
    evento: l.evento,
    canal: (VALORES_DE_CANAL_DA_META as readonly string[]).includes(l.canal)
      ? (l.canal as CanalDeEntradaDaMeta)
      : "todos",
    modoDoValor: (VALORES_DE_MODO_DO_VALOR as readonly string[]).includes(l.modo_do_valor)
      ? (l.modo_do_valor as ModoDoValor)
      : "sem_valor",
    valorFixoCentavos: l.valor_fixo_centavos === null ? null : Number(l.valor_fixo_centavos),
    ligada: l.ligada === true,
    configuradaEm: l.configurada_em,
  };
}

/** Todas as regras da organização. Lança em falha de leitura. */
export async function listarRegrasDaMeta(
  admin: SupabaseClient,
  organizationId: string,
): Promise<RegraDeConversaoMeta[]> {
  const { data, error } = await admin
    .from("mia_conversoes_meta_regras")
    .select(COLUNAS)
    .eq("organization_id", organizationId);
  if (error) throw new Error("Não foi possível ler as regras de conversão da Meta.");
  return ((data ?? []) as LinhaDaRegra[]).map(paraRegra).filter((r): r is RegraDeConversaoMeta => r !== null);
}

/** A regra da etapa, ou null. Lança em falha de leitura (o consumidor reagenda). */
export async function lerRegraDaEtapaDaMeta(
  admin: SupabaseClient,
  organizationId: string,
  stageId: string,
): Promise<RegraDeConversaoMeta | null> {
  const { data, error } = await admin
    .from("mia_conversoes_meta_regras")
    .select(COLUNAS)
    .eq("organization_id", organizationId)
    .eq("stage_id", stageId)
    .maybeSingle();
  if (error) throw new Error("Não foi possível ler a regra de conversão da etapa.");
  return data ? paraRegra(data as LinhaDaRegra) : null;
}

// ── Os funis, do jeito que a régua os mostra ────────────────────────────────

export interface FunilDaRegua {
  id: string;
  nome: string;
  /** As etapas ABERTAS, na ordem do funil. A primeira é onde o negócio nasce. */
  etapas: Array<{ id: string; nome: string }>;
  /** Os nomes das etapas de ganho e de perda: ficam fora da régua, e a tela diz por quê. */
  ganho: string[];
  perda: string[];
}

/**
 * Os funis vivos da organização com as etapas na ordem. Ganho é a compra e
 * perda não é conversão: nenhuma das duas é etapa da régua.
 */
export async function lerFunisDaRegua(admin: SupabaseClient, organizationId: string): Promise<FunilDaRegua[]> {
  const [funis, etapas] = await Promise.all([
    admin
      .from("crm_pipelines")
      .select("id, name, position, is_archived")
      .eq("organization_id", organizationId)
      .order("position"),
    admin
      .from("crm_stages")
      .select("id, name, pipeline_id, position, is_won, is_lost, is_archived")
      .eq("organization_id", organizationId)
      .order("position"),
  ]);
  if (funis.error || etapas.error) throw new Error("Não foi possível ler os funis da organização.");

  type Etapa = {
    id: string;
    name: string;
    pipeline_id: string;
    is_won: boolean;
    is_lost: boolean;
    is_archived?: boolean | null;
  };
  const dasEtapas = ((etapas.data ?? []) as Etapa[]).filter((e) => e.is_archived !== true);

  return ((funis.data ?? []) as Array<{ id: string; name: string; is_archived?: boolean | null }>)
    .filter((f) => f.is_archived !== true)
    .map((f) => {
      const doFunil = dasEtapas.filter((e) => e.pipeline_id === f.id);
      return {
        id: f.id,
        nome: f.name,
        etapas: doFunil.filter((e) => !e.is_won && !e.is_lost).map((e) => ({ id: e.id, nome: e.name })),
        ganho: doFunil.filter((e) => e.is_won).map((e) => e.name),
        perda: doFunil.filter((e) => e.is_lost).map((e) => e.name),
      };
    });
}

// ── Gravar ──────────────────────────────────────────────────────────────────

export interface RegraParaSalvar {
  stageId: string;
  ligada: boolean;
  evento: ChaveDoEventoDaMeta;
  canal: CanalDeEntradaDaMeta;
  modoDoValor: ModoDoValor;
  /** Só com `modoDoValor = valor_fixo`. Nos outros modos é ignorado e gravado nulo. */
  valorFixoCentavos: number | null;
}

export type DesfechoDaRegra = "criou" | "atualizou" | "ja_estava";

export type ResultadoDeSalvarRegras =
  | { ok: true; regras: Array<{ stageId: string; desfecho: DesfechoDaRegra; ligada: boolean }> }
  | {
      ok: false;
      erro: "etapa_invalida" | "valor_fixo_invalido" | "etapa_repetida" | "erro_ao_gravar";
      /** As etapas que provocaram a recusa, quando a recusa é de etapa. */
      etapas?: string[];
    };

export interface QuemSalva {
  organizationId: string;
  /** A pessoa responsável: quem clicou na tela, ou quem criou o token do MCP. */
  autorUserId: string;
  requestId?: string;
  ip?: string;
  userAgent?: string;
  /** Por onde a gravação veio, para a trilha de auditoria. */
  via: "tela" | "mcp_plataforma";
}

/**
 * Grava as regras das etapas INFORMADAS. Etapa que não veio fica como está: a
 * tela salva um funil por vez, e a ferramenta do MCP cita só o que quer mudar.
 */
export async function salvarRegrasDaMeta(
  admin: SupabaseClient,
  quem: QuemSalva,
  regras: readonly RegraParaSalvar[],
): Promise<ResultadoDeSalvarRegras> {
  const org = quem.organizationId;
  if (regras.length === 0) return { ok: true, regras: [] };

  const ids = regras.map((r) => r.stageId);
  if (new Set(ids).size !== ids.length) return { ok: false, erro: "etapa_repetida" };

  const semValor = regras.filter(
    (r) =>
      r.modoDoValor === "valor_fixo" &&
      (r.valorFixoCentavos === null ||
        !Number.isInteger(r.valorFixoCentavos) ||
        r.valorFixoCentavos <= 0 ||
        r.valorFixoCentavos > TETO_DO_VALOR_FIXO_CENTAVOS),
  );
  if (semValor.length > 0) {
    return { ok: false, erro: "valor_fixo_invalido", etapas: semValor.map((r) => r.stageId) };
  }

  // Toda etapa precisa ser DESTA organização e estar aberta: ganho é a compra
  // (o consumidor de venda) e perda não é conversão. O cliente é service-role,
  // então o filtro de organização é o que impede regra em etapa de outra empresa.
  const { data: etapas, error: erroEtapas } = await admin
    .from("crm_stages")
    .select("id")
    .eq("organization_id", org)
    .eq("is_won", false)
    .eq("is_lost", false)
    .in("id", ids);
  if (erroEtapas) return { ok: false, erro: "erro_ao_gravar" };
  const validas = new Set(((etapas ?? []) as Array<{ id: string }>).map((e) => e.id));
  const invalidas = ids.filter((id) => !validas.has(id));
  if (invalidas.length > 0) return { ok: false, erro: "etapa_invalida", etapas: invalidas };

  const { data: existentes, error: erroLeitura } = await admin
    .from("mia_conversoes_meta_regras")
    .select(COLUNAS)
    .eq("organization_id", org)
    .in("stage_id", ids);
  if (erroLeitura) return { ok: false, erro: "erro_ao_gravar" };
  const porEtapa = new Map(((existentes ?? []) as LinhaDaRegra[]).map((l) => [l.stage_id, l]));

  const desfechos: Array<{ stageId: string; desfecho: DesfechoDaRegra; ligada: boolean }> = [];
  for (const r of regras) {
    const valor = r.modoDoValor === "valor_fixo" ? r.valorFixoCentavos : null;
    const antes = porEtapa.get(r.stageId);
    const igual =
      antes !== undefined &&
      antes.evento === r.evento &&
      antes.canal === r.canal &&
      antes.modo_do_valor === r.modoDoValor &&
      (antes.valor_fixo_centavos === null ? null : Number(antes.valor_fixo_centavos)) === valor &&
      antes.ligada === r.ligada;
    if (igual) {
      desfechos.push({ stageId: r.stageId, desfecho: "ja_estava", ligada: r.ligada });
      continue;
    }

    const linha = {
      organization_id: org,
      stage_id: r.stageId,
      evento: r.evento,
      canal: r.canal,
      modo_do_valor: r.modoDoValor,
      valor_fixo_centavos: valor,
      ligada: r.ligada,
      atualizada_por: quem.autorUserId,
    };
    const { error } = await admin
      .from("mia_conversoes_meta_regras")
      .upsert(linha, { onConflict: "organization_id,stage_id" });
    if (error) return { ok: false, erro: "erro_ao_gravar" };
    desfechos.push({ stageId: r.stageId, desfecho: antes ? "atualizou" : "criou", ligada: r.ligada });
  }

  const mudaram = desfechos.filter((d) => d.desfecho !== "ja_estava");
  if (mudaram.length > 0) {
    await audit({
      action: "conversoes_meta.regras_salvas",
      actorUserId: quem.autorUserId,
      organizationId: org,
      resourceType: "mia_conversoes_meta_regras",
      resourceId: null,
      requestId: quem.requestId,
      ip: quem.ip,
      userAgent: quem.userAgent,
      metadata: {
        via: quem.via,
        etapas: mudaram.length,
        ligadas: regras.filter((r) => r.ligada).length,
        desligadas: regras.filter((r) => !r.ligada).length,
      },
    });
  }

  return { ok: true, regras: desfechos };
}
