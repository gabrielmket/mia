/**
 * FORK MIA (MIA-304) — A PROSPECÇÃO RESPONDE SEM O NOME DO MODELO.
 *
 * O upstream leva o `model_label` (o nome do modelo de IA que montou o agente)
 * por todo o fluxo de "criar agente por conversa": na resposta do chat, na
 * sessão salva da campanha (`session.model_label`, `session.prepared`,
 * `session.completed`) e no resultado de preparar e publicar. Na MIA a IA é da
 * plataforma e o cliente não vê provedor nem modelo (MIA-251,
 * `docs/fork/ia-da-plataforma.md`, seção 7). A tela já não mostra o rótulo
 * desde a MIA-262; aqui ele sai da RESPOSTA, para não chegar ao navegador.
 *
 * Sai na fronteira, e não no núcleo: o rótulo continua gravado como o upstream
 * grava (`ai_agents.config.prospecting_setup`, `prospecting_campaigns.agent_setup`)
 * e nenhuma conta da preparação muda. Nenhuma tela lê o campo.
 *
 * Vale para todo papel. As quatro rotas pedem admin DA EMPRESA; a plataforma só
 * chega a elas em modo suporte e também não precisa do rótulo (o modelo de cada
 * empresa está no MCP de plataforma, `plataforma_ver_ia_das_empresas`).
 *
 * Cerca: `tests/unit/prospeccao-sem-modelo-ao-cliente.test.ts` (toda rota de
 * `app/api/v1/prospecting/agents/` passa por aqui, e papel por papel o campo
 * não volta).
 */

const CAMPO = "model_label";

export type SemModeloAoCliente<T> = T extends readonly (infer U)[]
  ? SemModeloAoCliente<U>[]
  : T extends object
    ? { [K in keyof T as K extends typeof CAMPO ? never : K]: SemModeloAoCliente<T[K]> }
    : T;

/**
 * Cópia da resposta sem `model_label` em nenhum nível (o resultado, a sessão,
 * o `prepared` e o `completed` da sessão). O objeto original não é tocado.
 */
export function semModeloAoCliente<T>(resposta: T): SemModeloAoCliente<T> {
  return limpar(resposta) as SemModeloAoCliente<T>;
}

function limpar(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(limpar);
  if (!valor || typeof valor !== "object" || Object.getPrototypeOf(valor) !== Object.prototype) return valor;
  const limpo: Record<string, unknown> = {};
  for (const [chave, v] of Object.entries(valor)) {
    if (chave === CAMPO) continue;
    limpo[chave] = limpar(v);
  }
  return limpo;
}
