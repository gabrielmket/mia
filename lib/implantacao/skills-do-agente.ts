/**
 * FORK MIA — as SKILLS do agente pelo MCP de plataforma (upstream 1.101 a 1.107).
 *
 * Duas coisas que a tela separa, e que aqui também ficam separadas:
 *
 *  - QUAIS skills o agente usa (`ai_agent_versions.skill_names`, 9107): é da
 *    VERSÃO, vai para o rascunho e vale ao publicar. `null` = todas as da
 *    empresa e da plataforma (o padrão), `[]` = nenhuma. A gravação é a do
 *    rascunho, em `./agente.ts`; aqui mora só a conferência dos nomes, com a
 *    frase que ensina (a da rota manda "recarregar a página").
 *
 *  - Por quais ETIQUETAS a skill entra (`skill_versions.matcher.any_tags`, 9230):
 *    é da SKILL, não do agente. Vale para TODO agente que usa a skill, na hora,
 *    sem publicar. A gravação espelha o `PUT /api/v1/ai/skills/[name]` da tela
 *    de Skills, passo a passo: versão NOVA da skill (a antiga é imutável), com o
 *    manifesto e o vínculo com o catálogo herdados, os arquivos do pacote
 *    copiados ANTES de o ponteiro mover, e a mesma linha de auditoria
 *    (`ai.skill_saved`). Só a skill INSTALADA na empresa se edita, como na tela.
 *
 * A etiqueta tem de EXISTIR na empresa (no vocabulário de
 * `organizations.settings.tags`, o de plataforma_garantir_etiquetas): uma
 * etiqueta digitada errado nunca casaria, e a skill ficaria sem entrar calada.
 */
import { insertSkillVersion, setSkillPointer, skillMatcherSchema, type SkillMatcher } from "@/lib/agent-engine/agent/skills";
import { getSkillsPool } from "@/lib/ai/skills/db";
import { copiarArquivosDoPacote } from "@/lib/ai/skills/package-files";
import { temPonteiroCanonico } from "@/lib/ai/skills/ponteiro-canonico";
import { audit } from "@/lib/audit";
import { Recusa } from "@/lib/mcp-plataforma/recusa";
import { chaveDaEtiqueta } from "@/lib/tags/cor-da-etiqueta";

import type { Desfecho, Implantacao } from "./base";

/** Quantas etiquetas uma skill aceita: o teto de `skillMatcherSchema.any_tags`. */
export const TETO_DE_ETIQUETAS_DA_SKILL = 20;

export interface SkillDaEmpresa {
  nome: string;
  /** "empresa": instalada nesta organização (editável). "plataforma": vale sem instalar. */
  de: "empresa" | "plataforma";
  descricao: string;
  /** As etiquetas pelas quais a skill entra (`matcher.any_tags`). */
  etiquetas: string[];
  versao_id: string;
  matcher: SkillMatcher;
  body: string;
  manifest: unknown[];
  forked_from_version_id: string | null;
}

export interface SkillPorEtiquetaPedida {
  skill: string;
  etiquetas: string[];
}

export interface SkillPorEtiquetaGarantida {
  skill: string;
  etiquetas: string[];
  desfecho: Desfecho;
}

/** O que a conferência deixou pronto para gravar, sem ter escrito nada. */
export interface SkillPorEtiquetaPreparada {
  skill: SkillDaEmpresa;
  etiquetas: string[];
  mudou: boolean;
}

/**
 * As skills que a empresa alcança, com as etiquetas de cada uma: a MESMA
 * resolução do runtime e da tela (`skillsDisponiveis`): ponteiros da empresa e
 * de plataforma, um por nome, a da empresa vencendo. Erro de leitura lança: uma
 * lista vazia por falha diria "nenhuma skill", que é afirmação falsa.
 */
export async function lerSkillsDaEmpresa(c: Pick<Implantacao, "admin" | "orgId">): Promise<SkillDaEmpresa[]> {
  const { data: ponteiros, error: erroPonteiros } = await c.admin
    .from("skill_pointers")
    .select("organization_id, name, version_id")
    .or(`organization_id.eq.${c.orgId},organization_id.is.null`);
  if (erroPonteiros) throw new Error(`não consegui ler as skills: ${erroPonteiros.message}`);
  const canonicos = (
    (ponteiros ?? []) as Array<{ organization_id: string | null; name: string | null; version_id: string | null }>
  ).filter(temPonteiroCanonico);
  if (canonicos.length === 0) return [];

  const { data: versoes, error: erroVersoes } = await c.admin
    .from("skill_versions")
    .select("id, description, body, matcher, manifest, forked_from_version_id")
    .in("id", [...new Set(canonicos.map((p) => p.version_id))]);
  if (erroVersoes) throw new Error(`não consegui ler as skills: ${erroVersoes.message}`);
  type Versao = {
    id: string;
    description: string;
    body: string;
    matcher: SkillMatcher | null;
    manifest: unknown;
    forked_from_version_id: string | null;
  };
  const porId = new Map(((versoes ?? []) as Versao[]).map((v) => [v.id, v]));

  const porNome = new Map<string, SkillDaEmpresa>();
  for (const p of canonicos) {
    const daEmpresa = p.organization_id !== null;
    if (porNome.get(p.name)?.de === "empresa" && !daEmpresa) continue;
    const v = porId.get(p.version_id);
    if (!v) continue;
    const matcher = (v.matcher ?? { any_keywords: [] }) as SkillMatcher;
    porNome.set(p.name, {
      nome: p.name,
      de: daEmpresa ? "empresa" : "plataforma",
      descricao: v.description ?? "",
      etiquetas: matcher.any_tags ?? [],
      versao_id: v.id,
      matcher,
      body: v.body,
      manifest: Array.isArray(v.manifest) ? v.manifest : [],
      forked_from_version_id: v.forked_from_version_id ?? null,
    });
  }
  return [...porNome.values()].sort((a, b) => a.nome.localeCompare(b.nome));
}

/**
 * A conferência de `skills` (quais o agente usa) antes do rascunho: o nome que
 * não existe é recusado com a lista do que existe. Devolve os nomes como
 * gravados (a grafia da skill), sem repetidos.
 */
export function conferirSkillsDoAgente(pedidas: string[], daEmpresa: SkillDaEmpresa[]): string[] {
  const porNome = new Map(daEmpresa.map((s) => [s.nome, s]));
  const ausentes = pedidas.filter((nome) => !porNome.has(nome.trim()));
  if (ausentes.length > 0) {
    const existentes = daEmpresa.map((s) => s.nome);
    throw new Recusa(
      `\`skills\`: ${ausentes.map((n) => `«${n}»`).join(", ")} não ${ausentes.length === 1 ? "existe" : "existem"} nesta empresa. ` +
        (existentes.length > 0
          ? `As que existem: ${existentes.map((n) => `«${n}»`).join(", ")} (plataforma_ver_agentes, \`skills_da_empresa\`). `
          : "A empresa ainda não tem nenhuma skill: elas são instaladas na tela Skills (/app/ai/skills). ") +
        "Para o agente usar todas, mande `skills: null`.",
    );
  }
  return [...new Set(pedidas.map((n) => n.trim()))];
}

function vocabularioDaEmpresa(settings: Record<string, unknown>): Map<string, string> {
  const lista = Array.isArray(settings.tags) ? (settings.tags as unknown[]) : [];
  const porChave = new Map<string, string>();
  for (const item of lista) {
    const nome = typeof item === "string" ? item : (item as { tag?: unknown } | null)?.tag;
    if (typeof nome === "string" && nome.trim() !== "") porChave.set(chaveDaEtiqueta(nome), nome.trim());
  }
  return porChave;
}

const mesmasEtiquetas = (a: string[], b: string[]) => {
  const ca = [...new Set(a.map(chaveDaEtiqueta))].sort();
  const cb = [...new Set(b.map(chaveDaEtiqueta))].sort();
  return ca.length === cb.length && ca.every((x, i) => x === cb[i]);
};

/**
 * Confere `skills_por_etiqueta` INTEIRO antes de gravar qualquer coisa: a skill
 * instalada na empresa, cada etiqueta no vocabulário dela, e o teto da skill.
 * Nada é escrito aqui.
 */
export function prepararSkillsPorEtiqueta(
  pedidas: SkillPorEtiquetaPedida[],
  daEmpresa: SkillDaEmpresa[],
  settings: Record<string, unknown>,
): SkillPorEtiquetaPreparada[] {
  const vocabulario = vocabularioDaEmpresa(settings);
  const vistas = new Set<string>();
  return pedidas.map((p, i) => {
    const nome = p.skill.trim();
    if (vistas.has(nome)) throw new Recusa(`\`skills_por_etiqueta\`: a skill «${nome}» aparece duas vezes. Mande uma entrada por skill, com a lista inteira de etiquetas.`);
    vistas.add(nome);

    const skill = daEmpresa.find((s) => s.nome === nome);
    if (!skill) {
      throw new Recusa(
        `\`skills_por_etiqueta[${i}]\`: a skill «${nome}» não existe nesta empresa. ` +
          (daEmpresa.length > 0
            ? `As que existem: ${daEmpresa.map((s) => `«${s.nome}»`).join(", ")}.`
            : "A empresa ainda não tem nenhuma skill: elas são instaladas na tela Skills (/app/ai/skills)."),
      );
    }
    if (skill.de !== "empresa") {
      throw new Recusa(
        `\`skills_por_etiqueta[${i}]\`: «${nome}» é uma skill da PLATAFORMA, que a empresa usa sem ter instalado, e não se edita. ` +
          "Uma pessoa a instala na tela Skills (/app/ai/skills); depois chame de novo.",
      );
    }

    const etiquetas: string[] = [];
    const ausentes: string[] = [];
    for (const pedida of p.etiquetas) {
      const gravada = vocabulario.get(chaveDaEtiqueta(pedida));
      if (!gravada) ausentes.push(pedida.trim());
      else if (!etiquetas.some((e) => chaveDaEtiqueta(e) === chaveDaEtiqueta(gravada))) etiquetas.push(gravada);
    }
    if (ausentes.length > 0) {
      throw new Recusa(
        `\`skills_por_etiqueta[${i}]\`: ${ausentes.map((e) => `«${e}»`).join(", ")} não ${ausentes.length === 1 ? "é etiqueta" : "são etiquetas"} desta empresa, e a skill nunca entraria por ${ausentes.length === 1 ? "ela" : "elas"}. ` +
          "Crie a etiqueta antes com plataforma_garantir_etiquetas (as que existem estão em plataforma_ver_configuracao, seção etiquetas), e chame de novo.",
      );
    }
    const conferido = skillMatcherSchema.safeParse({ ...skill.matcher, any_tags: etiquetas });
    if (!conferido.success) {
      throw new Recusa(
        `\`skills_por_etiqueta[${i}]\`: a skill aceita até ${TETO_DE_ETIQUETAS_DA_SKILL} etiquetas, de até 40 caracteres cada.`,
      );
    }
    return { skill, etiquetas, mudou: !mesmasEtiquetas(skill.etiquetas, etiquetas) };
  });
}

/**
 * Grava as etiquetas de cada skill que mudou, pelo caminho do PUT da tela de
 * Skills. A que não mudou responde `ja_estava` e não abre versão.
 */
export async function gravarSkillsPorEtiqueta(
  c: Implantacao,
  preparadas: SkillPorEtiquetaPreparada[],
): Promise<SkillPorEtiquetaGarantida[]> {
  const garantidas: SkillPorEtiquetaGarantida[] = [];
  for (const p of preparadas) {
    if (!p.mudou) {
      garantidas.push({ skill: p.skill.nome, etiquetas: p.skill.etiquetas, desfecho: "ja_estava" });
      continue;
    }
    // Sem etiqueta, a chave some do matcher: a skill volta a ser como a que nunca teve.
    const { any_tags: _antigas, ...semEtiquetas } = p.skill.matcher;
    const matcher: SkillMatcher = p.etiquetas.length > 0 ? { ...semEtiquetas, any_tags: p.etiquetas } : semEtiquetas;
    const pool = getSkillsPool();
    const versao = await insertSkillVersion(pool, {
      tenantId: c.orgId,
      name: p.skill.nome,
      description: p.skill.descricao,
      body: p.skill.body,
      matcher,
      manifest: p.skill.manifest,
      forkedFromVersionId: p.skill.forked_from_version_id,
    });
    if (p.skill.manifest.length > 0) {
      // Os arquivos do pacote moram sob o id da VERSÃO: copiados antes do ponteiro
      // mover. Falha aqui = o agente segue lendo a versão antiga, intacta.
      await copiarArquivosDoPacote(
        { admin: c.admin },
        {
          organizationId: c.orgId,
          name: p.skill.nome,
          deVersionId: p.skill.versao_id,
          paraVersionId: versao.id,
          manifest: p.skill.manifest,
        },
      );
    }
    await setSkillPointer(pool, { tenantId: c.orgId, name: p.skill.nome, versionId: versao.id });
    await audit({
      action: "ai.skill_saved",
      actorUserId: c.autorUserId,
      organizationId: c.orgId,
      resourceType: "skill_versions",
      resourceId: versao.id,
      requestId: c.requestId,
      metadata: {
        name: p.skill.nome,
        keywords: matcher.any_keywords?.length ?? 0,
        tags: matcher.any_tags?.length ?? 0,
        via: "mcp_plataforma",
      },
    });
    garantidas.push({ skill: p.skill.nome, etiquetas: p.etiquetas, desfecho: "atualizou" });
  }
  return garantidas;
}
