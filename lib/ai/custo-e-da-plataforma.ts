/**
 * QUANTO A IA CUSTA É NÚMERO DA PLATAFORMA, NÃO DO CLIENTE.
 *
 * Decisão desta instalação (Time Company, 15/09/2026), e diferente do desenho do
 * produto — onde a organização vê o próprio gasto e escolhe o próprio teto.
 *
 * Aqui a conta do provedor é paga por quem opera a plataforma, e o cliente
 * contrata atendimento, não tokens. Mostrar o custo para ele seria mostrar a
 * margem: é o preço de custo da coisa que ele está comprando. Por isso a tela
 * "Uso e orçamento" sai do menu do cliente e o valor em dinheiro é retirado das
 * respostas da API — não escondido no componente, que qualquer devtools abre.
 *
 * O QUE CONTINUA VISÍVEL PARA O CLIENTE: tempo de resposta, número de
 * atendimentos, status e erros em linguagem dele.
 *
 * TOKENS SAÍRAM TAMBÉM (pedido de 25/11/2026, MIA-262). Até a .117 este
 * comentário dizia que tokens ficavam de propósito, como medidor do pacote.
 * O pedido "consumo de uso da IA é tudo admin" muda isso: o medidor do cliente
 * passa a ser o USO DO PLANO (Configurações › Plano e cobrança), em conversas e
 * em % do incluído, e não tokens. Junto com tokens saem o provedor, o modelo e
 * o texto cru do erro do provedor (`semIaDaPlataforma`, abaixo).
 *
 * Quem enxerga dinheiro é o admin de plataforma (`/admin`), e lá o número é por
 * tenant. `support` fica de fora: uma sessão de acompanhamento entra na conta do
 * cliente para ajudar, e não para ver o custo dela.
 */
import type { AuthUser } from "@/lib/auth/types";

export function podeVerCusto(user: Pick<AuthUser, "is_platform_admin" | "support">): boolean {
  return user.is_platform_admin === true && !user.support;
}

/**
 * A CHAVE segue a mesma regra do CUSTO, e pelo mesmo motivo.
 *
 * Se o cliente contrata atendimento e não tokens, pedir a chave da OpenAI a ele
 * no onboarding contradiz o que ele comprou — e entrega, de quebra, uma
 * configuração que ele não tem como resolver: quando falta chave numa
 * instalação gerenciada, quem precisa agir somos nós, no `/admin`. Mostrar o
 * campo ali transforma uma pendência nossa em dever de casa do cliente, e a
 * tela fica oferecendo um beco.
 *
 * O ponteiro da instalação (`origem: "instalacao"`) é ainda pior de expor: são
 * os últimos dígitos da NOSSA chave e o estado de crédito da NOSSA conta,
 * dentro da tela de quem comprou atendimento.
 *
 * Quem continua vendo é o admin de plataforma — e é ele quem instala num
 * self-host, então o caminho de quem roda por conta própria não se perde.
 * `support` fica de fora pela mesma razão do custo: acompanhar não é operar.
 *
 * Escolher a chave é ESCREVER. Desde a 1.70 do upstream, "o admin de plataforma
 * pode escrever?" é UMA função (`escreveComoPlatformAdmin`, lib/auth/types.ts),
 * e o `support_readonly` não escreve: ele lê o painel e não escolhe a IA de
 * ninguém. Aqui a recusa é pelo scope de leitura, e não pela exigência de
 * `full`, porque o scope ausente é o `full` (o default da coluna
 * `platform_admins.scope`), e quem chama nem sempre o carrega.
 */
export function podeConfigurarChaveDeIa(
  user: Pick<AuthUser, "is_platform_admin" | "platform_admin_scope" | "support">,
): boolean {
  return (
    user.is_platform_admin === true &&
    !user.support &&
    user.platform_admin_scope !== "support_readonly"
  );
}

/**
 * Apaga o custo de cada linha quando quem pede não é da plataforma. Devolve
 * `null` (o mesmo valor que "preço desconhecido" já produzia), e não zero: a
 * tela existente esconde a linha de custo quando é nulo, e um zero ali diria
 * "custou nada", que é a mentira que este fork está justamente consertando.
 */
export function semCusto<T extends { cost_cents?: number | string | null }>(
  linhas: T[],
  visivel: boolean,
): T[] {
  if (visivel) return linhas;
  return linhas.map((linha) => ({ ...linha, cost_cents: null }));
}

/**
 * FORK MIA (MIA-262) — O CÉREBRO E O CONSUMO TAMBÉM SÃO DA PLATAFORMA.
 *
 * O mesmo `semCusto`, para o resto do que o cliente deixou de ver: qual
 * provedor e qual modelo responderam, quantos tokens gastaram, o preço do
 * catálogo e o texto cru que o provedor devolveu num erro (que traz o id do
 * modelo e, às vezes, o estado da NOSSA conta). Sai na resposta da API, com o
 * mesmo `null` do custo: as telas do upstream já escondem o que chega vazio, e
 * nas poucas que não escondiam a linha marcada `FORK MIA (MIA-262)` esconde.
 *
 * Quem vê tudo é quem vê custo (`podeVerCusto`): o admin da plataforma fora de
 * suporte. A sessão de suporte, até a da plataforma com edição, fica de fora,
 * como no custo: ela entra para ajudar no atendimento, e o consumo da empresa
 * está na aba Uso do `/admin`.
 */
export const CAMPOS_DA_IA_DA_PLATAFORMA = [
  "provider",
  "model",
  "provedorRotulo",
  "input_tokens",
  "output_tokens",
  "tokens_in",
  "tokens_out",
  "cost_cents",
  "error_message",
  "http_status",
] as const;

/** O preço por milhão de tokens do catálogo `ai_models`. É o nosso custo. */
export const CAMPOS_DO_PRECO = [
  "input_price_per_million_cents",
  "output_price_per_million_cents",
] as const;

/**
 * Devolve uma CÓPIA de `linha` com cada campo de `campos` que existe nela
 * trocado por `null`. Campo que a linha não tem não é criado.
 */
export function semCampos<T extends object>(linha: T, campos: readonly string[]): T {
  const copia: Record<string, unknown> = { ...(linha as Record<string, unknown>) };
  for (const campo of campos) if (campo in copia) copia[campo] = null;
  return copia as T;
}

/** `semCampos` em cada linha, só quando quem pede não vê (`visivel = false`). */
export function semIaDaPlataforma<T extends object>(
  linhas: readonly T[],
  visivel: boolean,
  campos: readonly string[] = CAMPOS_DA_IA_DA_PLATAFORMA,
): T[] {
  if (visivel) return [...linhas];
  return linhas.map((linha) => semCampos(linha, campos));
}

/**
 * FORK MIA (MIA-262) — O DÓLAR DA IA NA AUDITORIA DA EMPRESA.
 *
 * O Audit Log da empresa (gerente para cima) mostra o `metadata` de cada
 * evento. A análise do Histórico em Conexões grava ali a estimativa, o gasto do
 * mês e o teto em centavos de dólar. O evento continua gravado inteiro (a
 * plataforma lê no `/admin`); quem não vê custo recebe a linha sem essas
 * chaves. A lista é fechada de propósito: `preco_cents` de disparo e o saldo de
 * créditos são o dinheiro do CLIENTE, e ficam.
 */
export const CHAVES_DE_CUSTO_NA_AUDITORIA = [
  "estimativa_cents",
  "gasto_ate_aqui_cents",
  "gasto_do_mes_cents",
  "teto_mensal_cents",
  "cost_cents",
] as const;

export function semCustoNaAuditoria<T extends { metadata?: unknown }>(
  linhas: readonly T[],
  visivel: boolean,
): T[] {
  if (visivel) return [...linhas];
  return linhas.map((linha) => {
    const metadata = linha.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return linha;
    const limpo: Record<string, unknown> = { ...(metadata as Record<string, unknown>) };
    let mudou = false;
    for (const chave of CHAVES_DE_CUSTO_NA_AUDITORIA) {
      if (chave in limpo) {
        delete limpo[chave];
        mudou = true;
      }
    }
    return mudou ? { ...linha, metadata: limpo } : linha;
  });
}
