# Documentos e obrigações com vencimento (fork MIA)

Tem cliente que precisa pedir, ou avisar, os **próprios clientes** de renovar
documentação (alvará, AVCB, licença sanitária, CNH, certificado digital) e de
cumprir o que se repete (relatório mensal, renovação anual do contrato, revisão
semestral). Isso morava numa planilha ao lado do sistema. Passa a morar numa lista
só, **Obrigações**, com os avisos saindo pelas automações que já existem.

O protótipo clicável foi aprovado pelo Gabriel em 01/10/2026. O visual é o do
sistema; do protótipo vieram as regras, e as funções dele viraram
`lib/obrigacoes/`. Schema na migration **9018**.

## 1. O que é uma obrigação

Um item, de um de dois tipos:

| tipo | o que é | exemplos |
|---|---|---|
| **Documento** | algo que o cliente entrega, ou que tem validade | alvará, AVCB, licença sanitária, CNH, contrato assinado |
| **Atividade recorrente** | algo que se repete e precisa ser lembrado | relatório mensal, renovação anual, revisão semestral |

Cada item guarda:

- **o tipo**, escolhido no catálogo do funil ou escrito à mão;
- **a quem está ligado**: negócio, empresa e/ou contato (pelo menos um);
- **quem entrega**: o cliente (nós pedimos) ou nós (entregamos ao cliente);
- **as datas**: pedido em, prazo para entregar, recebido em, válido até
  (documento); próxima data e última feita (atividade);
- **a recorrência**: única, mensal, anual ou a cada N meses;
- **a antecedência dos avisos**: até três, em dias (30, 15 e 7, por exemplo);
- **o arquivo** do documento, em área privada;
- **o responsável**, uma observação e o **histórico dos ciclos**.

### A situação é calculada, ninguém digita

O banco guarda as **datas**. A situação sai delas, por uma função só
(`lib/obrigacoes/situacao.ts`), que a tela, o servidor, a varredura dos avisos, a
ferramenta do agente e o MCP chamam. Uma coluna de situação envelheceria sozinha
à meia-noite, e a tela diria "válido" para um documento vencido.

| tipo | caminho |
|---|---|
| Documento | a pedir → pedido → recebido → válido → vencendo → vencido (e "renovado" é a marca do ciclo novo) |
| Atividade | pendente → feita (e o próximo ciclo nasce sozinho) |

- **vencendo** começa no maior aviso do item (30 dias, se o item não tiver aviso);
- **pedido sem resposta** é o documento pedido há X dias (5 por padrão, ajustável
  no item) que ainda não chegou;
- **recebido** é o documento recebido sem "válido até": fica em dia e não entra
  nos avisos de vencimento;
- as datas são **dias do calendário** no fuso da empresa (`date`, e não instante).

`tests/unit/obrigacoes-situacao.test.ts` roda a tabela de casos do protótipo (os 21
itens de exemplo, com o hoje em 01/10/2026) e anda o calendário dia a dia.

### Os botões

| botão | o que faz |
|---|---|
| **Marcar pedido** | registra o pedido de hoje, com **prazo de 7 dias**. Nada é enviado ao cliente por aqui |
| **Pedir de novo** | com pedido em aberto, é uma cobrança: a data do pedido não muda |
| **Marcar recebido** | abre o painel de receber: o arquivo (opcional) e o "válido até", **sugerido** pela validade padrão do tipo. Sem data, o item fica "recebido · sem validade" |
| **Receber versão nova** | o mesmo painel; o ciclo atual vai para o histórico |
| **Marcar feita** | a atividade ganha a próxima data, um período depois, e o ciclo feito vai para o histórico |

Fechar um ciclo é uma transação só (`fn_mia_obrigacao_fechar_ciclo`): duas pessoas
confirmando o mesmo recebimento não fecham dois ciclos; a segunda é recusada.

## 2. Herança: um registro, três lugares

O item é **um registro só**. Mexer nele num lugar muda no outro, porque não há cópia.

- o que é da **empresa** aparece em todos os negócios dela;
- o que é do **contato** acompanha a pessoa nos negócios em que ela é o contato;
- o que é do **negócio** fica só nele.

A herança é leitura (`lib/obrigacoes/heranca.ts`). As três ligações são
`on delete set null`: apagar o negócio não leva o alvará que também é da empresa.
O item que fica sem dono nenhum sai, e o arquivo dele vai para a fila de remoção.

## 3. Onde aparece

| lugar | o que mostra |
|---|---|
| **Cartão fechado do funil** | UM aviso curto no rodapé, o mais urgente ("Alvará venceu há 3 dias", "Relatório mensal em 4 dias", "Contrato social: pedido há 6 dias, sem resposta"). Mora dentro da linha do rodapé, cortado com reticências e inteiro ao passar o mouse: a altura do cartão não muda. **Nada** quando está tudo em dia |
| **Cartão aberto · Foco** | só o que pede ação agora: a proposta do agente esperando confirmação e os itens vencidos, vencendo ou pedidos sem resposta, cada um com o botão direto |
| **Cartão aberto · seção "Documentos e obrigações"** | três grupos: do negócio, da empresa (herdado), do contato (herdado) |
| **Ficha da empresa** | da empresa, dos contatos dela e, quando há, dos negócios dela |
| **Ficha do contato** | do contato e da empresa dele (herdado) |
| **Obrigações** (`/app/obrigacoes`) | a lista geral: a agenda de renovações da carteira, com quatro contadores (vencidos, vencendo em 30 dias, pedidos sem resposta, em dia), filtros (situação, tipo, responsável, prazo, ligado a) e ordem por urgência. A linha abre o item; o nome de quem ele é leva ao negócio ou à ficha |

A lista geral está no **hub** e na busca (⌘K), e não na barra lateral, que já está no
teto de itens. O aviso do cartão fechado sai da rota do quadro
(`lib/obrigacoes/sinais.ts`, chamado por `lib/cartoes/sinais-do-quadro.ts`); se a
leitura falhar, o cartão fica como estava.

## 4. O catálogo de tipos por funil

O tipo traz validade padrão, recorrência, avisos, quem entrega e a quem costuma se
ligar. É só o ponto de partida: tudo é copiado para o item e pode ser mudado nele.

Configura-se em **Configurações › Etapas do funil**, no cartão "Documentos e
obrigações": um catálogo por funil, com **"Usar o modelo do segmento"**. Os modelos
(`lib/obrigacoes/catalogo.ts`) cobrem Serviços B2B, Clínica, Imobiliária, Automotivo
e proteção veicular, Academia e Indústria e distribuição B2B. O de indústria traz o
cadastro da revenda (ficha cadastral, contrato social, alvará, certidão negativa e
contrato de revenda) e o ritmo da carteira: o pedido de reposição todo mês (a
recompra), a visita do representante a cada dois meses e o reajuste anual da tabela.
O formulário de adicionar oferece os tipos do funil, os da empresa e "Outro ·
escrever o nome".

### Privacidade

**Atestado médico, laudo de saúde e exame ficam FORA dos modelos**: são dado
sensível (LGPD, art. 5º, II). Nenhum segmento oferece um tipo desses pronto, e um
teste reprova se alguém incluir. Quem cria um tipo desses à mão vê um aviso na
tela. Obrigação nenhuma alimenta campanha, público ou conversão.

## 5. O arquivo

Bucket **privado** `mia-obrigacoes`, sem policy: só o servidor lê e escreve. A tela
recebe um link assinado de 60 segundos, depois de a rota conferir o papel (`agent`
em diante) e ler o item pela regra de acesso de quem pediu. Teto de 25 MB; PDF,
imagem (JPG, PNG, WEBP, HEIC), Word e Excel.

Arquivo que nada mais aponta (item apagado, arquivo trocado sem ir ao histórico)
entra na fila de remoção do upstream (`storage_redaction_queue`).

## 6. O agente de IA propõe, a pessoa confirma

O agente do WhatsApp ganhou duas capacidades, no pacote **Reter**:

| capacidade | o que faz |
|---|---|
| `crm_listar_obrigacoes_pendentes` | leitura: o que está pendente com o cliente (do contato, da empresa dele e dos negócios abertos dele), para o agente lembrar ou pedir na conversa |
| `crm_propor_recebimento_de_documento` | grava uma **proposta**: "o cliente mandou um arquivo; é o alvará pedido?" |

A proposta aparece no Foco do cartão aberto e nas fichas, com **"Sim, marcar
recebido"** e **"Não é"**. O agente **nunca** marca recebido: reconhecer um
documento pela conversa erra (foto errada, documento de outra pessoa, versão
vencida), e um "recebido" errado apaga o pedido e dispara a automação de documento
recebido. Quem responde por isso é uma pessoa.

- "Sim" abre o painel de receber já com o arquivo da conversa; ao confirmar, o
  arquivo é **copiado** da conversa para a área privada das obrigações.
- "Não é" grava a recusa: o arquivo fica só na conversa e o item continua pendente.
- A proposta só nasce quando o arquivo é de quem tem a ver com o item (o próprio
  contato, um negócio dele ou a empresa dele).
- Há no máximo uma proposta pendente por item; a mais nova substitui a anterior.

## 7. Os avisos são automações

Não há motor novo. São **cinco gatilhos** a mais no QUANDO das automações, com as
ações de sempre no FAÇA (mensagem com modelo aprovado, tarefa para o responsável,
aviso no grupo do time, mover o negócio de etapa, etiqueta, abrir um negócio).

| gatilho | quando dispara | configuração |
|---|---|---|
| `obrigacao.documento_vencendo` | X dias antes do "válido até" | `{ "dias": 30, "tipo": "<opcional>" }` |
| `obrigacao.documento_vencido` | no dia seguinte ao vencimento | `{ "tipo": "<opcional>" }` |
| `obrigacao.documento_nao_enviado` | pedido há X dias sem receber | `{ "dias": 5, "tipo": "<opcional>" }` |
| `obrigacao.documento_recebido` | quando uma pessoa marca recebido, ou confirma a proposta do agente | `{ "tipo": "<opcional>" }` |
| `obrigacao.atividade_chegando` | X dias antes da próxima data | `{ "dias": 15, "tipo": "<opcional>" }` |

As quatro garantias (`lib/obrigacoes/avisos.ts`):

1. **Só quem pediu.** A varredura começa pelas regras ativas: empresa sem regra
   desses gatilhos não é varrida.
2. **Uma vez por item e ciclo.** A trava é uma linha por regra, item, gatilho,
   ciclo e data medida (`mia_obrigacoes_avisos`), gravada na mesma transação do
   evento (`fn_mia_obrigacao_disparar`). Renovou, o ciclo sobe e o aviso volta a
   valer; corrigiu a data, vale para a data nova.
3. **Nada do passado.** O aviso só sai se o dia dele não é anterior ao dia em que o
   item entrou no sistema nem ao dia em que a regra foi ligada ou mudada. Planilha
   migrada e regra ligada hoje não mandam aviso atrasado. Quem perdeu a hora (o
   agendador fora do ar) é alcançado por até dois dias.
4. **"Não enviado" espera a confirmação.** Se o cliente já mandou um arquivo e a
   proposta do agente espera uma pessoa, o aviso fica **segurado**. Recusada a
   proposta, sai na rodada seguinte; recebido o documento, é descartado.

**Documento vencido só move o negócio de etapa se a regra tiver a ação de mover.**
O gatilho por si não muda nada.

A varredura roda de hora em hora (`43 * * * *`, rota
`/api/v1/cron/obrigacoes-avisos`) e age na empresa cujo relógio marca 9h, como a
varredura de data do funil. O evento leva o próprio item como entidade
(`mia_obrigacao`) e é dirigido a uma regra; `lib/obrigacoes/contexto-da-automacao.ts`
o transforma em negócio e contato para as ações (item da empresa: o negócio aberto
mais recente dela).

Nos textos das ações: `{{obrigacao.nome}}`, `{{obrigacao.data}}`,
`{{obrigacao.situacao}}`, `{{obrigacao.dias}}`.

Na tela de automações, a configuração do gatilho mostra **o que a regra faria
hoje** (quantos itens dispararia e quais ficariam segurados), sem gravar nada. É o
"simular" do protótipo.

## 8. Pelo MCP de plataforma

| ferramenta | operação | para quê |
|---|---|---|
| `plataforma_ver_obrigacoes` | leitura | os contadores, os itens por situação e o catálogo |
| `plataforma_garantir_tipos_de_obrigacao` | `implantar_configuracao` | o catálogo de um funil, inclusive `modelo_do_segmento` |
| `plataforma_garantir_obrigacoes` | `importar_base` | os itens, em lote (até 100 por chamada): a implantação e a **migração da planilha de vencimentos** |

- A **chave** de um item é o tipo mais a quem ele está ligado: a segunda rodada não
  duplica. Item criado pela tela (sem chave) com o mesmo tipo e os mesmos donos é
  adotado, e não duplicado.
- A situação não é informada: mandam-se as datas. Um `recebido_em` (ou `feita_em`)
  mais novo que o gravado fecha o ciclo, como na tela.
- **Migrar não acorda automação**: nenhum evento de documento recebido, e nenhum
  aviso de vencimento que já devia ter saído.
- Os cinco gatilhos aparecem em `plataforma_listar_modelos` (seções `automacoes` e
  `obrigacoes`) e são aceitos por `plataforma_garantir_automacao`, com
  `configuracao_do_gatilho`.
- O checklist (`plataforma_ver_implantacao`) tem a área `obrigacoes`, opcional: ela
  nunca entra em "falta".

## 9. LGPD

- **Anonimizar o contato** leva junto, na mesma transação: os itens ligados à pessoa
  saem inteiros (com histórico e propostas); os dos negócios dela ficam sem arquivo
  e sem observação; todo arquivo vai para a fila de remoção.
- O **relatório de acesso** entrega os itens, o histórico e as propostas da pessoa
  (`lib/lgpd/export-collector.ts`, no `data.json`).
- A auditoria leva o tipo e as datas, nunca o conteúdo do arquivo.
- Contato mesclado: os itens passam para a ficha que ficou. Empresa mesclada, idem.

## 10. Quem vê e quem grava

| papel | o que pode |
|---|---|
| `viewer` | ver os itens e a lista |
| `agent` | adicionar, pedir, receber, marcar feita, anexar e abrir o arquivo, decidir a proposta do agente |
| `manager` | o catálogo de tipos do funil e a simulação do gatilho |

O item de um negócio que a pessoa não enxerga também não aparece para ela (a regra
de visibilidade dos negócios vale por dentro). O suporte em modo somente leitura não
grava.

## 11. Na empresa de demonstração

A Empresa Modelo (`lib/demonstracao/semente/`) traz o catálogo de Serviços B2B e 11 itens
com datas relativas a hoje: um vencido com a renovação pedida, três vencendo (um
deles com um arquivo do cliente esperando confirmação), um pedido sem resposta, um
ainda a pedir, dois válidos e três atividades recorrentes com histórico. Renovar a
semente devolve cada item à situação que ele ilustra.

As demonstrações por segmento trazem o catálogo do segmento delas, com itens no
mesmo estilo: a construtora com a documentação do comprador, a clínica odontológica
com o retorno de seis meses, a indústria com o cadastro da revenda e o pedido de
reposição, e a academia com a renovação do plano e a reavaliação física. O que cada
uma mostra está em [cliente-modelo.md](cliente-modelo.md).

A demonstração **não envia**: a semente não cria regra de aviso nem evento, a
mensagem de saída é recusada no banco (migration 9010) e a regra que avisaria o
grupo do time nem liga. As propostas da demonstração não têm arquivo de verdade:
confirmar recebe o documento sem arquivo, e a tela diz isso.

## 12. Para quem mexe no código

| o que | onde |
|---|---|
| schema, RLS, funções e gatilhos | `supabase/migrations-mia/20261002100000_9018_obrigacoes_documentos_e_atividades.sql` (espelhado em `baseline-mia.sql`) |
| a situação, a urgência, os botões (puro) | `lib/obrigacoes/situacao.ts`, `ciclo.ts`, `datas.ts`, `heranca.ts`, `lista.ts` |
| os modelos por segmento (puro) | `lib/obrigacoes/catalogo.ts` |
| os gatilhos (puro) e a varredura | `lib/obrigacoes/gatilhos.ts`, `avisos.ts`, `contexto-da-automacao.ts` |
| leitura, operações, arquivo | `lib/obrigacoes/leitura.ts`, `operacoes.ts`, `arquivo.ts`, `catalogo-servidor.ts` |
| rotas | `app/api/v1/obrigacoes/...`, `app/api/v1/cron/obrigacoes-avisos/` |
| telas | `components/obrigacoes/`, `app/app/obrigacoes/` |
| agente | `lib/mcp/tools/obrigacoes.ts`, `lib/mcp/tools/catalogo/mia.ts` |
| MCP de plataforma | `lib/mcp-plataforma/ferramentas/obrigacoes.ts`, `lib/implantacao/obrigacoes.ts` |
| frases em espanhol | `lib/i18n/dicionario-obrigacoes-mia.ts` |

Os módulos marcados "puro" não importam banco, sessão nem nada que chegue a
`next/headers`: componente de navegador importa deles.

### Onde o código do upstream foi tocado

Poucas linhas, todas marcadas `FORK MIA`:

| arquivo | o que entrou |
|---|---|
| `lib/schemas/webhooks.ts` | os cinco gatilhos na lista que o motor reconhece, e a recusa do gatilho de X dias sem o X |
| `lib/automation/engine.ts` | um ramo em `buildContext` para a entidade `mia_obrigacao` |
| `app/app/webhooks/_components/labels.ts` e `RuleEditor.tsx` | as frases dos gatilhos e a configuração deles |
| `components/kanban/KanbanCard.tsx` | o aviso no rodapé do cartão |
| `docker/scheduler/entrypoint.sh` | a linha da varredura |
| `lib/audit/actions.ts` | as ações `obrigacao.*` |
| `lib/navigation/catalogo.ts` | o item "Obrigações" (hub e busca) |
| `lib/mcp/tools/index.ts`, `lib/leads/escopo-de-funil.ts` | as duas ferramentas do agente |
| `lib/lgpd/export-collector.ts` | as obrigações no relatório de acesso |
| `app/app/settings/tenant/pipelines/page.tsx` | o cartão do catálogo de tipos |

### Provas

| o que | onde |
|---|---|
| a situação, dia a dia, pela tabela do protótipo | `tests/unit/obrigacoes-situacao.test.ts` |
| ciclo, herança, filtros | `tests/unit/obrigacoes-ciclo-heranca-e-lista.test.ts` |
| gatilhos, janela e ligação com o motor | `tests/unit/obrigacoes-gatilhos.test.ts`, `obrigacoes-contexto-da-automacao.test.ts` |
| modelos sem dado sensível, frases em espanhol | `tests/unit/obrigacoes-catalogo-e-dicionario.test.ts` |
| o agente só propõe | `tests/unit/obrigacoes-ferramentas-do-agente.test.ts` |
| telas | `tests/unit/obrigacoes-telas.test.tsx`, `cartao-fechado-mia.test.tsx` |
| RLS entre empresas e por papel, ciclo, trava dos avisos, LGPD, demonstração | `tests/invariants/obrigacoes.test.ts` |
| MCP e varredura no Postgres de verdade | `tests/invariants/obrigacoes-pelo-mcp.test.ts` |
| a semente da demonstração | `tests/invariants/cliente-modelo-semente.test.ts` |

### Lacunas conhecidas

- A situação do filtro da lista geral é calculada no navegador: a lista traz até
  3.000 itens e avisa quando chega ao teto.
- Na lista geral, "Adicionar" liga o item a uma empresa ou a um contato. Para ligar
  a um negócio, o caminho é o cartão do negócio.
- O relatório de acesso da LGPD leva as obrigações no `data.json`; a versão para
  leitura (PDF) ainda não tem a seção.
- O upstream ganhou a régua de "organização operante" para os crons; a varredura
  daqui já pula empresa que não está ativa, e a declaração na cerca dele entra na
  próxima sincronização.
