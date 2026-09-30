/**
 * Os modelos APROVADOS do canal que um passo de fluxo consegue mandar sozinho.
 *
 * O construtor de fluxo só oferecia os textos prontos de `message_templates` — e
 * texto livre é justamente o que o canal oficial recusa quando a janela de 24 h
 * fechou, que é quando um fluxo de reengajamento mais precisa falar. Esta é a
 * lista que falta: o que a plataforma aprovou, NESTA organização.
 *
 * Duas exclusões, pelas mesmas razões que o turno do fluxo recusa o envio
 * (`resolveModeloAprovado` em `lib/agent-engine/agent/followup-turn.ts`) — a
 * tela não oferece o que o motor depois pula:
 *   - status que não dispara (pendente, rejeitado, pausado);
 *   - modelo com variável: o fluxo não tem de onde tirar o valor.
 *
 * FORK MIA — com UMA exceção, a mesma do motor: o modelo cuja única variável é o
 * `{{1}}` (ou o primeiro nomeado) do corpo entra, porque o motor a preenche com
 * o primeiro nome do contato (`lib/channels/meta/variavel-do-nome.ts`). Vem
 * marcado (`variavel_do_nome`) para a tela dizer isso a quem escolhe.
 */
import { renderTemplateBody } from "@/lib/channels/meta/render-template";
import { isStatusSendable } from "@/lib/channels/meta/template-binding";
import { deriveTemplateContract } from "@/lib/channels/meta/template-contract";
import { variavelDoModelo } from "@/lib/channels/meta/variavel-do-nome";

export interface LinhaDeModeloDoCanal {
  id: string;
  name: string;
  language: string;
  status: string;
  parameter_format: string | null;
  components: unknown;
}

export interface ModeloAprovadoDoFluxo {
  /** `meta_templates.id` — o que o passo grava em `template_id`/`fallback_template_id`. */
  id: string;
  name: string;
  language: string;
  /** O texto que o cliente lê, para a pessoa escolher pelo conteúdo e não pelo nome técnico. */
  texto: string;
  /**
   * FORK MIA — presente quando o modelo leva o primeiro nome do contato:
   * `marcador` é a variável como aparece no texto (`{{1}}`, `{{nome}}`) e
   * `aceita_sem_nome` diz se, sem nome, vai o texto neutro (senão o passo é pulado).
   */
  variavel_do_nome?: { marcador: string; aceita_sem_nome: boolean };
}

export function modelosQueOFluxoEnvia(linhas: LinhaDeModeloDoCanal[]): ModeloAprovadoDoFluxo[] {
  const saida: ModeloAprovadoDoFluxo[] = [];
  for (const l of linhas) {
    if (!isStatusSendable(l.status)) continue;
    const contrato = deriveTemplateContract({
      name: l.name,
      language: l.language,
      ...(l.parameter_format ? { parameter_format: l.parameter_format } : {}),
      components: l.components as never,
    });
    const variavel = variavelDoModelo(contrato, l.components);
    if (variavel.tipo === "outras") continue;
    saida.push({
      id: l.id,
      name: l.name,
      language: l.language,
      texto: renderTemplateBody(l.components, {}, {
        name: l.name,
        language: l.language,
        ...(l.parameter_format ? { parameterFormat: l.parameter_format } : {}),
      }),
      ...(variavel.tipo === "nome"
        ? { variavel_do_nome: { marcador: variavel.marcador, aceita_sem_nome: variavel.aceitaNeutro } }
        : {}),
    });
  }
  return saida;
}
