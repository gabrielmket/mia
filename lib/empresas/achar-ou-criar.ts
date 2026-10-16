/**
 * A EMPRESA QUE O CLIENTE DISSE — achar a que já existe, ou criar uma.
 *
 * O agente pergunta "de qual empresa você é?" e recebe texto livre: "Padaria do
 * Zé", "padaria do ze", "PADARIA DO ZÉ LTDA". Se cada resposta virasse uma
 * empresa nova, a entidade perderia a única coisa que a justifica — poder
 * perguntar quanto já vendemos para AQUELE cliente.
 *
 * ─── Por que o casamento é frouxo, e por que isso é seguro aqui ───────────
 *
 * A comparação ignora caixa, acento, pontuação e sufixo societário. É frouxa de
 * propósito: o custo de errar para cada lado é MUITO diferente.
 *
 *  • Frouxo demais junta duas empresas parecidas. O operador vê as duas na
 *    ficha, percebe, e separa — o histórico está todo lá.
 *  • Rígido demais cria "Padaria do Zé" pela quinta vez. Ninguém percebe,
 *    porque cinco fichas com uma conversa cada parecem cinco clientes — e a
 *    pergunta agregada passa a responder errado para sempre.
 *
 * ⚠️ O que NÃO se faz aqui: casar por CNPJ. O cliente não dita CNPJ numa
 * conversa de WhatsApp, e um número mal ouvido pelo modelo viraria vínculo
 * errado com aparência de precisão.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { gravarEmpresa, lerTodasAsEmpresas, nomeDaEmpresa } from "@/lib/empresas/fonte-unica";
import { nomeComparavel } from "@/lib/empresas/nome-comparavel";
import { pareceAMesma } from "@/lib/empresas/parecida";
import { logger } from "@/lib/logger";

export { nomeComparavel };

export type ResultadoDaEmpresa =
  | { ok: true; empresaId: string; criada: boolean; nome: string; parecida?: boolean }
  | { ok: false; motivo: "nome_curto" | "erro"; detalhe?: string };

/**
 * FORK MIA (.79, empresa única): lê e grava no cadastro único (`companies`,
 * docs/fork/empresa-unica.md), e não mais em `crm_empresas`.
 *
 * A ordem do casamento, do mais forte ao mais frouxo:
 *
 *  1. o nome comparável IGUAL (o de sempre);
 *  2. o nome PARECIDO (`pareceAMesma`, a régua do protótipo aprovado em
 *     15/10/2026): "o agente sempre usa a existente". A tela avisa e deixa a
 *     pessoa escolher; o agente não tem a quem perguntar, e criar a segunda
 *     ficha é o erro que ninguém vê. Com mais de uma parecida, fica a mais
 *     antiga, que é a que mais história tem.
 *
 * Só depois disso a empresa é criada, pela porta `fn_mia_gravar_empresa` (9034),
 * a mesma da tela: atendente e agente podem criar.
 */
export async function acharOuCriarEmpresa(
  db: SupabaseClient,
  organizationId: string,
  nomeDito: string,
): Promise<ResultadoDaEmpresa> {
  const nome = nomeDito.trim();
  const comparavel = nomeComparavel(nome);
  /**
   * Nome de uma letra ou dois caracteres não identifica empresa nenhuma, e
   * viraria uma ficha que ninguém consegue procurar depois. Recusar é melhor
   * que criar lixo que o operador terá de limpar sem saber de onde veio.
   */
  if (comparavel.length < 3) return { ok: false, motivo: "nome_curto" };

  try {
    // Lê a lista da organização e compara em memória: a normalização (acento,
    // sufixo societário) não existe em SQL sem `unaccent`, e a lista de
    // empresas de um tenant é pequena — quem tiver dez mil pede um índice
    // funcional, não um `ilike` que erraria justamente nos acentuados.
    const lidas = await lerTodasAsEmpresas(db, organizationId, "id, trade_name, legal_name, normalized_cnpj, created_at");
    if (lidas.erro) return { ok: false, motivo: "erro", detalhe: lidas.erro };

    const empresas = lidas.linhas.map((l) => ({ id: l.id, nome: nomeDaEmpresa(l), criadaEm: l.created_at ?? "" }));
    const existente = empresas.find((e) => nomeComparavel(e.nome) === comparavel);
    if (existente) {
      return { ok: true, empresaId: existente.id, criada: false, nome: existente.nome };
    }
    const parecida = empresas
      .filter((e) => pareceAMesma(nome, e.nome))
      .sort((a, b) => a.criadaEm.localeCompare(b.criadaEm))[0];
    if (parecida) {
      return { ok: true, empresaId: parecida.id, criada: false, nome: parecida.nome, parecida: true };
    }

    /**
     * Não achou, e a lista passou do teto: NÃO cria.
     *
     * "Não está entre as que li" não prova "não existe", e criar aqui seria o
     * mesmo defeito de antes, só que a partir da 5001ª empresa. Recusar é
     * visível (a ferramenta do agente responde "não consegui registrar" e a
     * falha fica auditada); a ficha repetida não é.
     */
    if (lidas.truncado) {
      logger.error("[empresas] lista acima do teto de leitura: empresa não criada para não repetir ficha", {
        organization_id: organizationId,
        lidas: lidas.linhas.length,
      });
      return { ok: false, motivo: "erro", detalhe: "lista de empresas acima do teto de leitura" };
    }

    // O nome vai como a pessoa DISSE. O comparável serve para achar, não para guardar.
    const gravada = await gravarEmpresa(db, organizationId, null, { nome });
    if (!gravada.ok) return { ok: false, motivo: "erro", detalhe: gravada.detalhe ?? gravada.motivo };
    return { ok: true, empresaId: gravada.id, criada: true, nome };
  } catch (err) {
    return {
      ok: false,
      motivo: "erro",
      detalhe: err instanceof Error ? err.message : "erro",
    };
  }
}
