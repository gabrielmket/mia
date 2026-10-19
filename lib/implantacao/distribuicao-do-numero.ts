/**
 * FORK MIA (.83) — AS REGRAS DE ATENDIMENTO DE UM NÚMERO pelo MCP de plataforma
 * (upstream v1.85, migration 0663, #2331).
 *
 * ── O que o upstream trouxe ───────────────────────────────────────────────
 *
 * Em Configurações › Atendimento, cada número ganhou, na MESMA gravação dos
 * responsáveis (quem pode receber aquele número pelo rodízio, 0228):
 *
 *   modo         "manual" (cada um pega), "round_robin" (rodízio) ou "load"
 *                (menor carga). Nulo = o número não tem modo próprio e segue o
 *                da organização (plataforma_configurar_atendimento).
 *   destino      o atendente que recebe DIRETO todo cliente novo daquele
 *                número, antes de qualquer distribuição (mesmo fora da jornada;
 *                só espera quando estiver indisponível ou sem folga de
 *                capacidade). Na tela, só existe com modo próprio.
 *
 * Número sem regra própria (sem linha em `channel_routing_policies`) usa todos
 * os atendentes elegíveis e o modo da organização: nada muda para quem não
 * mexe. Uma regra criada com a lista de responsáveis VAZIA deixa as conversas
 * daquele número na fila (o destino padrão, se houver, ainda recebe).
 *
 * ── O caminho da tela que isto espelha ────────────────────────────────────
 *
 * `PATCH /api/v1/settings/routing/channels` → `fn_set_channel_routing` (0663),
 * e a auditoria `routing.config_changed`. A função do upstream exige uma SESSÃO
 * de gerente membro com MFA: o token de plataforma não é membro, e por isso a
 * gravação vai pela cópia do fork, `fn_mia_distribuicao_do_numero_pela_plataforma`
 * (migration 9045), com o mesmo corpo e o token como ator (o molde da 9022).
 * A rota e a função do upstream estão na cerca
 * `tests/unit/mcp-de-implantacao-espelhos.test.ts`.
 *
 * ── O que é diferente da tela, e por quê ──────────────────────────────────
 *
 * 1. Só o que VEIO muda: o resto da regra gravada fica. A tela grava os três
 *    campos juntos porque tem o formulário inteiro na mão; aqui o que não veio
 *    é lido do banco e regravado igual.
 * 2. Criar a regra de um número que ainda não tem uma pede `responsaveis` por
 *    extenso. Na tela, salvar sem marcar ninguém cria a regra "ninguém recebe"
 *    sem aviso, e as conversas do número passam a esperar na fila: aqui essa
 *    escolha tem de ser escrita (`[]`).
 * 3. As pessoas chegam pelo e-mail, e quem só lê (viewer) é recusado com a
 *    frase que diz por quê: a régua da função recusa sem dizer quem.
 * 4. O destino padrão sem modo próprio é recusado (a tela desliga o campo); e
 *    tirar o modo próprio (`modo: null`) tira o destino junto, como a tela faz,
 *    com aviso.
 *
 * Nada aqui manda mensagem a ninguém: a regra decide de quem a conversa é, e a
 * entrega pelo rodízio não cala o agente de IA (a atribuição com motivo
 * `routing` mantém o silêncio da IA como estava). Por isso não há recusa na
 * empresa de demonstração.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { transportaMensagem } from "@/lib/channels/capabilities";
import { nomeDoCanal } from "@/lib/channels/estado";
import { Recusa } from "@/lib/mcp-plataforma/recusa";
import { ROUTING_MODES, type RoutingMode } from "@/lib/schemas/routing";

import type { Desfecho, Implantacao } from "./base";
import { acharMembro, lerMembros, type Membro } from "./equipe";

/** A função do fork que grava a regra de um número pelo token de plataforma (9045). */
export const FUNCAO_DA_DISTRIBUICAO_DO_NUMERO = "fn_mia_distribuicao_do_numero_pela_plataforma";

/** Os papéis que recebem conversa: a mesma régua de `fn_set_channel_routing`. */
const PAPEIS_QUE_RECEBEM = new Set(["agent", "manager", "admin"]);

/** O teto da função do upstream (`cardinality(p_users) > 1000`). */
export const TETO_DE_RESPONSAVEIS = 1000;

const ROTULO_DO_MODO: Record<RoutingMode, string> = {
  manual: "cada um pega (manual)",
  round_robin: "rodízio",
  load: "menor carga",
};

export interface DistribuicaoPedida {
  /** O modo do número; `null` = usa o da organização. */
  modo?: RoutingMode | null;
  /** E-mail (ou id) de quem recebe todo cliente novo do número; `null` tira. */
  atendente_padrao?: string | null;
  /** E-mails (ou ids): a lista INTEIRA de quem pode receber o número. `[]` = ninguém (a fila). */
  responsaveis?: string[];
  /** `true` apaga a regra do número: todos os atendentes e o modo da organização. */
  voltar_ao_padrao_da_organizacao?: boolean;
}

/** A regra de um número como está gravada. `null` = sem regra própria. */
export interface RegraDoNumeroLida {
  policy_id: string;
  modo: RoutingMode | null;
  atendente_padrao_id: string | null;
  responsaveis_ids: string[];
}

/** A leitura que a resposta e `plataforma_ver_configuracao` devolvem. */
export interface DistribuicaoDoNumero {
  /** false = o número segue a organização (todos os atendentes elegíveis, o modo dela). */
  regra_propria: boolean;
  /** O modo do número; `null` = o da organização. */
  modo: RoutingMode | null;
  /** Quem recebe todo cliente novo do número (e-mail, ou o id se o e-mail não foi lido). */
  atendente_padrao: string | null;
  /** Quem pode receber o número pelo rodízio (e-mails). Vazio com regra própria = ninguém. */
  responsaveis: string[];
  /** Em palavras: "segue a organização", "só os responsáveis" ou "ninguém: as conversas ficam na fila". */
  situacao: string;
}

/** As regras de todos os números da organização, pelo id da conexão. */
export async function lerRegrasDosNumeros(admin: SupabaseClient, orgId: string): Promise<Map<string, RegraDoNumeroLida>> {
  const [politicas, responsaveis] = await Promise.all([
    admin
      .from("channel_routing_policies")
      .select("id, channel_session_id, distribution_mode, default_assignee_user_id")
      .eq("organization_id", orgId),
    admin.from("channel_routing_responsibles").select("policy_id, user_id").eq("organization_id", orgId),
  ]);
  if (politicas.error) throw new Error(`não consegui ler as regras dos números: ${politicas.error.message}`);
  if (responsaveis.error) throw new Error(`não consegui ler os responsáveis dos números: ${responsaveis.error.message}`);
  const porPolitica = new Map<string, string[]>();
  for (const r of (responsaveis.data ?? []) as Array<{ policy_id: string; user_id: string }>) {
    porPolitica.set(r.policy_id, [...(porPolitica.get(r.policy_id) ?? []), String(r.user_id)]);
  }
  const mapa = new Map<string, RegraDoNumeroLida>();
  for (const p of (politicas.data ?? []) as Array<{
    id: string;
    channel_session_id: string;
    distribution_mode: string | null;
    default_assignee_user_id: string | null;
  }>) {
    mapa.set(p.channel_session_id, {
      policy_id: p.id,
      modo: (ROUTING_MODES as readonly string[]).includes(p.distribution_mode ?? "") ? (p.distribution_mode as RoutingMode) : null,
      atendente_padrao_id: p.default_assignee_user_id ?? null,
      responsaveis_ids: [...new Set(porPolitica.get(p.id) ?? [])].sort(),
    });
  }
  return mapa;
}

/** A regra lida, em palavras e com e-mails. */
export function retratoDaDistribuicao(regra: RegraDoNumeroLida | null | undefined, membros: Membro[]): DistribuicaoDoNumero {
  const quem = (id: string) => membros.find((m) => m.user_id === id)?.email ?? id;
  if (!regra) {
    return {
      regra_propria: false,
      modo: null,
      atendente_padrao: null,
      responsaveis: [],
      situacao: "segue a organização: todos os atendentes elegíveis, no modo da organização",
    };
  }
  return {
    regra_propria: true,
    modo: regra.modo,
    atendente_padrao: regra.atendente_padrao_id ? quem(regra.atendente_padrao_id) : null,
    responsaveis: regra.responsaveis_ids.map(quem),
    situacao:
      regra.responsaveis_ids.length === 0
        ? "ninguém recebe pelo rodízio: as conversas ficam na fila" + (regra.atendente_padrao_id ? " (o destino padrão recebe o cliente novo)" : "")
        : "só os responsáveis recebem este número",
  };
}

/** A pessoa que pode receber conversa, ou a recusa que diz por que não. */
function quemRecebe(membros: Membro[], referencia: string, campo: string): Membro {
  const membro = acharMembro(membros, referencia);
  if (!PAPEIS_QUE_RECEBEM.has(membro.papel)) {
    throw new Recusa(
      `\`${campo}\`: «${referencia}» é da equipe com o papel ${membro.papel}, que não recebe conversa. ` +
        "Recebem conversa os papéis agent, manager e admin (o papel se troca em Configurações › Equipe).",
    );
  }
  return membro;
}

function mesmaLista(a: string[], b: string[]): boolean {
  const x = [...new Set(a)].sort();
  const y = [...new Set(b)].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/** A frase de cada recusa da função (as mensagens são as da porta do upstream). */
function fraseDaRecusa(mensagem: string, nomeDoNumero: string): string | null {
  if (mensagem.includes("routing_invalid_members")) {
    return "A equipe mudou enquanto a regra era gravada (alguém saiu ou mudou de papel). Leia de novo em plataforma_ver_configuracao, seção equipe, e chame de novo.";
  }
  if (mensagem.includes("routing_invalid_mode")) return "O `modo` é \"manual\", \"round_robin\" ou \"load\" (ou null, para seguir a organização).";
  if (mensagem.includes("routing_channel_not_found")) {
    return `A conexão «${nomeDoNumero}» foi arquivada ou não é desta organização. Confira em plataforma_ver_configuracao, seção canais.`;
  }
  if (mensagem.includes("distribuicao_sem_token_de_plataforma") || mensagem.includes("distribuicao_sem_admin_de_plataforma")) {
    return "O token desta chamada não pode gravar a distribuição: ele precisa estar vivo, ter a caixinha \"Montar a implantação\" e ter sido criado por um admin de plataforma de escopo cheio.";
  }
  return null;
}

export interface DistribuicaoConfigurada {
  desfecho: Desfecho;
  mudancas: string[];
  distribuicao: DistribuicaoDoNumero;
}

/**
 * Grava (ou apaga) a regra de atendimento de UM número. `canal` já foi achado
 * por `acharCanal`; `tokenId` é o ator da função do fork.
 */
export async function configurarDistribuicaoDoNumero(
  c: Implantacao,
  tokenId: string,
  canal: { id: string; display_name: string | null; phone_number: string | null; provider: string | null },
  pedido: DistribuicaoPedida,
  avisos: string[],
): Promise<DistribuicaoConfigurada> {
  const nome = nomeDoCanal(canal);
  if (!transportaMensagem(canal.provider)) {
    throw new Recusa(
      `A conexão «${nome}» não é um número de mensagem, e só número de mensagem distribui conversa (a tela Configurações › Atendimento lista só esses).`,
    );
  }
  const voltar = pedido.voltar_ao_padrao_da_organizacao === true;
  if (
    voltar &&
    (pedido.modo !== undefined || pedido.atendente_padrao !== undefined || pedido.responsaveis !== undefined)
  ) {
    throw new Recusa(
      "`voltar_ao_padrao_da_organizacao` apaga a regra do número inteira: mande só ele, sem `modo`, `atendente_padrao` ou `responsaveis`.",
    );
  }
  if (
    !voltar &&
    pedido.modo === undefined &&
    pedido.atendente_padrao === undefined &&
    pedido.responsaveis === undefined
  ) {
    throw new Recusa(
      "Informe ao menos um ajuste em `distribuicao`: `modo`, `atendente_padrao`, `responsaveis` ou `voltar_ao_padrao_da_organizacao`. " +
        'Ex.: { "modo": "round_robin", "responsaveis": ["ana@empresa.com.br", "bruno@empresa.com.br"] }',
    );
  }
  if ((pedido.responsaveis?.length ?? 0) > TETO_DE_RESPONSAVEIS) {
    throw new Recusa(`Um número aceita até ${TETO_DE_RESPONSAVEIS} responsáveis por chamada.`);
  }

  const [regras, membros] = await Promise.all([lerRegrasDosNumeros(c.admin, c.orgId), lerMembros(c.admin, c.orgId)]);
  const atual = regras.get(canal.id) ?? null;

  if (voltar) {
    if (!atual) {
      return { desfecho: "ja_estava", mudancas: [], distribuicao: retratoDaDistribuicao(null, membros) };
    }
    await gravar(c, tokenId, canal, { reset: true, usuarios: [], modo: null, destino: null }, nome);
    avisos.push(
      `O número «${nome}» voltou ao padrão da organização: todos os atendentes elegíveis recebem, no modo da organização (plataforma_configurar_atendimento).`,
    );
    return { desfecho: "atualizou", mudancas: ["distribuição do número"], distribuicao: retratoDaDistribuicao(null, membros) };
  }

  if (!atual && pedido.responsaveis === undefined) {
    throw new Recusa(
      `O número «${nome}» ainda não tem regra própria: hoje todos os atendentes elegíveis da organização recebem as conversas dele. ` +
        "Criar a regra RESTRINGE quem recebe, então informe `responsaveis` por extenso: a lista de e-mails de quem pode receber este número " +
        "(`[]` = ninguém recebe pelo rodízio e as conversas ficam na fila, salvo o `atendente_padrao`).",
    );
  }

  const usuarios =
    pedido.responsaveis !== undefined
      ? [...new Set(pedido.responsaveis.map((r, i) => quemRecebe(membros, r, `distribuicao.responsaveis[${i}]`).user_id))]
      : (atual?.responsaveis_ids ?? []);
  const modo: RoutingMode | null = pedido.modo !== undefined ? pedido.modo : (atual?.modo ?? null);
  let destino: string | null =
    pedido.atendente_padrao !== undefined
      ? pedido.atendente_padrao === null
        ? null
        : quemRecebe(membros, pedido.atendente_padrao, "distribuicao.atendente_padrao").user_id
      : (atual?.atendente_padrao_id ?? null);

  if (modo === null && destino !== null) {
    if (pedido.atendente_padrao !== undefined && pedido.atendente_padrao !== null) {
      throw new Recusa(
        `O atendente de destino padrão só vale com um modo próprio do número (a tela desliga o campo sem ele). Informe também \`modo\` ("manual", "round_robin" ou "load").`,
      );
    }
    // A tela faz o mesmo: sem modo próprio, o destino padrão perde o sentido.
    destino = null;
    avisos.push("Sem modo próprio o número não tem destino padrão: o atendente de destino padrão também saiu, como na tela.");
  }

  const mudancas: string[] = [];
  if (!atual) mudancas.push("regra própria do número");
  if (atual && !mesmaLista(atual.responsaveis_ids, usuarios)) mudancas.push("responsáveis do número");
  if ((atual?.modo ?? null) !== modo) mudancas.push("modo do número");
  if ((atual?.atendente_padrao_id ?? null) !== destino) mudancas.push("destino padrão do número");
  if (mudancas.length === 0) {
    return { desfecho: "ja_estava", mudancas, distribuicao: retratoDaDistribuicao(atual, membros) };
  }

  await gravar(c, tokenId, canal, { reset: false, usuarios, modo, destino }, nome);
  const gravada: RegraDoNumeroLida = {
    policy_id: atual?.policy_id ?? "",
    modo,
    atendente_padrao_id: destino,
    responsaveis_ids: [...usuarios].sort(),
  };

  if (modo !== null) {
    avisos.push(
      `O número «${nome}» distribui por ${ROTULO_DO_MODO[modo]}; os outros números seguem o modo da organização (plataforma_configurar_atendimento).`,
    );
  }
  if (destino !== null) {
    const pessoa = membros.find((m) => m.user_id === destino);
    avisos.push(
      `Todo cliente novo do número «${nome}» vai direto para ${pessoa?.email ?? destino}, antes de qualquer distribuição e mesmo fora da jornada; ` +
        "só espera quando a pessoa estiver indisponível ou sem folga de capacidade (plataforma_definir_jornada). O agente de IA continua respondendo: a entrega não cala a IA.",
    );
  }
  if (usuarios.length === 0) {
    avisos.push(
      `Ninguém recebe o número «${nome}» pelo rodízio: as conversas dele ficam na fila${destino !== null ? " (o destino padrão recebe o cliente novo)" : ""}.`,
    );
  }
  avisos.push("As conversas abertas e sem dono deste número voltam à distribuição pela regra nova, como na tela.");
  return { desfecho: "atualizou", mudancas, distribuicao: retratoDaDistribuicao(gravada, membros) };
}

async function gravar(
  c: Implantacao,
  tokenId: string,
  canal: { id: string },
  regra: { reset: boolean; usuarios: string[]; modo: RoutingMode | null; destino: string | null },
  nome: string,
): Promise<void> {
  const { error } = await c.admin.rpc(FUNCAO_DA_DISTRIBUICAO_DO_NUMERO, {
    p_org: c.orgId,
    p_token: tokenId,
    p_channel: canal.id,
    p_users: regra.usuarios,
    p_reset: regra.reset,
    p_mode: regra.modo,
    p_default_assignee: regra.destino,
  });
  if (error) {
    const frase = fraseDaRecusa(error.message ?? "", nome);
    if (frase) throw new Recusa(frase);
    throw new Error(`não consegui gravar a distribuição do número: ${error.message}`);
  }
  // A mesma linha da rota da tela (`PATCH /api/v1/settings/routing/channels`).
  void audit({
    action: "routing.config_changed",
    actorUserId: c.autorUserId,
    organizationId: c.orgId,
    resourceType: "channel_session",
    resourceId: canal.id,
    requestId: c.requestId,
    metadata: {
      user_ids: regra.usuarios,
      reset: regra.reset,
      distribution_mode: regra.modo,
      default_assignee_user_id: regra.destino,
      via: "mcp_plataforma",
    },
  });
}
