/**
 * FORK MIA (.90) — O QUE UM PLANO PODE LIGAR, e a estimativa de conversas.
 *
 * Os planos e os preços são DADOS (`cobranca_planos`, do upstream, e
 * `mia_plano_modulos`, nosso, migration 9070), criados pelo painel ou pelo MCP.
 * Aqui mora só o que é CÓDIGO: a lista fechada de módulos vendáveis que um
 * plano pode ligar (o par TypeScript do CHECK `mia_plano_modulos_chaves`, vigiado
 * por `tests/unit/planos-mia-vocabulario.test.ts`) e a fórmula que transforma o
 * teto de IA do plano em "cerca de N conversas" — o dólar do teto nunca sai para
 * o cliente (`lib/ai/custo-e-da-plataforma.ts`).
 *
 * Desenho em docs/fork/jornada-de-assinatura.md.
 */

/** Os módulos que um plano liga. Ordem = a da tela (protótipo de 25/10/2026). */
export const MODULOS_DO_PLANO = ["disparador", "email_marketing", "crm_b2b"] as const;
export type ModuloDoPlano = (typeof MODULOS_DO_PLANO)[number];

export function ehModuloDoPlano(chave: string): chave is ModuloDoPlano {
  return (MODULOS_DO_PLANO as readonly string[]).includes(chave);
}

/**
 * O nome e a frase de cada módulo, como a página de preços e a tela do plano os
 * mostram (chaves de `t()`). `crm_b2b` é o módulo DA INSTALAÇÃO do upstream
 * (`MODULO_CRM_B2B`): o plano que o vende só o entrega com ele ligado.
 */
export const ROTULO_DO_MODULO_DO_PLANO: Record<
  ModuloDoPlano,
  { rotulo: string; descricao: string }
> = {
  disparador: {
    rotulo: "Broadcast",
    descricao: "Mensagem para uma lista, pelo número oficial ou pelo QR, com créditos.",
  },
  email_marketing: {
    rotulo: "E-mail marketing",
    descricao: "Campanhas pelo domínio da empresa, com descadastro e supressão.",
  },
  crm_b2b: {
    rotulo: "Vendas B2B",
    descricao: "Pessoas que decidem nas empresas, consulta de CNPJ e importação de planilha.",
  },
};

/** O módulo que só vale com o módulo da instalação ligado (`/admin/sistema`). */
export const MODULO_QUE_EXIGE_A_INSTALACAO: ModuloDoPlano = "crm_b2b";

/**
 * O custo médio de UMA conversa atendida pela IA, em dólar, para a estimativa.
 * É o DOBRO do medido em 29/09/2026 (R$ 0,25 por conversa a R$ 5,22 por dólar),
 * de propósito: a página promete "cerca de", e a régua de verdade é o teto do
 * plano (que para a IA em 100%). Mudar este número muda a promessa de todos os
 * planos de uma vez — é decisão de produto, não ajuste.
 */
export const CUSTO_ESTIMADO_POR_CONVERSA_USD = 0.048;

/**
 * "Cerca de N conversas atendidas pela IA por mês", a partir do teto de IA do
 * plano (centavos de dólar, a moeda de `fn_gasto_de_ia_do_mes`). Arredonda de 50
 * em 50, a fórmula do protótipo aprovado. `null` = plano sem teto (sem limite).
 */
export function conversasEstimadas(tetoIaUsdCents: number | null): number | null {
  if (tetoIaUsdCents === null || !Number.isFinite(tetoIaUsdCents)) return null;
  return Math.round(tetoIaUsdCents / 100 / CUSTO_ESTIMADO_POR_CONVERSA_USD / 50) * 50;
}

/**
 * O "?plano=" que a página de preços (e o site) põe no link do cadastro: o nome
 * do plano sem acento, em minúsculas e com hífen. Derivado do nome, e não
 * guardado: arquivar um plano e criar outro com o mesmo nome (o caminho do
 * upstream para mudar preço) mantém o link do site funcionando.
 */
export function slugDoPlano(nome: string): string {
  return (
    nome
      .normalize("NFD")
      // Tira os acentos: no NFD eles viram as marcas combinantes U+0300 a U+036F.
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
  );
}

/** Uso de IA do mês em % do incluído, para o cliente. `null` = sem teto. Nunca negativo. */
export function percentualDaIa(gastoUsdCents: number, tetoUsdCents: number | null): number | null {
  if (tetoUsdCents === null || tetoUsdCents <= 0) return null;
  return Math.max(0, Math.round((gastoUsdCents / tetoUsdCents) * 100));
}

/** O limiar do aviso, o mesmo da rodada do upstream (`LIMIAR_DO_AVISO_DE_IA`, 80%). */
export const AVISO_DA_IA_EM_PERCENTUAL = 80;
