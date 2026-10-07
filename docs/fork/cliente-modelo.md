# O cliente modelo · as empresas de demonstração

A MIA não tem uma empresa que use todos os recursos da plataforma. Para testar,
medir e mostrar em venda, existem **empresas de demonstração**: empresas com dados
fictícios, em produção, separadas das outras, com uma marca que trava qualquer envio
real e as tira dos números da plataforma.

São cinco, todas geradas pela **mesma semente** (`lib/demonstracao/semente/`):

| segmento | empresa | slug | para quê |
|---|---|---|---|
| `bancada` | **Empresa Modelo · Demonstração** | `empresa-modelo-demonstracao` | a bancada de teste: dez funis de segmentos misturados e os follow-ups de todos os segmentos. Ótima para testar, confusa para mostrar a cliente |
| `construtora` | **Demonstração · Construtora** | `demonstracao-construtora` | mostrar a construtora e imobiliária |
| `clinica-odonto` | **Demonstração · Clínica Odontológica** | `demonstracao-clinica-odontologica` | mostrar a clínica odontológica |
| `industria` | **Demonstração · Indústria** | `demonstracao-industria` | mostrar a indústria ou distribuidora que vende para revendas e profissionais |
| `academia` | **Demonstração · Academia** | `demonstracao-academia` | mostrar a academia ou estúdio |

A Empresa Modelo é decisão do Gabriel de 30/09/2026; as demonstrações por segmento,
de 05/10/2026 ("uma demonstração por cliente modelo"). Cada uma parece o negócio do
cliente que vai vê-la: o funil, os campos, as conversas, a agenda, os documentos e os
produtos falam a língua daquele segmento.

Dentro de qualquer uma aparece, em toda tela, o selo **Demonstração** ("Dados
fictícios. Nenhuma mensagem, e-mail ou aviso sai desta empresa."). Na lista de
empresas do admin, o mesmo selo aparece ao lado do nome.

## O que cada demonstração por segmento mostra

As quatro têm a mesma estrutura: funis com campos personalizados, probabilidade e
prazo por etapa e **pelo menos um negócio em cada etapa**; contatos e empresas;
conversas com a IA (a qualificação, a ficha e a passagem para uma pessoa); agenda
passada e futura (com uma falta e um cancelamento); tarefas (uma atrasada);
documentos e obrigações do segmento; os **quatro follow-ups do segmento publicados**,
com inscrições andando e terminadas; produtos e serviços no catálogo; quatro pessoas
fictícias na equipe; e um **agente de IA com persona do segmento**, sem versão
publicada (não responde ninguém). O fuso é o de São Paulo.

### Construtora · "Construtora Modelo"

Um lançamento na planta (Vista Parque) e as últimas unidades prontas (Bosque das
Palmeiras). Agente: **Lívia**.

- **Funis**: "Lançamento · Vista Parque" (novo interessado, primeiro contato, perfil
  e renda entendidos, visita ao decorado, simulação de financiamento, documentação e
  crédito, contrato assinado, desistiu) e "Prontos para morar" (o quadro pronto de
  imobiliária do onboarding). Campos: empreendimento, tipologia, renda familiar,
  forma de pagamento, FGTS, unidade e entrada.
- **Números**: 19 negócios (de R$ 265 mil a R$ 890 mil), 24 contatos, 2 empresas
  parceiras (imobiliária e correspondente bancário), 5 conversas, 11 compromissos
  (visitas ao decorado, uma marcada pela IA, uma falta remarcada, assinaturas), 10
  produtos (as unidades por tipologia, com o estoque).
- **Documentos do comprador** (10 itens): RG e CPF, comprovante de renda vencendo,
  extrato do FGTS pedido sem resposta, certidões vencidas com o arquivo novo
  esperando confirmação, aprovação de crédito a pedir e, depois da assinatura, a
  parcela anual e o reajuste do contrato.
- **Para apresentar**: a Juliana que veio do formulário, foi qualificada pela IA e
  tem visita ao decorado no sábado; a Camila na documentação, com as certidões que
  ela mandou pelo WhatsApp esperando o "sim, marcar recebido".

### Clínica odontológica · "Clínica Odontológica Modelo"

Avaliação, limpeza, clareamento, implante, prótese, aparelho, alinhadores e lentes.
Agente: **Clara**.

- **Funil**: "Pacientes · Avaliação e tratamento" (novo contato, já respondi,
  entendendo o caso, avaliação marcada, avaliação feita, plano e orçamento
  enviados, tratamento fechado, não fechou). Campos: tratamento de interesse,
  pagamento, convênio, plano de tratamento, dentista, sessões.
- **Números**: 15 negócios (de R$ 220 a R$ 22 mil), 19 contatos, 1 empresa com
  convênio para os funcionários, 5 conversas, 12 compromissos (avaliações,
  sessões, retornos), 12 tratamentos no catálogo com preço de referência.
- **Retorno e manutenção a cada 6 meses** como atividade recorrente: um atrasado,
  dois chegando, um em dia, com o histórico dos anteriores. O orçamento assinado
  como documento, com o arquivo da paciente esperando confirmação.
- **Para apresentar**: a Larissa, que pediu clareamento pelo anúncio e saiu com a
  avaliação marcada pela IA; a Paula, que sumiu na hora de marcar e está no
  follow-up de retomada; o Vítor, que faltou e não respondeu.

### Indústria · "Indústria Modelo"

Fábrica (fictícia) de materiais elétricos e iluminação que vende para revendas,
distribuidores, instaladores e construtoras, com representante por região. Agente:
**Bento**. Nada aqui é dado de cliente real: o segmento, os produtos e os nomes são
genéricos.

- **Funis**: "Pedidos · Revendas e profissionais" (o quadro pronto de indústria:
  novo contato, já respondi, entendendo o que precisa, cotação enviada, negociando o
  pedido, pedido fechado, não fechou) e "Recompra · Carteira ativa" (cliente ativo,
  hora de repor, cotação de reposição, reposição fechada, parou de comprar). Campos:
  tipo de cliente, tabela de preço, linha, número da cotação, prazo de pagamento,
  representante, primeira compra.
- **Números**: 16 negócios (de R$ 640 a R$ 96 mil), 19 contatos, 7 empresas
  clientes com CNPJ fictício, tabela e representante na ficha; as revendas têm quem
  compra, quem decide e quem cuida do financeiro. 6 conversas, 9 compromissos do
  representante, 19 produtos com código, custo e estoque.
- **Tabela por tipo de cliente**: o catálogo traz a tabela revenda; o agente sabe
  que o distribuidor tem 12% de desconto e o instalador compra 8% acima, e que o
  pedido mínimo é de R$ 1.500.
- **Recompra e cadastro** (12 itens): o pedido de reposição de cada cliente como
  atividade mensal, com o histórico das compras (uma atrasada, uma chegando, uma em
  dia), a visita do representante e o reajuste da tabela; a ficha cadastral, o
  contrato social, o alvará vencido, a certidão negativa pedida e o contrato de
  revenda renovado esperando confirmação.
- **Para apresentar**: a Fabiana, compradora da distribuidora, pedindo a reposição
  do mês e a IA sugerindo as quantidades pela última compra; o Douglas, home center
  novo, recebendo a lista de documentos do cadastro e a visita marcada.

### Academia · "Academia Modelo"

Musculação, funcional, pilates e aulas coletivas. Agente: **Duda**.

- **Funis**: "Matrículas · Novos alunos" (novo contato, já respondi, entendendo o
  objetivo, aula experimental marcada, escolhendo o plano, matriculado, não se
  matriculou) e "Renovações e retenção" (plano vencendo, contato de renovação,
  reavaliação marcada, renovou, cancelou). Campos: objetivo, modalidade, plano,
  horário, treinos no último mês, risco de cancelar.
- **Números**: 16 negócios, 19 contatos, 1 empresa com plano corporativo, 7
  conversas, 11 compromissos (aulas experimentais, avaliações e reavaliações), 10
  planos e serviços no catálogo.
- **Renovação do plano e reavaliação física a cada 3 meses** como atividades
  recorrentes, com uma atrasada de quem não voltou; o contrato do plano empresa
  esperando confirmação.
- **Para apresentar**: o Lucas, que perguntou a mensalidade e saiu com a aula
  experimental marcada pela IA; o Nelson, que faltou na aula e está no follow-up de
  falta; a Ana Clara, que parou de vir e recebeu o "sentimos sua falta".

## A Empresa Modelo (a bancada): o que a semente grava

| área | o que entra |
|---|---|
| funis | 9 funis. Seis saem dos quadros prontos do onboarding: clínica, imobiliária, serviços B2B, cursos, loja e geral (este é o padrão). Os outros três são automotivo, academia e o **Comercial**, que recebe o que a IA passa. Todos têm campos personalizados, motivos de perda com categoria e motivos de ganho, e **pelo menos um negócio em cada etapa** |
| negócios | 62 negócios, cada um com valor, dono (pessoa ou a IA "Sofia"), origem, próxima ação (uma tarefa com prazo ligada ao card) e histórico na timeline. As origens são cinco: formulário da Meta, clique para o WhatsApp, Google, site e indicação |
| contatos e empresas | 54 contatos, com e sem empresa. As 5 empresas têm várias pessoas e existem nas duas entidades do produto: `crm_empresas` (a da ficha e do card) e `companies`/`people` (o módulo B2B) |
| atendimento com a IA | 8 conversas fictícias (47 mensagens). Em cada uma entram a qualificação da IA (`lead_state`), a ficha (`lead_notes`) e, quando houver, a passagem para uma pessoa e o card no Comercial |
| follow-ups | os 28 modelos por segmento (geral, clínica, imobiliário, automotivo, academia, serviços B2B e indústria). Os que estão em uso ficam publicados, com inscrições em andamento e terminadas e o registro de cada passo. Os demais ficam em rascunho |
| agenda | 13 compromissos: passados (feito, faltou, cancelado) e futuros (confirmado, pendente), com o lembrete desligado |
| tarefas | a próxima ação de cada negócio e mais algumas tarefas soltas, uma delas atrasada |
| equipe | 4 pessoas fictícias **sem senha e bloqueadas**. Só servem para ser donas de card, tarefa e compromisso |
| documentos e obrigações | no funil de serviços B2B: o catálogo de 8 tipos do segmento e 11 itens com datas relativas a hoje (um vencido com a renovação pedida, três vencendo, um pedido sem resposta, um a pedir, dois válidos e três atividades recorrentes com histórico). Um deles tem um arquivo do cliente esperando confirmação, para mostrar a proposta do agente. Nenhuma regra de aviso e nenhum arquivo de verdade ([docs/fork/obrigacoes.md](obrigacoes.md)) |

Os ids da bancada são os de antes das demonstrações por segmento (sem prefixo): a
Empresa Modelo que já está em produção é renovada, não duplicada. As demonstrações
por segmento têm os ids prefixados pelo segmento, então uma nunca mexe na outra.

## Dado fictício, em todas

Os dados não batem em pessoa real. Os telefones são **`+55 00 9xxxx-xxxx`**, e o
DDD 00 não existe. Os e-mails são **`@exemplo.invalid`**, um domínio reservado
(RFC 2606) que nenhum servidor aceita. O CNPJ das empresas tem o dígito verificador
errado de propósito, então não é de empresa nenhuma. Nenhum nome é de cliente da
Time Company, e o teste de unidade reprova se algum aparecer.

Renovar a semente refaz as datas: cada documento e cada atividade volta à situação
que ilustra (o vencido continua vencido há 3 dias, o que vence continua vencendo), o
compromisso de amanhã volta a ser de amanhã e os follow-ups voltam a esperar.

## Como gerar

O banco precisa ter as migrations **9010** e **9018** (documentos e obrigações). Sem
elas, a semente para sem gravar nada.

### Pelo terminal

`--segmento` escolhe qual: `bancada` (o padrão), `construtora`, `clinica-odonto`,
`industria`, `academia` ou `todos`.

```bash
# 1. só mostra o alvo; nada é gravado
CLIENTE_MODELO_DATABASE_URL='postgresql://USUARIO:SENHA@HOST:5432/postgres' \
  npx tsx scripts/cliente-modelo.ts --segmento construtora

# 2. grava (ou renova)
CLIENTE_MODELO_DATABASE_URL='postgresql://…' \
CLIENTE_MODELO_EMAILS_DE_ACESSO='voce@timecompany.com.br,colega@timecompany.com.br' \
  npx tsx scripts/cliente-modelo.ts --segmento construtora --aplicar
```

- **`CLIENTE_MODELO_DATABASE_URL`**: a connection string do Postgres. Ela fica só
  no ambiente de quem roda, nunca no código nem em arquivo versionado. Se o banco
  exigir SSL, acrescente `?sslmode=require`.
- **`CLIENTE_MODELO_EMAILS_DE_ACESSO`**: usuários que **já existem** na instalação
  e entram como admin da demonstração. E-mail que não existe vira aviso na saída,
  não erro. Quem ainda não tem login entra por **convite de equipe**, que desde a
  `9020` funciona na demonstração como em qualquer empresa: pela tela Equipe ›
  Convidar membros, ou por `plataforma_convidar_pessoas`. O admin da plataforma
  também entra pelo suporte, como em qualquer empresa.
- **Idempotente**: rodar de novo não duplica nada, porque cada linha tem id
  estável. As datas relativas também se renovam.
- Cada empresa grava numa transação só. Ou ela fica inteira de pé, ou nada muda.
  Com `todos`, são cinco transações, uma por empresa.

### Sem acesso ao Postgres: o modo `--sql`

O banco de produção da MIA (`supabase-sistema-mia`) não expõe o Postgres para
fora. O único jeito de rodar SQL ali é o `/pg/query` do postgres-meta, pelo Kong,
com a service key: ele recebe um texto SQL e executa. Para esse caso, a semente
gera o SQL em vez de conectar:

```bash
# uma empresa
CLIENTE_MODELO_EMAILS_DE_ACESSO='voce@timecompany.com.br' \
  npx tsx scripts/cliente-modelo.ts --segmento industria --sql industria.sql

# todas: um arquivo por empresa (demonstracoes-bancada.sql, demonstracoes-construtora.sql, …)
CLIENTE_MODELO_EMAILS_DE_ACESSO='voce@timecompany.com.br' \
  npx tsx scripts/cliente-modelo.ts --segmento todos --sql demonstracoes.sql
```

- Cada arquivo é a empresa inteira: `begin; … commit;`, idempotente. Tamanhos
  medidos em 05/10/2026: bancada 856 KB, construtora 357 KB, clínica odontológica
  320 KB, indústria 378 KB, academia 338 KB. É o **mesmo** código do modo conectado.
- Ele próprio confere, em SQL, que a 9010 existe e que o slug não é de outra
  empresa. Se qualquer uma das duas falhar, aborta antes de gravar.
- Os usuários de `CLIENTE_MODELO_EMAILS_DE_ACESSO` são achados pelo e-mail
  **dentro do banco**. Se um e-mail não existir, sai um `notice`, não um erro.
- O arquivo não leva segredo nenhum: nem connection string, nem chave. O e-mail
  de acesso vai no texto.
- As datas relativas são as do momento em que o arquivo é **gerado**. Por isso,
  gere perto de aplicar.
- Aplicar duas vezes dá as mesmas contagens do modo conectado, para as cinco. Isso
  está provado em `tests/invariants/cliente-modelo-semente.test.ts`.

### Pelo MCP de plataforma

Três ferramentas ([mcp-de-implantacao.md](mcp-de-implantacao.md)):

| ferramenta | operação do token | o que faz |
|---|---|---|
| `plataforma_listar_demonstracoes` | leitura | por segmento: se existe, o id, quando a semente foi aplicada pela última vez e as contagens |
| `plataforma_criar_demonstracao` | `criar_cliente` | cria a demonstração de um segmento. Se ela já existe, não grava nada e devolve a que existe |
| `plataforma_reaplicar_demonstracao` | `implantar_configuracao` | regrava os dados fictícios e renova as datas de uma demonstração que já existe |

Quem criou o token entra como admin, junto com os `emails_de_acesso` (pessoas que já
têm login). A gravação usa a mesma função do terminal, pelo Postgres do app
(`SUPABASE_DB_URL`), numa transação só, e leva segundos: a resposta já traz as
contagens. Se o app não tiver `SUPABASE_DB_URL`, a ferramenta recusa e ensina o
caminho do `--sql`. Reaplicar recusa a empresa que não é a do segmento (outro dono
do slug) e a demonstração desmarcada (alguém tirou a trava de propósito).

### Antes de uma reunião

As datas envelhecem: o compromisso "de amanhã" vira "de ontem" e o documento
"vencendo" vira "vencido". Antes de apresentar, renove a demonstração do segmento do
cliente, pelo MCP (`plataforma_reaplicar_demonstracao` com o segmento) ou pelo
terminal (`--segmento <segmento> --aplicar`, ou o `--sql` gerado na hora). O que
alguém acrescentou à mão na demonstração continua lá; o que a semente gravou volta
ao original.

## A trava: o que bloqueia

A trava é a mesma para as cinco empresas: todas nascem marcadas, e a semente marca
primeiro e grava depois. A marca é a coluna `organizations.demonstracao`. É coluna, e não chave de
`settings`, porque `settings` é preferência que as rotas do cliente reescrevem:
bastaria um PATCH mal feito para a chave sumir e a trava abrir sem ninguém ver.

**Só a plataforma** marca e desmarca (service_role, postgres ou admin da
plataforma). Se a empresa ainda tem destino vivo, a marcação é recusada, e a
recusa diz o que desligar antes. Ao marcar, a fila de saída vira `failed`, as
assinaturas de push somem e os convites pendentes são revogados (foram emitidos
para a empresa de verdade que ela era; depois de marcada, convidar funciona).

A trava fica **no banco**, na porta por onde cada envio tem de passar antes de
sair. Ela falha fechada: recusa com `42501` e a mensagem
`organizacao_de_demonstracao: …`. O código de cada porta está em
`supabase/migrations-mia/…_9010_empresa_de_demonstracao.sql` (e a agenda do
Outlook, que chegou depois com tabela própria, em `…_9016_demonstracao_sem_agenda_microsoft.sql`).
A `…_9020_convite_de_equipe_funciona_na_demonstracao.sql` tirou da lista o convite
de equipe, e só ele (ver "O que sai de propósito", abaixo):

| envio | onde é barrado |
|---|---|
| mensagem de canal (composer, API, MCP, agente, follow-up, campanha, prospecção, lembrete, proposta, aviso ao cliente) | a fila de `messages` não aceita saída `queued`/`sending`. A tela recebe 403 `organizacao_de_demonstracao` com a frase, e o canal nunca é chamado |
| número de WhatsApp, "digitando", edição de mensagem, modelos da Meta | nenhuma sessão de canal viva. O número fictício nasce arquivado e não pode ser desarquivado |
| broadcast e campanha | não passam de rascunho para agendado ou enviando |
| aviso no grupo | não existe `settings.grupo_de_avisos`, e nenhuma regra ativa com `notify_group` |
| aviso de caso e de proposta | a configuração do aviso de caso não liga |
| webhook de saída | nenhuma regra ativa com `call_webhook` |
| conversões Meta/Google | a conexão de conversões não liga. As regras por etapa e a chave dos leads de formulário (9017) podem ser gravadas e ligadas, para a tela ser demonstrada: sem conexão ligada o consumidor para antes da rede, e o histórico mostra "não enviado" |
| agenda externa (o Google manda convite por e-mail) | nenhuma conexão de agenda |
| agenda do Outlook (a Microsoft manda convite por e-mail e cria a reunião do Teams) | conta Microsoft só existe desconectada (sem token), e não revive. Sem conexão viva não há publicação, convite, reunião do Teams nem link para entregar. Migration `9016`; a tela diz "A empresa de demonstração não conecta agenda de fora" |
| push | nenhuma assinatura de push |
| ligação (WhatsApp e tronco SIP) | a voz não liga e o tronco não ativa |
| e-mail | para o relatório LGPD ao titular, o alarme de prazo LGPD e qualquer outro e-mail com a empresa informada, o roteador de e-mail pergunta a `fn_mia_e_demonstracao` e não envia. Se não conseguir confirmar a empresa, também não envia. A única exceção é o convite de equipe (abaixo) |

**O que sai de propósito: o convite de equipe.** Decisão do Gabriel em 07/10/2026
(migration `9020`). A trava existe para nada chegar aos contatos fictícios nem a
um destino de fora. Convite de equipe é outra coisa: é o sistema falando com uma
pessoa de verdade que quem administra a empresa escolheu, e é o jeito de dar
acesso à demonstração a quem ainda não tem login. Ele funciona como em qualquer
empresa: a linha nasce em `team_invites`, o e-mail sai, a pessoa aceita e entra.

- **No banco**, `team_invites` não tem mais gatilho da trava, e a função
  `fn_mia_trava_da_demonstracao` não tem mais o ramo dela. Os outros gatilhos
  ficaram como estavam.
- **No e-mail**, o roteador (`lib/email/roteador.ts`) continua recusando e-mail de
  empresa de demonstração, com uma exceção que o chamador pede pelo nome:
  `excecaoDaTravaDaDemonstracao: "convite_de_equipe"`. Só `issueInvite` a usa, e
  um teste reprova um segundo chamador. Nada é deduzido de etiqueta nem de assunto.
- **Na tela** Convidar membros, a demonstração mostra o aviso "Esta é a empresa
  de demonstração. O convite dá acesso a ela, e nada mais sai daqui."
- O convite do **assistente de primeira configuração** (onboarding) não ganhou a
  exceção: ele manda o e-mail por outro caminho, e uma demonstração nunca passa
  por ali (nasce pronta, pela semente).

**O que ela não cobre:**

- **Testar o agente custa dinheiro de verdade.** O "Testar" do agente chama a
  OpenAI. Nada sai para ninguém, mas o custo entra no saldo real da conta.
- **Configuração em conta de fora** (template da Meta, webhook da Nuvemshop, grupos).
  Precisa de um número ou conexão viva, e a demonstração não tem nenhum. Não há
  trava própria.
- **O "Reenviar" de uma execução antiga de webhook.** Só existiria se a empresa
  tivesse regra de webhook antes de ser marcada, e a marcação recusa isso.
- **E-mail do login (GoTrue)**, como a redefinição de senha. As pessoas da
  demonstração não têm senha, estão bloqueadas e usam endereço `.invalid`.

Os testes estão em `tests/invariants/empresa-de-demonstracao-nao-envia.test.ts`,
com cada porta e um controle numa empresa de verdade (e o convite de equipe
entrando, com a prova de que só o gatilho dele saiu), em
`tests/unit/cliente-modelo-trava.test.ts`, com o 403, o e-mail e a falha fechada,
e em `tests/unit/convite-de-equipe-na-demonstracao.test.ts`, com a exceção do
convite no roteador, a rota e a tela.
Para cada demonstração por segmento, `tests/invariants/cliente-modelo-semente.test.ts`
prova que ela nasce marcada, com o número arquivado, nada em fila, os eventos da
carga consumidos e a saída enfileirada recusada na porta.

## Fora dos números da plataforma

Os dados são inventados, então a empresa não entra em:

- uso por cliente (`/admin/usage`);
- KPIs do painel (empresas ativas, conversas pendentes, estouro de fila);
- custo da Meta;
- fila morta;
- resumo diário do report da plataforma. Se não der para saber quem excluir, o
  resumo do dia não sai.

No MCP da plataforma, ela aparece com `demonstracao: true`. Pedida pelo id, continua
consultável. **Dentro dela**, os relatórios funcionam normalmente, e é para isso
que ela existe.

Ela continua de propósito no **saldo e no gasto real da OpenAI**, porque ali o
dinheiro saiu de verdade.

## Desmarcar

A plataforma pode desmarcar:

```sql
update public.organizations set demonstracao = false where id = '<id>';
```

Depois disso a empresa volta a poder enviar. Os dados fictícios continuam lá, então
desmarcar só faz sentido para apagar ou reaproveitar a empresa com cuidado.
