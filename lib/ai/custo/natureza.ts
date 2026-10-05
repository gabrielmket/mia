/**
 * AS DUAS NATUREZAS DE GASTO DE IA — e por que somá-las esconde a decisão.
 *
 * Um número só ("a IA custou X") responde à pergunta errada. O que decide preço
 * é a separação:
 *
 *  • ATENDIMENTO — a IA gastou porque um cliente escreveu. Varia com o volume de
 *    conversa, dá para dividir por conversa e é o que um plano por conversa ou
 *    por pacote mensal cobra. Entram aqui o turno que responde, o que trabalha o
 *    funil junto, e os auxiliares que rodam DENTRO do turno: classificar etapa,
 *    barrar promessa e manipulação, comprimir memória, ouvir áudio, ver imagem,
 *    buscar no material do negócio.
 *
 *  • SISTEMA — a IA gastou porque a operação pediu, com ou sem cliente na linha:
 *    o agente se avaliando (flywheel), ensaio de versão, teste de conexão,
 *    contagem de tokens, indexação do acervo. Não varia com a conversa de um
 *    cliente e não cabe num preço por conversa; é custo de operar a plataforma.
 *
 * ── Por que não derivar direto do `papel` do registro ─────────────────────────
 *
 * `PapelDeIa` agrupa por FUNÇÃO ("atender", "melhorar") para explicar a tela de
 * provedores a quem não é engenheiro. É quase a divisão certa, e o "quase" é o
 * problema: `agent_preview` tem papel "atender" e é ensaio — roda quando alguém
 * testa o agente, não quando um cliente escreve. Contado como atendimento, ele
 * entraria no custo por conversa de um dia em que ninguém conversou.
 * `embedding_indexar` é o simétrico: papel "lembrar", mas indexar o acervo
 * acontece quando se sobe material, e não durante uma conversa.
 *
 * Por isso a classificação é explícita, ponto a ponto — e
 * `tests/unit/natureza-do-gasto.test.ts` reprova se um ponto novo entrar no
 * registro sem cair de um lado: sem isso ele viraria, calado, "sistema" ou
 * "atendimento" por acidente do default, e o custo por conversa mentiria.
 */
import { PONTOS_DE_IA } from "@/lib/ai/pontos/registro";

export type NaturezaDoGasto = "atendimento" | "sistema";

/** O que a operação pediu — o resto do registro é atendimento. */
const DO_SISTEMA = new Set<string>([
  // O agente julgando e destilando os próprios turnos (cron do flywheel): o
  // custo é carimbado no dia em que o cron roda, e não no da conversa julgada.
  "flywheel_judge",
  "flywheel_distiller",
  // Ensaio e diagnóstico feitos por gente da operação.
  "agent_preview",
  "teste_de_agente",
  "connection_test",
  "contagem_de_tokens",
  // Indexar o acervo acontece ao subir material, não durante a conversa.
  // (Consultar o acervo, esse sim, roda dentro do turno e fica em atendimento.)
  "embedding_indexar",
  // Configurar por conversa com o administrador: montar agente de campanha e
  // transformar a proposta da empresa em modelo. É preparo, igual a subir
  // material — não há cliente na linha.
  "prospecting_agent_setup_chat",
  "proposal_template_import",
  // Ferramentas da EQUIPE, disparadas por um clique de gente da operação e não
  // por mensagem do cliente: ajustar a proposta por instrução, preenchê-la lendo
  // a conversa, perguntar sobre um caso escalado. Acontecem num dia em que o
  // cliente não escreveu — e `case_chat` carimba o contato do caso, então como
  // atendimento ele criaria uma "conversa" que não existiu.
  // (`flow_validate`, ao contrário, roda dentro do turno a cada resposta do
  // cliente ao fluxo e fica em atendimento.)
  "proposal_assistant",
  "proposal_fill_from_conversation",
  "case_chat",
  // Ler o valor da venda na conversa (upstream 1.70): roda no dreno de eventos
  // quando um negócio vindo de anúncio é GANHO sem valor, para a compra seguir
  // à Meta. Varia com venda fechada, não com mensagem do cliente, e acontece no
  // dia do ganho, que pode ser um dia sem conversa nenhuma.
  "conversion_value_from_conversation",
]);

/**
 * Um `purpose` gravado em `llm_calls` pode não estar no registro — instalação
 * mais velha que o catálogo, ou ponto renomeado. Nesse caso a linha vai para
 * `sistema`, a escolha CONSERVADORA: o custo continua na conta total da
 * plataforma, e não infla o preço por conversa que se cobra de um cliente.
 */
export function naturezaDoGasto(purpose: string): NaturezaDoGasto {
  if (DO_SISTEMA.has(purpose)) return "sistema";
  return CONHECIDOS.has(purpose) ? "atendimento" : "sistema";
}

const CONHECIDOS = new Set<string>(PONTOS_DE_IA.map((p) => p.id));

/** Os pontos classificados como sistema — para o teste de completude e para a tela. */
export const PONTOS_DO_SISTEMA: readonly string[] = [...DO_SISTEMA];

export interface LinhaDeGasto {
  purpose: string;
  cost_cents: number | string | null;
  contact_id?: string | null;
}

export interface GastoSeparado {
  /** Centavos de DÓLAR, como `llm_calls.cost_cents` (ver lib/money.ts). */
  atendimentoCents: number;
  sistemaCents: number;
  totalCents: number;
  /** Quantas conversas distintas geraram gasto de atendimento na janela. */
  conversas: number;
  /** Custo médio por conversa, em centavos de dólar. Nulo sem conversa. */
  porConversaCents: number | null;
  /** Linhas sem preço conhecido — a medição está incompleta se for > 0. */
  semPreco: number;
}

/**
 * Separa as duas naturezas e divide o atendimento pelas conversas que o
 * causaram. `contact_id` é o que `llm_calls` tem de mais próximo de "conversa"
 * — um contato tem uma conversa por canal, e é assim que o produto inteiro fala
 * com o cliente. Linha de atendimento SEM contato (um auxiliar que rodou sem
 * carimbar o contato) entra no custo, mas não cria conversa: inflaria o
 * denominador com uma conversa que não existiu.
 */
export function separarGasto(linhas: readonly LinhaDeGasto[]): GastoSeparado {
  let atendimentoCents = 0;
  let sistemaCents = 0;
  let semPreco = 0;
  const contatos = new Set<string>();

  for (const linha of linhas) {
    // `cost_cents` é `numeric`: o driver devolve string, e `+ '12.5'` concatena
    // em silêncio — o modo de falha que a rota de evolução já documenta.
    const valor = linha.cost_cents === null || linha.cost_cents === undefined ? null : Number(linha.cost_cents);
    if (valor === null || Number.isNaN(valor)) semPreco++;
    const cents = valor ?? 0;
    if (naturezaDoGasto(linha.purpose) === "sistema") {
      sistemaCents += cents;
      continue;
    }
    atendimentoCents += cents;
    if (linha.contact_id) contatos.add(linha.contact_id);
  }

  const conversas = contatos.size;
  return {
    atendimentoCents,
    sistemaCents,
    totalCents: atendimentoCents + sistemaCents,
    conversas,
    porConversaCents: conversas > 0 ? atendimentoCents / conversas : null,
    semPreco,
  };
}
