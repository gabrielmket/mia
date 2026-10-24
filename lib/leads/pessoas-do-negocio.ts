/**
 * FORK MIA (.87) · AS PESSOAS DO NEGÓCIO, lidas dos DOIS modelos, sem converter nada.
 *
 * ── Os dois modelos, na mesma tabela ──────────────────────────────────────
 *
 * `crm_lead_links` com `target_kind = 'contact'` guarda as pessoas de um negócio
 * além do contato principal, e hoje dois escritores gravam nela:
 *
 *   fork (cartão aberto)     `link_kind = 'envolvido'`, `metadata.papel` = um dos
 *                            cinco papéis da lista fechada (lib/cartoes/papel.ts),
 *                            pela rota `/api/v1/leads/[id]/envolvidos`;
 *   upstream (o dossiê,      `link_kind = 'related'`, `metadata.papel` em texto
 *   v1.88, #1506 e #3083)    livre (até 40), pela rota
 *                            `/api/v1/leads/[id]/contatos-relacionados`.
 *
 * Até a .86 um não enxergava o outro: quem entrava pelo dossiê aparecia no
 * cartão aberto sem papel e não saía pelo "Tirar"; quem entrava pelo cartão não
 * aparecia no dossiê. A decisão de 24/10/2026 é que o modelo do fork FICA (a
 * lista fechada, a tela, os dados); o que entra da v1.88 é a leitura que une os
 * dois, e as recusas dele que o fork já tinha.
 *
 * ── As regras da leitura (as do leitor do upstream) ───────────────────────
 *
 *  - os dois tipos de vínculo, e só eles;
 *  - a lápide de fusão aparece pelo vencedor (`is_merged_into`, até 5 voltas);
 *  - contato de outra organização não aparece: `target_id` não é chave
 *    estrangeira, e a RLS só confere a organização do NEGÓCIO;
 *  - o contato principal do negócio não aparece como participante;
 *  - cada pessoa aparece uma vez: com dois vínculos para o mesmo contato, vale
 *    o mais antigo (a régua do leitor do upstream, `created_at` crescente).
 *
 * ── A regra da escrita ────────────────────────────────────────────────────
 *
 * Quem grava um tipo tira o OUTRO do mesmo contato no mesmo negócio
 * (`tirarOOutroVinculo`): cada pessoa fica com um vínculo só, e o papel que vale
 * é o de quem gravou por último, numa tela ou na outra. Tirar a pessoa, em
 * qualquer das duas telas, tira os dois.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ehPapel, papelDoTexto, ROTULO_DO_PAPEL, type Papel } from "@/lib/cartoes/papel";

type Db = Pick<SupabaseClient, "from">;

/** O vínculo do fork (cartão aberto, papel da lista fechada). */
export const VINCULO_DO_FORK = "envolvido" as const;
/**
 * O vínculo do upstream (o dossiê, papel em texto livre). É o mesmo valor de
 * `VINCULO_DE_CONTATO` da rota dele; `tests/unit/pessoas-do-negocio-dos-dois-modelos`
 * prende os dois juntos.
 */
export const VINCULO_DO_UPSTREAM = "related" as const;
/** Os dois, para o `.in("link_kind", …)` de quem lê ou tira. */
export const VINCULOS_DA_PESSOA_DO_NEGOCIO = [VINCULO_DO_FORK, VINCULO_DO_UPSTREAM] as const;
export type VinculoDaPessoaDoNegocio = (typeof VINCULOS_DA_PESSOA_DO_NEGOCIO)[number];
/** O alvo polimórfico das pessoas (CHECK de sete valores no baseline do upstream). */
export const ALVO_DA_PESSOA_DO_NEGOCIO = "contact" as const;

/** O papel de um vínculo, nos dois vocabulários. */
export interface PapelDoVinculo {
  /** Um dos cinco do fork: o código gravado pelo cartão, ou o texto do dossiê que é um deles. */
  papel: Papel | null;
  /** O texto do dossiê que NÃO é um dos cinco ("Pagante"), como foi escrito. */
  papelLivre: string | null;
}

function textoDoPapel(metadata: unknown): string | null {
  const bruto = (metadata as { papel?: unknown } | null | undefined)?.papel;
  return typeof bruto === "string" && bruto.trim() !== "" ? bruto.trim() : null;
}

export function papelDoVinculo(linkKind: string | null | undefined, metadata: unknown): PapelDoVinculo {
  const texto = textoDoPapel(metadata);
  if (!texto) return { papel: null, papelLivre: null };
  const papel = linkKind === VINCULO_DO_FORK && ehPapel(texto) ? texto : papelDoTexto(texto);
  return papel ? { papel, papelLivre: null } : { papel: null, papelLivre: texto };
}

/**
 * O papel como o DOSSIÊ do upstream o mostra: o texto que a pessoa escreveu, ou,
 * para o vínculo do fork, o rótulo do papel da lista ("Financeiro"), traduzido
 * para o idioma de quem lê. O dossiê mostra o papel como veio; sem isto ele
 * mostraria o código ("financeiro", "usuario").
 */
export function papelParaODossie(
  linkKind: string | null | undefined,
  metadata: unknown,
  traduzir: (texto: string) => string,
): string | null {
  const texto = textoDoPapel(metadata);
  if (linkKind === VINCULO_DO_FORK && ehPapel(texto)) return traduzir(ROTULO_DO_PAPEL[texto]);
  return texto;
}

// ─── a leitura ──────────────────────────────────────────────────────────────

interface LinhaDoVinculo {
  target_id: string;
  link_kind: string;
  metadata: unknown;
}

interface LinhaDoContato {
  id: string;
  organization_id: string;
  name: string | null;
  display_name: string | null;
  phone_number: string | null;
  cargo: string | null;
  is_merged_into: string | null;
  is_anonymized: boolean;
}

/** Uma pessoa do negócio, já resolvida (vencedor da fusão, mesma organização). */
export interface PessoaLidaDoNegocio extends PapelDoVinculo {
  contatoId: string;
  vinculo: VinculoDaPessoaDoNegocio;
  /** A linha do contato (do vencedor, quando o vínculo aponta para uma lápide). */
  contato: Omit<LinhaDoContato, "is_merged_into">;
}

const COLUNAS_DO_CONTATO = "id, organization_id, name, display_name, phone_number, cargo, is_merged_into, is_anonymized";

/** Quantas voltas a cadeia de lápides pode dar (a mesma régua do leitor do upstream). */
const VOLTAS_DA_FUSAO = 5;

/**
 * As pessoas de UM negócio, na ordem em que entraram. Nunca lança: falha de
 * leitura devolve a lista vazia (o cartão aberto mostra o resto).
 */
export async function lerPessoasDoNegocio(
  db: Db,
  org: string,
  leadId: string,
  principalId: string | null,
): Promise<PessoaLidaDoNegocio[]> {
  try {
    const { data: links, error } = await db
      .from("crm_lead_links")
      .select("target_id, link_kind, metadata, created_at")
      .eq("organization_id", org)
      .eq("lead_id", leadId)
      .eq("target_kind", ALVO_DA_PESSOA_DO_NEGOCIO)
      .in("link_kind", [...VINCULOS_DA_PESSOA_DO_NEGOCIO])
      .order("created_at", { ascending: true });
    if (error) return [];
    const vinculos = (links ?? []) as unknown as LinhaDoVinculo[];
    if (vinculos.length === 0) return [];

    const porId = new Map<string, LinhaDoContato>();
    let procurar = [...new Set(vinculos.map((v) => v.target_id))];
    for (let volta = 0; volta <= VOLTAS_DA_FUSAO && procurar.length > 0; volta += 1) {
      const { data: contatos, error: erroDosContatos } = await db
        .from("contacts")
        .select(COLUNAS_DO_CONTATO)
        .eq("organization_id", org)
        .in("id", procurar);
      if (erroDosContatos) return [];
      const lidos = (contatos ?? []) as unknown as LinhaDoContato[];
      for (const c of lidos) porId.set(c.id, c);
      procurar = [
        ...new Set(lidos.map((c) => c.is_merged_into).filter((id): id is string => !!id && !porId.has(id))),
      ];
    }

    const pessoas: PessoaLidaDoNegocio[] = [];
    const vistos = new Set<string>();
    for (const v of vinculos) {
      let contato = porId.get(v.target_id) ?? null;
      const seguidos = new Set<string>();
      while (contato?.is_merged_into && !seguidos.has(contato.id)) {
        seguidos.add(contato.id);
        contato = porId.get(contato.is_merged_into) ?? null;
      }
      if (!contato) continue;
      // Defesa além da RLS: `target_id` não é FK, e um vínculo forjado pode
      // apontar para contato de outra organização.
      if (contato.organization_id !== org) continue;
      if (contato.id === principalId) continue;
      if (vistos.has(contato.id)) continue;
      vistos.add(contato.id);
      const { is_merged_into: _lapide, ...linha } = contato;
      pessoas.push({
        contatoId: contato.id,
        vinculo: v.link_kind === VINCULO_DO_UPSTREAM ? VINCULO_DO_UPSTREAM : VINCULO_DO_FORK,
        ...papelDoVinculo(v.link_kind, v.metadata),
        contato: linha,
      });
    }
    return pessoas;
  } catch {
    return [];
  }
}

/**
 * O contato e as lápides de fusão que apontam para ele: um vínculo gravado
 * antes da fusão continua com o id da lápide, e a leitura mostra o vencedor.
 * Quem tira a pessoa pelo vencedor tem de alcançar os dois ids.
 */
export async function alvosDoContato(db: Db, org: string, contatoId: string): Promise<string[]> {
  const { data, error } = await db
    .from("contacts")
    .select("id")
    .eq("organization_id", org)
    .eq("is_merged_into", contatoId)
    .limit(50);
  if (error) return [contatoId];
  return [contatoId, ...((data ?? []) as Array<{ id: string }>).map((c) => c.id).filter((id) => id !== contatoId)];
}

/**
 * Quem grava um tipo de vínculo tira o outro do mesmo contato no mesmo
 * negócio: cada pessoa fica com um vínculo só, e o papel que vale é o de quem
 * gravou por último. Devolve a mensagem do banco quando falha (quem chama
 * decide se é recusa ou aviso).
 */
export async function tirarOOutroVinculo(
  db: Db,
  args: { organizationId: string; leadId: string; contatoId: string; fica: VinculoDaPessoaDoNegocio },
): Promise<string | null> {
  const outro = args.fica === VINCULO_DO_FORK ? VINCULO_DO_UPSTREAM : VINCULO_DO_FORK;
  const { error } = await db
    .from("crm_lead_links")
    .delete()
    .eq("organization_id", args.organizationId)
    .eq("lead_id", args.leadId)
    .eq("target_kind", ALVO_DA_PESSOA_DO_NEGOCIO)
    .eq("target_id", args.contatoId)
    .eq("link_kind", outro);
  return error ? error.message : null;
}
