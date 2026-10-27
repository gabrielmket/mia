/**
 * FORK MIA (.94) · A LISTA FECHADA DO "NUNCA" (protótipo "ensina e faz", tela
 * 4). Puro.
 *
 * Número e canal, cobrança e plano, convite, usuários e papéis, chaves e
 * tokens, apagar, publicar agente e mandar mensagem a cliente. Para estes, não
 * existe proposta nem com aprovação: o assistente explica por que, em uma
 * frase, e leva até a tela (ou, para quem não abre a tela, diz quem pode e
 * oferece o pedido). É o que pode estragar a conta, custar dinheiro ou falar
 * com cliente.
 *
 * Por que não existe jeito de ele fazer:
 *
 *   - não há ferramenta: o assistente só tem as leituras, as propostas do
 *     catálogo (`propostas/catalogo.ts`) e os botões de levar à tela, e a
 *     cerca `assistente-faz-com-aprovacao` reprova a ferramenta que escreva
 *     qualquer coisa desta lista;
 *   - o banco recusa: a tabela das propostas só aceita risco "seguro" ou
 *     "atenção" (9080), e o tipo é uma lista fechada (9100);
 *   - o login é o da pessoa: até a leitura usa o acesso de quem pergunta.
 *
 * "Desfazer" não é apagar: ele tira só o que a própria proposta pôs, enquanto
 * nada depende disso. Apagar o que já estava no sistema continua pela tela.
 */
import type { Role } from "@/lib/auth/types";

export interface ItemDoNunca {
  id: "numero" | "plano" | "convite" | "papel" | "chave" | "apagar" | "publicar" | "mensagem";
  grupo: string;
  /** Um pedido de exemplo. */
  exemplo: string;
  /** O porquê, em uma frase. */
  porque: string;
  /** O que ele faz no lugar. */
  noLugar: string;
  /** A tela onde a pessoa faz. */
  href: string;
  tela: string;
  /** Quem faz pela tela. */
  papel: Role;
}

export const LISTA_DO_NUNCA: readonly ItemDoNunca[] = [
  {
    id: "numero",
    grupo: "Número e canal",
    exemplo: "Conecta o número novo da clínica para mim",
    porque: "Conectar pede o celular na mão ou a conta do Facebook, e um número ligado errado faz a conversa de um cliente sair por outro.",
    noLugar: "Explica o passo a passo e leva até Conexões.",
    href: "/app/connections",
    tela: "Conexões",
    papel: "admin",
  },
  {
    id: "plano",
    grupo: "Cobrança e plano",
    exemplo: "Muda meu plano para o Completo",
    porque: "Plano muda o que a empresa paga, e só quem administra decide isso, vendo o que muda antes.",
    noLugar: "Explica a diferença entre os planos e leva até Plano e cobrança.",
    href: "/app/settings/billing",
    tela: "Plano e cobrança",
    papel: "admin",
  },
  {
    id: "convite",
    grupo: "Convite, usuários e papéis",
    exemplo: "Convida a Juliana para a equipe",
    porque: "Quem entra no sistema, e o que vê, é decisão de quem administra. Um convite errado abre os dados da empresa.",
    noLugar: "Explica o passo a passo e leva até Equipe.",
    href: "/app/team",
    tela: "Equipe",
    papel: "admin",
  },
  {
    id: "papel",
    grupo: "Convite, usuários e papéis",
    exemplo: "Dá acesso de administrador para a Marina",
    porque: "O papel muda o que a pessoa vê e o que pode apagar. É clique de quem administra, com a pessoa sabendo.",
    noLugar: "Explica onde fica o papel da pessoa e leva até Equipe.",
    href: "/app/team",
    tela: "Equipe",
    papel: "admin",
  },
  {
    id: "chave",
    grupo: "Chaves e tokens",
    exemplo: "Põe o token da Meta Ads para mim",
    porque:
      "Chave e token eu nunca vejo nem guardo. A conta de anúncios se conecta pelo login do Facebook, na tela; a chave de IA é da plataforma e nem aparece para a empresa.",
    noLugar: "Leva até a tela da conexão (API Tokens, Meta Ads).",
    href: "/app/settings/api-tokens",
    tela: "API Tokens",
    papel: "admin",
  },
  {
    id: "apagar",
    grupo: "Apagar",
    exemplo: "Apaga o funil antigo",
    porque: "Apagar leva junto o histórico e não tem volta. Isso eu não faço nem com aprovação.",
    noLugar: "Explica o que acontece com o que depende daquilo e leva até a tela.",
    href: "/app/settings/tenant/pipelines",
    tela: "a tela da peça",
    papel: "manager",
  },
  {
    id: "publicar",
    grupo: "Publicar agente",
    exemplo: "Publica a Clara com o texto novo",
    porque: "Publicar é o que põe o agente para falar com cliente de verdade. Converse com ele no Teste antes; o botão fica com você.",
    noLugar: "Explica como testar antes e leva até o botão Publicar, em Agentes.",
    href: "/app/ai/agents",
    tela: "Agentes",
    papel: "admin",
  },
  {
    id: "mensagem",
    grupo: "Mensagem a cliente",
    exemplo: "Manda mensagem para os 30 leads parados",
    porque: "Mensagem a cliente sai só por uma pessoa ou pelos fluxos que vocês publicaram. Nem uma, nem para a lista.",
    noLugar: "Mostra quem são, escreve o texto para a pessoa revisar e colar, e ensina a campanha de Broadcast.",
    href: "/app/broadcast",
    tela: "Broadcast",
    papel: "agent",
  },
];

/**
 * Pedaços de NOME de ferramenta que denunciam um "faz" da lista do nunca. A
 * cerca confere que nenhuma ferramenta do assistente tem um deles no nome.
 */
export const VERBOS_DO_NUNCA = [
  "conectar",
  "numero",
  "canal",
  "plano",
  "cobranca",
  "pagar",
  "convidar",
  "convite",
  "usuario",
  "papel",
  "token",
  "chave",
  "apagar",
  "excluir",
  "publicar",
  "enviar",
  "mandar_mensagem",
  "disparar",
] as const;
