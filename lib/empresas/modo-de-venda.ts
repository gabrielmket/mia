/**
 * B2B ou B2C: a organização vende para EMPRESA ou para PESSOA? (item C2)
 *
 * ── O que isto resolve ────────────────────────────────────────────────────
 *
 * A entidade empresa (migrations 0255, 0262, 0263) serve quem vende para
 * empresa: agrupa contatos e negócios sob um CNPJ, responde "quem é o decisor",
 * e faz a IA anotar onde a pessoa trabalha.
 *
 * Para uma academia, uma clínica ou um salão, nada disso existe. A cliente é a
 * pessoa. Ali a entidade vira uma aba que ninguém abre, um campo em branco em
 * todo cadastro, e — o pior — uma IA que pergunta "de qual empresa você é?" a
 * alguém que quer marcar uma aula experimental.
 *
 * A pergunta errada de um agente é mais cara que uma tela sobrando: a tela o
 * operador ignora; a pergunta o CLIENTE lê, e ela denuncia um robô que não
 * entendeu o negócio.
 *
 * ── Por que `b2b` é o padrão ──────────────────────────────────────────────
 *
 * Porque é o que NÃO tira nada de ninguém. Toda organização que existe hoje
 * enxerga a entidade empresa, e um deploy que a escondesse por padrão sumiria
 * com uma tela sem ninguém pedir — e sumir é o tipo de mudança que o usuário
 * não reporta, ele só deixa de achar. Tela sobrando é ruído visível, e ruído
 * visível alguém reclama.
 *
 * Na prática isso significa que as organizações B2C precisam ser marcadas uma a
 * uma, e é a troca certa: um clique por cliente, contra o risco de esconder
 * algo de quem usava.
 *
 * ── Por que mora em `settings`, e não numa coluna ─────────────────────────
 *
 * `organizations.settings` já carrega `visibility_mode` pelo mesmo motivo: é
 * preferência de como a organização usa o produto, não fato do domínio. O
 * layout de `/app` já lê `settings` numa consulta que existe de qualquer jeito,
 * então o modo chega ao menu sem nenhuma ida a mais ao banco.
 *
 * ⚠️ ISTO NÃO É AUTORIZAÇÃO. É insumo de INTERFACE — como `modulos`. As rotas de
 * `/api/v1/empresas` continuam atendendo uma organização B2C que as chame: o
 * modo esconde a porta, não tranca. Tratar preferência de tela como permissão
 * é o erro que transforma "não uso isso" em "perdi meus dados".
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type ModoDeVenda = "b2b" | "b2c";

/** O padrão. Ver o bloco acima: o que não tira nada de ninguém. */
export const MODO_PADRAO: ModoDeVenda = "b2b";

/**
 * Lê o modo de `organizations.settings`, aceitando ausência e lixo.
 *
 * Valor desconhecido cai no padrão em vez de lançar: um `settings` editado à
 * mão com `"B2C"` (maiúsculo) ou `"pf"` não pode derrubar o layout inteiro de
 * `/app` — o produto continua servindo, mostrando de mais, que é o lado seguro.
 */
export function lerModoDeVenda(settings: unknown): ModoDeVenda {
  if (!settings || typeof settings !== "object") return MODO_PADRAO;
  const bruto = (settings as { modo_de_venda?: unknown }).modo_de_venda;
  return bruto === "b2c" || bruto === "b2b" ? bruto : MODO_PADRAO;
}

/**
 * A organização enxerga a entidade empresa?
 *
 * Uma função e não `modo === "b2b"` espalhado: a pergunta é "mostra empresa?", e
 * quem lê o chamador não precisa saber que B2B é o modo que mostra. Se um dia
 * aparecer um terceiro modo, ele se decide aqui, uma vez.
 */
export function mostraEmpresas(modo: ModoDeVenda | undefined): boolean {
  return (modo ?? MODO_PADRAO) === "b2b";
}

/**
 * A tela que some no modo B2C.
 *
 * Uma constante e não a string solta nos chamadores: é o mesmo `href` do
 * catálogo de navegação, e duas cópias divergem na primeira vez que a rota for
 * renomeada — com o sintoma sendo a tela VOLTANDO a aparecer para quem não a
 * quer, em silêncio. É o mesmo cuidado que `MODULOS[].telas` já documenta.
 */
export const TELA_DE_EMPRESAS = "/app/empresas";

/**
 * Lê o modo direto do banco, para quem não tem o `activeOrg` enriquecido.
 *
 * O layout de `/app` põe o modo no contexto, e é de lá que o menu o pega. As
 * páginas de HUB (`/app/crm`, `/app/ai`, …) resolvem a organização por conta
 * própria — `resolveActiveOrg` devolve o vínculo, não as preferências — então
 * precisam desta leitura.
 *
 * Fica neste arquivo, e não num `liberacao.ts` ao lado como fazem os módulos,
 * porque são dez linhas sem regra nenhuma: a decisão toda está em
 * `lerModoDeVenda`, que continua pura e é o que os testes exercitam.
 *
 * Erro de leitura devolve o padrão. Não é otimismo: é a mesma regra do resto
 * deste arquivo — na dúvida o produto mostra de mais, porque esconder por não
 * saber tira a tela de quem a usa.
 */
export async function modoDeVendaDaOrganizacao(
  db: SupabaseClient,
  organizationId: string,
): Promise<ModoDeVenda> {
  const { data, error } = await db
    .from("organizations")
    .select("settings")
    .eq("id", organizationId)
    .maybeSingle();
  if (error || !data) return MODO_PADRAO;
  return lerModoDeVenda((data as { settings?: unknown }).settings);
}

/**
 * As capacidades de agente que só existem para quem vende para EMPRESA.
 *
 * ⚠️ Este é o item mais caro do C2, e não é a aba nem o campo. Uma capacidade
 * ligada faz a IA PERGUNTAR — e "de qual empresa você é?" mandado a alguém que
 * quer marcar uma aula experimental não é ruído de tela: é o cliente lendo um
 * robô que não entendeu o negócio. A tela sobrando o operador ignora; a
 * pergunta errada chega ao WhatsApp de quem paga.
 *
 * Some da lista que a tela de capacidades oferece quando a organização é B2C.
 * NÃO é revogação: um agente que já a tenha ligada continua com ela — tirar
 * capacidade de agente publicado por causa de uma preferência de cadastro
 * mudaria o comportamento de uma conversa em andamento, e isso é decisão de
 * quem opera, não efeito colateral de um clique em outra tela.
 */
export const CAPACIDADES_DE_EMPRESA: readonly string[] = [
  "crm_registrar_empresa_do_contato",
];
