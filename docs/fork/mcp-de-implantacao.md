# MCP de implantação · o agente implanta um cliente sem ninguém clicar na tela

O MCP de **plataforma** (`/api/mcp/plataforma`) já criava o cliente, liberava
módulo e lançava crédito. Agora ele também **monta o cliente por dentro**: dados
da empresa, funil, catálogo, etiquetas, memória, conhecimento, follow-up, agente
de IA, roteador de intenção, automações (com os planos de tarefa), agenda, equipe,
mensagens prontas, as regras de conversão para a Meta e o Google, a fonte de
formulário, os ajustes de cada número de WhatsApp e a coluna do cliente no banco
externo. Uma sessão do Claude Code
com um token de plataforma faz a implantação inteira conversando, e para só onde
o produto exige uma pessoa (ler o QR Code do WhatsApp, por exemplo).

Três regras valem para todas as ferramentas:

- **Ler é livre, escrever é nomeado.** Um token sem operação marcada lê tudo e
  não escreve nada. Cada escrita exige uma operação, marcada na tela de tokens,
  com o tamanho do estrago escrito ao lado.
- **Cada escrita passa pelo caminho da tela.** A ferramenta valida com o mesmo
  esquema, grava as mesmas colunas e deixa a mesma auditoria da tela
  correspondente. O que a tela recusa, a ferramenta recusa.
- **Pode chamar de novo.** Toda ferramenta de escrita acha o que já existe pela
  chave natural (nome do funil, código do produto, nome do agente) e responde
  `criou`, `atualizou` ou `ja_estava`. Nada é apagado por não ter sido citado,
  salvo quando um parâmetro pede isso com todas as letras.

O ator de cada escrita é **quem criou o token**. A auditoria guarda a pessoa, o
token, a ferramenta e os argumentos (`plataforma.mcp_executado`).

---

## 1. Como ligar: o token e o `.mcp.json`

### 1.1 Criar o token

1. Entre como admin de plataforma e abra **Admin › Tokens de plataforma**
   (`/admin/tokens-de-plataforma`).
2. Em **Emitir um token**, dê um nome, a validade em dias e o motivo.
3. Em **O que este token pode ESCREVER**, marque as operações. Para implantar um
   cliente de ponta a ponta:

   | operação | o que libera | quando marcar |
   |---|---|---|
   | `criar_cliente` | criar a organização | se o agente também cria o cliente |
   | `liberar_modulo` | ligar módulo vendido | se o cliente contratou algum módulo |
   | `implantar_configuracao` | montar tudo, inclusive os **rascunhos** de agente, follow-up e automação, os planos de tarefa, a fonte de formulário, os ajustes de um número (dias da prospecção, guardar o histórico, pausa agendada) e a coluna do cliente no banco externo | sempre |
   | `colocar_no_ar` | publicar e pausar agente, publicar follow-up, ligar automação, ligar lembrete, ligar o roteador de intenção, submeter modelo à Meta, ligar regra de conversão e a volta dos leads de formulário | quando o agente também publica |
   | `convidar_equipe` | mandar convite por e-mail com o papel escolhido | quando o agente também convida |

   As três últimas são separadas pelo tamanho do estrago. Um token só com
   `implantar_configuracao` monta o cliente inteiro e não faz o sistema mandar
   uma mensagem sequer para o cliente final. É o token certo para deixar a
   implantação pronta e uma pessoa conferir antes de pôr no ar.
4. Clique em **Emitir token**. O token (`dskp_...`) aparece **uma vez**. Copie.

### 1.2 Guardar o token fora do repositório

O token vai numa variável de ambiente do sistema, nunca escrito em arquivo.

```powershell
# Windows (PowerShell), vale para os próximos terminais
[Environment]::SetEnvironmentVariable("MIA_PLATAFORMA_TOKEN", "dskp_...", "User")
```

```bash
# macOS e Linux: no arquivo de perfil do shell (~/.zshrc, ~/.bashrc)
export MIA_PLATAFORMA_TOKEN="dskp_..."
```

### 1.3 O `.mcp.json`

Na pasta do projeto em que o Claude Code vai rodar:

```json
{
  "mcpServers": {
    "mia-plataforma": {
      "type": "http",
      "url": "https://<endereço do sistema>/api/mcp/plataforma",
      "headers": {
        "Authorization": "Bearer ${MIA_PLATAFORMA_TOKEN}"
      }
    }
  }
}
```

O arquivo guarda só o **nome** da variável. Abra o Claude Code num terminal novo
(para a variável existir) e confira com `/mcp`: o servidor `mia-plataforma`
aparece com as ferramentas `plataforma_...`.

Token de cliente (`dsk_...`) não entra aqui, e token de plataforma não entra no
MCP de cliente (`/api/mcp`): os prefixos são diferentes e a recusa diz a porta
certa.

---

## 2. O roteiro de implantação

A ordem importa porque uma coisa referencia a outra: o agente aponta para o
funil, para os materiais e para os follow-ups, então eles vêm antes.

O agente começa e termina por `plataforma_ver_implantacao`: o checklist diz o
que já está pronto, o que falta (com a ferramenta que resolve) e o que só uma
pessoa faz (com a tela e o caminho).

| passo | o que acontece | ferramenta | quem |
|---|---|---|---|
| 1 | Criar a organização | `plataforma_criar_cliente` | agente |
| 2 | Liberar os módulos contratados | `plataforma_listar_modulos`, `plataforma_liberar_modulo` | agente |
| 3 | Ver o ponto de partida | `plataforma_ver_implantacao` | agente |
| 4 | Dados da empresa (nome, CNPJ, fuso, modo de venda, a meta do mês) e distribuição do atendimento | `plataforma_configurar_empresa`, `plataforma_configurar_atendimento` | agente |
| 5 | Funil, etapas, campos, motivos e o vocabulário do segmento (inclusive o nome do compromisso da agenda) | `plataforma_garantir_funil` | agente |
| 6 | Catálogo, em lote | `plataforma_garantir_produtos` | agente |
| 7 | Etiquetas | `plataforma_garantir_etiquetas` | agente |
| 8 | Memória: as regras da casa e as anotações | `plataforma_gravar_memoria` | agente |
| 9 | Conhecimento por texto (perguntas e respostas, documento) | `plataforma_garantir_conhecimento` | agente |
| 10 | Instalar os follow-ups (rascunho) | `plataforma_listar_modelos`, `plataforma_garantir_followup` | agente |
| 11 | Criar o agente de IA (rascunho), com o funil, os materiais e os follow-ups | `plataforma_garantir_agente` | agente |
| 12 | Automações (nascem desligadas), tipos de agendamento, jornada e respostas prontas | `plataforma_garantir_automacao`, `plataforma_garantir_tipos_de_agendamento`, `plataforma_definir_jornada`, `plataforma_garantir_respostas_prontas` | agente |
| 12a | Planos de tarefa (antes da automação que os aplica) e a fonte de formulário do site (antes da automação que reage a ela) | `plataforma_garantir_planos_de_tarefa`, `plataforma_garantir_fonte_de_formulario` | agente |
| 13 | **Conectar o número de WhatsApp** | tela **Conexões** (`/app/connections`) | **pessoa do cliente** |
| 13a | Depois do número: os dias da prospecção e, por QR Code, guardar o histórico | `plataforma_configurar_canal` | agente |
| 14 | Conferir o rascunho com o cliente antes de pôr no ar | `plataforma_ver_agentes`, `plataforma_ver_followup` | agente e pessoa |
| 15 | Publicar os follow-ups e o agente | `plataforma_publicar_followup`, `plataforma_publicar_agente` | agente |
| 15a | Só com dois ou mais agentes no MESMO número: montar o roteador de intenção (uma intenção por agente, e o funil de destino de cada uma) e ligá-lo | `plataforma_garantir_roteador`, `plataforma_ligar_roteador` | agente |
| 16 | Ligar as automações e os lembretes | `plataforma_ligar_automacao`, `plataforma_ligar_lembrete` | agente |
| 16a | Conversões (opcional, para quem anuncia): montar as regras por etapa, e ligar depois de a pessoa conectar a conta de anúncios | `plataforma_ver_conversoes`, `plataforma_garantir_conversoes_da_meta`, `plataforma_garantir_conversoes_do_google`, `plataforma_ligar_conversoes`, `plataforma_ligar_leads_de_formulario_da_meta` | agente (a conexão é com a pessoa do cliente) |
| 17 | Convidar a equipe (o link curto de cada convite volta na resposta, para mandar por WhatsApp) | `plataforma_convidar_pessoas` | agente |
| 18 | Conferir o checklist: `pode_atender` e a lista do que ficou com uma pessoa | `plataforma_ver_implantacao` | agente |
| 18a | Os números do primeiro dia, e o link para o dono preparado (mandado só quando o cliente pedir) | `plataforma_ver_paineis`, `plataforma_garantir_link_do_dono` | agente (quem manda o link é uma pessoa) |

### O que a pessoa faz no meio

- **Passo 13, sempre.** Sem número conectado nenhum agente é publicado. O QR
  Code é lido no celular do cliente, e o número oficial pede o login dele na
  Meta. A recusa de `plataforma_publicar_agente` diz isso com o caminho da tela.
  Até aqui o agente implantador faz tudo sozinho: o rascunho do agente de IA
  nasce sem número.
- **Passo 14, recomendado.** Publicar é o momento em que o sistema passa a falar
  com os clientes do cliente. Vale ler o prompt e os textos do follow-up com
  alguém antes.
- **Depois do passo 17**, cada convidado aceita o convite pelo e-mail.
- **O resto é opcional** e aparece em `so_pela_tela` no checklist: conectar a
  agenda do Google ou do Outlook, o token de conversões e o ID da Página da Meta,
  a verificação em duas etapas da equipe. A seção 4 lista tudo.

### O funil que já vem pronto

Toda organização nasce com um funil de e-commerce chamado **Pedidos** (Carrinho
abandonado, Aguardando pagamento...). Ele é o funil padrão e não pode ser
apagado. Para a primeira implantação, chame `plataforma_garantir_funil` com
`adotar_funil_padrao: true`: o funil padrão ganha o nome e as etapas do cliente
e continua sendo o padrão. Só funciona enquanto o funil não tem negócio. Sem o
parâmetro, a ferramenta cria um segundo funil e deixa o **Pedidos** onde está.

### Quantos agentes de IA, e quem responde

Uma organização pode ter **vários agentes**. O único limite é o nome, que não se
repete (nem com o de um agente arquivado). Quem responde a uma mensagem é
decidido assim, nesta ordem:

1. A conversa que já tem um agente continua com ele.
2. Senão, vale o agente **publicado no número** em que a mensagem chegou. Com
   mais de um publicado no mesmo número, vence o de maior `prioridade` e, no
   empate, o mais antigo.
3. Para dividir o atendimento entre dois agentes do mesmo número por assunto,
   existe o **roteador de intenção** (IA › Roteadores, `/app/ai/routers`). Desde
   a .73 ele tem ferramenta: `plataforma_garantir_roteador` monta (nome, número,
   agente reserva e as intenções, cada uma com o agente e, se quiser, o funil de
   destino do negócio) e `plataforma_ligar_roteador` liga.

O desenho simples é **um agente por número**, e aí não se cria roteador. A IA do
agente e a do classificador do roteador (provedor, modelo e chave) são da
plataforma: a ferramenta não recebe nem devolve chave.

### O roteador nasce desligado

Na tela o roteador nasce ativo. Pela ferramenta, não: roteador ativo decide quem
responde a cada mensagem do número e, com destino de funil, **move o negócio do
cliente** (o card vai para o funil de destino e o de origem é encerrado como
transferência, que não conta como perda). Isso é pôr no ar. Por isso montar
grava o roteador desligado (`implantar_configuracao`) e ligar é outra ferramenta,
com `colocar_no_ar`. O roteador não tem rascunho: ligado, ele não é editado pela
ferramenta (desliga, ajusta, religa), como as automações.

---

## 3. Todas as ferramentas

São **64** ferramentas no servidor: as 57 desta página e as 7 da migração
([`mcp-de-migracao.md`](mcp-de-migracao.md)). As quatro mais novas (.79, item 8 do
mapa: painéis prontos e link para o dono) são `plataforma_ver_paineis`,
`plataforma_ver_links_do_dono`, `plataforma_garantir_link_do_dono` e
`plataforma_revogar_link_do_dono`. As quatro da .76 são
`plataforma_garantir_planos_de_tarefa`, `plataforma_configurar_canal`,
`plataforma_garantir_fonte_de_formulario` e `plataforma_configurar_banco_externo`.

### Leitura (nenhuma operação: qualquer token de plataforma lê)

| ferramenta | o que devolve | reexecução |
|---|---|---|
| `plataforma_listar_clientes` | as organizações da instalação, com busca por nome | leitura |
| `plataforma_ver_cliente` | o retrato de um cliente: módulos, números, saldo e, em `configuracao`, a limpeza automática de mídia, o freio do passo "a IA decide", o bloqueio de afirmação clínica e quantos planos de tarefa existem | leitura |
| `plataforma_listar_modulos` | os módulos que se vendem separado | leitura |
| `plataforma_ver_saude` | o estado da instalação, e se a chave que cifra o CPF dos contatos está semeada (só sim ou não; o valor nunca sai) | leitura |
| `plataforma_ver_implantacao` | o **checklist**: por área, o que está pronto, o que falta (com a ferramenta) e o que é com uma pessoa (com a tela) | leitura |
| `plataforma_listar_modelos` | os modelos e vocabulários que as outras ferramentas aceitam: modelos de follow-up, pacotes e capacidades do agente, gatilhos e ações de automação, passos do funil, tipos de campo | leitura |
| `plataforma_ver_funis` | os funis inteiros: etapas, passo do agente, campos, motivos | leitura |
| `plataforma_ver_agentes` | os agentes, a versão no ar, o rascunho, o limiar de sentimento, a passagem por assunto jurídico e o que falta para publicar; com `agente`, o horário de atendimento e o aviso de fora do horário; o bloqueio de afirmação clínica da empresa (`seguranca_da_empresa`); e os **roteadores** de intenção (número, se está ligado, agente reserva, janela de contexto do classificador e cada intenção com o agente e o funil de destino) | leitura |
| `plataforma_ver_catalogo` | os produtos e serviços, com busca e paginação | leitura |
| `plataforma_ver_obrigacoes` | os documentos e obrigações com vencimento: contadores (vencidos, vencendo em 30 dias, pedidos sem resposta, em dia), os itens por situação e o catálogo de tipos por funil | leitura |
| `plataforma_ver_configuracao` | o conteúdo do que está configurado, por seção (etiquetas, memória, conhecimento, follow-ups, automações, agenda, equipe, números, atendimento, mensagens, planos de tarefa, fontes de formulário e banco externo). Em números, também os dias da prospecção, se guarda o histórico, se está pausado e as pausas agendadas; em atendimento, o freio do passo "a IA decide"; nas fontes, nunca o segredo; no banco externo, nunca endereço, usuário ou senha | leitura |
| `plataforma_ver_followup` | um fluxo de follow-up por dentro: gatilho, nós, textos e esperas, a etapa de destino das caixas de mover e as etiquetas das caixas de etiquetar, e as setas entre os nós | leitura |
| `plataforma_ver_conversoes` | as conversões de um cliente: as conexões da Meta e do Google **sem segredo**, se a identidade da Meta (ID da Página ou da conta do WhatsApp Business) está preenchida, as regras por funil das duas plataformas, a chave dos leads de formulário, o evento recomendado para cada etapa e os 20 últimos envios com a situação e o motivo | leitura |
| `plataforma_listar_demonstracoes` | as empresas de demonstração por segmento (construtora, clínica odontológica, indústria, academia) e a bancada: se existe, o id, quando a semente foi aplicada e as contagens; e qualquer outra organização marcada como demonstração | leitura |
| `plataforma_diagnosticar_conversoes_da_meta` | o diagnóstico da Meta, o mesmo do botão "Testar conexão": token, destino, permissão, último envio aceito, recusas em 7 dias e modo de teste. Faz três leituras na Meta com o token do cliente; nenhum evento é enviado | leitura |
| `plataforma_ver_paineis` | os doze PAINÉIS PRONTOS de um cliente (resultado do mês, meta do mês, funil, de onde vêm, por que perdemos, atendimento, tempo de resposta, agenda, follow-up, anúncios, previsão, assuntos), com os números do motor de conta no banco (`fn_mia_relatorio`, 9030): todas as linhas do período, no fuso e na moeda da empresa. Período 7, 30 ou 90 dias, ou o mês; funil opcional; com ou sem valores em reais. Nada de custo de IA, gasto com anúncio, nome ou contato | leitura |
| `plataforma_ver_links_do_dono` | os links para o dono do negócio de um cliente: para quem, o endereço, a situação (ativo, vencido, revogado), os painéis, o período, se mostra valores, a validade, o último acesso e quantos acessos | leitura |

### Operações que já existiam

| ferramenta | operação | o que faz | reexecução |
|---|---|---|---|
| `plataforma_criar_cliente` | `criar_cliente` | cria a organização; quem criou o token entra como admin | a mesma `chave` devolve a mesma organização |
| `plataforma_liberar_modulo` | `liberar_modulo` | libera ou tira um módulo vendido | liberar de novo não duplica |
| `plataforma_lancar_credito` | `lancar_credito` | lança crédito ou estorno na carteira de disparo | **não** é reexecutável: cada chamada lança |
| `plataforma_definir_preco` | `definir_preco` | define o preço por mensagem de disparo | grava o mesmo valor |

### Empresas de demonstração por segmento

As quatro demonstrações (construtora, clínica odontológica, indústria e academia) e a
bancada de teste saem da mesma semente do terminal (`scripts/cliente-modelo.ts`); o que
cada uma mostra está em [cliente-modelo.md](cliente-modelo.md). A gravação vai pelo
Postgres do app (`SUPABASE_DB_URL`), numa transação só, em poucos segundos: a resposta já
traz as contagens. Sem `SUPABASE_DB_URL` no app, a recusa ensina o caminho do terminal
(`--sql`).

| ferramenta | operação | o que faz | reexecução |
|---|---|---|---|
| `plataforma_criar_demonstracao` | `criar_cliente` | cria a empresa de demonstração de um segmento, inteira e travada; quem criou o token e os `emails_de_acesso` entram como admin | se a do segmento já existe, não grava nada e devolve a que existe (`ja_estava`) |
| `plataforma_reaplicar_demonstracao` | `implantar_configuracao` | regrava os dados fictícios de uma demonstração que já existe e renova as datas; recusa empresa que não é a do segmento ou que está desmarcada | ids estáveis: rodar de novo não duplica nada |

### Montagem · operação `implantar_configuracao`

| ferramenta | o que faz | chave natural | teto por chamada |
|---|---|---|---|
| `plataforma_configurar_empresa` | nome, razão social, CNPJ, país, fuso, idioma, moeda, modo de venda, retenção de mídia, a limpeza automática de mídia antiga (ligada, apaga sem volta), encarregado e política de privacidade; e, desde a .79, a **meta do mês** (`meta_do_mes`: o faturamento dos ganhos da empresa inteira, em centavos, no mês corrente ou no `mes` pedido), pelo mesmo upsert da tela de Desempenho (`lib/crm/metas/gravar.ts`). É ela que vira a barra do painel "Meta do mês" | a organização; a meta, pelo mês | só os campos que vieram mudam |
| `plataforma_configurar_atendimento` | modo de distribuição (manual, rodízio ou menor carga), visibilidade das conversas, devolução para a IA, quanto a IA espera depois de uma resposta pelo celular, o nome de quem fala (atendente ou IA) em negrito na mensagem, e o freio da empresa para o passo "a IA decide" das automações | a organização | idem |
| `plataforma_garantir_funil` | funil, etapas na ordem, passo do agente por etapa, probabilidade, janela de esfriando (`prazo_esperado_horas`, pela régua da tela: 1 a 8760 horas inteiras) e cor, campos personalizados (com obrigatoriedade por etapa), motivos de perda e de ganho, vocabulário (desde a .79 também `compromisso` e `compromisso_plural`, como o segmento chama o que a agenda marca: o plural é o título do painel pronto de agenda) | nome do funil; nome da etapa; `key` do campo; rótulo do motivo | 20 etapas |
| `plataforma_garantir_produtos` | catálogo em lote, com preço em centavos ou em texto (`"R$ 189,90"`); item com problema é recusado com motivo e não derruba os outros | código do produto (sem código, o nome) | 200 produtos |
| `plataforma_garantir_etiquetas` | etiquetas no vocabulário, com cor e descrição | nome da etiqueta, sem diferenciar maiúscula | 50 etiquetas |
| `plataforma_gravar_memoria` | as regras da casa (documento que todos os agentes seguem) e as anotações | o documento é um só; anotação pelo título | 50 anotações |
| `plataforma_garantir_conhecimento` | material por **texto**: perguntas e respostas, ou documento | nome do material | 200 perguntas; 200 mil caracteres |
| `plataforma_garantir_followup` | instala um fluxo a partir de um modelo e ajusta textos, esperas, etapa do gatilho e política; no gatilho de silêncio, o teto do silêncio e a pausa antes de recomeçar; e garante as caixas que mexem no negócio sem falar com o cliente (`mover_no_funil` e `etiquetar`), antes de um nó do fluxo | nome do fluxo; a caixa, pelo lugar onde está | um fluxo; 10 caixas de cada tipo |
| `plataforma_garantir_agente` | cria ou altera o **rascunho** do agente: prompt, capacidades por pacote, funis, materiais, follow-ups, palavras de passagem, passagem por assunto jurídico, horário, aviso de fora do horário, número. O limiar de sentimento é do cadastro e vale na hora; o bloqueio de afirmação clínica é da EMPRESA (todos os agentes) e vale na hora | nome do agente | um agente |
| `plataforma_garantir_roteador` | cria ou ajusta o roteador de intenção de um número, **desligado**: nome, número, agente reserva, a janela de contexto do classificador (0 a 16 mensagens, 8 no roteador novo) e as intenções, cada uma com o agente e o funil (e a etapa) de destino do negócio | nome do roteador; nome da intenção | 20 intenções |
| `plataforma_garantir_automacao` | cria ou ajusta uma regra de automação, **desligada**. É também o webhook de saída: os gatilhos de ganho, perda, reabertura e troca de responsável com a ação `call_webhook`. Aceita o passo "a IA decide" (`ai_decide`, com as ações das opções conferidas pela mesma régua), aplicar um plano de tarefas, etiqueta no contato, o recorte por fonte de formulário e o funil e a etapa dos gatilhos de tempo | nome da regra | uma regra |
| `plataforma_garantir_planos_de_tarefa` | os planos de tarefa (a sequência de tarefas que uma automação aplica ao negócio), com título, prazo, prioridade e responsável de cada passo | o `id` do plano, ou o nome | 50 planos; 30 passos por plano |
| `plataforma_garantir_fonte_de_formulario` | a fonte de formulário: destino (funil e etapa), as perguntas do formulário, o mapeamento dos campos, o endereço de retorno e a autorização de IA na captação (que exige a assinatura, posta pela pessoa). Devolve o caminho do endereço de captação | nome da fonte | uma fonte; 20 perguntas |
| `plataforma_configurar_canal` | de um número: os dias da prospecção, guardar o histórico (só QR Code; desligar pede confirmação escrita) e a pausa agendada de até 24 horas (de um número ou de todos), com o cancelamento. Nunca credencial, token ou número | o número; a pausa, pelo número e pela janela | um número |
| `plataforma_configurar_banco_externo` | a coluna que identifica o cliente nas conversas numa conexão de banco externo que já existe (telefone ou e-mail). Nunca lê nem devolve a conexão ou a senha | o nome da conexão | uma conexão |
| `plataforma_garantir_tipos_de_obrigacao` | o catálogo de tipos de documentos e obrigações de um funil, inclusive `modelo_do_segmento` (os tipos prontos do segmento) | nome do tipo dentro do funil | 60 tipos por funil |
| `plataforma_garantir_tipos_de_agendamento` | tipos de agendamento (duração, local, categoria), com o lembrete desligado | nome do tipo | 30 tipos |
| `plataforma_definir_jornada` | a jornada de uma pessoa da equipe, pelo e-mail | a pessoa | uma pessoa |
| `plataforma_garantir_respostas_prontas` | respostas prontas compartilhadas da equipe | título da resposta | 50 respostas |
| `plataforma_garantir_conversoes_da_meta` | o que cada etapa aberta de um funil informa à Meta (a régua do upstream, 0524): o evento padrão; com `usar_recomendado: true`, o sistema escolhe o evento pelo nome da etapa. A regra nasce **desligada** | a etapa do funil | 20 regras |
| `plataforma_garantir_conversoes_do_google` | o que cada etapa aberta informa ao Google Ads: o nome da conversão e o id da ação de conversão (que já tem de existir na conta do Google). A regra nasce **desligada** | a etapa do funil | 20 regras |

Todas respondem `criou`, `atualizou` ou `ja_estava`, item a item quando a chamada
é em lote.

### Pôr no ar · operação `colocar_no_ar`

| ferramenta | o que faz | reexecução |
|---|---|---|
| `plataforma_publicar_agente` | publica o rascunho do agente: ele passa a responder no número | sem rascunho novo, `ja_estava` |
| `plataforma_pausar_agente` | pausa ou retoma um agente sem despublicar | mesmo pedido, `ja_estava` |
| `plataforma_publicar_followup` | publica (ou desliga) um fluxo de follow-up | sem mudança no rascunho, `ja_estava` |
| `plataforma_ligar_automacao` | liga ou desliga uma regra | mesmo estado, `ja_estava` |
| `plataforma_ligar_roteador` | liga ou desliga o roteador de intenção: ligado, ele escolhe o agente a cada mensagem do número e as intenções com destino movem o negócio. Roteador sem intenção não liga, e só um fica ligado por número | mesmo estado, `ja_estava` |
| `plataforma_ligar_lembrete` | liga o lembrete de um tipo de agendamento, com antecedência e texto | mesmo pedido, `ja_estava` |
| `plataforma_submeter_modelo_whatsapp` | submete à Meta um modelo oficial de mensagem (só texto) | modelo que já existe na conta não é reenviado |
| `plataforma_ligar_conversoes` | liga ou desliga as regras de conversão por etapa de um funil, na Meta ou no Google: o sistema passa a mandar evento de cliente para a plataforma de anúncio. Ligar não envia o passado | mesmo pedido, `ja_estava` |
| `plataforma_ligar_leads_de_formulario_da_meta` | liga ou desliga a volta dos leads de formulário para a Meta | mesmo pedido, `ja_estava` |

### Equipe · operação `convidar_equipe`

| ferramenta | o que faz | reexecução |
|---|---|---|
| `plataforma_convidar_pessoas` | convida por e-mail, até 20 pessoas por chamada, cada uma com um papel (`viewer`, `agent`, `manager`, `admin`). Funciona também na empresa de demonstração. Convite que o banco não grava volta como `nao_gravou`, sem e-mail, e os outros seguem. Desde a `9023` cada convite emitido (`convidou`, `reenviou`) volta com `link_curto` (`https://<instalação>/c/<código>`), o mesmo link do e-mail, para mandar por WhatsApp | quem já é da equipe é pulado; convite pendente **não** é reenviado, salvo com `reenviar: true`, e volta **sem** link (o código do e-mail não fica guardado); `gerar_link: true` devolve um link NOVO sem e-mail, e o anterior, inclusive o do e-mail, deixa de valer |

O link curto (migration `9023`, `lib/team/link-curto.ts`): 12 caracteres de um
alfabeto sem os que se confundem (~59 bits), guardado só como hash (HMAC com o
segredo do servidor) na linha do convite. Cai no mesmo aceite
(`/team/accept-invite/<token>`), abrir não consome o convite, e ele vale enquanto
o link do e-mail valeria: morre quando o convite vence, é revogado (inclusive ao
marcar a empresa como demonstração) ou reenviado. Aceitar NÃO mata: o aceite do
upstream é repetível, e quem já aceitou e abre de novo cai no mesmo aceite, como
pelo link longo. Na tela, a ação "Copiar link do convite" da lista de
convites (aba Membros) faz o mesmo que `gerar_link`, e a tela Convidar membros
mostra o link do e-mail para copiar logo depois do envio.

### Link para o dono do negócio · operação `compartilhar_paineis`

O link abre, sem usuário nem senha e no celular, os painéis prontos escolhidos de
uma empresa, com o nome dela no topo e só números somados (nenhum nome, telefone
ou conversa de cliente, nem nome de quem é da equipe). Caixinha própria no token
porque o estrago é outro: não dá login a ninguém e não fala com o cliente final,
mas abre o faturamento e a meta a quem tiver o endereço.

| ferramenta | o que faz | reexecução |
|---|---|---|
| `plataforma_garantir_link_do_dono` | cria o link: para quem (rótulo livre, até 120 caracteres), os painéis, o período (`escolhe`, ou fixo em 7, 30, 90 dias ou o mês), se mostra valores em reais, o funil (opcional) e a validade (30, 90 ou 365 dias; padrão 90). Devolve o endereço; quem manda ao dono é uma pessoa | a chave é `para_quem`: link ATIVO com o mesmo nome e o mesmo conteúdo responde `ja_estava`; com outro conteúdo é ajustado no MESMO endereço (`atualizou`) |
| `plataforma_revogar_link_do_dono` | revoga pelo `link_id` ou por `para_quem` (os ativos com esse nome): quem abrir vê "não está disponível". Revogado não volta | revogado de novo responde `ja_estava` |

O link (migration `9031`, `lib/paineis/link.ts`): 24 caracteres do base32 de
Crockford (120 bits), DERIVADOS do id da linha por HMAC com o segredo do servidor;
no banco fica só o hash. Por isso "Copiar link" funciona a qualquer hora e
"Renovar" (do vencido, na tela) mantém o endereço. A página
(`/painel/<token>`) tem teto de 30 aberturas por minuto por IP, responde igual
(404) para link malformado, inexistente, vencido, revogado ou de empresa parada,
não manda dado nenhum para a prévia do WhatsApp, conta e audita cada abertura sem
identificar a pessoa, e usa metadados fixos. Na empresa de demonstração o link
funciona com os dados fictícios e a página avisa que é demonstração.

### Recusas

Uma recusa diz o campo, o que era esperado e mostra um exemplo que passa. Campo
desconhecido é recusado pelo nome (`etapa` no lugar de `etapas` não é ignorado
em silêncio). Operação que o token não tem é recusada antes de olhar o pedido, e
a recusa diz qual operação pedir.

### A empresa de demonstração

Na empresa de demonstração a montagem funciona inteira (é assim que ela é
preenchida), e nada sai para os contatos nem para fora: modelo oficial do
WhatsApp e automação ligada com webhook ou aviso de grupo são recusados com a
frase da trava, inclusive quando o webhook ou o aviso está entre as opções do passo
"a IA decide" (a trava do banco alcança esse caso desde a 9021, e a ferramenta de
ligar explica antes de chegar ao banco). **O convite de equipe é a exceção** (migration `9020`):
`plataforma_convidar_pessoas` funciona nela como em qualquer empresa, porque
fala com uma pessoa de verdade que quem administra escolheu, e a resposta avisa
que quem aceitar vai ver dados fictícios. É o jeito de dar acesso a quem ainda
não tem login; `emails_de_acesso`, em `plataforma_criar_demonstracao` e
`plataforma_reaplicar_demonstracao`, continua incluindo sem convite quem já tem.
Ela não tem número de
WhatsApp conectado, então nenhum agente é publicado lá. As regras de conversão
podem ser gravadas e ligadas nela, e nada é enviado, porque a conexão de
conversões ligada não existe lá: a resposta da ferramenta avisa.

### Documentos e obrigações

Três ferramentas, descritas em [`docs/fork/obrigacoes.md`](obrigacoes.md), seção 8.
Duas estão nas tabelas acima (`plataforma_ver_obrigacoes` e
`plataforma_garantir_tipos_de_obrigacao`). A terceira grava em lote e pede a
operação da migração:

| ferramenta | operação | o que faz | chave natural | teto por chamada |
|---|---|---|---|---|
| `plataforma_garantir_obrigacoes` | `importar_base` | cria ou atualiza os itens (documentos e atividades recorrentes) de um cliente; serve para a implantação e para migrar a planilha de vencimentos. A situação não é informada: mandam-se as datas. Não envia nada e não dispara aviso atrasado | tipo + a quem o item está ligado | 100 itens |

Os avisos são regras de automação: os cinco gatilhos `obrigacao.*` aparecem em
`plataforma_listar_modelos` (seção `automacoes`, com a configuração de cada um) e
são aceitos por `plataforma_garantir_automacao`. O checklist tem a área
`obrigacoes`, opcional: ela nunca entra em "falta".

### O que chegou do upstream 1.70 a 1.73

A regra é: função nova ou alterada do sistema chega ao MCP na mesma versão,
inclusive a que vem do upstream. Cada novidade de configuração da 1.70 à 1.73 foi
conferida no código. A prova de cada linha está em
`tests/unit/mcp-de-implantacao-novidades-do-upstream.test.ts`.

| novidade do upstream | versão | como o MCP alcança | operação |
|---|---|---|---|
| Aviso configurável para quem escreve fora do horário de atendimento | 1.72 | campo novo `aviso_fora_do_horario` em `plataforma_garantir_agente`. Trocar só o horário preserva o aviso que a tela gravou | `implantar_configuracao` |
| Limiar de sentimento do agente | 1.71 | campo novo `limiar_de_sentimento` em `plataforma_garantir_agente`. É do cadastro, e vale na hora | `implantar_configuracao` |
| Agente criado sem versão nasce com rascunho v1 | 1.73 | já alcançava: o espelho usa a mesma receita da rota (`mcpAgentDraftRecords`) | `implantar_configuracao` |
| Cada intenção do roteador leva o negócio para o funil de destino | 1.73 | ferramentas novas `plataforma_garantir_roteador` (com `destino` por intenção) e `plataforma_ligar_roteador` | `implantar_configuracao` e `colocar_no_ar` |
| Janela de esfriando editável por etapa | 1.70 | `prazo_esperado_horas` de `plataforma_garantir_funil` passou a gravar pela operação da tela de etapas, com a régua dela (1 a 8760 horas inteiras) | `implantar_configuracao` |
| Régua de campos obrigatórios valendo também na criação do negócio | 1.73 | já alcançava: `campos[].obrigatorio_em` de `plataforma_garantir_funil`. A importação de negócios segue isenta, como a captação | `implantar_configuracao` |
| Caixas "mover lead no funil" e "editar tag do lead" no follow-up | 1.70 | campos novos `mover_no_funil` e `etiquetar` em `plataforma_garantir_followup`. A publicação valida as caixas pela régua do upstream | `implantar_configuracao` |
| Gatilho de silêncio: teto do silêncio e pausa antes de recomeçar | 1.70 | campos novos `silencio_maximo_minutos`, `pausa_para_recomecar_minutos` e `pausa_conta_do_ultimo_envio` em `plataforma_garantir_followup` | `implantar_configuracao` |
| Catálogo editável pela tela, com `descricao` e `ativo` | 1.73 | já alcançava: `plataforma_garantir_produtos` grava os dois e `plataforma_ver_catalogo` devolve. O produto que entra pela ferramenta abre editável na tela nova (ver a seção 5) | `implantar_configuracao` |
| Webhook de saída com os gatilhos de ganho, perda, reabertura e troca de responsável | 1.71 | já alcançava: `plataforma_garantir_automacao` aceita os quatro gatilhos (a lista vem do upstream) e recusa, com a frase dele, a ação que fecharia laço | `implantar_configuracao` |
| Campos do formulário nas mensagens das automações (`{{servico}}`) | 1.70 | já alcançava: o texto da ação vai como veio. `plataforma_listar_modelos` ensina as marcações | `implantar_configuracao` |
| Mensagem mostra quem fala (atendente ou IA) em negrito | 1.70 | campo novo `assinatura` em `plataforma_configurar_atendimento` | `implantar_configuracao` |
| Distribuição por menor carga | 1.70 | `modo: "load"` em `plataforma_configurar_atendimento` (a lista de modos vem do upstream) | `implantar_configuracao` |
| Quanto a IA espera depois de uma resposta pelo celular | 1.70 | campo novo `ia_espera_apos_resposta_pelo_celular_minutos` em `plataforma_configurar_atendimento` | `implantar_configuracao` |
| Cadastrar como campo do lead o campo que o formulário mandou | 1.70 | já alcançava: `campos` de `plataforma_garantir_funil` grava pela mesma função do botão da tela | `implantar_configuracao` |
| Regras por etapa da Meta (a régua do upstream) | 1.70 | já alcançava desde a .72: `plataforma_garantir_conversoes_da_meta` e `plataforma_ligar_conversoes` | `implantar_configuracao` e `colocar_no_ar` |
| ID da Página (ou da conta do WhatsApp Business) para a venda de clique-para-WhatsApp | 1.70 | só leitura: `plataforma_ver_conversoes` e o checklist dizem se está preenchido. Preencher fica com a pessoa (seção 4) | leitura |
| Valor da venda lido da conversa quando o negócio está sem valor | 1.70 | nada a configurar: é automático | |

O que dessas versões fica com a pessoa está na seção 4, com o motivo.

### O que chegou do upstream 1.74 a 1.80 (.76)

Mesma regra, na fusão da v1.80. Cada novidade de configuração foi conferida no
código. A prova de cada linha está em
`tests/unit/mcp-de-implantacao-novidades-do-upstream-180.test.ts` (e a do dono do
contato em `tests/unit/mcp-de-migracao-contatos.test.ts` e
`tests/invariants/dono-do-contato-pela-plataforma.test.ts`).

| novidade do upstream | versão | como o MCP alcança | operação |
|---|---|---|---|
| Interruptor da limpeza automática de mídia antiga (0557) | 1.74 | campo novo `limpeza_automatica_de_midia` em `plataforma_configurar_empresa`, pela régua da tela (`tenantSchema`); a leitura em `plataforma_ver_cliente` e no checklist | `implantar_configuracao` |
| O passo "a IA decide" das automações (`ai_decide`) | 1.74 | `plataforma_garantir_automacao` aceita `ai_decide`; a ação de cada opção passa pelas mesmas conferências das de primeiro nível; a regra só nasce com `custo_de_token: true` | `implantar_configuracao` |
| Freio da empresa para o passo "a IA decide" | 1.76 | campo novo `ia_decide_nas_automacoes` em `plataforma_configurar_atendimento`, com a mescla e a auditoria da tela | `implantar_configuracao` |
| Planos de tarefa e a ação "aplicar um plano de tarefas" | 1.77 | ferramenta nova `plataforma_garantir_planos_de_tarefa`; `apply_task_plan` em `plataforma_garantir_automacao`, com o plano conferido | `implantar_configuracao` |
| Etiqueta da automação gravada no contato (`add_tag` com `destino`) | 1.80 | já alcançava: o schema do upstream valida; `plataforma_listar_modelos` ensina | `implantar_configuracao` |
| Regra recortada por fonte de formulário (`webhook_source_id`) | 1.78 | a fonte é conferida contra a empresa, com a frase da rota | `implantar_configuracao` |
| Funil e etapa nos gatilhos de tempo (sem se perder ao salvar) | 1.79 | já gravava a configuração inteira; os ids passam a ser conferidos contra a empresa | `implantar_configuracao` |
| Passagem para uma pessoa por assunto jurídico, por agente (0616) | 1.79 | campo novo `passagem_por_assunto_juridico` em `plataforma_garantir_agente` (do rascunho); a publicação deixa `ai_agent.legal_handoff_changed` com o autor do token | `implantar_configuracao` |
| Bloqueio de afirmação clínica (camada de segurança da empresa) | 1.74 | campo novo `bloquear_afirmacao_clinica` em `plataforma_garantir_agente`; vale para todos os agentes da empresa, na hora | `implantar_configuracao` |
| Janela de contexto do classificador do roteador | 1.74 | campo novo `mensagens_de_contexto` em `plataforma_garantir_roteador`; roteador novo nasce com 8, como na rota | `implantar_configuracao` |
| Dias da semana da prospecção por conexão (0642) | 1.80 | ferramenta nova `plataforma_configurar_canal` (`dias_da_prospeccao`) | `implantar_configuracao` |
| Guardar o histórico do número (QR Code) | 1.74 | `plataforma_configurar_canal` (`guardar_historico`), pela função da tela; desligar pede confirmação escrita | `implantar_configuracao` |
| Pausa agendada de conexões (0626) | 1.79 | `plataforma_configurar_canal` (`pausa_agendada` e `cancelar_pausa_agendada`), com as recusas da rota | `implantar_configuracao` |
| Perguntas do formulário por fonte (0595) | 1.78 | ferramenta nova `plataforma_garantir_fonte_de_formulario` (`perguntas`) | `implantar_configuracao` |
| Autorizar o atendimento por IA a partir do formulário (0577) | 1.76 | `plataforma_garantir_fonte_de_formulario` (`autorizar_ia_na_captura`); exige a assinatura, que fica com a pessoa | `implantar_configuracao` |
| Coluna que identifica o cliente no banco externo (0558) | 1.74 | ferramenta nova `plataforma_configurar_banco_externo`; recusa com o módulo da instalação desligado | `implantar_configuracao` |
| O vendedor dono do contato, a "carteira do cliente" do upstream (0622) | 1.79 | campo novo `vendedor_responsavel` em `plataforma_importar_contatos`, gravado pela função do fork da migration `9022` (a porta do upstream exige gerente membro como ator) | `importar_base` |
| Chave do CPF semeada no banco (0597) | 1.78 | `plataforma_ver_saude` diz sim ou não (`chave_do_cpf`), sem nunca devolver o valor | leitura |
| Paleta das etiquetas com o verde e o vermelho mais escuros | 1.74 | já alcançava: a cor antiga é lida como a nova pela mesma régua da tela | `implantar_configuracao` |
| Limite de assentos do plano no convite (cobrança do revendedor) | 1.78 | `plataforma_convidar_pessoas` faz a mesma conta da rota e recusa com a mesma frase; com a cobrança desligada, não há limite | `convidar_equipe` |

Ficaram de fora desta fusão, por decisão: o plano de cobrança e a assinatura do
revendedor (a cobrança do upstream fica desligada no fork), excluir organização,
trocar o e-mail de login de alguém e marcar contato como pessoal (é decisão do
gerente, na tela). Também o modo "o Jev escolhe o agente sozinho" do roteador
(depende da chave do Jev e do aceite de mandar a conversa a um fornecedor de fora,
como as tarefas do Jev) e as camadas de segurança que custam IA por mensagem
(promessa semântica e tentativa de burlar o agente): é custo na conta da plataforma,
e fica com quem opera, na tela de Segurança do agente.

---

## Migração de outro CRM

Trazer a base que o cliente já tinha (empresas, contatos, negócios e materiais) é feito por outras sete ferramentas do mesmo servidor, com duas caixinhas próprias no token ("Importar base" e "Importar materiais"). A ordem, o formato de cada lista e os cuidados estão em [`mcp-de-migracao.md`](mcp-de-migracao.md). No roteiro acima, a migração entra depois da equipe e dos funis, e antes de pôr o agente no ar. Importar não envia nada a ninguém. No checklist (`plataforma_ver_implantacao`) ela aparece como a área "Base importada", que é opcional e nunca conta como pendência.

## 4. O que fica de fora, e por quê

O checklist (`plataforma_ver_implantacao`) lista cada item abaixo em
`com_o_humano`, com a tela e o caminho.

| o que | onde se faz | por que não é ferramenta |
|---|---|---|
| Conectar o número de WhatsApp | Conexões · `/app/connections` | é acesso do cliente: o QR Code é lido no celular dele, e a conta oficial pede o login dele na Meta |
| Chave do provedor de IA e modelo padrão | Admin › IA · `/admin` | a IA dos agentes é da plataforma; chave é credencial e não entra por ferramenta |
| Envio de e-mail da instalação (SMTP) | Admin › E-mail · `/admin` | servidor e senha são credenciais |
| Identificador do destino e token de conversões da Meta, e a autorização do Google | Configurações › Conversões · `/app/settings/conversoes` | credencial da conta de anúncios do cliente. As regras por etapa e a chave dos leads de formulário entram por ferramenta; a credencial, não |
| Criar a ação de conversão na conta do Google Ads | Configurações › Conversões · `/app/settings/conversoes` | escreve na conta de anúncios do cliente; a ferramenta recebe o id de uma ação que já existe |
| Agenda do Google ou do Outlook | Agenda · `/app/agenda` | é a conta pessoal de cada pessoa: o login é dela |
| Prazos da agenda (confirmação, proteção, validade do pedido) | Configurações › Agenda · `/app/settings/tenant/agenda` | a gravação exige uma pessoa logada com verificação em duas etapas; os padrões valem até alguém mexer |
| Amarrar um roteiro de atendimento a uma intenção do roteador, e testar a classificação | IA › Roteadores · `/app/ai/routers` | roteiro de atendimento é outra superfície, sem ferramenta de montagem; o teste chama o classificador com a mensagem digitada na tela. O roteador em si é montado por ferramenta |
| Exigir a verificação em duas etapas da equipe (a partir de qual papel, com quantos dias de carência) | Configurações › Segurança · `/app/settings/security` | é regra de acesso: a tela pede o código do segundo fator de quem muda a regra, e um token não apresenta segundo fator. Exigir sem carência tranca a equipe para fora |
| ID da Página do Facebook (ou da conta do WhatsApp Business) das conversões da Meta | Configurações › Conversões · `/app/settings/conversoes` | é a identidade da conta de anúncios do cliente, preenchida junto da credencial; um id errado vincula a venda a outra conta. A leitura diz se está preenchido |
| Reprocessar uma conversão que ficou pendente | Configurações › Conversões · `/app/settings/conversoes` | é operação do dia a dia sobre uma venda, e envia dado do cliente final para a plataforma de anúncio: não é montagem |
| Ligar tarefas do Jev (por exemplo "Conferir o campo antes de a IA gravar") | IA › Provedores · `/app/ai/providers` | depende da chave do Jev e do aceite de mandar a conversa a um fornecedor de fora: os dois são atos de pessoa. Não há ferramenta nenhuma do Jev |
| Assinatura (HMAC) de uma fonte de formulário | Automações › Fontes · `/app/webhooks` | o segredo aparece uma vez na tela: é credencial. A fonte em si (destino, perguntas, autorização de IA) entra por `plataforma_garantir_fonte_de_formulario`; a autorização de IA só liga depois da assinatura |
| Ligar, desligar ou apagar uma fonte de formulário | Automações › Fontes · `/app/webhooks` | desligar faz o formulário que já está no site parar de virar contato na hora, sem ninguém ver do outro lado |
| Criar, testar ou apagar a conexão com o banco externo do cliente | Dados externos · `/app/integracao-dados` | endereço, usuário e senha são credencial do cliente. A coluna do cliente nas conversas entra por `plataforma_configurar_banco_externo` |
| Pausar um número AGORA, e o ritmo de envio (intervalos, janelas, teto diário, aquecimento) | Conexões · `/app/connections` | a pausa imediata é operação do dia; a pausa AGENDADA (janela de manutenção) e os dias da prospecção entram por `plataforma_configurar_canal` |
| Plano e cobrança do cliente | Configurações › Plano e cobrança | a cobrança do revendedor do upstream fica desligada no fork |
| Marcar um contato como pessoal | a ficha do contato | é decisão do gerente sobre um contato, não montagem |
| CSS personalizado da marca | Admin › Marca · `/admin/marca` | é da instalação inteira, e não de um cliente; e é cosmético |
| Renomear, juntar ou excluir etiqueta | Configurações › Etiquetas · `/app/settings/tags` | mexe em todos os contatos, negócios e conversas que carregam o nome: é operação, não montagem |
| Enviar arquivo (PDF, planilha) ou site como conhecimento | IA › Conhecimento · `/app/ai/knowledge/sources` | upload não cabe numa chamada de ferramenta; por aqui entra o que é texto |
| Modelo oficial com cabeçalho de imagem, vídeo ou documento | Configurações › Modelos · `/app/settings/templates` | a amostra de mídia é enviada por upload |
| Segredo de webhook numa automação | Automações · `/app/webhooks` | segredo é credencial |
| Grupo de WhatsApp que recebe os avisos de passagem para humano | Admin › Número de avisos · `/admin` | o grupo é escolhido de uma lista; um id errado manda nome e resumo de lead para o lugar errado |
| Quais atendentes recebem as conversas de cada número | Configurações › Atendimento · `/app/settings/atendimento` | depende do número conectado e de a equipe já ter aceitado o convite |
| Apagar ou arquivar agente, funil e material | a tela de cada um | a implantação monta; desfazer é decisão de uma pessoa |

Também ficaram de fora, por desenho:

- **Trocar o modelo de IA de um agente.** A escolha é da plataforma.
- **A coluna `requires_human` da etapa.** Só o motor antigo, desligado, a lia. O
  que faz o agente parar e chamar uma pessoa hoje são as palavras de passagem e
  a capacidade de passagem, que `plataforma_garantir_agente` configura.
- **Importar contatos, empresas e negócios de outro CRM.** É outra entrega, com
  ferramentas próprias.
- **Login por OAuth no MCP.** O acesso é pelo token de plataforma.
- **Relatórios de operação** que o upstream trouxe na 1.71 à 1.73: a análise do
  funil (`GET /api/v1/metrics/funil`), o relatório por etiqueta e a taxa
  histórica e o tempo por etapa. São leitura de operação, não configuração de
  implantação, e a conta de cada um está montada dentro da rota. A análise do
  funil ganhou tela no fork na .79 (`/app/paineis/funil`, por cima da conta dele);
  os números que a implantação confere saem de `plataforma_ver_paineis`.
- **Empresas do upstream (`companies`).** A consulta de CNPJ, a edição e a
  exclusão da 1.72 são da tela dele. O fork tem as próprias empresas
  (`crm_empresas`), que entram por `plataforma_importar_empresas`. As duas não
  foram unificadas.
- **Prospecção.** As novidades da 1.70 (escolher as empresas da fila, ajustar o
  ritmo de campanha pausada) são operação de campanha, e o MCP de plataforma não
  tem ferramenta de prospecção.

---

## 5. Para quem mexe no código

- As ferramentas moram em `lib/mcp-plataforma/ferramentas/`, uma área por
  arquivo, e entram no servidor por **um** ponto: o array `FERRAMENTAS` de
  `lib/mcp-plataforma/ferramentas.ts`.
- As operações moram em **um** array, `OPERACOES`, em
  `lib/mcp-plataforma/operacoes.ts`. A tela de tokens lista o array: chave nova
  aparece sozinha, sem migration (a coluna `operacoes` não tem lista fechada no
  banco).
- O checklist é uma lista de **áreas** (`AREAS_DO_CHECKLIST`, em
  `lib/mcp-plataforma/checklist/areas.ts`). Cada área é uma função que recebe o
  contexto e a organização e devolve o que está pronto, o que falta e o que é só
  pela tela. Área nova entra com uma linha.
- O que cada ferramenta faz no banco está em `lib/implantacao/`. Onde a lógica
  estava presa numa rota, ela foi tirada para uma função que a rota e a
  ferramenta chamam (funil, mapeamento do agente, configuração do funil,
  material de conhecimento, contrato dos tipos de agendamento). Onde a rota é
  fina, a operação monta a mesma sequência com as mesmas funções de biblioteca,
  e `tests/unit/mcp-de-implantacao-espelhos.test.ts` reprova quando o código da
  rota muda, para alguém reler o espelho.
- Uma migration só para as ferramentas: a `9022`
  (`fn_mia_definir_dono_do_contato_pela_plataforma`), porque a porta do dono do
  contato do upstream exige um gerente membro da empresa como ator, e o token de
  plataforma não é membro. Ela copia o corpo de `fn_definir_carteira_do_cliente`,
  e a cerca dos espelhos guarda a impressão da função do upstream: mudou lá,
  reprova aqui. O resto cabe nas tabelas que existem. Desde
  a .72 as de conversões da Meta gravam na régua do UPSTREAM
  (`meta_ads_conversion_rules`, 0524), pela gravação da tela dele, e a volta dos
  leads de formulário na chave da 9017
  ([`conversoes-da-meta.md`](conversoes-da-meta.md)).
- Os painéis prontos e o link para o dono (.79) moram em `lib/paineis/`: o
  catálogo (`catalogo.ts`, espelho de `fn_mia_relatorio_catalogo`), a porta do
  motor (`motor.ts`), os doze painéis (`calcular.ts`) e o link (`link.ts`). A
  conta é do banco (migration `9030`); a tabela do link é a `9031`. A tela, a
  página pública e as ferramentas chamam as MESMAS funções.
- O token `dsk_` do upstream (1.70, #2028) passou a administrar agentes, fluxos de
  follow-up, prospecção e tipos de agendamento pelas MESMAS rotas da tela, só
  trocando a autenticação (`resolveAuthDual`). Não nasceu handler reutilizável
  novo: as funções compartilhadas de cima continuam sendo o caminho do MCP, e as
  rotas relidas tiveram a impressão regravada na cerca dos espelhos. A trava da IA
  vale também para o token (`lib/ai/trava-da-ia-na-rota.ts`: o token nunca
  escolhe IA).

Pontos de ligação no código do upstream (a lista fechada, para a sincronização):

| arquivo do upstream | o que mudou |
|---|---|
| `app/api/v1/pipelines/route.ts` | o `POST` chama `criarFunil` (`lib/pipelines/pipeline-operations.ts`) |
| `app/api/v1/pipelines/[id]/route.ts` | o `PATCH` chama `atualizarFunil` (mesmo arquivo) |
| `app/api/v1/pipelines/[id]/agent-mapping/route.ts` | o `PUT` chama `gravarMapeamentoDoAgente` (`lib/leads/agent-mapping-operations.ts`) |
| `app/actions/settings/updatePipelineConfig.ts` | chama `gravarConfiguracaoDoFunil` (`lib/pipelines/pipeline-config.ts`) |
| `app/api/v1/ai/knowledge/sources/route.ts` | o `POST` chama `criarMaterial` (`lib/ai/rag/criar-material.ts`) |
| `app/api/v1/agenda/tipos/route.ts` | importa o contrato de `lib/agenda/tipos-de-agendamento.ts` |
| `app/actions/settings/salvarRegrasDeConversaoGoogle.ts` | chama `gravarRegrasDeConversaoGoogle` (`lib/conversoes/gravar-regras-google.ts`) |
| `app/actions/settings/salvarRegrasDeConversaoMeta.ts` | chama `gravarRegrasDeConversaoMeta` (`lib/conversoes/gravar-regras-meta.ts`) |
| `tests/unit/identificadores-que-cruzam-fronteira.test.ts` | o registro do upload aponta para `lib/ai/rag/criar-material.ts` |
| `tests/unit/agenda-reativar-tipo.test.ts` | lê o contrato no arquivo novo, com um controle de que a rota o importa |
| `lib/catalogo/edicao-do-produto.ts` | a lista de origens que o CRM escreve soma as do fork (`lib/catalogo/origens-do-fork.ts`): sem isso, a tela de edição do upstream 1.73 abria somente leitura todo produto que entrou por `plataforma_garantir_produtos` ou pela semente de demonstração, como se viesse de uma integração |

Em cada rota a mudança é a mesma: o miolo saiu para uma função com o comentário
`FORK MIA`, e a rota ficou com a autenticação, a leitura do pedido e a resposta.
Se o upstream mexer no miolo de uma delas, o conflito aparece na fusão, e a
mudança dele entra na função compartilhada.

Testes:

| arquivo | o que mede |
|---|---|
| `tests/unit/mcp-de-implantacao-ferramentas.test.ts` | o catálogo: descrições, exemplos que passam no próprio esquema, a guarda da operação, organização inexistente, recusa que ensina, auditoria |
| `tests/unit/mcp-de-implantacao-operacoes.test.ts` | cada ferramenta: o que grava, a reexecução, as recusas e a empresa de demonstração |
| `tests/unit/mcp-de-implantacao-conversoes.test.ts` | as seis ferramentas de conversões: o que gravam, que montar não liga, a reexecução, as recusas, a resposta sem segredo e a empresa de demonstração |
| `tests/unit/mcp-de-implantacao-novidades-do-upstream.test.ts` | cada novidade do upstream 1.70 a 1.73: o campo ou a caixa nova passa pela ferramenta (o que grava, a reexecução, a recusa que ensina, a leitura), e as duas ferramentas do roteador |
| `tests/unit/mcp-de-implantacao-novidades-do-upstream-180.test.ts` | cada novidade do upstream 1.74 a 1.80, no mesmo molde, as quatro ferramentas novas e a prova de que os tipos de ação da ferramenta são exatamente os do upstream |
| `tests/unit/mcp-de-implantacao-paineis.test.ts` | as quatro ferramentas dos painéis e do link para o dono (.79): a contagem da lista (64), a caixinha `compartilhar_paineis`, que o garantir não duplica e ajusta no mesmo endereço, a revogação, a leitura e a demonstração; e a meta do mês em `plataforma_configurar_empresa` |
| `tests/invariants/motor-de-conta-dos-relatorios.test.ts` | o motor de conta (9030) no Postgres de verdade: a regra de data e o fuso, sem o teto de 1000 linhas, as etiquetas, o "Sem …" e o "Outros", a meta, quem vê o quê (atendente, gestor, outra empresa, anon, plataforma) e a situação da obrigação igual à de `lib/obrigacoes/situacao.ts` |
| `tests/invariants/link-dos-paineis-para-o-dono.test.ts` | a tabela do link (9031): só o servidor lê e escreve, as constraints, o funil de outra empresa e a contagem de acesso só em link vivo |
| `tests/invariants/dono-do-contato-pela-plataforma.test.ts` | a função da 9022 no Postgres de verdade: o controle negativo (a porta do upstream recusa o ator da plataforma), o mesmo efeito da porta do upstream, as recusas do ator e que só o `service_role` executa |
| `tests/unit/produto-da-implantacao-se-edita-na-tela.test.ts` | o produto que entrou pela implantação ou pela demonstração abre editável na tela do upstream, e a lista de origens do fork não envelhece |
| `tests/unit/mcp-de-implantacao-espelhos.test.ts` | as rotas espelhadas não mudaram sem alguém reler o espelho, e a função do upstream que a 9022 copia também não |
| `tests/unit/mcp-de-implantacao-pela-porta-http.test.ts` | o mesmo servidor pela rota HTTP de verdade, com o cabeçalho `Authorization` |
| `tests/invariants/mcp-de-implantacao-ponta-a-ponta.test.ts` | o roteiro inteiro no Postgres de verdade, e que rodar de novo não muda uma linha |
| `tests/unit/mcp-de-demonstracao.test.ts` | as ferramentas das demonstrações sem banco: a operação de cada uma e a recusa que ensina o `--sql` quando o app não tem `SUPABASE_DB_URL` |
| `tests/invariants/mcp-de-demonstracao.test.ts` | criar, criar de novo e reaplicar uma demonstração no Postgres de verdade: a guarda da operação, a trava de pé, nada em fila, e as recusas do slug de outra empresa e da demonstração desmarcada |
| `tests/invariants/pg-como-supabase-mia.test.ts` | o adaptador de teste que o invariante acima usa (`tests/pg-como-supabase-mia.ts`, um embrulho ao lado do adaptador do upstream) |
