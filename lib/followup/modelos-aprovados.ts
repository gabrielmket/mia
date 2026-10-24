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
 *   - variável que não é texto (imagem do cabeçalho, sufixo de link de botão):
 *     contato e negócio não têm de onde tirar.
 *
 * Variável de TEXTO entra, com a lista das variáveis: o passo escolhe de onde
 * sai cada uma (`lib/channels/meta/variaveis-do-fluxo.ts`). O plano B da
 * mensagem por IA não tem esse mapa, e por isso a tela só oferece a ele os
 * modelos SEM variável.
 *
 * FORK MIA — sem mapa no passo, vale a regra do fork, a mesma do motor: o modelo
 * cuja única variável é o `{{1}}` (ou o primeiro nomeado) do corpo sai com o
 * primeiro nome do contato (`lib/channels/meta/variavel-do-nome.ts`). Vem
 * marcado (`variavel_do_nome`) para a tela dizer isso a quem escolhe, e por isso
 * o plano B da IA também o oferece.
 */
import { slotKey } from "@/lib/channels/meta/build-components";
import { renderTemplateBody } from "@/lib/channels/meta/render-template";
import { isStatusSendable } from "@/lib/channels/meta/template-binding";
import { deriveTemplateContract } from "@/lib/channels/meta/template-contract";
import { variavelDoModelo } from "@/lib/channels/meta/variavel-do-nome";
import { variavelPreenchivelPeloFluxo } from "@/lib/channels/meta/variaveis-do-fluxo";

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
  /** As variáveis, na ordem do modelo. Vazio = modelo sem variável. */
  variaveis: VariavelDoModelo[];
  /**
   * FORK MIA — presente quando o modelo leva o primeiro nome do contato sem mapa
   * no passo: `marcador` é a variável como aparece no texto (`{{1}}`, `{{nome}}`)
   * e `aceita_sem_nome` diz se, sem nome, vai o texto neutro (senão o passo é pulado).
   */
  variavel_do_nome?: { marcador: string; aceita_sem_nome: boolean };
}

export interface VariavelDoModelo {
  /** A chave que o passo usa no mapa (`"1"`, `"header:1"`). */
  chave: string;
  /** Como aparece no modelo: `{{1}}`. */
  marcador: string;
  /** O texto em volta, para a pessoa saber o que vai no lugar ("Hola", "!"). */
  antes: string;
  depois: string;
  noCabecalho: boolean;
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
    if (contrato.slots.some((slot) => !variavelPreenchivelPeloFluxo(slot))) continue;
    // FORK MIA — a variável do nome, quando é a única do modelo.
    const variavel = variavelDoModelo(contrato, l.components);
    saida.push({
      id: l.id,
      name: l.name,
      language: l.language,
      texto: renderTemplateBody(l.components, {}, {
        name: l.name,
        language: l.language,
        ...(l.parameter_format ? { parameterFormat: l.parameter_format } : {}),
      }),
      variaveis: contrato.slots.map((slot) => ({
        chave: slotKey(slot.address, slot.key),
        marcador: `{{${slot.key}}}`,
        antes: slot.contextBefore,
        depois: slot.contextAfter,
        noCabecalho: slot.address.kind === "header",
      })),
      ...(variavel.tipo === "nome"
        ? { variavel_do_nome: { marcador: variavel.marcador, aceita_sem_nome: variavel.aceitaNeutro } }
        : {}),
    });
  }
  return saida;
}
