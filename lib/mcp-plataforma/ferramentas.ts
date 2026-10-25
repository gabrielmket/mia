/**
 * As ferramentas do MCP de PLATAFORMA (item E6) — a LISTA.
 *
 * ── O desenho em uma frase ────────────────────────────────────────────────
 *
 * LER é livre; ESCREVER é nomeado. Toda ferramenta de escrita declara a chave
 * da operação que o token precisa carregar (`lib/mcp-plataforma/operacoes.ts`),
 * e o servidor recusa antes de tocar no banco.
 *
 * ── Este arquivo é o ÚNICO ponto de registro ──────────────────────────────
 *
 * As ferramentas moram em arquivos por área, em `lib/mcp-plataforma/ferramentas/`.
 * `FERRAMENTAS` é a concatenação deles, e é a única coisa que o servidor lê.
 * Área nova entra aqui: um `import` e uma linha na lista.
 *
 * ── Por que cada escrita reusa o caminho que a TELA já usa ────────────────
 *
 * Um segundo jeito de criar funil, produto ou agente divergiria do da tela no
 * primeiro conserto, e o sintoma seria um cliente implantado por ferramenta
 * nascendo diferente de um implantado por clique. Por isso as ferramentas de
 * implantação chamam `lib/implantacao/`, que chama a mesma função de domínio,
 * o mesmo schema e a mesma função do banco que a tela chama.
 *
 * ── O ATOR ────────────────────────────────────────────────────────────────
 *
 * As colunas de autoria (`created_by`) são FK para `auth.users`: um token não é
 * usuário e não cabe ali. O ator gravado é QUEM CRIOU O TOKEN — a pessoa que
 * respondeu por ele existir. A auditoria carrega o token junto, então "quem
 * fez" tem as duas metades: a pessoa responsável e a chave usada.
 */
import { FERRAMENTAS_DE_AGENTE } from "./ferramentas/agente";
// FORK MIA (.88): o assistente da MIA (docs/fork/assistente.md).
import { FERRAMENTAS_DO_ASSISTENTE } from "./ferramentas/assistente";
// FORK MIA (.91): as propostas do assistente (docs/fork/primeiros-passos.md).
import { FERRAMENTAS_DAS_PROPOSTAS_DO_ASSISTENTE } from "./ferramentas/propostas-do-assistente";
import { FERRAMENTAS_DE_AUTOMACAO_E_AGENDA } from "./ferramentas/automacoes-e-agenda";
import { FERRAMENTAS_DE_CANAIS_E_INTEGRACOES } from "./ferramentas/canais-e-integracoes";
import { FERRAMENTAS_DO_CHECKLIST } from "./ferramentas/checklist";
import { FERRAMENTAS_DE_CONHECIMENTO_E_FOLLOWUP } from "./ferramentas/conhecimento-e-followup";
import { FERRAMENTAS_DE_CONVERSOES } from "./ferramentas/conversoes";
import { FERRAMENTAS_DE_DEMONSTRACAO } from "./ferramentas/demonstracao";
import { FERRAMENTAS_DE_EMAIL_MARKETING } from "./ferramentas/email-marketing";
import { FERRAMENTAS_DE_EMPRESA } from "./ferramentas/empresa";
import { FERRAMENTAS_DE_EQUIPE_E_MENSAGENS } from "./ferramentas/equipe-e-mensagens";
import { FERRAMENTAS_DE_ETIQUETAS_E_MEMORIA } from "./ferramentas/etiquetas-e-memoria";
import { FERRAMENTAS_DE_FUNIL } from "./ferramentas/funil";
import { FERRAMENTAS_DE_LEITURA } from "./ferramentas/leituras";
import { FERRAMENTAS_DE_OBRIGACOES } from "./ferramentas/obrigacoes";
import { FERRAMENTAS_DE_PAINEIS } from "./ferramentas/paineis";
import { FERRAMENTAS_DA_PLATAFORMA } from "./ferramentas/plataforma";
import { FERRAMENTAS_DE_PRODUTOS } from "./ferramentas/produtos";
import { FERRAMENTAS_DE_RELATORIOS } from "./ferramentas/relatorios";
import { FERRAMENTAS_DE_ROTEADOR } from "./ferramentas/roteador";
// As ferramentas de importação (docs/fork/mcp-de-migracao.md).
import { FERRAMENTAS_DE_IMPORTACAO } from "./importacao";
import type { FerramentaDePlataforma } from "./tipos";

export type { ContextoDaFerramenta, FerramentaDePlataforma } from "./tipos";

export const FERRAMENTAS: readonly FerramentaDePlataforma[] = [
  // a instalação: clientes, módulos, preço, crédito, saúde
  ...FERRAMENTAS_DA_PLATAFORMA,
  // a implantação de um cliente, na ordem do roteiro (docs/fork/mcp-de-implantacao.md)
  ...FERRAMENTAS_DO_CHECKLIST,
  ...FERRAMENTAS_DE_LEITURA,
  ...FERRAMENTAS_DE_EMPRESA,
  ...FERRAMENTAS_DE_FUNIL,
  ...FERRAMENTAS_DE_PRODUTOS,
  ...FERRAMENTAS_DE_ETIQUETAS_E_MEMORIA,
  ...FERRAMENTAS_DE_CONHECIMENTO_E_FOLLOWUP,
  ...FERRAMENTAS_DE_AGENTE,
  // o roteador de intenção entre dois agentes do mesmo número (upstream 1.73: destino de funil por intenção)
  ...FERRAMENTAS_DE_ROTEADOR,
  ...FERRAMENTAS_DE_AUTOMACAO_E_AGENDA,
  // os ajustes da conexão, a fonte de formulário e o banco externo (upstream 1.74 a 1.80)
  ...FERRAMENTAS_DE_CANAIS_E_INTEGRACOES,
  ...FERRAMENTAS_DE_CONVERSOES,
  ...FERRAMENTAS_DE_EQUIPE_E_MENSAGENS,
  // documentos e obrigações com vencimento: catálogo, itens e leitura (docs/fork/obrigacoes.md)
  ...FERRAMENTAS_DE_OBRIGACOES,
  // os painéis prontos e o link para o dono do negócio (item 8, migrations 9030 e 9031)
  ...FERRAMENTAS_DE_PAINEIS,
  // o montador de relatórios: os relatórios e o painel do segmento (item 9, migrations 9040 a 9042)
  ...FERRAMENTAS_DE_RELATORIOS,
  // a migração de outro CRM: empresas, contatos, negócios e materiais (docs/fork/mcp-de-migracao.md)
  ...FERRAMENTAS_DE_IMPORTACAO,
  // as empresas de demonstração por segmento (docs/fork/cliente-modelo.md)
  ...FERRAMENTAS_DE_DEMONSTRACAO,
  ...FERRAMENTAS_DO_ASSISTENTE,
  // FORK MIA (.91): ver e decidir as propostas do assistente de uma empresa
  ...FERRAMENTAS_DAS_PROPOSTAS_DO_ASSISTENTE,
  // FORK MIA (.89): o disparo de e-mail marketing, do domínio ao rascunho; o MCP nunca dispara (docs/fork/email-marketing.md)
  ...FERRAMENTAS_DE_EMAIL_MARKETING,
];

export const FERRAMENTA_POR_NOME = new Map(FERRAMENTAS.map((f) => [f.name, f]));
