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
 * O QUE CONTINUA VISÍVEL PARA O CLIENTE, de propósito: tokens, tempo de resposta,
 * número de atendimentos e erros. Consumo não é preço, e é justamente o que vira
 * medidor quando o plano passar a ser por conversa ou por pacote mensal — o
 * cliente precisa enxergar o que gastou do pacote dele sem enxergar o que isso
 * custou a nós.
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
