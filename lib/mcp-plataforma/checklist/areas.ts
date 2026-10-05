/**
 * AS ÁREAS DO CHECKLIST DA IMPLANTAÇÃO.
 *
 * ── Para acrescentar uma área ─────────────────────────────────────────────
 *
 * Escreva um objeto `AreaDoChecklist` (aqui ou num arquivo ao lado) e ponha-o
 * em `AREAS_DO_CHECKLIST`, no fim deste arquivo. A ordem da lista é a ordem em
 * que o checklist aparece, e é a ordem recomendada da implantação.
 *
 * ── O que uma área NÃO faz ────────────────────────────────────────────────
 *
 * Não escreve nada e não chama nada de fora: o checklist é leitura, roda no
 * começo e no fim de toda implantação, e por isso não exige operação nenhuma
 * do token. Uma área que falha (uma tabela que não existe num banco antigo)
 * não derruba as outras: quem monta o checklist a marca como "não medida".
 */
import { capacidadesOferecidas, pacotesLigados } from "@/lib/implantacao/capacidades";
import { lerAgentes, lerVersoes, pendenciasDePublicacao } from "@/lib/implantacao/agente";
import { lerRegras } from "@/lib/implantacao/automacoes";
import { lerTipos } from "@/lib/implantacao/agenda";
import { lerConvites, lerMembros } from "@/lib/implantacao/equipe";
import { lerFluxos } from "@/lib/implantacao/followup";
import { lerDocumentoDaMemoria } from "@/lib/implantacao/memoria";
import { lerModelosOficiais, lerRespostasProntas, temCanalOficialProprio } from "@/lib/implantacao/mensagens";
import { lerIntencoes, lerRoteadores } from "@/lib/implantacao/roteador";
import { escolherVersoesDaTela } from "@/lib/ai/agents/versoes-da-tela";
import { estadoDoAgente } from "@/lib/ai/agents/no-ar";
import { temChaveDeEmbedding } from "@/lib/ai/embeddings/chave";
import { modeloDaPlataforma } from "@/lib/ai/modelo-da-plataforma";
import { empresaExigeMfa, politicaDaEmpresa } from "@/lib/auth/politica-mfa";
import { DEFAULT_VISIBILITY_MODE } from "@/lib/auth/types";
import { nomeDoCanal } from "@/lib/channels/estado";
import { STATUS_SAUDAVEL } from "@/lib/channels/health";
import { listSelectableChannels } from "@/lib/channels/selectable";
import { lerModoDeVenda } from "@/lib/empresas/modo-de-venda";
import { lerAmbiente, nomeAindaEhPlaceholder } from "@/lib/instalacao/ambiente";
import { ROTULO_DO_PASSO } from "@/lib/leads/agent-mapping";
import { configAssinatura } from "@/lib/messaging/assinatura";
import { MODULOS } from "@/lib/modulos/vendaveis";
import { routingConfigSchema } from "@/lib/schemas/routing";

import { contarNoBanco } from "../contar";

import { conversoes } from "./area-das-conversoes";
import { migracao } from "./area-da-migracao";
import { obrigacoes } from "./area-das-obrigacoes";
import type { AreaDoChecklist, ResultadoDaArea } from "./tipos";

function vazio(): ResultadoDaArea {
  return { pronto: [], falta: [], so_pela_tela: [] };
}

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

// ---------------------------------------------------------------------------

const empresa: AreaDoChecklist = {
  chave: "empresa",
  titulo: "Dados da empresa",
  avaliar: async (_ctx, org) => {
    const r = vazio();
    const modo = lerModoDeVenda(org.settings);
    r.dados = {
      nome: org.display_name,
      razao_social: org.legal_name,
      cnpj: org.cnpj,
      fuso: org.timezone,
      idioma: org.locale,
      moeda: org.currency ?? "BRL",
      modo_de_venda: modo,
      situacao: org.status,
      demonstracao: org.demonstracao,
    };
    if (nomeAindaEhPlaceholder(org)) {
      r.falta.push({
        o_que: "A empresa ainda tem o nome de instalação nova.",
        como: "plataforma_configurar_empresa com `nome` e `razao_social`.",
      });
    } else {
      r.pronto.push(`Nome: ${org.display_name}.`);
    }
    r.pronto.push(`Fuso ${org.timezone}, moeda ${org.currency ?? "BRL"}, venda ${modo === "b2b" ? "para empresas (B2B)" : "para pessoas (B2C)"}.`);
    if (!org.cnpj) {
      r.falta.push({ o_que: "Sem CNPJ cadastrado (opcional).", como: "plataforma_configurar_empresa com `cnpj`." });
    }
    if (org.demonstracao) {
      r.pronto.push("É a empresa de DEMONSTRAÇÃO: nada do que for configurado aqui manda mensagem, e-mail ou aviso para fora.");
    }
    return r;
  },
};

const modulos: AreaDoChecklist = {
  chave: "modulos",
  titulo: "Módulos liberados",
  avaliar: async ({ admin }, org) => {
    const r = vazio();
    const { data, error } = await admin
      .from("organization_modules")
      .select("modulo")
      .eq("organization_id", org.id)
      .is("revoked_at", null);
    if (error) throw new Error(error.message);
    const liberados = ((data ?? []) as Array<{ modulo: string }>).map((m) => m.modulo);
    r.dados = { liberados, existentes: MODULOS.map((m) => m.chave) };
    if (liberados.length > 0) r.pronto.push(`Liberados: ${liberados.join(", ")}.`);
    else {
      r.falta.push({
        o_que: "Nenhum módulo vendido está liberado (só importa se o cliente contratou algum).",
        como: "plataforma_listar_modulos para ver as chaves, e plataforma_liberar_modulo.",
      });
    }
    return r;
  },
};

const canais: AreaDoChecklist = {
  chave: "canais",
  titulo: "Números de WhatsApp",
  avaliar: async ({ admin }, org) => {
    const r = vazio();
    const { data, error } = await admin
      .from("channel_sessions")
      .select("id, display_name, phone_number, status, archived_at")
      .eq("organization_id", org.id)
      .is("archived_at", null);
    if (error) throw new Error(error.message);
    const sessoes = (data ?? []) as Array<{ id: string; display_name: string | null; phone_number: string | null; status: string | null }>;
    const conectados = sessoes.filter((s) => s.status === STATUS_SAUDAVEL);
    r.dados = {
      numeros: sessoes.map((s) => ({ id: s.id, nome: nomeDoCanal(s), telefone: s.phone_number, conectado: s.status === STATUS_SAUDAVEL, situacao: s.status })),
    };
    if (conectados.length > 0) {
      r.pronto.push(`${plural(conectados.length, "número conectado", "números conectados")}: ${conectados.map((s) => nomeDoCanal(s)).join(", ")}.`);
    }
    const fora = sessoes.filter((s) => s.status !== STATUS_SAUDAVEL);
    r.so_pela_tela.push({
      o_que:
        conectados.length > 0
          ? "Conectar o número de WhatsApp."
          : fora.length > 0
            ? `Reconectar o número de WhatsApp (${fora.map((s) => nomeDoCanal(s)).join(", ")} está fora do ar).`
            : "Conectar o número de WhatsApp do cliente, por QR Code ou pela conta oficial.",
      situacao: conectados.length > 0 ? "feito" : "pendente",
      tela: "Conexões",
      caminho: "/app/connections",
      quem: "cliente",
      por_que: "É acesso do cliente: o QR Code é lido no celular dele, e a conta oficial pede o login dele na Meta. Sem número conectado nenhum agente é publicado.",
    });
    return r;
  },
};

const funis: AreaDoChecklist = {
  chave: "funis",
  titulo: "Funis, etapas e campos",
  avaliar: async ({ admin }, org) => {
    const r = vazio();
    const { data: linhas, error } = await admin
      .from("crm_pipelines")
      .select("id, name, slug, is_default, is_archived, settings")
      .eq("organization_id", org.id)
      .order("position", { ascending: true });
    if (error) throw new Error(error.message);
    const vivos = ((linhas ?? []) as Array<{ id: string; name: string; slug: string; is_default: boolean; is_archived: boolean; settings: Record<string, unknown> | null }>).filter(
      (f) => !f.is_archived,
    );
    const { data: etapasBrutas, error: etapasErr } = await admin
      .from("crm_stages")
      .select("id, pipeline_id, name, slug, is_won, is_lost, is_archived, agent_stage_hint")
      .eq("organization_id", org.id);
    if (etapasErr) throw new Error(etapasErr.message);
    const etapas = ((etapasBrutas ?? []) as Array<{ pipeline_id: string; name: string; slug: string; is_won: boolean; is_lost: boolean; is_archived: boolean; agent_stage_hint: string | null }>).filter(
      (e) => !e.is_archived,
    );

    r.dados = {
      funis: vivos.map((f) => {
        const doFunil = etapas.filter((e) => e.pipeline_id === f.id);
        return {
          id: f.id,
          nome: f.name,
          padrao: f.is_default,
          etapas: doFunil.length,
          etapas_com_passo_do_agente: doFunil.filter((e) => e.agent_stage_hint).length,
          campos: Array.isArray(f.settings?.fields) ? (f.settings.fields as unknown[]).length : 0,
          motivos_de_perda: Array.isArray(f.settings?.lost_reasons) ? (f.settings.lost_reasons as unknown[]).length : 0,
        };
      }),
    };

    if (vivos.length === 0) {
      r.falta.push({ o_que: "A organização não tem funil.", como: "plataforma_garantir_funil." });
      return r;
    }
    for (const f of vivos) {
      const doFunil = etapas.filter((e) => e.pipeline_id === f.id);
      // O funil que o gatilho de seed entrega a toda organização nova é o de
      // e-commerce: "Pedidos", com "Carrinho abandonado".
      const semeado = f.slug === "pedidos" && doFunil.some((e) => e.slug === "carrinho_abandonado");
      if (semeado) {
        r.falta.push({
          o_que: `O funil «${f.name}» ainda é o de e-commerce que nasce com a organização (Carrinho abandonado, Aguardando pagamento...).`,
          como: "plataforma_garantir_funil com o nome e as etapas do cliente e `adotar_funil_padrao: true`. Modelos por segmento em plataforma_listar_modelos, seção funis.",
        });
        continue;
      }
      const semPasso = ["new", "contacted", "qualifying", "qualified", "negotiating"].filter(
        (p) => !doFunil.some((e) => e.agent_stage_hint === p),
      );
      if (!doFunil.some((e) => e.is_won) || !doFunil.some((e) => e.is_lost)) {
        r.falta.push({
          o_que: `O funil «${f.name}» não tem etapa de ganho ou de perda: negócio nenhum consegue ser fechado nele.`,
          como: 'plataforma_garantir_funil com uma etapa `passo: "won"` e uma `passo: "lost"`.',
        });
      } else if (doFunil.every((e) => !e.agent_stage_hint)) {
        r.falta.push({
          o_que: `No funil «${f.name}» nenhuma etapa diz ao agente quando mover o negócio: ele conversa e o cartão fica parado.`,
          como: "plataforma_garantir_funil informando `passo` em cada etapa.",
        });
      } else {
        r.pronto.push(
          `Funil «${f.name}»${f.is_default ? " (padrão)" : ""}: ${plural(doFunil.length, "etapa", "etapas")}` +
            (semPasso.length > 0
              ? `; sem etapa para os passos ${semPasso.map((p) => `«${ROTULO_DO_PASSO[p as keyof typeof ROTULO_DO_PASSO]}»`).join(", ")}.`
              : ", com todos os passos do agente mapeados."),
        );
      }
    }
    return r;
  },
};

const produtos: AreaDoChecklist = {
  chave: "produtos",
  titulo: "Catálogo de produtos e serviços",
  avaliar: async ({ admin }, org) => {
    const r = vazio();
    // CONTADO no banco, e não trazido: o `.limit(5000)` que estava aqui devolvia
    // no máximo 1000 produtos (o teto do PostgREST), e um catálogo de 3.000
    // aparecia no checklist como "1.000 produtos". "Sem descrição" é o ativo com
    // a descrição nula OU vazia, por isso são duas contagens somadas.
    const doCatalogo = () =>
      admin.from("catalog_products").select("id", { count: "exact", head: true }).eq("organization_id", org.id);
    const [total, ativos, semDescricaoNula, semDescricaoVazia] = await Promise.all([
      contarNoBanco(doCatalogo(), "os produtos"),
      contarNoBanco(doCatalogo().eq("ativo", true), "os produtos ativos"),
      contarNoBanco(doCatalogo().eq("ativo", true).is("descricao", null), "os produtos sem descrição"),
      contarNoBanco(doCatalogo().eq("ativo", true).eq("descricao", ""), "os produtos sem descrição"),
    ]);
    const semDescricao = semDescricaoNula + semDescricaoVazia;
    r.dados = { total, ativos, sem_descricao: semDescricao };
    if (total === 0) {
      r.falta.push({
        o_que: "Catálogo vazio (só importa se a empresa vende itens com preço: sem catálogo o agente não informa preço).",
        como: "plataforma_garantir_produtos, em lotes de até 200.",
      });
    } else {
      r.pronto.push(`${plural(total, "produto", "produtos")} no catálogo, ${ativos} ativo(s).`);
      if (semDescricao > 0) {
        r.falta.push({
          o_que: `${plural(semDescricao, "produto ativo sem descrição", "produtos ativos sem descrição")}: o agente só tem o nome e o preço para responder.`,
          como: "plataforma_garantir_produtos com `descricao` nos itens.",
        });
      }
    }
    return r;
  },
};

const etiquetas: AreaDoChecklist = {
  chave: "etiquetas",
  titulo: "Etiquetas",
  avaliar: async (_ctx, org) => {
    const r = vazio();
    const lista = Array.isArray(org.settings.tags) ? (org.settings.tags as unknown[]) : [];
    const comCor = lista.filter((e) => e && typeof e === "object" && typeof (e as { cor?: unknown }).cor === "string").length;
    r.dados = { no_vocabulario: lista.length, com_cor: comCor };
    if (lista.length === 0) {
      r.falta.push({ o_que: "Nenhuma etiqueta no vocabulário da empresa.", como: "plataforma_garantir_etiquetas." });
    } else {
      r.pronto.push(`${plural(lista.length, "etiqueta", "etiquetas")} no vocabulário, ${comCor} com cor.`);
    }
    r.so_pela_tela.push({
      o_que: "Renomear, juntar ou excluir uma etiqueta que já está em contatos e negócios.",
      situacao: "opcional",
      tela: "Configurações › Etiquetas",
      caminho: "/app/settings/tags",
      quem: "cliente",
      por_que: "Mexe em todos os contatos, negócios e conversas que carregam o nome: é operação, não montagem.",
    });
    return r;
  },
};

const memoria: AreaDoChecklist = {
  chave: "memoria",
  titulo: "Memória da empresa",
  avaliar: async ({ admin }, org) => {
    const r = vazio();
    const documento = await lerDocumentoDaMemoria({ admin, orgId: org.id });
    const { data, error } = await admin
      .from("org_memory_entries")
      .select("id")
      .eq("organization_id", org.id)
      .eq("status", "active");
    if (error) throw new Error(error.message);
    const anotacoes = (data ?? []).length;
    r.dados = { documento: documento ? { versao: documento.versao, caracteres: documento.conteudo.length } : null, anotacoes };
    if (documento) r.pronto.push(`Regras da casa publicadas (versão ${documento.versao}, ${documento.conteudo.length} caracteres).`);
    else {
      r.falta.push({
        o_que: "A empresa não tem as regras da casa escritas: o que TODOS os agentes seguem (política de preço, o que não prometer, tom).",
        como: "plataforma_gravar_memoria com `documento`.",
      });
    }
    if (anotacoes > 0) r.pronto.push(`${plural(anotacoes, "anotação ativa", "anotações ativas")}.`);
    return r;
  },
};

const conhecimento: AreaDoChecklist = {
  chave: "conhecimento",
  titulo: "Conhecimento do agente",
  avaliar: async ({ admin }, org) => {
    const r = vazio();
    const { data, error } = await admin
      .from("ai_knowledge_sources")
      .select("id, name, source_type, is_active, last_index_status, chunks_count")
      .eq("organization_id", org.id)
      .eq("is_active", true);
    if (error) throw new Error(error.message);
    const materiais = (data ?? []) as Array<{ id: string; name: string; source_type: string; last_index_status: string | null; chunks_count: number | null }>;
    const indexados = materiais.filter((m) => (m.chunks_count ?? 0) > 0).length;
    const temChave = await temChaveDeEmbedding(org.id).catch(() => false);
    r.dados = {
      materiais: materiais.map((m) => ({ id: m.id, nome: m.name, tipo: m.source_type, indexacao: m.last_index_status, trechos: m.chunks_count ?? 0 })),
      indexacao_habilitada: temChave,
    };
    if (materiais.length === 0) {
      r.falta.push({
        o_que: "Nenhum material de conhecimento: o agente só sabe o que está no prompt, na memória e no catálogo.",
        como: "plataforma_garantir_conhecimento (perguntas e respostas, ou um texto).",
      });
    } else {
      r.pronto.push(`${plural(materiais.length, "material", "materiais")}, ${indexados} já indexado(s).`);
    }
    if (!temChave) {
      r.so_pela_tela.push({
        o_que: "Configurar a chave que INDEXA o conhecimento (sem ela o material é gravado e o agente não o acha na busca).",
        situacao: materiais.length > 0 ? "pendente" : "opcional",
        tela: "Admin › IA",
        caminho: "/admin",
        quem: "plataforma",
        por_que: "Chave de provedor de IA é da plataforma, não do cliente, e não entra por ferramenta.",
      });
    }
    r.so_pela_tela.push({
      o_que: "Enviar arquivo (PDF, planilha) ou apontar um site como material.",
      situacao: "opcional",
      tela: "IA › Conhecimento",
      caminho: "/app/ai/knowledge/sources",
      quem: "cliente",
      por_que: "Upload de arquivo não cabe numa chamada de ferramenta: por aqui entra o que é texto.",
    });
    return r;
  },
};

const agentes: AreaDoChecklist = {
  chave: "agentes",
  titulo: "Agentes de IA",
  avaliar: async ({ admin }, org) => {
    const r = vazio();
    const todos = (await lerAgentes(admin, org.id)).filter((a) => !a.archived_at);
    const numeros = await listSelectableChannels(admin, org.id);
    const oferecidas = await capacidadesOferecidas(admin, org.id);
    const retrato: Array<Record<string, unknown>> = [];
    const publicadosPorNumero = new Map<string, string[]>();

    for (const agente of todos) {
      const versoes = await lerVersoes(admin, org.id, agente.id);
      const tela = escolherVersoesDaTela(versoes, agente.published_version_id);
      const estado = estadoDoAgente(agente);
      const pendencias = tela.draft ? await pendenciasDePublicacao(admin, org.id, tela.draft, numeros) : [];
      const noAr = estado === "no_ar" && tela.published;
      if (noAr && typeof tela.published?.channel_session_id === "string") {
        const numero = tela.published.channel_session_id;
        publicadosPorNumero.set(numero, [...(publicadosPorNumero.get(numero) ?? []), agente.name]);
      }
      const base = tela.base;
      retrato.push({
        id: agente.id,
        nome: agente.name,
        situacao: estado === "no_ar" ? "no ar" : agente.paused_at ? "pausado" : "rascunho",
        versao_publicada: tela.published?.version_number ?? null,
        rascunho_pendente: tela.draft?.version_number ?? null,
        pacotes: base ? pacotesLigados(oferecidas, (base.tool_ids as string[] | null) ?? []) : [],
        funis_autorizados: base ? ((base.pipeline_ids as string[] | null) ?? []).length : 0,
        materiais: base ? ((base.knowledge_source_ids as string[] | null) ?? []).length : 0,
        falta_para_publicar: pendencias.map((p) => p.codigo),
      });

      if (estado === "no_ar") {
        r.pronto.push(`Agente «${agente.name}» no ar (versão ${tela.published?.version_number ?? "?"}).`);
        if (tela.draft) {
          r.falta.push({
            o_que: `O agente «${agente.name}» tem um rascunho mais novo (versão ${tela.draft.version_number}) que ainda não foi publicado.`,
            como: "plataforma_publicar_agente.",
          });
        }
      } else if (agente.paused_at) {
        r.falta.push({ o_que: `O agente «${agente.name}» está PAUSADO.`, como: "plataforma_pausar_agente com `pausar: false`." });
      } else {
        const doHumano = pendencias.filter((p) => p.quem_resolve !== "agente_implantador");
        if (pendencias.length === 0) {
          r.falta.push({ o_que: `O agente «${agente.name}» está pronto e ainda não foi publicado.`, como: "plataforma_publicar_agente." });
        }
        for (const p of pendencias.filter((x) => x.quem_resolve === "agente_implantador")) {
          r.falta.push({ o_que: `Agente «${agente.name}»: ${p.o_que}`, como: p.como });
        }
        for (const p of doHumano) {
          r.so_pela_tela.push({
            o_que: `Agente «${agente.name}» não pode ir ao ar: ${p.o_que}`,
            situacao: "pendente",
            tela: p.quem_resolve === "plataforma" ? "Admin › IA" : "Conexões",
            caminho: p.quem_resolve === "plataforma" ? "/admin" : "/app/connections",
            quem: p.quem_resolve === "plataforma" ? "plataforma" : "cliente",
            por_que: p.como,
          });
        }
      }
      if (base && ((base.pipeline_ids as string[] | null) ?? []).length === 0) {
        r.falta.push({
          o_que: `O agente «${agente.name}» não está autorizado em funil nenhum: ele não cria nem move negócio.`,
          como: "plataforma_garantir_agente com `funis`.",
        });
      }
    }

    r.dados = { agentes: retrato };
    if (todos.length === 0) {
      r.falta.push({ o_que: "A organização não tem agente de IA.", como: "plataforma_garantir_agente (o agente nasce como rascunho)." });
    }
    // O roteador de intenção tem ferramenta desde a .73 (upstream 1.73: cada
    // intenção pode levar o negócio para o funil de destino). Deixou de ser
    // item "só pela tela": montar é com o agente, e ligar também.
    //
    // A leitura que falha NÃO derruba a área: é dela que sai `pode_atender`, e
    // um banco que ainda não recebeu a 0542 (o destino de funil da intenção)
    // não pode fazer o checklist dizer que ninguém está no ar.
    let roteadores: Awaited<ReturnType<typeof lerRoteadores>> = [];
    let intencoes: Awaited<ReturnType<typeof lerIntencoes>> = [];
    try {
      roteadores = await lerRoteadores(admin, org.id);
      intencoes = roteadores.length > 0 ? await lerIntencoes(admin, org.id) : [];
    } catch (err) {
      r.dados = { agentes: retrato, roteadores_nao_medidos: err instanceof Error ? err.message : "erro desconhecido" };
      return r;
    }
    r.dados = {
      agentes: retrato,
      roteadores: roteadores.map((x) => ({
        id: x.id,
        nome: x.name,
        ligado: x.is_active,
        numero_id: x.channel_session_id,
        intencoes: intencoes.filter((i) => i.router_id === x.id).length,
        intencoes_com_destino_de_funil: intencoes.filter((i) => i.router_id === x.id && i.pipeline_id).length,
      })),
    };
    for (const x of roteadores) {
      const quantas = intencoes.filter((i) => i.router_id === x.id).length;
      if (x.is_active) r.pronto.push(`Roteador «${x.name}» ligado, com ${plural(quantas, "intenção", "intenções")}.`);
      else if (quantas === 0) {
        r.falta.push({ o_que: `O roteador «${x.name}» não tem intenção nenhuma.`, como: "plataforma_garantir_roteador com `intencoes`." });
      } else {
        r.falta.push({ o_que: `O roteador «${x.name}» está montado e desligado: ele ainda não decide nada.`, como: "plataforma_ligar_roteador." });
      }
    }
    for (const [numero, nomes] of publicadosPorNumero) {
      if (nomes.length < 2) continue;
      if (roteadores.some((x) => x.channel_session_id === numero)) continue;
      r.falta.push({
        o_que: `${nomes.map((n) => `«${n}»`).join(" e ")} estão publicados no mesmo número e não há roteador: só responde o de maior prioridade.`,
        como: "plataforma_garantir_roteador (uma intenção por agente) e depois plataforma_ligar_roteador.",
      });
    }
    if (roteadores.length > 0) {
      r.so_pela_tela.push({
        o_que: "Amarrar um roteiro de atendimento a uma intenção do roteador, e testar a classificação com uma mensagem de exemplo.",
        situacao: "opcional",
        tela: "IA › Roteadores",
        caminho: "/app/ai/routers",
        quem: "cliente",
        por_que: "Roteiro de atendimento é outra superfície, sem ferramenta de montagem, e o teste chama o classificador com a mensagem digitada na tela.",
      });
    }
    return r;
  },
};

const followups: AreaDoChecklist = {
  chave: "followups",
  titulo: "Follow-ups",
  avaliar: async ({ admin }, org) => {
    const r = vazio();
    const fluxos = await lerFluxos(admin, org.id);
    const { data: versoes, error } = await admin
      .from("ai_agent_versions")
      .select("id, followup")
      .eq("organization_id", org.id)
      .eq("status", "published");
    if (error) throw new Error(error.message);
    const armados = new Set(
      ((versoes ?? []) as Array<{ followup: { enabled?: boolean; flow_pointer_ids?: string[] } | null }>).flatMap((v) =>
        v.followup?.enabled ? (v.followup.flow_pointer_ids ?? []) : [],
      ),
    );
    const publicados = fluxos.filter((f) => f.status === "active");
    const rascunhos = fluxos.filter((f) => f.status !== "active");
    r.dados = {
      fluxos: fluxos.map((f) => ({
        id: f.id,
        nome: f.name,
        situacao: f.status === "active" ? "publicado" : f.status === "disabled" ? "desligado" : "rascunho",
        gatilho: f.trigger_config?.kind ?? "manual",
        armado_em_agente_publicado: armados.has(f.id),
      })),
    };
    if (fluxos.length === 0) {
      r.falta.push({
        o_que: "Nenhum follow-up instalado: quem para de responder não é procurado de novo.",
        como: "plataforma_listar_modelos (seção followup) e plataforma_garantir_followup com o `modelo`.",
      });
      return r;
    }
    if (publicados.length > 0) r.pronto.push(`${plural(publicados.length, "follow-up publicado", "follow-ups publicados")}.`);
    for (const f of rascunhos) {
      r.falta.push({ o_que: `O follow-up «${f.name}» está em rascunho: não manda mensagem.`, como: "plataforma_publicar_followup." });
    }
    for (const f of publicados) {
      const kind = f.trigger_config?.kind ?? "manual";
      if (kind !== "manual" && kind !== "webhook" && !armados.has(f.id)) {
        r.falta.push({
          o_que: `O follow-up «${f.name}» está publicado, mas nenhum agente publicado o tem armado: ele não inscreve ninguém.`,
          como: "plataforma_garantir_agente com `followups` e plataforma_publicar_agente.",
        });
      }
    }
    return r;
  },
};

const automacoes: AreaDoChecklist = {
  chave: "automacoes",
  titulo: "Automações",
  avaliar: async ({ admin }, org) => {
    const r = vazio();
    const regras = await lerRegras(admin, org.id);
    const ligadas = regras.filter((x) => x.is_active);
    r.dados = { regras: regras.map((x) => ({ id: x.id, nome: x.name, gatilho: x.trigger_event, ligada: x.is_active })) };
    if (regras.length === 0) {
      r.pronto.push("Nenhuma automação (opcional).");
      return r;
    }
    r.pronto.push(`${plural(regras.length, "regra", "regras")}, ${ligadas.length} ligada(s).`);
    for (const x of regras.filter((y) => !y.is_active)) {
      r.falta.push({ o_que: `A automação «${x.name}» está desligada.`, como: "plataforma_ligar_automacao." });
    }
    const temWebhook = regras.some(
      (x) => Array.isArray(x.actions) && x.actions.some((a) => (a as { type?: string }).type === "call_webhook"),
    );
    if (temWebhook) {
      r.so_pela_tela.push({
        o_que: "Pôr o segredo do webhook, se o sistema de destino exigir assinatura.",
        situacao: "opcional",
        tela: "Automações",
        caminho: "/app/webhooks",
        quem: "cliente",
        por_que: "Segredo é credencial: não entra por ferramenta.",
      });
    }
    return r;
  },
};

const agenda: AreaDoChecklist = {
  chave: "agenda",
  titulo: "Agenda",
  avaliar: async ({ admin }, org) => {
    const r = vazio();
    const tipos = await lerTipos(admin, org.id);
    const ativos = tipos.filter((t) => t.is_active !== false);
    const { data: jornadas, error } = await admin
      .from("attendant_availability")
      .select("user_id, is_available, schedule")
      .eq("organization_id", org.id);
    if (error) throw new Error(error.message);
    const comJornada = ((jornadas ?? []) as Array<{ schedule: { windows?: unknown[] } | null }>).filter(
      (j) => Array.isArray(j.schedule?.windows) && (j.schedule?.windows?.length ?? 0) > 0,
    ).length;
    const { data: contas } = await admin
      .from("calendar_connections")
      .select("id, status")
      .eq("organization_id", org.id);
    const contasVivas = ((contas ?? []) as Array<{ status: string }>).filter((x) => x.status === "connected").length;

    r.dados = {
      tipos: ativos.map((t) => ({ id: t.id, nome: t.name, slug: t.slug, duracao_minutos: t.duration_minutes, lembrete_ligado: t.reminder_enabled === true })),
      pessoas_com_jornada: comJornada,
      contas_de_agenda_conectadas: contasVivas,
    };
    if (ativos.length > 0) r.pronto.push(`${plural(ativos.length, "tipo de agendamento ativo", "tipos de agendamento ativos")}.`);
    else r.falta.push({ o_que: "Nenhum tipo de agendamento ativo: ninguém marca horário.", como: "plataforma_garantir_tipos_de_agendamento." });
    if (comJornada > 0) r.pronto.push(`${plural(comJornada, "pessoa com jornada publicada", "pessoas com jornada publicada")}.`);
    else {
      r.falta.push({
        o_que: "Ninguém da equipe tem jornada publicada: a agenda não oferece horário (só importa se o cliente agenda).",
        como: "plataforma_definir_jornada, depois de a pessoa aceitar o convite.",
      });
    }
    r.so_pela_tela.push(
      {
        o_que: "Conectar a agenda do Google ou do Outlook de quem atende.",
        situacao: contasVivas > 0 ? "feito" : "opcional",
        tela: "Agenda",
        caminho: "/app/agenda",
        quem: "cliente",
        por_que: "É a conta pessoal de cada pessoa: o login é dela.",
      },
      {
        o_que: "Ajustar os prazos da agenda (confirmação, proteção e validade do pedido).",
        situacao: "opcional",
        tela: "Configurações › Agenda",
        caminho: "/app/settings/tenant/agenda",
        quem: "cliente",
        por_que: "A gravação exige uma pessoa logada com a verificação em duas etapas. Os padrões valem enquanto ninguém mexer.",
      },
    );
    return r;
  },
};

const equipe: AreaDoChecklist = {
  chave: "equipe",
  titulo: "Equipe",
  avaliar: async ({ admin }, org) => {
    const r = vazio();
    const membros = (await lerMembros(admin, org.id)).filter((m) => m.ativo);
    const convites = await lerConvites(admin, org.id);
    const pendentes = convites.filter((x) => x.situacao === "pendente");
    const semEmail = pendentes.filter((x) => !x.email_enviado);
    r.dados = {
      membros: membros.map((m) => ({ user_id: m.user_id, email: m.email, papel: m.papel })),
      convites_pendentes: pendentes.map((x) => ({ email: x.email, papel: x.papel, email_enviado: x.email_enviado, expira_em: x.expira_em })),
    };
    r.pronto.push(`${plural(membros.length, "pessoa na equipe", "pessoas na equipe")}.`);
    if (pendentes.length > 0) r.pronto.push(`${plural(pendentes.length, "convite pendente", "convites pendentes")}.`);
    if (membros.length <= 1 && pendentes.length === 0) {
      r.falta.push({
        o_que: "Só quem criou a organização está na equipe: ninguém do cliente tem acesso.",
        como: "plataforma_convidar_pessoas (manda e-mail de convite).",
      });
    }
    if (semEmail.length > 0) {
      r.so_pela_tela.push({
        o_que: `Entregar o link do convite de ${semEmail.map((x) => x.email).join(", ")}: o e-mail não saiu.`,
        situacao: "pendente",
        tela: "Equipe",
        caminho: "/app/team",
        quem: "plataforma",
        por_que: "A instalação não conseguiu mandar o e-mail. O link do convite fica copiável na tela de Equipe.",
      });
    }
    // Upstream 1.70 (#2163 e #2167): a verificação em duas etapas pode ser
    // exigida a partir de um papel, com carência. É regra de ACESSO, e a própria
    // tela pede o código do segundo fator de quem a muda: um token não tem como.
    const mfa = politicaDaEmpresa(org.settings);
    const exige = empresaExigeMfa(org.settings) || (mfa.papelMinimo !== null && mfa.papelMinimo !== "none");
    r.dados = {
      ...r.dados,
      verificacao_em_duas_etapas: {
        exigida: exige,
        a_partir_do_papel: exige ? (mfa.papelMinimo ?? "admin") : null,
        dias_de_carencia: mfa.diasDeCarencia,
      },
    };
    r.so_pela_tela.push({
      o_que: "Exigir a verificação em duas etapas da equipe: a partir de qual papel, e com quantos dias de carência.",
      situacao: exige ? "feito" : "opcional",
      tela: "Configurações › Segurança",
      caminho: "/app/settings/security",
      quem: "cliente",
      por_que:
        "É regra de acesso da empresa: a tela pede o código do segundo fator de quem muda a regra, e um token não apresenta segundo fator. Exigir sem carência tranca para fora quem ainda não cadastrou o aplicativo.",
    });
    return r;
  },
};

const atendimento: AreaDoChecklist = {
  chave: "atendimento",
  titulo: "Distribuição do atendimento e passagem para humano",
  avaliar: async (_ctx, org) => {
    const r = vazio();
    const routing = routingConfigSchema.catch(routingConfigSchema.parse({})).parse(org.settings.routing ?? {});
    const visibilidade = (org.settings.visibility_mode as string | undefined) ?? DEFAULT_VISIBILITY_MODE;
    const grupo = org.settings.grupo_de_avisos as { nome?: string } | undefined;
    // Upstream 1.70: o modo por menor carga (#1711), a espera da IA depois de uma
    // resposta pelo celular (#2005) e a assinatura de quem fala (#2079).
    const assinatura = configAssinatura(org.settings);
    r.dados = {
      modo: routing.mode,
      visibilidade,
      devolver_para_a_ia_apos_minutos: routing.handoff_return_after_minutes,
      conversa_fica_com_quem_atendeu: routing.conversation_stays_with_attendant,
      ia_espera_apos_resposta_pelo_celular_minutos: routing.manual_reply_silence_minutes,
      assinatura: { atendentes: assinatura.humanos, ia: assinatura.ia, nome_da_ia: assinatura.nomeIa },
      grupo_de_avisos: grupo?.nome ?? null,
    };
    const ROTULO_DO_MODO: Record<string, string> = { manual: "manual", round_robin: "em rodízio", load: "por menor carga" };
    r.pronto.push(
      `Distribuição ${ROTULO_DO_MODO[routing.mode] ?? routing.mode}; atendente enxerga ${
        visibilidade === "all" ? "tudo" : visibilidade === "own" ? "só o que é dele" : "o que é dele e o que não tem dono"
      }.`,
    );
    if (assinatura.humanos || assinatura.ia) {
      r.pronto.push(
        `As mensagens mostram quem fala: ${[assinatura.humanos ? "atendentes" : null, assinatura.ia ? `IA («${assinatura.nomeIa}»)` : null]
          .filter(Boolean)
          .join(" e ")}.`,
      );
    }
    r.so_pela_tela.push(
      {
        o_que: "Escolher o grupo de WhatsApp que recebe os avisos de passagem para humano.",
        situacao: grupo ? "feito" : "opcional",
        tela: "Admin › Número de avisos",
        caminho: "/admin",
        quem: "plataforma",
        por_que: "O grupo é escolhido da lista de grupos em que o número de avisos já está. Um id errado manda nome e resumo de lead para o lugar errado.",
      },
      {
        o_que: "Definir quais atendentes recebem as conversas de cada número.",
        situacao: "opcional",
        tela: "Configurações › Atendimento",
        caminho: "/app/settings/atendimento",
        quem: "cliente",
        por_que: "Depende do número conectado e de a equipe já ter aceitado o convite.",
      },
    );
    return r;
  },
};

const mensagens: AreaDoChecklist = {
  chave: "mensagens",
  titulo: "Respostas prontas e modelos de mensagem",
  avaliar: async ({ admin }, org) => {
    const r = vazio();
    const respostas = await lerRespostasProntas(admin, org.id);
    const oficial = await temCanalOficialProprio(admin, org.id);
    const modelos = oficial ? await lerModelosOficiais(admin, org.id) : [];
    r.dados = {
      respostas_prontas: respostas.length,
      canal_oficial: oficial,
      modelos_oficiais: modelos.map((m) => ({ nome: m.name, idioma: m.language, situacao: m.status })),
    };
    if (respostas.length > 0) r.pronto.push(`${plural(respostas.length, "resposta pronta", "respostas prontas")} da empresa.`);
    else r.falta.push({ o_que: "Nenhuma resposta pronta para a equipe (opcional).", como: "plataforma_garantir_respostas_prontas." });
    if (oficial) {
      const aprovados = modelos.filter((m) => m.status === "APPROVED").length;
      r.pronto.push(`Número oficial conectado: ${plural(modelos.length, "modelo", "modelos")} na Meta, ${aprovados} aprovado(s).`);
      if (modelos.length === 0) {
        r.falta.push({
          o_que: "Número oficial sem modelo de mensagem: fora da janela de 24 horas o sistema não consegue falar com o cliente.",
          como: "plataforma_submeter_modelo_whatsapp.",
        });
      }
      r.so_pela_tela.push({
        o_que: "Criar modelo oficial com cabeçalho de imagem, vídeo ou documento.",
        situacao: "opcional",
        tela: "Configurações › Modelos",
        caminho: "/app/settings/templates",
        quem: "cliente",
        por_que: "A amostra de mídia é enviada por upload.",
      });
    } else {
      r.pronto.push("Sem número oficial conectado: modelo de mensagem da Meta não se aplica.");
    }
    return r;
  },
};

// A área de conversões mora num arquivo próprio (docs/fork/conversoes-da-meta.md).

const plataforma: AreaDoChecklist = {
  chave: "plataforma",
  titulo: "O que depende da plataforma",
  avaliar: async ({ admin }) => {
    const r = vazio();
    const ambiente = lerAmbiente();
    const modelo = await modeloDaPlataforma(admin);
    const provedores = Object.entries(ambiente.chavesDeProvedor)
      .filter(([, tem]) => tem)
      .map(([id]) => id);
    // O `.env` é o piso; a configuração gravada pela tela mora no banco. Só o
    // servidor de saída é lido aqui, nunca a senha.
    const { data: smtp } = await admin.from("platform_smtp_settings").select("smtp_host").eq("id", 1).maybeSingle();
    const emailConfigurado =
      ambiente.email || Boolean((smtp as { smtp_host?: string | null } | null)?.smtp_host?.trim());
    r.dados = {
      modelo_padrao: modelo ? `${modelo.provider}/${modelo.modelId}` : null,
      provedores_com_chave: provedores,
      email_configurado: emailConfigurado,
    };
    r.so_pela_tela.push(
      {
        o_que: "Chave do provedor de IA e modelo padrão dos agentes.",
        situacao: provedores.length > 0 || ambiente.gateway ? "feito" : "pendente",
        tela: "Admin › IA",
        caminho: "/admin",
        quem: "plataforma",
        por_que: "A IA dos agentes é da plataforma: provedor, modelo e chave não são escolha do cliente e não entram por ferramenta.",
      },
      {
        o_que: "Envio de e-mail da instalação (convites, avisos).",
        situacao: emailConfigurado ? "feito" : "opcional",
        tela: "Admin › E-mail",
        caminho: "/admin",
        quem: "plataforma",
        por_que: "Servidor e senha de e-mail são credenciais. Sem e-mail o convite nasce, e o link é copiado na tela de Equipe.",
      },
    );
    return r;
  },
};

/**
 * A LISTA. A ordem é a do checklist e a da implantação.
 *
 * Área nova entra aqui, numa linha.
 */
export const AREAS_DO_CHECKLIST: readonly AreaDoChecklist[] = [
  empresa,
  modulos,
  canais,
  funis,
  produtos,
  etiquetas,
  memoria,
  conhecimento,
  agentes,
  followups,
  automacoes,
  agenda,
  equipe,
  atendimento,
  mensagens,
  // a base trazida de outro CRM: opcional, nunca conta como pendência
  migracao,
  // documentos e obrigações com vencimento: opcional, nunca conta como pendência
  obrigacoes,
  conversoes,
  plataforma,
];
