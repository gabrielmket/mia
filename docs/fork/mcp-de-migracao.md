# MCP de migração: trazer a base de outro CRM (fork MIA)

Ferramentas do **MCP de plataforma** para um agente (uma sessão do Claude Code, por
exemplo) migrar um cliente de outro CRM para o nosso sem ninguém clicar na tela:
**empresas, contatos, negócios e materiais**. São a metade "importação" do MCP que
implanta um cliente de ponta a ponta. O núcleo da implantação (funis, produtos,
agente, etiquetas, equipe, automações) tem roteiro próprio em
`docs/fork/mcp-de-implantacao.md`.

Este documento serve a duas pessoas: quem decide e confere a migração (as seções 1 a
7) e quem mantém o código (a seção 8).

## 1. O que precisa estar pronto

- **Um token de plataforma** com a operação certa, emitido em **Admin › Tokens de
  plataforma**. São duas operações, marcadas uma a uma:
  - **Importar base (contatos, empresas e negócios)**: para as três primeiras
    ferramentas;
  - **Importar materiais (conhecimento, fotos e modelos de proposta)**: para as três
    últimas.

  Token sem nenhuma das duas só lê. `plataforma_ver_importacao` é leitura e funciona
  com qualquer token.
- **O cliente criado** (`plataforma_criar_cliente`) e, antes dos negócios, **a equipe e
  os funis** dele. A importação não cria funil, etapa, produto nem pessoa da equipe.
- **Credenciais e acessos ficam com uma pessoa, pela tela**: conectar o número do
  WhatsApp, os tokens da Meta, as contas de agenda e a chave de IA. Nenhuma ferramenta
  daqui pede ou guarda credencial.

## 2. A ordem da migração

**equipe → funis → empresas → contatos → negócios → materiais**

A ordem existe porque cada passo se apoia no anterior: o negócio se liga ao contato
pelo telefone ou e-mail, o contato se liga à empresa pelo CNPJ ou pelo nome, e o dono
do negócio é uma pessoa da equipe achada pelo e-mail. O que não é achado **não é
criado por tabela**: o item entra sem o vínculo, a resposta avisa, e repetir a chamada
depois de completar a base faz a ligação.

Antes de começar e depois de cada passo, chame `plataforma_ver_importacao`.

## 3. As ferramentas

| Ferramenta | Tipo | Operação do token | O que faz |
|---|---|---|---|
| `plataforma_ver_importacao` | leitura | nenhuma | O retrato da base: contatos (sem telefone, bloqueados, importados), duplicatas suspeitas, empresas, negócios por origem, materiais e a indexação de cada um, produtos sem foto, trabalhos de importação dos últimos 90 dias e automações por tempo ativas |
| `plataforma_importar_empresas` | escrita | `importar_base` | Importa até 200 empresas por chamada, reconhecendo as que já existem pelo CNPJ ou pelo nome |
| `plataforma_importar_contatos` | escrita | `importar_base` | Importa até 200 contatos por chamada, reconhecendo os que já existem pelo telefone ou pelo e-mail |
| `plataforma_importar_negocios` | escrita | `importar_base` | Importa até 100 negócios por chamada (abertos, ganhos e perdidos), reconhecendo os que já existem por `origem` + `id_de_origem` |
| `plataforma_importar_conhecimento` | escrita | `importar_materiais` | Põe um arquivo (PDF, Markdown, CSV ou texto) na base de conhecimento do agente e pede a indexação |
| `plataforma_importar_fotos_de_produto` | escrita | `importar_materiais` | Baixa até 20 fotos por chamada e as põe nos produtos, achados pelo código (SKU) ou pelo nome |
| `plataforma_importar_modelo_de_proposta` | escrita | `importar_materiais` | Transforma a proposta que o cliente já usa num modelo de proposta |

Toda ferramenta recebe `organization_id` (o id do cliente, de `plataforma_listar_clientes`):
um token serve para vários clientes.

## 4. O formato de cada lista

Os exemplos usam dados fictícios. Lista maior que o teto: chame várias vezes, um
pedaço por chamada.

### Empresas

```json
{
  "organization_id": "00000000-0000-4000-8000-000000000001",
  "origem": "rdstation",
  "empresas": [
    {
      "nome": "Padaria Modelo LTDA",
      "cnpj": "12.345.678/0001-90",
      "telefone": "(11) 99999-8888",
      "email": "contato@padariamodelo.exemplo.invalid",
      "site": "https://padariamodelo.exemplo.invalid",
      "endereco": "Rua das Flores, 100",
      "observacoes": "Compra toda segunda-feira.",
      "etiquetas": ["atacado"],
      "campos": { "segmento": "alimentação" }
    }
  ]
}
```

Só `nome` é obrigatório. A empresa é reconhecida pelo **CNPJ** (com e sem pontuação é o
mesmo) e, sem CNPJ, pelo **nome** (sem diferenciar maiúsculas, acentos nem LTDA, ME,
S.A.). Nome igual com CNPJ diferente é outra empresa (matriz e filial).

### Contatos

```json
{
  "organization_id": "00000000-0000-4000-8000-000000000001",
  "origem": "rdstation",
  "contatos": [
    {
      "nome": "Ana Souza",
      "telefone": "(11) 99999-8888",
      "email": "ana.souza@exemplo.invalid",
      "etiquetas": ["cliente antigo"],
      "canal": "indicação",
      "campos": { "cidade": "Cidade Exemplo" },
      "observacao": "Prefere contato à tarde.",
      "empresa": { "cnpj": "12.345.678/0001-90", "cargo": "Compradora", "papel": "decisor", "principal": true },
      "consentimento_marketing": "concedido",
      "consentimento_em": "2026-03-14",
      "opt_out": false,
      "id_de_origem": "c-1042"
    }
  ]
}
```

`origem` é obrigatória (o nome do sistema de onde a base vem, sempre o mesmo). O
contato precisa de **telefone válido ou e-mail**; sem nenhum dos dois é recusado.
`papel` aceita `decisor`, `financeiro`, `usuario`, `influenciador` ou `outro`.
`consentimento_marketing` aceita `concedido` ou `recusado`; sem informação no CRM de
origem, não mande o campo.

A `observacao` vira uma **nota do contato** ("Observação trazida de rdstation"), que
aparece na ficha dele e que o agente de IA lê como memória daquela pessoa. Ela não é
enviada a ninguém.

### Negócios

```json
{
  "organization_id": "00000000-0000-4000-8000-000000000001",
  "origem": "rdstation",
  "negocios": [
    {
      "id_de_origem": "n-8841",
      "titulo": "Reforma do apartamento 402",
      "funil": "Comercial",
      "etapa": "Proposta enviada",
      "situacao": "aberto",
      "valor": 12500.5,
      "moeda": "BRL",
      "dono_email": "vendedor@empresa.exemplo.invalid",
      "contato_telefone": "(11) 99999-8888",
      "empresa_cnpj": "12.345.678/0001-90",
      "etiquetas": ["quente"],
      "campos": { "prazo": "junho" },
      "criado_em": "2026-03-14",
      "previsao_de_fechamento": "2026-11-30",
      "nota": "No CRM antigo: pediu o orçamento em três versões."
    }
  ]
}
```

- `id_de_origem`, `titulo` e `funil` são obrigatórios. Numa planilha sem id, use o
  número da linha.
- `funil` e `etapa` vão pelo **nome** que aparece na tela. Funil ou etapa que não
  existe é **recusado, com a lista dos que existem**: a importação nunca cria coluna no
  quadro do cliente por causa de um erro de digitação.
- `situacao`: `aberto` (padrão), `ganho` ou `perdido`. Negócio ganho vai para a etapa
  de ganho do funil; perdido vai para a de perda, e a `etapa` informada vira "em que
  etapa ele foi perdido". Para o perdido, mande `motivo_de_perda`: se o texto bate com
  um motivo do funil, é ele que fica; se não bate, entra como "Outro motivo" e o texto
  original vai para a nota de histórico.
- `valor` é na **unidade da moeda** (`12500.5` são doze mil e quinhentos reais e
  cinquenta centavos), nunca em centavos. Também aceita o texto `"12.500,50"`.
- `dono_email` é o e-mail de quem é da equipe do cliente. Quem não é achado não vira
  dono: o negócio entra sem responsável e a resposta diz.
- `nota` vira uma nota interna no histórico do negócio.
- Datas aceitam `2026-03-14` e `14/03/2026`.

### Materiais

Base de conhecimento, um arquivo por chamada:

```json
{
  "organization_id": "00000000-0000-4000-8000-000000000001",
  "nome": "Política de troca",
  "arquivo_url": "https://exemplo.invalid/politica-de-troca.pdf"
}
```

Fotos de produto:

```json
{
  "organization_id": "00000000-0000-4000-8000-000000000001",
  "fotos": [{ "produto_codigo": "CAM-001", "url": "https://exemplo.invalid/fotos/camiseta-azul.jpg" }]
}
```

Modelo de proposta:

```json
{
  "organization_id": "00000000-0000-4000-8000-000000000001",
  "nome": "Site institucional",
  "arquivo_url": "https://exemplo.invalid/proposta.pdf"
}
```

O arquivo vem por `arquivo_url` (um endereço **https público**, que abre sem login) ou,
quando é pequeno, por `arquivo_base64` (até 1 MB) com `nome_do_arquivo`.

| Material | Formatos | Teto | Observação |
|---|---|---|---|
| Conhecimento | PDF, Markdown (.md), CSV, texto (.txt) | 20 MB | Excel não: exporte como CSV. Página da web não: a plataforma não lê site |
| Foto de produto | JPG ou PNG, conferido pelo conteúdo | 5 MB | Até 5 fotos por produto |
| Modelo de proposta | PDF, Markdown, texto | 5 MB | Word não: salve como PDF. Exige as Propostas ligadas no cliente e gasta crédito de IA da plataforma |

## 5. O que a resposta diz

Cada item da lista volta com a posição (começando em 1) e um de quatro desfechos:

| Desfecho | Significa |
|---|---|
| `criou` | Não existia e foi gravado |
| `atualizou` | Já existia e ganhou o que faltava |
| `ja_estava` | Já existia e não havia o que mudar |
| `recusou` | Não entrou. O `motivo` diz o item, o campo, o que era esperado e um exemplo que passa |

Um item ruim **não derruba o lote**: os bons entram e os ruins voltam listados.
Alguns itens trazem `avisos`: entraram, mas algo ficou de fora (um vínculo não achado,
um campo que a base já tinha com outro valor).

### Repetir é seguro

Toda importação pode ser repetida inteira. Na segunda vez, o que já entrou responde
`ja_estava`. É assim que se continua uma migração que parou no meio, e é assim que se
ligam os vínculos que faltavam.

O parâmetro `quando_ja_existe` decide o que fazer com quem já está na base:

- `completar` (o padrão): só preenche o que está vazio. Nunca troca um valor que já
  existe;
- `atualizar`: o que veio preenchido na lista substitui o que havia.

Nos dois modos, **nada é apagado**: campo que não veio na lista fica como está, e
etiqueta só soma.

## 6. Os cuidados

**Nada é enviado.** Importar só grava. Nenhuma mensagem sai, ninguém é inscrito em
follow-up, nenhuma automação dispara (nem a de "negócio criado", nem a de entrada em
etapa, nem a de etiqueta), nenhuma tarefa é criada, a equipe não recebe aviso e
nenhuma conversão é registrada para a Meta ou o Google. Isso vale também para negócio
importado como ganho, e também na empresa de demonstração.

**As automações por tempo valem depois.** Uma regra do tipo "30 dias na mesma etapa"
ou "no aniversário do contato" não nasce de um evento: nasce do relógio, e vale para
toda a base, inclusive o que foi importado. Um negócio aberto importado hoje começa a
contar os dias a partir de hoje. `plataforma_ver_importacao` lista as regras desse tipo
que estão ativas: confira se alguma envia mensagem **antes** de importar negócios
abertos, e pause na tela Automações se não for a hora.

**O nono dígito.** O mesmo número com e sem o nono dígito, com e sem `+55`, com e sem
máscara, é a mesma pessoa. O celular brasileiro é guardado sempre com o nono dígito.
Telefone sem código de país é lido como brasileiro; número de outro país precisa vir
com `+` e o código.

**Duplicatas.** A importação não funde duas pessoas. Se o telefone de uma linha é de um
contato e o e-mail é de outro, ela atualiza o do telefone, não mexe no outro e avisa.
Juntar os dois é decisão de uma pessoa, em **Contatos › Duplicados**. O telefone de um
contato que já tem telefone nunca é trocado pela importação.

**Opt-out.** Quem veio com `opt_out: true` entra **bloqueado para todo envio**. E a
importação só bloqueia: quem já está bloqueado continua bloqueado, mesmo que a lista
diga o contrário. A recusa de marketing (`consentimento_marketing: "recusado"`) também
vale sempre, e uma concessão nunca passa por cima de uma recusa já registrada.

**Só importe base que o cliente tem direito de usar (LGPD).** Pessoas com quem ele tem
relação ou que consentiram. Lista comprada não entra. E quem pediu para ser apagado no
sistema novo e ainda está na planilha do sistema antigo seria criado de novo: tire
essas pessoas da lista antes.

**A data dos negócios.** Negócio ganho ou perdido leva a data de criação e a de
fechamento do CRM de origem, e aparece no relatório do mês em que aconteceu. Negócio
**aberto** nasce com a data da importação (a original fica guardada no registro), para
não disparar regra de "N dias sem mensagem" para a base inteira de uma vez.

**Reexecução não move negócio.** Num negócio que já foi importado, repetir a chamada
atualiza dados (título, valor, etiquetas, campos), mas **não** muda etapa, situação nem
dono. Mover um negócio dispara os efeitos de etapa, e isso se faz pela tela.

**O modelo de proposta é montado por IA.** Confira as seções na tela antes de usar.

## 7. Como conferir

1. Chame `plataforma_ver_importacao`. Para cada área ela diz o que está pronto, o que
   falta (com a ferramenta que resolve) e o que só uma pessoa faz, pela tela. Compare
   os números com os do CRM de origem: contatos, empresas e negócios por situação.
2. Na tela do cliente: **Contatos** (os importados aparecem com o canal IMPORT),
   **Empresas**, o **funil** (os cartões na etapa certa, os ganhos e perdidos fora das
   etapas abertas), **Conhecimento** (a situação da indexação) e **Produtos**.
3. **Contatos › Duplicados**: junte o que a migração revelou.
4. Em **Auditoria**, cada chamada de importação deixa uma linha na organização
   (`plataforma.importacao`) com as contagens e os ids, sem nome, telefone nem e-mail.

### O que fica só pela tela

- Conectar o WhatsApp, a Meta, as agendas e a chave de IA.
- Juntar contatos e empresas duplicados.
- Tirar o bloqueio de quem pediu para não receber mensagens.
- Mover, ganhar, perder ou trocar o dono de um negócio já importado.
- Trocar o conteúdo de um material de conhecimento, reordenar e tirar fotos, e revisar
  o modelo de proposta.

## 8. Para quem mantém o código

Tudo mora em `lib/mcp-plataforma/importacao/`, um arquivo por assunto.

### Os pontos de encaixe

| O que sai da pasta | Onde entra |
|---|---|
| `FERRAMENTAS_DE_IMPORTACAO` | `lib/mcp-plataforma/ferramentas.ts`, uma linha |
| `OPERACOES_DE_IMPORTACAO` | `lib/mcp-plataforma/operacoes.ts`, uma linha. A tela dos tokens lista a partir de `OPERACOES`, então as duas caixinhas aparecem sozinhas |
| `AREAS_DE_IMPORTACAO` | O checklist da implantação. Cada área é `{ chave, rotulo, situacao(ctx, organizationId) }` e devolve `{ pronto, falta, so_pela_tela, numeros }` |
| `argumentosParaAuditoria` | `lib/mcp-plataforma/servidor.ts`, uma linha: é o que tira a lista de pessoas da linha `plataforma.mcp_executado` |

`tests/unit/mcp-de-migracao-base.test.ts` reprova se uma dessas ligações se perder.

### Onde o código do upstream foi tocado

| Arquivo | O que mudou |
|---|---|
| `app/api/v1/leads/_handler.ts` | `createLeadHandler` aceita `importacao_silenciosa` (interno): leva a história de origem para o insert e não emite `lead.created` |
| `lib/audit/actions.ts` | A ação `plataforma.importacao` |
| `lib/mcp-plataforma/servidor.ts` | Os argumentos passam por `argumentosParaAuditoria` antes da trilha |

`lib/cartoes/canal.ts` (nosso) ganhou a regra que mostra `IMPORT` para o que nasceu de
migração.

### Por que a importação é silenciosa

Todo efeito colateral do produto nasce de uma linha em `event_log`. A importação não
emite nenhuma:

- **contatos** são gravados direto, como a importação por planilha faz, mas sem o
  `contact.created` dela e sem o `contact.tag_added` da edição pela tela (gatilho de
  automação), e sem abrir conversa;
- **negócios** nascem pelo `createLeadHandler`, o caminho da tela, com
  `importacao_silenciosa`: sem `lead.created`. E nascem direto na etapa final: o
  gatilho `fn_crm_lead_close_on_stage` declara o negócio ganho ou perdido pela etapa, e
  o gatilho que emite `lead.won` e `lead.lost` só roda em UPDATE. Por isso não há
  conversão, automação de ganho, aviso nem follow-up de etapa;
- na **reexecução**, a importação só atualiza colunas de dado. Etapa, situação e dono
  ficam de fora porque são UPDATE que o banco transforma em evento.

A única exceção é desejada: o arquivo de conhecimento emite `knowledge_source.updated`,
o mesmo evento da tela, que é o que faz o indexador rodar.

A prova está em `tests/invariants/mcp-de-migracao-importa-em-silencio.test.ts`: importa
uma base inteira num Postgres de verdade, com automações armadas, e confere que a fila
de eventos fica vazia e que rodar de novo não muda uma coluna.

### Onde fica a chave do CRM de origem

Nas colunas que `crm_leads` já tinha para isso: `source = "importacao:<origem>"` e
`external_id = <id_de_origem>`, com o índice único `uniq_crm_leads_org_source_external`
(o mesmo dos leads dos formulários da Meta e das fontes de webhook). Não houve
migration. Contatos e empresas não precisam de chave externa: são reconhecidos pelo
telefone, pelo e-mail e pelo CNPJ. O `id_de_origem` do contato fica em
`source_metadata.importacao`, como registro.

### Qual tabela de empresa

`crm_empresas`, a que as fichas e os cartões leem (`docs/fork/cartoes-e-fichas.md`). A
outra representação (`companies` e `people`, o módulo B2B do upstream, com o
enriquecimento pela Receita) não é tocada, e por isso nenhuma consulta à Receita é
disparada.

### O que a importação reaproveita das rotas

As ferramentas de materiais usam as mesmas funções de domínio das rotas da tela
(`resolverExtensao`, `extrairTextoDoArquivo`, `farejarTipo`, `gerarModeloDoTexto`,
`validarModelo`, `slugDaEmpresa`, `proximaVersao`), sem reescrever as rotas. Três
números são constantes locais das rotas e foram repetidos aqui: o teto de 20 MB e o
tipo por extensão do envio de conhecimento, e o teto de 5 MB do modelo de proposta.
`tests/unit/mcp-de-migracao-materiais.test.ts` confere os três contra o texto das
rotas e reprova se o upstream mudar um deles.

O download por endereço usa as duas guardas dos webhooks de saída
(`assertSafeOutboundUrl` e `assertDestinoResolvidoSeguro`), só aceita `https`, e passa
cada redirecionamento pelas mesmas guardas.

### Lacunas conhecidas

- **Não existe biblioteca de arquivos para ENVIAR ao cliente** (catálogo em PDF, tabela
  de preço). O produto envia a foto de um produto e o PDF de uma proposta, e só. Uma
  biblioteca assim seria uma tabela de materiais por organização com um bucket próprio,
  ligada ao envio de mensagem (`media_storage_path`) e a uma ferramenta do agente. Não
  foi construída nesta entrega.
- **A base de conhecimento não lê site.** Os tipos de material são perguntas e
  respostas, documento, conversas e catálogo. Um endereço só serve se for o de um
  arquivo.
- **A importação não escreve no módulo B2B** (`companies` e `people`). Quem usa esse
  módulo importa por lá, pela tela Importações.
