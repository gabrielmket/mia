/**
 * FORK MIA — os MODELOS APROVADOS da Meta ao alcance da implantação (upstream
 * 1.100: o lembrete da agenda por modelo, 9092; o aviso à equipe por modelo,
 * 9094 e 9099).
 *
 * O MCP só ESCOLHE entre os modelos que já estão aprovados no número. Criar e
 * submeter modelo à Meta é outra ferramenta (`plataforma_submeter_modelo_oficial`)
 * e fica fora daqui.
 *
 * ── As réguas são as do upstream, chamadas, não copiadas ───────────────────
 *
 *   que modelo o número tem   `modelosDaConexao` (a linha do número e, no
 *                             número oficial direto, a linha sem número da conta
 *                             dele), a mesma que a tela do aviso usa
 *   aprovado                  `isStatusSendable`
 *   serve ao lembrete         `modeloServeAoLembrete` e o número dono da linha
 *                             (`lerModeloDoLembrete`, o que o cron confere)
 *   serve ao aviso à equipe   `avaliarModeloDoAviso` (uma variável só, no corpo)
 *
 * ── Por que o aviso à equipe é só LEITURA aqui ─────────────────────────────
 *
 * O modelo do aviso mora em `config_aviso_de_caso.modelo_id` e a única porta que
 * o grava é `fn_definir_aviso_de_caso`, que confere `auth.uid()` (uma pessoa
 * logada, administradora) e a verificação em duas etapas provada na sessão
 * (`PUT /api/v1/ai/cases/alerta`). Um token de plataforma não tem sessão, e
 * gravar a coluna pelo cliente de serviço seria pular a porta da tela. É o mesmo
 * motivo dos prazos da agenda (`lib/implantacao/agenda.ts`). O MCP mostra quais
 * modelos servem e qual está escolhido; a escolha é de uma pessoa na tela.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { modeloServeAoLembrete, variaveisQueOLembretePreenche, type ModeloDoLembrete } from "@/lib/agenda/lembrete-por-modelo";
import { nomeDoCanal } from "@/lib/channels/estado";
import { modelosDaConexao } from "@/lib/channels/linha-do-espelho";
import { isStatusSendable } from "@/lib/channels/meta/template-binding";
import { deriveTemplateContract } from "@/lib/channels/meta/template-contract";
import { avaliarModeloDoAviso } from "@/lib/escalacao/modelo-do-aviso";
import { Recusa } from "@/lib/mcp-plataforma/recusa";

import { chaveDoNome } from "./base";
import { lerCanais, type CanalDaEmpresa } from "./canal";

/** Onde a pessoa escolhe o modelo do aviso à equipe. */
export const TELA_DO_AVISO_DA_EQUIPE = "Aviso no WhatsApp (/app/ai/cases/avisos)";

const COLUNAS = "id, name, language, status, category, channel_session_id, parameter_format, components";

/** Uma linha de `meta_templates`, no que esta leitura usa. */
interface LinhaDoModelo extends ModeloDoLembrete {
  category: string | null;
}

export interface VariavelDoModelo {
  /** `corpo`, `cabecalho`, `botao` ou `carrossel`. */
  onde: string;
  /** A chave da variável: `"1"`, `"2"`… no posicional, o nome no nomeado. */
  chave: string;
  /** O que ela espera: texto, imagem, sufixo de link, código de cupom. */
  espera: string;
}

export interface ModeloAprovado {
  id: string;
  nome: string;
  idioma: string;
  categoria: string | null;
  variaveis: VariavelDoModelo[];
  serve_ao_lembrete: boolean;
  /** Presente só quando não serve: a frase do porquê. */
  por_que_nao_serve_ao_lembrete?: string;
  serve_ao_aviso_da_equipe: boolean;
}

export interface ModelosDoNumero {
  numero: { id: string; nome: string; telefone: string | null };
  modelos: ModeloAprovado[];
}

const ONDE: Record<string, string> = { body: "corpo", header: "cabecalho", button: "botao", card: "carrossel" };

function variaveisDe(linha: LinhaDoModelo): VariavelDoModelo[] {
  const contrato = deriveTemplateContract({
    name: linha.name,
    language: linha.language,
    ...(linha.parameter_format ? { parameter_format: linha.parameter_format } : {}),
    components: (Array.isArray(linha.components) ? linha.components : []) as never,
  });
  return contrato.slots.map((s) => ({ onde: ONDE[s.address.kind] ?? s.address.kind, chave: s.key, espera: s.expects }));
}

/**
 * Por que este modelo não serve ao lembrete DESTE número, ou `null` quando serve.
 * A régua é a do cron (`lerModeloDoLembrete`): a linha precisa ser do número que
 * envia, e não da conta oficial sem número; aprovada; e com as variáveis que o
 * lembrete sabe preencher.
 */
function porQueNaoServeAoLembrete(linha: LinhaDoModelo, canalId: string): string | null {
  if (!isStatusSendable(linha.status)) return `ainda não está aprovado (situação ${linha.status})`;
  if (linha.channel_session_id === null) {
    return "é da conta oficial e não está ligado a um número; o lembrete só sai por modelo gravado no número que envia (a tela também não o oferece)";
  }
  if (linha.channel_session_id !== canalId) return "é de outro número";
  if (variaveisQueOLembretePreenche(linha) === null) {
    return "o lembrete só preenche variáveis de texto no corpo, de {{1}} a {{4}}, sem pular número ({{1}} primeiro nome, {{2}} dia e hora, {{3}} título, {{4}} endereço)";
  }
  return modeloServeAoLembrete(linha) ? null : "não serve ao lembrete";
}

/** Os modelos de UM número, como `modelosDaConexao` os acha (falha vira erro, não lista vazia). */
async function linhasDoNumero(admin: SupabaseClient, orgId: string, canalId: string): Promise<LinhaDoModelo[]> {
  const { data, error } = await modelosDaConexao<LinhaDoModelo>(admin, COLUNAS, { organizationId: orgId, channelSessionId: canalId });
  if (error) throw new Error(`não consegui ler os modelos do número: ${error.message}`);
  return data;
}

/** Os modelos APROVADOS de cada número da empresa. Número sem modelo aprovado não entra. */
export async function lerModelosAprovados(
  admin: SupabaseClient,
  orgId: string,
  canais?: CanalDaEmpresa[],
): Promise<ModelosDoNumero[]> {
  const lista = canais ?? (await lerCanais(admin, orgId));
  const saida: ModelosDoNumero[] = [];
  for (const canal of lista) {
    const aprovados = (await linhasDoNumero(admin, orgId, canal.id)).filter((l) => isStatusSendable(l.status));
    if (aprovados.length === 0) continue;
    saida.push({
      numero: { id: canal.id, nome: nomeDoCanal(canal), telefone: canal.phone_number },
      modelos: aprovados.map((l) => {
        const motivo = porQueNaoServeAoLembrete(l, canal.id);
        return {
          id: l.id,
          nome: l.name,
          idioma: l.language,
          categoria: l.category ?? null,
          variaveis: variaveisDe(l),
          serve_ao_lembrete: motivo === null,
          ...(motivo === null ? {} : { por_que_nao_serve_ao_lembrete: motivo }),
          serve_ao_aviso_da_equipe: avaliarModeloDoAviso(l).ok,
        };
      }),
    });
  }
  return saida;
}

/** O modelo escolhido para o aviso à equipe (`config_aviso_de_caso`), só leitura. */
export async function lerModeloDoAvisoDaEquipe(
  admin: SupabaseClient,
  orgId: string,
): Promise<{
  numero_id: string | null;
  modelo: { id: string; nome: string; idioma: string } | null;
  modelo_serve: boolean | null;
  onde_escolher: string;
}> {
  const { data, error } = await admin
    .from("config_aviso_de_caso")
    .select("channel_session_id, modelo_id")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) throw new Error(`não consegui ler o aviso à equipe: ${error.message}`);
  const linha = (data ?? null) as { channel_session_id: string | null; modelo_id: string | null } | null;
  const base = { numero_id: linha?.channel_session_id ?? null, onde_escolher: TELA_DO_AVISO_DA_EQUIPE };
  if (!linha?.modelo_id) return { ...base, modelo: null, modelo_serve: null };

  const { data: m, error: erroDoModelo } = await admin
    .from("meta_templates")
    .select(COLUNAS)
    .eq("organization_id", orgId)
    .eq("id", linha.modelo_id)
    .maybeSingle();
  if (erroDoModelo) throw new Error(`não consegui ler o modelo do aviso à equipe: ${erroDoModelo.message}`);
  const modelo = (m ?? null) as LinhaDoModelo | null;
  if (!modelo) return { ...base, modelo: null, modelo_serve: false };
  // A régua do envio é a da CONEXÃO (`carregarModeloDoAviso`): a definição que
  // vale é a que o número enxerga, e não só a linha apontada.
  const doNumero = linha.channel_session_id
    ? (await linhasDoNumero(admin, orgId, linha.channel_session_id)).find((l) => l.name === modelo.name && l.language === modelo.language)
    : undefined;
  return {
    ...base,
    modelo: { id: modelo.id, nome: modelo.name, idioma: modelo.language },
    modelo_serve: doNumero ? avaliarModeloDoAviso(doNumero).ok : false,
  };
}

/** O modelo do lembrete de um tipo, para a leitura da seção `agenda`. */
export async function lerModelosPorId(
  admin: SupabaseClient,
  orgId: string,
  ids: string[],
): Promise<Map<string, LinhaDoModelo>> {
  const mapa = new Map<string, LinhaDoModelo>();
  if (ids.length === 0) return mapa;
  const { data, error } = await admin.from("meta_templates").select(COLUNAS).eq("organization_id", orgId).in("id", ids);
  if (error) throw new Error(`não consegui ler os modelos do lembrete: ${error.message}`);
  for (const l of (data ?? []) as LinhaDoModelo[]) mapa.set(l.id, l);
  return mapa;
}

/** A leitura do modelo do lembrete de um tipo: o que está gravado e se ainda serve. */
export function modeloDoLembreteLido(
  modelos: Map<string, LinhaDoModelo>,
  modeloId: string | null | undefined,
  canalId: string | null | undefined,
): { id: string; nome: string | null; idioma: string | null; serve: boolean; por_que_nao_serve?: string } | null {
  if (!modeloId) return null;
  const linha = modelos.get(modeloId);
  if (!linha) return { id: modeloId, nome: null, idioma: null, serve: false, por_que_nao_serve: "o modelo não existe mais nesta empresa" };
  const motivo = porQueNaoServeAoLembrete(linha, canalId ?? linha.channel_session_id ?? "");
  return {
    id: linha.id,
    nome: linha.name,
    idioma: linha.language,
    serve: motivo === null,
    ...(motivo === null ? {} : { por_que_nao_serve: motivo }),
  };
}

/**
 * O modelo do lembrete pedido (id ou nome), conferido ANTES de gravar.
 *
 * `canalId` é o número que manda o lembrete: o pedido no mesmo chamado, o já
 * gravado no tipo ou, com um número só, ele. `null` quando o tipo fica no
 * automático numa empresa de 2 ou mais números: aí o modelo não tem com quem ser
 * conferido, e quem chama avisa.
 *
 * A rota da tela não recusa o modelo ainda não aprovado (o cron confere na hora
 * de mandar). O MCP recusa: ele só escolhe entre os aprovados.
 */
export async function modeloDoLembretePedido(
  admin: SupabaseClient,
  orgId: string,
  canais: CanalDaEmpresa[],
  referencia: string,
  canalId: string | null,
): Promise<{ id: string; numeroDoModelo: string | null }> {
  const { data, error } = await admin.from("meta_templates").select(COLUNAS).eq("organization_id", orgId);
  if (error) throw new Error(`não consegui ler os modelos da empresa: ${error.message}`);
  const todos = (data ?? []) as LinhaDoModelo[];
  const ref = referencia.trim();
  const porId = todos.filter((m) => m.id === ref);
  let candidatos = porId.length > 0 ? porId : todos.filter((m) => chaveDoNome(m.name) === chaveDoNome(ref));

  const nomeDoNumero = (id: string | null) => {
    const canal = id ? canais.find((x) => x.id === id) : undefined;
    return canal ? `«${nomeDoCanal(canal)}»` : id ? `de id ${id}` : "nenhum (conta oficial)";
  };
  const comoAchar = "Os aprovados de cada número estão em plataforma_ver_configuracao, seção modelos_aprovados. O MCP não cria nem submete modelo.";

  if (candidatos.length === 0) throw new Recusa(`Não achei o modelo «${ref}» nesta empresa. ${comoAchar}`);
  if (candidatos.length > 1 && canalId) {
    const doNumero = candidatos.filter((m) => m.channel_session_id === canalId);
    if (doNumero.length > 0) candidatos = doNumero;
  }
  if (candidatos.length > 1) {
    const aprovados = candidatos.filter((m) => isStatusSendable(m.status));
    if (aprovados.length > 0) candidatos = aprovados;
  }
  if (candidatos.length > 1) {
    throw new Recusa(
      `Mais de um modelo se chama «${ref}». Informe o id: ${candidatos
        .map((m) => `${m.id} (idioma ${m.language}, número ${nomeDoNumero(m.channel_session_id)})`)
        .join("; ")}.`,
    );
  }
  const modelo = candidatos[0]!;
  const nome = `O modelo «${modelo.name}» (${modelo.language})`;

  if (!isStatusSendable(modelo.status)) {
    throw new Recusa(`${nome} está com a situação ${modelo.status} na Meta, e o lembrete só usa modelo APROVADO. ${comoAchar}`);
  }
  if (modelo.channel_session_id === null) {
    throw new Recusa(
      `${nome} é da conta oficial e não está ligado a um número: o lembrete só sai por modelo gravado no número que envia, e a tela também não o oferece. ${comoAchar}`,
    );
  }
  if (canalId && modelo.channel_session_id !== canalId) {
    throw new Recusa(
      `${nome} é do número ${nomeDoNumero(modelo.channel_session_id)}, e o lembrete deste tipo sai pelo número ${nomeDoNumero(canalId)}. ` +
        "O modelo só sai pelo número dono dele: escolha um modelo do número que envia os lembretes, ou troque `canal_do_lembrete` no mesmo pedido.",
    );
  }
  if (variaveisQueOLembretePreenche(modelo) === null) {
    throw new Recusa(
      `${nome} não serve para o lembrete: ele só pode ter variáveis de texto no corpo, de {{1}} a {{4}}, sem pular número ` +
        "({{1}} primeiro nome, {{2}} dia e hora, {{3}} título, {{4}} endereço).",
    );
  }
  return { id: modelo.id, numeroDoModelo: modelo.channel_session_id };
}
