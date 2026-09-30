# O cliente modelo · a empresa de demonstração

A MIA não tem uma empresa que use todos os recursos da plataforma. Para testar,
medir e mostrar em venda, existe a **Empresa Modelo · Demonstração**: uma empresa
com dados fictícios que passa por todos os recursos. Ela fica em produção, separada
das outras, com uma marca que trava qualquer envio real e a tira dos números da
plataforma. A decisão é do Gabriel (30/09/2026).

Dentro dela aparece, em toda tela, o selo **Demonstração** ("Dados fictícios.
Nenhuma mensagem, e-mail ou aviso sai desta empresa."). Na lista de empresas do
admin, o mesmo selo aparece ao lado do nome.

## O que a semente grava

| área | o que entra |
|---|---|
| funis | 9 funis. Seis saem dos quadros prontos do onboarding: clínica, imobiliária, serviços B2B, cursos, loja e geral (este é o padrão). Os outros três são automotivo, academia e o **Comercial**, que recebe o que a IA passa. Todos têm campos personalizados, motivos de perda com categoria e motivos de ganho, e **pelo menos um negócio em cada etapa** |
| negócios | 62 negócios, cada um com valor, dono (pessoa ou a IA "Sofia"), origem, próxima ação (uma tarefa com prazo ligada ao card) e histórico na timeline. As origens são cinco: formulário da Meta, clique para o WhatsApp, Google, site e indicação |
| contatos e empresas | 54 contatos, com e sem empresa. As 5 empresas têm várias pessoas e existem nas duas entidades do produto: `crm_empresas` (a da ficha e do card) e `companies`/`people` (o módulo B2B) |
| atendimento com a IA | 8 conversas fictícias (47 mensagens). Em cada uma entram a qualificação da IA (`lead_state`), a ficha (`lead_notes`) e, quando houver, a passagem para uma pessoa e o card no Comercial |
| follow-ups | os 24 modelos por segmento (geral, clínica, imobiliário, automotivo, academia, serviços B2B). Os que estão em uso ficam publicados, com inscrições em andamento e terminadas e o registro de cada passo. Os demais ficam em rascunho |
| agenda | 13 compromissos: passados (feito, faltou, cancelado) e futuros (confirmado, pendente), com o lembrete desligado |
| tarefas | a próxima ação de cada negócio e mais algumas tarefas soltas, uma delas atrasada |
| equipe | 4 pessoas fictícias **sem senha e bloqueadas**. Só servem para ser donas de card, tarefa e compromisso |

Os dados não batem em pessoa real. Os telefones são **`+55 00 9xxxx-xxxx`**, e o
DDD 00 não existe. Os e-mails são **`@exemplo.invalid`**, um domínio reservado
(RFC 2606) que nenhum servidor aceita. Nenhum nome é de cliente da Time Company.

**Ainda falta:** documentos e obrigações. O produto ainda não tem onde guardá-los
por empresa; o `TODO` está em `lib/demonstracao/semente/aplicar.ts`.

## Como rodar

O banco precisa ter a migration **9010**. Sem ela, o script para sem gravar nada.

```bash
# 1. só mostra o alvo; nada é gravado
CLIENTE_MODELO_DATABASE_URL='postgresql://USUARIO:SENHA@HOST:5432/postgres' \
  npx tsx scripts/cliente-modelo.ts

# 2. grava (ou renova)
CLIENTE_MODELO_DATABASE_URL='postgresql://…' \
CLIENTE_MODELO_EMAILS_DE_ACESSO='voce@timecompany.com.br,colega@timecompany.com.br' \
  npx tsx scripts/cliente-modelo.ts --aplicar
```

- **`CLIENTE_MODELO_DATABASE_URL`**: a connection string do Postgres. Ela fica só
  no ambiente de quem roda, nunca no código nem em arquivo versionado. Se o banco
  exigir SSL, acrescente `?sslmode=require`.
- **`CLIENTE_MODELO_EMAILS_DE_ACESSO`**: usuários que **já existem** na instalação
  e entram como admin da demonstração. E-mail que não existe vira aviso na saída,
  não erro. Essa é a porta de entrada, porque convite de equipe é e-mail e a trava
  o recusa. O admin da plataforma também entra pelo suporte, como em qualquer
  empresa.
- **Idempotente**: rodar de novo não duplica nada, porque cada linha tem id
  estável. As datas relativas também se renovam: o compromisso "de amanhã" volta
  a ser de amanhã, e os follow-ups voltam a esperar. Vale rodar antes de uma
  apresentação.
- Tudo acontece numa transação só. Ou a empresa inteira fica de pé, ou nada muda.

### Sem acesso ao Postgres: o modo `--sql`

O banco de produção da MIA (`supabase-sistema-mia`) não expõe o Postgres para
fora. O único jeito de rodar SQL ali é o `/pg/query` do postgres-meta, pelo Kong,
com a service key: ele recebe um texto SQL e executa. Para esse caso, a semente
gera o SQL em vez de conectar:

```bash
CLIENTE_MODELO_EMAILS_DE_ACESSO='voce@timecompany.com.br' \
  npx tsx scripts/cliente-modelo.ts --sql cliente-modelo.sql
```

- Gera o arquivo inteiro: `begin; … commit;`, idempotente, com cerca de 800 KB.
  É o **mesmo** código do modo conectado.
- Ele próprio confere, em SQL, que a 9010 existe e que o slug não é de outra
  empresa. Se qualquer uma das duas falhar, aborta antes de gravar.
- Os usuários de `CLIENTE_MODELO_EMAILS_DE_ACESSO` são achados pelo e-mail
  **dentro do banco**. Se um e-mail não existir, sai um `notice`, não um erro.
- O arquivo não leva segredo nenhum: nem connection string, nem chave. O e-mail
  de acesso vai no texto.
- As datas relativas são as do momento em que o arquivo é **gerado**. Por isso,
  gere perto de aplicar.
- Aplicar duas vezes dá as mesmas contagens do modo conectado. Isso está provado
  em `tests/invariants/cliente-modelo-semente.test.ts`.

## A trava: o que bloqueia

A marca é a coluna `organizations.demonstracao`. É coluna, e não chave de
`settings`, porque `settings` é preferência que as rotas do cliente reescrevem:
bastaria um PATCH mal feito para a chave sumir e a trava abrir sem ninguém ver.

**Só a plataforma** marca e desmarca (service_role, postgres ou admin da
plataforma). Se a empresa ainda tem destino vivo, a marcação é recusada, e a
recusa diz o que desligar antes. Ao marcar, a fila de saída vira `failed`, as
assinaturas de push somem e os convites pendentes são revogados.

A trava fica **no banco**, na porta por onde cada envio tem de passar antes de
sair. Ela falha fechada: recusa com `42501` e a mensagem
`organizacao_de_demonstracao: …`. O código de cada porta está em
`supabase/migrations-mia/…_9010_empresa_de_demonstracao.sql`:

| envio | onde é barrado |
|---|---|
| mensagem de canal (composer, API, MCP, agente, follow-up, campanha, prospecção, lembrete, proposta, aviso ao cliente) | a fila de `messages` não aceita saída `queued`/`sending`. A tela recebe 403 `organizacao_de_demonstracao` com a frase, e o canal nunca é chamado |
| número de WhatsApp, "digitando", edição de mensagem, modelos da Meta | nenhuma sessão de canal viva. O número fictício nasce arquivado e não pode ser desarquivado |
| broadcast e campanha | não passam de rascunho para agendado ou enviando |
| aviso no grupo | não existe `settings.grupo_de_avisos`, e nenhuma regra ativa com `notify_group` |
| aviso de caso e de proposta | a configuração do aviso de caso não liga |
| webhook de saída | nenhuma regra ativa com `call_webhook` |
| conversões Meta/Google | a conexão de conversões não liga |
| agenda externa (o Google manda convite por e-mail) | nenhuma conexão de agenda |
| push | nenhuma assinatura de push |
| ligação (WhatsApp e tronco SIP) | a voz não liga e o tronco não ativa |
| e-mail | o convite de equipe não nasce. Para o relatório LGPD ao titular e o alarme de prazo LGPD, o roteador de e-mail pergunta a `fn_mia_e_demonstracao` e não envia. Se não conseguir confirmar a empresa, também não envia |

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
com cada porta e um controle numa empresa de verdade, e em
`tests/unit/cliente-modelo-trava.test.ts`, com o 403, o e-mail e a falha fechada.

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
