/**
 * MANDAR ARQUIVO SEM HOSPEDAR ARQUIVO.
 *
 * A Meta aceita mídia de duas formas num envio de template: `{link}` — uma URL
 * que os servidores DELA precisam conseguir baixar — ou `{id}` — um arquivo que
 * já subimos para a conta.
 *
 * O produto só sabia a primeira, e ela cobra um preço escondido: para mandar uma
 * imagem numa campanha, o operador precisa primeiro publicar essa imagem em
 * algum lugar público da internet. Quem não tem site vira refém de um Imgur da
 * vida; quem tem, descobre que a URL do Drive não serve (ela devolve HTML, não
 * a imagem) — e o erro chega como um 131053 sem explicação, depois do disparo.
 *
 * Com `{id}`, o arquivo sai do computador de quem está montando a campanha e vai
 * direto para a conta do WhatsApp. Nada é publicado, nada expira no meio do
 * caminho.
 *
 * ─── O prefixo `meta-media:` ───────────────────────────────────────────────
 *
 * O valor do slot continua sendo UMA string — é um campo de formulário, e
 * mudar isso mexeria em contrato, validação, tela e banco. O que muda é o
 * conteúdo: `meta-media:1234567890` diz "isto é um id, não um endereço".
 *
 * O prefixo já existia no repositório, cunhado pelo `ingest` para a mídia que
 * CHEGA (`media_url: 'meta-media:<id>'`). Reusar a mesma convenção nos dois
 * sentidos é o que evita duas gramáticas para a mesma ideia.
 */

export const PREFIXO_DE_MIDIA = "meta-media:";

/** `meta-media:123` → `123`. Qualquer outra coisa → `null` (é URL, ou lixo). */
export function idDeMidia(valor: string): string | null {
  if (!valor.startsWith(PREFIXO_DE_MIDIA)) return null;
  const id = valor.slice(PREFIXO_DE_MIDIA.length).trim();
  // Id vazio seria pior que URL nenhuma: o envio sairia com `{id: ""}` e a Meta
  // responderia um erro de parâmetro que não menciona mídia em lugar nenhum.
  return id.length > 0 ? id : null;
}

export function comoMidia(valor: string): string {
  return `${PREFIXO_DE_MIDIA}${valor}`;
}

/**
 * O nome que o destinatário vê num documento.
 *
 * Só PDF e afins: imagem e vídeo aparecem pelo conteúdo, e a Meta ignora o
 * campo. Sem ele, um PDF chega ao cliente como "file" ou como o id cru — e um
 * anexo sem nome é um anexo que ninguém abre.
 *
 * Vem grudado no valor porque o slot é uma string só:
 * `meta-media:123|proposta.pdf`.
 */
export function separarNomeDoArquivo(valor: string): { valor: string; filename: string | null } {
  const corte = valor.indexOf("|");
  if (corte < 0) return { valor, filename: null };
  const filename = valor.slice(corte + 1).trim();
  return { valor: valor.slice(0, corte), filename: filename || null };
}

export function comNomeDeArquivo(valor: string, filename: string | null | undefined): string {
  return filename ? `${valor}|${filename}` : valor;
}
