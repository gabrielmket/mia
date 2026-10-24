/**
 * FORK MIA (.89) — GRAVAR a configuração do disparo: domínio, remetentes,
 * rodapé, ritmo. A tela de Configurações (administrador) e o MCP de plataforma
 * passam por aqui, com o mesmo esquema: o que uma recusa, a outra recusa.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  configuracaoDaAmazon,
  garantirIdentidade,
  lerIdentidade,
  type DependenciasDaAmazon,
} from "@/lib/email/ses";

import { lerDominio, type DominioDoEmail } from "./banco";
import {
  conferirRegistros,
  dominioVerificado,
  normalizarDominio,
  recusaDoDominio,
  registrosDoDominio,
  type RegistroDeDns,
  type ResolvedoresDeDns,
} from "./dominio";
import { DNS_DO_SISTEMA } from "./dns";
import { RecusaDaCampanha } from "./recusa";

export const configuracaoSchema = z
  .object({
    responder_para: z
      .string()
      .trim()
      .max(254)
      .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'o "responder para" tem de ser um e-mail')
      .nullable()
      .optional(),
    rodape_razao_social: z.string().trim().max(200).optional(),
    rodape_cnpj: z.string().trim().max(30).optional(),
    rodape_endereco: z.string().trim().max(300).optional(),
    rodape_motivo: z.string().trim().max(300).optional(),
    rodape_privacidade_url: z
      .string()
      .trim()
      .max(500)
      .regex(
        /^(https:\/\/[^\s]+\.[^\s]+)?$/,
        "a política de privacidade tem de ser um endereço https://",
      )
      .optional(),
    rodape_usar_privacidade_padrao: z.boolean().optional(),
    ritmo_por_hora: z.number().int().min(50).max(5000).optional(),
    janela_inicio: z.number().int().min(0).max(23).optional(),
    janela_fim: z.number().int().min(1).max(24).optional(),
    so_dias_uteis: z.boolean().optional(),
  })
  .strict();

export type PedidoDeConfiguracao = z.infer<typeof configuracaoSchema>;

/** Grava a configuração. Rodar duas vezes com os mesmos dados não muda nada. */
export async function gravarConfiguracao(
  db: SupabaseClient,
  orgId: string,
  dados: PedidoDeConfiguracao,
  autorId: string | null,
): Promise<void> {
  const { data: atual } = await db
    .from("mia_email_config")
    .select("*")
    .eq("organization_id", orgId)
    .maybeSingle();
  const a = (atual ?? {}) as Record<string, unknown>;
  const linha = {
    organization_id: orgId,
    responder_para:
      dados.responder_para !== undefined
        ? dados.responder_para || null
        : (a.responder_para ?? null),
    rodape_razao_social: dados.rodape_razao_social ?? a.rodape_razao_social ?? null,
    rodape_cnpj: dados.rodape_cnpj ?? a.rodape_cnpj ?? null,
    rodape_endereco: dados.rodape_endereco ?? a.rodape_endereco ?? null,
    rodape_motivo: dados.rodape_motivo ?? a.rodape_motivo ?? null,
    rodape_privacidade_url:
      dados.rodape_privacidade_url !== undefined
        ? dados.rodape_privacidade_url || null
        : (a.rodape_privacidade_url ?? null),
    rodape_usar_privacidade_padrao:
      dados.rodape_usar_privacidade_padrao ?? a.rodape_usar_privacidade_padrao ?? false,
    ritmo_por_hora: dados.ritmo_por_hora ?? a.ritmo_por_hora ?? 300,
    janela_inicio: dados.janela_inicio ?? a.janela_inicio ?? 8,
    janela_fim: dados.janela_fim ?? a.janela_fim ?? 19,
    so_dias_uteis: dados.so_dias_uteis ?? a.so_dias_uteis ?? true,
    updated_by: autorId,
  };
  if (Number(linha.janela_fim) <= Number(linha.janela_inicio)) {
    throw new RecusaDaCampanha("janela", "A janela termina antes de começar.");
  }
  const { error } = await db
    .from("mia_email_config")
    .upsert(linha, { onConflict: "organization_id" });
  if (error) throw new Error(`não consegui gravar a configuração: ${error.message}`);
}

export const remetenteSchema = z
  .object({
    nome: z.string().trim().min(1).max(120),
    local: z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        /^[a-z0-9]([a-z0-9._-]{0,62}[a-z0-9])?$/,
        "use só letras, números, ponto, hífen e sublinhado antes do @",
      ),
    padrao: z.boolean().optional(),
  })
  .strict();

/** Garante o remetente pela parte local: cria, atualiza ou diz que já estava. */
export async function garantirRemetente(
  db: SupabaseClient,
  orgId: string,
  dados: z.infer<typeof remetenteSchema>,
  autorId: string | null,
): Promise<{ id: string; desfecho: "criou" | "atualizou" | "ja_estava" }> {
  const { data: existentes } = await db
    .from("mia_email_remetentes")
    .select("id, nome_exibicao, local, padrao")
    .eq("organization_id", orgId)
    .is("arquivado_em", null);
  const lista = (existentes ?? []) as Array<{
    id: string;
    nome_exibicao: string;
    local: string;
    padrao: boolean;
  }>;
  const atual = lista.find((r) => r.local === dados.local);
  const viraPadrao =
    dados.padrao === true ||
    lista.length === 0 ||
    (!!atual && atual.padrao && dados.padrao !== false);
  if (viraPadrao) {
    await db
      .from("mia_email_remetentes")
      .update({ padrao: false })
      .eq("organization_id", orgId)
      .eq("padrao", true)
      .neq("local", dados.local);
  }
  if (atual) {
    if (atual.nome_exibicao === dados.nome && atual.padrao === viraPadrao)
      return { id: atual.id, desfecho: "ja_estava" };
    const { error } = await db
      .from("mia_email_remetentes")
      .update({ nome_exibicao: dados.nome, padrao: viraPadrao })
      .eq("organization_id", orgId)
      .eq("id", atual.id);
    if (error) throw new Error(`não consegui atualizar o remetente: ${error.message}`);
    return { id: atual.id, desfecho: "atualizou" };
  }
  const { data, error } = await db
    .from("mia_email_remetentes")
    .insert({
      organization_id: orgId,
      nome_exibicao: dados.nome,
      local: dados.local,
      padrao: viraPadrao,
      created_by: autorId,
    })
    .select("id")
    .single();
  if (error || !data)
    throw new Error(`não consegui criar o remetente: ${error?.message ?? "sem linha"}`);
  return { id: (data as { id: string }).id, desfecho: "criou" };
}

export async function arquivarRemetente(
  db: SupabaseClient,
  orgId: string,
  id: string,
): Promise<void> {
  const { error } = await db
    .from("mia_email_remetentes")
    .update({ arquivado_em: new Date().toISOString(), padrao: false })
    .eq("organization_id", orgId)
    .eq("id", id);
  if (error) throw new Error(`não consegui arquivar o remetente: ${error.message}`);
}

export interface DominioConferido {
  dominio: DominioDoEmail;
  registros: Array<RegistroDeDns & { ok: boolean }>;
  verificado: boolean;
  criouAgora: boolean;
}

/**
 * Cria (ou acha) a identidade do domínio na Amazon e confere os seis registros.
 * Chamada de novo, confere e diz o que falta. Um domínio pertence a uma empresa.
 */
export async function verificarDominio(
  db: SupabaseClient,
  entrada: { organizationId: string; dominio?: string | null; subdominioDeRetorno?: string | null },
  deps: { amazon?: DependenciasDaAmazon; dns?: ResolvedoresDeDns } = {},
): Promise<DominioConferido> {
  const amazon = configuracaoDaAmazon(deps.amazon?.ambiente);
  if (!amazon.configurado) {
    throw new RecusaDaCampanha(
      "amazon",
      `O envio pela Amazon ainda não foi ligado no servidor (falta ${amazon.falta.join(", ")}).`,
      409,
    );
  }
  const atual = await lerDominio(db, entrada.organizationId);
  const pedido = entrada.dominio ? normalizarDominio(entrada.dominio) : atual?.dominio;
  if (!pedido)
    throw new RecusaDaCampanha("sem_dominio", "Diga o domínio da empresa, como exemplo.com.br.");
  const recusa = recusaDoDominio(pedido);
  if (recusa) throw new RecusaDaCampanha("dominio_invalido", recusa);
  const sub = (entrada.subdominioDeRetorno ?? atual?.subdominioDeRetorno ?? "envio")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/.test(sub)) {
    throw new RecusaDaCampanha(
      "subdominio_invalido",
      "O subdomínio de retorno é uma palavra só, como envio.",
    );
  }

  // Um domínio, uma empresa.
  const { data: dono } = await db
    .from("mia_email_dominios")
    .select("organization_id")
    .eq("dominio", pedido)
    .maybeSingle();
  if (dono && (dono as { organization_id: string }).organization_id !== entrada.organizationId) {
    throw new RecusaDaCampanha(
      "dominio_de_outra_empresa",
      "Este domínio já é usado por outra empresa desta instalação.",
      409,
    );
  }

  const trocou = !!atual && atual.dominio !== pedido;
  const precisaCriar =
    !atual || trocou || atual.dkimTokens.length !== 3 || atual.subdominioDeRetorno !== sub;
  let identidade: {
    dkimTokens: string[];
    dkimStatus: string | null;
    mailFromStatus: string | null;
  } | null = null;
  let criouAgora = false;
  if (precisaCriar) {
    const r = await garantirIdentidade(pedido, sub, deps.amazon);
    if (!r.ok) throw new RecusaDaCampanha("amazon_recusou", `A Amazon recusou: ${r.detalhe}`, 502);
    identidade = r.dados;
    criouAgora = r.dados.criada;
  } else {
    const r = await lerIdentidade(pedido, deps.amazon);
    if (r.ok) identidade = r.dados;
  }
  const tokens =
    identidade?.dkimTokens.length === 3 ? identidade.dkimTokens : (atual?.dkimTokens ?? []);
  const situacao = await conferirRegistros(
    {
      dominio: pedido,
      dkimTokens: tokens,
      subdominioDeRetorno: sub,
      regiao: amazon.regiao,
      identidade,
    },
    deps.dns ?? DNS_DO_SISTEMA,
  );
  const verificado = dominioVerificado(situacao);
  const agora = new Date().toISOString();
  const linha = {
    organization_id: entrada.organizationId,
    dominio: pedido,
    subdominio_de_retorno: sub,
    regiao: amazon.regiao,
    dkim_tokens: tokens,
    registros: situacao,
    identidade_criada_em:
      criouAgora || !atual?.identidadeCriadaEm ? agora : atual.identidadeCriadaEm,
    conferido_em: agora,
    verificado_em: verificado
      ? atual?.verificadoEm && !trocou
        ? atual.verificadoEm
        : agora
      : null,
    erro_da_conferencia: null,
    // Domínio novo começa o aquecimento do zero.
    ...(trocou || !atual ? { aquecimento_degrau: 0, aquecimento_ultimo_dia: null } : {}),
  };
  const { error } = await db
    .from("mia_email_dominios")
    .upsert(linha, { onConflict: "organization_id" });
  if (error) throw new Error(`não consegui gravar o domínio: ${error.message}`);
  const salvo = await lerDominio(db, entrada.organizationId);
  const registros = registrosDoDominio({
    dominio: pedido,
    dkimTokens: tokens,
    subdominioDeRetorno: sub,
    regiao: amazon.regiao,
  }).map((r) => ({
    ...r,
    ok: situacao[r.id] === true,
  }));
  return { dominio: salvo!, registros, verificado, criouAgora };
}
