/**
 * FORK MIA (.88) — O TURNO DO ASSISTENTE DA MIA.
 *
 * É o "papel novo no engine, sem `send_message`" da spec do upstream (#2860,
 * `config-turn.ts`), na fase 1: o modelo recebe a pergunta, chama as
 * ferramentas de LEITURA (`ferramentas.ts`) e escreve a resposta. Nada aqui
 * fala com cliente final, e nada escreve no CRM.
 *
 * ── A regra inegociável: o cliente é o da SESSÃO ────────────────────────────
 *
 * Toda leitura do turno usa o cliente da sessão de quem perguntou, e a RLS e o
 * papel filtram como nas telas. O cliente de serviço é PROIBIDO aqui dentro:
 * `exigirClienteDeSessao` recusa um cliente montado com a chave de serviço (a
 * chave e a marca `X-Client-Info` do `createAdminClient`), e este arquivo não
 * importa nem o cliente de serviço nem o pool do banco. A chamada de modelo
 * chega INJETADA (`deps.chamarModelo`, de `modelo.ts`): o pool que ela usa é o
 * da telemetria e do orçamento do seam, e não lê dado nenhum do CRM.
 *
 * Quem cobra: `tests/unit/assistente-turno-usa-a-sessao.test.ts`, que tenta o
 * turno com o cliente de serviço (sabotagem) e reprova se ele passar, e reprova
 * import do cliente de serviço ou do pool neste arquivo e nas ferramentas.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModelMessage } from "ai";

import type { Role } from "@/lib/auth/types";

import { ColetorDoTurno, ferramentasDoAssistente } from "./ferramentas";
import { lerBaseDaEmpresa, type ItemDaBaseDaEmpresa } from "./leituras/ajuda";
import type { PessoaDaEquipe } from "./leituras/comum";
import type { ChamarModelo } from "./modelo";
import { montarSystemDoAssistente } from "./prompt";
import type { TelaConhecida } from "./telas";
import type { RespostaDoAssistente, TelaDaPergunta } from "./tipos";

/** Quantos passos de ferramenta cabem num turno: o teto é custo, não estilo. */
export const PASSOS_DO_TURNO = 6;
/** Quantas mensagens anteriores da conversa o modelo relê. */
export const JANELA_DO_HISTORICO = 10;

export class ClienteDeServicoNoTurnoError extends Error {
  constructor() {
    super("o turno do assistente recusou o cliente de serviço: toda leitura usa a sessão de quem perguntou");
    this.name = "ClienteDeServicoNoTurnoError";
  }
}

/**
 * O cliente é da sessão? Recusa o montado com a chave de serviço.
 *
 * Lê o que o supabase-js guarda no próprio cliente: a chave com que ele foi
 * montado e os cabeçalhos globais (o `createAdminClient` marca
 * `X-Client-Info: deskcomm-crm/admin`). É a sabotagem que o teste tenta.
 */
export function exigirClienteDeSessao(db: SupabaseClient, chaveDeServico = process.env.SUPABASE_SERVICE_ROLE_KEY): void {
  const interno = db as unknown as { supabaseKey?: string; headers?: Record<string, string> };
  const chave = typeof interno.supabaseKey === "string" ? interno.supabaseKey : null;
  if (chaveDeServico && chave === chaveDeServico) throw new ClienteDeServicoNoTurnoError();
  const marca = interno.headers?.["X-Client-Info"] ?? interno.headers?.["x-client-info"];
  if (typeof marca === "string" && marca.includes("/admin")) throw new ClienteDeServicoNoTurnoError();
}

export interface EntradaDoTurno {
  /** O cliente da SESSÃO de quem perguntou. */
  db: SupabaseClient;
  organizationId: string;
  nomeDaEmpresa: string | null;
  userId: string;
  primeiroNome: string;
  papel: Role;
  idioma: string;
  fuso: string;
  agora: Date;
  tela: TelaDaPergunta;
  telas: readonly TelaConhecida[];
  /** Quem pergunta opera a plataforma (abre as telas do dono da instalação)? */
  daPlataforma?: boolean;
  /** O endereço que a pessoa usa no navegador (`https://...`). */
  enderecoDoSistema?: string | null;
  /** O diretório da equipe (nome e papel), resolvido pela rota como em `/team/assignable`. */
  equipe: readonly PessoaDaEquipe[];
  historico: ReadonlyArray<{ tipo: string; texto: string }>;
  pergunta: string;
  ultimaRecusa: { mensagem: string | null; codigo: string | null; status: number | null } | null;
}

export interface DepsDoTurno {
  chamarModelo: ChamarModelo;
  /** Só para teste: a chave de serviço contra a qual o cliente é conferido. */
  chaveDeServico?: string;
}

const NAO_SEI =
  "Ainda não sei responder isso. Quer que eu mande a pergunta para o suporte da Time Company? A resposta chega aqui no assistente.";

function mensagensDoTurno(entrada: EntradaDoTurno): ModelMessage[] {
  const anteriores = entrada.historico
    .filter((m) => m.tipo === "pergunta" || m.tipo === "resposta" || m.tipo === "resumo_da_manha")
    .slice(-JANELA_DO_HISTORICO)
    .map((m): ModelMessage => ({ role: m.tipo === "pergunta" ? "user" : "assistant", content: m.texto }));
  return [...anteriores, { role: "user", content: entrada.pergunta }];
}

export async function responderNoAssistente(entrada: EntradaDoTurno, deps: DepsDoTurno): Promise<RespostaDoAssistente> {
  // PRIMEIRO passo, antes de qualquer leitura: sem a sessão, não há turno.
  exigirClienteDeSessao(entrada.db, deps.chaveDeServico);

  let base: ItemDaBaseDaEmpresa[] = [];
  try {
    base = await lerBaseDaEmpresa(entrada.db, entrada.organizationId);
  } catch {
    base = [];
  }

  const coletor = new ColetorDoTurno();
  const tools = ferramentasDoAssistente(
    {
      db: entrada.db,
      organizationId: entrada.organizationId,
      userId: entrada.userId,
      papel: entrada.papel,
      idioma: entrada.idioma,
      fuso: entrada.fuso,
      agora: entrada.agora,
      telas: entrada.telas,
      tela: entrada.tela,
      daPlataforma: entrada.daPlataforma ?? false,
      enderecoDoSistema: entrada.enderecoDoSistema ?? null,
      equipe: entrada.equipe,
      base,
      ultimaRecusa: entrada.ultimaRecusa,
    },
    coletor,
  );

  const system = montarSystemDoAssistente({
    primeiroNome: entrada.primeiroNome,
    papel: entrada.papel,
    idioma: entrada.idioma,
    fuso: entrada.fuso,
    agora: entrada.agora,
    tela: entrada.tela,
    telas: entrada.telas,
    base,
    nomeDaEmpresa: entrada.nomeDaEmpresa,
  });

  const { texto, callId } = await deps.chamarModelo({
    tenantId: entrada.organizationId,
    system,
    messages: mensagensDoTurno(entrada),
    tools,
    maxSteps: PASSOS_DO_TURNO,
  });

  // Resposta vazia não é resposta: vira o "não sei", com o caminho do suporte.
  let final = texto.trim();
  if (!final) {
    final = NAO_SEI;
    coletor.semResposta = true;
    coletor.acao({ tipo: "suporte", rotulo: "Mandar ao suporte", pergunta: entrada.pergunta.slice(0, 500) });
  }

  return {
    texto: final.slice(0, 8000),
    fontes: [...coletor.fontes],
    acoes: coletor.acoes,
    semResposta: coletor.semResposta,
    contatos: [...coletor.contatos],
    ferramentas: [...new Set(coletor.ferramentas)],
    llmCallId: callId,
  };
}
