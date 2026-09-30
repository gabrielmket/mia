/**
 * FORK MIA (.62) — POR QUAL NÚMERO sai o aviso de grupo de cada empresa.
 *
 * ─── O que mudou ─────────────────────────────────────────────────────────────
 *
 * Até a .61 o aviso ao grupo do time (a ficha e o histórico quando a IA passa o
 * lead ao comercial) saía SEMPRE pelo número da plataforma
 * (`channel_sessions.e_numero_de_avisos`). Continua sendo o padrão. Agora a
 * empresa pode, em vez disso, usar um número que ELA MESMA conectou:
 *
 *   `organizations.settings.numero_de_avisos`
 *     ausente                → o número da plataforma (como sempre foi)
 *     { modo: "plataforma" } → idem, dito explicitamente
 *     { modo: "empresa", channel_session_id, reserva_da_plataforma }
 *                            → um número desta empresa
 *
 * Mora em `settings`, ao lado de `grupo_de_avisos`, pela mesma razão que ele: é
 * escolha de operação, não entidade, e não pede migration.
 *
 * ─── Só número que entrega em grupo ──────────────────────────────────────────
 *
 * A pergunta é a CAPACIDADE (`entregaEmGrupo`, a coluna `groups` da matriz de
 * `lib/channels/capabilities.ts`), nunca o nome do canal. Hoje só o número por QR
 * responde `full`; a API oficial da Meta e os parceiros dela respondem `limited`
 * (grupo só em plano de uso e fora de coexistência), e prometer ali faria o aviso
 * morrer num 4xx que ninguém liga ao problema.
 *
 * ─── O número da empresa caiu: NÃO troca calado ──────────────────────────────
 *
 * "Caiu" é o estado que o vigia de conexão grava (`status` diferente de
 * `WORKING`), o arquivamento, ou o canal deixar de entregar em grupo. Nesses três
 * casos a decisão é:
 *
 *   reserva DESLIGADA → o aviso NÃO sai, e o motivo vai para o histórico do
 *                       negócio e para a tela do admin;
 *   reserva LIGADA    → sai pelo número da plataforma, e o histórico diz que saiu
 *                       pela reserva e POR QUÊ. A tela mostra o desvio enquanto
 *                       ele durar.
 *
 * A reserva vem desligada: quem escolheu o número da própria empresa pode ter
 * escolhido justamente para o time NÃO receber recado de outro número, e trocar
 * o remetente sem ele ter pedido é a mudança que ninguém percebe até estranhar.
 *
 * ⚠️ A decisão é pelo ESTADO conhecido antes de enviar, não pela falha do envio.
 * Um envio que falha com o número marcado como conectado é registrado como falha
 * e NÃO é repetido pela plataforma: o transporte pode ter entregado e só a
 * resposta ter se perdido (tempo esgotado), e a repetição chegaria em dobro no
 * grupo. O vigia de conexão atualiza o estado em minutos; a partir daí a reserva
 * assume sozinha.
 *
 * Função pura de propósito: os dois motores de passagem (Supabase e `pg`) e a
 * ação `notify_group` leem o banco cada um com a sua biblioteca, e a REGRA não
 * pode ter duas cópias que divergem no dia em que uma mudar.
 */
import { entregaEmGrupo } from "@/lib/channels";
import { STATUS_SAUDAVEL } from "@/lib/channels/health";
import type { ChannelSessionRef } from "@/lib/channels/session-ref";

/** Onde a escolha mora dentro de `organizations.settings`. */
export const CHAVE_DA_ORIGEM = "numero_de_avisos";

export type OrigemDoAviso =
  | { modo: "plataforma" }
  | {
      modo: "empresa";
      /** `null` quando o que está gravado não é um id válido: vira "o número sumiu". */
      channel_session_id: string | null;
      reserva_da_plataforma: boolean;
    };

export const ORIGEM_PADRAO: OrigemDoAviso = { modo: "plataforma" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lê a escolha de dentro do jsonb.
 *
 * Ausência e lixo viram o PADRÃO (plataforma) — é o comportamento de sempre.
 * A exceção é o modo "empresa" com id estragado: aí a empresa DISSE que queria o
 * número dela, e cair na plataforma em silêncio seria exatamente a troca calada
 * que esta funcionalidade proíbe. Vira `channel_session_id: null`, que a decisão
 * lê como "o número escolhido não existe mais".
 */
export function lerOrigemDoAviso(settings: unknown): OrigemDoAviso {
  if (!settings || typeof settings !== "object") return ORIGEM_PADRAO;
  const bruto = (settings as Record<string, unknown>)[CHAVE_DA_ORIGEM];
  if (!bruto || typeof bruto !== "object") return ORIGEM_PADRAO;
  const { modo, channel_session_id, reserva_da_plataforma } = bruto as {
    modo?: unknown;
    channel_session_id?: unknown;
    reserva_da_plataforma?: unknown;
  };
  if (modo !== "empresa") return ORIGEM_PADRAO;
  return {
    modo: "empresa",
    channel_session_id:
      typeof channel_session_id === "string" && UUID.test(channel_session_id) ? channel_session_id : null,
    reserva_da_plataforma: reserva_da_plataforma === true,
  };
}

/** Por que o número da empresa não serve agora. */
export type ProblemaDoNumeroDaEmpresa =
  | "numero_da_empresa_sumiu"
  | "numero_da_empresa_nao_entrega_em_grupo"
  | "numero_da_empresa_fora_do_ar";

/** Por que não há número para mandar. */
export type MotivoSemNumero =
  | "sem_numero_de_avisos"
  | "numero_nao_entrega_em_grupo"
  | ProblemaDoNumeroDaEmpresa;

/** Por qual caminho o aviso sai. `reserva` = era para ser o da empresa. */
export type ViaDoAviso = "plataforma" | "empresa" | "reserva";

/**
 * A reserva, quando o número da empresa não serve:
 * `desligada` = a empresa não autorizou; `indisponivel` = autorizou, e o número
 * da plataforma também não serve. `null` = não se aplica (modo plataforma, ou o
 * número da empresa está de pé).
 */
export type SituacaoDaReserva = "desligada" | "indisponivel" | null;

/** A linha da sessão que a empresa escolheu, como o banco a devolve. */
export type SessaoDaEmpresa = ChannelSessionRef & {
  id: string;
  organization_id: string;
  status: string | null;
  archived_at?: string | null;
};

export type NumeroEscolhido =
  | {
      ok: true;
      sessao: ChannelSessionRef;
      via: ViaDoAviso;
      /** Preenchido só quando `via === "reserva"`: o que derrubou o da empresa. */
      desvio: ProblemaDoNumeroDaEmpresa | null;
    }
  | { ok: false; motivo: MotivoSemNumero; reserva: SituacaoDaReserva };

/**
 * O número da empresa serve AGORA? `null` = serve.
 *
 * A organização é conferida aqui, e não só na gravação: o id vive num jsonb que
 * a tela escreve, e um número de OUTRA empresa mandaria o aviso — com nome do
 * lead e resumo da qualificação — por um telefone que não é deste cliente.
 */
export function problemaDoNumeroDaEmpresa(
  organizationId: string,
  sessao: SessaoDaEmpresa | null,
): ProblemaDoNumeroDaEmpresa | null {
  if (!sessao || sessao.organization_id !== organizationId || sessao.archived_at) {
    return "numero_da_empresa_sumiu";
  }
  if (!entregaEmGrupo(sessao.provider)) return "numero_da_empresa_nao_entrega_em_grupo";
  if (sessao.status !== STATUS_SAUDAVEL) return "numero_da_empresa_fora_do_ar";
  return null;
}

/**
 * A decisão inteira: por qual número o aviso desta empresa sai agora.
 *
 * O número da PLATAFORMA é tratado como sempre foi — sem conferir o estado
 * dele. Mudar isso agora mudaria o comportamento de todas as empresas que não
 * escolheram nada, e a queda dele já tem alarme próprio (o report interno trata
 * o número de avisos caído como o problema maior que ele é).
 */
export function escolherNumeroDoAviso(args: {
  organizationId: string;
  origem: OrigemDoAviso;
  daEmpresa: SessaoDaEmpresa | null;
  daPlataforma: ChannelSessionRef | null;
}): NumeroEscolhido {
  const pelaPlataforma = (): NumeroEscolhido => {
    if (!args.daPlataforma) return { ok: false, motivo: "sem_numero_de_avisos", reserva: null };
    if (!entregaEmGrupo(args.daPlataforma.provider)) {
      return { ok: false, motivo: "numero_nao_entrega_em_grupo", reserva: null };
    }
    return { ok: true, sessao: args.daPlataforma, via: "plataforma", desvio: null };
  };

  if (args.origem.modo === "plataforma") return pelaPlataforma();

  const problema = problemaDoNumeroDaEmpresa(args.organizationId, args.daEmpresa);
  if (!problema && args.daEmpresa) {
    return { ok: true, sessao: args.daEmpresa, via: "empresa", desvio: null };
  }
  const motivo = problema ?? "numero_da_empresa_sumiu";

  if (!args.origem.reserva_da_plataforma) return { ok: false, motivo, reserva: "desligada" };

  const reserva = pelaPlataforma();
  if (!reserva.ok) return { ok: false, motivo, reserva: "indisponivel" };
  return { ...reserva, via: "reserva", desvio: motivo };
}
