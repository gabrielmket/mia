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
| 10 | Instalar os follow-ups (rascunho), de um modelo ou copiados de outra empresa | `plataforma_listar_modelos`, `plataforma_garantir_followup`, `plataforma_copiar_followup` | agente |
| 11 | Criar o agente de IA (rascunho), com o funil, os materiais, os follow-ups e, desde a .85, o horário de atendimento da IA (as faixas em que ela fica ativa) | `plataforma_garantir_agente` | agente |
| 12 | Automações (nascem desligadas), tipos de agendamento, jornada e respostas prontas | `plataforma_garantir_automacao`, `plataforma_garantir_tipos_de_agendamento`, `plataforma_definir_jornada`, `plataforma_garantir_respostas_prontas` | agente |
| 12a | Planos de tarefa (antes da automação que os aplica) e a fonte de formulário do site (antes da automação que reage a ela) | `plataforma_garantir_planos_de_tarefa`, `plataforma_garantir_fonte_de_formulario` | agente |
| 13 | **Conectar o número de WhatsApp** | tela **Conexões** (`/app/connections`) | **pessoa do cliente** |
| 13a | Depois do número: os dias da prospecção, por QR Code guardar o histórico, desde a .83 quem recebe as conversas dele (a distribuição do número: responsáveis, modo próprio e atendente padrão; a equipe já tem de ter aceitado o convite) e, desde a .85, a janela de RESPOSTA do número quando o horário da IA cai fora dela (`plataforma_ver_agentes` avisa) | `plataforma_configurar_canal` | agente |
| 14 | Conferir o rascunho com o cliente antes de pôr no ar | `plataforma_ver_agentes`, `plataforma_ver_followup` | agente e pessoa |
| 15 | Publicar os follow-ups e o agente | `plataforma_publicar_followup`, `plataforma_publicar_agente` | agente |
| 15a | Só com dois ou mais agentes no MESMO número: montar o roteador de intenção (uma intenção por agente, e o funil de destino de cada uma) e ligá-lo | `plataforma_garantir_roteador`, `plataforma_ligar_roteador` | agente |
| 16 | Ligar as automações e os lembretes | `plataforma_ligar_automacao`, `plataforma_ligar_lembrete` | agente |
| 16a | Conversões (opcional, para quem anuncia): montar as regras por etapa, e ligar depois de a pessoa conectar a conta de anúncios | `plataforma_ver_conversoes`, `plataforma_garantir_conversoes_da_meta`, `plataforma_garantir_conversoes_do_google`, `plataforma_ligar_conversoes`, `plataforma_ligar_leads_de_formulario_da_meta` | agente (a conexão é com a pessoa do cliente) |
| 17 | Convidar a equipe (o link curto de cada convite volta na resposta, para mandar por WhatsApp) | `plataforma_convidar_pessoas` | agente |
| 18 | Conferir o checklist: `pode_atender` e a lista do que ficou com uma pessoa | `plataforma_ver_implantacao` | agente |
| 18a | Os relatórios e o painel do segmento (montador de relatórios), os números do primeiro dia, e o link para o dono preparado (mandado só quando o cliente pedir) | `plataforma_garantir_relatorios`, `plataforma_ver_relatorios`, `plataforma_ver_paineis`, `plataforma_garantir_link_do_dono` | agente (quem manda o link é uma pessoa) |
| 18b | E-mail marketing (opcional, módulo `email_marketing`): liberar o módulo e o preço por e-mail, cadastrar o domínio (os seis registros vão a quem cuida do DNS do cliente), remetente e rodapé, a supressão e os aceites da ferramenta anterior, os segmentos e os modelos, e uma campanha em RASCUNHO com o teste para a equipe. **O envio é da pessoa da empresa, pela tela** | `plataforma_liberar_modulo`, `plataforma_definir_preco`, `plataforma_verificar_dominio_de_email`, `plataforma_configurar_email_marketing`, `plataforma_importar_supressao`, `plataforma_importar_consentimentos`, `plataforma_garantir_segmentos`, `plataforma_garantir_modelos_de_email`, `plataforma_criar_campanha_de_email`, `plataforma_ver_email_marketing` | agente (o DNS e o envio são de pessoas) |

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

São **99** ferramentas no servidor: as 91 desta página e as 8 da migração
([`mcp-de-migracao.md`](mcp-de-migracao.md)). A .94 juntou as duas partes do assistente que ensina e
faz. A mais nova é `plataforma_desfazer_proposta_do_assistente`, do assistente que faz com aprovação
([`assistente.md`](assistente.md), seção 12; veja "O assistente faz com aprovação (.94)", nesta
seção). As quatro de antes dela (.93) são as do "Me mostra como" e de onde os clientes travam
([`assistente.md`](assistente.md), seção 11): `plataforma_ver_trilhas`, `plataforma_configurar_trilhas`,
`plataforma_ver_onde_os_clientes_travam` e `plataforma_anotar_melhoria_do_produto` (veja "O assistente
ensina (.93)", nesta seção). Cresceram `plataforma_ver_propostas_do_assistente`,
`plataforma_decidir_proposta_do_assistente`, `plataforma_configurar_assistente`,
`plataforma_ver_assistente` e `plataforma_ver_implantacao`. As duas de antes delas (.91) são as das
propostas do assistente nos primeiros passos ([`primeiros-passos.md`](primeiros-passos.md)):
`plataforma_ver_propostas_do_assistente` e `plataforma_decidir_proposta_do_assistente`
(veja "Os primeiros passos e as propostas do assistente (.91)", nesta seção), e
`plataforma_ver_implantacao` cresceu com o rótulo do cliente. As nove de antes delas (.90) são as da cobrança da
jornada de assinatura ([`jornada-de-assinatura.md`](jornada-de-assinatura.md); veja "A cobrança
da jornada de assinatura (.90)", nesta seção). As nove de antes delas (.89) são as do disparo de
e-mail marketing ([`email-marketing.md`](email-marketing.md); veja "O disparo de e-mail
marketing (.89)", nesta seção). As cinco de antes delas (.88) são as do
assistente da MIA ([`assistente.md`](assistente.md)): `plataforma_configurar_assistente`,
`plataforma_garantir_conhecimento_do_assistente`, `plataforma_ver_assistente`,
`plataforma_ver_chamados` e `plataforma_responder_chamado` (veja "O assistente da MIA
(.88)", nesta seção). A fusão das v1.87 e v1.88 (.86) não pediu
ferramenta nova, só campos e regras novas (veja "O que chegou do upstream 1.87 e 1.88",
nesta seção). A mais nova (.84, a fusão do upstream
v1.86) é `plataforma_copiar_followup`: a exportação e a importação de fluxo da tela,
de outra empresa ou de um `.fluxo.json` (veja "O que chegou do upstream 1.86", nesta
seção). As fusões da v1.84 (.82) e da v1.85 (.83) não pediram ferramenta nova, só campos
e regras novas (veja "O que chegou do upstream 1.84" e "O que chegou do upstream 1.85").
A da .81 (a fusão do upstream v1.81 a v1.83) é `plataforma_configurar_servidor_mcp_externo`. As duas
da .80 (item 9 do mapa: o montador de relatórios) são `plataforma_garantir_relatorios` e
`plataforma_ver_relatorios`. A da .79 (empresa única,
[`empresa-unica.md`](empresa-unica.md)) é `plataforma_vincular_pessoas_a_empresas`, da
migração. As quatro do item 8 do mapa (.78: painéis prontos e link para o dono) são
`plataforma_ver_paineis`, `plataforma_ver_links_do_dono`, `plataforma_garantir_link_do_dono`
e `plataforma_revogar_link_do_dono`. As quatro da .76 são
`plataforma_garantir_planos_de_tarefa`, `plataforma_configurar_canal`,
`plataforma_garantir_fonte_de_formulario` e `plataforma_configurar_banco_externo`.

### Leitura (nenhuma operação: qualquer token de plataforma lê)

| ferramenta | o que devolve | reexecução |
|---|---|---|
| `plataforma_listar_clientes` | as organizações da instalação, com busca por nome; desde a .96, `situacao_do_pagamento: "aguardando_primeiro_pagamento"` traz só quem espera o primeiro pagamento, com a forma escolhida, a situação e desde quando | leitura |
| `plataforma_ver_cliente` | o retrato de um cliente: módulos, números, saldo e, em `configuracao`, a limpeza automática de mídia, o freio do passo "a IA decide", o bloqueio de afirmação clínica e quantos planos de tarefa existem; desde a .96, em `pagamento_inicial`, o passo "Pagamento" do início | leitura |
| `plataforma_listar_modulos` | os módulos que se vendem separado | leitura |
| `plataforma_ver_saude` | o estado da instalação, e se a chave que cifra o CPF dos contatos está semeada (só sim ou não; o valor nunca sai) | leitura |
| `plataforma_ver_implantacao` | o **checklist**: por área, o que está pronto, o que falta (com a ferramenta) e o que é com uma pessoa (com a tela). Desde a .91, as áreas `primeiros_passos` (onde a empresa está no passo a passo e o número oficial que espera a Time) e `plano_e_cobranca` (assinou ou não, das tabelas de assinatura do upstream), e o `rotulo_do_cliente`: o "o que falta" que a empresa nova vê | leitura |
| `plataforma_listar_modelos` | os modelos e vocabulários que as outras ferramentas aceitam: modelos de follow-up, pacotes e capacidades do agente, gatilhos e ações de automação, passos do funil, tipos de campo | leitura |
| `plataforma_ver_funis` | os funis inteiros: etapas, passo do agente, campos, motivos | leitura |
| `plataforma_ver_agentes` | os agentes, a versão no ar, o rascunho, o limiar de sentimento, a passagem por assunto jurídico e o que falta para publicar; desde a .85, o horário de atendimento da IA da versão publicada (`horario_de_atendimento`: faixas, fuso, `ativa_agora`, `proxima_troca` e se cai fora da janela de resposta do número); com `agente`, o horário da versão vigente; o bloqueio de afirmação clínica da empresa (`seguranca_da_empresa`); e os **roteadores** de intenção (número, se está ligado, agente reserva, janela de contexto do classificador e cada intenção com o agente e o funil de destino) | leitura |
| `plataforma_ver_catalogo` | os produtos e serviços, com busca e paginação | leitura |
| `plataforma_ver_obrigacoes` | os documentos e obrigações com vencimento: contadores (vencidos, vencendo em 30 dias, pedidos sem resposta, em dia), os itens por situação e o catálogo de tipos por funil | leitura |
| `plataforma_ver_configuracao` | o conteúdo do que está configurado, por seção (etiquetas, memória, conhecimento, follow-ups, automações, agenda, equipe, números, atendimento, mensagens, planos de tarefa, fontes de formulário e banco externo). Em números, também os dias da prospecção, se guarda o histórico, se está pausado, as pausas agendadas e, desde a .83, a distribuição do número (regra própria, modo, atendente padrão e responsáveis, por e-mail); em atendimento, o freio do passo "a IA decide"; nas fontes, nunca o segredo; no banco externo, nunca endereço, usuário ou senha | leitura |
| `plataforma_ver_followup` | um fluxo de follow-up por dentro: gatilho, nós, textos e esperas, a etapa de destino das caixas de mover e as etiquetas das caixas de etiquetar, e as setas entre os nós | leitura |
| `plataforma_ver_conversoes` | as conversões de um cliente: as conexões da Meta e do Google **sem segredo**, se a identidade da Meta (ID da Página ou da conta do WhatsApp Business) está preenchida, as regras por funil das duas plataformas, a chave dos leads de formulário, o evento recomendado para cada etapa e os 20 últimos envios com a situação e o motivo | leitura |
| `plataforma_listar_demonstracoes` | as empresas de demonstração por segmento (construtora, clínica odontológica, indústria, academia) e a bancada: se existe, o id, quando a semente foi aplicada e as contagens; e qualquer outra organização marcada como demonstração | leitura |
| `plataforma_diagnosticar_conversoes_da_meta` | o diagnóstico da Meta, o mesmo do botão "Testar conexão": token, destino, permissão, último envio aceito, recusas em 7 dias e modo de teste. Faz três leituras na Meta com o token do cliente; nenhum evento é enviado | leitura |
| `plataforma_ver_paineis` | os doze PAINÉIS PRONTOS de um cliente (resultado do mês, meta do mês, funil, de onde vêm, por que perdemos, atendimento, tempo de resposta, agenda, follow-up, anúncios, previsão, assuntos), com os números do motor de conta no banco (`fn_mia_relatorio`, 9030): todas as linhas do período, no fuso e na moeda da empresa. Período 7, 30 ou 90 dias, ou o mês; funil opcional; com ou sem valores em reais. Nada de custo de IA, gasto com anúncio, nome ou contato | leitura |
| `plataforma_ver_relatorios` | o MONTADOR DE RELATÓRIOS de um cliente (.80): os doze relatórios prontos e o funil a que estão ligados, os relatórios e os painéis da equipe (compartilhados ou criados pela implantação) com o que cada um mede e agrupa, e quantos são só de quem criou (esses não são listados: o "só para mim" não aparece para ninguém). Com `numeros: true`, calcula cada relatório dos painéis no banco (`fn_mia_relatorio`) e devolve total e maiores grupos; diz qual relatório fica fora do link do dono por mostrar pessoa da equipe | leitura |
| `plataforma_ver_email_marketing` | o RETRATO do e-mail marketing (.89): módulo, Amazon ligada no servidor (só sim ou não, nunca a chave), o domínio e os seis registros com o que falta, os remetentes, o "responder para", o rodapé, o ritmo e a janela, o degrau do aquecimento, a saúde dos 30 dias, o preço por e-mail, o saldo, a supressão, os textos de consentimento, os segmentos, os modelos e as PENDÊNCIAS para o primeiro envio | leitura |
| `plataforma_ver_campanhas_de_email` | as campanhas de e-mail (.89): situação, por que pausou, o andamento e, com `campanha_id`, os resultados (entregues, aberturas como estimativa, cliques únicos sem robô, descadastros, rejeições, reclamações, cobrado e cliques por link) | leitura |
| `plataforma_ver_links_do_dono` | os links para o dono do negócio de um cliente: para quem, o endereço, a situação (ativo, vencido, revogado), os painéis, o período, se mostra valores, a validade, o último acesso e quantos acessos | leitura |

### Operações que já existiam

| ferramenta | operação | o que faz | reexecução |
|---|---|---|---|
| `plataforma_criar_cliente` | `criar_cliente` | cria a organização; quem criou o token entra como admin | a mesma `chave` devolve a mesma organização |
| `plataforma_liberar_modulo` | `liberar_modulo` | libera ou tira um módulo vendido (desde a .89, também `email_marketing`) | liberar de novo não duplica |
| `plataforma_lancar_credito` | `lancar_credito` | lança crédito ou estorno na carteira de disparo | **não** é reexecutável: cada chamada lança |
| `plataforma_definir_preco` | `definir_preco` | define o preço por mensagem de disparo e, desde a .89, o preço por e-mail (`preco_por_email_cents`; `null` volta ao padrão de 2 centavos). Os dois são opcionais: o ausente fica como está | grava o mesmo valor |

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
| `plataforma_configurar_empresa` | nome, razão social, CNPJ, país (desde a .82, trocar o país sem mandar `fuso` leva o fuso sugerido do país, como a tela), fuso, idioma, moeda, modo de venda, retenção de mídia, a limpeza automática de mídia antiga (ligada, apaga sem volta), encarregado e política de privacidade; e, desde a .79, a **meta do mês** (`meta_do_mes`: o faturamento dos ganhos da empresa inteira, em centavos, no mês corrente ou no `mes` pedido), pelo mesmo upsert da tela de Desempenho (`lib/crm/metas/gravar.ts`). É ela que vira a barra do painel "Meta do mês" | a organização; a meta, pelo mês | só os campos que vieram mudam |
| `plataforma_configurar_atendimento` | modo de distribuição (manual, rodízio ou menor carga; desde a .83 vale para os números SEM regra própria), visibilidade das conversas, devolução para a IA, quanto a IA espera depois de uma resposta pelo celular, o nome de quem fala (atendente ou IA) em negrito na mensagem (desde a .86, também o nome de cada agente), o freio da empresa para o passo "a IA decide" das automações, desde a .81 as duas opções da agenda (atendentes mexem na agenda dos colegas; Google Meet com acesso aberto) e, desde a .86, a devolução à fila da conversa do rodízio sem resposta, o telefone que entra sozinho na ficha sem número e as etiquetas de contato interno | a organização | idem |
| `plataforma_garantir_funil` | funil, etapas na ordem, passo do agente por etapa, probabilidade, janela de esfriando (`prazo_esperado_horas`, pela régua da tela: 1 a 8760 horas inteiras) e cor, campos personalizados (com obrigatoriedade por etapa; desde a .84, de quem é o campo, `escopo` negócio ou contato, só no funil padrão, e a lista pesquisável `searchable_select` com `aliases` e `allow_new`), motivos de perda e de ganho, vocabulário (desde a .79 também `compromisso` e `compromisso_plural`, como o segmento chama o que a agenda marca: o plural é o título do painel pronto de agenda) | nome do funil; nome da etapa; `key` do campo; rótulo do motivo | 20 etapas |
| `plataforma_garantir_produtos` | catálogo em lote, com preço em centavos ou em texto (`"R$ 189,90"`); item com problema é recusado com motivo e não derruba os outros | código do produto (sem código, o nome) | 200 produtos |
| `plataforma_garantir_etiquetas` | etiquetas no vocabulário, com cor e descrição | nome da etiqueta, sem diferenciar maiúscula | 50 etiquetas |
| `plataforma_gravar_memoria` | as regras da casa (documento que todos os agentes seguem) e as anotações | o documento é um só; anotação pelo título | 50 anotações |
| `plataforma_garantir_conhecimento` | material por **texto**: perguntas e respostas, ou documento | nome do material | 200 perguntas; 200 mil caracteres |
| `plataforma_garantir_followup` | instala um fluxo a partir de um modelo e ajusta textos, esperas, etapa do gatilho e política; no gatilho de silêncio, o teto do silêncio e a pausa antes de recomeçar; e garante as caixas que mexem no negócio sem falar com o cliente (`mover_no_funil` e `etiquetar`), antes de um nó do fluxo; desde a .83, a `midia` do passo de texto fixo (imagem ou PDF por endereço, com o texto de legenda); desde a .84, no gatilho de silêncio, `so_se_a_equipe_respondeu` e `repeticoes_por_contato` | nome do fluxo; a caixa, pelo lugar onde está | um fluxo; 10 caixas de cada tipo |
| `plataforma_copiar_followup` | (.84) copia um fluxo de follow-up de OUTRA EMPRESA da plataforma (`de_outra_empresa`) ou de um `.fluxo.json` exportado pela tela (`arquivo`), pelo caminho da importação do upstream (#3056): nasce RASCUNHO; etapas, modelos, responsáveis e próximos fluxos casam por id ou por nome, e o que não casa volta em `pendencias` (com a frase da tela e se bloqueia a publicação). Não copia roteiro de atendimento | o NOME no cliente: nome que já existe responde `ja_estava` e nada é copiado | um fluxo |
| `plataforma_garantir_agente` | cria ou altera o **rascunho** do agente: prompt, capacidades por pacote, funis, materiais, follow-ups, palavras de passagem, passagem por assunto jurídico, o horário de atendimento da IA (faixas por dia; desde a .85), o filtro de palavras (desde a .86), número. O limiar de sentimento é do cadastro e vale na hora; o bloqueio de afirmação clínica é da EMPRESA (todos os agentes) e vale na hora | nome do agente | um agente |
| `plataforma_garantir_roteador` | cria ou ajusta o roteador de intenção de um número, **desligado**: nome, número, agente reserva, a janela de contexto do classificador (0 a 16 mensagens, 8 no roteador novo) e as intenções, cada uma com o agente e o funil (e a etapa) de destino do negócio | nome do roteador; nome da intenção | 20 intenções |
| `plataforma_garantir_automacao` | cria ou ajusta uma regra de automação, **desligada**. É também o webhook de saída: os gatilhos de ganho, perda, reabertura e troca de responsável com a ação `call_webhook`. Aceita o passo "a IA decide" (`ai_decide`, com as ações das opções conferidas pela mesma régua), aplicar um plano de tarefas, etiqueta no contato, o recorte por fonte de formulário e o funil e a etapa dos gatilhos de tempo; desde a .83, a `media_url` da mensagem de WhatsApp (imagem ou PDF, conferida antes de gravar); desde a .84, o RODÍZIO da ação atribuir (`{ "modo": "rodizio", "fila": [...] }`, cada pessoa conferida contra a equipe) e a recusa do gatilho por data num campo do contato | nome da regra | uma regra |
| `plataforma_garantir_planos_de_tarefa` | os planos de tarefa (a sequência de tarefas que uma automação aplica ao negócio), com título, prazo, prioridade e responsável de cada passo | o `id` do plano, ou o nome | 50 planos; 30 passos por plano |
| `plataforma_garantir_fonte_de_formulario` | a fonte de formulário: destino (funil e etapa), as perguntas do formulário, o mapeamento dos campos, o endereço de retorno, a autorização de IA na captação e, desde a .82, a atualização do card no reenvio (`atualizar_card_no_reenvio`); as duas últimas exigem a assinatura, posta pela pessoa. Devolve o caminho do endereço de captação | nome da fonte | uma fonte; 20 perguntas |
| `plataforma_configurar_canal` | de um número: o nome interno (.81), os dias da prospecção, guardar o histórico (só QR Code; desligar pede confirmação escrita) e a pausa agendada de até 24 horas (de um número ou de todos), com o ajuste dos horários de uma que ainda não começou (.81) e o cancelamento; e, desde a .83, a `distribuicao` do número (os `responsaveis`, o `modo` próprio e o `atendente_padrao`, ou `voltar_ao_padrao_da_organizacao`), gravada pela função do fork da `9045`; e, desde a .85, a `janela_de_resposta` (as horas em que o número responde a quem escreveu, 0 a 24; disparo e prospecção não mudam). Nunca credencial, token ou número | o número; a pausa, pelo número e pela janela | um número |
| `plataforma_configurar_banco_externo` | numa conexão de banco externo que já existe: as fontes liberadas (o modo e a lista de tabelas e colunas que o agente pode ler, .81) e a coluna que identifica o cliente nas conversas (telefone ou e-mail). Desde a .84 a resposta e a leitura dizem o motor (`tipo_do_banco`: PostgreSQL ou MySQL) e o aviso do último teste. Nunca lê nem devolve a conexão ou a senha | o nome da conexão | uma conexão |
| `plataforma_configurar_servidor_mcp_externo` | (.81) o servidor MCP externo do cliente (o sistema de fora que a IA consulta): o endereço https público e a chave, gravada CIFRADA e nunca devolvida (a resposta traz os quatro últimos caracteres; a trilha leva só o host); `apagar: true` tira. Recusa a empresa de demonstração | a organização | um servidor |
| `plataforma_garantir_tipos_de_obrigacao` | o catálogo de tipos de documentos e obrigações de um funil, inclusive `modelo_do_segmento` (os tipos prontos do segmento) | nome do tipo dentro do funil | 60 tipos por funil |
| `plataforma_garantir_tipos_de_agendamento` | tipos de agendamento (duração, local, categoria), com o lembrete desligado; desde a .81, o número que manda o lembrete (`canal_do_lembrete`), com aviso quando a empresa tem 2 ou mais números e um tipo com lembrete está sem ele | nome do tipo | 30 tipos |
| `plataforma_definir_jornada` | a jornada de uma pessoa da equipe, pelo e-mail | a pessoa | uma pessoa |
| `plataforma_garantir_respostas_prontas` | respostas prontas compartilhadas da equipe; desde a .81, até 5 imagens por resposta, por endereço https público (a lista inteira; a imagem entra pelo conteúdo e repetir não empilha) | título da resposta | 50 respostas |
| `plataforma_garantir_conversoes_da_meta` | o que cada etapa aberta de um funil informa à Meta (a régua do upstream, 0524): o evento padrão; com `usar_recomendado: true`, o sistema escolhe o evento pelo nome da etapa. A regra nasce **desligada** | a etapa do funil | 20 regras |
| `plataforma_garantir_relatorios` | o MONTADOR DE RELATÓRIOS pronto (.80, item 9): liga os doze prontos ao funil do cliente (o principal ou `funil_id`, em `mia_relatorios_da_empresa`), cria os relatórios a mais do segmento (`clinica`, `construtora`, `industria`, `academia` ou `geral`: três do segmento e a conversão por origem) e monta o painel do segmento com oito relatórios, compartilhados com a equipe (`lib/relatorios/segmentos.ts`, a mesma receita da demonstração). Aceita `meta_do_mes` (a mesma de `plataforma_configurar_empresa`) e devolve o link para o dono SUGERIDO (para quem e quais prontos), sem criá-lo | o relatório pela chave natural (`mia_relatorios.chave`); o painel pela dele; no painel só COMPLETA o que faltar: o que o cliente pôs, o tamanho e a ordem que mudou ficam | um segmento |
| `plataforma_garantir_conversoes_do_google` | o que cada etapa aberta informa ao Google Ads: o nome da conversão e o id da ação de conversão (que já tem de existir na conta do Google). A regra nasce **desligada** | a etapa do funil | 20 regras |

Todas respondem `criou`, `atualizou` ou `ja_estava`, item a item quando a chamada
é em lote.

### Pôr no ar · operação `colocar_no_ar`

| ferramenta | o que faz | reexecução |
|---|---|---|
| `plataforma_publicar_agente` | publica o rascunho do agente: ele passa a responder no número | sem rascunho novo, `ja_estava` |
| `plataforma_pausar_agente` | pausa ou retoma um agente sem despublicar; desde a v1.84 do upstream, outro agente no ar no mesmo número passa a responder ali | mesmo pedido, `ja_estava` |
| `plataforma_publicar_followup` | publica (ou desliga) um fluxo de follow-up; desde a .84, recusa o passo cujo modelo de mensagem não existe na empresa e devolve os avisos do gatilho de silêncio (sem teto, sem limite de repetições, alcançando quem a equipe não respondeu), com o campo que resolve cada um | sem mudança no rascunho, `ja_estava` |
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

### O disparo de e-mail marketing (.89)

Função do fork, e entra no MCP na mesma versão. Desenho e passo a passo da Amazon em
[`email-marketing.md`](email-marketing.md); a prova está em
`tests/unit/mcp-de-implantacao-email-marketing.test.ts` (a CONTAGEM da lista morou ali
na .89, com 83; desde a .90 mora no teste da cobrança).

**O MCP nunca dispara.** Ele monta tudo e manda o TESTE; quem envia é uma pessoa da
empresa (gestor para cima), na tela da campanha, com a declaração da base legal
assinada por ela. Nenhum arquivo de `lib/mcp-plataforma/` importa a confirmação, a
retomada ou o motor do envio (o teste confere no código-fonte). E o teste pelo MCP vai
SÓ para e-mails da equipe do cliente ou de quem criou o token: um token vazado não
manda e-mail com o domínio do cliente para endereço de fora.

| ferramenta | operação | o que faz | reexecução |
|---|---|---|---|
| `plataforma_verificar_dominio_de_email` | `implantar_configuracao` | cadastra o domínio na Amazon (uma vez) e confere no DNS os seis registros: 3 CNAME de DKIM, o MX e o SPF do subdomínio de retorno (padrão `envio`) e o DMARC. Devolve a tabela para quem cuida do DNS; recusa provedor gratuito | rodar de novo só confere |
| `plataforma_configurar_email_marketing` | `implantar_configuracao` | os remetentes (nome e parte antes do @; um padrão), o "responder para", o rodapé obrigatório (razão social, CNPJ, endereço, motivo, privacidade ou a página padrão, que é rascunho para revisão jurídica), o ritmo, a janela e os dias úteis | campo ausente fica; o mesmo pedido responde `ja_estava` |
| `plataforma_garantir_segmentos` | `implantar_configuracao` | os segmentos salvos (o recorte do Broadcast mais empresa e campanha anterior, com a base legal; interesse legítimo exige `lia_ref`) | pelo nome |
| `plataforma_garantir_modelos_de_email` | `implantar_configuracao` | os modelos do catálogo por segmento de negócio e os escritos à parte | pela chave |
| `plataforma_importar_supressao` | `implantar_configuracao` | os descadastros da ferramenta anterior entram como `importada` e nunca mais recebem | só acrescenta; o repetido é `ja_estava` |
| `plataforma_importar_consentimentos` | `importar_consentimentos` | aceites com data, ORIGEM (obrigatória), versão do texto e evidência, no contato com aquele e-mail. Quem está na supressão continua fora | o aceite igual não duplica |
| `plataforma_criar_campanha_de_email` | `criar_campanha_de_email` | o RASCUNHO (de um modelo, de um segmento ou com o conteúdo escrito ali), com `campanha_id` edita; com `teste_para` (até 5, da equipe) manda o teste com [TESTE] no assunto, sem cobrar. Devolve a conferência: quem recebe, quem fica de fora e por quê, o plano dia a dia, o custo, o saldo e o que trava. **Não dispara** | cada chamada sem `campanha_id` cria um rascunho |

As duas caixinhas novas do token, e o raio de cada uma: `importar_consentimentos` LIBERA
envio para pessoas (o aceite importado é o que prova o consentimento), e
`criar_campanha_de_email` manda e-mail pelo domínio do cliente (o teste, só para a
equipe). A área nova do checklist (`email_marketing`, em `plataforma_ver_implantacao`) é
opcional sem o módulo e nunca conta o envio como pendência do implantador.

### A cobrança da jornada de assinatura (.90)

Função do fork, e entra no MCP na mesma versão. Desenho e passo a passo para ligar em
[`jornada-de-assinatura.md`](jornada-de-assinatura.md); a prova está em
`tests/unit/mcp-de-implantacao-cobranca.test.ts` (a CONTAGEM da lista mora ali desde a .90:
92, e 94 com a .91). Os valores vão em **reais**; o teto de IA é o único em dólar, e só a plataforma o vê.

**O MCP não** conecta nem troca a chave do provedor (só pela tela, cifrada), não marca nada
como pago (o pagamento só vem do aviso do provedor e da releitura), não cancela a
assinatura do cliente (é decisão dele, na tela dele), não muda o modo do cadastro (abre ou
fecha a porta da instalação, em `/admin/cadastro`) e não arquiva plano. Com a cobrança
desligada, as escritas recusam com o caminho para ligar.

| ferramenta | operação | o que faz | reexecução |
|---|---|---|---|
| `plataforma_ver_cobranca` | leitura | a cobrança da instalação: ligada ou não, provedor e modo, se o aviso de pagamento chega, a régua, o que falta para a primeira cobrança, os planos (limites, módulos, preço do Broadcast, conversas estimadas, quantas empresas assinam), as empresas por situação, os pacotes de crédito e o modo do cadastro. A chave nunca sai | leitura |
| `plataforma_garantir_planos` | `gerir_planos` | os planos pelo nome (preço, intervalo, teste, pessoas, números, teto de IA, módulos, preço do Broadcast, frase e selo, oferecido ou escondido, o do cadastro) e os `pacotes_de_creditos`. Plano assinado não muda de preço nem perde módulo: a resposta manda arquivar e criar outro | pelo nome; o igual volta em `sem_mudanca` |
| `plataforma_listar_assinaturas` | leitura | as empresas por situação, com plano, agendado, origem, fim do teste, o próximo aviso da régua, a suspensão prevista, o link em aberto e os passos feitos; filtro `so_cadastro_proprio` | leitura |
| `plataforma_ver_assinatura` | leitura | uma empresa: plano, situação, datas, a régua ponto a ponto, quem administra (e-mail mascarado), os passos e os módulos com a origem | leitura |
| `plataforma_atribuir_plano` | `gerir_cobranca` | atribui ou troca o plano como o dono no card Cobrança: a isenta passa a pagar em teste; no teste a troca vale na hora, depois fica para a renovação (plano negociado não paga diferença). Aceita plano escondido | o mesmo plano responde `mudou: false` |
| `plataforma_gerar_link_de_pagamento` | `gerir_cobranca` | o mesmo botão do card: devolve o link em aberto ou cria um; no Asaas, a primeira vez pede o `documento` de quem paga, que vai direto ao Asaas e não fica guardado (nem na auditoria) | devolve o link em aberto |
| `plataforma_ajustar_cobranca` | `gerir_cobranca` | `dar_prazo` (até 60 dias), `isentar` (recusa com assinatura viva no provedor) ou `voltar_a_cobranca` (com o `plano`). Prazo e isenção reativam quem foi suspenso por pagamento | o mesmo pedido regrava a mesma situação (`mudou: false` no isentar) |
| `plataforma_listar_pedidos_de_cadastro` | leitura | os pedidos esperando aprovação: empresa, quem pediu (mascarado), plano escolhido e o que a empresa faz | leitura |
| `plataforma_decidir_pedido_de_cadastro` | `decidir_cadastro` | aprova (a empresa nasce no plano escolhido, pelo mesmo caminho do cadastro) ou recusa com o `motivo`, que vai por e-mail a quem pediu | o pedido decidido devolve a decisão anterior |

As três caixinhas novas do token, e o raio de cada uma: `gerir_planos` mexe no preço e nos
módulos de TODO cliente novo (um plano de R$ 5 como padrão do cadastro), `gerir_cobranca`
isenta ou troca o plano de qualquer empresa, e `decidir_cadastro` deixa entrar quem a Time
não conferiu, gastando IA no teste. Marque só no token de quem cuida da cobrança.

Três ferramentas de antes crescem: `plataforma_ver_cliente` devolve `cobranca` (plano,
situação, datas) e `modulos_com_origem` (pelo plano, pela Time); `plataforma_criar_cliente`
aceita `plano` (com a cobrança ligada) ou `isenta`, e grava a origem `implantacao`;
`plataforma_liberar_modulo` aceita `crm_b2b`, devolve a origem "pela Time" e avisa quando o
plano já liga o módulo (e quando, tirada a liberação, ele continua ligado pelo plano).
`plataforma_ver_implantacao` não mudou.

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
| Aviso configurável para quem escreve fora do horário de atendimento | 1.72 | campo novo `aviso_fora_do_horario` em `plataforma_garantir_agente`. Desde a .85 só vale no agente que ainda tem o horário ANTIGO gravado pela tela: com o horário da IA é recusado (ver "O horário de atendimento da IA (.85)") | `implantar_configuracao` |
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

### O que chegou do upstream 1.81 a 1.83 (.81)

Mesma regra, na fusão da v1.83. A prova de cada linha está em
`tests/unit/mcp-de-implantacao-novidades-do-upstream-183.test.ts` (que também guarda
a contagem: 68).

| novidade do upstream | versão | como o MCP alcança | operação |
|---|---|---|---|
| Canal do lembrete por tipo (`calendar_event_types.reminder_channel_session_id`) | 1.83 | campo novo `canal_do_lembrete` em `plataforma_garantir_tipos_de_agendamento`, conferido pela régua da rota (`canalDoLembreteValido`); aviso de remetente ambíguo com 2+ números; a leitura devolve `canal_do_lembrete_id` | `implantar_configuracao` |
| Atendentes mexem na agenda dos colegas (`settings.colegas_podem_mexer_na_agenda`) | 1.80/1.81 | campo novo `colegas_podem_mexer_na_agenda` em `plataforma_configurar_atendimento` (a função do upstream exige sessão com MFA: o espelho grava a mesma chave de topo pelo servidor, com a mesma auditoria) | `implantar_configuracao` |
| Google Meet com acesso aberto (`settings.google_meet_acesso_aberto`, 0648) | 1.81 | campo novo `google_meet_com_acesso_aberto` em `plataforma_configurar_atendimento`, pelo mesmo caminho | `implantar_configuracao` |
| Fontes liberadas do banco externo (`source_mode`, `sources`, 0618) | 1.81 | campo novo `fontes_liberadas` em `plataforma_configurar_banco_externo`, conferido por `atualizarFontesSchema` | `implantar_configuracao` |
| Servidor MCP externo (`settings.mcp_externo`, chave cifrada da 0580) | 1.83 | ferramenta NOVA `plataforma_configurar_servidor_mcp_externo`; campo novo `servidor_mcp_externo` em `plataforma_garantir_agente` (`ferramentas` vira `tool_ids` `mcp_externo:*`; `no_atendimento` vira `ai_agents.config.mcp_externo_no_atendimento`). As duas recusam a empresa de demonstração | `implantar_configuracao` |
| "Sempre atendimento humano" (`contacts.ai_opt_out`, 0624) | 1.81 | campo novo `sempre_atendimento_humano` em `plataforma_importar_contatos` (só liga, como o opt-out), com a auditoria `contacts.always_human_marked` | `importar_base` |
| Ação `send_email`, `start_message_flow.config.surface`, gatilhos `contact.phone_added` e a continuação no `lead.won` | 1.81 | `send_email` em `TIPOS_DE_ACAO`; `plataforma_listar_modelos` ensina o formato do e-mail, a `surface` do fluxo de atendimento, o gatilho do telefone ganho e a exceção do ganho; a regra com e-mail não liga na demonstração | `implantar_configuracao` |
| Campo condicional do funil (`settings.fields[].mostrar_quando`, #2728) | 1.81 | campo novo `mostrar_quando` nos `campos` de `plataforma_garantir_funil` (o campo de quem depende tem de existir; `null` tira) | `implantar_configuracao` |
| Nome interno da conexão (`channel_sessions.display_name`) e ajuste da pausa agendada (PATCH de `channel-schedules`) | 1.81 | campos novos `nome_interno` e `ajustar_pausa_agendada` em `plataforma_configurar_canal` | `implantar_configuracao` |
| Resposta pronta com imagens (`message_templates.midias`, até 5, bucket privado) | 1.81 | campo novo `imagens` em `plataforma_garantir_respostas_prontas` | `implantar_configuracao` |
| Par (provedor, modelo) recusado antes de gravar (#2955) | 1.83 | `plataforma_garantir_agente` confere o par que a plataforma escolheu pela mesma régua (`validarParProvedorModelo`) e recusa com "Nada foi criado" | `implantar_configuracao` |

Ficou de fora desta fusão, por decisão: o agente em vários números
(`ai_agent_version_channels`, 0665), que o upstream ainda não usa na execução.

### O que chegou do upstream 1.84 (.82)

Mesma regra, na fusão da v1.84. A prova de cada linha está em
`tests/unit/mcp-de-implantacao-novidades-do-upstream-184.test.ts` (que agora
guarda a contagem: 68, nenhuma ferramenta nova).

| novidade do upstream | versão | como o MCP alcança | operação |
|---|---|---|---|
| Fonte de webhook atualiza o card quando a integração reenvia o mesmo cadastro (`webhook_sources.update_existing_lead_on_capture`, 0683, #2316) | 1.84 | campo novo `atualizar_card_no_reenvio` em `plataforma_garantir_fonte_de_formulario`: só no ajuste (fonte nova não nasce com ela, como na rota), recusa sem a assinatura com a frase própria da opção (`opcaoSemAssinatura`, a régua da rota), avisa que a edição manual do card pode ser sobrescrita; a leitura (`plataforma_ver_configuracao`, seção `fontes_de_formulario`) devolve a opção | `implantar_configuracao` |
| Escolher o país sugere o fuso dele (`perfilDoPais().fusoDoSugerido`, #2347) | 1.84 | `plataforma_configurar_empresa`: `pais` NOVO sem `fuso` leva o fuso sugerido, com aviso; `fuso` junto vence; o mesmo país não mexe no fuso | `implantar_configuracao` |
| A visibilidade do atendente também decide o que ele assume e transfere (0667) | 1.84 | já alcançava: `visibilidade` de `plataforma_configurar_atendimento`; a descrição ensina o efeito novo | `implantar_configuracao` |
| Agente pausado não cala o número quando há outro agente no ar nele | 1.84 | já alcançava: `plataforma_pausar_agente`; a descrição ensina que outro agente no ar no mesmo número passa a responder | `colocar_no_ar` |
| Publicação do follow-up recusa a cadência linear que o motor não terminaria (`max_engine_steps_exceeded`) e conta só o que o cliente sente | 1.84 | já alcançava: `plataforma_publicar_followup` publica pela régua do upstream (`validateFlowForPublish`), e a recusa chega com o motivo | `colocar_no_ar` |
| Roteadores de IA aceitam token `dsk_` (#2824) | 1.84 | nada a configurar: o MCP de plataforma não passa pela rota | |
| Marca a conversa como lida depois de responder (visto azul, #2987) | 1.84 | nada a configurar: o upstream ainda não tem opção por conexão | |
| O agente recebe o anúncio de onde o contato veio | 1.84 | nada a configurar: é automático | |

Ficou de fora desta fusão, por decisão: o plano padrão do cadastro, a entrada
paga e a troca de plano proporcional (0679): é a cobrança do revendedor, que fica
desligada no fork (`platform_config.MODULO_COBRANCA`), como na .76.

### O que chegou do upstream 1.86 (.84)

Mesma regra, na fusão da v1.86. A prova de cada linha está em
`tests/unit/mcp-de-implantacao-novidades-do-upstream-186.test.ts` (que agora
guarda a contagem: 69, uma ferramenta nova).

| novidade do upstream | versão | como o MCP alcança | operação |
|---|---|---|---|
| Exportar e importar fluxo de follow-up (`.fluxo.json`, #3056) | 1.86 | ferramenta NOVA `plataforma_copiar_followup`: de outra empresa da plataforma (a exportação e a importação numa chamada, sem o arquivo passar de mão em mão) ou de um arquivo; as regras são as do upstream (`lib/followup/portabilidade.ts`); nasce rascunho; a chave é o nome no cliente; auditoria `followup_flow.imported` | `implantar_configuracao` |
| Publicar confere se o modelo de mensagem existe nesta conta (#3056) e devolve avisos do gatilho de silêncio (#3048) | 1.86 | `plataforma_publicar_followup` passa a ler os modelos citados (`carregaModelosCitados`) e o gatilho, como a rota; os avisos voltam em `avisos` com o campo do MCP que resolve cada um | `colocar_no_ar` |
| Gatilho de silêncio: "só começar se a equipe já respondeu" e "quantas vezes no máximo, por contato" (`exige_resposta_da_equipe`, `max_enrollments_por_contato`, #3048) | 1.86 | campos novos `so_se_a_equipe_respondeu` e `repeticoes_por_contato` em `plataforma_garantir_followup` (`false` e `null` tiram a chave, como a tela). A inscrição única por silêncio do fork continua valendo por baixo | `implantar_configuracao` |
| Condição por "data de um campo do negócio" no follow-up (`lead_date`, #3048) | 1.86 | já alcançava: o rascunho segue a forma do upstream (`flowGraphSchema`) e a publicação é a dele | |
| Campo do funil do CONTATO ou do NEGÓCIO (`escopo`, #2791) | 1.86 | campo novo `escopo` em cada item de `campos` de `plataforma_garantir_funil`: só no funil padrão (o que a ficha do contato lê), não combina com `obrigatorio_em`; marcar como do contato um campo de data que uma regra LIGADA do gatilho por data lê é recusado nomeando a regra (a recusa mora em `gravarConfiguracaoDoFunil`, compartilhada com a tela) | `implantar_configuracao` |
| Lista pesquisável (`searchable_select`, apelidos, "permitir valor novo", #2521) | 1.86 | tipo novo `searchable_select`, `options[].aliases` e `allow_new` (só nesse tipo) em `plataforma_garantir_funil` | `implantar_configuracao` |
| O gatilho por data recusa campo do contato (#2791) | 1.86 | `plataforma_garantir_automacao` (criar e reescrever) e `plataforma_ligar_automacao` (ligar) recusam com a frase da rota | `implantar_configuracao` e `colocar_no_ar` |
| Rodízio de atendentes na ação "Atribuir a um atendente" (`assign_owner` com `modo: "rodizio"` e `fila`, 0692, #2041) | 1.86 | já alcançava pelo esquema do upstream (o tipo da ação é o mesmo); o espelho passou a conferir cada pessoa da fila contra a equipe (vínculo vivo, papel que atende) e `plataforma_listar_modelos` ensina o formato | `implantar_configuracao` |
| O motor do banco externo e o aviso do último teste (`db_type`, `last_test_aviso`, 0691; MySQL pela API) | 1.86 | `plataforma_configurar_banco_externo` e a leitura (`plataforma_ver_configuracao`, seção `banco_externo`) devolvem `tipo_do_banco` e `aviso_do_ultimo_teste`. O motor é escolhido na criação, que é da pessoa (credencial) | |
| Lembrete de prazo da tarefa na Central e no aparelho do responsável (0655, 0689) | 1.86 | nada a configurar pela implantação: a antecedência, a repetição e o WhatsApp são preferência de CADA pessoa (no perfil dela, Configurações › Notificações) | |
| Nome salvo na agenda do celular (0593), reação do cliente (0684), motivo `verificacao_manual` na passagem (0693), Gemini 4 Argon no catálogo (0703), marcar conversa como exemplo pela lista | 1.86 | nada a configurar: automáticos, do dia a dia ou escolha de modelo (que é da plataforma) | |

Ficou de fora desta fusão, por decisão: responder ao caso pelo WhatsApp da
equipe (`config_aviso_de_caso.resposta_whatsapp_habilitada`, 0687). O aviso de caso
inteiro (o número da equipe que recebe o caso) não tem ferramenta: a porta do
upstream (`fn_definir_aviso_de_caso`) exige uma pessoa admin com verificação em
duas etapas, o número passa a ser INTERNO (o que chega dele deixa de virar
contato), e a resposta dele retoma a IA com o cliente. Veja a seção 4.

### O que chegou do upstream 1.87 e 1.88 (.86)

Mesma regra, na fusão das v1.87 e v1.88. A prova de cada linha está em
`tests/unit/mcp-de-implantacao-novidades-do-upstream-188.test.ts` (que agora
guarda a contagem: 69, nenhuma ferramenta nova).

| novidade do upstream | versão | como o MCP alcança | operação |
|---|---|---|---|
| Fonte de webhook com assinatura reaproveita o card ABERTO do contato no funil (`webhook_sources.reuse_open_lead_on_capture`, 0722, #3101) | 1.88 | campo novo `reaproveitar_card_aberto` em `plataforma_garantir_fonte_de_formulario`, a régua da opção irmã: só no ajuste, recusa sem a assinatura com a frase própria (`opcaoSemAssinatura` = `reuse_lead`), avisa que a edição manual pode ser sobrescrita; a leitura devolve a opção | `implantar_configuracao` |
| A assinatura da IA com o nome de CADA agente (`assinatura_mensagens.por_agente`, #3318) | 1.88 | campo novo `assinatura.nome_de_cada_agente` em `plataforma_configurar_atendimento`. O espelho passou a MANTER o gravado quando o campo não vem (a régua da rota): antes, mexer só no nome apagaria a escolha feita na tela | `implantar_configuracao` |
| A conversa do rodízio sem resposta humana volta para a fila (`routing.unanswered_return_minutes`, #2988, cron novo `rodizio-devolucao`) | 1.88 | campo novo `devolver_a_fila_sem_resposta_minutos` (5 min a 24 h; `null` desliga) em `plataforma_configurar_atendimento`, pela mescla do upstream (`mesclarSettingsDeAtendimento`) e a auditoria `routing.config_changed`. Sem tela no upstream | `implantar_configuracao` |
| O telefone dito na conversa entra sozinho na ficha SEM número (`settings.crm.telefone_de_ficha_vazia`, #2593) | 1.87 | campo novo `telefone_de_ficha_vazia` em `plataforma_configurar_atendimento`, a mescla da ação da tela e a auditoria `crm.telefone_de_ficha_vazia_alterado` | `implantar_configuracao` |
| Etiquetas de CONTATO INTERNO: o contato com uma delas não vira card e a IA não responde (`settings.crm.internal_contact_tags`, refs #2353) | 1.88 | campo novo `etiquetas_de_contato_interno` (a lista inteira, normalizada como a tela) em `plataforma_configurar_atendimento`, com a auditoria `crm.tags_internas_alteradas` | `implantar_configuracao` |
| O FILTRO DE PALAVRAS do agente passou a VALER (`trigger_config.filters.keyword_regex`, #2696): sem uma das palavras, a IA não responde | 1.87 | campo novo `filtro_de_palavras` em `plataforma_garantir_agente` (a expressão que não compila é recusada, `null` tira); `plataforma_ver_agentes` devolve `filtro_de_palavras` de cada agente e da versão vigente | `implantar_configuracao` |
| Condições das automações: "não contém", "está vazio", "está preenchido", maior/menor (número ou data) e o grupo "qualquer uma" (`OPS_DE_CONDICAO`, `{ any: [...] }`, #2727) | 1.87 | `condicoes[].op` de `plataforma_garantir_automacao` passa a ser a lista do upstream (o `value` fica opcional no "está vazio"/"está preenchido") e o campo novo `combinar_condicoes` ("todas", o padrão, ou "qualquer"); a descrição ensina a mudança do `neq` em campo ausente | `implantar_configuracao` |
| Automação "Mensagem para a equipe" (`notify_team`, #2642) e o e-mail para uma PESSOA da equipe (`send_email` com `membro_da_equipe` e `{{resumo}}`) | 1.88 | `notify_team` entra nos tipos de ação (a lista segue EXATAMENTE a do upstream); `plataforma_listar_modelos` ensina que ela sai pelo número do aviso de caso (que uma pessoa cadastra); o `membro_id` do e-mail é conferido contra a equipe | `implantar_configuracao` |
| Agenda por SERVIÇO, com turmas, capacidade e calendários compartilhados (0716, #3132) | 1.87 | campo novo `servico_em_rascunho` em `plataforma_garantir_tipos_de_agendamento` (só no tipo novo, como a tela: serviço desativado e sem responsável); a leitura (`plataforma_ver_configuracao`, seção `agenda`) devolve o `servico` de cada tipo. A PROGRAMAÇÃO e a ativação ficam na tela (veja abaixo) | `implantar_configuracao` |
| Receitas prontas do banco externo: produtos do WooCommerce (0706, #3096) e conteúdo do WordPress (#3213), no MySQL | 1.87 e 1.88 | campo novo `receitas` em `plataforma_configurar_banco_externo` (a lista inteira), pelo caminho de `PUT .../recipes`: `atualizarReceitasSchema`, `validarFixosDaReceita` (a recusa diz o campo), receita contra o motor da conexão, auditoria `external_db_recipes.updated`; a resposta e a leitura dizem quantas receitas há | `implantar_configuracao` |
| A ORDEM das respostas prontas (`message_templates.ordem`, 0729, #3244) | 1.88 | `plataforma_garantir_respostas_prontas` grava as NOVAS no topo, na ordem do pedido (a rota grava a nova no topo); a que já existe não muda de lugar | `implantar_configuracao` |
| Regras de "negócio criado" passam a rodar para o negócio da Prospecção; o eco da mensagem enviada não pausa a IA; transferir a conversa leva o negócio; "PARAR" encerra as demandas | 1.88 | nada a configurar: comportamento do motor (ver os riscos da .86) | |
| App no celular, MFA com dispositivo confiável, últimas compras no Inbox, encaminhar mensagem, traço do turno, mediana da 1ª resposta | 1.87 e 1.88 | nada a configurar pela implantação: escolha de cada pessoa ou leitura | |

Ficou de fora desta fusão, por decisão:

- o AVISO DE AGENDAMENTO no WhatsApp do dono (0753): a porta do upstream
  (`fn_definir_aviso_de_agendamento`) exige uma pessoa admin com a verificação em duas
  etapas provada na sessão, e o número escolhido vira INTERNO (o que chega dele deixa de
  virar atendimento). É a mesma razão do aviso de caso (.84). Configurações › Sua
  empresa › Aviso de agendamento;
- a PROGRAMAÇÃO do serviço da agenda (0716: individual por profissional ou turma com
  capacidade, horários, exceções, profissionais, recursos, bloqueios e o calendário
  Google de destino): a porta (`fn_calendar_service_configure`) confere o ator como
  MEMBRO gerente da empresa ou token dela, e a programação depende das agendas Google de
  cada pessoa. O MCP cria o serviço em rascunho e a pessoa programa e ativa na tela;
- a CAMPANHA pelo número oficial com modelo aprovado (0710) e a saída configurável da
  prospecção (0705): são campanhas, operação do dia a dia, e o MCP não monta campanha;
- a RESPOSTA PRONTA de ÁUDIO (#2833): o MCP segue recebendo imagens; o áudio sobe pela
  tela (Respostas rápidas), que confere os bytes;
- o nome e o "responder para" do e-mail das automações (Configurações › Marca, #3312):
  no fork a marca é da plataforma (`MARCA_DA_ORGANIZACAO=travada`), e a ação da tela
  recusa os dois campos junto com a marca;
- caixa de mensagem bloqueada até assumir e os três campos das últimas compras
  (Configurações › Empresa): preferência de operação da equipe, sem efeito na montagem.

### O horário de atendimento da IA (.85)

Função do fork, não do upstream, e entra no MCP na mesma versão. A prova está em
`tests/unit/mcp-de-implantacao-horario-da-ia.test.ts` (a contagem segue 69:
nenhuma ferramenta nova).

A regra: dentro das faixas a IA está ATIVA e responde; fora delas está INATIVA,
não responde a mensagem que chegou, nem depois, e a conversa fica com a equipe
(sem aviso automático). Os toques de follow-up que caem com ela inativa esperam
a próxima abertura. O dado mora na versão (`trigger_config.filters.horario_da_ia`)
e vale ao publicar; a régua está em `lib/agent-engine/agent/horario-da-ia.ts`.

| o que | como o MCP alcança | operação |
|---|---|---|
| As faixas | `horario_de_atendimento` de `plataforma_garantir_agente` passa a aceitar `{ faixas: [{ dias, inicio, fim }], fuso? }`: até 6 faixas por dia, `"24:00"` como fim do dia, faixas que se cruzam são unidas, a que passa da meia-noite é recusada (são duas). Sem `fuso`, o da empresa. Grava na forma canônica (o pedido repetido responde `ja_estava`) e zera o `business_hours` do upstream. `null` tira o horário | `implantar_configuracao` |
| O formato antigo | `{ inicio, fim, dias, fuso? }` continua aceito e vira UMA faixa, com a regra nova | `implantar_configuracao` |
| As recusas | zero faixas ("Sem nenhuma faixa a IA nunca responde. Para parar o agente, use Pausar."), a faixa que passa da meia-noite, mais de 6 faixas num dia, e `aviso_fora_do_horario` junto com o horário da IA (inativa quer dizer que a equipe atende) | |
| A leitura | `plataforma_ver_agentes` devolve, por agente, `horario_de_atendimento` da versão PUBLICADA: `faixas`, `fuso`, `ativa_agora`, `proxima_troca` (`em`, `texto` como "hoje às 17:30", `fica`), `janela_de_resposta_do_numero` e `fora_da_janela_de_resposta_do_numero`. Com `agente`, a versão vigente traz o horário dela (o rascunho, se houver) | |
| A janela de RESPOSTA do número | campo novo `janela_de_resposta: { inicio_hora, fim_hora }` (0 a 24; `null` volta a seguir a janela de disparo) em `plataforma_configurar_canal`, pela régua de `PUT /api/v1/ai/pacing`: grava só `resposta_start_hour`/`resposta_end_hour`, reprograma os turnos que esperavam a janela e audita `ai.pacing_knobs_updated`. Disparo, retomada e prospecção não mudam. `plataforma_ver_configuracao`, seção `canais`, devolve a janela | `implantar_configuracao` |

### O assistente da MIA (.88)

Função do fork ([`assistente.md`](assistente.md)), e entra no MCP na mesma versão. A
prova está em `tests/unit/mcp-de-implantacao-assistente.test.ts`, que guarda a
CONTAGEM da lista (74). Uma operação nova, `responder_chamados`: responder FALA, em nome
da Time Company, com a equipe do cliente (no assistente, no sino e por e-mail), e isso
não é montagem. O token que já existe não a tem: para usar
`plataforma_responder_chamado`, marque a caixinha nova em Admin › Tokens de plataforma.

| ferramenta | o que faz | operação | reexecução |
|---|---|---|---|
| `plataforma_configurar_assistente` | liga e desliga o assistente na empresa (`ligado`), diz quais papéis usam (`papeis`), o limite de perguntas por pessoa por dia (padrão 50, até 1000) e se o resumo da manhã nasce ligado (`resumo_da_manha_padrao`, padrão desligado). Só o que vier no pedido muda; devolve o antes e o depois | `implantar_configuracao` | mesma resposta, sem efeito novo |
| `plataforma_garantir_conhecimento_do_assistente` | a base própria da empresa ("como trabalhamos aqui"), por TÍTULO (sem diferença de maiúscula): cria, atualiza ou tira (`remover`). Até 30 itens, texto de até 2000 caracteres | `implantar_configuracao` | o título repetido atualiza em vez de duplicar (`iguais` quando nada mudou) |
| `plataforma_ver_assistente` | a configuração, o uso dos últimos 30 dias por papel (perguntas e pessoas), as perguntas sem resposta (o texto e quantas vezes, nunca a conversa), os itens da base própria e o custo do mês (chamadas e centavos, de `llm_calls` com `purpose = 'assistente'`) | leitura | |
| `plataforma_ver_chamados` | os chamados de uma empresa ou de todas (sem `organization_id`), com o contexto que o assistente juntou; por padrão só os abertos. Os da empresa de demonstração não entram | leitura | |
| `plataforma_responder_chamado` | responde e muda a situação de um chamado pelo NÚMERO; com resposta nova ou ao resolver, quem abriu recebe no assistente, no sino e no e-mail. Recusa o chamado da demonstração | `responder_chamados` | a mesma resposta não entrega de novo |

### Os primeiros passos e as propostas do assistente (.91)

Função do fork ([`primeiros-passos.md`](primeiros-passos.md)), e entra no MCP na mesma
versão. A prova está em `tests/unit/mcp-de-implantacao-primeiros-passos.test.ts` (o
caminho inteiro de uma proposta no banco em memória) e a CONTAGEM (94, com as nove da
cobrança da .90) no teste da cobrança. Nenhuma operação nova: decidir uma proposta cria configuração em rascunho,
como `plataforma_garantir_agente`, e usa `implantar_configuracao`.

| ferramenta | o que faz | operação | reexecução |
|---|---|---|---|
| `plataforma_ver_implantacao` (cresce) | duas áreas novas: `primeiros_passos` (os passos do `/onboarding` do upstream, feito, pulado ou pendente; o segmento confirmado; e, quando o cliente entrou com o Facebook e o número não chegou, o item "com o humano" de quem faz: a plataforma, em Admin › Cadastro incorporado) e `plano_e_cobranca` (assinou ou não, lido de `cobranca_assinaturas`; cobrança desligada, empresa isenta ou demonstração = não se aplica). E o `rotulo_do_cliente`: os mesmos itens nas colunas preenchido / posso completar / preciso confirmar, com quem faz, do que depende, o que não se aplica, se aparece no Início (`aparece_no_inicio`, e por quê) e a evolução dos retratos | leitura | não grava nada, nem retrato |
| `plataforma_ver_propostas_do_assistente` | as propostas que o assistente preparou numa empresa (agente do modelo, funil do quadro pronto, follow-up do modelo): o que muda, a situação, quando foi decidida, a peça criada e se o follow-up já saiu com o agente; e a evolução do "o que falta" | leitura | |
| `plataforma_decidir_proposta_do_assistente` | aplica ou recusa uma proposta pelo MESMO caminho do cartão: pendente vira aprovada e só então aplicada (a ordem é do banco, 9080); a peça nasce em rascunho e nada é publicado. Se a peça falhar, a proposta fica aprovada com o erro | `implantar_configuracao` | aplicada de novo devolve `ja_estava`; recusar a aplicada é recusado |

O MCP não PROPÕE: propor é do assistente, na conversa de quem administra ou gere a
empresa.

### O assistente ensina (.93)

Função do fork ([`assistente.md`](assistente.md), seção 11), e entra no MCP na mesma versão. A
prova está em `tests/unit/mcp-de-implantacao-trilhas.test.ts` e a CONTAGEM (98 na .93, 99 com a .94) no teste da
cobrança. Nenhuma operação nova: configurar trilhas é montagem (`implantar_configuracao`), e anotar
uma melhoria do produto é a Time falando do produto (`responder_chamados`, a mesma caixinha de
responder chamado).

| ferramenta | o que faz | operação | reexecução |
|---|---|---|---|
| `plataforma_ver_trilhas` | o catálogo das trilhas (passos, o que cada passo confere, o papel) e o progresso de uma empresa por pessoa: nome, feita ou pausada em qual passo, desde quando; as da empresa com `feita_na_empresa` lida agora; a configuração e a recomendada no Início. Sem conversa nenhuma | leitura | |
| `plataforma_configurar_trilhas` | `desligar` e `ligar` trilhas, `recomendada` (ou `null` para a régua padrão) e `recomecar_progresso` (`"todas"` ou o e-mail de uma pessoa: útil na demonstração). Recusa recomendar a desligada | `implantar_configuracao` | mesma resposta, sem efeito novo |
| `plataforma_ver_onde_os_clientes_travam` | o painel de `/admin/assistente`, de todas as empresas: temas mais perguntados (pelo manual que responderia, e se já há trilha ou guia curto), em que passo cada trilha para (% por passo, a maior queda, perguntas e "Já fiz" que não conferiram por passo), trilhas abandonadas, propostas desfeitas por tipo, perguntas sem resposta (só o texto, mascarado) e a lista de melhorias. Por `periodo_dias` (7, 30, 90) e `segmento`. A demonstração não entra | leitura | |
| `plataforma_anotar_melhoria_do_produto` | anota ou atualiza uma melhoria (`titulo`, `evidencia`, `situacao`: anotada, em_desenvolvimento, no_ar; `origem`). O título é a chave, sem diferença de maiúscula | `responder_chamados` | o mesmo título atualiza (`igual` quando nada mudou) |
| `plataforma_ver_assistente` (cresce) | `trilhas`: começadas, feitas, pausadas e abandonadas (pausadas há mais de 7 dias), no total e por trilha | leitura | |
| `plataforma_ver_implantacao` (cresce) | `rotulo_do_cliente.trilhas_que_ensinam`: a trilha que ensina cada item "preciso confirmar" (o número, o agente, a equipe) | leitura | |
| `plataforma_configurar_assistente` (cresce) | `me_mostra_como`: liga ou desliga a guia na tela; devolve o antes e o depois, sem mexer nas trilhas desligadas | `implantar_configuracao` | |

O MCP não marca trilha como feita (feita vem do estado do sistema), não lê a conversa de ninguém com
o assistente e não toca em nada da lista do "nunca".
### O assistente faz com aprovação (.94)

Função do fork ([`assistente.md`](assistente.md), seção 12; protótipo "ensina e faz"
aprovado em 26/10/2026, tela 7), e entra no MCP na mesma versão. A prova está em
`tests/unit/mcp-de-implantacao-assistente-faz.test.ts` (o caminho de uma peça do dia a dia
no banco em memória: preparar, aplicar pelo MCP, travar, desfazer e "já estava") e a
CONTAGEM (99, com a .93) no teste da cobrança. Nenhuma operação nova: desfazer tira configuração que a
própria proposta criou, como o decidir, e usa `implantar_configuracao`.

| ferramenta | o que faz | operação | reexecução |
|---|---|---|---|
| `plataforma_desfazer_proposta_do_assistente` (nova) | desfaz uma proposta APLICADA pelo MESMO caminho do botão Desfazer do cartão, com as mesmas travas de uso (a etapa com negócio, a etiqueta em uso, a resposta editada, a tarefa concluída, o rascunho publicado, o relatório em painel, a meta mudada, o agente já publicado, o funil com negócio, o follow-up que saiu com o agente). Travada devolve `ok: false`, `desfecho: "travada"` e a frase do porquê, sem mexer em nada. Quem pediu recebe o aviso | `implantar_configuracao` | desfeita de novo devolve `ja_estava`; pendente ou recusada devolve `nao_aplicada` |
| `plataforma_ver_propostas_do_assistente` (cresce) | as nove peças do dia a dia, `tipo` como filtro, quem pediu, a quem foi pedida, quem aprovou e quem desfez (pelo nome), quem aprova aquele tipo, `pedidos_esperando` e, na aplicada, `da_para_desfazer` e `trava_do_desfazer` | leitura | |
| `plataforma_decidir_proposta_do_assistente` (cresce) | aceita as nove peças: a etapa, a resposta rápida, a etiqueta, a tarefa, o rascunho de follow-up, o item de conhecimento, o relatório e a meta nascem pela função da tela, com o cliente de serviço e quem criou o token como ator; a peça "só de quem pediu" continua dela | `implantar_configuracao` | aplicada de novo devolve `ja_estava` |
| `plataforma_configurar_assistente` (cresce) | `tipos_de_proposta` (os tipos que o assistente prepara na empresa; `null` = todos) e `pode_pedir` (quem não aprova manda o cartão pronto a quem aprova; padrão ligado) | `implantar_configuracao` | mesma resposta, sem efeito novo |
| `plataforma_ver_assistente` (cresce) | `propostas_30_dias`: por tipo, preparadas, pedidas, aplicadas, desfeitas, recusadas, vencidas e pendentes | leitura | |

O MCP continua sem propor, sem publicar e sem nada da lista do "nunca" (número, cobrança,
convite, usuários e papéis, chaves, apagar, publicar agente, mensagem a cliente).

### O pagamento no início (.96)

Função do fork ([`pagamento-no-inicio.md`](pagamento-no-inicio.md), seção 8; protótipo "Pagamento
no início" aprovado em 27/10/2026), e entra no MCP na mesma versão, **sem ferramenta nova** (a lista
segue com 99): pagar, escolher a forma e cadastrar o cartão são sempre do cliente, e apagar um
cadastro sem pagamento fica na tela, com a verificação em duas etapas. A prova está em
`tests/unit/mcp-de-implantacao-pagamento-inicial.test.ts`.

| ferramenta | o que muda | operação |
|---|---|---|
| `plataforma_listar_clientes` (cresce) | `situacao_do_pagamento: "aguardando_primeiro_pagamento"`: só as empresas que esperam o primeiro pagamento (a entrada paga, ou o teste que acabou sem a primeira mensalidade), cada uma com `pagamento_inicial`: `forma` escolhida, `situacao` (`sem_cobranca`, `aguardando`, `em_analise`, `recusado`), `modo`, `desde` (a cobrança gerada, ou o cadastro) e `fim_do_teste` | leitura |
| `plataforma_ver_cliente` (cresce) | `pagamento_inicial`: o modo (`entrada_paga` ou `teste`), se espera o primeiro pagamento, a situação (Pix gerado, boleto, cartão recusado, pago, forma escolhida no teste), a forma, o plano, o valor, a cobrança no Asaas (`pay_...`), o vencimento, quando foi gerada, quantas vezes foi refeita, do cartão só o final e a bandeira, se as próximas mensalidades caem nele, o fim do teste e a primeira cobrança, quando pagou e como, o lembrete e os dados fiscais RESUMIDOS (tipo, documento mascarado, razão social, cidade, se o Asaas já os tem). `null` = a empresa não tem o passo; `"nao_lido"` = a leitura falhou | leitura |

O MCP não paga, não gera cobrança, não cadastra cartão, não muda os dados fiscais e não lê o
cartão (o número nunca é gravado).

### O que chegou do upstream 1.85 (.83)

Mesma regra, na fusão da v1.85. A prova de cada linha está em
`tests/unit/mcp-de-implantacao-novidades-do-upstream-185.test.ts` (que agora
guarda a contagem: 68, nenhuma ferramenta nova) e, para a função do banco, em
`tests/invariants/distribuicao-do-numero-pela-plataforma.test.ts`.

| novidade do upstream | versão | como o MCP alcança | operação |
|---|---|---|---|
| Regras de atendimento por número: modo próprio e atendente de destino padrão, na mesma gravação dos responsáveis (`channel_routing_policies.distribution_mode` e `default_assignee_user_id`, 0663, #2331) | 1.85 | campo novo `distribuicao` em `plataforma_configurar_canal` (`responsaveis` por e-mail, `modo`, `atendente_padrao`, `voltar_ao_padrao_da_organizacao`). A porta do upstream (`fn_set_channel_routing`) exige sessão de gerente membro com MFA; o MCP grava pela cópia do fork, `fn_mia_distribuicao_do_numero_pela_plataforma` (migration `9045`), com o token como ator e a mesma auditoria `routing.config_changed`. Criar a regra de um número sem regra pede `responsaveis` por extenso (`[]` = a fila); quem só lê é recusado; destino sem modo próprio é recusado. A leitura (`plataforma_ver_configuracao`, seção `canais`) e o checklist mostram a regra. Não há recusa na demonstração: decidir de quem é a conversa não manda nada para fora | `implantar_configuracao` |
| Imagem ou PDF com legenda na ação "Enviar mensagem de WhatsApp" das automações (`send_whatsapp_message.config.media_url`, #2734) | 1.85 | já alcançava pelo esquema do upstream; o espelho passou a conferir a URL ANTES de gravar com a régua do envio (`classificarMidiaComLegenda`: imagem ou PDF, pela extensão), e `plataforma_listar_modelos` ensina o campo | `implantar_configuracao` |
| Imagem ou PDF com legenda no passo de texto fixo do follow-up (`config.media_url` do nó `action`/`text`, #2734) | 1.85 | campo novo `midia` em cada item de `textos` de `plataforma_garantir_followup` (`null` tira; recusado em passo escrito pela IA); `plataforma_ver_followup` devolve a mídia do nó | `implantar_configuracao` |
| O "contém" das condições ignora acento e pontuação | 1.85 | já alcançava: a descrição de `condicoes[].op` em `plataforma_garantir_automacao` ensina o efeito novo | `implantar_configuracao` |
| Publicar follow-up com "Repetir" conta as voltas contra o teto de 80 passos (#2977) | 1.85 | já alcançava: `plataforma_publicar_followup` publica pela régua do upstream (`validateFlowForPublish`) e a recusa chega com o motivo | `colocar_no_ar` |
| A chance de fechamento da etapa volta na leitura (#2999) | 1.85 | já alcançava: `plataforma_garantir_funil` grava `probabilidade` e `plataforma_ver_funis` lê a coluna direto | `implantar_configuracao` |
| Visibilidade da conversa na atribuição e no registro de eventos (0685) | 1.85 | nada a configurar: é a `visibilidade` de `plataforma_configurar_atendimento`, que já ensina que o atendente não assume nem transfere o que não vê | |
| Desmarcar a conversa como exemplo tira os trechos do RAG (0688) | 1.85 | nada a configurar: é ação do dia a dia na conversa | |
| O agente deixa de repetir a mesma mensagem (#2996) e o custo do provedor personalizado pelo catálogo (#3013) | 1.85 | nada a configurar: automáticos | |

Ficou de fora desta fusão, por decisão: de onde o Jev responde (TypeSafe direto ou
pela OpenRouter, com a chave OpenRouter da empresa): é escolha de IA e pede o aceite
de mandar a mensagem a um fornecedor de fora, como as tarefas do Jev (não há
ferramenta nenhuma do Jev); e o export de contatos em CSV e vCard, a listagem de
instalações com suspender e reativar, o aviso de SMTP no admin e o ponto de extensão
do Caddy (`caddy-sites/`): são operação ou instalação, não montagem de cliente.

Ficaram de fora da fusão da .76, por decisão: o plano de cobrança e a assinatura do
revendedor (a cobrança do upstream fica desligada no fork), excluir organização,
trocar o e-mail de login de alguém e marcar contato como pessoal (é decisão do
gerente, na tela). Também o modo "o Jev escolhe o agente sozinho" do roteador
(depende da chave do Jev e do aceite de mandar a conversa a um fornecedor de fora,
como as tarefas do Jev) e as camadas de segurança que custam IA por mensagem
(promessa semântica e tentativa de burlar o agente): é custo na conta da plataforma,
e fica com quem opera, na tela de Segurança do agente.

---

## Migração de outro CRM

Trazer a base que o cliente já tinha (empresas, contatos, os vínculos entre eles, negócios e materiais) é feito por outras oito ferramentas do mesmo servidor, com duas caixinhas próprias no token ("Importar base" e "Importar materiais"). A ordem, o formato de cada lista e os cuidados estão em [`mcp-de-migracao.md`](mcp-de-migracao.md). No roteiro acima, a migração entra depois da equipe e dos funis, e antes de pôr o agente no ar. Importar não envia nada a ninguém. No checklist (`plataforma_ver_implantacao`) ela aparece como a área "Base importada", que é opcional e nunca conta como pendência.

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
| Ligar tarefas do Jev (por exemplo "Conferir o campo antes de a IA gravar") e, desde a v1.85, de onde o Jev responde (TypeSafe ou OpenRouter) | IA › Provedores · `/app/ai/providers` | depende da chave do Jev e do aceite de mandar a conversa a um fornecedor de fora: os dois são atos de pessoa. Não há ferramenta nenhuma do Jev |
| Assinatura (HMAC) de uma fonte de formulário | Automações › Fontes · `/app/webhooks` | o segredo aparece uma vez na tela: é credencial. A fonte em si (destino, perguntas, autorização de IA, atualização do card no reenvio) entra por `plataforma_garantir_fonte_de_formulario`; as duas opções só ligam depois da assinatura |
| Ligar, desligar ou apagar uma fonte de formulário | Automações › Fontes · `/app/webhooks` | desligar faz o formulário que já está no site parar de virar contato na hora, sem ninguém ver do outro lado |
| Criar, testar ou apagar a conexão com o banco externo do cliente | Dados externos · `/app/integracao-dados` | endereço, usuário e senha são credencial do cliente. A coluna do cliente nas conversas entra por `plataforma_configurar_banco_externo` |
| Pausar um número AGORA, e o ritmo de envio (intervalos, janela de disparo, teto diário, aquecimento) | Conexões · `/app/connections` | a pausa imediata é operação do dia; a pausa AGENDADA (janela de manutenção), os dias da prospecção e, desde a .85, a janela de RESPOSTA entram por `plataforma_configurar_canal` |
| Plano e cobrança do cliente | Configurações › Plano e cobrança | a cobrança do revendedor do upstream fica desligada no fork |
| Marcar um contato como pessoal | a ficha do contato | é decisão do gerente sobre um contato, não montagem |
| CSS personalizado da marca | Admin › Marca · `/admin/marca` | é da instalação inteira, e não de um cliente; e é cosmético |
| Renomear, juntar ou excluir etiqueta | Configurações › Etiquetas · `/app/settings/tags` | mexe em todos os contatos, negócios e conversas que carregam o nome: é operação, não montagem |
| Enviar arquivo (PDF, planilha) ou site como conhecimento | IA › Conhecimento · `/app/ai/knowledge/sources` | upload não cabe numa chamada de ferramenta; por aqui entra o que é texto |
| Modelo oficial com cabeçalho de imagem, vídeo ou documento | Configurações › Modelos · `/app/settings/templates` | a amostra de mídia é enviada por upload |
| Segredo de webhook numa automação | Automações · `/app/webhooks` | segredo é credencial |
| Aviso de caso (o número da equipe que recebe o caso que a IA abre) e, desde a v1.86, responder ao caso por esse WhatsApp | Configurações › Atendimento · aviso de caso | a porta do upstream exige uma pessoa admin com verificação em duas etapas; o número vira INTERNO (o que chega dele deixa de virar contato, e se ele já é cliente a tela pergunta); responder por ele retoma a IA com o cliente |
| Grupo de WhatsApp que recebe os avisos de passagem para humano | Admin › Número de avisos · `/admin` | o grupo é escolhido de uma lista; um id errado manda nome e resumo de lead para o lugar errado |
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
  funil ganhou tela no fork (`/app/paineis/funil`, por cima da conta dele);
  os números que a implantação confere saem de `plataforma_ver_paineis` e, desde a
  .80, de `plataforma_ver_relatorios` (o montador de relatórios).
- **A consulta de CNPJ na Receita.** Desde a .79 (empresa única,
  [`empresa-unica.md`](empresa-unica.md)) o cadastro de empresa é um só,
  `companies`, e `plataforma_importar_empresas` grava nele. A consulta à Receita
  fica só na tela, por uma pessoa (decisão do protótipo de 15/10/2026): nenhuma
  ferramenta consulta.
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
- Duas migrations só para as ferramentas: a `9022`
  (`fn_mia_definir_dono_do_contato_pela_plataforma`), porque a porta do dono do
  contato do upstream exige um gerente membro da empresa como ator, e o token de
  plataforma não é membro. Ela copia o corpo de `fn_definir_carteira_do_cliente`,
  e a cerca dos espelhos guarda a impressão da função do upstream: mudou lá,
  reprova aqui. E a `9045` (.83,
  `fn_mia_distribuicao_do_numero_pela_plataforma`), pelo mesmo motivo e no mesmo
  molde: a porta das regras por número (`fn_set_channel_routing`, 0663) exige
  sessão de gerente membro com MFA; a cópia leva o token como ator, e a cerca guarda
  a impressão da função do upstream. O resto cabe nas tabelas que existem. Desde
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
| `tests/unit/mcp-de-implantacao-assistente.test.ts` | as cinco ferramentas do assistente da MIA (.88): o que gravam, a reexecução, a operação própria do responder, a entrega da resposta no assistente, no sino e no e-mail, a recusa do chamado da demonstração, e as cinco dele (a CONTAGEM da lista mora no teste do e-mail marketing) |
| `tests/unit/mcp-de-implantacao-cobranca.test.ts` | as nove ferramentas da cobrança da jornada de assinatura (.90) e a CONTAGEM da lista (99 desde a .94, com a .93): as três caixinhas novas e o raio de cada uma, os exemplos que passam no esquema, o que o MCP
| `tests/unit/mcp-de-implantacao-email-marketing.test.ts` | as nove ferramentas do e-mail marketing (.89): leitura livre e as duas caixinhas novas, o MCP que nunca dispara (pelo código-fonte e pelo banco: rascunho, ninguém na fila), o teste só para a equipe, a demonstração e o módulo que recusam o teste, a configuração que não duplica, a supressão que só acrescenta, o preço por e-mail que não mexe no da mensagem e a área nova do checklist |
| `tests/unit/mcp-de-implantacao-primeiros-passos.test.ts` | as duas ferramentas das propostas do assistente (.91) e o rótulo do cliente em `plataforma_ver_implantacao`: a empresa nova com as três colunas e o que não se aplica, o número oficial que espera a Time, a empresa que já roda que não aparece no Início, e o caminho inteiro de uma proposta (preparar não grava a peça, aplicar adota o quadro e cria em rascunho, recusar não cria nada, o token sem a operação não decide, e o follow-up sai junto com o agente publicado) |
| `tests/unit/mcp-de-implantacao-trilhas.test.ts` | as quatro ferramentas do "Me mostra como" e de onde os clientes travam (.93) e as três que crescem: o progresso por pessoa sem conversa, desligar e recomendar com a recusa da desligada, recomeçar o progresso por e-mail, o painel sem quem perguntou, a melhoria que não duplica pelo título, e as caixinhas de cada escrita |
| `tests/invariants/email-marketing.test.ts` | as tabelas do e-mail (9060 a 9065) no Postgres de verdade: isolamento por empresa e papel, só o servidor grava, a demonstração que não envia, a supressão que só acrescenta, a anonimização que apaga o legível e mantém o veto, o débito por lote e a fila do worker |
| `tests/unit/mcp-de-implantacao-ferramentas.test.ts` | o catálogo: descrições, exemplos que passam no próprio esquema, a guarda da operação, organização inexistente, recusa que ensina, auditoria |
| `tests/unit/mcp-de-implantacao-operacoes.test.ts` | cada ferramenta: o que grava, a reexecução, as recusas e a empresa de demonstração |
| `tests/unit/mcp-de-implantacao-conversoes.test.ts` | as seis ferramentas de conversões: o que gravam, que montar não liga, a reexecução, as recusas, a resposta sem segredo e a empresa de demonstração |
| `tests/unit/mcp-de-implantacao-novidades-do-upstream.test.ts` | cada novidade do upstream 1.70 a 1.73: o campo ou a caixa nova passa pela ferramenta (o que grava, a reexecução, a recusa que ensina, a leitura), e as duas ferramentas do roteador |
| `tests/unit/mcp-de-implantacao-novidades-do-upstream-180.test.ts` | cada novidade do upstream 1.74 a 1.80, no mesmo molde, as quatro ferramentas novas e a prova de que os tipos de ação da ferramenta são exatamente os do upstream |
| `tests/unit/mcp-de-implantacao-novidades-do-upstream-183.test.ts` | cada novidade do upstream 1.81 a 1.83 (.81), no mesmo molde, a ferramenta nova do servidor MCP externo (a chave nunca volta nem vai para a trilha) e a empresa de demonstração |
| `tests/unit/mcp-de-implantacao-novidades-do-upstream-184.test.ts` | cada novidade do upstream 1.84 (.82), no mesmo molde: a atualização do card no reenvio da fonte de formulário, o fuso que acompanha o país e as descrições que ensinam o efeito novo |
| `tests/unit/mcp-de-implantacao-novidades-do-upstream-185.test.ts` | cada novidade do upstream 1.85 (.83), no mesmo molde: a distribuição do número (o que a função grava, a reexecução, as recusas, a leitura, o checklist e a demonstração), a mídia na automação e no follow-up, as descrições que ensinam o efeito novo, e a CONTAGEM da lista (68) |
| `tests/invariants/distribuicao-do-numero-pela-plataforma.test.ts` | a função da 9045 no Postgres de verdade: o controle negativo (a porta do upstream recusa o ator da plataforma), o mesmo efeito da porta do upstream, as recusas copiadas, o gatilho do upstream que solta o destino de quem sai, o `reset`, as recusas do ator e que só o `service_role` executa |
| `tests/unit/mcp-de-implantacao-relatorios.test.ts` | as duas ferramentas do montador de relatórios (.80), a operação `implantar_configuracao`, o que o garantir grava (prontos ligados ao funil, relatórios do segmento e painel, compartilhados), que rodar de novo não duplica e só completa o painel, a meta do mês, o funil de outra empresa, e a leitura sem o "só para mim" de ninguém |
| `tests/invariants/montador-de-relatorios.test.ts` | as tabelas do montador (9040) e o motor estendido (9041) no Postgres de verdade: quem vê, cria, compartilha, edita e exporta, com controle positivo e negativo; produto, filtro de vários valores, meta por grupo de tempo, funil com soma, responsável no follow-up, agente nas conversas; a lista por trás do número com a mesma conta; e o link do painel (9042) |
| `tests/unit/mcp-de-implantacao-paineis.test.ts` | as quatro ferramentas dos painéis e do link para o dono (.78): a caixinha `compartilhar_paineis`, que o garantir não duplica e ajusta no mesmo endereço, a revogação, a leitura e a demonstração; e a meta do mês em `plataforma_configurar_empresa` |
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
