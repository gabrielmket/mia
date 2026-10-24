/**
 * FORK MIA (.85) — o HORÁRIO DE ATENDIMENTO DA IA no MCP de plataforma.
 *
 * A regra mora em `lib/agent-engine/agent/horario-da-ia.ts`. Aqui ficam as duas
 * pontas do MCP:
 *
 *   - `horarioDaIaDoPedido`: o `horario_de_atendimento` de
 *     `plataforma_garantir_agente` vira o dado gravado. Aceita as faixas
 *     (`{ faixas, fuso? }`) e o formato antigo de uma faixa
 *     (`{ inicio, fim, dias, fuso? }`), convertido com a regra nova: a faixa
 *     que passa da meia-noite é recusada (são duas), e "24:00" vale como fim.
 *     Sem fuso, o da empresa. Grava na forma canônica (faixas unidas e
 *     agrupadas), para o pedido repetido responder `ja_estava`.
 *   - `retratoDoHorarioDaIa`: o que `plataforma_ver_agentes` devolve: o horário
 *     da versão PUBLICADA (o que vale agora), se a IA está ativa, a próxima
 *     troca e se o horário cai fora da janela de RESPOSTA do número.
 */
import {
  ativaEm,
  fraseDoProblema,
  horarioForaDaJanelaDeResposta,
  horarioGravadoDe,
  lerHorarioDaIa,
  MENSAGEM_SEM_FAIXA,
  normalizarHorario,
  problemasDoHorario,
  proximaTroca,
  textoDaTroca,
  type FaixaDaIa,
  type HorarioDaIaGravado,
} from "@/lib/agent-engine/agent/horario-da-ia";
import { effectiveKnobs, type ChannelKnobsRow } from "@/lib/ai/pacing-knobs";
import { Recusa } from "@/lib/mcp-plataforma/recusa";

/** O `horario_de_atendimento` como o MCP o recebe. */
export type HorarioPedido =
  | { faixas: FaixaDaIa[]; fuso?: string }
  | { inicio: string; fim: string; dias: number[]; fuso?: string };

/** O pedido vira o horário gravado, ou a recusa que ensina. */
export function horarioDaIaDoPedido(pedido: HorarioPedido, fusoDaEmpresa: string): HorarioDaIaGravado {
  const fuso = (pedido.fuso ?? fusoDaEmpresa).trim();
  const faixas: FaixaDaIa[] =
    "faixas" in pedido ? pedido.faixas : [{ dias: pedido.dias, inicio: pedido.inicio, fim: pedido.fim }];
  const horario = { fuso, faixas };
  const problemas = problemasDoHorario(horario);
  if (problemas.length === 1 && problemas[0]!.tipo === "sem_faixa") {
    throw new Recusa(`${MENSAGEM_SEM_FAIXA} Para a IA responder a qualquer hora, mande \`horario_de_atendimento: null\`.`);
  }
  if (problemas.length > 0) {
    const frases = [...new Set(problemas.map(fraseDoProblema))];
    throw new Recusa(
      `O horário de atendimento da IA não passou na conferência:\n- ${frases.join("\n- ")}\n` +
        'Ex.: { "faixas": [{ "dias": [1,2,3,4,5], "inicio": "00:00", "fim": "10:00" }, { "dias": [1,2,3,4,5], "inicio": "17:30", "fim": "24:00" }] }.',
    );
  }
  return normalizarHorario(horario);
}

/** A janela de RESPOSTA do número como o MCP a descreve. */
export interface JanelaDeRespostaLida {
  inicio_hora: number;
  fim_hora: number;
  domingo: boolean;
  fuso: string;
}

/** A janela de resposta EFETIVA de um número: os ajustes gravados sobre os padrões. */
export function janelaDeRespostaDe(ajustes: ChannelKnobsRow | null | undefined, fusoDaEmpresa: string): JanelaDeRespostaLida {
  const efetivo = effectiveKnobs(ajustes ?? null, fusoDaEmpresa);
  return {
    inicio_hora: efetivo.respostaStartHour,
    fim_hora: efetivo.respostaEndHour,
    domingo: efetivo.allowSunday,
    fuso: efetivo.timezone,
  };
}

export interface RetratoDoHorarioDaIa {
  /** O horário da versão PUBLICADA. `null` = a IA responde a qualquer hora. */
  horario_da_ia: HorarioDaIaGravado | null;
  /** `null` quando o agente não tem versão publicada (nada atende). */
  ativa_agora: boolean | null;
  proxima_troca: { em: string; texto: string; fica: "ativa" | "inativa" } | null;
  /** `null` = sem horário ou sem número para comparar. */
  horario_fora_da_janela_de_resposta: boolean | null;
  janela_de_resposta_do_numero: JanelaDeRespostaLida | null;
}

export function retratoDoHorarioDaIa(input: {
  /** O `trigger_config` da versão publicada; `undefined` = não há versão publicada. */
  gatilhoPublicado: unknown | undefined;
  /** Os ajustes do número da versão publicada; `undefined` = sem número. */
  ajustesDoNumero: ChannelKnobsRow | null | undefined;
  temNumero: boolean;
  fusoDaEmpresa: string;
  agora: Date;
}): RetratoDoHorarioDaIa {
  const janela = input.temNumero ? janelaDeRespostaDe(input.ajustesDoNumero, input.fusoDaEmpresa) : null;
  if (input.gatilhoPublicado === undefined) {
    return {
      horario_da_ia: null,
      ativa_agora: null,
      proxima_troca: null,
      horario_fora_da_janela_de_resposta: null,
      janela_de_resposta_do_numero: janela,
    };
  }
  const horario = lerHorarioDaIa(input.gatilhoPublicado);
  if (horario === null) {
    return {
      horario_da_ia: null,
      ativa_agora: true,
      proxima_troca: null,
      horario_fora_da_janela_de_resposta: null,
      janela_de_resposta_do_numero: janela,
    };
  }
  const troca = proximaTroca(horario, input.agora);
  return {
    horario_da_ia: horarioGravadoDe(input.gatilhoPublicado),
    ativa_agora: ativaEm(horario, input.agora),
    proxima_troca: troca
      ? { em: troca.em.toISOString(), texto: textoDaTroca(troca), fica: troca.ativaDepois ? "ativa" : "inativa" }
      : null,
    horario_fora_da_janela_de_resposta:
      janela === null
        ? null
        : horarioForaDaJanelaDeResposta(
            horario,
            { inicioHora: janela.inicio_hora, fimHora: janela.fim_hora, domingo: janela.domingo, fuso: janela.fuso },
            input.agora,
          ),
    janela_de_resposta_do_numero: janela,
  };
}
