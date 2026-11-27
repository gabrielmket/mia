/**
 * FORK MIA (MIA-262) — O RETRATO DA INSTALAÇÃO, SEM A IA DA PLATAFORMA.
 *
 * `GET /api/v1/system/instalacao` devolvia, a todo gerente, o provedor, o
 * modelo curado, de onde vem a chave e o rótulo e o final da chave da empresa.
 * Provedor, modelo e chave são da plataforma (`lib/ai/custo-e-da-plataforma.ts`).
 * Para quem não é `podeConfigurarChaveDeIa`, a inteligência volta só com o que
 * diz se a IA está pronta.
 *
 * A prova paga (`?provar=1`) não passa por aqui: é da MIA-284. O ramo de
 * `?provar=1` sem o portão passa (`retratoAoCliente(retrato, false)` na rota):
 * quem não configura a chave recebe o mesmo retrato escondido, sem `prova`.
 */
import type { RetratoDaInstalacao } from "@/lib/instalacao/retrato";

export function retratoAoCliente(retrato: RetratoDaInstalacao, visivel: boolean) {
  if (visivel) return retrato;
  const { inteligencia, ...resto } = retrato;
  return {
    ...resto,
    inteligencia: {
      pronta: inteligencia.origemDaChave !== "nenhuma",
      chaveEmVerificacao: inteligencia.chaveEmVerificacao,
      prontaParaPublicar: inteligencia.prontaParaPublicar,
    },
  };
}
