/**
 * FORK MIA (.89) — a RECUSA do disparo de e-mail: o código, a frase e o status
 * HTTP. As rotas a traduzem em `fail(...)`; o MCP de plataforma, na mensagem da
 * ferramenta. A mesma frase nos dois lugares: o que a tela recusa, a ferramenta
 * recusa, dizendo o mesmo.
 */
export class RecusaDaCampanha extends Error {
  constructor(
    public readonly codigo: string,
    mensagem: string,
    public readonly status = 422,
    public readonly detalhes?: unknown,
  ) {
    super(mensagem);
    this.name = "RecusaDaCampanha";
  }
}
