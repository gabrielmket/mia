/**
 * FORK MIA (.90) — CRIAR E AJUSTAR OS PLANOS COM O QUE É NOSSO AO LADO.
 *
 * Dois caminhos usam isto: o MCP de plataforma (`plataforma_garantir_planos`) e
 * a página dos módulos dos planos no painel (rota
 * `PUT /api/v1/admin/planos-mia/[id]`). A parte do UPSTREAM (`cobranca_planos`)
 * passa pela MESMA régua da tela dele (`novoPlanoSchema`/`edicaoDoPlanoSchema`
 * e a trava de preço do plano assinado); a nossa (`mia_plano_modulos`) tem a
 * trava no banco (9070: módulo só cresce e o preço por mensagem não muda em
 * plano assinado). Ligar um módulo num plano vale na hora para as empresas dele
 * (a pergunta ao banco é a verdade); aqui só se registra e avisa
 * (`seguirOPlano`).
 *
 * Garantir é pelo NOME: rodar de novo não duplica. Plano assinado não muda de
 * preço nem perde módulo: a resposta manda arquivar e criar outro.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { edicaoDoPlanoSchema, novoPlanoSchema } from "@/lib/schemas/cobranca-plano";

import { ehModuloDoPlano, MODULO_QUE_EXIGE_A_INSTALACAO, type ModuloDoPlano } from "./catalogo";
import { lerLadoDoPlano, lerPlanosComModulos, type PlanoComModulos } from "./leitura";
import { seguirOPlano } from "./seguir-o-plano";

export interface PlanoPedido {
  nome: string;
  preco_cents: number;
  intervalo?: "mes" | "ano";
  trial_dias?: number;
  max_assentos?: number | null;
  max_canais?: number | null;
  teto_ia_usd_cents?: number | null;
  modulos?: ModuloDoPlano[];
  preco_por_mensagem_cents?: number | null;
  frase?: string | null;
  destaque?: boolean;
  oferecido_ao_cliente?: boolean;
  padrao_no_cadastro?: boolean;
}

export interface LadoPedido {
  modulos?: ModuloDoPlano[];
  preco_por_mensagem_cents?: number | null;
  frase?: string | null;
  destaque?: boolean;
}

export interface ResultadoDosPlanos {
  ok: boolean;
  criados: string[];
  ajustados: string[];
  sem_mudanca: string[];
  avisos: string[];
  recusas: Array<{ plano: string; motivo: string }>;
  /** Empresas que ganharam módulo na hora (plano que passou a ligar módulo). */
  empresas_com_modulo_novo: number;
}

const normal = (s: string) => s.trim().toLocaleLowerCase("pt-BR");

async function assinantesDoPlano(admin: SupabaseClient, planoId: string): Promise<string[]> {
  const { data, error } = await admin
    .from("cobranca_assinaturas")
    .select("organization_id")
    .or(
      `plano_id.eq.${planoId},plano_agendado_id.eq.${planoId},plano_troca_pendente_id.eq.${planoId}`,
    );
  if (error) throw new Error(`assinantes: leitura falhou (${error.code ?? "sem_codigo"})`);
  return ((data ?? []) as Array<{ organization_id: string }>).map((l) => l.organization_id);
}

/** O que muda na linha nossa. `null` = nada. Puro. */
export function mudancasDoLado(
  atual: {
    modulos: readonly ModuloDoPlano[];
    preco_por_mensagem_cents: number | null;
    frase: string | null;
    destaque: boolean;
  } | null,
  pedido: LadoPedido,
): Record<string, unknown> | null {
  const base = atual ?? {
    modulos: [],
    preco_por_mensagem_cents: null,
    frase: null,
    destaque: false,
  };
  const campos: Record<string, unknown> = {};
  if (pedido.modulos !== undefined) {
    const novos = [...new Set(pedido.modulos)].sort();
    if (novos.join(",") !== [...base.modulos].sort().join(",")) campos.modulos = novos;
  }
  if (
    pedido.preco_por_mensagem_cents !== undefined &&
    pedido.preco_por_mensagem_cents !== base.preco_por_mensagem_cents
  ) {
    campos.preco_por_mensagem_cents = pedido.preco_por_mensagem_cents;
  }
  if (pedido.frase !== undefined && (pedido.frase ?? null) !== base.frase)
    campos.frase = pedido.frase ?? null;
  if (pedido.destaque !== undefined && pedido.destaque !== base.destaque)
    campos.destaque = pedido.destaque;
  return Object.keys(campos).length > 0 ? campos : null;
}

/** A recusa da trava de 9070 em linguagem de quem opera. */
const FRASE_DA_TRAVA =
  "Este plano tem assinantes: os módulos só crescem e o preço por mensagem não muda. Arquive o plano e crie outro.";

/**
 * Grava a linha nossa de UM plano (módulos, preço por mensagem, frase, selo).
 * Devolve `{ ok: false, motivo }` na recusa da trava; LANÇA em erro inesperado.
 */
export async function salvarLadoDoPlano(
  admin: SupabaseClient,
  planoId: string,
  pedido: LadoPedido,
  autor: { userId: string | null; tokenId?: string | null; requestId?: string | null },
): Promise<
  | { ok: true; mudou: boolean; ligou: ModuloDoPlano[]; empresas: number }
  | { ok: false; motivo: string }
> {
  const atualLido = await lerLadoDoPlano(admin, planoId);
  const atual = atualLido
    ? {
        modulos: (atualLido.modulos ?? []).filter(ehModuloDoPlano),
        preco_por_mensagem_cents:
          atualLido.preco_por_mensagem_cents === null
            ? null
            : Number(atualLido.preco_por_mensagem_cents),
        frase: atualLido.frase ?? null,
        destaque: atualLido.destaque === true,
      }
    : null;
  const campos = mudancasDoLado(atual, pedido);
  if (!campos) return { ok: true, mudou: false, ligou: [], empresas: 0 };
  const { error } = await admin
    .from("mia_plano_modulos")
    .upsert(
      { plano_id: planoId, ...(atual ?? {}), ...campos, updated_by: autor.userId },
      { onConflict: "plano_id" },
    );
  if (error) {
    if ((error.message ?? "").includes("plano_com_assinantes"))
      return { ok: false, motivo: FRASE_DA_TRAVA };
    throw new Error(`módulos do plano não gravados (${error.code ?? "sem_codigo"})`);
  }
  const ligou = ((campos.modulos as ModuloDoPlano[] | undefined) ?? []).filter(
    (m) => !(atual?.modulos ?? []).includes(m),
  );
  let empresas = 0;
  if (ligou.length > 0) {
    // Vale na hora para quem está no plano: a pergunta ao banco já responde; aqui
    // a empresa fica sabendo (registro e aviso), uma vez só.
    const { data } = await admin
      .from("cobranca_assinaturas")
      .select("organization_id")
      .eq("plano_id", planoId);
    for (const { organization_id } of (data ?? []) as Array<{ organization_id: string }>) {
      if ((await seguirOPlano(admin, organization_id, "plano_editado")).length > 0) empresas += 1;
    }
  }
  void audit({
    action: "planos_mia.planos_garantidos",
    actorUserId: autor.userId,
    actorApiTokenId: autor.tokenId ?? null,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    resourceType: "mia_plano_modulos",
    resourceId: planoId,
    requestId: autor.requestId ?? null,
    metadata: { ...campos },
  });
  return { ok: true, mudou: true, ligou, empresas };
}

/**
 * Garante uma lista de planos pelo nome (o MCP). Cada plano é decidido sozinho:
 * a recusa de um não desfaz os outros, e vem na lista `recusas` com o motivo.
 */
export async function garantirPlanos(
  admin: SupabaseClient,
  pedidos: readonly PlanoPedido[],
  autor: { userId: string; tokenId?: string | null; requestId?: string | null },
): Promise<ResultadoDosPlanos> {
  const r: ResultadoDosPlanos = {
    ok: true,
    criados: [],
    ajustados: [],
    sem_mudanca: [],
    avisos: [],
    recusas: [],
    empresas_com_modulo_novo: 0,
  };
  if (!(await moduloLigado(admin, "cobranca"))) {
    return {
      ...r,
      ok: false,
      recusas: [
        {
          plano: "*",
          motivo:
            "A cobrança está desligada nesta instalação. Ligue em Admin › Recursos opcionais › Cobrança dos seus clientes e conecte o provedor antes de criar planos.",
        },
      ],
    };
  }
  const nomes = pedidos.map((p) => normal(p.nome));
  if (new Set(nomes).size !== nomes.length) {
    return {
      ...r,
      ok: false,
      recusas: [
        { plano: "*", motivo: "Dois planos com o mesmo nome no pedido. Cada nome é um plano." },
      ],
    };
  }
  if (pedidos.filter((p) => p.padrao_no_cadastro === true).length > 1) {
    return {
      ...r,
      ok: false,
      recusas: [{ plano: "*", motivo: "Só um plano pode ser o do cadastro (padrao_no_cadastro)." }],
    };
  }
  const usaB2b = pedidos.some((p) => (p.modulos ?? []).includes(MODULO_QUE_EXIGE_A_INSTALACAO));
  if (usaB2b) {
    r.avisos.push(
      (await moduloLigado(admin, "crm_b2b"))
        ? "crm_b2b exige o módulo da instalação Vendas B2B: está ligado."
        : "crm_b2b exige o módulo da instalação Vendas B2B: está DESLIGADO. Enquanto ele não for ligado em Admin › Recursos opcionais, o plano não entrega Vendas B2B.",
    );
  }

  let existentes: PlanoComModulos[] = await lerPlanosComModulos(admin);
  // O padrão sai do anterior ANTES de entrar no novo (índice único do upstream).
  const novoPadrao = pedidos.find((p) => p.padrao_no_cadastro === true);
  if (novoPadrao) {
    const anterior = existentes.find(
      (p) =>
        p.padrao_no_cadastro &&
        p.arquivado_em === null &&
        normal(p.nome) !== normal(novoPadrao.nome),
    );
    if (anterior) {
      const { error } = await admin
        .from("cobranca_planos")
        .update({ padrao_no_cadastro: false, updated_by: autor.userId })
        .eq("id", anterior.id);
      if (error) throw new Error(`padrão anterior não desmarcado (${error.code ?? "sem_codigo"})`);
      existentes = existentes.map((p) =>
        p.id === anterior.id ? { ...p, padrao_no_cadastro: false } : p,
      );
    }
  }

  for (const p of pedidos) {
    const doUpstream = {
      nome: p.nome.trim(),
      preco_cents: p.preco_cents,
      intervalo: p.intervalo ?? "mes",
      trial_dias: p.trial_dias ?? 14,
      max_assentos: p.max_assentos ?? null,
      max_canais: p.max_canais ?? null,
      teto_ia_usd_cents: p.teto_ia_usd_cents ?? null,
      padrao_no_cadastro: p.padrao_no_cadastro ?? false,
      oferecido_ao_cliente: p.oferecido_ao_cliente ?? true,
    };
    const lado: LadoPedido = {
      modulos: p.modulos ?? [],
      preco_por_mensagem_cents: p.preco_por_mensagem_cents ?? null,
      frase: p.frase ?? null,
      destaque: p.destaque ?? false,
    };
    const existente = existentes.find(
      (x) => x.arquivado_em === null && normal(x.nome) === normal(p.nome),
    );
    try {
      if (!existente) {
        const valido = novoPlanoSchema.safeParse(doUpstream);
        if (!valido.success) {
          r.recusas.push({
            plano: p.nome,
            motivo: valido.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
          });
          continue;
        }
        const { data, error } = await admin
          .from("cobranca_planos")
          .insert({ ...valido.data, updated_by: autor.userId })
          .select("id")
          .single();
        if (error || !data) {
          r.recusas.push({
            plano: p.nome,
            motivo:
              error?.code === "23505"
                ? "Já existe outro plano do cadastro."
                : "O plano não foi gravado.",
          });
          continue;
        }
        await salvarLadoDoPlano(admin, (data as { id: string }).id, lado, autor);
        r.criados.push(p.nome);
        continue;
      }
      const assinantes = await assinantesDoPlano(admin, existente.id);
      const mudaPreco =
        doUpstream.preco_cents !== existente.preco_cents ||
        doUpstream.intervalo !== existente.intervalo;
      if (mudaPreco && assinantes.length > 0) {
        r.recusas.push({
          plano: p.nome,
          motivo: `Este plano tem ${assinantes.length} assinante(s): o preço e o intervalo não mudam mais. Arquive-o e crie outro com outro nome.`,
        });
        continue;
      }
      const edicao: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(doUpstream)) {
        if ((existente as unknown as Record<string, unknown>)[k] !== v) edicao[k] = v;
      }
      let mudou = false;
      if (Object.keys(edicao).length > 0) {
        const valido = edicaoDoPlanoSchema.safeParse(edicao);
        if (!valido.success) {
          r.recusas.push({
            plano: p.nome,
            motivo: valido.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
          });
          continue;
        }
        const { error } = await admin
          .from("cobranca_planos")
          .update({
            ...valido.data,
            updated_at: new Date().toISOString(),
            updated_by: autor.userId,
          })
          .eq("id", existente.id);
        if (error) {
          r.recusas.push({
            plano: p.nome,
            motivo:
              error.code === "23505"
                ? "Já existe outro plano do cadastro."
                : "O plano não foi gravado.",
          });
          continue;
        }
        mudou = true;
      }
      const ladoGravado = await salvarLadoDoPlano(admin, existente.id, lado, autor);
      if (!ladoGravado.ok) {
        r.recusas.push({ plano: p.nome, motivo: ladoGravado.motivo });
        if (mudou) r.ajustados.push(p.nome);
        continue;
      }
      r.empresas_com_modulo_novo += ladoGravado.empresas;
      if (mudou || ladoGravado.mudou) r.ajustados.push(p.nome);
      else r.sem_mudanca.push(p.nome);
    } catch (e) {
      r.recusas.push({
        plano: p.nome,
        motivo: e instanceof Error ? e.message : "falha ao gravar o plano",
      });
    }
  }
  r.ok = r.recusas.length === 0;
  return r;
}

/**
 * Os pacotes de crédito à venda: os valores pedidos ficam ativos (na ordem), e
 * os que não vieram deixam de ser oferecidos. Compra já feita não muda.
 */
export async function garantirPacotesDeCreditos(
  admin: SupabaseClient,
  valoresCents: readonly number[],
  autor: { userId: string; tokenId?: string | null; requestId?: string | null },
): Promise<{ ativos: number[]; desativados: number[] }> {
  const pedidos = [...new Set(valoresCents)];
  const { data, error } = await admin
    .from("mia_pacotes_de_creditos")
    .select("id, valor_cents, ativo, ordem");
  if (error) throw new Error(`pacotes: leitura falhou (${error.code ?? "sem_codigo"})`);
  const linhas = (data ?? []) as Array<{
    id: string;
    valor_cents: number | string;
    ativo: boolean;
    ordem: number;
  }>;
  const desativados: number[] = [];
  for (const l of linhas) {
    if (l.ativo && !pedidos.includes(Number(l.valor_cents))) {
      const { error: e } = await admin
        .from("mia_pacotes_de_creditos")
        .update({ ativo: false, updated_by: autor.userId })
        .eq("id", l.id);
      if (e) throw new Error(`pacote não desativado (${e.code ?? "sem_codigo"})`);
      desativados.push(Number(l.valor_cents));
    }
  }
  for (const [ordem, valor] of pedidos.entries()) {
    const ativo = linhas.find((l) => l.ativo && Number(l.valor_cents) === valor);
    if (ativo) {
      if (ativo.ordem !== ordem)
        await admin
          .from("mia_pacotes_de_creditos")
          .update({ ordem, updated_by: autor.userId })
          .eq("id", ativo.id);
      continue;
    }
    const { error: e } = await admin
      .from("mia_pacotes_de_creditos")
      .insert({ valor_cents: valor, ativo: true, ordem, updated_by: autor.userId });
    if (e) throw new Error(`pacote não gravado (${e.code ?? "sem_codigo"})`);
  }
  void audit({
    action: "planos_mia.pacotes_garantidos",
    actorUserId: autor.userId,
    actorApiTokenId: autor.tokenId ?? null,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    resourceType: "mia_pacotes_de_creditos",
    requestId: autor.requestId ?? null,
    metadata: { ativos: pedidos, desativados },
  });
  return { ativos: pedidos, desativados };
}
