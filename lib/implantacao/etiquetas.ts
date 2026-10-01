/**
 * FORK MIA — GARANTIR o vocabulário de etiquetas de um cliente, com as cores.
 *
 * ── Por que não é a função da tela ────────────────────────────────────────
 *
 * A tela de Etiquetas grava por `fn_vocabulario_de_tags_operar`, e o portão
 * dela é o papel de quem está LOGADO (`fn_role_at_least(p_org, 'manager')`, que
 * lê `auth.uid()`). O MCP de plataforma chega com `service_role`: não há
 * usuário logado, a função responde `insufficient_role`, e fazê-la passar
 * exigiria fingir uma sessão de alguém da empresa do cliente.
 *
 * O que a implantação precisa é só o ramo `definir_cor` daquela função: pôr a
 * etiqueta no vocabulário curado (`organizations.settings.tags`) com a cor. Ele
 * não toca em contato, negócio, conversa nem regra de agente. Então a escrita
 * daqui grava a MESMA chave, na MESMA forma que a função grava
 * (`{"tag": "...", "cor": "#rrggbb", "descricao": "..."}`), com a mesma régua
 * de nome (`tagSchema`) e de cor (`corDeEtiquetaSchema`, a que a rota usa).
 *
 * Renomear, juntar e excluir etiqueta NÃO estão aqui: mexem em todos os
 * contatos, negócios e conversas que carregam o nome, são operação e não
 * montagem, e continuam na tela, com o portão dela.
 *
 * ── Sem pisar em quem grava no mesmo jsonb ────────────────────────────────
 *
 * `settings` tem vários donos. A gravação vai por `mudarSettingsDaOrganizacao`
 * (comparar-e-trocar): a mescla é refeita se alguém gravou no meio.
 */
import { audit } from "@/lib/audit";
import { Recusa } from "@/lib/mcp-plataforma/recusa";
import { corDeEtiquetaSchema, tagSchema } from "@/lib/schemas/tags";
import { chaveDaEtiqueta, normalizarCorDeEtiqueta } from "@/lib/tags/cor-da-etiqueta";

import { mudarSettingsDaOrganizacao, type Desfecho, type Implantacao } from "./base";

/** Quantas etiquetas uma chamada aceita. */
export const TETO_DE_ETIQUETAS = 50;

export interface EtiquetaPedida {
  nome: string;
  /** `#rrggbb`. `null` tira a cor. Ausente não mexe na cor que existe. */
  cor?: string | null;
  descricao?: string | null;
}

export interface EtiquetaGarantida {
  nome: string;
  cor: string | null;
  desfecho: Desfecho;
}

type Entrada = { tag: string; cor?: string; descricao?: string } & Record<string, unknown>;

/** A lista como a função do banco a lê: entrada pode ser texto puro ou objeto. */
function comoObjetos(lista: unknown): Entrada[] {
  if (!Array.isArray(lista)) return [];
  const entradas: Entrada[] = [];
  for (const item of lista) {
    if (typeof item === "string" && item.trim() !== "") entradas.push({ tag: item.trim() });
    else if (item && typeof item === "object" && typeof (item as { tag?: unknown }).tag === "string") {
      const objeto = item as Entrada;
      if (objeto.tag.trim() !== "") entradas.push({ ...objeto, tag: objeto.tag.trim() });
    }
  }
  return entradas;
}

export async function garantirEtiquetas(c: Implantacao, pedidas: EtiquetaPedida[]): Promise<EtiquetaGarantida[]> {
  // A conferência vem antes de ler o banco: nome e cor na régua da tela.
  const conferidas = pedidas.map((p, i) => {
    const nome = tagSchema.safeParse(p.nome);
    if (!nome.success) {
      throw new Recusa(`etiquetas[${i}].nome precisa de 1 a 60 caracteres (ex.: "Plano anual").`);
    }
    let cor: string | null | undefined = undefined;
    if (p.cor === null) cor = null;
    else if (p.cor !== undefined) {
      const lida = corDeEtiquetaSchema.safeParse(p.cor);
      if (!lida.success) {
        throw new Recusa(
          `etiquetas[${i}].cor não é uma cor válida ("${p.cor}"). Use o formato #rrggbb (ex.: "#12a594"). ` +
            "A paleta recomendada está em plataforma_listar_modelos, seção etiquetas.",
        );
      }
      cor = lida.data;
    }
    return { nome: nome.data, cor, descricao: p.descricao };
  });

  const chaves = new Set<string>();
  for (const p of conferidas) {
    const chave = chaveDaEtiqueta(p.nome);
    if (chaves.has(chave)) {
      throw new Recusa(`A etiqueta «${p.nome}» aparece duas vezes na lista. Maiúsculas e minúsculas não mudam a etiqueta.`);
    }
    chaves.add(chave);
  }

  let desfechos: EtiquetaGarantida[] = [];
  const { mudou } = await mudarSettingsDaOrganizacao(c.admin, c.orgId, (settings) => {
    const lista = comoObjetos(settings.tags);
    desfechos = [];
    let alterou = false;

    for (const p of conferidas) {
      const i = lista.findIndex((e) => chaveDaEtiqueta(e.tag) === chaveDaEtiqueta(p.nome));
      if (i < 0) {
        const nova: Entrada = { tag: p.nome };
        if (p.cor) nova.cor = p.cor;
        if (p.descricao) nova.descricao = p.descricao;
        lista.push(nova);
        alterou = true;
        desfechos.push({ nome: p.nome, cor: p.cor ?? null, desfecho: "criou" });
        continue;
      }
      const atual = lista[i]!;
      const corAtual = normalizarCorDeEtiqueta(atual.cor);
      const nova: Entrada = { ...atual };
      let mudouEsta = false;
      if (p.cor !== undefined && (p.cor ?? null) !== corAtual) {
        if (p.cor === null) delete nova.cor;
        else nova.cor = p.cor;
        mudouEsta = true;
      }
      if (p.descricao !== undefined && (p.descricao ?? null) !== ((atual.descricao as string | undefined) ?? null)) {
        if (!p.descricao) delete nova.descricao;
        else nova.descricao = p.descricao;
        mudouEsta = true;
      }
      if (mudouEsta) {
        lista[i] = nova;
        alterou = true;
      }
      desfechos.push({
        nome: atual.tag,
        cor: normalizarCorDeEtiqueta(nova.cor),
        desfecho: mudouEsta ? "atualizou" : "ja_estava",
      });
    }

    return alterou ? { ...settings, tags: lista } : null;
  });

  if (mudou) {
    void audit({
      action: "tag_vocabulary.changed",
      actorUserId: c.autorUserId,
      organizationId: c.orgId,
      resourceType: "organization",
      resourceId: c.orgId,
      requestId: c.requestId,
      metadata: {
        acao: "garantir",
        via: "mcp_plataforma",
        criadas: desfechos.filter((d) => d.desfecho === "criou").map((d) => d.nome),
        atualizadas: desfechos.filter((d) => d.desfecho === "atualizou").map((d) => d.nome),
      },
    });
  }
  return desfechos;
}
