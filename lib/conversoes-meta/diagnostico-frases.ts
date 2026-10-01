/**
 * FORK MIA — o vocabulário do DIAGNÓSTICO da Meta: os casos, a saúde de cada um
 * e a frase que quem opera lê.
 *
 * Módulo PURO. O servidor (`./diagnostico.ts`) decide o CASO; a tela e a
 * ferramenta do MCP leem a frase daqui. A tela traduz pela tabela (`t(TITULO_DO_CASO[caso])`),
 * e por isso toda frase desta tabela tem espanhol em
 * `lib/i18n/dicionario-mia-conversoes.ts`.
 *
 * Cada frase de problema diz O QUE FAZER: diagnóstico que só acusa não serve.
 */

export type SaudeDoItem = "ok" | "atencao" | "problema";

export const CASOS_DO_DIAGNOSTICO = [
  // a conexão gravada, antes de falar com a Meta
  "sem_conexao",
  "conexao_pausada",
  "credencial_incompleta",
  "cifra_indisponivel",
  "leitura_indisponivel",
  // o token
  "token_aceito",
  "token_recusado",
  "token_nao_conferido",
  // o destino de conversões
  "destino_encontrado",
  "destino_nao_encontrado",
  "destino_sem_acesso",
  "destino_nao_conferido",
  // a permissão de envio
  "permissao_de_envio",
  "permissao_nao_listada",
  "permissao_nao_conferida",
  // o que o histórico sabe
  "ultimo_envio_aceito",
  "ultimo_envio_antigo",
  "nenhum_envio_aceito",
  "sem_recusados",
  "com_recusados",
  "modo_de_teste",
] as const;

export type CasoDoDiagnostico = (typeof CASOS_DO_DIAGNOSTICO)[number];

export const SAUDE_DO_CASO: Record<CasoDoDiagnostico, SaudeDoItem> = {
  sem_conexao: "problema",
  conexao_pausada: "atencao",
  credencial_incompleta: "problema",
  cifra_indisponivel: "problema",
  leitura_indisponivel: "atencao",
  token_aceito: "ok",
  token_recusado: "problema",
  token_nao_conferido: "atencao",
  destino_encontrado: "ok",
  destino_nao_encontrado: "problema",
  destino_sem_acesso: "problema",
  destino_nao_conferido: "atencao",
  permissao_de_envio: "ok",
  permissao_nao_listada: "atencao",
  permissao_nao_conferida: "atencao",
  ultimo_envio_aceito: "ok",
  ultimo_envio_antigo: "atencao",
  nenhum_envio_aceito: "atencao",
  sem_recusados: "ok",
  com_recusados: "atencao",
  modo_de_teste: "atencao",
};

export const TITULO_DO_CASO: Record<CasoDoDiagnostico, string> = {
  sem_conexao: "A Meta não está conectada",
  conexao_pausada: "Envio pausado",
  credencial_incompleta: "Conexão incompleta",
  cifra_indisponivel: "Instalação sem a chave de criptografia",
  leitura_indisponivel: "Não consegui ler a conexão agora",
  token_aceito: "Token válido",
  token_recusado: "Token recusado pela Meta",
  token_nao_conferido: "Token: não deu para conferir",
  destino_encontrado: "Destino de conversões encontrado",
  destino_nao_encontrado: "Destino de conversões não encontrado",
  destino_sem_acesso: "Sem acesso ao destino de conversões",
  destino_nao_conferido: "Destino de conversões: não deu para conferir",
  permissao_de_envio: "Permissão de envio",
  permissao_nao_listada: "Permissão de envio: a Meta não lista neste token",
  permissao_nao_conferida: "Permissão de envio: não deu para conferir",
  ultimo_envio_aceito: "Último envio aceito",
  ultimo_envio_antigo: "Último envio aceito há mais de 14 dias",
  nenhum_envio_aceito: "Nenhum envio aceito até aqui",
  sem_recusados: "Eventos recusados nos últimos 7 dias: 0",
  com_recusados: "Eventos recusados nos últimos 7 dias",
  modo_de_teste: "Modo de teste ligado",
};

export const DETALHE_DO_CASO: Record<CasoDoDiagnostico, string> = {
  sem_conexao:
    "Preencha o identificador do destino de conversões e o token na aba Configuração. Até lá nada é enviado à Meta.",
  conexao_pausada:
    "A conexão existe e o envio está desligado: nem a compra nem as etapas vão para a Meta. Ligue o envio na aba Configuração para testar a conexão.",
  credencial_incompleta: "Falta o identificador do destino ou o token. Complete na aba Configuração.",
  cifra_indisponivel:
    "Esta instalação está sem a chave mestra de criptografia. Quem instalou o sistema precisa configurá-la; reconectar pela tela não resolve.",
  leitura_indisponivel: "Tente de novo em instantes.",
  token_aceito: "A Meta aceitou o token guardado.",
  token_recusado: "O token venceu ou foi revogado. Gere um token novo na Meta e troque na aba Configuração.",
  token_nao_conferido: "A Meta não respondeu sobre o token. Tente de novo em instantes.",
  destino_encontrado: "O token alcança este destino de conversões.",
  destino_nao_encontrado:
    "O identificador não existe na Meta, ou o token não o alcança. Confira o número no gerenciador de eventos e corrija na aba Configuração.",
  destino_sem_acesso:
    "O token existe, mas não pode usar este destino. Peça acesso de administrador ao destino de conversões e gere o token de novo.",
  destino_nao_conferido: "Depende de um token aceito.",
  permissao_de_envio: "O token pode enviar eventos para este destino.",
  permissao_nao_listada:
    "Token gerado dentro do próprio destino de conversões envia mesmo assim. Para ter certeza, preencha o código de teste, mova um negócio e veja o evento chegar no gerenciador de eventos.",
  permissao_nao_conferida:
    "A Meta não informou as permissões deste token. O envio com o código de teste é o que decide.",
  ultimo_envio_aceito: "A Meta está recebendo.",
  ultimo_envio_antigo: "Confira se ainda chegam negócios de anúncio e se as regras das etapas estão ligadas.",
  nenhum_envio_aceito: "A Meta ainda não recebeu nada deste destino.",
  sem_recusados: "Nenhum evento recusado.",
  com_recusados: "Abra o histórico para ver cada evento e reenviar o que tem conserto.",
  modo_de_teste:
    "Os envios vão marcados como teste e não contam para a otimização. Apague o código de teste quando terminar de conferir.",
};

export const VEREDITO_DO_DIAGNOSTICO = {
  em_ordem: "Conexão em ordem: a Meta está recebendo.",
  com_problema: "A Meta não está recebendo. Veja o item em vermelho.",
  com_atencao: "A conexão responde, mas há pontos de atenção.",
} as const;

export type VereditoDoDiagnostico = keyof typeof VEREDITO_DO_DIAGNOSTICO;
