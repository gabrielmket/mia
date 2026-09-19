/**
 * EDITAR E EXCLUIR TEMPLATE NA META — as duas pontas que faltavam.
 *
 * A tela criava e sincronizava. Um texto com erro de português, um botão com o
 * link errado, um modelo que não se usa mais: o único caminho era abrir o painel
 * da Meta. E quem tem o painel aberto do lado costuma "só ajeitar por lá" — aí o
 * nosso banco e a Meta divergem, e o disparo falha com um erro que não menciona
 * nenhuma das duas edições.
 *
 * ─── O que a Meta deixa editar, e o que ela não deixa ─────────────────────
 *
 * Editar é `POST /{template-id}` com os componentes novos. NOME, IDIOMA e
 * CATEGORIA não mudam — são a identidade do modelo do lado dela. Tentar mudar
 * qualquer um devolve um erro que fala de "template" sem dizer qual campo, e é
 * por isso que esta função nem os envia: quem quer outro nome está criando
 * outro template, e a tela precisa dizer isso.
 *
 * ⚠️ Editar um template APROVADO o devolve para análise. A mensagem para de
 * poder ser disparada até a Meta aprovar de novo — e uma campanha agendada para
 * amanhã de manhã morre calada. Quem chama precisa avisar antes, não depois.
 *
 * Excluir é `DELETE /{waba-id}/message_templates?name=` — por NOME, e apaga
 * TODOS os idiomas daquele nome. A Meta não oferece apagar um idioma só, e
 * fingir que oferece faria o operador apagar o espanhol junto com o português
 * sem ter pedido.
 */

export interface EditarTemplateInput {
  /** O id do template NA META (`meta_templates.meta_template_id`). */
  templateId: string;
  token: string;
  graphVersion: string;
  /** Os componentes já no formato da Meta — os mesmos que a criação monta. */
  components: unknown[];
}

export type ResultadoDaEdicao =
  | { ok: true }
  | { ok: false; motivo: "api_error"; detalhe: string };

/** Nunca lança: o erro vira valor, com a frase que a Meta escreveu para humano. */
export async function editarTemplate(input: EditarTemplateInput): Promise<ResultadoDaEdicao> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/${input.graphVersion}/${encodeURIComponent(input.templateId)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.token}`,
          "Content-Type": "application/json",
        },
        // Só `components`. Nome, idioma e categoria são identidade do lado da
        // Meta — ver o cabeçalho.
        body: JSON.stringify({ components: input.components }),
      },
    );

    if (!res.ok) {
      const corpo = (await res.json().catch(() => null)) as {
        error?: { message?: string; error_user_msg?: string };
      } | null;
      return {
        ok: false,
        motivo: "api_error",
        // `error_user_msg` é a frase que a Meta escreveu para humano ler; a
        // outra é a técnica. A primeira é a diferença entre o operador entender
        // o que corrigir e abrir chamado.
        detalhe:
          corpo?.error?.error_user_msg ?? corpo?.error?.message ?? `HTTP ${res.status}`,
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      motivo: "api_error",
      detalhe: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface ExcluirTemplateInput {
  wabaId: string;
  token: string;
  graphVersion: string;
  /** O NOME. A Meta apaga todos os idiomas dele — ver o cabeçalho. */
  name: string;
}

export async function excluirTemplate(
  input: ExcluirTemplateInput,
): Promise<ResultadoDaEdicao> {
  try {
    const url =
      `https://graph.facebook.com/${input.graphVersion}/${encodeURIComponent(input.wabaId)}` +
      `/message_templates?name=${encodeURIComponent(input.name)}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${input.token}` },
    });

    if (!res.ok) {
      const corpo = (await res.json().catch(() => null)) as {
        error?: { message?: string; error_user_msg?: string };
      } | null;
      return {
        ok: false,
        motivo: "api_error",
        detalhe:
          corpo?.error?.error_user_msg ?? corpo?.error?.message ?? `HTTP ${res.status}`,
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      motivo: "api_error",
      detalhe: err instanceof Error ? err.message : String(err),
    };
  }
}
