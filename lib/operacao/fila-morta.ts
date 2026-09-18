/**
 * O TRABALHO QUE MORREU — agrupado pela CAUSA, não pela vítima.
 *
 * Um job morto é um lead que escreveu e não foi respondido. Eles não morrem de
 * um em um: morrem em rajada, todos pelo mesmo motivo — o rate limit do
 * provedor, a chave que expirou, o número que caiu. Caso real desta instalação
 * (31/08/2026): 49 jobs mortos em poucos segundos, TODOS por TPM da OpenAI, e
 * 49 alertas críticos idênticos na Central.
 *
 * Uma lista de 49 linhas idênticas não é informação: é a mesma informação 49
 * vezes, e o operador precisa lê-la 49 vezes para descobrir que é uma coisa só.
 * Por isso a tela agrupa por causa, e o botão de reprocessar age no GRUPO —
 * quem consertou o rate limit quer devolver os 49 à fila de uma vez.
 *
 * ─── Por que normalizar o erro ─────────────────────────────────────────────
 *
 * `last_error` traz id de requisição, timestamp e nome de modelo: dois jobs
 * mortos pelo MESMO motivo têm textos diferentes. Agrupar pelo texto cru daria
 * 49 grupos de um — a lista que se queria evitar, com um passo a mais.
 */

/** Quanto do erro sobrevive à normalização, para o grupo ainda ser legível. */
const TETO = 180;

/**
 * A ASSINATURA da falha: o que resta do erro depois de tirar o que muda a cada
 * tentativa. É ela que junta a rajada num grupo só.
 *
 * Conservadora de propósito: só apaga o que é PROVADAMENTE volátil (números,
 * ids, datas, aspas). Apagar demais juntaria causas diferentes no mesmo grupo,
 * e aí o operador reprocessaria 40 jobs consertando o problema de 12.
 */
export function assinaturaDoErro(erro: string | null | undefined): string {
  if (!erro) return "sem_motivo_registrado";
  return (
    erro
      .toLowerCase()
      // Datas ISO e horários — mudam a cada tentativa, nunca identificam a causa.
      .replace(/\d{4}-\d{2}-\d{2}t?[\d:.]*z?/g, "<data>")
      // Ids opacos (uuid, req_..., chatcmpl-...): o que o provedor carimba por chamada.
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, "<id>")
      .replace(/\b(req|chatcmpl|msg|call)[-_][a-z0-9]{6,}\b/g, "<id>")
      // Qualquer número solto: contagem de tokens, milissegundos, tentativa.
      .replace(/\d+/g, "<n>")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, TETO)
  );
}

export interface JobMorto {
  id: string;
  organization_id: string;
  kind: string;
  last_error: string | null;
  attempts: number;
  created_at: string;
}

export interface GrupoDaFilaMorta {
  assinatura: string;
  /** O erro de UM deles, inteiro — a assinatura é para agrupar, não para ler. */
  exemplo: string | null;
  quantidade: number;
  tipos: string[];
  organizacoes: string[];
  maisAntigo: string;
  maisRecente: string;
  ids: string[];
}

/**
 * Agrupa e ORDENA pelo tamanho do estrago (quantidade), não pela data.
 *
 * O grupo de 49 e o grupo de 1 competem pela atenção de quem abre a tela, e
 * ordenar por data deixaria o de 49 embaixo se ele tivesse acontecido primeiro
 * — que é justamente o caso comum: a rajada vem antes de alguém notar.
 */
export function agruparFilaMorta(jobs: readonly JobMorto[]): GrupoDaFilaMorta[] {
  const mapa = new Map<string, GrupoDaFilaMorta>();

  for (const j of jobs) {
    const assinatura = assinaturaDoErro(j.last_error);
    const atual = mapa.get(assinatura);
    if (!atual) {
      mapa.set(assinatura, {
        assinatura,
        exemplo: j.last_error,
        quantidade: 1,
        tipos: [j.kind],
        organizacoes: [j.organization_id],
        maisAntigo: j.created_at,
        maisRecente: j.created_at,
        ids: [j.id],
      });
      continue;
    }
    atual.quantidade += 1;
    atual.ids.push(j.id);
    if (!atual.tipos.includes(j.kind)) atual.tipos.push(j.kind);
    if (!atual.organizacoes.includes(j.organization_id)) atual.organizacoes.push(j.organization_id);
    if (j.created_at < atual.maisAntigo) atual.maisAntigo = j.created_at;
    if (j.created_at > atual.maisRecente) atual.maisRecente = j.created_at;
    // O exemplo é o erro MAIS LONGO do grupo: o truncado de 40 caracteres não
    // diz o que fazer, e é sempre um deles que vem primeiro.
    if ((j.last_error?.length ?? 0) > (atual.exemplo?.length ?? 0)) atual.exemplo = j.last_error;
  }

  return [...mapa.values()].sort((a, b) => b.quantidade - a.quantidade);
}
