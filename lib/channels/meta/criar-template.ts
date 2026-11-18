/**
 * CRIAR um template na Meta — o outro sentido do espelho.
 *
 * `template-sync.ts` traz o que já existe lá. Isto manda o que nasce aqui. Sem
 * este caminho, quem usa o produto precisa sair dele, abrir o WhatsApp Manager,
 * lembrar o que escrever, e voltar — e "sai do produto para fazer a coisa que o
 * produto existe para fazer" é a definição de funcionalidade pela metade.
 *
 * ── O que NÃO fazemos aqui ──────────────────────────────────────────────────
 *
 * Não gravamos o template como APROVADO. A Meta analisa, e a resposta da
 * criação diz `PENDING` (ou já `APPROVED`, para algumas categorias). Quem muda
 * esse estado depois é o webhook `message_template_status_update`, que a conta
 * já assina. Inventar um estado local seria a segunda fonte da verdade que o
 * espelho inteiro existe para eliminar.
 *
 * ── Por que o corpo é montado aqui e não pela tela ──────────────────────────
 *
 * O formato de `components` é do provider, e a doutrina de canal proíbe nome de
 * provider fora de `lib/channels/`. A tela manda texto, botão e exemplos; a
 * tradução para o vocabulário da Graph API mora aqui.
 */
import { graphBaseUrl } from "@/lib/channels/meta/graph-base";

export type CategoriaDeTemplate = "MARKETING" | "UTILITY" | "AUTHENTICATION";

export interface NovoTemplate {
  /** Só minúsculas, números e `_` — a Meta recusa o resto, e com 400 opaco. */
  name: string;
  language: string;
  category: CategoriaDeTemplate;
  /** O texto, com `{{1}}`, `{{2}}`… nos lugares que mudam. */
  body: string;
  /**
   * Um exemplo por variável, na ordem. A Meta EXIGE exemplos quando há
   * variáveis e recusa sem dizer qual faltou — por isso a contagem é conferida
   * aqui, onde dá para explicar.
   */
  exemplos?: string[];
  /**
   * Botões de resposta rápida (no máximo 3). O de sair ("Parar promoções") não
   * é enfeite: é o que mais ajuda na aprovação e o que segura bloqueio — quem
   * consegue sair sozinho não denuncia.
   */
  botoes?: string[];
  /** Texto curto no topo. Opcional, e sem variável de propósito (ver abaixo). */
  header?: string;
  /**
   * Cabeçalho de MÍDIA, alternativo ao de texto.
   *
   * `handle` é o que `subirMidiaDoTemplate` devolve — não é URL nem arquivo, e
   * não é a imagem que o cliente recebe: é a AMOSTRA que a Meta usa para
   * revisar o modelo. A imagem de cada envio vai no parâmetro do cabeçalho, na
   * hora de disparar, e pode ser diferente a cada campanha.
   *
   * Texto e mídia são EXCLUSIVOS: a Meta aceita um `HEADER` só. Quando os dois
   * vêm, a mídia vence — é a escolha mais específica de quem preencheu.
   */
  headerMidia?: { formato: "IMAGE" | "VIDEO" | "DOCUMENT"; handle: string };
  /** Rodapé curto. A Meta não aceita variável aqui. */
  footer?: string;
}

export interface CriarTemplateInput extends NovoTemplate {
  wabaId: string;
  token: string;
  graphVersion: string;
}

export type CriarTemplateResult =
  | { criado: true; id: string; status: string; category: string }
  | { criado: false; motivo: "nome_invalido" | "exemplos_faltando" | "api_error"; detalhe: string };

/** `^[a-z0-9_]{1,512}$` — a regra da Meta, checada aqui para o erro ser legível. */
export function nomeValido(nome: string): boolean {
  return /^[a-z0-9_]{1,512}$/.test(nome);
}

/** Quantas variáveis `{{n}}` o corpo usa. Repetida conta uma vez. */
export function variaveisDoCorpo(body: string): number {
  const achadas = new Set<string>();
  for (const m of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) achadas.add(m[1]!);
  return achadas.size;
}

/**
 * Monta `components` no vocabulário da Graph API.
 *
 * Exportada para o teste poder conferir o formato sem falar com a Meta — o erro
 * que ela devolve para componente malformado é um 400 genérico, e descobrir
 * isso só no ar custa uma submissão (que entra na fila de análise).
 */
export function componentesDaMeta(t: NovoTemplate): Array<Record<string, unknown>> {
  const componentes: Array<Record<string, unknown>> = [];

  if (t.headerMidia) {
    /**
     * O exemplo vai em `header_handle`, e é uma LISTA — mesmo com um arquivo só.
     * A Meta recusa o valor solto, e o erro fala de "example" sem dizer que o
     * problema é a forma. É o mesmo tropeço do `body_text` logo abaixo.
     */
    componentes.push({
      type: "HEADER",
      format: t.headerMidia.formato,
      example: { header_handle: [t.headerMidia.handle] },
    });
  } else if (t.header?.trim()) {
    componentes.push({ type: "HEADER", format: "TEXT", text: t.header.trim() });
  }

  const corpo: Record<string, unknown> = { type: "BODY", text: t.body };
  const quantas = variaveisDoCorpo(t.body);
  if (quantas > 0) {
    // `body_text` é uma lista de LISTAS: uma linha de exemplos por variação. A
    // Meta recusa o formato plano, e o erro não diz isso.
    corpo.example = { body_text: [(t.exemplos ?? []).slice(0, quantas)] };
  }
  componentes.push(corpo);

  if (t.footer?.trim()) {
    componentes.push({ type: "FOOTER", text: t.footer.trim() });
  }

  if (t.botoes?.length) {
    componentes.push({
      type: "BUTTONS",
      buttons: t.botoes.slice(0, 3).map((texto) => ({ type: "QUICK_REPLY", text: texto })),
    });
  }

  return componentes;
}

export async function criarTemplate(input: CriarTemplateInput): Promise<CriarTemplateResult> {
  if (!nomeValido(input.name)) {
    return {
      criado: false,
      motivo: "nome_invalido",
      detalhe: "use só letras minúsculas, números e _ (ex.: mia_primeiro_contato)",
    };
  }

  const quantas = variaveisDoCorpo(input.body);
  if (quantas > 0 && (input.exemplos ?? []).filter((e) => e.trim()).length < quantas) {
    return {
      criado: false,
      motivo: "exemplos_faltando",
      detalhe: `o texto usa ${quantas} variável(is) e a Meta exige um exemplo para cada uma`,
    };
  }

  const url = `${graphBaseUrl(input.graphVersion)}/${input.wabaId}/message_templates`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: input.name,
        language: input.language,
        category: input.category,
        components: componentesDaMeta(input),
      }),
    });
  } catch (err) {
    return {
      criado: false,
      motivo: "api_error",
      detalhe: err instanceof Error ? err.message : String(err),
    };
  }

  const corpo: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const erro = (corpo as { error?: { message?: string; error_user_msg?: string } } | null)?.error;
    return {
      criado: false,
      motivo: "api_error",
      // `error_user_msg` é a frase que a Meta escreveu para humano ler; a outra
      // é a técnica. Preferir a primeira quando existe é a diferença entre o
      // operador entender o que corrigir e abrir chamado.
      detalhe: erro?.error_user_msg ?? erro?.message ?? `HTTP ${res.status}`,
    };
  }

  const ok = corpo as { id?: string; status?: string; category?: string } | null;
  return {
    criado: true,
    id: ok?.id ?? "",
    // Sem `status` a Meta está dizendo "entrou na fila": PENDING é o estado
    // honesto, e o webhook corrige quando ela decidir.
    status: ok?.status ?? "PENDING",
    category: ok?.category ?? input.category,
  };
}
