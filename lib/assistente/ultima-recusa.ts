/**
 * FORK MIA (.88) — a ÚLTIMA RECUSA DO SERVIDOR que esta aba viu: a "mensagem do
 * sistema" que o assistente junta ao chamado e confere antes de abrir um Erro.
 *
 * Quando a pessoa diz "o botão de salvar não funciona", a mensagem vermelha que
 * apareceu ("Informe o valor do negócio") é o que separa defeito de campo
 * faltando. O cliente de API (`lib/api/client.ts`) anota aqui cada recusa com
 * código e mensagem, numa linha marcada FORK MIA, e o painel do assistente lê
 * ao perguntar. Fica só na memória da aba: nada vai a lugar nenhum sem a
 * pessoa perguntar ao assistente.
 *
 * Módulo do navegador e PURO (sem `window`): o servidor nunca o importa com
 * efeito, e o teste o exercita sem DOM.
 */
export interface RecusaVista {
  mensagem: string | null;
  codigo: string | null;
  status: number | null;
  /** O caminho da API que recusou, sem query string. */
  rota: string | null;
  quando: number;
}

let ultima: RecusaVista | null = null;

/** As rotas do próprio assistente não contam: a recusa dele não é "a mensagem da tela". */
const DO_ASSISTENTE = /^\/api\/v1\/assistente\//;

export function anotarRecusaDoServidor(r: {
  mensagem?: string | null;
  codigo?: string | null;
  status?: number | null;
  rota?: string | null;
}): void {
  const rota = typeof r.rota === "string" ? (r.rota.split("?")[0] ?? null) : null;
  if (rota && DO_ASSISTENTE.test(rota)) return;
  const mensagem = typeof r.mensagem === "string" ? r.mensagem.trim().slice(0, 300) : null;
  ultima = {
    mensagem: mensagem || null,
    codigo: typeof r.codigo === "string" ? r.codigo.slice(0, 80) : null,
    status: typeof r.status === "number" ? r.status : null,
    rota,
    quando: Date.now(),
  };
}

/** A recusa dos últimos minutos, ou `null`: a de uma hora atrás não é "o que acabou de aparecer". */
export function ultimaRecusaDoServidor(agora = Date.now(), idadeMaximaMs = 10 * 60_000): RecusaVista | null {
  if (!ultima) return null;
  return agora - ultima.quando <= idadeMaximaMs ? ultima : null;
}

/** Só para teste. */
export function esquecerRecusas(): void {
  ultima = null;
}
