# MCP de implantação · o agente implanta um cliente sem ninguém clicar na tela

O MCP de **plataforma** (`/api/mcp/plataforma`) já criava o cliente, liberava
módulo e lançava crédito. Agora ele também **monta o cliente por dentro**: dados
da empresa, funil, catálogo, etiquetas, memória, conhecimento, follow-up, agente
de IA, automações, agenda, equipe, mensagens prontas e as regras de conversão
para a Meta e o Google. Uma sessão do Claude Code
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
   | `implantar_configuracao` | montar tudo, inclusive os **rascunhos** de agente, follow-up e automação | sempre |
   | `colocar_no_ar` | publicar e pausar agente, publicar follow-up, ligar automação, ligar lembrete, submeter modelo à Meta, ligar regra de conversão e a volta dos leads de formulário | quando o agente também publica |
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
| 4 | Dados da empresa (nome, CNPJ, fuso, modo de venda) e distribuição do atendimento | `plataforma_configurar_empresa`, `plataforma_configurar_atendimento` | agente |
| 5 | Funil, etapas, campos e motivos | `plataforma_garantir_funil` | agente |
| 6 | Catálogo, em lote | `plataforma_garantir_produtos` | agente |
| 7 | Etiquetas | `plataforma_garantir_etiquetas` | agente |
| 8 | Memória: as regras da casa e as anotações | `plataforma_gravar_memoria` | agente |
| 9 | Conhecimento por texto (perguntas e respostas, documento) | `plataforma_garantir_conhecimento` | agente |
| 10 | Instalar os follow-ups (rascunho) | `plataforma_listar_modelos`, `plataforma_garantir_followup` | agente |
| 11 | Criar o agente de IA (rascunho), com o funil, os materiais e os follow-ups | `plataforma_garantir_agente` | agente |
| 12 | Automações (nascem desligadas), tipos de agendamento, jornada e respostas prontas | `plataforma_garantir_automacao`, `plataforma_garantir_tipos_de_agendamento`, `plataforma_definir_jornada`, `plataforma_garantir_respostas_prontas` | agente |
| 13 | **Conectar o número de WhatsApp** | tela **Conexões** (`/app/connections`) | **pessoa do cliente** |
| 14 | Conferir o rascunho com o cliente antes de pôr no ar | `plataforma_ver_agentes`, `plataforma_ver_followup` | agente e pessoa |
| 15 | Publicar os follow-ups e o agente | `plataforma_publicar_followup`, `plataforma_publicar_agente` | agente |
| 16 | Ligar as automações e os lembretes | `plataforma_ligar_automacao`, `plataforma_ligar_lembrete` | agente |
| 16a | Conversões (opcional, para quem anuncia): montar as regras por etapa, e ligar depois de a pessoa conectar a conta de anúncios | `plataforma_ver_conversoes`, `plataforma_garantir_conversoes_da_meta`, `plataforma_garantir_conversoes_do_google`, `plataforma_ligar_conversoes`, `plataforma_ligar_leads_de_formulario_da_meta` | agente (a conexão é com a pessoa do cliente) |
| 17 | Convidar a equipe | `plataforma_convidar_pessoas` | agente |
| 18 | Conferir o checklist: `pode_atender` e a lista do que ficou com uma pessoa | `plataforma_ver_implantacao` | agente |

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
- **O resto é opcional** e aparece em `com_o_humano` no checklist: conectar a
  agenda do Google ou do Outlook, o token de conversões, o roteador entre dois
  agentes do mesmo número. A seção 4 lista tudo.

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
   existe o **roteador** (IA › Roteadores, `/app/ai/routers`), que é montado por
   uma pessoa na tela.

O desenho simples, e o que as ferramentas montam sozinhas, é **um agente por
número**. A IA do agente (provedor, modelo e chave) é da plataforma: a
ferramenta não recebe nem devolve chave, e o agente nasce com a IA padrão.

---

## 3. Todas as ferramentas

### Leitura (nenhuma operação: qualquer token de plataforma lê)

| ferramenta | o que devolve | reexecução |
|---|---|---|
| `plataforma_listar_clientes` | as organizações da instalação, com busca por nome | leitura |
| `plataforma_ver_cliente` | o retrato de um cliente: módulos, números, saldo | leitura |
| `plataforma_listar_modulos` | os módulos que se vendem separado | leitura |
| `plataforma_ver_saude` | o estado da instalação | leitura |
| `plataforma_ver_implantacao` | o **checklist**: por área, o que está pronto, o que falta (com a ferramenta) e o que é com uma pessoa (com a tela) | leitura |
| `plataforma_listar_modelos` | os modelos e vocabulários que as outras ferramentas aceitam: modelos de follow-up, pacotes e capacidades do agente, gatilhos e ações de automação, passos do funil, tipos de campo | leitura |
| `plataforma_ver_funis` | os funis inteiros: etapas, passo do agente, campos, motivos | leitura |
| `plataforma_ver_agentes` | os agentes, a versão no ar, o rascunho e o que falta para publicar | leitura |
| `plataforma_ver_catalogo` | os produtos e serviços, com busca e paginação | leitura |
| `plataforma_ver_obrigacoes` | os documentos e obrigações com vencimento: contadores (vencidos, vencendo em 30 dias, pedidos sem resposta, em dia), os itens por situação e o catálogo de tipos por funil | leitura |
| `plataforma_ver_configuracao` | o conteúdo do que está configurado, por seção (etiquetas, memória, conhecimento, follow-ups, automações, agenda, equipe, números, atendimento, mensagens) | leitura |
| `plataforma_ver_followup` | um fluxo de follow-up por dentro: gatilho, nós, textos e esperas | leitura |
| `plataforma_ver_conversoes` | as conversões de um cliente: as conexões da Meta e do Google **sem segredo**, as regras por funil das duas plataformas, a chave dos leads de formulário, o evento recomendado para cada etapa e os 20 últimos envios com a situação e o motivo | leitura |
| `plataforma_listar_demonstracoes` | as empresas de demonstração por segmento (construtora, clínica odontológica, indústria, academia) e a bancada: se existe, o id, quando a semente foi aplicada e as contagens; e qualquer outra organização marcada como demonstração | leitura |
| `plataforma_diagnosticar_conversoes_da_meta` | o diagnóstico da Meta, o mesmo do botão "Testar conexão": token, destino, permissão, último envio aceito, recusas em 7 dias e modo de teste. Faz três leituras na Meta com o token do cliente; nenhum evento é enviado | leitura |

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
| `plataforma_configurar_empresa` | nome, razão social, CNPJ, país, fuso, idioma, moeda, modo de venda, retenção de mídia, encarregado e política de privacidade | a organização | só os campos que vieram mudam |
| `plataforma_configurar_atendimento` | modo de distribuição, visibilidade das conversas, devolução para a IA | a organização | idem |
| `plataforma_garantir_funil` | funil, etapas na ordem, passo do agente por etapa, probabilidade, prazo e cor, campos personalizados (com obrigatoriedade por etapa), motivos de perda e de ganho, vocabulário | nome do funil; nome da etapa; `key` do campo; rótulo do motivo | 20 etapas |
| `plataforma_garantir_produtos` | catálogo em lote, com preço em centavos ou em texto (`"R$ 189,90"`); item com problema é recusado com motivo e não derruba os outros | código do produto (sem código, o nome) | 200 produtos |
| `plataforma_garantir_etiquetas` | etiquetas no vocabulário, com cor e descrição | nome da etiqueta, sem diferenciar maiúscula | 50 etiquetas |
| `plataforma_gravar_memoria` | as regras da casa (documento que todos os agentes seguem) e as anotações | o documento é um só; anotação pelo título | 50 anotações |
| `plataforma_garantir_conhecimento` | material por **texto**: perguntas e respostas, ou documento | nome do material | 200 perguntas; 200 mil caracteres |
| `plataforma_garantir_followup` | instala um fluxo a partir de um modelo e ajusta textos, esperas, etapa do gatilho e política | nome do fluxo | um fluxo |
| `plataforma_garantir_agente` | cria ou altera o **rascunho** do agente: prompt, capacidades por pacote, funis, materiais, follow-ups, palavras de passagem, horário, número | nome do agente | um agente |
| `plataforma_garantir_automacao` | cria ou ajusta uma regra de automação, **desligada** | nome da regra | uma regra |
| `plataforma_garantir_tipos_de_obrigacao` | o catálogo de tipos de documentos e obrigações de um funil, inclusive `modelo_do_segmento` (os tipos prontos do segmento) | nome do tipo dentro do funil | 60 tipos por funil |
| `plataforma_garantir_tipos_de_agendamento` | tipos de agendamento (duração, local, categoria), com o lembrete desligado | nome do tipo | 30 tipos |
| `plataforma_definir_jornada` | a jornada de uma pessoa da equipe, pelo e-mail | a pessoa | uma pessoa |
| `plataforma_garantir_respostas_prontas` | respostas prontas compartilhadas da equipe | título da resposta | 50 respostas |
| `plataforma_garantir_conversoes_da_meta` | o que cada etapa aberta de um funil informa à Meta: o evento, o canal de entrada e o valor; com `usar_recomendado: true`, o sistema escolhe o evento pelo nome da etapa. A regra nasce **desligada** | a etapa do funil | 20 regras |
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
| `plataforma_ligar_lembrete` | liga o lembrete de um tipo de agendamento, com antecedência e texto | mesmo pedido, `ja_estava` |
| `plataforma_submeter_modelo_whatsapp` | submete à Meta um modelo oficial de mensagem (só texto) | modelo que já existe na conta não é reenviado |
| `plataforma_ligar_conversoes` | liga ou desliga as regras de conversão por etapa de um funil, na Meta ou no Google: o sistema passa a mandar evento de cliente para a plataforma de anúncio. Ligar não envia o passado | mesmo pedido, `ja_estava` |
| `plataforma_ligar_leads_de_formulario_da_meta` | liga ou desliga a volta dos leads de formulário para a Meta | mesmo pedido, `ja_estava` |

### Equipe · operação `convidar_equipe`

| ferramenta | o que faz | reexecução |
|---|---|---|
| `plataforma_convidar_pessoas` | convida por e-mail, até 20 pessoas por chamada, cada uma com um papel (`viewer`, `agent`, `manager`, `admin`) | quem já é da equipe é pulado; convite pendente **não** é reenviado, salvo com `reenviar: true` |

### Recusas

Uma recusa diz o campo, o que era esperado e mostra um exemplo que passa. Campo
desconhecido é recusado pelo nome (`etapa` no lugar de `etapas` não é ignorado
em silêncio). Operação que o token não tem é recusada antes de olhar o pedido, e
a recusa diz qual operação pedir.

### A empresa de demonstração

Na empresa de demonstração a montagem funciona inteira (é assim que ela é
preenchida), e nada sai para fora: convite de equipe, modelo oficial do WhatsApp
e automação ligada são recusados com a frase da trava. Ela não tem número de
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
| Roteador entre dois agentes do mesmo número | IA › Roteadores · `/app/ai/routers` | classifica a intenção com exemplos, e é montado e testado na tela |
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
- Nenhuma migration para as ferramentas: tudo cabe nas tabelas que existem. As
  de conversões da Meta usam as tabelas da migration 9017, que é da peça
  ([`conversoes-da-meta.md`](conversoes-da-meta.md)) e não do MCP.

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
| `tests/unit/identificadores-que-cruzam-fronteira.test.ts` | o registro do upload aponta para `lib/ai/rag/criar-material.ts` |
| `tests/unit/agenda-reativar-tipo.test.ts` | lê o contrato no arquivo novo, com um controle de que a rota o importa |

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
| `tests/unit/mcp-de-implantacao-espelhos.test.ts` | as rotas espelhadas não mudaram sem alguém reler o espelho |
| `tests/unit/mcp-de-implantacao-pela-porta-http.test.ts` | o mesmo servidor pela rota HTTP de verdade, com o cabeçalho `Authorization` |
| `tests/invariants/mcp-de-implantacao-ponta-a-ponta.test.ts` | o roteiro inteiro no Postgres de verdade, e que rodar de novo não muda uma linha |
| `tests/invariants/pg-como-supabase-mia.test.ts` | o adaptador de teste que o invariante acima usa (`tests/pg-como-supabase-mia.ts`, um embrulho ao lado do adaptador do upstream) |
