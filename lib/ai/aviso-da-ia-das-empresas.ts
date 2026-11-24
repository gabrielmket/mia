/**
 * FORK MIA (MIA-218) · O AVISO DA TRAVA: empresa com o padrão de IA num
 * provedor sem chave utilizável (docs/fork/ia-da-plataforma.md).
 *
 * Foi o buraco da MIA-215: empresas nasceram no padrão do produto do
 * upstream (Anthropic), a instalação não tinha chave da Anthropic, e nenhuma
 * delas fez uma chamada de IA por semanas sem ninguém saber. A trava do
 * servidor (MIA-217) recusa salvar um padrão assim; isto aqui é o que AVISA
 * quando, mesmo assim, uma empresa fica nesse estado (a chave da instalação
 * saiu do ambiente, uma chave própria foi desativada).
 *
 * Só a regra, pura. Quem lê o banco é `iaDasEmpresas` (`lib/ai/ia-da-empresa.ts`);
 * quem fala são a `/health` (`data.ia`), o relatório interno
 * (`cron/report-da-plataforma`) e o MCP (`plataforma_ver_ia_das_empresas`).
 *
 * Conta só empresa OPERANTE (`ehOperante`): empresa suspensa ou cancelada não
 * atende ninguém, e contá-la deixaria o alarme aceso para sempre. A
 * demonstração conta: é usada em venda, e demonstração sem IA é venda perdida.
 */

/** O mínimo de cada empresa que a regra precisa. */
export interface IaParaOAviso {
  chave: "propria" | "instalacao" | null;
  operante: boolean;
}

/** Quantas empresas operantes estão sem chave utilizável para o padrão delas. */
export function contarEmpresasSemChave(empresas: readonly IaParaOAviso[]): number {
  return empresas.filter((e) => e.operante && e.chave === null).length;
}

/**
 * O bloco `data.ia` da `/health`. Só a contagem, sem id nem nome, igual com e
 * sem o segredo. `null` = não consegui ler (diferente de zero).
 *
 * NÃO entra no `status` da saúde: o passo 1 do trem de implantação lê o
 * `status`, e uma empresa mal configurada não pode travar a implantação da
 * noite. O alarme é de quem monitora.
 */
export function blocoDaSaude(
  leitura: { empresas: readonly IaParaOAviso[] } | { falha: true },
): { empresas_sem_chave: number | null } {
  if ("falha" in leitura) return { empresas_sem_chave: null };
  return { empresas_sem_chave: contarEmpresasSemChave(leitura.empresas) };
}

/** A chave da trava anti-ruído do relatório interno (um recado por dia). */
export const CHAVE_DO_AVISO_DA_IA = "ia_das_empresas_sem_chave";

/**
 * A linha do relatório interno quando há empresa sem chave. `null` = nada a
 * dizer. Sem nome de empresa no recado: o caminho para ver quais é o MCP.
 */
export function recadoDaIaSemChave(n: number): string | null {
  if (n <= 0) return null;
  const quantas = n === 1 ? "1 empresa está" : `${n} empresas estão`;
  return (
    `🧠 *IA sem chave*\n\n${quantas} com o padrão de IA num provedor sem chave nesta instalação, ` +
    `e ${n === 1 ? "ela não responde" : "elas não respondem"} com IA.\n\n` +
    `Para ver quais: \`plataforma_ver_ia_das_empresas\` com \`so_sem_chave: true\`. ` +
    `Para corrigir: em Admin › Modelo de IA, um provedor com chave; ou, na empresa, em modo suporte, ` +
    `IA › Provedores de IA.`
  );
}
