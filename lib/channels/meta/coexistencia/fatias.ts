/**
 * FORK MIA · coexistência (S3): os ids vão ao banco EM FATIAS.
 *
 * O PostgREST leva o `.in(...)` na URL. Mil uuids passam de 37 KB e estouram o
 * limite da linha da requisição, e a tabela "Coexistência por empresa" de
 * /admin/meta quebraria sem erro claro. Por isso `chave.ts` e `leitura.ts`
 * mandam no máximo `IDS_POR_CONSULTA` ids por consulta (pedido do Revisor na
 * MIA-65; cerca em `tests/unit/coexistencia-ids-em-fatias.test.ts`).
 */
export const IDS_POR_CONSULTA = 100;

/** Os ids sem repetição, em fatias de no máximo `IDS_POR_CONSULTA`. */
export function emFatias(ids: Iterable<string>, tamanho: number = IDS_POR_CONSULTA): string[][] {
  const unicos = [...new Set(ids)];
  const fatias: string[][] = [];
  for (let i = 0; i < unicos.length; i += tamanho) fatias.push(unicos.slice(i, i + tamanho));
  return fatias;
}
