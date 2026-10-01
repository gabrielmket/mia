/**
 * As duas operações que um token precisa carregar para IMPORTAR.
 *
 * São duas, e não uma por ferramenta, porque o que separa o estrago é a
 * natureza do que entra: pessoas e negócios de um lado, arquivos do outro. Quem
 * só vai subir o catálogo em PDF não precisa poder encher a base de contatos.
 *
 * O `raio` é lido por quem marca a caixinha na tela dos tokens. Ele responde
 * "e se este token vazar?", não "o que a ferramenta faz".
 */
import type { OperacaoDePlataforma } from "../operacoes";

export const OPERACAO_IMPORTAR_BASE = "importar_base";
export const OPERACAO_IMPORTAR_MATERIAIS = "importar_materiais";

export const OPERACOES_DE_IMPORTACAO: readonly OperacaoDePlataforma[] = [
  {
    chave: OPERACAO_IMPORTAR_BASE,
    rotulo: "Importar base (contatos, empresas e negócios)",
    raio:
      "Grava contatos, empresas e negócios em QUALQUER cliente, em lotes de centenas. " +
      "Um token vazado enche a base de um cliente com gente que não é dele, ou mistura " +
      "pessoas: quem tem o mesmo telefone ou e-mail recebe os dados que vierem na lista. " +
      "Não tem botão de desfazer; o conserto é registro por registro. Nenhuma mensagem " +
      "sai pela importação, mas quem entra na base passa a poder receber as próximas.",
  },
  {
    chave: OPERACAO_IMPORTAR_MATERIAIS,
    rotulo: "Importar materiais (conhecimento, fotos e modelos de proposta)",
    raio:
      "Põe arquivos na base de conhecimento, nas fotos de produto e nos modelos de " +
      "proposta de QUALQUER cliente. Um token vazado ensina ao agente de IA de um cliente " +
      "um conteúdo que ele passa a repetir aos consumidores como verdade, e troca a foto " +
      "que ele manda junto do produto. Também gasta crédito de IA da plataforma a cada " +
      "modelo de proposta importado.",
  },
] as const;
